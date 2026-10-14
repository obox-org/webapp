/**
 * profile 体积上限与缓存清理规则（纯函数，零依赖；规格 §10.4 / §12.1 ⑥ / §14.5 / §14.6 / 票 11）。
 *
 * **来源**：R17「profile 体积上限」（用户指令"限制 profile 体积，别撑爆磁盘"，D-5 = 方案 1
 * 目录级节流 + 上限由用户在设置里定义）。本模块是这条需求的**纯逻辑落点**：
 * 设置归一与回落、单位换算、超限判定、缓存白名单、体积缓存的 TTL 语义、可读体积格式化。
 * 文件系统动作在 `helper.cjs`（`profileSize` / `cleanCaches`），设置项与界面在票 11 的 `src/**`。
 *
 * 三条硬约束（`test/settings.test.js` / `test/helperCache.test.js` 钉住）：
 * 1. **缓存白名单是 8 个固定目录名**（大小写不敏感精确匹配、深度 2），
 *    实现里**不得**出现"名字含 cache 就删""按体积大小选目录删"之类的启发式；
 * 2. **保留清单里的目录/文件永不进删除路径**（Cookie / Login Data / Local Storage /
 *    IndexedDB / Service Worker / Preferences / History / Bookmarks …）；
 * 3. **拿不准的不删**：白名单之外一律不动（宁可有缓存残留，也不误删登录态）。
 */

// ---------------------------------------------------------------------------
// 设置：两个 select 的枚举与归一（§10.4）
// ---------------------------------------------------------------------------

/** 设置键（必须含扩展前缀 `webapp.`）——**设置项的唯一来源**（规格 §9.1 R-23；1.0.6 起五项） */
export const SETTING_KEYS = Object.freeze({
  profileLimitMb: 'webapp.profileLimitMb',
  diskCacheMb: 'webapp.diskCacheMb',
  /** profile 根目录（`directory`，默认空串 = 用默认根 `<扩展 data>/chrome`；规格 §9.1） */
  profileRoot: 'webapp.profileRoot',
  /**
   * 迁移状态（`status`，**只读展示**；1.0.4，amendment 09 §3）。
   *
   * ⚠️ **与 `profileRoot` 必须是两个独立的键**：写它只是"显示状态"，
   * **绝不允许**触发任何"改根"逻辑（改根判定只读 `profileRoot`）。
   */
  migrationStatus: 'webapp.migrationStatus',
  /**
   * 迁移进度（`status` + **`modal: true`**；1.0.6，amendment 09 §11）。
   *
   * 宿主（obox ≥ 1.0.10）对"`type:'status'` 且 `modal:true`"的字段：**值非空 ⇒ 设置页弹出全屏遮罩**
   * （多行显示该值、无关闭按钮、Esc 无效、点遮罩无效）；**值被清空（`''`）⇒ 立刻消失**。
   * ⇒ 因此本键的**空串是唯一"关闭模态框"的信号**，写入方必须保证任何结束路径都把它清空
   * （`index.js` 的 `writeMigrationProgress` + `reconcileIntent` 的 `finally`）。
   *
   * ⚠️ 老宿主不认识 `modal`：`status` 只会渲染成一行只读文本（可接受，不影响写入逻辑）。
   * ⚠️ `default` 必须是**空串**（manifest 里写死）：空闲时不能弹模态框。
   */
  migrationProgress: 'webapp.migrationProgress'
})

/** `webapp.profileLimitMb` 的可选档位（MB）；`0` = 不预检、不拦截 */
export const PROFILE_LIMIT_MB_VALUES = Object.freeze(['0', '512', '1024', '2048', '4096', '8192'])
/** 默认上限：2048 MB = 2 GB */
export const DEFAULT_PROFILE_LIMIT_MB = 2048
/** `webapp.diskCacheMb` 的可选档位（MB）；`-1` = **禁用磁盘 HTTP 缓存**，`0` = 不传该参数 */
export const DISK_CACHE_MB_VALUES = Object.freeze(['-1', '0', '128', '512', '1024'])
/** 默认：**禁用磁盘 HTTP 缓存**（用户决策，见 `diskCacheSizeArg` 的实测证据） */
export const DEFAULT_DISK_CACHE_MB = -1
/** `-1` 的字面量含义：交给 Chrome 的 `--disk-cache-size=-1` = 不落盘 HTTP 缓存 */
export const DISK_CACHE_DISABLED_MB = -1

/** 换算常量 */
export const KB = 1024
export const MB = 1024 * KB
export const GB = 1024 * MB

/** `--disk-cache-size` 的取值上限（规格 §11.2 校验第 5 条：1 ≤ n ≤ 17179869184 = 16 GB） */
export const MAX_DISK_CACHE_BYTES = 16 * GB

/**
 * 归一**目录上限**（MB）：`Number.parseInt(String(v), 10)`；非有限数 / 负数 / **不在枚举内**
 * → 回落默认 `2048`（并让调用方 `console.warn` 一次）。
 *
 * @param {unknown} value 设置里读到的东西
 * @returns {{ mb: number, fellBack: boolean }}
 */
export function normalizeProfileLimitMb(value) {
  return normalizeMb(value, PROFILE_LIMIT_MB_VALUES, DEFAULT_PROFILE_LIMIT_MB)
}

/**
 * 归一 **HTTP 缓存上限**（MB），口径同上，默认 `512`；`0` = 不传该参数。
 * @param {unknown} value
 * @returns {{ mb: number, fellBack: boolean }}
 */
export function normalizeDiskCacheMb(value) {
  return normalizeMb(value, DISK_CACHE_MB_VALUES, DEFAULT_DISK_CACHE_MB)
}

/** 共用的枚举归一：不在清单内一律回落默认值 */
function normalizeMb(value, allowed, fallback) {
  const text = String(value ?? '').trim()
  if (allowed.includes(text)) return { mb: Number.parseInt(text, 10), fellBack: false }
  return { mb: fallback, fellBack: true }
}
/** MB → 字节 */
export function mbToBytes(mb) {
  const value = Number(mb)
  return Number.isFinite(value) && value > 0 ? Math.round(value * MB) : 0
}

/**
 * `--disk-cache-size` 的参数值。
 *
 * **真机实测（用户决策的依据，别丢）**：`--disk-cache-size` **不限制缓存总量**——
 * 设 20 MB cap、跑 300 MB 流量后 `Default\Cache` 仍是 **301.998 MB**（无 cap 对照 302.248 MB），
 * 时间序列与干净退出后都不下降；`=0` 等同不限；它实际只充当**单条准入阈值（≈ cap/8）**。
 * 只有 **`-1`** 能真正把它按住：实测 `Default\Cache` = **0 字节 / 0 文件**。
 * 因此默认值是 `-1`（禁用磁盘 HTTP 缓存，磁盘最省，代价是每次打开都要重新下载静态资源）；
 * 正数档位保留给"愿意用磁盘换速度"的用户，但必须在设置描述里说明它**不限制总量**。
 *
 * @param {unknown} diskCacheMb 已归一 / 未归一的 MB 值（`-1` = 禁用；`0` = 不传参数）
 * @returns {string | null} `null` = **不传该参数**（`0` = 用 Chrome 默认）
 */
export function diskCacheSizeArg(diskCacheMb) {
  const { mb } = normalizeDiskCacheMb(diskCacheMb)
  if (mb === DISK_CACHE_DISABLED_MB) return '--disk-cache-size=-1'
  if (mb <= 0) return null
  const bytes = mbToBytes(mb)
  if (bytes < 1 || bytes > MAX_DISK_CACHE_BYTES) return null
  return `--disk-cache-size=${bytes}`
}

/**
 * 上限是否有效（`0` = 用户显式关闭 → 不预检、不拦截）。
 * @param {unknown} profileLimitMb
 */
export function isLimitDisabled(profileLimitMb) {
  const { mb } = normalizeProfileLimitMb(profileLimitMb)
  return mb <= 0
}

/**
 * 超限判定（「打开」前预检的判据，规格 §14.6）。
 *
 * @param {number | null} usedBytes 实测体积（`null` = 目录不存在 = 首次打开）
 * @param {unknown} profileLimitMb 设置里的上限（MB；`0` = 关闭）
 * @returns {{ skip: boolean, overLimit: boolean, limitBytes: number, usedBytes: number | null }}
 *          `skip: true` = 跳过预检（上限关闭，或目录不存在）
 */
export function checkProfileLimit(usedBytes, profileLimitMb) {
  const { mb } = normalizeProfileLimitMb(profileLimitMb)
  const limitBytes = mbToBytes(mb)
  if (mb <= 0) return { skip: true, overLimit: false, limitBytes: 0, usedBytes: null }
  if (usedBytes === null || usedBytes === undefined || !Number.isFinite(Number(usedBytes))) {
    return { skip: true, overLimit: false, limitBytes, usedBytes: null }
  }
  const used = Number(usedBytes)
  return { skip: false, overLimit: used > limitBytes, limitBytes, usedBytes: used }
}

// ---------------------------------------------------------------------------
// 体积缓存的时间戳语义（§14.6）
// ---------------------------------------------------------------------------

/** 体积缓存的 TTL：60 秒 */
export const PROFILE_SIZE_TTL_MS = 60_000

/**
 * `profileSize` 的缓存是否可用（六条失效条件的纯函数部分）。
 *
 * @param {{ scannedAt?: number, bytes?: number } | null | undefined} cached
 * @param {number} now 当前时间戳（毫秒）
 * @param {{ ttlMs?: number, force?: boolean }} [options]
 * @returns {boolean} `true` = 可直接用缓存（不做任何磁盘遍历）
 */
export function isProfileSizeCacheValid(cached, now, options = {}) {
  if (!cached || !Number.isFinite(Number(cached.scannedAt))) return false
  if (options.force === true) return false
  const ttl = Number.isFinite(Number(options.ttlMs)) ? Number(options.ttlMs) : PROFILE_SIZE_TTL_MS
  const age = Number(now) - Number(cached.scannedAt)
  if (!Number.isFinite(age) || age < 0) return false
  return age <= ttl
}

// ---------------------------------------------------------------------------
// 缓存白名单与保留清单（§14.5）
// ---------------------------------------------------------------------------

/**
 * **可清理**的缓存目录名（白名单；**大小写不敏感精确匹配目录名**、**深度 2**）。
 *
 * 深度 2 覆盖两种落点：`chrome/<条目名>/<缓存目录>`（无 `Default` 子目录的 profile）与
 * `chrome/<条目名>/Default/<缓存目录>`（标准布局）。**不递归进更深层**去找同名目录——
 * 避免误删站点自己存的同名目录。
 *
 * 两个"实测才会想到要清"的成员（用户决策，带证据）：
 * - `BrowserMetrics`：纯诊断数据，**每次启动 +4 MB 且会累积**；
 * - `optimization_guide_model_store`：约 40 MB，Chrome 会另行重建（删掉只是重下）。
 *
 * ⚠️ **禁用磁盘 HTTP 缓存 ≠ 禁用 Service Worker**：用了 SW 的站点仍会在
 * `Service Worker/CacheStorage` 里累积，而它在保留清单里（**不得删**）——
 * 这是已知边界，README 的「磁盘占用」小节写明。
 */
export const CACHE_DIR_NAMES = Object.freeze([
  'Cache',
  'Code Cache',
  'GPUCache',
  'GrShaderCache',
  'ShaderCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'Crashpad',
  'BrowserMetrics',
  'optimization_guide_model_store'
])

/** 允许扫描的深度（1 = `chrome/<名>/<缓存目录>`；2 = `chrome/<名>/<profile>/<缓存目录>`） */
export const CACHE_SCAN_DEPTH = 2

/**
 * **必须保留**的目录/文件名（黑名单；明确禁止出现在任何删除路径里）。
 * 白名单与黑名单**不得有交集**（`test/settings.test.js` 钉住）。
 */
export const PROTECTED_DIR_NAMES = Object.freeze([
  'Cookies',
  'Cookies-journal',
  'Login Data',
  'Login Data For Account',
  'Web Data',
  'Local Storage',
  'Session Storage',
  'IndexedDB',
  'Service Worker',
  'CacheStorage',
  'Preferences',
  'Secure Preferences',
  'History',
  'Bookmarks',
  'Favicons',
  'Extensions',
  'Local Extension Settings',
  'Sync Data',
  'Network'
])

/** 目录名比较键（大小写不敏感 + 去首尾空白） */
function dirKey(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
}

/*
 * ⚠️ 关于"profile 是否被占用"的判定（真机实测结论，别改回去）：
 * **Windows 上不存在 POSIX 专有的 Singleton* 锁文件**（那几个名字只在 macOS/Linux 出现）。
 * 运行中的 Chrome 持有的是顶层 `lockfile`（0 字节、独占打开、连读都失败）与约 30 个
 * LevelDB `LOCK`（`Default\LOCK`、`Default\Local Storage\leveldb\LOCK` …）。
 * 因此**真正的判据始终是"尝试整目录 rename / 递归删除是否失败"**（实测：窗口开着时
 * rename 报 `Access to the path '…' is denied.`、删除报
 * `The process cannot access the file 'journal.baj' because it is being used by another process.`），
 * 而**不是**"有没有某个锁文件"。`helper.cjs` 的 `looksLocked()` 只是给界面用的启发式，
 * 不作为硬拦截；`removeProfile` 的失败文案里带**真实错误**（不硬编码文件名）。
 */

/** 该目录名是否属于可清理的缓存白名单（大小写不敏感精确匹配） */
export function isCacheDirName(name) {
  return CACHE_DIR_NAMES.some((entry) => dirKey(entry) === dirKey(name))
}

/** 该目录名是否属于必须保留的清单（大小写不敏感精确匹配） */
export function isProtectedDirName(name) {
  return PROTECTED_DIR_NAMES.some((entry) => dirKey(entry) === dirKey(name))
}

/**
 * 判定一条**相对 profile 根**的路径是否该被清理（三道防线的第一道，纯函数、可单测）。
 *
 * 规则：段数 1 或 2（深度 2），最后一段命中缓存白名单，且**任何一段**都不得命中保留清单。
 *
 * @param {unknown} relative 相对路径（`/` 或 `\` 分隔均可）
 * @returns {{ clean: boolean, reason?: string }}
 */
export function classifyCachePath(relative) {
  const parts = String(relative ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .map((part) => part.trim())
    .filter((part) => part !== '')
  if (parts.length === 0) return { clean: false, reason: '空路径' }
  if (parts.length > CACHE_SCAN_DEPTH) {
    return { clean: false, reason: `超过允许深度 ${CACHE_SCAN_DEPTH}` }
  }
  if (parts.some((part) => part === '.' || part === '..')) {
    return { clean: false, reason: '路径含 . / ..' }
  }
  for (const part of parts) {
    if (isProtectedDirName(part)) return { clean: false, reason: `命中保留清单：${part}` }
  }
  const leaf = parts[parts.length - 1]
  if (!isCacheDirName(leaf)) return { clean: false, reason: `不在缓存白名单：${leaf}` }
  return { clean: true }
}

// ---------------------------------------------------------------------------
// 展示
// ---------------------------------------------------------------------------

/** 人类可读的体积（`1.5 GB` / `512 MB` / `3 KB` / `0 B`；不是精确值，仅供提示） */
export function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let index = 0
  let scaled = value
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024
    index += 1
  }
  const rounded =
    index === 0 ? String(Math.round(scaled)) : (Math.round(scaled * 10) / 10).toFixed(1)
  return `${rounded} ${units[index]}`
}

/** 超限时给用户看的整句（界面、状态栏、拦截模态框共用同一份文案） */
export function overLimitText(profileName, usedBytes, limitBytes, cacheBytes) {
  const cache = Number.isFinite(Number(cacheBytes)) ? formatBytes(cacheBytes) : '未知'
  return `「${profileName}」的浏览器数据已用 ${formatBytes(
    usedBytes
  )}，超过上限 ${formatBytes(limitBytes)}；其中可清理的缓存约 ${cache}（清理保留登录状态与 Cookie）`
}
