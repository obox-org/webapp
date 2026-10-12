/**
 * 条目的归一、校验与库行互转（纯函数，零依赖；规格 §12.2 / §12.3 / §13 / §24 票 03）。
 *
 * 三条不可动摇的口径：
 * 1. **白名单归一**：只保留已知列，未知键一律丢弃（R11 的"白名单之外一律拒绝保存"第一层）；
 * 2. **每一列都必须产出具体值**：`api.sqlite` 的列类型由**首次 insert 的 JS 类型**推断
 *    （`src/main/sqliteCore.ts:125-129,173-197`），漏字段会把列漂成 TEXT；布尔列一律给真
 *    `boolean`（宿主按 boolean 列类型读写往返）；
 * 3. **枚举单一来源**：`LANG_VALUES` / `SCALE_VALUES` 的定义在 `lib/chromeArgs.mjs`，
 *    本文件**原样再导出**（界面 `src/fields.js` 只从本文件取）。
 *
 * 依赖方向严格单向：`webapp.mjs → chromeArgs.mjs → nameSanitize.mjs`。
 * （规格 §12.3 把枚举的"单一来源"写在本文件；按字面实现会形成 `webapp ⇄ chromeArgs` 的
 * ESM 循环依赖——本机 Node v24.14.0 实测先求值的一方会抛 `ReferenceError: Cannot access … before
 * initialization`。因此定义放在 `chromeArgs.mjs`、这里再导出：对外契约与界面取用点都没变，
 * 只有"定义字面位置"变了。`test/webapp.test.js` 钉住再导出与定义逐项相等。）
 */
import {
  LANG_VALUES as LANG_ENUM,
  MAX_EXTRA_ORIGINS as EXTRA_ORIGINS_LIMIT,
  SCALE_VALUES as SCALE_ENUM,
  toBool as toBoolImpl,
  validateUrl as validateUrlImpl
} from './entryFields.mjs'
import { normalizeExtraOrigins, validateWhitelistFields } from './chromeArgs.mjs'
import {
  assertNameLength,
  isReservedName,
  nameKey,
  sanitizeName,
  suggestName
} from './nameSanitize.mjs'

/** `--lang` 的枚举清单（含空值项 `''` = 不指定）；**P6 待微调**，只影响清单内容。 */
export const LANG_VALUES = LANG_ENUM

/**
 * `--force-device-scale-factor` 的枚举清单（含空值项 `''` = 不指定）。
 * 恒等于 `0.5 + 0.25k`（k = 0..14）：15 个数值项 + 1 个空值项（规格 §15.2.1）。
 */
export const SCALE_VALUES = SCALE_ENUM

/** `unsafely-treat-insecure-origin-as-secure` 的 origin 个数上限（规格 §12.2：最多 8 条） */
export const MAX_EXTRA_ORIGINS = EXTRA_ORIGINS_LIMIT

/** URL 校验（规格 §12.4）；实现在 `lib/entryFields.mjs`，这里再导出以保持对外契约。 */
export const validateUrl = validateUrlImpl

/** 布尔归一（`true`/`1`/`'1'` 都算真）；实现在 `lib/entryFields.mjs`。 */
export const toBool = toBoolImpl

/** 字符串列（空值一律 `''`，绝不 `undefined`） */
export const STRING_KEYS = Object.freeze([
  'name',
  'url',
  'desc',
  'extraOrigins',
  'windowSize',
  'windowPos',
  'lang',
  'scaleFactor',
  'profileDir'
])

/** 布尔列（空值一律 `false`，写入时给真 boolean） */
export const BOOLEAN_KEYS = Object.freeze(['ignoreCert', 'startMaximized', 'disableGpu'])

/** 时间戳列（由调用方在写入时补，`toDbRow` 默认不带） */
export const TIMESTAMP_KEYS = Object.freeze(['createdAt', 'updatedAt'])

/** 白名单开关的字段名（R11；界面 `src/fields.js` 的高级区与此一一对应） */
export const WHITELIST_KEYS = Object.freeze([
  'windowSize',
  'windowPos',
  'startMaximized',
  'lang',
  'scaleFactor',
  'disableGpu'
])

/** 表列清单（顺序与 §13.2 的表结构一致；`id` 由库生成，不在归一产物里） */
export const COLUMNS = Object.freeze([...STRING_KEYS, ...BOOLEAN_KEYS])

/** 说明字段的长度上限（规格 §12.3「说明最多 120 个字符」） */
export const MAX_DESC_LENGTH = 120

/** 组合列 `"W,H"` / `"X,Y"` 允许的写法（数字、可有前后空白；空值表示留空） */
const PAIR_RE = /^\s*-?\d+\s*,\s*-?\d+\s*$|^\s*$/

/**
 * 字符串归一：去首尾空白（名称/网址/说明都不该带空白），保留内部原样。
 *
 * ⚠️ **非字符串（number）也转成字符串**，因为"每一列都必须有具体值、且类型稳定"优先；
 * "下拉不该接受 number 形态"这条由 `validateWebapp` 的**类型守卫**兜底（见该函数注释）。
 */
function str(value) {
  return String(value ?? '').trim()
}

/**
 * 组合列归一（规格 S5：一列存两个数）：
 * - 空 → `''`（不传该参数）；
 * - 非空但不是 `"n,n"` 形态 → 原样保留，交给 `validateWhitelistFields` 给字段级文案
 *   （归一阶段不改写用户输入，避免"校验文案与用户看到的值不一致"）。
 * @param {unknown} value
 */
function pairStr(value) {
  const text = str(value)
  if (!text) return ''
  if (!PAIR_RE.test(text)) return text
  const [first, second] = text.split(',')
  return `${first.trim()},${second.trim()}`
}

/**
 * 输入 → 归一化条目：**只保留已知列**，每一列都有具体值（规格 §13.2）。
 *
 * @param {unknown} input 界面载荷 / 库行 / 部分字段
 * @returns {{
 *   id?: number, name: string, url: string, desc: string, ignoreCert: boolean,
 *   extraOrigins: string, windowSize: string, windowPos: string, startMaximized: boolean,
 *   lang: string, scaleFactor: string, disableGpu: boolean, profileDir: string
 * }}
 */
export function normalizeWebapp(input) {
  const src = input && typeof input === 'object' ? input : {}
  /** @type {Record<string, unknown>} */
  const entry = {}

  const id = Number(src.id)
  if (src.id !== undefined && src.id !== null && src.id !== '' && Number.isFinite(id)) {
    entry.id = id
  }

  entry.name = str(src.name)
  entry.url = str(src.url)
  entry.desc = str(src.desc)
  // 默认 true（R3）：只有显式给了 0/false/'0'/'false' 才关掉
  entry.ignoreCert =
    src.ignoreCert === undefined || src.ignoreCert === null || src.ignoreCert === ''
      ? true
      : toBool(src.ignoreCert)
  entry.extraOrigins = String(src.extraOrigins ?? '')
    .replace(/\r\n/g, '\n')
    .trim()
  entry.windowSize = pairStr(src.windowSize)
  entry.windowPos = pairStr(src.windowPos)
  entry.startMaximized = toBool(src.startMaximized)
  entry.lang = str(src.lang)
  entry.scaleFactor = str(src.scaleFactor)
  entry.disableGpu = toBool(src.disableGpu)
  entry.profileDir = str(src.profileDir)

  return entry
}

/**
 * 白名单开关的枚举校验：`lib/chromeArgs.mjs` 的 `validateWhitelistFields` 是唯一实现。
 *
 * ⚠️ **枚举成员校验必须看"原值"而不是归一值**：`normalizeWebapp` 把字符串列统一转成字符串
 * （保证列类型稳定），于是 number 形态的 `1.5` 会变成看起来合法的 `'1.5'`——而规格 §18.1
 * 明确要求 **number 的 `1.5`** 报字段级错误（存储形态只接受字符串枚举）。
 * 因此对两个下拉字段做类型守卫：原值不是字符串（也不是空）时，把原值传下去让它被判非法。
 *
 * @param {Record<string, unknown>} entry 归一后的条目
 * @param {Record<string, unknown>} raw 调用方原始输入（用于类型守卫）
 */
function whitelistErrors(entry, raw) {
  const passed = {}
  for (const key of WHITELIST_KEYS) passed[key] = entry?.[key]
  for (const key of ['lang', 'scaleFactor']) {
    const value = raw?.[key]
    if (value === undefined || value === null || value === '' || typeof value === 'string') continue
    passed[key] = value
  }
  return validateWhitelistFields(passed)
}

/**
 * 校验归一后的条目（规格 §12.3 的文案表；**文案必须与界面 `src/fields.js` 逐字一致**）。
 *
 * 顺序即用户看到的第一条错误的优先级：名称 → 网址 → 说明 → 额外 origin → 白名单开关。
 *
 * @param {ReturnType<typeof normalizeWebapp>} entry 归一后的条目
 * @param {Array<Record<string, unknown>>} [rows] 现有库行（判名称大小写不敏感唯一；编辑时按 id 排除自己）
 * @param {{ profileRoot?: string, raw?: Record<string, unknown> }} [options]
 *        `raw` 传原始输入时，两个下拉字段会按"原始类型"校验（number 判非法）
 * @returns {{ ok: boolean, errors: Array<{ field: string, message: string }> }}
 */
export function validateWebapp(entry, rows = [], options = {}) {
  const errors = []
  // ⚠️ 名称的"尾部点/空格""非法字符"必须按**原始输入**判，且这里**不能 trim**：
  // 归一后的 `entry.name` 已被 trim，用它判尾空格必然漏（`'站点 '` 会看起来合法）；
  // 而 Trim 后的 rawName 同样会把尾部空格吃掉，所以原值原样保留、只在算长度时 trim。
  const rawName = String(options.raw?.name ?? entry?.name ?? '')
  const trimmedName = rawName.trim()
  const clean = sanitizeName(trimmedName)
  // 非法字符是**拒绝**而不是静默净化：否则用户填 `a<b` 会得到目录名 `a-b`，
  // 界面显示的 name 与磁盘目录名不一致（"目录跟随 name"的前提就是两者一致）。
  const illegalChar = /[\\/:*?"<>|\u0000-\u001f]/.test(trimmedName)
  const suggestionOptions =
    options.profileRoot === undefined ? {} : { profileRoot: options.profileRoot }

  if (!trimmedName) {
    errors.push({ field: 'name', message: '名称不能为空' })
  } else if (!clean || illegalChar) {
    errors.push({
      field: 'name',
      message: `名称包含不能用于目录的字符，建议改为：${suggestName(rawName, suggestionOptions)}`
    })
  } else if (isReservedName(clean)) {
    errors.push({
      field: 'name',
      message: `名称不能是 Windows 保留名（CON/PRN/AUX/NUL/COM1-9/LPT1-9，不分大小写），建议改为：${suggestName(
        rawName,
        suggestionOptions
      )}`
    })
  } else if (/[. ]$/.test(rawName)) {
    errors.push({
      field: 'name',
      message: `名称不能以点或空格结尾，建议改为：${suggestName(rawName, suggestionOptions)}`
    })
  } else if (!assertNameLength(clean, suggestionOptions).ok) {
    errors.push({
      field: 'name',
      message: `名称过长（连路径最多 240 个字符），建议改为：${suggestName(rawName, suggestionOptions)}`
    })
  } else {
    const selfId = entry?.id === undefined ? '' : String(entry.id)
    const duplicated = (Array.isArray(rows) ? rows : []).some((row) => {
      const rowId = row?.id === undefined ? '' : String(row.id)
      return rowId !== selfId && nameKey(row?.name) === nameKey(clean)
    })
    if (duplicated) errors.push({ field: 'name', message: `名称「${clean}」已存在，请换一个` })
  }

  const checkedUrl = validateUrl(entry?.url)
  if (!checkedUrl.ok) errors.push({ field: 'url', message: checkedUrl.message })

  if (String(entry?.desc ?? '').length > MAX_DESC_LENGTH) {
    errors.push({ field: 'desc', message: `说明最多 ${MAX_DESC_LENGTH} 个字符` })
  }

  // 额外 origin 只在"忽略证书"开启且网址合法时才有意义（关掉证书忽略时它不会被拼进参数）
  if (checkedUrl.ok && toBool(entry?.ignoreCert)) {
    // ⚠️ 行号必须按**原始输入**算：`normalizeWebapp` 会 trim 掉首尾换行，
    // 用归一值算行号会把"第 2 行"报成"第 1 行"（单测钉住这条）。
    const rawOrigins = options.raw?.extraOrigins ?? entry?.extraOrigins
    const normalized = normalizeExtraOrigins(rawOrigins, checkedUrl.value)
    errors.push(...normalized.errors)
  }

  errors.push(...whitelistErrors(entry, options.raw ?? entry))

  return { ok: errors.length === 0, errors }
}

/**
 * 归一化条目 → 数据库行（只含表列；按需补时间戳）。
 *
 * ⚠️ `desc` 是 SQL 关键字，宿主的 `ident()` 会用双引号包裹（`src/main/sqliteCore.ts:138-142`），
 * 可以安全使用；但**不要**在任何手写 SQL 里裸写它。
 *
 * @param {unknown} input
 * @param {{ createdAt?: string, updatedAt?: string }} [timestamps]
 */
export function toDbRow(input, timestamps = {}) {
  const entry = normalizeWebapp(input)
  /** @type {Record<string, unknown>} */
  const row = {}
  for (const key of COLUMNS) row[key] = entry[key]
  if (entry.id !== undefined) row.id = entry.id
  return { ...row, ...timestamps }
}

/**
 * 数据库行 → 界面用条目（布尔列重新归一成真 boolean：宿主读回的是 0/1 还是 boolean 都不影响）。
 * 未知列（未来版本新增、旧版本读到）原样带上，界面不认就不渲染。
 */
export function fromDbRow(row) {
  const entry = normalizeWebapp(row)
  const id = row && typeof row === 'object' ? Number(row.id) : Number.NaN
  if (Number.isFinite(id)) entry.id = id
  for (const key of TIMESTAMP_KEYS) {
    if (row && typeof row === 'object' && row[key] !== undefined) entry[key] = String(row[key])
  }
  return entry
}
