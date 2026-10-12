/**
 * 名称净化与 Windows 目录名规则（纯函数，零依赖；规格 §12.3 的名称文案表 / §14.1 的目录布局 / §24 票 02）。
 *
 * 为什么需要它：条目的 `name` **同时是** `<扩展 data 目录>/chrome/` 下的目录名（R4）。
 * Windows 不允许 `\ / : * ? " < > |`、不允许以点或空格结尾、不允许用保留设备名，
 * 且整条路径有长度上限（本模块按"连路径最多 240 个字符"预算，规格 §12.3）。
 *
 * 口径（规格 S1 的裁定）：
 * - 非法字符替换为 `-`，**连续非法字符合并成一个 `-`**（`a\\\\b` 不会变成 `----`）；
 * - 大小写**原样保留**（`Intranet` 就是 `Intranet`）；大小写不敏感的唯一性由 `lib/webapp.mjs` 负责；
 * - 净化只做"字符合法化"这一件事：**尾部点/空格检查、保留名检查、长度预算都是独立的判定函数**
 *   （`assertNameLength` / `isReservedName`），这样 `suggestName` 能逐个场景给出可用的建议名。
 *
 * 本模块只处理字符串，不碰文件系统。
 */

/** Windows 文件名禁用字符（含控制字符），连续出现时合并成一个 `-` */
const ILLEGAL_RUN = /[\\/:*?"<>|\u0000-\u001f]+/g

/** Windows 保留设备名（不分大小写；`CON.txt` 这种带扩展名的形式同样保留） */
const RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9'
])

/** profile 根目录名（相对扩展 data 目录，规格 §12.1 的 ②） */
export const PROFILE_ROOT = 'chrome'

/** Windows 路径分隔符（长度预算按它算，规格 §12.3 的"连路径最多 240 个字符"） */
export const PATH_SEPARATOR = '\\'

/** 路径长度预算：`<profileRoot>\<name>` 的字符数上限（留出后续文件名与绝对路径前缀的余量） */
export const MAX_PATH_LENGTH = 240

/** 名称净化后为空时的兜底建议名（避免"建议名本身也非法"） */
const EMPTY_SUGGESTION = '网页应用'

/** 长度超预算时的建议后缀（保证截断后的建议名不会与原名撞车） */
const LENGTH_SUGGESTION_SUFFIX = '-应用'

/** 非法字符 / 尾部字符的建议后缀 */
const SUFFIX = '-app'

/**
 * 保留名的建议**前缀**（必须是前缀：后缀法会让 `con.txt` 变成 `con.txt-app`，
 * 其设备名仍是 `CON`，Windows 依然判保留）。
 */
const RESERVED_PREFIX = 'my-'

/**
 * 名称净化：非法字符合并成 `-`、去掉尾部的点与空格。
 * 不做长度截断（截断会让"用户看到的建议名 ≠ 实际目录名"更难解释），也不抛错。
 *
 * @param {unknown} name 原始名称
 * @returns {string} 净化后的名称（可能为空串，表示原名称里没有可用字符）
 */
export function sanitizeName(name) {
  const text = String(name ?? '')
    .replace(ILLEGAL_RUN, '-')
    .replace(/[. ]+$/, '')
    .trim()
  // 整串都是非法字符（`<>|`）→ 只剩一个分隔符，那不是可用的目录名
  return text === '-' ? '' : text
}

/**
 * Windows 保留名的**设备名部分**：`CON.txt` 的设备名是 `CON`（保留），
 * `nul-app.log` 的设备名是 `nul-app`（**不保留**）——Windows 只在"点之前的整段"
 * 恰好等于设备名时才判保留。因此取第一个 `.` 之前的整段，而不是取第一个 `-`/`.` 的片段。
 * @param {unknown} base
 */
function deviceStem(base) {
  return String(base ?? '')
    .split('.')[0]
    .trim()
    .toUpperCase()
}

/**
 * 是否 Windows 保留名（取第一个 `.` 之前的设备名再比较，因此 `CON` 与 `CON.txt` 都算保留名；
 * `con.txt-app`、`my-CON` 不算）。
 * @param {unknown} base 名称（可带扩展名）
 */
export function isReservedName(base) {
  return RESERVED_NAMES.has(deviceStem(base))
}

/**
 * 路径长度预算检查：`<profileRoot><PATH_SEPARATOR><name>` 的字符数必须 ≤ `MAX_PATH_LENGTH`。
 *
 * @param {unknown} name 已净化的名称
 * @param {{ profileRoot?: string, maxLength?: number }} [options]
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function assertNameLength(name, options = {}) {
  const trimmed = String(name ?? '').trim()
  const root = options.profileRoot === undefined ? PROFILE_ROOT : String(options.profileRoot)
  const maxLength = Number.isFinite(options.maxLength)
    ? Math.max(0, Math.trunc(Number(options.maxLength)))
    : MAX_PATH_LENGTH
  const fullLength = root.length + PATH_SEPARATOR.length + trimmed.length
  if (fullLength > maxLength) {
    return { ok: false, message: `名称过长（连路径最多 ${maxLength} 个字符）` }
  }
  return { ok: true }
}

/**
 * 按长度预算截断：返回**已经过预算检查**的名称。
 * 边界（`maxLength === 0`）时返回空串，由调用方用 `EMPTY_SUGGESTION` 兜底。
 *
 * @param {unknown} name
 * @param {{ profileRoot?: string, maxLength?: number }} [options]
 */
export function truncateToBudget(name, options = {}) {
  const root = options.profileRoot === undefined ? PROFILE_ROOT : String(options.profileRoot)
  const maxLength = Number.isFinite(options.maxLength)
    ? Math.max(0, Math.trunc(Number(options.maxLength)))
    : MAX_PATH_LENGTH
  const text = String(name ?? '')
  const budget = maxLength - root.length - PATH_SEPARATOR.length
  if (budget <= 0) return ''
  return text.length > budget ? text.slice(0, budget) : text
}

/**
 * 给出一个**能通过校验**的建议名（规格 §12.3 的多种错误文案都要求附建议名）。
 *
 * 与保留名彻底脱钩的做法：一旦（净化后的）名字是保留名，就**加前缀**而不是加后缀——
 * 后缀会让 `con.txt` 变成 `con.txt-app`，其设备名仍是 `CON`（Windows 依然判保留），
 * 而前缀 `my-con.txt` 的设备名是 `my-con`，一定安全。
 *
 * 依次处置：非法字符 → 空结果 → 保留名 → 尾部点或空格 → 长度超预算；
 * 返回值的自身一致性由 `test/nameSanitize.test.js` 钉住（建议名再净化一次仍可用）。
 *
 * @param {unknown} name 用户输入的原始名称
 * @param {{ profileRoot?: string, maxLength?: number }} [options]
 * @returns {string} 非空建议名
 */
export function suggestName(name, options = {}) {
  const raw = String(name ?? '')
  const hasTrailingIssue = /[. ]$/.test(raw)
  let clean = sanitizeName(raw)

  if (!clean) return EMPTY_SUGGESTION
  if (isReservedName(clean)) clean = `${RESERVED_PREFIX}${clean}`
  // 尾部问题可能由净化本身解决（`名.` → `名`），只在仍必要时追加后缀
  if (hasTrailingIssue && /[. ]$/.test(sanitizeName(clean))) clean = `${clean}${SUFFIX}`
  if (sanitizeName(clean) === '') return EMPTY_SUGGESTION
  if (isReservedName(clean)) return EMPTY_SUGGESTION

  if (assertNameLength(clean, options).ok) return clean

  // 长度超预算：先截断到预算内（后缀也吃预算，故截断时先扣掉），再追加后缀
  const suffix = LENGTH_SUGGESTION_SUFFIX
  const shortened = truncateToBudget(`${clean}${suffix}`, options)
  const suggestion = shortened.endsWith(suffix)
    ? shortened
    : `${truncateToBudget(clean, options).replace(/[. ]+$/, '')}${suffix}`
  const bounded = truncateToBudget(suggestion, options).replace(/[. ]+$/, '')
  return bounded || EMPTY_SUGGESTION
}

/**
 * 大小写不敏感比较键（`Intranet` / `intranet` / `INTRANET` 得到同一个键）。
 * 只做 `toLowerCase()`：`COLLATE NOCASE` 对非 ASCII 是字节比较，"中文名天然区分"。
 * @param {unknown} name
 */
export function nameKey(name) {
  return String(name ?? '')
    .trim()
    .toLowerCase()
}
