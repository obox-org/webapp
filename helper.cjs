#!/usr/bin/env node
'use strict'
/**
 * 网页应用助手（纯 Node，随扩展包分发；宿主经 `api.ipc` 的 stdio 通道拉起）。
 *
 * 协议：**JSON-RPC 2.0**，分帧 `ndjson`（一行一条 JSON）。
 *   ← 请求  {"jsonrpc":"2.0","id":1,"method":"probe","params":{}}
 *   → 响应  {"jsonrpc":"2.0","id":1,"result":{…}}
 *           {"jsonrpc":"2.0","id":1,"error":{"code":-32603,"message":"…"}}
 *
 * ⚠️ 宿主 `src/main/ipcCore.ts:229-236` 强制要求 `jsonrpc: "2.0"`，否则通道立刻以
 * `protocol-error 缺少 jsonrpc: "2.0"` 关闭（`extensions/rdp/helper.cjs:11-14` 记录过真机后果）。
 * 因此这里实现标准 JSON-RPC 2.0，而不是任何简写形状。
 *
 * 日志一律走 **stderr**（宿主转发到输出通道）；**stdout 只放协议帧**，多一个字符都会毁掉分帧。
 *
 * 方法集：`probe` / `launch` / `profileStatus` / `moveProfile` / `removeProfile` /
 * `profileSize` / `cleanCaches`；另有 `--selftest`（不真的启动 Chrome）。
 *
 * **能力边界**（规格 §16）：只做「探测 Chrome + 按白名单参数 spawn + 在自己的 profile 根内做
 * 目录读写」。不接受任意命令行透传（`launch` 的 5 条校验），不接受任意路径
 * （所有 profile 方法只收**单层目录名**，根目录固定为 `<cwd>/chrome`）。
 */
const { execFile, execFileSync, spawn } = require('node:child_process')
const {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync
} = require('node:fs')
const { tmpdir } = require('node:os')
const { basename, isAbsolute, join, relative, sep } = require('node:path')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const readline = require('node:readline')

/** JSON-RPC 标准错误码 */
const RPC_PARSE_ERROR = -32700
const RPC_INVALID_PARAMS = -32602
const RPC_METHOD_NOT_FOUND = -32601
const RPC_INTERNAL_ERROR = -32603

/** profile 根目录名（相对助手 cwd，即扩展的 data 目录） */
const PROFILE_ROOT = 'chrome'
/** 删除中转区（规格 §14.3：先原子 rename 再删，半删只可能落在中转区里） */
const TRASH_DIR = '.trash'
/** 改名两阶段 intent 文件（规格 §14.2：`fs.rename` 与 `db.update` 之间没有事务） */
const PENDING_MOVE = '.pending-move.json'
/** `.trash` 残留的保留期：超过 24h 的"旧会话"残留才清理（规格 §14.3 第 5 步） */
const TRASH_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** `lib/profileLimit.mjs` 的绝对 URL（helper 可能以任意 cwd 启动，不能依赖相对解析） */
const PROFILE_LIMIT_URL = pathToFileURL(join(__dirname, 'lib', 'profileLimit.mjs')).href

/** 惰性加载纯模块（CJS 不能静态 import ESM；用绝对 URL 避免 cwd 影响） */
let profileLimitModule = null
async function profileLimit() {
  if (!profileLimitModule) profileLimitModule = await import(PROFILE_LIMIT_URL)
  return profileLimitModule
}

// ---------------------------------------------------------------------------
// 目录安全
// ---------------------------------------------------------------------------

/**
 * profile 目录名白名单：只能是**单层目录名**，非空，不含路径分隔符 / `.` / `..` / 盘符。
 * @param {unknown} value
 * @returns {string}
 */
function assertProfileName(value) {
  const name = String(value ?? '').trim()
  if (!name) throw new Error('需要非空的 profile 目录名')
  if (name.includes('/') || name.includes('\\')) {
    throw new Error(`profile 目录名不能含路径分隔符: ${name}`)
  }
  if (name === '.' || name === '..' || name === TRASH_DIR) {
    throw new Error(`profile 目录名非法: ${name}`)
  }
  if (/[:*?"<>|]/.test(name)) throw new Error(`profile 目录名含非法字符: ${name}`)
  return name
}

/** profile 根目录绝对路径（`<cwd>/chrome`） */
function profileRoot() {
  return join(process.cwd(), PROFILE_ROOT)
}

/**
 * 把目录名解析成**必定位于 profile 根之内**的绝对路径（双保险：拼接后再用 `relative` 复核）。
 * @param {unknown} value
 */
function profilePath(value) {
  const name = assertProfileName(value)
  const root = profileRoot()
  const target = join(root, name)
  const rel = relative(root, target)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`profile 路径越界: ${name}`)
  }
  return target
}

/** 错误归一：任何抛出物 → 可读单行文本（保留 errno 与系统原文，便于排查占用） */
function messageOfError(err) {
  if (!err) return '未知错误'
  const code = err.code ? `${err.code}: ` : ''
  return `${code}${err.message || String(err)}`
}

/** 递归统计目录的字节数与文件数（不抛错：读不了的条目按 0 计） */
function measureDir(dir) {
  let bytes = 0
  let files = 0
  const stack = [dir]
  while (stack.length) {
    const current = stack.pop()
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const full = join(current, entry.name)
      if (entry.isDirectory()) {
        stack.push(full)
        continue
      }
      if (entry.isFile()) {
        files += 1
        try {
          bytes += statSync(full).size
        } catch {
          // 读不到大小就不计（统计是尽力而为，绝不因此失败）
        }
      }
    }
  }
  return { bytes, files }
}

/** 递归删除（`force` 让 ENOENT 静默；只读文件由 `clearReadonly` 先复位） */
function removeDir(dir) {
  rmSync(dir, { recursive: true, force: true })
}

/**
 * 去掉目录树的只读属性。
 *
 * 为什么必须做：Windows 上 `fs.rm(recursive, force)` **删不掉只读文件**，而 Chrome profile 里
 * 常有只读文件（宿主 `src/main/fs.ts:136` 是同一形态的调用，同样有这个已知行为）。
 * 复位仍可能失败（占用），因此调用方必须容忍失败、把结果记进 failures。
 */
function clearReadonly(dir) {
  let info
  try {
    info = lstatSync(dir)
  } catch {
    return
  }
  if (!info.isDirectory()) {
    try {
      chmodSync(dir, 0o600)
    } catch {
      // 复位失败不致命：真正删不掉时由调用方记为 failures
    }
    return
  }
  try {
    chmodSync(dir, 0o700)
  } catch {
    // 同上
  }
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (const entry of entries) clearReadonly(join(dir, entry))
}

/**
 * 目录是否**看起来**被占用（启发式，**不作为硬拦截**）。
 *
 * ⚠️ **真机证据（2026-10-12 实测，务必按它改）**：Windows 上**没有**
 * POSIX 专有的 `Singleton*` 锁文件（`SingletonLock` / `SingletonCookie` / `SingletonSocket`
 * 只在 macOS/Linux 出现——本机实测 profile 根下不存在这几个名字）。
 * 运行中的 Chrome 持有的是：顶层 `lockfile`（0 字节、**独占打开、连读都失败**）
 * 与约 30 个 LevelDB `LOCK`（`Default\LOCK`、`Default\Local Storage\leveldb\LOCK`、
 * `Default\Session Storage\LOCK`、`Default\Service Worker\Database\LOCK` …），
 * 单实例保护另有一个隐藏消息窗口（class `Chrome_WidgetWin_0`）。
 *
 * 因此这里的判据是"**打开 Chrome 实际持有的锁文件是否失败**"，
 * 而**真正的判据始终是 `rename` / 递归删除的成败**（见 `removeProfile` / `moveProfile`）。
 * 本函数只用于给界面/文案提供"很可能是窗口开着"的线索。
 * 它**无法**被自动化测试覆盖（纯 Node 造不出"另一进程独占打开同一文件"的状态）——
 * 属已接受的覆盖缺口，走真机验收。
 */
const LOCK_PROBES = [
  'lockfile',
  'Default/LOCK',
  'Default/Local Storage/leveldb/LOCK',
  'Default/Session Storage/LOCK',
  'Default/Service Worker/Database/LOCK'
]

function looksLocked(dir) {
  for (const relative of LOCK_PROBES) {
    const target = join(dir, ...relative.split('/'))
    if (!existsSync(target)) continue
    try {
      // Windows 上被独占打开的文件在这里抛 EBUSY / EPERM / EACCES（实测 `lockfile` 连读都失败）
      const fd = openSync(target, 'r+')
      closeSync(fd)
    } catch (err) {
      const code = err && err.code
      if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') return true
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Chrome 探测（R8，确定性 4 顺位）
// ---------------------------------------------------------------------------

/** Chrome 的 3 个固定候选路径（规格 §11.2 的顺序） */
function chromeCandidates() {
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files'
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)'
  const localAppData = process.env.LOCALAPPDATA || join(tmpdir(), '..')
  const suffix = join('Google', 'Chrome', 'Application', 'chrome.exe')
  return [
    { path: join(programFiles, suffix), source: 'programfiles' },
    { path: join(programFilesX86, suffix), source: 'programfiles-x86' },
    { path: join(localAppData, suffix), source: 'localappdata' }
  ]
}

/** 文件版本（`ProductVersion`；读不到返回 null，绝不因此失败） */
function chromeVersion(exePath) {
  try {
    const out = execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `(Get-Item -LiteralPath '${String(exePath).replace(/'/g, "''")}').VersionInfo.ProductVersion`
      ],
      { timeout: 8000, windowsHide: true, encoding: 'utf8' }
    )
    const text = String(out ?? '').trim()
    return text || null
  } catch {
    return null
  }
}

/** 注册表 `App Paths\chrome.exe`（HKLM 优先，缺失时读 HKCU）；`reg.exe` 不可用只记日志 */
function registryChromePath() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve(null)
      return
    }
    const keys = [
      'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
      'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe'
    ]
    const tryKey = (index) => {
      if (index >= keys.length) {
        resolve(null)
        return
      }
      execFile(
        'reg.exe',
        ['query', keys[index], '/ve'],
        { timeout: 8000, windowsHide: true },
        (err, stdout) => {
          if (err) {
            process.stderr.write(
              `[webapp-helper] reg query 失败（${keys[index]}）：${err.message}\n`
            )
            tryKey(index + 1)
            return
          }
          const match = String(stdout ?? '').match(/REG_SZ\s+(.+?)\s*$/m)
          const value = match ? match[1].trim() : ''
          if (value) resolve(value)
          else tryKey(index + 1)
        }
      )
    }
    tryKey(0)
  })
}

/** 探测 Chrome：3 处固定路径 + 注册表第 4 顺位；**每次调用都重算**（不缓存，规格 §11.2） */
async function detectChrome() {
  const found = chromeCandidates().find((item) => existsSync(item.path))
  const registryPath = found ? null : await registryChromePath()
  // `chromeCandidates` 恒为 **4 项、顺序固定**（规格 §11.2）：前 3 项是固定路径，
  // 第 4 项是注册表（未读到值时为 null，此时回落到第 1 项路径仅用于展示）
  const candidates = chromeCandidates().map((item) => ({
    path: item.path,
    source: item.source,
    exists: existsSync(item.path)
  }))
  candidates.push({
    path: registryPath || chromeCandidates()[0].path,
    source: 'registry',
    exists: Boolean(registryPath && existsSync(registryPath)),
    registryValue: registryPath || null
  })

  if (found) {
    return {
      chrome: { path: found.path, source: found.source, version: chromeVersion(found.path) },
      candidates
    }
  }
  const registryEntry = candidates[3]
  if (registryEntry.exists) {
    return {
      chrome: {
        path: registryEntry.path,
        source: 'registry',
        version: chromeVersion(registryEntry.path)
      },
      candidates
    }
  }
  return { chrome: null, candidates }
}

/**
 * `probe`：环境诊断 + Chrome 探测结果（规格 §11.2）。
 *
 * ⚠️ **探测顺序没有任何运行时入参可以改变**（D-2 的最终裁定）：
 * 本函数的签名是 `probe()` —— **不接任何参数**，调用链是
 * `probe() → detectChrome() → chromeCandidates()`（3 处固定路径）
 * `→ registryChromePath()`（第 4 顺位：HKLM 优先、缺失读 HKCU）。
 * 入参里既没有"仅测试用"的探测路径注入，也没有"跳过注册表"开关（那类口子已被明确排除）。
 *
 * 代价是 **"Chrome 未安装（`[chrome-not-found]`）"与 4 顺位探测顺序没有自动化覆盖** ——
 * 这是**已接受的覆盖缺口**，只走可逆的手工真机验收；步骤与还原校验命令写在 README 的
 * 「已知覆盖缺口」一节。
 */
async function probe() {
  const detected = await detectChrome()
  return {
    cwd: process.cwd(),
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null,
    platform: process.platform,
    profileRoot: profileRoot(),
    chrome: detected.chrome,
    chromeCandidates: detected.candidates
  }
}

// ---------------------------------------------------------------------------
// launch（参数白名单 + spawn）
// ---------------------------------------------------------------------------

/** `launch` 允许出现的参数名前缀（规格 §11.2 第 3 条；`--app` 单独处理） */
const ALLOWED_ARG_PREFIXES = [
  '--user-data-dir',
  '--disable-features',
  '--disk-cache-size',
  '--ignore-certificate-errors',
  '--unsafely-treat-insecure-origin-as-secure',
  '--window-size',
  '--window-position',
  '--start-maximized',
  '--lang',
  '--force-device-scale-factor',
  '--disable-gpu'
]
/** 明确禁止的参数（规格 §11.2 第 5 条；即便前缀巧合也不放行） */
const FORBIDDEN_ARG_NAMES = new Set([
  '--',
  '--remote-debugging-port',
  '--load-extension',
  '--proxy-server',
  '--disable-web-security',
  '--no-sandbox'
])
/** args 的规模上限（规格 §11.2 第 1 条） */
const MAX_ARGS = 16
const MAX_ARG_LENGTH = 512
/** `--disk-cache-size` 的取值上限（规格 §11.2 校验第 5 条：1 ≤ n ≤ 17179869184 = 16 GB） */
const MAX_DISK_CACHE_BYTES = 16 * 1024 * 1024 * 1024

/**
 * `--user-data-dir` 的值防护（规格 §11.2 第 4 条）：
 * 只允许**相对路径**、恰好 `chrome/<单层目录名>` 两层、禁止 `..` / 盘符 / 绝对路径。
 * @param {unknown} value
 */
function resolveUserDataDir(value) {
  const text = String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
  if (!text) throw new Error('--user-data-dir 不能为空')
  if (isAbsolute(text) || /^[a-zA-Z]:/.test(text) || text.startsWith('/')) {
    throw new Error(`--user-data-dir 必须是相对路径: ${text}`)
  }
  const parts = text.split('/').filter((part) => part !== '')
  if (parts.length !== 2 || parts[0] !== PROFILE_ROOT) {
    throw new Error(`--user-data-dir 只允许 chrome/<单层目录名> 形态: ${text}`)
  }
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error(`--user-data-dir 不能含 . / .. : ${text}`)
  }
  const name = assertProfileName(parts[1])
  return profilePath(name).split('/').join(sep)
}

/**
 * 校验并归一 `launch` 的 args（规格 §11.2 的 5 条；扩展侧已校验一次，这里是第二层）。
 * @param {unknown} rawArgs
 * @returns {{ args: string[], userDataDir: string }}
 */
function validateLaunchArgs(rawArgs) {
  if (!Array.isArray(rawArgs)) throw new Error('launch 的 args 必须是数组')
  if (rawArgs.length < 1 || rawArgs.length > MAX_ARGS) {
    throw new Error(`launch 的 args 长度必须在 1–${MAX_ARGS} 之间（收到 ${rawArgs.length}）`)
  }
  const args = []
  let userDataDir = ''
  for (const raw of rawArgs) {
    if (typeof raw !== 'string') throw new Error('launch 的 args 每一项都必须是字符串')
    if (raw.length > MAX_ARG_LENGTH) {
      throw new Error(`launch 的单个参数过长（上限 ${MAX_ARG_LENGTH} 个字符）`)
    }
    const name = raw.includes('=') ? raw.slice(0, raw.indexOf('=')) : raw
    if (FORBIDDEN_ARG_NAMES.has(name)) throw new Error(`launch 不接受参数 ${name}`)
    if (name === '--app') {
      const url = raw.slice('--app='.length)
      if (!/^https?:\/\//i.test(url)) {
        throw new Error('launch 的 args[0] 必须是 --app=<http/https 地址>')
      }
      args.push(raw)
      continue
    }
    if (!ALLOWED_ARG_PREFIXES.includes(name)) {
      throw new Error(`launch 不接受参数 ${name}（白名单之外）`)
    }
    if (name === '--user-data-dir') {
      if (userDataDir) throw new Error('launch 的 args 里不能出现两次 --user-data-dir')
      userDataDir = resolveUserDataDir(raw.slice('--user-data-dir='.length))
      args.push(`--user-data-dir=${userDataDir}`)
      continue
    }
    if (name === '--disk-cache-size') {
      // 值域（用户决策，带实测证据）：**`-1` = 禁用磁盘 HTTP 缓存**（实测 `Default\Cache`
      // 变成 0 字节 / 0 文件）；**正数**必须是纯十进制整数且 1 ≤ n ≤ 17179869184（16 GB）。
      // 为什么不是"设个大数字"：实测该 flag **不限制缓存总量**（20 MB cap 下跑 300 MB 流量，
      // `Default\Cache` 仍是 301.998 MB），只有 `-1` 能真正把它按住。
      const value = raw.slice('--disk-cache-size='.length)
      if (value === '-1') {
        args.push(raw)
        continue
      }
      if (!/^\d+$/.test(value)) {
        throw new Error(`--disk-cache-size 必须是 -1（禁用）或纯十进制正整数，收到：${value}`)
      }
      const bytes = Number.parseInt(value, 10)
      if (bytes < 1 || bytes > MAX_DISK_CACHE_BYTES) {
        throw new Error(
          `--disk-cache-size 必须在 1–${MAX_DISK_CACHE_BYTES} 字节之间，收到：${value}`
        )
      }
      args.push(raw)
      continue
    }
    args.push(raw)
  }
  if (!args.length || !args[0].startsWith('--app=')) {
    throw new Error('launch 的 args[0] 必须是 --app=<url>')
  }
  if (!userDataDir) throw new Error('launch 的 args 必须包含 --user-data-dir=chrome/<目录名>')
  return { args, userDataDir }
}

/**
 * `launch { args }`：探测 Chrome → 校验白名单 → `spawn(exe, args)` detached 并 unref。
 *
 * ⚠️ **不接受 `exe` 入参**：只可能启动探测到的 Chrome（规格 §16 的硬要求——绝不回退 Edge，
 * 也不接受任意可执行文件）。
 */
async function launch(params = {}) {
  const { args, userDataDir } = validateLaunchArgs(params.args)
  const detected = await detectChrome()
  if (!detected.chrome) {
    const searched = detected.candidates
      .map((item) => item.path)
      .concat('注册表 HKLM\\…\\App Paths\\chrome.exe')
      .join('；')
    throw new Error(`[chrome-not-found] 未找到 Chrome（已查找：${searched}）`)
  }

  const exe = detected.chrome.path
  // 参数以**数组**交给 spawn（不让 shell 参与，也不自己拼命令行字符串）
  const child = spawn(exe, args, { detached: true, stdio: 'ignore' })
  const pid = await new Promise((resolve, reject) => {
    child.once('spawn', () => resolve(child.pid))
    child.once('error', (err) =>
      reject(new Error(`[spawn-failed] 启动 Chrome 失败：${err.message}`))
    )
  })
  child.unref()
  return {
    pid,
    exe,
    profileDir: userDataDir,
    chromeSource: detected.chrome.source,
    summary: `chrome=${exe} 参数=${args.length} 个 profile=${basename(userDataDir)}`
  }
}

// ---------------------------------------------------------------------------
// profile 生命周期
// ---------------------------------------------------------------------------

/** `profileStatus { name }`：目录是否存在 / 是否可能被占用（`locked` 只是启发式） */
function profileStatus(params = {}) {
  const name = assertProfileName(params.name)
  const dir = profilePath(name)
  const exists = existsSync(dir)
  return { name, dir, exists, locked: exists ? looksLocked(dir) : false }
}

/** 读 `.pending-move.json`（两阶段 intent；读不到/不合法都返回 null） */
function readPendingMove() {
  const file = join(profileRoot(), PENDING_MOVE)
  if (!existsSync(file)) return null
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'))
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

/**
 * `moveProfile { from, to }`：改名搬目录（规格 §14.2 的两阶段 intent）。
 * 源不存在 → `{ missing: true }`（不是错误：无需移动，直接落库）。
 */
function moveProfile(params = {}) {
  const fromName = assertProfileName(params.from)
  const toName = assertProfileName(params.to)
  const from = profilePath(fromName)
  const to = profilePath(toName)
  const root = profileRoot()

  if (fromName === toName) return { moved: false, from, to, sameName: true }
  if (!existsSync(from)) return { moved: false, from, to, missing: true }
  if (existsSync(to)) {
    let nonEmpty = true
    try {
      nonEmpty = readdirSync(to).length > 0
    } catch {
      nonEmpty = true
    }
    if (nonEmpty) {
      throw new Error(`[profile-move-failed] 目标浏览器数据目录已存在且非空：${toName}`)
    }
  }

  mkdirSync(root, { recursive: true })
  const intentFile = join(root, PENDING_MOVE)
  writeFileSync(intentFile, JSON.stringify({ from: fromName, to: toName, at: Date.now() }), 'utf8')
  try {
    renameSync(from, to)
  } catch (err) {
    // 移动没发生：清掉 intent，如实报错（上层据此**不落库**）
    try {
      rmSync(intentFile, { force: true })
    } catch {
      // 忽略
    }
    throw new Error(
      `[profile-move-failed] 无法把 ${fromName} 改名为 ${toName}（${messageOfError(err)}）`
    )
  }
  try {
    rmSync(intentFile, { force: true })
  } catch {
    // intent 残留不致命：下次 `profileStatus` 会对账并清掉
  }
  return { moved: true, from, to }
}

/**
 * `removeProfile { name }`：**先原子 rename 进 `.trash/`**，再递归删除（规格 §14.3）。
 * 目录不存在 → `{ removed: false }`（不是错误）。
 */
function removeProfile(params = {}) {
  const name = assertProfileName(params.name)
  const dir = profilePath(name)
  if (!existsSync(dir)) return { removed: false, dir, name }

  const trashRoot = join(profileRoot(), TRASH_DIR)
  mkdirSync(trashRoot, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '').slice(0, 15)
  const parked = join(trashRoot, `${stamp}-${name}`)

  try {
    // **整目录 rename 的成败就是"是否被占用"的判据**（真机实测：窗口开着时
    // rename 报 `Access to the path '…' is denied.`，而删目录内单个文件会成功——
    // 所以必须试"整目录操作"，不能靠"有没有某个锁文件"来判断）。
    renameSync(dir, parked)
  } catch (err) {
    const code = err && err.code
    const busy = code === 'EBUSY' || code === 'EPERM' || code === 'EACCES'
    const prefix = busy || looksLocked(dir) ? '[profile-busy]' : '[profile-move-failed]'
    // 文案里带上**真实错误**（例如 `The process cannot access the file 'journal.baj'
    // because it is being used by another process.`），便于用户/我们定位是哪个文件被占
    throw new Error(
      `${prefix} 无法移动浏览器数据目录 ${dir}（很可能该站点的窗口正开着）：${messageOfError(err)}`
    )
  }

  let removed = true
  let warning = ''
  try {
    clearReadonly(parked)
    removeDir(parked)
  } catch (err) {
    removed = false
    warning = `浏览器数据未完全清理（${err.message}），下次启动会自动重试`
    process.stderr.write(`[webapp-helper] 清理 ${parked} 失败：${err.message}\n`)
  }
  return { removed, dir, name, parked, warning }
}

/**
 * `.trash` 残留清理（规格 §14.3 第 5 步）：只清**超过 24h** 的"旧会话"残留，
 * 不动本会话刚写进去的。
 */
function cleanTrash(maxAgeMs = TRASH_MAX_AGE_MS) {
  const trashRoot = join(profileRoot(), TRASH_DIR)
  if (!existsSync(trashRoot)) return { scanned: 0, removed: 0 }
  let entries = []
  try {
    entries = readdirSync(trashRoot, { withFileTypes: true })
  } catch {
    return { scanned: 0, removed: 0 }
  }
  const now = Date.now()
  let scanned = 0
  let removed = 0
  for (const entry of entries) {
    scanned += 1
    const full = join(trashRoot, entry.name)
    let mtime = 0
    try {
      mtime = statSync(full).mtimeMs
    } catch {
      continue
    }
    if (now - mtime < maxAgeMs) continue
    try {
      clearReadonly(full)
      removeDir(full)
      removed += 1
    } catch (err) {
      process.stderr.write(`[webapp-helper] .trash 清理 ${full} 失败：${err.message}\n`)
    }
  }
  return { scanned, removed }
}

// ---------------------------------------------------------------------------
// 体积统计与缓存清理（R17；契约见规格 §11.2 / §14.5 / §14.6）
// ---------------------------------------------------------------------------

/**
 * 体积缓存：条目名 → `{ scannedAt, bytes, cacheBytes, entries }`。
 *
 * 放**助手进程内存**（规格 S16）：体积数据的产生方是助手；放渲染进程会在子窗口重载时丢缓存。
 * 失效条件（规格 §14.6 的六条）：
 * ① TTL（60s）过期；② `force: true`；③ `cleanCaches` 成功后**清空整个 Map**；
 * ④ `moveProfile` / `removeProfile` 成功后清空**该条目**；⑤ `launch` 成功后**只作废该条目**；
 * ⑥ 用户改设置 → 扩展侧下一次调用带 `force: true`（**不新增通道方法**）。
 */
const sizeCache = new Map()

/** 按白名单找出条目目录下**深度 ≤ 2** 的缓存目录（相对路径，`/` 分隔） */
async function scanCacheDirs(dir) {
  const { classifyCachePath } = await profileLimit()
  const found = []
  const level1 = safeReaddir(dir)
  for (const entry of level1) {
    if (!entry.isDirectory()) continue
    // 深度 1：chrome/<名>/<缓存目录>
    const depth1 = classifyCachePath(entry.name)
    if (depth1.clean) found.push(entry.name)
    // 深度 2：chrome/<名>/<profile>/<缓存目录>
    const childDir = join(dir, entry.name)
    for (const child of safeReaddir(childDir)) {
      if (!child.isDirectory()) continue
      const relative = `${entry.name}/${child.name}`
      if (classifyCachePath(relative).clean) found.push(relative)
    }
  }
  return found
}

/** `readdirSync` 的容错包装（读不了就当空目录） */
function safeReaddir(dir) {
  try {
    return readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

/**
 * `profileSize { name, ttlMs?, force? }`（规格 §11.2 / §14.6）。
 *
 * @returns {Promise<{ dir: string, exists: boolean, bytes: number | null, scannedAt: string,
 *   cached: boolean, expiresAt: string, entries: number, cacheBytes: number | null }>}
 *   `bytes: null` = 目录不存在（首次打开）；`cacheBytes` = 可清理缓存类子目录的体积合计。
 */
async function profileSize(params = {}) {
  const name = assertProfileName(params.name)
  const dir = profilePath(name)
  const limit = await profileLimit()
  const ttlMs = Number.isFinite(Number(params.ttlMs))
    ? Number(params.ttlMs)
    : limit.PROFILE_SIZE_TTL_MS
  const now = Date.now()

  if (!existsSync(dir)) {
    sizeCache.delete(name)
    return {
      dir,
      exists: false,
      bytes: null,
      scannedAt: new Date(now).toISOString(),
      cached: false,
      expiresAt: new Date(now + ttlMs).toISOString(),
      entries: 0,
      cacheBytes: null
    }
  }

  const cached = sizeCache.get(name)
  if (limit.isProfileSizeCacheValid(cached, now, { ttlMs, force: params.force === true })) {
    return {
      dir,
      exists: true,
      bytes: cached.bytes,
      scannedAt: new Date(cached.scannedAt).toISOString(),
      cached: true,
      expiresAt: new Date(cached.scannedAt + ttlMs).toISOString(),
      entries: cached.entries,
      cacheBytes: cached.cacheBytes
    }
  }

  const measured = measureDir(dir)
  const cacheDirs = await scanCacheDirs(dir)
  let cacheBytes = 0
  for (const relative of cacheDirs) {
    cacheBytes += measureDir(join(dir, ...relative.split('/'))).bytes
  }
  const record = {
    scannedAt: now,
    bytes: measured.bytes,
    cacheBytes,
    entries: measured.files
  }
  sizeCache.set(name, record)
  return {
    dir,
    exists: true,
    bytes: measured.bytes,
    scannedAt: new Date(now).toISOString(),
    cached: false,
    expiresAt: new Date(now + ttlMs).toISOString(),
    entries: measured.files,
    cacheBytes
  }
}

/**
 * `cleanCaches { name? }`（规格 §11.2 / §14.5）：**只删缓存类子目录**。
 *
 * - `name` 省略 = 遍历 profile 根下的**全部条目**；
 * - 删的是白名单目录（8 个固定目录名、大小写不敏感、深度 ≤ 2），整体 `rm(recursive, force)`；
 * - 保留清单（Cookie / Login Data / Local Storage / IndexedDB / Service Worker / Preferences /
 *   History / Bookmarks …）**永不进删除路径**（`classifyCachePath` 的纯函数判定是唯一入口）；
 * - 单目录失败只记入 `skipped[]`，**不抛错**（与 `deleteCredential` 的"缺条目不算失败"同口径）；
 * - 成功后**清空整个体积缓存 Map**（失效条件 ③）。
 *
 * @returns {Promise<{ cleaned: Array<{ name: string, freedBytes: number, removedDirs: string[] }>,
 *   totalFreedBytes: number, skipped: Array<{ name: string, reason: string }> }>}
 */
async function cleanCaches(params = {}) {
  const limit = await profileLimit()
  const targets = []
  if (params.name === undefined || params.name === null || params.name === '') {
    for (const entry of safeReaddir(profileRoot())) {
      // ⚠️ **只收目录**：profile 根下还有两个非条目文件/目录——
      // `.trash`（删除中转区，本身是目录）与 `.pending-move.json`（改名 intent，是文件）。
      // 少了这道过滤，全局清理会把 `.trash` 当成一个"条目"，回包里多出一条
      // `{ name: '.trash', removedDirs: [] }`（实测踩到）。
      if (!entry.isDirectory()) continue
      if (entry.name === TRASH_DIR) continue
      targets.push(entry.name)
    }
  } else {
    targets.push(assertProfileName(params.name))
  }
  // 顺序确定（目录枚举顺序与文件系统有关，结果必须可复现、可断言）
  targets.sort()

  const cleaned = []
  const skipped = []
  for (const name of targets) {
    const dir = profilePath(name)
    if (!existsSync(dir)) {
      skipped.push({ name, reason: '目录不存在（未首次打开）' })
      continue
    }
    const removedDirs = []
    let freedBytes = 0
    for (const relative of await scanCacheDirs(dir)) {
      // 双保险：删除前再过一次纯函数判定（白名单 + 保留清单 + 深度）
      const verdict = limit.classifyCachePath(relative)
      if (!verdict.clean) {
        process.stderr.write(`[webapp-helper] 拒绝清理 ${relative}：${verdict.reason}\n`)
        continue
      }
      const target = join(dir, ...relative.split('/'))
      const size = measureDir(target).bytes
      try {
        clearReadonly(target)
        removeDir(target)
        removedDirs.push(relative)
        freedBytes += size
      } catch (err) {
        skipped.push({ name, reason: `${relative}：${messageOfError(err)}` })
      }
    }
    cleaned.push({ name, freedBytes, removedDirs })
  }

  // 失效条件 ③：清理成功后清空整个体积缓存（**不重新填**——下一次 profileSize 必须重算）
  sizeCache.clear()
  const totalFreedBytes = cleaned.reduce((sum, item) => sum + item.freedBytes, 0)
  // 可审计：删了什么必须可核对（规格 §16「R17 的清理动作例外」）。
  // ⚠️ **走 stderr**：stdout 只允许放协议帧，一个字符的审计日志都会毁掉 ndjson 分帧
  //    （宿主会立刻以 protocol-error 关通道）。回包里的 `removedDirs` 才是给界面的正式通道。
  for (const item of cleaned) {
    if (item.removedDirs.length) {
      process.stderr.write(
        `[webapp-helper] 清理缓存 ${item.name}：删除 ${item.removedDirs.length} 个目录（${item.removedDirs.join('、')}），释放 ${item.freedBytes} 字节\n`
      )
    }
  }
  return { cleaned, totalFreedBytes, skipped }
}

// ---------------------------------------------------------------------------
// 协议循环
// ---------------------------------------------------------------------------

/** 方法表 */
const METHODS = {
  probe,
  launch,
  profileStatus,
  moveProfile,
  removeProfile,
  profileSize,
  cleanCaches
}

/** 一行 → 一行响应（stdout 只写协议帧） */
function writeMessage(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

/** 哪些错误算"参数不合法"（`-32602`）而不是"底层失败"（`-32603`） */
function isInvalidParamsMessage(message) {
  const text = String(message ?? '')
  // ⚠️ 判据是**错误/入参**本身，不是"消息里恰好出现某个词"：例如
  // `launch 不接受参数 X` 属于参数非法（-32602），而 `[spawn-failed] …` 属于内部失败（-32603）。
  return [
    '必须是数组',
    '必须是字符串',
    '不接受参数',
    '--user-data-dir',
    '--disk-cache-size',
    'profile 目录名',
    'profile 路径越界',
    '需要非空的 profile 目录名',
    'args 长度',
    '单个参数过长',
    'args[0]',
    'args 必须包含',
    'cleanCaches'
  ].some((needle) => text.includes(needle))
}

async function handleLine(line) {
  const text = String(line ?? '').trim()
  if (!text) return

  let request
  try {
    request = JSON.parse(text)
  } catch (err) {
    writeMessage({
      jsonrpc: '2.0',
      id: null,
      error: { code: RPC_PARSE_ERROR, message: `请求不是合法 JSON: ${err.message}` }
    })
    return
  }

  const id = request && request.id !== undefined ? request.id : undefined
  if (id === undefined) return // 通知（如宿主的 $/cancelRequest）：无需应答

  if (!request || request.jsonrpc !== '2.0' || typeof request.method !== 'string') {
    writeMessage({
      jsonrpc: '2.0',
      id,
      error: { code: RPC_INVALID_PARAMS, message: '请求必须是 {jsonrpc:"2.0",id,method,params}' }
    })
    return
  }

  const handler = METHODS[request.method]
  if (!handler) {
    writeMessage({
      jsonrpc: '2.0',
      id,
      error: { code: RPC_METHOD_NOT_FOUND, message: `未知方法: ${request.method}` }
    })
    return
  }

  try {
    const result = await handler(request.params ?? {})
    writeMessage({ jsonrpc: '2.0', id, result: result ?? null })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const code = isInvalidParamsMessage(message) ? RPC_INVALID_PARAMS : RPC_INTERNAL_ERROR
    writeMessage({ jsonrpc: '2.0', id, error: { code, message } })
  }
}

/** 协议循环：stdin 一行一请求（CRLF 容忍），stdin 结束即退出 */
function serve() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
  rl.on('line', (line) => {
    void handleLine(line).catch((err) => {
      process.stderr.write(`[webapp-helper] 处理请求异常：${err && err.message}\n`)
    })
  })
  rl.on('close', () => process.exit(0))
  process.stderr.write(
    `[webapp-helper] 就绪 cwd=${process.cwd()} node=${process.versions.node} platform=${process.platform}\n`
  )
}

// ---------------------------------------------------------------------------
// --selftest（不真的启动 Chrome）
// ---------------------------------------------------------------------------

/** 在临时目录里造一个"看起来像 Chrome profile"的目录树（仅供 selftest 使用） */
/** 在临时目录里造一个"看起来像 Chrome profile"的目录树（仅供 selftest 使用） */
function makeFakeProfile(root, name) {
  const profile = join(root, PROFILE_ROOT, name)
  mkdirSync(join(profile, 'Default', 'Cache'), { recursive: true })
  mkdirSync(join(profile, 'Default', 'Code Cache'), { recursive: true })
  mkdirSync(join(profile, 'Default', 'Local Storage'), { recursive: true })
  mkdirSync(join(profile, 'Default', 'IndexedDB'), { recursive: true })
  mkdirSync(join(profile, 'Default', 'Service Worker', 'CacheStorage'), { recursive: true })
  mkdirSync(join(profile, 'GPUCache'), { recursive: true })
  mkdirSync(join(profile, 'ShaderCache'), { recursive: true })
  // 深度 3 上的同名目录：**不得**被清理（深度上限 2 的边界）
  mkdirSync(join(profile, 'Default', 'Local Storage', 'Cache'), { recursive: true })
  writeFileSync(join(profile, 'Default', 'Cookies'), 'cookie', 'utf8')
  writeFileSync(join(profile, 'Default', 'Login Data'), 'login', 'utf8')
  writeFileSync(join(profile, 'Default', 'History'), 'history', 'utf8')
  writeFileSync(join(profile, 'Default', 'Cache', 'blob'), 'x'.repeat(2048), 'utf8')
  writeFileSync(join(profile, 'Default', 'Code Cache', 'code'), 'z'.repeat(256), 'utf8')
  writeFileSync(join(profile, 'GPUCache', 'gpu'), 'y'.repeat(512), 'utf8')
  writeFileSync(join(profile, 'ShaderCache', 'shader'), 's'.repeat(128), 'utf8')
  writeFileSync(join(profile, 'Default', 'Local Storage', 'Cache', 'deep'), 'd'.repeat(64), 'utf8')
  return profile
}

/**
 * `--selftest`：在临时目录里验证**参数白名单 + profile 目录操作 + 只清缓存 + 体积统计 +
 * 上限判定**，全程不 spawn Chrome、不碰真实数据。
 * @returns {Promise<number>} 退出码 0/1
 */
async function selftest() {
  const dir = join(tmpdir(), `obox-webapp-selftest-${Date.now()}-${process.pid}`)
  const limit = await profileLimit()
  const previousCwd = process.cwd()
  try {
    makeFakeProfile(dir, '示例站点')
    process.chdir(dir)
    const profileDir = join(dir, PROFILE_ROOT, '示例站点')

    // ① 缓存白名单 / 保留清单 / 深度
    assert.ok(limit.isCacheDirName('Cache'), 'Cache 应在缓存白名单里')
    assert.ok(limit.isCacheDirName('code cache'), '白名单匹配必须大小写不敏感')
    assert.ok(!limit.isCacheDirName('Cookies'), 'Cookies 不得在缓存白名单里')
    assert.ok(limit.isProtectedDirName('Login Data'), 'Login Data 应在保留清单里')
    for (const name of limit.CACHE_DIR_NAMES) {
      assert.ok(!limit.isProtectedDirName(name), `缓存白名单 ${name} 命中了保留清单`)
    }
    assert.deepEqual(limit.classifyCachePath('Cache'), { clean: true })
    assert.deepEqual(limit.classifyCachePath('Default/Cache'), { clean: true })
    assert.equal(
      limit.classifyCachePath('Default/Local Storage/Cache').clean,
      false,
      '深度 3 不得清理'
    )
    assert.equal(limit.classifyCachePath('Default/Cookies').clean, false, 'Cookies 不得清理')
    assert.equal(limit.classifyCachePath('Default/Service Worker/CacheStorage').clean, false)
    assert.equal(limit.classifyCachePath('../evil').clean, false)

    // ② launch 参数白名单
    const ok = validateLaunchArgs([
      '--app=https://example.com/',
      '--user-data-dir=chrome/示例站点',
      '--disable-features=DownloadBubble',
      '--disk-cache-size=-1'
    ])
    assert.equal(ok.args.length, 4)
    assert.equal(ok.args[3], '--disk-cache-size=-1', '默认档位必须原样透传 -1')
    assert.ok(ok.userDataDir.includes('示例站点'), '--user-data-dir 应解析为绝对路径')
    assert.throws(() => validateLaunchArgs(['--app=file:///etc/passwd']), /--app=/)
    assert.throws(
      () =>
        validateLaunchArgs(['--app=https://a/', '--user-data-dir=chrome/x', '--proxy-server=x']),
      /不接受参数 --proxy-server/
    )
    assert.throws(
      () => validateLaunchArgs(['--app=https://a/', '--user-data-dir=chrome/x', '--headless=new']),
      /白名单之外/
    )
    assert.throws(
      () => validateLaunchArgs(['--app=https://a/', '--user-data-dir=..\\evil']),
      /chrome\/<单层目录名>/
    )
    assert.throws(
      () =>
        validateLaunchArgs([
          '--app=https://a/',
          '--user-data-dir=chrome/x',
          '--user-data-dir=chrome/y'
        ]),
      /两次/
    )
    // 值域：`-1`（禁用）合法；正数 1..16GB 合法；`abc` / `-2` / `-0` / 超上限全部拒绝
    const disabled = validateLaunchArgs([
      '--app=https://a/',
      '--user-data-dir=chrome/x',
      '--disk-cache-size=-1'
    ])
    assert.equal(disabled.args[2], '--disk-cache-size=-1', '`-1` 必须被接受并原样透传')
    for (const bad of ['abc', '-2', '-0', '17179869185', '1.5', '']) {
      assert.throws(
        () =>
          validateLaunchArgs([
            '--app=https://a/',
            '--user-data-dir=chrome/x',
            `--disk-cache-size=${bad}`
          ]),
        /--disk-cache-size/,
        `--disk-cache-size=${bad} 应被拒`
      )
    }
    assert.equal(
      validateLaunchArgs([
        '--app=https://a/',
        '--user-data-dir=chrome/x',
        '--disk-cache-size=536870912'
      ]).args[2],
      '--disk-cache-size=536870912',
      '正数档位仍应被接受'
    )
    assert.throws(() => assertProfileName('a/b'), /分隔符/)
    assert.throws(() => assertProfileName('..'), /非法/)

    // ③ profileStatus + 体积统计（含 TTL 缓存命中与 cacheBytes）
    const status = profileStatus({ name: '示例站点' })
    assert.equal(status.exists, true)
    assert.equal(status.locked, false)

    const size = await profileSize({ name: '示例站点' })
    assert.equal(size.exists, true)
    assert.equal(size.entries, 8, `期望 8 个文件，实际 ${size.entries}`)
    assert.equal(size.bytes, 2048 + 256 + 512 + 128 + 6 + 5 + 7 + 64, `字节数不符：${size.bytes}`)
    assert.equal(size.cacheBytes, 2048 + 256 + 512 + 128, `cacheBytes 不符：${size.cacheBytes}`)
    assert.equal(size.cached, false)
    const cachedNow = await profileSize({ name: '示例站点' })
    assert.equal(cachedNow.cached, true, '第二次调用应命中缓存')
    assert.equal(cachedNow.scannedAt, size.scannedAt, '命中缓存时 scannedAt 不得变化')

    // ④ 只清缓存：缓存目录消失、保留清单逐字节不变、深度 3 的同名目录仍在
    const cookiesBefore = readFileSync(join(profileDir, 'Default', 'Cookies'), 'utf8')
    const cleaned = await cleanCaches({ name: '示例站点' })
    const removed = cleaned.cleaned[0].removedDirs
    assert.ok(removed.includes('Default/Cache'), '应清掉 Default/Cache')
    assert.ok(removed.includes('Default/Code Cache'), '应清掉 Default/Code Cache')
    assert.ok(removed.includes('GPUCache'), '应清掉 GPUCache')
    assert.ok(removed.includes('ShaderCache'), '应清掉 ShaderCache')
    assert.ok(!removed.includes('Default/Local Storage/Cache'), '深度 3 的同名目录不得被清')
    assert.ok(existsSync(join(profileDir, 'Default', 'Cookies')), 'Cookies 必须保留')
    assert.equal(
      readFileSync(join(profileDir, 'Default', 'Cookies'), 'utf8'),
      cookiesBefore,
      'Cookies 必须逐字节不变'
    )
    assert.ok(existsSync(join(profileDir, 'Default', 'Login Data')), 'Login Data 必须保留')
    assert.ok(existsSync(join(profileDir, 'Default', 'History')), 'History 必须保留')
    assert.ok(existsSync(join(profileDir, 'Default', 'Local Storage')), 'Local Storage 必须保留')
    assert.ok(existsSync(join(profileDir, 'Default', 'IndexedDB')), 'IndexedDB 必须保留')
    assert.ok(existsSync(join(profileDir, 'Default', 'Service Worker')), 'Service Worker 必须保留')
    assert.ok(
      existsSync(join(profileDir, 'Default', 'Local Storage', 'Cache', 'deep')),
      '深度 3 同名目录里的文件必须保留'
    )
    assert.deepEqual(cleaned.skipped, [], `清理不应有跳过：${JSON.stringify(cleaned.skipped)}`)
    assert.ok(cleaned.totalFreedBytes > 0, '应统计出释放的字节数')
    const afterClean = await profileSize({ name: '示例站点', force: true })
    assert.ok(afterClean.bytes < size.bytes, '清理后体积应下降')
    assert.equal(
      afterClean.cacheBytes,
      0,
      '深度 3 的同名目录**不计入** cacheBytes（它不在可清理白名单的深度内）'
    )

    // ⑤ 改名（两阶段 intent 的正常路径）
    const moved = moveProfile({ from: '示例站点', to: '示例站点-新' })
    assert.equal(moved.moved, true)
    assert.ok(existsSync(join(dir, PROFILE_ROOT, '示例站点-新')), '目标目录应存在')
    assert.ok(!existsSync(join(dir, PROFILE_ROOT, '示例站点')), '源目录应消失')
    assert.ok(!existsSync(join(dir, PROFILE_ROOT, PENDING_MOVE)), 'intent 文件应被清理')
    assert.equal(
      moveProfile({ from: '不存在', to: '随便' }).missing,
      true,
      '源不存在应返回 missing'
    )

    // ⑥ 删除（进 .trash 后清理）
    const removedProfile = removeProfile({ name: '示例站点-新' })
    assert.equal(removedProfile.removed, true)
    assert.ok(!existsSync(join(dir, PROFILE_ROOT, '示例站点-新')), '目录应消失')

    // ⑦ .trash 清理只删"旧会话"残留
    const trashRoot = join(dir, PROFILE_ROOT, TRASH_DIR)
    mkdirSync(join(trashRoot, 'new-session'), { recursive: true })
    mkdirSync(join(trashRoot, 'old-session'), { recursive: true })
    const old = new Date(Date.now() - 48 * 60 * 60 * 1000)
    utimesSync(join(trashRoot, 'old-session'), old, old)
    utimesSync(join(trashRoot, 'new-session'), new Date(), new Date())
    const trash = cleanTrash()
    assert.equal(trash.removed, 1, `只应清理 1 个旧残留，实际 ${trash.removed}`)
    assert.ok(existsSync(join(trashRoot, 'new-session')), '本会话刚写的残留不得被清掉')
    assert.ok(!existsSync(join(trashRoot, 'old-session')), '超过 24h 的残留应被清掉')

    // ⑧ 设置归一与上限判定（R17）
    assert.equal(limit.normalizeProfileLimitMb('2048').mb, 2048)
    assert.deepEqual(limit.normalizeProfileLimitMb('9999'), { mb: 2048, fellBack: true })
    assert.equal(limit.normalizeDiskCacheMb('512').mb, 512)
    assert.equal(limit.diskCacheSizeArg('512'), '--disk-cache-size=536870912')
    assert.equal(limit.diskCacheSizeArg('-1'), '--disk-cache-size=-1', '默认档位 = 禁用磁盘缓存')
    assert.equal(limit.normalizeDiskCacheMb('9999').mb, -1, '不在档位内 → 回落 -1')
    assert.equal(limit.diskCacheSizeArg('0'), null, '0 = 不传该参数')
    assert.equal(limit.diskCacheSizeArg('128'), '--disk-cache-size=134217728')
    assert.equal(limit.checkProfileLimit(null, '2048').skip, true, '目录不存在 → 跳过预检')
    assert.equal(limit.checkProfileLimit(999, '0').skip, true, '上限 0 → 不预检')
    assert.equal(
      limit.checkProfileLimit(limit.mbToBytes(4096), '2048').overLimit,
      true,
      '4 GB > 2 GB 上限 → 拦截'
    )
    assert.equal(
      limit.checkProfileLimit(limit.mbToBytes(2048), '2048').overLimit,
      false,
      '等于上限不算超限'
    )
    assert.equal(limit.formatBytes(2 * 1024 * 1024 * 1024), '2.0 GB')

    // ⑨ probe（**不启动 Chrome**）：候选恒为 4 项、顺序固定
    const info = await probe()
    assert.equal(typeof info.cwd, 'string')
    assert.equal(info.chromeCandidates.length, 4, 'chromeCandidates 必须恒为 4 项')
    assert.deepEqual(
      info.chromeCandidates.map((item) => item.source),
      ['programfiles', 'programfiles-x86', 'localappdata', 'registry'],
      '探测顺位必须固定'
    )
    assert.ok(info.chrome === null || typeof info.chrome.path === 'string')

    console.log(
      `[webapp-helper] selftest 通过（临时目录 ${dir}，未启动 Chrome；缓存白名单 ${limit.CACHE_DIR_NAMES.length} 项、保留清单 ${limit.PROTECTED_DIR_NAMES.length} 项、TTL ${limit.PROFILE_SIZE_TTL_MS / 1000}s）`
    )
    return 0
  } catch (err) {
    console.error(
      `[webapp-helper] selftest 失败：${err instanceof Error ? err.message : String(err)}`
    )
    return 1
  } finally {
    try {
      process.chdir(previousCwd)
    } catch {
      // 忽略
    }
    try {
      rmSync(dir, { recursive: true, force: true })
    } catch {
      // 忽略
    }
  }
}

async function main() {
  if (process.argv.includes('--selftest')) {
    process.exitCode = await selftest()
    return
  }
  serve()
}

void main()
