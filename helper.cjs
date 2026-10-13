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
 * `profileSize` / `cleanCaches`（8 个既有方法各加**可选** `root`）+ 新增
 * `profileRootStatus` / `prepareRoot` / `checkRootCandidate` / `migrateRootDir`（规格 §9.5）；
 * 另有 `--selftest`（不真的启动 Chrome）。
 *
 * **能力边界**（规格 §9.7 / §16）：只做「探测 Chrome + 按白名单参数 spawn + 在**生效 profile 根**
 * 之内做目录读写」。不接受任意命令行透传（`launch` 的 5 条校验），不接受任意路径
 * （所有 profile 方法只收**单层目录名**；根由入参 `root` 决定，缺省 = `<cwd>/chrome`，
 * 与 1.0.2 逐字一致）。
 *
 * **数据安全三道防线**（规格 §9.7，落点见各函数注释）：
 * ① 路径校验（`resolveRoot` 复用 `lib/profileRoot.mjs` 的 V2–V5；相对形态只允许 `chrome/<单层名>`）；
 * ② 标记文件（自定义根缺 `.obox-webapp-root` ⇒ 删除/清理/改名**拒绝**，默认根豁免）；
 * ③ 永不删根（一切删/移只作用于 `join(root, <已校验的单层名>)`，`relative()` 双保险复核）。
 */
const { execFile, execFileSync, spawn } = require('node:child_process')
const {
  chmodSync,
  closeSync,
  copyFileSync,
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
const { basename, dirname, isAbsolute, join, relative, sep } = require('node:path')
const { pathToFileURL } = require('node:url')
const assert = require('node:assert/strict')
const readline = require('node:readline')

/** JSON-RPC 标准错误码 */
const RPC_PARSE_ERROR = -32700
const RPC_INVALID_PARAMS = -32602
const RPC_METHOD_NOT_FOUND = -32601
const RPC_INTERNAL_ERROR = -32603

/** 默认 profile 根的**目录名**（相对助手 cwd，即扩展的 data 目录）——语义收窄，取值不变 */
const DEFAULT_PROFILE_ROOT = 'chrome'
/** 删除中转区（规格 §14.3：先原子 rename 再删，半删只可能落在中转区里） */
const TRASH_DIR = '.trash'
/** 改名两阶段 intent 文件（规格 §14.2：`fs.rename` 与 `db.update` 之间没有事务） */
const PENDING_MOVE = '.pending-move.json'
/** `.trash` 残留的保留期：超过 24h 的"旧会话"残留才清理（规格 §14.3 第 5 步） */
const TRASH_MAX_AGE_MS = 24 * 60 * 60 * 1000

/** `lib/profileLimit.mjs` 的绝对 URL（helper 可能以任意 cwd 启动，不能依赖相对解析） */
const PROFILE_LIMIT_URL = pathToFileURL(join(__dirname, 'lib', 'profileLimit.mjs')).href
/** `lib/profileRoot.mjs`（根校验 / 标记 / 迁移判据的**唯一**实现，助手与扩展入口共用） */
const PROFILE_ROOT_URL = pathToFileURL(join(__dirname, 'lib', 'profileRoot.mjs')).href

/** 惰性加载纯模块（CJS 不能静态 import ESM；用绝对 URL 避免 cwd 影响） */
let profileLimitModule = null
async function profileLimit() {
  if (!profileLimitModule) profileLimitModule = await import(PROFILE_LIMIT_URL)
  return profileLimitModule
}

let profileRootModule = null
async function profileRootLib() {
  if (!profileRootModule) profileRootModule = await import(PROFILE_ROOT_URL)
  return profileRootModule
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

/** 默认 profile 根目录绝对路径（`<cwd>/chrome`；不传 `root` 时的一切行为都与 1.0.2 一致） */
function defaultRootDir() {
  return join(process.cwd(), DEFAULT_PROFILE_ROOT)
}

/**
 * 解析**生效根**（规格 §9.2 R-4）。
 *
 * - `params.root` 缺省/空 ⇒ 默认根 `<cwd>/chrome`（**既有行为一字不变**，钉在 `test/helper.test.js`）；
 * - 非空 ⇒ 必须是绝对路径、规范化后**不是盘符根也不是 UNC 根**（复用 `lib/profileRoot.mjs`
 *   的 V2–V5，与扩展侧的设置校验同一份实现），否则抛 `[profile-root-invalid]`（`-32602`）。
 *
 * 这是**第一道防线（路径校验）在助手侧的落点**；扩展侧已查过一次，这里是双保险
 * （规格 §9.2 R-4 的"两层校验"精神）。
 * @param {{ root?: unknown }} [params]
 * @returns {Promise<string>}
 */
async function resolveRoot(params = {}) {
  const raw = params && params.root !== undefined && params.root !== null ? String(params.root) : ''
  if (!raw.trim()) return defaultRootDir()
  const lib = await profileRootLib()
  const normalized = lib.normalizeRoot(raw)
  if (normalized.kind === 'invalid') {
    throw new Error(`[profile-root-invalid] ${normalized.reason}: ${raw}`)
  }
  if (normalized.kind === 'default') return defaultRootDir()
  return normalized.root
}

/** 该根是否是默认根（大小写/分隔符不敏感） */
async function isDefaultRoot(root) {
  const lib = await profileRootLib()
  return lib.samePath(root, defaultRootDir())
}

/** 读取根下的标记文件（返回原始文本或 null；不抛错）。文件名来自 `lib/profileRoot.mjs`。 */
async function readMarkerText(root) {
  const lib = await profileRootLib()
  const file = join(root, lib.ROOT_MARKER)
  if (!existsSync(file)) return null
  try {
    return readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

/**
 * **第二道防线（标记文件）的落点**：自定义根缺标记 ⇒ 拒绝会**动数据**的动作。
 *
 * 默认根**豁免**（规格 §9.3 的"默认根天然可信的例外"：它由扩展自建且永远位于扩展目录之内，
 * 卸载会整体删除，不存在删到别人数据的可能）。
 *
 * @param {string} root 生效根
 * @param {'删除'|'清理'|'改名'} action 面向用户的动作名（进错误文案）
 */
async function assertManagedRoot(root, action) {
  if (await isDefaultRoot(root)) return
  const lib = await profileRootLib()
  const marker = lib.readMarker(await readMarkerText(root))
  if (marker) return
  throw new Error(
    `[profile-root-unmarked] 目录 ${root} 不是本扩展管理的目录（缺少 ${lib.ROOT_MARKER}），已拒绝${action}`
  )
}

/**
 * 把目录名解析成**必定位于生效根之内**的绝对路径
 * —— **第三道防线（永不删根）的落点**：`assertProfileName` 挡住 `..` / 分隔符 / `.trash`，
 * 拼接后再用 `relative()` 复核不越界（规格 R-5，这条**不得弱化**）。
 * @param {unknown} value
 * @param {string} root 生效根（绝对路径）
 */
function profilePath(value, root) {
  const name = assertProfileName(value)
  const base = root || defaultRootDir()
  const target = join(base, name)
  const rel = relative(base, target)
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
async function probe(params = {}) {
  const detected = await detectChrome()
  const root = await resolveRoot(params)
  return {
    cwd: process.cwd(),
    node: process.versions.node,
    electron: process.versions.electron ?? null,
    runAsNode: process.env.ELECTRON_RUN_AS_NODE ?? null,
    platform: process.platform,
    // 规格 §16：字段名与形状不变，**值**改为生效根的绝对路径
    profileRoot: root,
    profileRootIsDefault: await isDefaultRoot(root),
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
 * `--user-data-dir` 的值防护（规格 §11.2 第 4 条，**被本需求修订**：见 §9.2 R-6 / D15）。
 *
 * 接受**两种形态**（放宽的只是"字面形态"，**没有放宽**"只能操作生效根之下的子目录"）：
 * ① 相对 `chrome/<单层目录名>`（默认根语义，分支**逐字保留** 1.0.2 的实现）；
 * ② **绝对路径且恰好等于 `join(生效根, <单层目录名>)`**（自定义根语义，规格 §9.2 末的裁定）；
 * ③ 其它绝对路径一律拒绝（`-32602`）——这是"越界防护"的核心，**不得弱化**。
 *
 * @param {unknown} value
 * @param {string} root 生效根（绝对路径）
 */
function resolveUserDataDir(value, root) {
  const base = root || defaultRootDir()
  const text = String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
  if (!text) throw new Error('--user-data-dir 不能为空')

  // ② 绝对形态：必须恰好是 <生效根>/<单层名>
  if (isAbsolute(text) || /^[a-zA-Z]:/.test(text) || text.startsWith('/')) {
    const parts = text.split('/').filter((part) => part !== '')
    const name = parts.length ? parts[parts.length - 1] : ''
    if (!name) throw new Error(`--user-data-dir 必须是绝对路径且位于生效根之内: ${text}`)
    const expected = profilePath(name, base).split(sep).join('/')
    const actual = text.replace(/\/+$/, '')
    if (actual.toLowerCase() !== expected.toLowerCase()) {
      throw new Error(
        `--user-data-dir 只允许 chrome/<单层目录名> 形态或 <生效根>/<单层目录名> 形态: ${text}`
      )
    }
    return expected.split('/').join(sep)
  }

  // ① 相对形态（默认根；既有分支一字不变）
  const parts = text.split('/').filter((part) => part !== '')
  if (parts.length !== 2 || parts[0] !== DEFAULT_PROFILE_ROOT) {
    throw new Error(`--user-data-dir 只允许 chrome/<单层目录名> 形态: ${text}`)
  }
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error(`--user-data-dir 不能含 . / .. : ${text}`)
  }
  const name = assertProfileName(parts[1])
  return profilePath(name, base).split('/').join(sep)
}

/**
 * 校验并归一 `launch` 的 args（规格 §11.2 的 5 条；扩展侧已校验一次，这里是第二层）。
 * @param {unknown} rawArgs
 * @param {string} root 生效根
 * @returns {{ args: string[], userDataDir: string }}
 */
function validateLaunchArgs(rawArgs, root) {
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
      userDataDir = resolveUserDataDir(raw.slice('--user-data-dir='.length), root)
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
 * `launch { args, root? }`：探测 Chrome → 校验白名单 → `spawn(exe, args)` detached 并 unref。
 *
 * ⚠️ **不接受 `exe` 入参**：只可能启动探测到的 Chrome（规格 §16 的硬要求——绝不回退 Edge，
 * 也不接受任意可执行文件）。
 */
async function launch(params = {}) {
  const root = await resolveRoot(params)
  const { args, userDataDir } = validateLaunchArgs(params.args, root)
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

/** `profileStatus { name, root? }`：目录是否存在 / 是否可能被占用（`locked` 只是启发式） */
async function profileStatus(params = {}) {
  const root = await resolveRoot(params)
  const name = assertProfileName(params.name)
  const dir = profilePath(name, root)
  const exists = existsSync(dir)
  return { name, dir, root, exists, locked: exists ? looksLocked(dir) : false }
}

/** 读 `<root>/.pending-move.json`（两阶段 intent；读不到/不合法都返回 null） */
function readPendingMove(root) {
  const file = join(root || defaultRootDir(), PENDING_MOVE)
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
 * `moveProfile { from, to, root? }`：改名搬目录（规格 §14.2 的两阶段 intent）。
 * 源不存在 → `{ missing: true }`（不是错误：无需移动，直接落库）。
 *
 * ⚠️ **前置新增**（规格 §9.3 矩阵 / R-10）：生效根缺标记且不是默认根 ⇒ 拒绝
 * （改名会**移动数据**，与删除同等级）。
 */
async function moveProfile(params = {}) {
  const root = await resolveRoot(params)
  const fromName = assertProfileName(params.from)
  const toName = assertProfileName(params.to)
  const from = profilePath(fromName, root)
  const to = profilePath(toName, root)

  if (fromName === toName) return { moved: false, from, to, sameName: true }
  if (!existsSync(from)) return { moved: false, from, to, missing: true }
  await assertManagedRoot(root, '改名')
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
 * `removeProfile { name, root? }`：**先原子 rename 进 `.trash/`**，再递归删除（规格 §14.3）。
 * 目录不存在 → `{ removed: false }`（不是错误）。
 *
 * ⚠️ **前置新增第 0 步**（规格 §9.3 矩阵 / R-10）：生效根缺标记且不是默认根 ⇒
 * 抛 `[profile-root-unmarked]`（`-32603`），**不执行任何 rename/rm**。
 * 这是"指向真实 Chrome profile 时一次误操作就毁掉登录态"的唯一闸门。
 */
async function removeProfile(params = {}) {
  const root = await resolveRoot(params)
  const name = assertProfileName(params.name)
  const dir = profilePath(name, root)
  if (!existsSync(dir)) return { removed: false, dir, name }
  await assertManagedRoot(root, '删除')

  const trashRoot = join(root, TRASH_DIR)
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
function cleanTrash(maxAgeMs = TRASH_MAX_AGE_MS, root = '') {
  const trashRoot = join(root || defaultRootDir(), TRASH_DIR)
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

/**
 * 体积缓存的键：**必须带根**（规格 §9.6 的"根不入库"意味着同一个条目名在不同根下是两份数据；
 * 只用条目名当键会让"改根后立刻查体积"命中旧根的旧值）。
 * @param {string} root 生效根
 * @param {string} name 条目目录名
 */
function sizeCacheKey(root, name) {
  return `${String(root ?? '').toLowerCase()}\u0000${name}`
}

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
  const root = await resolveRoot(params)
  const name = assertProfileName(params.name)
  const dir = profilePath(name, root)
  const limit = await profileLimit()
  const ttlMs = Number.isFinite(Number(params.ttlMs))
    ? Number(params.ttlMs)
    : limit.PROFILE_SIZE_TTL_MS
  const now = Date.now()

  const cacheKey = sizeCacheKey(root, name)

  if (!existsSync(dir)) {
    sizeCache.delete(cacheKey)
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

  const cached = sizeCache.get(cacheKey)
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
  sizeCache.set(cacheKey, record)
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
 * `cleanCaches { name?, root? }`（规格 §11.2 / §14.5）：**只删缓存类子目录**。
 *
 * - `name` 省略 = 遍历**生效根**下的全部条目（不是默认根）；
 * - 删的是白名单目录（8 个固定目录名、大小写不敏感、深度 ≤ 2），整体 `rm(recursive, force)`；
 * - 保留清单（Cookie / Login Data / Local Storage / IndexedDB / Service Worker / Preferences /
 *   History / Bookmarks …）**永不进删除路径**（`classifyCachePath` 的纯函数判定是唯一入口）；
 * - 单目录失败只记入 `skipped[]`，**不抛错**（与 `deleteCredential` 的"缺条目不算失败"同口径）；
 * - **新增第 0 道防线**（规格 §9.3 矩阵 / R-12）：生效根缺标记且非默认根 ⇒ **整体拒绝**，
 *   返回 `refused` 字段而**不抛错**（与"单目录失败进 skipped"同口径）；
 * - 成功后**清空整个体积缓存 Map**（失效条件 ③）。
 *
 * @returns {Promise<{ cleaned: Array<{ name: string, freedBytes: number, removedDirs: string[] }>,
 *   totalFreedBytes: number, skipped: Array<{ name: string, reason: string }>, refused?: string }>}
 */
async function cleanCaches(params = {}) {
  const limit = await profileLimit()
  const root = await resolveRoot(params)

  // 第 0 道防线：缺标记（且非默认根）⇒ 一个字节都不删，如实回报原因
  if (!(await isDefaultRoot(root))) {
    const lib = await profileRootLib()
    if (!lib.readMarker(await readMarkerText(root))) {
      const refused = `[profile-root-unmarked] 目录 ${root} 不是本扩展管理的目录（缺少 ${lib.ROOT_MARKER}），已拒绝清理`
      process.stderr.write(`[webapp-helper] ${refused}\n`)
      return { cleaned: [], totalFreedBytes: 0, skipped: [], refused }
    }
  }

  const targets = []
  if (params.name === undefined || params.name === null || params.name === '') {
    for (const entry of safeReaddir(root)) {
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
    const dir = profilePath(name, root)
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
// 根状态 / 建根写标记 / 候选根判定 / 逐目录迁移（规格 §9.5.2：4 个新方法）
// ---------------------------------------------------------------------------

/** 根下的**目录名**列表（排除 `.trash` 与一切非目录项；排序后返回） */
function listEntryDirs(root) {
  const names = []
  for (const entry of safeReaddir(root)) {
    if (!entry.isDirectory()) continue
    if (entry.name === TRASH_DIR) continue
    names.push(entry.name)
  }
  return names.sort()
}

/**
 * `profileRootStatus { root? }`（规格 §9.5.2）：根的受管状态与条目目录清单。
 * 纯只读：不创建、不写标记、不删任何东西。
 *
 * @returns {Promise<{ root: string, isDefault: boolean, exists: boolean, marked: boolean,
 *   unmanaged: boolean, isDirectory: boolean, marker: object|null, legacyPendingMove: object|null,
 *   entries: string[] }>}
 */
async function profileRootStatus(params = {}) {
  const lib = await profileRootLib()
  const root = await resolveRoot(params)
  const isDefault = await isDefaultRoot(root)
  let isDirectory = false
  let exists = false
  try {
    const info = statSync(root)
    exists = true
    isDirectory = info.isDirectory()
  } catch {
    exists = false
  }
  const marker = lib.readMarker(await readMarkerText(root))
  const marked = marker !== null
  return {
    root,
    isDefault,
    exists,
    isDirectory,
    marked,
    // 默认根天然可信 ⇒ 它永远不算"未受管"（规格 §9.3）
    unmanaged: !isDefault && !marked,
    marker,
    legacyPendingMove: exists && isDirectory ? readPendingMove(root) : null,
    entries: exists && isDirectory ? listEntryDirs(root) : []
  }
}

/**
 * `prepareRoot { root, dataDir? }`（规格 §9.5.2）：**幂等**地建目录 + 写/刷新标记 + 建 `.trash`。
 *
 * 这是"目标根必须有标记"的落点：写标记失败 ⇒ 抛 `[profile-root-create-failed]`（`-32603`），
 * 调用方据此**不开始迁移**。
 *
 * `dataDir`（扩展 data 目录绝对路径）**可选**：助手不知道宿主把扩展装在哪儿，
 * 由扩展入口传进来即可启用 V6（"不能指向扩展的数据目录"）。不传则跳过 V6（助手侧无法判定）。
 *
 * @returns {Promise<{ root: string, created: boolean, marked: boolean }>}
 */
async function prepareRoot(params = {}) {
  const lib = await profileRootLib()
  const root = await resolveRoot(params)
  const dataProblem = lib.checkNotDataDir(root, params.dataDir ?? '')
  if (dataProblem) {
    throw new Error(`[profile-root-invalid] ${dataProblem.reason}: ${root}`)
  }
  const existed = existsSync(root)
  try {
    mkdirSync(root, { recursive: true })
    mkdirSync(join(root, TRASH_DIR), { recursive: true })
  } catch (err) {
    throw new Error(`[profile-root-create-failed] 无法创建根目录 ${root}：${messageOfError(err)}`)
  }
  try {
    writeFileSync(
      join(root, lib.ROOT_MARKER),
      `${JSON.stringify(lib.createMarker({ root }), null, 2)}\n`,
      'utf8'
    )
  } catch (err) {
    throw new Error(`[profile-root-create-failed] 无法创建根目录 ${root}：${messageOfError(err)}`)
  }
  return { root, created: !existed, marked: true }
}

/** 候选路径的父目录（UNC 也按 `dirname` 的口径；仅用于降级路径的提示） */
function parentOf(candidate) {
  const text = String(candidate ?? '').trim()
  if (!text) return null
  const idx = Math.max(text.lastIndexOf('\\'), text.lastIndexOf('/'))
  if (idx <= 0) return null
  return text.slice(0, idx)
}

/**
 * `checkRootCandidate { candidate }`（规格 §9.5.2 / §7.4）：
 * **纯只读**——判"是不是目录"、跑一遍 V1–V5、给出 UNC 警告；**不创建、不写标记、不删任何东西**。
 *
 * 为什么必须在助手侧判"是不是目录"：候选根在**扩展目录之外**（规格 §7.4 的注），
 * 扩展入口没有 `node:fs`，`api.fs` 只覆盖 data 目录 ⇒ 只有助手能 `stat` 它。
 */
async function checkRootCandidate(params = {}) {
  const lib = await profileRootLib()
  const candidate =
    params.candidate === undefined || params.candidate === null ? '' : String(params.candidate)
  let isDirectory = false
  let exists = false
  if (candidate.trim()) {
    try {
      const info = statSync(candidate.trim())
      exists = true
      isDirectory = info.isDirectory()
    } catch {
      exists = false
    }
  }
  const verdict = lib.checkCandidateRoot({
    candidate,
    isDirectory,
    parent: parentOf(candidate),
    dataDir: params.dataDir ?? ''
  })
  return { ...verdict, exists }
}

/** 复制整棵目录树（跨卷路径；不覆盖已存在的目标文件——目标在复制前已确认不存在或是被清掉的旧目录） */
function copyDirTree(source, target) {
  mkdirSync(target, { recursive: true })
  for (const entry of safeReaddir(source)) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) {
      copyDirTree(from, to)
      continue
    }
    if (entry.isFile()) {
      copyFileSync(from, to)
      continue
    }
    // 符号链接等其它类型：跳过（Chrome profile 里不该有；如实记录到 stderr）
    process.stderr.write(`[webapp-helper] 跳过非普通文件 ${from}\n`)
  }
}

/** 关键文件的候选位置（相对 profile 目录；按 Chrome 的实际布局给出四种） */
const PREFERENCES_PATHS = [['Default', 'Preferences'], ['Preferences']]
const COOKIES_PATHS = [
  ['Default', 'Network', 'Cookies'],
  ['Default', 'Cookies'],
  ['Network', 'Cookies'],
  ['Cookies']
]

/** 在一组候选位置里找**实际存在**的第一个（找不到返回 null） */
function findExistingPath(root, candidates) {
  for (const parts of candidates) {
    const full = join(root, ...parts)
    if (existsSync(full)) return parts.join('/')
  }
  return null
}

/** 关键文件的判定（返回相对路径或 null） */
function keyFilePaths(dir) {
  return {
    preferences: findExistingPath(dir, PREFERENCES_PATHS),
    cookies: findExistingPath(dir, COOKIES_PATHS)
  }
}

/**
 * `migrateRootDir { from, to, name, action, overwrite?, forceCopy? }`（规格 §9.5.2 / §9.4）。
 *
 * `action='probe'` ⇒ 只探测（源/目标是否存在、体积、是否同卷、是否冲突），**不动任何数据**；
 * `action='move'`  ⇒ 执行**一个**条目目录的搬运，失败**不抛错**而是回 `status:'failed'`
 *   （与 `cleanCaches` 的单目录失败同口径，便于扩展侧逐条记录并继续）。
 *
 * 执行顺序（不可颠倒，规格 §9.4）：
 *   `prepareRoot` 语义的"目标根必须有标记" → 删除目标同名目录（仅在 `overwrite === true`）→
 *   复制/移动源 → **C1–C5 完整性判据** → 删源。
 *
 * ⚠️ **覆盖由扩展侧显式传入**：`overwrite !== true` 且目标存在 ⇒ 返回
 * `status:'skipped'` + `[migrate-overwrite-unconfirmed]`，**一个字节都不删**
 * （助手不自行决定覆盖，规格 §9.5.2 的硬要求）。
 */
async function migrateRootDir(params = {}) {
  const lib = await profileRootLib()
  const from = String(params.from ?? '').trim()
  const to = String(params.to ?? '').trim()
  const name = assertProfileName(params.name)
  const action = String(params.action ?? '').trim()

  if (!from || !isAbsolute(from))
    throw new Error(`[profile-root-invalid] from 必须是绝对路径: ${from}`)
  if (!to || !isAbsolute(to)) throw new Error(`[profile-root-invalid] to 必须是绝对路径: ${to}`)
  if (action !== 'probe' && action !== 'move') {
    throw new Error(`migrateRootDir 的 action 必须是 probe 或 move（收到 ${action}）`)
  }

  const fromRoot = lib.canonicalRoot(from)
  const toRoot = lib.canonicalRoot(to)
  if (lib.samePath(fromRoot, toRoot)) {
    throw new Error('[profile-root-invalid] from 与 to 不能是同一个目录')
  }
  // **永不删根**（第三道防线）：根本身永远不是迁移单元，只搬根之下的一层子目录
  const sourceDir = profilePath(name, fromRoot)
  const targetDir = profilePath(name, toRoot)

  let sourceIsDir = false
  let targetIsDir = false
  try {
    sourceIsDir = statSync(sourceDir).isDirectory()
  } catch {
    sourceIsDir = false
  }
  try {
    targetIsDir = statSync(targetDir).isDirectory()
  } catch {
    targetIsDir = false
  }
  const source = sourceIsDir ? measureDir(sourceDir) : { files: 0, bytes: 0 }
  const target = targetIsDir ? measureDir(targetDir) : { files: 0, bytes: 0 }
  const sameVolume = lib.volumeOf(sourceDir) === lib.volumeOf(targetDir)
  const conflict = sourceIsDir && targetIsDir

  if (action === 'probe') {
    return {
      name,
      source: { exists: sourceIsDir, files: source.files, bytes: source.bytes },
      target: { exists: targetIsDir, files: target.files, bytes: target.bytes },
      sameVolume,
      conflict
    }
  }

  const overwrite = params.overwrite === true
  const decided = lib.decideMigrationItem(
    { exists: sourceIsDir },
    { exists: targetIsDir },
    { overwrite, confirmed: overwrite }
  )
  if (decided.action === 'missing') {
    return {
      name,
      status: 'missing',
      reason: decided.reason,
      overwritten: false,
      targetRemoved: false,
      files: 0,
      bytes: 0,
      copiedFiles: 0,
      copiedBytes: 0,
      crossVolume: !sameVolume
    }
  }
  if (decided.action === 'done') {
    return {
      name,
      status: 'done',
      reason: decided.reason,
      overwritten: false,
      targetRemoved: false,
      files: 0,
      bytes: 0,
      copiedFiles: target.files,
      copiedBytes: target.bytes,
      crossVolume: !sameVolume
    }
  }
  if (decided.action === 'skipped') {
    return {
      name,
      status: 'skipped',
      reason: decided.reason,
      overwritten: false,
      targetRemoved: false,
      files: source.files,
      bytes: source.bytes,
      copiedFiles: 0,
      copiedBytes: 0,
      crossVolume: !sameVolume
    }
  }

  const overwriting = decided.action === 'overwritten'
  let targetRemoved = false

  // ① 覆盖：**先删目标同名目录，删不掉就绝不复制**（避免两份数据混在一起，规格 §9.4）
  if (overwriting) {
    try {
      clearReadonly(targetDir)
      removeDir(targetDir)
      targetRemoved = true
    } catch (err) {
      const reason = `[migrate-overwrite-failed] ${name}：无法删除目标同名目录 ${targetDir}（${messageOfError(err)}）`
      process.stderr.write(`[webapp-helper] ${reason}\n`)
      return {
        name,
        status: 'failed',
        reason,
        overwritten: false,
        targetRemoved: false,
        files: source.files,
        bytes: source.bytes,
        copiedFiles: 0,
        copiedBytes: 0,
        crossVolume: !sameVolume
      }
    }
  }

  // ② 搬运：同卷优先 `rename`（毫秒级）；跨卷或 `forceCopy` ⇒ 复制 → 校验 → 删源
  const forceCopy = params.forceCopy === true
  let crossVolume = !sameVolume || forceCopy
  let copiedFiles = 0
  let copiedBytes = 0
  if (!crossVolume) {
    try {
      renameSync(sourceDir, targetDir)
    } catch (err) {
      // `EXDEV` = 跨卷（同一盘符的不同挂载点也会出现）⇒ 退回复制路径；其余错误如实上报
      if (err && err.code === 'EXDEV') {
        crossVolume = true
      } else {
        const busy = err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')
        const reason = busy
          ? `[profile-busy] ${name}：窗口正开着（待续做）——${messageOfError(err)}`
          : `[migrate-failed] ${name}：${messageOfError(err)}`
        process.stderr.write(`[webapp-helper] ${reason}\n`)
        return {
          name,
          status: 'failed',
          reason,
          overwritten: overwriting,
          targetRemoved,
          files: source.files,
          bytes: source.bytes,
          copiedFiles: 0,
          copiedBytes: 0,
          crossVolume: false
        }
      }
    }
  }

  if (crossVolume) {
    try {
      mkdirSync(toRoot, { recursive: true })
      copyDirTree(sourceDir, targetDir)
    } catch (err) {
      const busy = err && (err.code === 'EBUSY' || err.code === 'EPERM' || err.code === 'EACCES')
      const reason = busy
        ? `[profile-busy] ${name}：窗口正开着（待续做）——${messageOfError(err)}`
        : `[migrate-failed] ${name}：${messageOfError(err)}`
      process.stderr.write(`[webapp-helper] ${reason}\n`)
      return {
        name,
        status: 'failed',
        reason,
        overwritten: overwriting,
        targetRemoved,
        files: source.files,
        bytes: source.bytes,
        copiedFiles: 0,
        copiedBytes: 0,
        crossVolume: true
      }
    }
    const measured = measureDir(targetDir)
    copiedFiles = measured.files
    copiedBytes = measured.bytes
  }

  // ③ **先校验、后删源**（C1–C5）：目标必须真的完整，否则源保留
  const sourceKeys = keyFilePaths(sourceDir)
  const targetKeys = keyFilePaths(targetDir)
  const measuredTarget = crossVolume
    ? { files: copiedFiles, bytes: copiedBytes }
    : measureDir(targetDir)
  const verdict = lib.verifyMigration({
    sourceFiles: source.files,
    sourceBytes: source.bytes,
    targetFiles: measuredTarget.files,
    targetBytes: measuredTarget.bytes,
    targetIsDirectory: existsSync(targetDir),
    targetHasPreferences: targetKeys.preferences !== null,
    targetHasCookies: targetKeys.cookies !== null,
    sourceHasPreferences: sourceKeys.preferences !== null,
    sourceHasCookies: sourceKeys.cookies !== null
  })
  if (!verdict.ok) {
    // 源**已移动**（rename 路径）时不可能不通过校验；跨卷路径不通过 ⇒ 目标残缺，源仍在
    const reason = `[migrate-verify-failed] ${name}：${verdict.reason}`
    process.stderr.write(`[webapp-helper] ${reason}\n`)
    return {
      name,
      status: 'failed',
      reason,
      overwritten: overwriting,
      targetRemoved,
      files: source.files,
      bytes: source.bytes,
      copiedFiles: measuredTarget.files,
      copiedBytes: measuredTarget.bytes,
      crossVolume
    }
  }

  // ④ 通过校验才删源（跨卷路径；rename 路径源已经不在原处了）
  if (crossVolume) {
    try {
      clearReadonly(sourceDir)
      removeDir(sourceDir)
    } catch (err) {
      const reason = `[migrate-failed] ${name}：已复制并校验通过，但无法删除源目录 ${sourceDir}（${messageOfError(err)}）`
      process.stderr.write(`[webapp-helper] ${reason}\n`)
      return {
        name,
        status: 'failed',
        reason,
        overwritten: overwriting,
        targetRemoved,
        files: source.files,
        bytes: source.bytes,
        copiedFiles: measuredTarget.files,
        copiedBytes: measuredTarget.bytes,
        crossVolume
      }
    }
  }

  const status = overwriting ? 'overwritten' : 'done'
  process.stderr.write(
    `[webapp-helper] 迁移 ${name}：${status}（files=${source.files} bytes=${source.bytes} 跨卷=${crossVolume} 覆盖=${overwriting}）\n`
  )
  return {
    name,
    status,
    reason: '',
    overwritten: overwriting,
    targetRemoved,
    files: source.files,
    bytes: source.bytes,
    copiedFiles: crossVolume ? measuredTarget.files : source.files,
    copiedBytes: crossVolume ? measuredTarget.bytes : source.bytes,
    crossVolume
  }
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
  cleanCaches,
  profileRootStatus,
  prepareRoot,
  checkRootCandidate,
  migrateRootDir
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
  //
  // 新增前缀的分派（规格 §9.2 R-14 / §9.9）：`[profile-root-invalid]` 与
  // `[profile-root-candidate-invalid]` ⇒ -32602；`[profile-root-unmarked]` /
  // `[profile-root-create-failed]` / `[migrate-*]` ⇒ **不在本表里** ⇒ -32603（底层失败）。
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
    'cleanCaches',
    '[profile-root-invalid]',
    '[profile-root-candidate-invalid]',
    '根目录',
    'migrateRootDir'
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
  const profile = join(root, DEFAULT_PROFILE_ROOT, name)
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
  const lib = await profileRootLib()
  const previousCwd = process.cwd()
  try {
    makeFakeProfile(dir, '示例站点')
    process.chdir(dir)
    const profileDir = join(dir, DEFAULT_PROFILE_ROOT, '示例站点')

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
    const status = await profileStatus({ name: '示例站点' })
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
    const moved = await moveProfile({ from: '示例站点', to: '示例站点-新' })
    assert.equal(moved.moved, true)
    assert.ok(existsSync(join(dir, DEFAULT_PROFILE_ROOT, '示例站点-新')), '目标目录应存在')
    assert.ok(!existsSync(join(dir, DEFAULT_PROFILE_ROOT, '示例站点')), '源目录应消失')
    assert.ok(!existsSync(join(dir, DEFAULT_PROFILE_ROOT, PENDING_MOVE)), 'intent 文件应被清理')
    assert.equal(
      (await moveProfile({ from: '不存在', to: '随便' })).missing,
      true,
      '源不存在应返回 missing'
    )

    // ⑥ 删除（进 .trash 后清理）
    const removedProfile = await removeProfile({ name: '示例站点-新' })
    assert.equal(removedProfile.removed, true)
    assert.ok(!existsSync(join(dir, DEFAULT_PROFILE_ROOT, '示例站点-新')), '目录应消失')

    // ⑦ .trash 清理只删"旧会话"残留
    const trashRoot = join(dir, DEFAULT_PROFILE_ROOT, TRASH_DIR)
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

    // ⑨ probe（**不启动 Chrome**）：候选恒为 4 项、顺序固定；`profileRoot` = 生效根
    const info = await probe()
    assert.equal(typeof info.cwd, 'string')
    assert.equal(info.chromeCandidates.length, 4, 'chromeCandidates 必须恒为 4 项')
    assert.deepEqual(
      info.chromeCandidates.map((item) => item.source),
      ['programfiles', 'programfiles-x86', 'localappdata', 'registry'],
      '探测顺位必须固定'
    )
    assert.ok(info.chrome === null || typeof info.chrome.path === 'string')
    assert.equal(
      info.profileRoot,
      join(dir, DEFAULT_PROFILE_ROOT),
      '不传 root 时 profileRoot = 默认根'
    )
    assert.equal(info.profileRootIsDefault, true)

    // ⑩ 自定义根：体积 / 清理 / 缺标记拒删（规格 §9.1 V1–V7、§9.3 矩阵、R-15）
    const customRoot = join(dir, '自定义根')
    mkdirSync(customRoot, { recursive: true })
    mkdirSync(join(customRoot, '站点C', 'Default', 'Cache'), { recursive: true })
    writeFileSync(join(customRoot, '站点C', 'Default', 'Cookies'), 'cookie-c', 'utf8')
    writeFileSync(join(customRoot, '站点C', 'Default', 'Preferences'), '{"x":1}', 'utf8')
    writeFileSync(join(customRoot, '站点C', 'Default', 'Cache', 'blob'), 'B'.repeat(128), 'utf8')

    const customStatus = await profileRootStatus({ root: customRoot })
    assert.equal(customStatus.isDefault, false)
    assert.equal(customStatus.exists, true)
    assert.equal(customStatus.marked, false, '未写标记 ⇒ marked:false')
    assert.equal(customStatus.unmanaged, true, '自定义根缺标记 ⇒ unmanaged:true')
    assert.deepEqual(customStatus.entries, ['站点C'], 'entries 只含目录')

    const customSize = await profileSize({ name: '站点C', root: customRoot })
    assert.equal(customSize.exists, true, '自定义根的体积必须能量出来（只读，不受标记门禁影响）')
    assert.equal(customSize.dir, join(customRoot, '站点C'))
    assert.ok(customSize.bytes > 0)

    // 缺标记 ⇒ 删除被拒（`-32603`），且目录**逐字节未变**
    await assert.rejects(
      () => removeProfile({ name: '站点C', root: customRoot }),
      (err) => err.message.includes('[profile-root-unmarked]')
    )
    assert.ok(existsSync(join(customRoot, '站点C', 'Default', 'Cookies')), '被拒的删除不得动数据')

    // 缺标记 ⇒ 清理整体拒绝（返回 refused，**不抛错**），Cache 目录仍在
    const refused = await cleanCaches({ name: '站点C', root: customRoot })
    assert.match(String(refused.refused), /\[profile-root-unmarked\]/)
    assert.deepEqual(refused.cleaned, [])
    assert.ok(existsSync(join(customRoot, '站点C', 'Default', 'Cache')), '被拒的清理不得动数据')

    // prepareRoot 幂等：第一次 created:true，第二次 created:false，标记文件仍只有一个
    const prepared1 = await prepareRoot({ root: customRoot })
    assert.deepEqual(prepared1, { root: customRoot, created: false, marked: true })
    const prepared2 = await prepareRoot({ root: customRoot })
    assert.equal(prepared2.created, false)
    assert.ok(existsSync(join(customRoot, lib.ROOT_MARKER)), '标记文件必须已写出')
    assert.deepEqual(
      Object.keys(JSON.parse(readFileSync(join(customRoot, lib.ROOT_MARKER), 'utf8'))).sort(),
      ['createdAt', 'extId', 'marker', 'root', 'version'],
      '标记内容字段集合必须恰好是五字段（P3）'
    )

    // 写标记后 ⇒ 门禁放行（清理真的删掉了白名单缓存目录）
    const allowed = await cleanCaches({ name: '站点C', root: customRoot })
    assert.equal(allowed.refused, undefined)
    assert.ok(allowed.cleaned[0].removedDirs.includes('Default/Cache'), '有标记后清理应生效')
    assert.ok(existsSync(join(customRoot, '站点C', 'Default', 'Cookies')), 'Cookies 必须保留')

    // `checkRootCandidate` 纯只读：传目录 ⇒ isDirectory:true；传文件 ⇒ isDirectory:false + parent
    const someFile = join(dir, 'a-file.txt')
    writeFileSync(someFile, 'x', 'utf8')
    const beforeEntries = readdirSync(customRoot).length
    const dirVerdict = await checkRootCandidate({ candidate: join(dir, '文件当候选') })
    assert.equal(dirVerdict.isDirectory, false)
    assert.equal(dirVerdict.invalid, null, '不存在的绝对路径仍可通过校验（V7 允许创建）')
    const fileVerdict = await checkRootCandidate({ candidate: someFile })
    assert.equal(fileVerdict.isDirectory, false)
    assert.equal(fileVerdict.parent, dir, '选到文件时 parent = 其父目录')
    const relativeVerdict = await checkRootCandidate({ candidate: 'chrome' })
    assert.match(String(relativeVerdict.invalid?.reason), /绝对路径/)
    const driveVerdict = await checkRootCandidate({ candidate: 'C:\\' })
    assert.match(String(driveVerdict.invalid?.reason), /磁盘根目录/)
    assert.equal(readdirSync(customRoot).length, beforeEntries, 'checkRootCandidate 不得写任何东西')

    // 在**给定的根**里造一个"看起来像 Chrome profile"的条目目录
    // ⚠️ 不能复用 `makeFakeProfile`：它在根下多套一层 `chrome/`，而迁移是在**根**这一层
    // 逐条目目录进行的（`<根>/<条目名>`）。
    const makeEntryInRoot = (root, name) => {
      const profile = join(root, name)
      mkdirSync(join(profile, 'Default', 'Cache'), { recursive: true })
      mkdirSync(join(profile, 'Default', 'Local Storage'), { recursive: true })
      writeFileSync(join(profile, 'Default', 'Cookies'), 'cookie', 'utf8')
      writeFileSync(join(profile, 'Default', 'Preferences'), '{"a":1}', 'utf8')
      writeFileSync(join(profile, 'Default', 'Cache', 'blob'), 'C'.repeat(512), 'utf8')
      return profile
    }

    // `migrateRootDir`：probe → move（同卷 + forceCopy 两条路径）
    for (const forceCopy of [false, true]) {
      const fromRoot = join(dir, forceCopy ? '迁移源-复制' : '迁移源-改名')
      const toRoot = join(dir, forceCopy ? '迁移目标-复制' : '迁移目标-改名')
      makeEntryInRoot(fromRoot, '迁移条目')
      mkdirSync(toRoot, { recursive: true })
      const probeResult = await migrateRootDir({
        from: fromRoot,
        to: toRoot,
        name: '迁移条目',
        action: 'probe'
      })
      assert.equal(
        probeResult.source.exists,
        true,
        `迁移源必须能被探测到：${JSON.stringify(probeResult)}`
      )
      assert.equal(probeResult.target.exists, false)
      assert.equal(probeResult.conflict, false)

      const moved = await migrateRootDir({
        from: fromRoot,
        to: toRoot,
        name: '迁移条目',
        action: 'move',
        forceCopy
      })
      assert.equal(moved.status, 'done', `迁移应成功（forceCopy=${forceCopy}）：${moved.reason}`)
      assert.equal(moved.overwritten, false)
      assert.ok(existsSync(join(toRoot, '迁移条目', 'Default', 'Cookies')), '目标必须有关键文件')
      assert.ok(!existsSync(join(fromRoot, '迁移条目')), '源必须已删除（先校验后删源）')
    }

    // `migrateRootDir`：目标已存在 + 未确认覆盖 ⇒ skipped，**两侧逐字节未变**
    {
      const fromRoot = join(dir, '冲突源')
      const toRoot = join(dir, '冲突目标')
      makeEntryInRoot(fromRoot, '冲突条目')
      mkdirSync(join(toRoot, '冲突条目', 'Default'), { recursive: true })
      writeFileSync(join(toRoot, '冲突条目', 'Default', 'Cookies'), '目标旧值', 'utf8')
      const sourceHash = readFileSync(join(fromRoot, '冲突条目', 'Default', 'Cookies'), 'utf8')
      const skipped = await migrateRootDir({
        from: fromRoot,
        to: toRoot,
        name: '冲突条目',
        action: 'move'
      })
      assert.equal(skipped.status, 'skipped')
      assert.match(skipped.reason, /未确认覆盖/)
      assert.equal(readFileSync(join(toRoot, '冲突条目', 'Default', 'Cookies'), 'utf8'), '目标旧值')
      assert.equal(
        readFileSync(join(fromRoot, '冲突条目', 'Default', 'Cookies'), 'utf8'),
        sourceHash
      )

      // 已确认 ⇒ 覆盖：目标旧内容消失、变成源的内容、源已删
      const overwritten = await migrateRootDir({
        from: fromRoot,
        to: toRoot,
        name: '冲突条目',
        action: 'move',
        overwrite: true
      })
      assert.equal(overwritten.status, 'overwritten')
      assert.equal(overwritten.overwritten, true)
      assert.equal(overwritten.targetRemoved, true)
      assert.equal(readFileSync(join(toRoot, '冲突条目', 'Default', 'Cookies'), 'utf8'), sourceHash)
      assert.ok(!existsSync(join(fromRoot, '冲突条目')), '覆盖后源必须已删除')
    }

    // `migrateRootDir`：目标存在、源已不存在 ⇒ 视为已搬完（断电续做的常见形态）
    {
      const fromRoot = join(dir, '续做源')
      const toRoot = join(dir, '续做目标')
      mkdirSync(fromRoot, { recursive: true })
      mkdirSync(join(toRoot, '续做条目', 'Default'), { recursive: true })
      const resumed = await migrateRootDir({
        from: fromRoot,
        to: toRoot,
        name: '续做条目',
        action: 'move'
      })
      assert.equal(resumed.status, 'done')
      assert.match(resumed.reason, /源已不存在/)
    }

    // ⚠️ **已知覆盖缺口（如实登记）**：`migrateRootDir` 的"复制完成但 C1–C5 不通过 ⇒ failed
    // 且源保留"分支需要"复制必然被截断"的故障（磁盘满 / 权限 / 目标被外力删除），
    // 纯 Node 造不出确定性场景 ⇒ 由 `test/profileRoot.test.js` 的 `verifyMigration` 纯函数
    // 表驱动用例覆盖判据本身，真机截断场景走 README 的「已知覆盖缺口」清单。

    console.log(
      `[webapp-helper] selftest 通过（临时目录 ${dir}，未启动 Chrome；缓存白名单 ${limit.CACHE_DIR_NAMES.length} 项、保留清单 ${limit.PROTECTED_DIR_NAMES.length} 项、TTL ${limit.PROFILE_SIZE_TTL_MS / 1000}s）`
    )
    return 0
  } catch (err) {
    console.error(
      `[webapp-helper] selftest 失败：${err instanceof Error ? (err.stack ?? err.message) : String(err)}`
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
