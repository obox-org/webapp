/**
 * Chrome 参数构造与 origin 推导（纯函数，零依赖；规格 §12 / §24 票 04）。
 *
 * 本模块是 R9–R11 的落点：**参数全部由扩展侧拼装**，助手（`helper.cjs`）只负责
 * "探测 chrome.exe + 校验白名单 + spawn"，不接受任意参数透传（规格 §11.2）。
 *
 * 三个约定（改这里等于改协议）：
 * 1. **顺序固定**（规格 §12.1 的 ①–⑪）：单测逐项断言整个数组，顺序不能"优化"；
 * 2. **`--user-data-dir` 的形态由"根的类别"决定**（规格 §9.2 末的裁定，D2）：
 *    - 生效根 == 默认根（`<扩展 data>/chrome`）⇒ `rootMode: 'relative'`（缺省）产出 `chrome/<净化名>`，
 *      与 1.0.2 逐字一致（助手在 spawn 前解析成绝对路径）；
 *    - 生效根 == 用户配置的自定义根 ⇒ `rootMode: 'absolute'` 产出 `<绝对根>\<净化名>`
 *      （相对形态**无法表达**另一个根：助手 cwd 永远是扩展 data 目录）。
 *    本模块因此仍是纯函数、不依赖运行环境；
 * 3. **空值不传**：`pair` 留空、下拉停在"不指定"（`''`）、布尔未勾选 → 该参数整个不出现，
 *    绝不产出 `--lang=` / `--force-device-scale-factor=` 这种空值形式（规格 §12.1 末段）。
 */
import {
  LANG_VALUES,
  MAX_EXTRA_ORIGINS,
  SCALE_VALUES,
  toBool,
  validateUrl
} from './entryFields.mjs'
import { DEFAULT_DISK_CACHE_MB, diskCacheSizeArg } from './profileLimit.mjs'
import { PROFILE_ROOT, sanitizeName } from './nameSanitize.mjs'
import { canonicalRoot } from './profileRoot.mjs'

export { LANG_VALUES, MAX_EXTRA_ORIGINS, SCALE_VALUES }

/** Chrome 应用模式参数（①，唯一必需的参数） */
export function appArg(url) {
  return `--app=${String(url ?? '')}`
}

/**
 * 每条目独占的 profile 目录参数（②）。
 *
 * @param {unknown} name 条目名（会先净化）
 * @param {{ rootMode?: 'relative'|'absolute', root?: string }} [options]
 *   `rootMode` 缺省 `'relative'`（产出 `chrome/<净化名>`，**既有行为一字不变**）；
 *   `'absolute'` 时产出 `<规范化后的绝对根>\<净化名>`（根为空则退回相对形态，
 *   由助手侧的根校验兜底——扩展侧绝不自己发明一个根）
 * @returns {string} `--user-data-dir=<值>`
 */
export function userDataDirArg(name, options = {}) {
  const dirName = sanitizeName(name)
  const relative = `${PROFILE_ROOT}/${dirName}`
  if (options.rootMode !== 'absolute') return `--user-data-dir=${relative}`
  const root = canonicalRoot(options.root)
  if (!root) return `--user-data-dir=${relative}`
  return `--user-data-dir=${root}\\${dirName}`
}

/** 关闭下载气泡（③，固定参数） */
export const DISABLE_FEATURES_ARG = '--disable-features=DownloadBubble'
/** 关闭证书校验（④，仅 `ignoreCert=true`；TLS 降级，见 README 风险节） */
export const IGNORE_CERT_ARG = '--ignore-certificate-errors'

/** 数字字符串 → 整数（拒绝空串、小数、非数字；`0` 是合法值） */
function toWholeNumber(value) {
  const text = String(value ?? '').trim()
  if (!/^-?\d+$/.test(text)) return null
  return Number.parseInt(text, 10)
}

/**
 * 组合列（`"W,H"` / `"X,Y"`）→ `{ empty, parts }`。
 * ⚠️ 空串必须判成 `empty`：`''.split(',')` 得到 `['']`（长度 1），
 * 直接按"两段各判空"会把它误判成"只填了一半"（本机实测的真 bug）。
 * @param {unknown} value
 */
function pairParts(value) {
  const text = String(value ?? '').trim()
  if (!text) return { empty: true, parts: ['', ''] }
  const parts = text.split(',')
  return { empty: false, parts: [String(parts[0] ?? '').trim(), String(parts[1] ?? '').trim()] }
}

/**
 * 组合列的字段级校验（越界 / 只填一半各给一条文案）。
 * 宽/高的合法区间不同，因此两段各带自己的上下限。
 * @param {unknown} value
 * @param {{
 *   field: string,
 *   incomplete: string,
 *   first: { min: number, max: number, message: string },
 *   second: { min: number, max: number, message: string }
 * }} spec
 * @param {Array<{ field: string, message: string }>} errors
 */
function checkPair(value, spec, errors) {
  const { empty, parts } = pairParts(value)
  if (empty) return
  const filled = parts.map((part) => part !== '')
  if (filled[0] !== filled[1]) {
    errors.push({ field: spec.field, message: spec.incomplete })
    return
  }
  const bounds = [spec.first, spec.second]
  parts.forEach((part, index) => {
    const number = toWholeNumber(part)
    const limit = bounds[index]
    if (number === null || number < limit.min || number > limit.max) {
      errors.push({ field: spec.field, message: limit.message })
    }
  })
}

/**
 * origin 推导（规格 §12.2）：`new URL(url).origin`，精确给出 `协议//主机[:非默认端口]`，
 * 丢弃 userinfo / 路径 / 查询 / 片段。
 *
 * @param {unknown} url 已通过 `validateUrl` 的 URL
 * @returns {string} 形如 `https://10.0.0.5:8443`
 */
export function deriveOrigin(url) {
  return new URL(String(url ?? '').trim()).origin
}

/**
 * 额外 origin 归一（规格 §12.2）：按行拆分、逐行 trim、空行忽略；每行必须是合法 http/https 地址、
 * 且**与主 URL 同协议**；大小写不敏感去重；最多 8 条；恒以主 origin 开头（合并由调用方做）。
 *
 * @param {unknown} text 换行分隔的多行文本（界面 textarea）
 * @param {unknown} mainUrl 主 URL（只用它的协议）
 * @returns {{ origins: string[], errors: Array<{ field: string, message: string }> }}
 */
export function normalizeExtraOrigins(text, mainUrl) {
  const errors = []
  const origins = []
  const seen = new Set()
  const main = String(mainUrl ?? '').trim()
  const mainProtocol = /^https:/i.test(main) ? 'https:' : 'http:'
  let kept = 0

  String(text ?? '')
    .split(/\r?\n/)
    .forEach((line, index) => {
      const text = line.trim()
      if (!text) return
      const lineNumber = index + 1
      let parsed
      try {
        parsed = new URL(text)
      } catch {
        errors.push({
          field: 'extraOrigins',
          message: `额外 origin 第 ${lineNumber} 行不是合法的 http/https 地址`
        })
        return
      }
      if (!/^https?:$/i.test(parsed.protocol) || !parsed.origin || parsed.origin === 'null') {
        errors.push({
          field: 'extraOrigins',
          message: `额外 origin 第 ${lineNumber} 行不是合法的 http/https 地址`
        })
        return
      }
      if (parsed.protocol !== mainProtocol) {
        errors.push({
          field: 'extraOrigins',
          message: `额外 origin 第 ${lineNumber} 行必须与主网址同协议（${mainProtocol}）`
        })
        return
      }
      kept += 1
      if (kept > MAX_EXTRA_ORIGINS) {
        errors.push({ field: 'extraOrigins', message: `额外 origin 最多 ${MAX_EXTRA_ORIGINS} 条` })
        return
      }
      const origin = parsed.origin
      const key = origin.toLowerCase()
      if (seen.has(key)) return
      seen.add(key)
      origins.push(origin)
    })

  return { origins, errors }
}

/**
 * `--unsafely-treat-insecure-origin-as-secure` 的值：英文逗号连接、**不加引号**
 * （规格 §12.1 的 ⑤；主 origin 恒在最前由 `buildChromeArgs` 保证）。
 */
export function insecureOriginValue(origins) {
  return (Array.isArray(origins) ? origins : []).map((item) => String(item)).join(',')
}

/**
 * 字段级校验错误：带 `field`（便于界面定位到具体控件）。
 * `buildChromeArgs` 的入参非法时抛它——**不返回"半个参数数组"**
 * （规格 §18.1：「`pair` 只填一半 → 返回字段级错误而非部分参数」）。
 */
export class ChromeArgsError extends Error {
  /** @param {Array<{ field: string, message: string }>} errors */
  constructor(errors) {
    const list =
      Array.isArray(errors) && errors.length ? errors : [{ field: '', message: '参数非法' }]
    super(list.map((error) => error.message).join('；'))
    this.name = 'ChromeArgsError'
    /** @type {Array<{ field: string, message: string }>} */
    this.errors = list
  }
}

/**
 * 白名单字段校验（规格 §12.3；两个下拉在 D-3 之后是**枚举成员校验**，不再做区间/正则）。
 *
 * @param {Record<string, unknown>} entry 已归一的条目（`lib/webapp.mjs` 的 `normalizeWebapp` 产物）
 * @returns {Array<{ field: string, message: string }>} 空数组 = 全部合法
 */
export function validateWhitelistFields(entry) {
  const source = entry && typeof entry === 'object' ? entry : {}
  const errors = []

  checkPair(
    source.windowSize,
    {
      field: 'windowSize',
      incomplete: '窗口宽高必须同时填写或同时留空',
      first: { min: 320, max: 7680, message: '窗口宽度必须是 320–7680 的整数' },
      second: { min: 240, max: 4320, message: '窗口高度必须是 240–4320 的整数' }
    },
    errors
  )

  checkPair(
    source.windowPos,
    {
      field: 'windowPos',
      incomplete: '窗口位置必须同时填写或同时留空',
      first: { min: -10000, max: 10000, message: '窗口左坐标必须是 -10000–10000 的整数' },
      second: { min: -10000, max: 10000, message: '窗口上坐标必须是 -10000–10000 的整数' }
    },
    errors
  )

  // 两个下拉：必须**原样**是清单里的字符串（`'1.5'` 合法；number 的 `1.5`、`'1.50'` 都不合法）
  const lang = source.lang
  if (!(lang === undefined || lang === null || lang === '' || LANG_VALUES.includes(lang))) {
    errors.push({ field: 'lang', message: '界面语言不在可选清单内（请从下拉中选择）' })
  }
  const scale = source.scaleFactor
  if (!(scale === undefined || scale === null || scale === '' || SCALE_VALUES.includes(scale))) {
    errors.push({ field: 'scaleFactor', message: '缩放比例不在可选清单内（请从下拉中选择）' })
  }

  return errors
}

/**
 * 构造 Chrome 参数数组（规格 §12.1；顺序固定，单测逐项断言）。
 *
 * @param {Record<string, unknown>} entry 条目（`normalizeWebapp` 产物或其等价字段集）
 * @param {{ profileName?: string, diskCacheMb?: unknown,
 *   rootMode?: 'relative'|'absolute', root?: string }} [options]
 *        `profileName` 覆盖目录名（默认取 `entry.name`；改名时用旧目录名）；
 *        `diskCacheMb` = 设置 `webapp.diskCacheMb`（MB；`0` = **不传** `--disk-cache-size`）；
 *        `rootMode` / `root` = 生效根的类别与绝对路径（规格 §9.2 末；缺省 = 默认根的相对形态）
 * @returns {string[]} 交给 `spawn(chromeExe, args)` 的数组
 * @throws {ChromeArgsError} 入参不合法（绝不返回"部分参数"）
 */
export function buildChromeArgs(entry, options = {}) {
  const source = entry && typeof entry === 'object' ? entry : {}
  const errors = []

  // ① --app=<url>
  const checked = validateUrl(source.url)
  if (!checked.ok) errors.push({ field: 'url', message: checked.message })

  // ② --user-data-dir=chrome/<净化名>（默认根）或 <绝对根>\<净化名>（自定义根）
  const rawName = options.profileName === undefined ? source.name : options.profileName
  const profileName = sanitizeName(rawName)
  if (!profileName) errors.push({ field: 'name', message: '名称不能为空' })
  // 自定义根必须是绝对路径：这里**明确拒绝**而不是静默退回相对形态
  // （退回会让数据悄悄落在默认根，比直接报错危险得多）
  if (options.rootMode === 'absolute' && !canonicalRoot(options.root)) {
    errors.push({ field: 'profileRoot', message: '自定义根必须是绝对路径' })
  }

  // ④⑤ ignoreCert：额外 origin 只在这条路径上才有意义
  const ignoreCert = toBool(source.ignoreCert)
  let extraOrigins = []
  if (ignoreCert && checked.ok) {
    const normalized = normalizeExtraOrigins(source.extraOrigins, checked.value)
    errors.push(...normalized.errors)
    extraOrigins = normalized.origins
  }

  // ⑥–⑪ 白名单开关
  errors.push(...validateWhitelistFields(source))

  if (errors.length) throw new ChromeArgsError(errors)

  const args = [
    appArg(checked.value),
    userDataDirArg(profileName, { rootMode: options.rootMode, root: options.root }),
    DISABLE_FEATURES_ARG
  ]

  // ⑥ HTTP 缓存上限（R17）：按设置产出；`0` = **不传该参数**（用 Chrome 默认）
  const diskCacheMb =
    options.diskCacheMb === undefined ? DEFAULT_DISK_CACHE_MB : options.diskCacheMb
  const diskCacheArg = diskCacheSizeArg(diskCacheMb)
  if (diskCacheArg) args.push(diskCacheArg)

  if (ignoreCert) {
    args.push(IGNORE_CERT_ARG)
    // 主 origin **恒在最前**；额外 origin 与主 origin 之间**也要去重**——
    // 把主 origin 顺手写进"额外 origin"字段是很常见的手误，重复拼两遍
    // 会让 Chrome 收到两个相同的 origin（无害但脏，且让 `--unsafely…` 的值不可预期地变长）。
    const mainOrigin = deriveOrigin(checked.value)
    const merged = [mainOrigin]
    const seenOrigins = new Set([mainOrigin.toLowerCase()])
    for (const origin of extraOrigins) {
      const key = String(origin).toLowerCase()
      if (seenOrigins.has(key)) continue
      seenOrigins.add(key)
      merged.push(origin)
    }
    args.push(`--unsafely-treat-insecure-origin-as-secure=${insecureOriginValue(merged)}`)
  }

  const size = pairParts(source.windowSize)
  if (!size.empty) {
    args.push(`--window-size=${toWholeNumber(size.parts[0])},${toWholeNumber(size.parts[1])}`)
  }
  const position = pairParts(source.windowPos)
  if (!position.empty) {
    args.push(
      `--window-position=${toWholeNumber(position.parts[0])},${toWholeNumber(position.parts[1])}`
    )
  }
  if (toBool(source.startMaximized)) args.push('--start-maximized')
  if (String(source.lang ?? '').trim()) args.push(`--lang=${String(source.lang).trim()}`)
  if (String(source.scaleFactor ?? '').trim()) {
    args.push(`--force-device-scale-factor=${String(source.scaleFactor).trim()}`)
  }
  if (toBool(source.disableGpu)) args.push('--disable-gpu')

  return args
}

/** 子串脱敏：`http://user:pw@h/` → `http://***@h/`（参数里可能带 userinfo，日志不得输出它） */
export function maskUserInfo(text) {
  return String(text ?? '').replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)[^/@\s]*@/g, '$1***@')
}

/**
 * `launch` 的日志摘要（规格 §16「日志只记摘要」）：**不打印完整命令行**，
 * 且 URL 里的 userinfo 必须脱敏为 `***`。
 *
 * @param {{ exe?: string, args?: string[] }} input
 * @returns {string} 形如 `exe=C:\…\chrome.exe 参数=5 个 profile=chrome/内网 url=https://***@h/`
 */
export function describeLaunch(input = {}) {
  const exe = maskUserInfo(input.exe ?? '')
  const args = Array.isArray(input.args) ? input.args : []
  const appValue = args.find((arg) => String(arg).startsWith('--app='))
  const url = appValue === undefined ? '' : maskUserInfo(String(appValue).slice('--app='.length))
  const dirValue = args.find((arg) => String(arg).startsWith('--user-data-dir='))
  const profile = dirValue === undefined ? '' : String(dirValue).slice('--user-data-dir='.length)
  return `exe=${exe} 参数=${args.length} 个 profile=${profile} url=${url}`
}
