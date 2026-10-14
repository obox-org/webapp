/**
 * profile 根目录：校验 / 归一 / 标记文件 / 迁移决策 / 完整性判据 / 状态机
 * （**纯函数为主**，零依赖；规格 §9.1 / §9.3 / §9.4 的落点，票 01/03/04 共用）。
 *
 * 为什么把这一整套从 `helper.cjs` / `index.js` 里抽出来：
 * - **不可逆动作的守卫必须是纯函数**（覆盖删除、删源），否则只能靠真机验证；
 * - 助手（CJS，Node）与扩展入口（ESM，宿主渲染进程）**都要**用同一份判定，
 *   各写一份必然漂移（`test/profileRoot.test.js` 有"lib 里不得出现第二份根解析"的反向门禁）；
 * - 路径规则需要 `process`（`execPath` / `platform` / `cwd`）——本模块只**读取**它，
 *   不碰文件系统（`exists` / `isDirectory` 一律由调用方实测后传进来）。
 *
 * ⚠️ 本模块**不得**出现 `backup` / `.bak` / `.old` 之类"覆盖前先留一份"的实现
 * （P1 = B：覆盖是不可逆的、用户已接受；`test/profileRoot.test.js` 用源码门禁钉住）。
 *
 * ⚠️ 本模块**不得** import `node:*`：它同时被 Node 侧（`helper.cjs` / `index.js`）与
 * **浏览器侧**（界面 bundle）加载——界面的导入链是
 * `src/fields.js → lib/webapp.mjs → lib/chromeArgs.mjs → 本模块`，
 * 一旦这里出现 `node:path`，Vite 会把它外部化成 `__vite-browser-external` 并**直接构建失败**。
 * 因此下面这几个路径小工具是**本模块自带**的纯字符串实现（零依赖、可按平台参数化）：
 * 语义与 `node:path` 一致，只是不依赖运行平台——本扩展处理的恒是 Windows 路径，
 * 而测试需要能在任意平台上断言 Windows 行为。
 *
 * ⚠️ 本模块**不得**引用 `process`：它同时跑在 Node 侧（`helper.cjs`）与**渲染进程**（`index.js` 会
 * import 它），而渲染进程没有 `process` 这个全局。历史坑：早期版本用默认参数（`platform = process.platform`）
 * 与 `?? process.platform` 兜底——它们**只在没传值时才求值**，某条调用路径忘了传就会在渲染进程抛
 * `process is not defined`（v1.0.4 的线上报错）。所以统一走下面两个函数取值，它们在任何环境都不抛。
 */

/**
 * 运行期平台：Node 里有 `process` ⇒ 用它；渲染进程没有 ⇒ 回落 `'win32'`
 * （本扩展只处理 Windows 路径，见上文与规格 §2；平台参数化只为测试能在任意平台断言 Windows 行为）。
 */
function runtimePlatform() {
  const proc = typeof globalThis === 'undefined' ? undefined : globalThis.process
  return proc && typeof proc.platform === 'string' ? proc.platform : 'win32'
}

/**
 * 运行期 `execPath`：只有 Node 侧有（用于 V5"不能指向 obox 自己的安装目录"）。
 * 渲染进程拿不到 ⇒ 返回空串，`normalizeRoot` 里的 V5 会因此自动跳过（`execDir` 为空即不判），
 * 不抛错也不误判——真正的校验由助手侧调用时完成。
 */
function runtimeExecPath() {
  const proc = typeof globalThis === 'undefined' ? undefined : globalThis.process
  return proc && typeof proc.execPath === 'string' ? proc.execPath : ''
}

/** 该平台是否用 `\` 作分隔符 */
function usesBackslash(platform) {
  return String(platform ?? runtimePlatform()) === 'win32'
}

/** 把任意分隔符统一成 `platform` 的口径 */
function unifySeparators(value, platform) {
  const text = String(value ?? '')
  return usesBackslash(platform) ? text.replace(/\//g, '\\') : text.replace(/\\/g, '/')
}

/** 路径的父目录（与 `path.dirname` 同口径；无分隔符时返回 `.`） */
function dirnameOf(value, platform) {
  const text = unifySeparators(value, platform)
  if (!text) return '.'
  const sep = usesBackslash(platform) ? '\\' : '/'
  const idx = text.lastIndexOf(sep)
  if (idx < 0) return '.'
  if (idx === 0) return sep
  const head = text.slice(0, idx)
  // 盘符根（`C:\`）本身要保留尾部分隔符
  if (/^[a-zA-Z]:$/.test(head)) return `${head}${sep}`
  return head || sep
}

/** 卷根（`C:\` / `/` / `\\server\share`）——只用于"是否同卷"的比较 */
function rootOf(value, platform) {
  const text = unifySeparators(value, platform)
  if (!text) return ''
  const sep = usesBackslash(platform) ? '\\' : '/'
  if (isUncPath(text)) {
    const parts = text.split(sep).filter(Boolean)
    return parts.length >= 2 ? `${sep}${sep}${parts[0]}${sep}${parts[1]}` : `${sep}${sep}`
  }
  const drive = /^([a-zA-Z]:)/.exec(text)
  if (drive) return `${drive[1]}${sep}`
  return text.startsWith(sep) ? sep : ''
}

/**
 * 是否绝对路径（**按平台语义**：Windows 认 `C:\x` / `\\srv\share` / `\x`，POSIX 认 `/x`）。
 * @param {unknown} value
 * @param {string} [platform]
 */
export function pathIsAbsolute(value, platform = runtimePlatform()) {
  const text = String(value ?? '').trim()
  if (!text) return false
  if (isUncPath(text)) return true
  if (/^[a-zA-Z]:[\\/]/.test(text)) return true
  if (usesBackslash(platform)) return text.startsWith('\\')
  return text.startsWith('/')
}

/** 是否 UNC 路径（`\\server\share\…` / `//server/share/…`） */
export function isUncPath(value) {
  const text = String(value ?? '').trim()
  return text.startsWith('\\\\') || text.startsWith('//')
}

/**
 * 是否"看起来是绝对路径"。
 *
 * ⚠️ **不能只用"当前平台"的判定**：本扩展处理的**就是 Windows 路径**（用户可能手写 `C:\` 或
 * `C:/`），在非 Windows 上跑测试时也必须认它们。三者取并集才是正确的口径。
 */
export function looksAbsolute(value) {
  const text = String(value ?? '').trim()
  if (!text) return false
  if (isUncPath(text)) return true
  if (/^[a-zA-Z]:[\\/]/.test(text)) return true
  return text.startsWith('/') || text.startsWith('\\')
}

/** 标记文件：目标根**必须**有它，缺标记 ⇒ 拒绝删除/清理/改名（规格 §9.3） */
export const ROOT_MARKER = '.obox-webapp-root'
/** 迁移意图文件：写在**扩展 data 目录**（中立位置，不随根移动；规格 §9.4 D4） */
export const ROOT_INTENT = '.pending-move-root.json'
/** 意图文件的 schema 版本（读到别的值视为不合法，不迁移只报错） */
export const ROOT_INTENT_SCHEMA = 1
/** 意图文件的 kind（防与其他 intent 混淆） */
export const ROOT_INTENT_KIND = 'profile-root-move'
/** 标记文件的魔数（解析时校验，避免把任意 JSON 当标记） */
export const MARKER_ID = 'obox-webapp-root'
/** 扩展 id（= 宿主安装目录名，决定 `<userData>/extensions/<id>/`） */
export const EXT_ID = 'webapp_chenzhi'
/** 默认根的目录名（相对扩展 data 目录；与 `lib/nameSanitize.mjs` 的 `PROFILE_ROOT` 同值） */
export const DEFAULT_ROOT_DIRNAME = 'chrome'
/** 目标侧文件数 / 字节数相对源的**最低比例**（规格 C2/C3：≥ 95%） */
export const MIN_COPY_RATIO = 0.95

/** 各里程碑状态：终态集合 */
export const TERMINAL_ITEM_STATUSES = Object.freeze([
  'done',
  'overwritten',
  'skipped',
  'failed',
  'missing'
])
/** 迁移中（未终结）的状态 */
export const ACTIVE_ITEM_STATUSES = Object.freeze(['pending', 'copying', 'verifying'])
/** 迁移意图的阶段 */
export const MIGRATION_PHASES = Object.freeze(['pending', 'running', 'done', 'abandoned'])

// ---------------------------------------------------------------------------
// 路径校验（规格 §9.1 V1–V5）
// ---------------------------------------------------------------------------

/**
 * 是否"纯盘符根"（`C:\` / `D:/` / `C:`）——规格 V3：不能把磁盘根当浏览器数据根。
 * 先去掉尾部分隔符再判，因此 `C:\` 与 `C:/` 都会被识别。
 */
export function isDriveRoot(value) {
  const text = String(value ?? '')
    .trim()
    .replace(/[\\/]+$/, '')
  return /^[a-zA-Z]:$/.test(text)
}

/** UNC 根（`\\server\share\` 去掉尾部分隔符后只剩 `\\server\share` ⇒ 与 `C:\` 同级的"纯根"） */
export function isUncRoot(value) {
  if (!isUncPath(value)) return false
  const text = String(value ?? '')
    .trim()
    .replace(/[\\/]+$/, '')
  const parts = text.replace(/\\/g, '/').split('/').filter(Boolean)
  return parts.length <= 2
}

/**
 * 规范化根路径（规格 V3：去尾部分隔符、统一分隔符）。
 * **不改大小写、不解析相对段**（`..` 由调用方与自己拼接的路径比对时自然暴露）。
 * @param {unknown} value
 * @param {{ platform?: string }} [env]
 * @returns {string} 规范化结果（空输入返回空串）
 */
export function canonicalRoot(value, env = {}) {
  const platform = env.platform ?? runtimePlatform()
  const text = String(value ?? '').trim()
  if (!text) return ''
  const unified = unifySeparators(text, platform)
  // 去尾部分隔符；但 `\\` / `//` 本身（未写完的 UNC）保持原样，避免把前缀吃掉
  const trimmed = unified.replace(/[\\/]+$/, '')
  return trimmed || unified
}

/** 去掉盘符/UNC 前缀后的剩余段数（用于 UNC 根判定） */
function segmentsOf(value) {
  return String(value ?? '')
    .replace(/^[a-zA-Z]:/, '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
}

/**
 * 根路径归一与校验（**纯函数**，规格 §9.1 的 V1–V5；V6/V7 需要实测，见 `checkCandidateRoot`）。
 *
 * @param {unknown} value 设置项 `webapp.profileRoot` 的原始值
 * @param {{
 *   platform?: string,
 *   execPath?: string,
 *   env?: Record<string, string|undefined>,
 *   isDirectory?: boolean | null
 * }} [ctx] 运行环境（默认取 `process`；测试可注入）
 * @returns {{ kind: 'default' } | { kind: 'absolute'|'absolute-unc', root: string, warning: string|null }
 *   | { kind: 'invalid', reason: string, value: string }}
 */
export function normalizeRoot(value, ctx = {}) {
  const raw = value === undefined || value === null ? '' : String(value)
  const text = raw.trim()
  if (!text) return { kind: 'default' }

  const platform = ctx.platform ?? runtimePlatform()
  const execPath = ctx.execPath ?? runtimeExecPath()

  // V3 先于 V2：`C:` / `C:\` 两种写法都要给"不能把磁盘根目录当数据根"这条**具体**文案，
  // 而不是笼统的"必须是绝对路径"（`C:` 在 Windows 上其实是"该盘的当前目录"，属于合法绝对路径）
  if (isDriveRoot(text)) {
    return { kind: 'invalid', value: raw, reason: '不能把磁盘根目录（C:\\）当作浏览器数据根' }
  }
  if (isUncRoot(text)) {
    return {
      kind: 'invalid',
      value: raw,
      reason: '不能把网络共享的根（\\\\server\\share）当作浏览器数据根，请在其中选一个子目录'
    }
  }
  if (!looksAbsolute(text)) {
    return {
      kind: 'invalid',
      value: raw,
      reason: '根目录必须是绝对路径（例如 D:\\obox-webapp\\profiles）'
    }
  }

  const root = canonicalRoot(text, { platform })
  const segments = segmentsOf(root)
  const lower = root.toLowerCase()

  // V5：拒绝**落在 obox 程序目录里**的根（"运行期 `runtimeExecPath()` 所在目录及其祖先中的 obox 安装目录；渲染进程拿不到时该检查自动跳过"）
  const execDir = canonicalRoot(dirnameOf(String(execPath), platform), { platform })
  if (execDir && isSameOrInside(lower, execDir.toLowerCase())) {
    return { kind: 'invalid', value: raw, reason: '不能指向 obox 自己的安装目录' }
  }
  // 反向（根是 obox 安装目录的**祖先**）只按"路径段里真的有名为 obox 的目录"判：
  // 否则 `C:\Users`、`C:\Program Files` 这类系统目录会被一刀切拒掉（过宽，且用户手建的
  // `C:\obox-profiles` 会因前缀被误伤）。
  if (segments.some((segment) => segment.toLowerCase() === 'obox')) {
    return { kind: 'invalid', value: raw, reason: '不能指向 obox 自己的安装目录' }
  }

  return {
    kind: isUncPath(root) ? 'absolute-unc' : 'absolute',
    root,
    warning:
      isUncPath(root) || segments.length === 0
        ? '警告：网络路径上的浏览器数据会明显变慢，迁移可能很慢；断网或移动盘拔出会导致打开失败'
        : null
  }
}

/**
 * `target` 是否等于 `root` 或位于其下（两者都应是已规范化的绝对路径；比较用 `/` 统一，
 * 大小写由调用方按平台归一 —— Windows 与 POSIX 的路径都在这里正确处理）。
 */
function isSameOrInside(target, root) {
  if (!target || !root) return false
  const slash = (value) => value.replace(/\\/g, '/').replace(/\/+$/, '')
  const a = slash(String(target))
  const b = slash(String(root))
  if (!a || !b) return false
  return a === b || a.startsWith(`${b}/`)
}

/**
 * V6：根不能等于扩展 data 目录、也不能是它的祖先（否则条目枚举会把 `webapp.db` 当条目）。
 * @param {string} root 已规范化的根
 * @param {unknown} dataDir 扩展 data 目录（未知时传空 ⇒ 跳过该条）
 */
export function checkNotDataDir(root, dataDir) {
  const data = canonicalRoot(dataDir)
  if (!data) return null
  const a = root.toLowerCase()
  const b = data.toLowerCase()
  if (a === b) {
    return { reason: '不能指向扩展的数据目录（webapp.db 所在目录）' }
  }
  if (isSameOrInside(b, a)) {
    return { reason: '不能指向扩展的数据目录（webapp.db 所在目录）' }
  }
  return null
}

/**
 * 候选根判定（`migrateRootDir` 的 `action='probe'` 与扩展侧 `browseRootDir` 共用）。
 *
 * ⚠️ **纯函数**：`isDirectory` 必须由调用方实测后传入（本模块不碰文件系统）。
 *
 * @param {{
 *   candidate?: unknown,
 *   dataDir?: string|null,
 *   isDirectory?: boolean|null,
 *   parent?: string|null,
 *   platform?: string,
 *   execPath?: string
 * }} [input]
 * @returns {{ candidate: string, kind: string, isDirectory: boolean, parent: string|null,
 *   invalid: { reason: string } | null, warning: string|null, root: string|null }}
 */
export function checkCandidateRoot(input = {}) {
  const candidateRaw =
    input.candidate === undefined || input.candidate === null ? '' : String(input.candidate)
  const platform = input.platform ?? runtimePlatform()
  const normalized = normalizeRoot(candidateRaw, { platform, execPath: input.execPath })
  const parent =
    input.parent === undefined || input.parent === null
      ? candidateRaw.trim()
        ? canonicalRoot(dirnameOf(candidateRaw.trim(), platform), { platform })
        : null
      : input.parent

  if (normalized.kind === 'invalid') {
    return {
      candidate: candidateRaw,
      kind: 'invalid',
      isDirectory: input.isDirectory === true,
      parent,
      invalid: { reason: normalized.reason },
      warning: null,
      root: null
    }
  }
  if (normalized.kind === 'default') {
    return {
      candidate: candidateRaw,
      kind: 'default',
      isDirectory: input.isDirectory === true,
      parent,
      invalid: { reason: '根目录必须是绝对路径（例如 D:\\obox-webapp\\profiles）' },
      warning: null,
      root: null
    }
  }
  const dataProblem = checkNotDataDir(normalized.root, input.dataDir)
  if (dataProblem) {
    return {
      candidate: candidateRaw,
      kind: normalized.kind,
      isDirectory: input.isDirectory === true,
      parent,
      invalid: dataProblem,
      warning: normalized.warning,
      root: null
    }
  }
  return {
    candidate: candidateRaw,
    kind: normalized.kind,
    isDirectory: input.isDirectory === true,
    parent,
    invalid: null,
    warning: normalized.warning,
    root: normalized.root
  }
}

// ---------------------------------------------------------------------------
// 标记文件（规格 §9.3 / P3 = 五字段）
// ---------------------------------------------------------------------------

/**
 * 生成标记文件内容（字段集合**恰好** `{marker,extId,version,createdAt,root}`；规格 P3）。
 * @param {{ root: string, version?: string, extId?: string, now?: Date|string }} input
 */
export function createMarker(input = {}) {
  const now = input.now === undefined ? new Date() : input.now
  const createdAt = now instanceof Date ? now.toISOString() : String(now)
  return {
    marker: MARKER_ID,
    extId: input.extId ?? EXT_ID,
    version: input.version ?? '1.0.3',
    createdAt,
    root: canonicalRoot(input.root)
  }
}

/**
 * 解析标记文件内容（容错：非法 JSON / 非对象 / `marker` 不匹配 / 缺 `root` ⇒ `null`）。
 * @param {unknown} text
 * @returns {{ marker: string, extId: string, version: string, createdAt: string, root: string } | null}
 */
export function readMarker(text) {
  if (text === undefined || text === null) return null
  let parsed
  try {
    parsed = typeof text === 'string' ? JSON.parse(text) : text
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  if (String(parsed.marker ?? '') !== MARKER_ID) return null
  if (!String(parsed.root ?? '').trim()) return null
  return {
    marker: MARKER_ID,
    extId: String(parsed.extId ?? ''),
    version: String(parsed.version ?? ''),
    createdAt: String(parsed.createdAt ?? ''),
    root: String(parsed.root)
  }
}

/**
 * 目标根是否受管：**必须有标记**（规格 §9.3 "迁移的目标根必须有标记是硬前提"）。
 * @param {unknown} markerText 标记文件内容（读不到传 null）
 */
export function isManagedTargetRoot(markerText) {
  return readMarker(markerText) !== null
}

/**
 * 生效根（规格 §9.1「保存时机与状态表示」）——
 * 迁移未完成时**恒为旧根**（`intent.from`），这是"设置说新根、数据还在旧根"的唯一防线。
 *
 * @param {{
 *   configured?: unknown,
 *   fallbackRoot?: string,
 *   defaultRoot?: string,
 *   intent?: object|null,
 *   env?: { platform?: string, execPath?: string }
 * }} input
 * @returns {{ root: string, isDefault: boolean, source: 'configured'|'default'|'migration-from'|'fallback' }}
 */
export function resolveEffectiveRoot(input = {}) {
  const env = input.env ?? {}
  const intent = input.intent && typeof input.intent === 'object' ? input.intent : null
  if (intent && intent.phase !== 'done' && intent.phase !== 'abandoned' && intent.from) {
    const from = canonicalRoot(intent.from, env)
    return {
      root: from,
      isDefault: Boolean(input.defaultRoot) && samePath(from, input.defaultRoot),
      source: 'migration-from'
    }
  }
  const normalized = normalizeRoot(input.configured, env)
  if (normalized.kind === 'invalid') {
    const fallback = canonicalRoot(input.fallbackRoot)
    if (fallback) return { root: fallback, isDefault: false, source: 'fallback' }
    const def = canonicalRoot(input.defaultRoot)
    return { root: def, isDefault: true, source: 'default' }
  }
  if (normalized.kind === 'default') {
    const def = canonicalRoot(input.defaultRoot)
    return { root: def, isDefault: true, source: 'default' }
  }
  return { root: normalized.root, isDefault: false, source: 'configured' }
}

/** 大小写不敏感 + 分隔符不敏感的路径相等（Windows 上的同一目录可能写成 `D:\a` / `d:/a/`） */
export function samePath(a, b) {
  const left = canonicalRoot(a)
  const right = canonicalRoot(b)
  if (!left || !right) return left === right
  return left.toLowerCase() === right.toLowerCase()
}

/**
 * 生效根归一（1.0.4，amendment 09 §4）：**与默认根同路径的配置值仍按"默认根"处理**。
 *
 * 为什么必须有这一步：1.0.4 起扩展会把解析出的默认根绝对路径（`<扩展 data>/chrome`）**回填**进
 * `webapp.profileRoot`（让设置页显示真实路径）。回填后 `resolveEffectiveRoot` 会把它归成
 * `kind:'custom'`（因为它非空、是绝对路径），于是 `isDefault` 变 `false`，
 * 连带 `rootParam()` 会开始给助手传 `root`、卡片文案也换成绝对路径——**同一份数据的行为随
 * "有没有回填过"漂移**。本函数把"值等于默认根"重新判回默认根，行为与回填前逐字一致。
 *
 * ⚠️ 判据只允许是**路径相等**（`samePath`），不得用"值看起来像默认根"之类的启发式。
 *
 * @param {{ root?: string, isDefault?: boolean, source?: string }|null|undefined} resolved
 * @param {unknown} defaultRoot 默认根的绝对路径（来自助手；拿不到就不归一）
 */
export function treatAsDefaultRoot(resolved, defaultRoot) {
  if (!resolved || typeof resolved !== 'object') return resolved
  if (resolved.isDefault === true) return resolved
  const def = canonicalRoot(defaultRoot)
  if (!def) return resolved
  if (!samePath(resolved.root, def)) return resolved
  return { ...resolved, isDefault: true, source: 'default' }
}

/**
 * **设置页改根 ⇒ 是否该自动开始一次迁移**的判据（纯函数；1.0.4，amendment 09 §2.6）。
 *
 * 背景：扩展页面不再有「迁移到此目录」按钮（用户决策），于是"用户改了根目录"这件事必须由
 * **设置项的变更通知**（`api.settings.onChanged` 的 `profileRoot`）来驱动。
 *
 * 返回两个彼此独立的布尔量（分开是为了让调用方能分别处理"没事发生"与"迁移中改根被拒"）：
 * - `changed`：归一后的配置值**确实指向了另一个根**（与"当前数据所在根"和"进行中迁移的目标根"
 *   都不同）；
 * - `trigger`：**该不该现在开始迁移**（`changed` 且当前没有未完成的迁移意图）。
 *
 * 判据矩阵（每一条都有单测；`reason` 用于日志与测试断言）：
 *
 * | 情形                                          | changed | trigger | reason                     |
 * | --------------------------------------------- | ------- | ------- | -------------------------- |
 * | 空 / 纯空白                                   | false   | false   | `configured-empty`         |
 * | 与**当前数据所在根**同路径（含大小写/尾斜杠） | false   | false   | `same-as-current`          |
 * | 与**进行中迁移的目标根**同路径                 | false   | false   | `same-as-migration-target` |
 * | 非法（V2–V5 不通过 / 形态非法）               | false   | false   | `configured-invalid`       |
 * | 有未完成意图 + 选了别的根                     | true    | false   | `migration-active`         |
 * | 无未完成意图 + 选了别的根                     | true    | true    | `changed`                  |
 *
 * ⚠️ **为什么用"与当前数据根比较"而不是"写入方加标记"来防自触发**：
 * 1. `api.settings.set` 的变更通知**投递时机不由我们决定**（同步的 `stateStore.setSetting` 与
 *    将来可能的异步/跨窗口同步都可能发生），而"这次写入是谁发起的"在异步投递下根本无从判断；
 *    "值是不是指向了另一个根"则是**与投递时机无关**的事实。
 * 2. 扩展自己有 **5 处**写 `profileRoot` 的地方（迁移完成 / 放弃回写 / 无存量条目 / 默认根回填 /
 *    迁移中改根的回写）：靠"每处都记得置标志"必然漏一处，而漏一处的后果是**多跑一次迁移**。
 * 3. 顺带把"同路径写入""非法值""迁移中"三种情形一起兜住（它们本来也要判）。
 * ⚠️ 顺序很关键：**先比路径、再走 `normalizeRoot`**——真实默认根含 `obox` 段会被 V5 判非法，
 * 而"回填写的就是默认根"必须被认成 `same-as-current`（否则会误报非法）。
 *
 * @param {{
 *   configured?: unknown,        // 设置里的新值（原始串）
 *   dataRoot?: unknown,          // 当前**数据实际所在**的根（绝对路径；默认根时传默认根绝对路径）
 *   migrationTarget?: unknown,   // 未完成迁移的目标根（无迁移则空）
 *   hasActiveIntent?: boolean,   // 是否有 pending/running 的迁移意图
 *   env?: object                 // 平台注入（测试用）
 * }} input
 * @returns {{ changed: boolean, trigger: boolean, root: string, reason: string, detail?: string }}
 */
export function planRootChangeTrigger(input = {}) {
  const raw = String(input.configured ?? '').trim()
  if (!raw) return { changed: false, trigger: false, root: '', reason: 'configured-empty' }

  const dataRoot = canonicalRoot(input.dataRoot, input.env)
  if (dataRoot && samePath(raw, dataRoot)) {
    return { changed: false, trigger: false, root: '', reason: 'same-as-current' }
  }
  const target = canonicalRoot(input.migrationTarget, input.env)
  if (target && samePath(raw, target)) {
    return { changed: false, trigger: false, root: '', reason: 'same-as-migration-target' }
  }

  const verdict = normalizeRoot(raw, input.env)
  if (verdict.kind === 'invalid') {
    return {
      changed: false,
      trigger: false,
      root: '',
      reason: 'configured-invalid',
      detail: verdict.reason
    }
  }
  if (input.hasActiveIntent === true) {
    return { changed: true, trigger: false, root: verdict.root, reason: 'migration-active' }
  }
  return { changed: true, trigger: true, root: verdict.root, reason: 'changed' }
}

/**
 * 默认根**回填**的决策（纯函数；1.0.4，amendment 09 §4）。
 *
 * 背景：`manifest.json` 的 `default` 只能是静态字符串，**写不出** `<扩展 data>/chrome` 这个
 * 运行期绝对路径；于是 `default` 保持空串（= 用默认根），由扩展在拿到默认根的绝对路径后
 * **回填**一次，让设置页的目录选择框显示真实路径。
 *
 * 硬要求（每一条都有单测）：**回填绝不允许触发迁移**——它只写 `webapp.profileRoot` 这一个键，
 * 不写迁移意图；同路径的值经 `treatAsDefaultRoot` 仍按默认根处理（行为不随回填漂移）。
 *
 * ⚠️ **默认根只做形状检查（必须是绝对路径），不走 V2–V5 的业务策略**：真实默认根里恰好有一段
 * 叫 `obox`（`%APPDATA%\obox\extensions\…\chrome`），会被 V5 的"不能指向 obox 自己的安装目录"
 * 判成非法——那不是 V5 要防的东西（它防的是**安装目录**，不是 userData 里的同名段）。
 * 同理，`configured` 与默认根**同路径时必须先判掉**（否则也会撞上 V5 而误报"非法"）。
 *
 * 判据矩阵：
 * | 当前 `configured`            | 结果                                                                 |
 * | ---------------------------- | -------------------------------------------------------------------- |
 * | 空串 / 纯空白                | `write: true`（回填默认根绝对路径）                                   |
 * | **等于**默认根（先判）       | `write: false`（已经是它了，写回是多余的写操作 ⇒ `already-default`）   |
 * | 合法且是**别的**自定义根     | `write: false`（用户选过别的根，**不得**覆盖成默认根）                 |
 * | 非法（V2–V5 不过）           | `write: false`（**不得**把用户那个非法值悄悄改掉——要让用户看到并自己改） |
 * | 默认根不是绝对路径 / 拿不到  | `write: false`（`no-default-root`）                                   |
 *
 * @param {{ configured?: unknown, defaultRoot?: unknown, env?: object }} input
 * @returns {{ write: boolean, root: string, reason: string }}
 */
export function planDefaultRootBackfill(input = {}) {
  const def = canonicalRoot(input.defaultRoot, input.env)
  // 形状检查：Windows 盘符绝对路径或 UNC（默认根本该长这样；不是就当拿不到）
  const defIsAbsolute = /^[a-zA-Z]:[\\/]/.test(def) || /^[\\/]{2}[^\\/]/.test(def)
  if (!def || !defIsAbsolute) return { write: false, root: '', reason: 'no-default-root' }

  const raw = String(input.configured ?? '').trim()
  if (!raw) return { write: true, root: def, reason: 'configured-empty' }
  // 先判"就是默认根"：这一条必须早于 `normalizeRoot`（见文件头的 V5 说明）
  if (samePath(raw, def)) return { write: false, root: '', reason: 'already-default' }
  const verdict = normalizeRoot(raw, input.env)
  if (verdict.kind === 'invalid') return { write: false, root: '', reason: 'configured-invalid' }
  return { write: false, root: '', reason: 'configured-custom' }
}

// ---------------------------------------------------------------------------
// 迁移决策与完整性判据（规格 §9.4）
// ---------------------------------------------------------------------------

/**
 * 冲突确认是否覆盖了当前冲突集合（规格 D16：续做**不得**继承一个不存在的确认）。
 * @param {{ confirmedAt?: string|null, names?: string[] }|null|undefined} conflicts
 * @param {string[]} currentNames 本次重扫得到的冲突条目名
 */
export function conflictsConfirmed(conflicts, currentNames) {
  if (!conflicts || !conflicts.confirmedAt) return false
  const confirmed = new Set(
    (Array.isArray(conflicts.names) ? conflicts.names : []).map((name) => String(name))
  )
  return (Array.isArray(currentNames) ? currentNames : []).every((name) =>
    confirmed.has(String(name))
  )
}

/**
 * 单条目迁移决策（**纯函数**，规格 P-9 / P-15 / §9.4 冲突策略表）。
 *
 * @param {{ exists: boolean, files?: number, bytes?: number }} sourceInfo
 * @param {{ exists: boolean, files?: number, bytes?: number }} targetInfo
 * @param {{ confirmed?: boolean, overwrite?: boolean, userDeclined?: boolean }} [flags]
 * @returns {{ action: 'done'|'overwritten'|'skipped'|'missing'|'move', reason: string }}
 */
export function decideMigrationItem(sourceInfo, targetInfo, flags = {}) {
  const sourceExists = Boolean(sourceInfo && sourceInfo.exists)
  const targetExists = Boolean(targetInfo && targetInfo.exists)
  if (!sourceExists && !targetExists) {
    return { action: 'missing', reason: '源与目标都不存在（该条目目录本来就没有）' }
  }
  if (!sourceExists && targetExists) {
    return { action: 'done', reason: '已搬完（源已不存在）' }
  }
  if (sourceExists && !targetExists) {
    return { action: 'move', reason: '' }
  }
  // 两侧都在 ⇒ 冲突：**只有确认过才允许覆盖**（未确认 ⇒ 跳过，一个字节都不删）
  const overwrite = flags.overwrite === true && flags.confirmed === true
  if (flags.userDeclined === true) {
    return { action: 'skipped', reason: '未确认覆盖' }
  }
  if (!overwrite) {
    return { action: 'skipped', reason: '未确认覆盖' }
  }
  return { action: 'overwritten', reason: '' }
}

/**
 * 完整性判据 C1–C5（规格 §9.4）——**先校验、后删源**，这是删源的唯一守卫。
 *
 * C2/C3 的阈值是**硬门槛 `floor(源 × 0.95)`**（不随源大小浮动）：
 * 源 100 文件时目标至少 95 个（94 个即失败），源 10 文件时目标至少 9 个。
 * 小样本下这条会偏严，但"宁可该条目留在 failed 让用户关窗重试，
 * 也不要把一个被截断的 profile 当成成功然后删源"（用户已接受的取舍）。
 *
 * C4/C5 的"关键文件"按 Chrome 的实际布局判定：`Preferences` 取 `Default/Preferences`
 * 或 `Preferences`；`Cookies` 取 `Default/Network/Cookies`、`Default/Cookies`、
 * `Network/Cookies` 或 `Cookies`。**仅当源确实有该文件时才要求目标也有**
 * （源本来就没有的条目仍然可迁移——否则会造出"永远搬不动的条目"）。
 *
 * @param {{
 *   sourceFiles: number, sourceBytes: number,
 *   targetFiles: number, targetBytes: number,
 *   targetIsDirectory?: boolean, targetExists?: boolean,
 *   targetHasPreferences?: boolean, targetHasCookies?: boolean,
 *   sourceHasPreferences?: boolean, sourceHasCookies?: boolean,
 *   minRatio?: number
 * }} input 全部数字由调用方（助手）**实测**后传入，本函数不信任何"迁移前的旧快照"
 * @returns {{ ok: boolean, reason: string }}
 */
export function verifyMigration(input = {}) {
  const minRatio = Number.isFinite(input.minRatio) ? Number(input.minRatio) : MIN_COPY_RATIO
  const sourceFiles = Math.max(0, Math.trunc(Number(input.sourceFiles) || 0))
  const sourceBytes = Math.max(0, Math.trunc(Number(input.sourceBytes) || 0))
  const targetFiles = Math.max(0, Math.trunc(Number(input.targetFiles) || 0))
  const targetBytes = Math.max(0, Math.trunc(Number(input.targetBytes) || 0))

  // C1：调用方必须**显式**声明目标存在且是目录（`undefined` 不算 —— 忘了传就判失败，
  // 绝不出现"数字全 0 但校验通过"的假通过）
  if (input.targetIsDirectory !== true || input.targetExists === false) {
    return { ok: false, reason: '目标目录不存在或不是目录' }
  }
  const needFiles = Math.floor(sourceFiles * minRatio)
  const needBytes = Math.floor(sourceBytes * minRatio)
  const missingKeys = []
  if (input.sourceHasPreferences === true && input.targetHasPreferences !== true) {
    missingKeys.push('Default/Preferences')
  }
  if (input.sourceHasCookies === true && input.targetHasCookies !== true) {
    missingKeys.push('Default/Network/Cookies')
  }
  if (targetFiles < needFiles || targetBytes < needBytes || missingKeys.length) {
    const detail =
      `文件数 ${targetFiles}/${sourceFiles}（需 ≥ ${needFiles}）、` +
      `字节 ${targetBytes}/${sourceBytes}（需 ≥ ${needBytes}）` +
      (missingKeys.length ? `、关键文件缺失：${missingKeys.join('、')}` : '')
    return { ok: false, reason: `完整性校验不通过（${detail}）` }
  }
  return { ok: true, reason: '' }
}

// ---------------------------------------------------------------------------
// 迁移意图（schema / 状态机 / 进度汇总）
// ---------------------------------------------------------------------------

/** 意图文件是否为"可续做的迁移意图"（schema/kind/phase/from/to 都合法） */
export function isMigratableIntent(intent) {
  if (!intent || typeof intent !== 'object') return false
  if (Number(intent.schema) !== ROOT_INTENT_SCHEMA) return false
  if (String(intent.kind ?? '') !== ROOT_INTENT_KIND) return false
  if (!MIGRATION_PHASES.includes(String(intent.phase ?? ''))) return false
  if (!String(intent.from ?? '').trim() || !String(intent.to ?? '').trim()) return false
  if (!Array.isArray(intent.items)) return false
  return true
}

/** 新建迁移意图（`phase='pending'`，`conflicts.confirmedAt=null`） */
export function createRootIntent(input = {}) {
  const now =
    input.now instanceof Date
      ? input.now.toISOString()
      : String(input.now ?? new Date().toISOString())
  const items = (Array.isArray(input.items) ? input.items : []).map((item) =>
    normalizeIntentItem(item)
  )
  const intent = {
    schema: ROOT_INTENT_SCHEMA,
    kind: ROOT_INTENT_KIND,
    phase: 'pending',
    from: canonicalRoot(input.from),
    to: canonicalRoot(input.to),
    extId: input.extId ?? EXT_ID,
    version: input.version ?? '1.0.3',
    startedAt: now,
    updatedAt: now,
    conflicts: { confirmedAt: null, confirmedBy: 'user', names: [] },
    items,
    summary: { total: items.length, done: 0, overwritten: 0, skipped: 0, failed: 0, missing: 0 }
  }
  intent.summary = summarize(intent)
  return intent
}

/** 单条意图项的归一（补齐 schema 字段，`backup` 恒为 null —— P1 = B 不做备份） */
export function normalizeIntentItem(item = {}) {
  return {
    name: String(item.name ?? ''),
    status:
      TERMINAL_ITEM_STATUSES.includes(item.status) || ACTIVE_ITEM_STATUSES.includes(item.status)
        ? item.status
        : 'pending',
    reason: String(item.reason ?? ''),
    overwrite: item.overwrite === true,
    backup: null,
    files: Math.max(0, Math.trunc(Number(item.files) || 0)),
    bytes: Math.max(0, Math.trunc(Number(item.bytes) || 0)),
    copiedFiles: Math.max(0, Math.trunc(Number(item.copiedFiles) || 0)),
    copiedBytes: Math.max(0, Math.trunc(Number(item.copiedBytes) || 0)),
    attempts: Math.max(0, Math.trunc(Number(item.attempts) || 0)),
    at: String(item.at ?? '')
  }
}

/** 进度汇总（`overwritten` **单独计数**，可审计性要求） */
export function summarize(intent) {
  const items = Array.isArray(intent?.items) ? intent.items : []
  const counts = {
    done: 0,
    overwritten: 0,
    skipped: 0,
    failed: 0,
    missing: 0,
    pending: 0,
    other: 0
  }
  for (const raw of items) {
    const status = String(raw?.status ?? 'pending')
    if (status in counts) counts[status] += 1
    else counts.other += 1
  }
  return {
    total: items.length,
    done: counts.done,
    overwritten: counts.overwritten,
    skipped: counts.skipped,
    failed: counts.failed,
    missing: counts.missing
  }
}

/** 是否还有未终结的条目（`pending` / `copying` / `verifying`） */
export function hasActiveItems(intent) {
  const items = Array.isArray(intent?.items) ? intent.items : []
  return items.some((item) => ACTIVE_ITEM_STATUSES.includes(String(item?.status ?? '')))
}

/** 是否还有失败项（`failed` **阻塞**写设置 + 删意图；规格 D11） */
export function hasFailedItems(intent) {
  const items = Array.isArray(intent?.items) ? intent.items : []
  return items.some((item) => String(item?.status ?? '') === 'failed')
}

/** 是否还有待用户确认的覆盖项（有 `overwrite` 但确认记录未覆盖它们） */
export function pendingConflicts(intent) {
  const items = Array.isArray(intent?.items) ? intent.items : []
  const names = items
    .filter((item) => item?.overwrite === true && String(item?.status ?? '') !== 'overwritten')
    .map((item) => String(item?.name ?? ''))
  if (!names.length) return []
  return conflictsConfirmed(intent?.conflicts, names) ? [] : names
}

/** 是否达到"全部完成"（无 pending/copying/verifying，且无 failed） */
export function isMigrationComplete(intent) {
  if (!intent || !Array.isArray(intent.items)) return false
  return !hasActiveItems(intent) && !hasFailedItems(intent)
}

/**
 * 把一条"状态变更"写进意图（**返回新对象**，不改入参；调用方负责落盘）。
 * @param {object} intent
 * @param {{ name: string, status: string, reason?: string, overwrite?: boolean,
 *   files?: number, bytes?: number, copiedFiles?: number, copiedBytes?: number }} result
 * @param {{ now?: string, phase?: 'pending'|'running'|'done'|'abandoned' }} [options]
 */
export function applyItemResult(intent, result, options = {}) {
  const next = JSON.parse(JSON.stringify(intent ?? {}))
  next.items = Array.isArray(next.items) ? next.items : []
  const name = String(result?.name ?? '')
  let item = next.items.find((candidate) => String(candidate?.name ?? '') === name)
  if (!item) {
    item = normalizeIntentItem({ name })
    next.items.push(item)
  }
  if (
    result?.status &&
    (TERMINAL_ITEM_STATUSES.includes(result.status) || ACTIVE_ITEM_STATUSES.includes(result.status))
  ) {
    item.status = result.status
  }
  if (result?.reason !== undefined) item.reason = String(result.reason ?? '')
  if (result?.overwrite !== undefined) item.overwrite = result.overwrite === true
  for (const key of ['files', 'bytes', 'copiedFiles', 'copiedBytes']) {
    if (result?.[key] !== undefined) item[key] = Math.max(0, Math.trunc(Number(result[key]) || 0))
  }
  item.attempts =
    Math.max(0, Math.trunc(Number(item.attempts) || 0)) + (result?.status === 'failed' ? 1 : 0)
  item.at = String(options.now ?? new Date().toISOString())
  next.updatedAt = item.at
  if (options.phase) next.phase = options.phase
  else if (next.phase === 'pending') next.phase = 'running'
  next.summary = summarize(next)
  return next
}

/**
 * 迁移状态机推进（规格 P-11）：只做"阶段"的确定性推导，
 * 具体条目状态由 `applyItemResult` 写入。
 * @param {{ phase?: string, items?: Array<{status?: string}> }} intent
 * @returns {{ phase: 'done'|'running'|'pending'|'abandoned', writable: boolean, reason: string }}
 */
export function advanceMigrationState(intent) {
  const phase = String(intent?.phase ?? '')
  if (phase === 'abandoned') return { phase: 'abandoned', writable: false, reason: '已放弃' }
  if (phase === 'done') return { phase: 'done', writable: false, reason: '已完成' }
  if (hasFailedItems(intent)) {
    return { phase: 'running', writable: false, reason: '存在失败项：不写设置、不删源' }
  }
  if (hasActiveItems(intent))
    return { phase: 'running', writable: false, reason: '仍有未搬完的条目' }
  return { phase: 'done', writable: true, reason: '' }
}

// ---------------------------------------------------------------------------
// 迁移状态文本（设置页只读项 `webapp.migrationStatus`，1.0.4）
// ---------------------------------------------------------------------------

/** 没有未完成迁移时的状态文本（设置页只读项；扩展页面不显示迁移信息） */
export const MIGRATION_STATUS_IDLE = '当前无未完成的迁移'
/** 失败原因摘要的长度上限（状态文本要能独立读懂，但不能把整篇错误塞进设置项） */
const STATUS_REASON_LIMIT = 80

/**
 * 迁移状态的**人类可读文本**（纯函数；1.0.4，amendment 09 §3）。
 *
 * 为什么要有它：迁移信息不再上扩展页面（用户决策），改为**只读地**显示在宿主设置页的
 * `webapp.migrationStatus` 字段里。文本必须**能独立读懂**：说清"搬了多少 / 覆盖了几项
 * （不可恢复）/ 有没有失败、失败原因是什么 / 目标根在哪"。
 *
 * ⚠️ **多行用 `\n` 分隔**：宿主（obox ≥ 1.0.9）的 `status` 渲染会把含 `\n` 的值**按行渲染成列表**
 * （`SettingsView.vue` 的 `statusLines()`：非字符串按 `String()`、空值回落占位文案），
 * 比挤在一行里更好读。空闲态因此刻意保持**单行**（[MIGRATION_STATUS_IDLE]）。
 *
 * @param {object|null|undefined} intent 迁移意图（`null` ⇒ [MIGRATION_STATUS_IDLE]）
 * @returns {string}
 */
export function migrationStatusText(intent) {
  if (!intent || typeof intent !== 'object') return MIGRATION_STATUS_IDLE
  const summary = summarize(intent)
  const moved = summary.done + summary.overwritten
  const parts = []
  const phase = String(intent.phase ?? '')
  if (phase === 'abandoned') {
    parts.push('浏览器数据迁移已放弃：设置值已写回旧根')
  } else if (phase === 'done') {
    parts.push(`浏览器数据迁移已完成：已搬 ${moved}/${summary.total}`)
  } else {
    parts.push(`浏览器数据迁移进行中：已搬 ${moved}/${summary.total}`)
  }
  // 覆盖**必须**写明不可恢复：这条路径会先删目标同名目录（用户已知情接受，见 amendment 09 §2）
  if (summary.overwritten > 0) parts.push(`已覆盖 ${summary.overwritten} 项（不可恢复）`)
  if (summary.skipped > 0) parts.push(`跳过 ${summary.skipped} 项`)
  if (summary.failed > 0) {
    const failed = (Array.isArray(intent.items) ? intent.items : []).find(
      (item) => String(item?.status ?? '') === 'failed'
    )
    const reason = String(failed?.reason ?? '').trim()
    const short =
      reason.length > STATUS_REASON_LIMIT ? `${reason.slice(0, STATUS_REASON_LIMIT)}…` : reason
    parts.push(`失败 ${summary.failed} 项${short ? `（${short}）` : ''}`)
  }
  if (phase === 'done') {
    if (intent.to) parts.push(`生效根 = ${String(intent.to)}`)
  } else if (phase === 'abandoned') {
    if (intent.from) parts.push(`当前生效根 = ${String(intent.from)}`)
    parts.push('已经复制到目标根的数据保留在磁盘上，需你自行清理')
  } else if (intent.to) {
    parts.push(`目标根 = ${String(intent.to)}`)
  }
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// 展示辅助
// ---------------------------------------------------------------------------

const MIDDLE_ELLIPSIS = '…'

/**
 * 卡片 `title` 里的"数据目录"文案（规格 §15.2 第 5 条的修订）：
 * 默认根显示相对形态 `chrome/<名>`；自定义根显示 `<根>\<名>`（**根过长时中间省略**，
 * 保留盘符与最后两级，便于用户认出是哪个盘/哪个目录）。
 *
 * @param {{ root?: string|null, isDefault?: boolean, dirName?: unknown, profileName?: unknown }} input
 */
export function formatCardDataDir(input = {}) {
  const rawName = input.profileName === undefined ? input.dirName : input.profileName
  const name = String(rawName ?? '')
  if (input.isDefault !== false && !input.root) return `chrome/${name}`
  const root = canonicalRoot(input.root)
  if (!root) return `chrome/${name}`
  return `${abbreviateRoot(root, 48)}\\${name}`
}

/**
 * 根过长时**中间省略**（保留盘符 / UNC 前缀与末两级）。
 *
 * 关键取舍：省略号**必须出现**（用户要能看出"这里被省略了"），因此中间段至少保留 1 个字符；
 * 若这样仍超长，就退化为"前缀 + … + 末两级"（宁可比上限长几个字符，也不丢末尾的辨识信息）。
 * @param {unknown} root
 * @param {number} [maxLength]
 */
export function abbreviateRoot(root, maxLength = 48) {
  const text = String(root ?? '')
  const sep = text.includes('\\') ? '\\' : '/'
  const parts = text.split(sep).filter((part) => part !== '')
  const unc = isUncPath(text)
  // 至少要有"两级 + 中间一段"才谈得上省略
  if (text.length <= maxLength || parts.length < 4) return text

  const headCount = unc ? 2 : 1
  const prefix = `${unc ? `${sep}${sep}` : ''}${parts.slice(0, headCount).join(sep)}${sep}`
  const tail = parts.slice(-2).join(sep)
  const middleAll = parts.slice(headCount, -2).join(sep)
  const keep = maxLength - prefix.length - tail.length - MIDDLE_ELLIPSIS.length
  const middle = keep >= 1 ? middleAll.slice(0, keep) : ''
  return `${prefix}${middle}${MIDDLE_ELLIPSIS}${tail}`
}

/** 迁移状态行文案（`progressText`；界面与日志共用一份口径） */
export function progressText(summary) {
  const total = Math.max(0, Math.trunc(Number(summary?.total) || 0))
  const done = Math.max(0, Math.trunc(Number(summary?.done) || 0))
  const overwritten = Math.max(0, Math.trunc(Number(summary?.overwritten) || 0))
  const skipped = Math.max(0, Math.trunc(Number(summary?.skipped) || 0))
  const failed = Math.max(0, Math.trunc(Number(summary?.failed) || 0))
  const missing = Math.max(0, Math.trunc(Number(summary?.missing) || 0))
  // X = 已搬完的条目数（done + overwritten）；Y = total
  const moved = done + overwritten
  const parts = [`已搬 ${moved}/${total}`]
  if (overwritten) parts.push(`覆盖 ${overwritten}`)
  if (skipped) parts.push(`跳过 ${skipped}`)
  if (failed) parts.push(`失败 ${failed}`)
  if (missing) parts.push(`缺失 ${missing}`)
  return parts.join('，')
}

/** 根路径的卷根（`D:\a\b` → `D:\`；UNC → `\\server\share`）——仅用于"是否同卷"与日志诊断 */
export function volumeOf(value, env = {}) {
  const platform = env.platform ?? runtimePlatform()
  const text = canonicalRoot(value, { platform })
  if (!text) return ''
  return rootOf(text, platform)
}
