/**
 * 条目字段的**共享原语**：两个枚举常量、布尔归一、URL 校验。
 *
 * **为什么单独一个文件**（这是对 spec §9.2 文件清单的一处有意增补）：规格把 `LANG_VALUES` /
 * `SCALE_VALUES` 的单一来源定在 `lib/webapp.mjs`，而参数构造又在 `lib/chromeArgs.mjs` ——
 * 两个模块互相 `import` 会形成 ESM 循环依赖。本机 Node v24.14.0 实测：
 *
 * - 先求值的一方能正常拿到值，但**另一个模块里 `const X = 对方的导出` 这种"求值期派生"
 *   会抛 `ReferenceError: Cannot access 'X' before initialization`**；
 * - 也就是说"只要 import 顺序稍变（谁先被加载）就会炸"，这在打包产物里尤其危险。
 *
 * 因此把**两边都要用、且必须在模块求值期就能读到**的东西下沉到本文件，依赖变成无环的
 * 双向单向：
 *
 * ```
 * entryFields.mjs ──→ (无依赖)
 *       ↑
 * nameSanitize.mjs ──→ (无依赖)
 *       ↑
 * chromeArgs.mjs ──→ entryFields.mjs, nameSanitize.mjs, profileLimits.mjs
 *       ↑
 * webapp.mjs ──→ entryFields.mjs（再导出枚举与 toBool/validateUrl）+ chromeArgs.mjs
 * ```
 *
 * 对外契约没变：`lib/webapp.mjs` 仍然导出 `LANG_VALUES` / `SCALE_VALUES` / `toBool` /
 * `validateUrl`（界面 `src/fields.js` 与其它调用方只认 `webapp.mjs`）。
 */

/**
 * `--lang` 的枚举清单（含空值项 `''` = 不指定）。
 * **P6（待用户微调）**：清单内容可增删，字段形态（select）与参数构造规则不变（规格 §15.2.1）。
 */
export const LANG_VALUES = Object.freeze([
  '',
  'zh-CN',
  'zh-TW',
  'en-US',
  'en-GB',
  'ja-JP',
  'ko-KR',
  'de-DE',
  'fr-FR',
  'es-ES',
  'ru-RU',
  'pt-BR',
  'it-IT'
])

/**
 * `--force-device-scale-factor` 的枚举清单（含空值项 `''` = 不指定）。
 * 恒等于 `0.5 + 0.25k`（k = 0..14）：15 个数值项 + 1 个空值项（规格 §15.2.1）。
 */
export const SCALE_VALUES = Object.freeze([
  '',
  '0.5',
  '0.75',
  '1',
  '1.25',
  '1.5',
  '1.75',
  '2',
  '2.25',
  '2.5',
  '2.75',
  '3',
  '3.25',
  '3.5',
  '3.75',
  '4'
])

/** `unsafely-treat-insecure-origin-as-secure` 的 origin 个数上限（规格 §12.2：最多 8 条） */
export const MAX_EXTRA_ORIGINS = 8

/** 允许的 URL 协议（只做大小写比较，不改写用户输入） */
const ALLOWED_PROTOCOLS = /^https?:$/i

/**
 * URL 校验（规格 §12.4）：trim 后非空、必须以 http/https 开头、`new URL` 能解析、origin 非空、
 * 协议再确认一次（挡 `file:` / `javascript:` / `chrome:` / `data:` / `about:`）。
 *
 * `new URL` 自己会把协议与主机名归一为小写（本机实测：`HTTP://Intranet/A` → `http://intranet/A`）。
 *
 * @param {unknown} value
 * @returns {{ ok: true, value: string, url: URL } | { ok: false, message: string }}
 */
export function validateUrl(value) {
  const text = String(value ?? '').trim()
  if (!text) return { ok: false, message: '网址不能为空' }
  if (!/^https?:\/\//i.test(text)) {
    return { ok: false, message: '网址只能是 http:// 或 https:// 开头' }
  }
  let url
  try {
    url = new URL(text)
  } catch {
    return { ok: false, message: '网址格式不正确' }
  }
  if (!url.origin || url.origin === 'null') return { ok: false, message: '网址格式不正确' }
  if (!ALLOWED_PROTOCOLS.test(url.protocol)) {
    return { ok: false, message: '网址只能是 http:// 或 https:// 开头' }
  }
  return { ok: true, value: text, url }
}

/**
 * 布尔归一：`true` / `1` / `'1'` 都算真（照搬 `extensions/rdp/index.js:48-51` 的 `isTruthyFlag`
 * 口径），另接受 `'true'` / `'yes'` / `'on'` 与 `false` / `0` / `'0'` / `'false'` / `'no'` /
 * `'off'` / 空值。
 *
 * @param {unknown} value
 * @param {boolean} [fallback] 无法判定时的返回值（默认 `false`）
 */
export function toBool(value, fallback = false) {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') {
    if (value === 1) return true
    if (value === 0) return false
    return fallback
  }
  const text = String(value ?? '')
    .trim()
    .toLowerCase()
  if (text === '') return fallback
  if (['1', 'true', 'yes', 'on'].includes(text)) return true
  if (['0', 'false', 'no', 'off'].includes(text)) return false
  return fallback
}
