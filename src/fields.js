/**
 * 表单字段表 + 校验 + 载荷构造（纯函数；规格 §15.2 的字段集与 §12.3 的文案表）。
 *
 * 三条口径：
 * 1. **两个下拉（`lang` / `scaleFactor`）的取值来自 `lib/webapp.mjs` 的枚举**
 *    （`LANG_VALUES` / `SCALE_VALUES`），界面不再自己抄一份（防两处漂移）；
 * 2. **字段级文案与后端 `lib/webapp.mjs` 的 `validateWebapp` 逐字一致**，
 *    且**错误键集合必须完全相同**（`test/fields.test.js` 钉住）；
 * 3. **`buildSavePayload` 只从表单已知字段构建载荷**（R11 的"白名单之外一律拒绝保存"第三层）。
 */
import {
  LANG_VALUES,
  MAX_DESC_LENGTH,
  SCALE_VALUES,
  WHITELIST_KEYS,
  normalizeWebapp,
  validateWebapp
} from '../lib/webapp.mjs'

/** 下拉的选项对象：`value`/`label`/`desc` 都非空（`test/fieldDocs.test.js` 钉住） */
function optionsFrom(values, labels, descriptions) {
  return values
    .filter((value) => value !== '')
    .map((value) => ({
      value,
      label: labels[value],
      desc: descriptions[value]
    }))
}

const LANG_LABELS = {
  'zh-CN': '简体中文（中国大陆）',
  'zh-TW': '繁体中文（台湾）',
  'en-US': '英语（美国）',
  'en-GB': '英语（英国）',
  'ja-JP': '日语',
  'ko-KR': '韩语',
  'de-DE': '德语',
  'fr-FR': '法语',
  'es-ES': '西班牙语',
  'ru-RU': '俄语',
  'pt-BR': '葡萄牙语（巴西）',
  'it-IT': '意大利语'
}
const LANG_DESCS = {
  'zh-CN': '常见企业内网系统的默认语言',
  'zh-TW': '台湾地区常用',
  'en-US': '英文界面（美国）',
  'en-GB': '英文界面（英国）',
  'ja-JP': '日文界面',
  'ko-KR': '韩文界面',
  'de-DE': '德文界面',
  'fr-FR': '法文界面',
  'es-ES': '西班牙文界面',
  'ru-RU': '俄文界面',
  'pt-BR': '葡萄牙文（巴西）界面',
  'it-IT': '意大利文界面'
}

const SCALE_LABELS = {
  0.5: '极小',
  0.75: '小',
  1: '100%（默认）',
  1.25: '125%',
  1.5: '150%（推荐，常见笔记本）',
  1.75: '175%',
  2: '200%',
  2.25: '225%',
  2.5: '250%',
  2.75: '275%',
  3: '300%',
  3.25: '325%',
  3.5: '350%',
  3.75: '375%',
  4: '400%（上限）'
}
const SCALE_DESCS = {
  0.5: '界面缩到一半，字很小',
  0.75: '略小于默认',
  1: '不缩放（100%）',
  1.25: '轻微放大',
  1.5: '常见笔记本高 DPI 屏的合适值',
  1.75: '较大',
  2: '200% 放大',
  2.25: '225% 放大',
  2.5: '250% 放大',
  2.75: '275% 放大',
  3: '300% 放大',
  3.25: '325% 放大',
  3.5: '350% 放大',
  3.75: '375% 放大',
  4: '上限（400%）'
}

/** 空值选项的统一文案（`value=""` 排在最前） */
export const EMPTY_OPTION_LABEL = '不指定（用 Chrome 默认）'

/** 常用分组（规格 §15.2 的字段集） */
export const COMMON_GROUPS = [
  {
    title: '基本信息',
    fields: [
      {
        key: 'name',
        label: '名称',
        type: 'text',
        required: true,
        desc: '条目的显示名，同时作为浏览器数据目录名。'
      },
      {
        key: 'url',
        label: '网址',
        type: 'text',
        required: true,
        desc: '只能填 http:// 或 https:// 开头的地址。'
      },
      {
        key: 'desc',
        label: '说明',
        type: 'text',
        desc: `一句话备注，显示在列表里（最多 ${MAX_DESC_LENGTH} 字）。`
      },
      {
        key: 'ignoreCert',
        label: '忽略证书问题',
        type: 'check',
        desc: '开启后 Chrome 不再校验该站点的证书（TLS 已降级），且该站点被当作安全上下文。',
        warnWhenChecked: '⚠ 已关闭该站点的证书校验（TLS 降级）'
      },
      {
        key: 'extraOrigins',
        label: '额外 origin',
        type: 'textarea',
        rows: 4,
        desc: '每行一个 origin，用于同一个应用窗口要访问多个自签证书站点的场景；最多 8 条。'
      }
    ]
  }
]

/** 高级分组（「▸ 高级选项」折叠区） */
export const ADVANCED_GROUPS = [
  {
    title: '窗口与显示',
    fields: [
      {
        key: 'windowSize',
        label: '窗口尺寸',
        type: 'pair',
        keys: ['windowSizeW', 'windowSizeH'],
        units: ['宽', '高'],
        desc: '留空即用 Chrome 默认；两者必须同时填。'
      },
      {
        key: 'windowPos',
        label: '窗口位置',
        type: 'pair',
        keys: ['windowPosX', 'windowPosY'],
        units: ['左', '上'],
        desc: '多显示器时可指定；允许负值；两者必须同时填。'
      },
      {
        key: 'startMaximized',
        label: '启动即最大化',
        type: 'check',
        desc: '勾选后窗口以最大化打开。'
      },
      {
        key: 'lang',
        label: '界面语言',
        type: 'select',
        optional: true,
        emptyLabel: EMPTY_OPTION_LABEL,
        emptyDesc: '不加 --lang，语言随系统/浏览器设置',
        options: optionsFrom(LANG_VALUES, LANG_LABELS, LANG_DESCS),
        desc: '指定该应用窗口的界面语言；不指定即随系统。'
      },
      {
        key: 'scaleFactor',
        label: '缩放比例',
        type: 'select',
        optional: true,
        emptyLabel: EMPTY_OPTION_LABEL,
        emptyDesc: '不加 --force-device-scale-factor，跟随系统 DPI',
        options: optionsFrom(SCALE_VALUES, SCALE_LABELS, SCALE_DESCS),
        desc: '高 DPI 屏上字太大/太小时调整；不指定即随系统 DPI。'
      },
      {
        key: 'disableGpu',
        label: '禁用 GPU 加速',
        type: 'check',
        desc: '显卡驱动异常导致窗口花屏时勾选。'
      }
    ]
  }
]

/** 全部字段（含高级区），顺序与界面一致 */
export const ALL_FIELDS = [
  ...COMMON_GROUPS.flatMap((group) => group.fields),
  ...ADVANCED_GROUPS.flatMap((group) => group.fields)
]

/** 字段表索引：key → field */
export const FIELD_BY_KEY = Object.fromEntries(ALL_FIELDS.map((field) => [field.key, field]))

/** 表单默认值（R3：`ignoreCert` 默认勾选；两个下拉默认"不指定"） */
export function defaultForm() {
  /** @type {Record<string, unknown>} */
  const form = {
    name: '',
    url: '',
    desc: '',
    ignoreCert: true,
    extraOrigins: '',
    windowSizeW: '',
    windowSizeH: '',
    windowPosX: '',
    windowPosY: '',
    startMaximized: false,
    lang: '',
    scaleFactor: '',
    disableGpu: false
  }
  return form
}

/** `"W,H"` → 两个格子；空或非法 → 两个空格子（界面上让用户重填） */
function splitPair(value) {
  const text = String(value ?? '').trim()
  if (!text) return ['', '']
  const parts = text.split(',')
  return [String(parts[0] ?? '').trim(), String(parts[1] ?? '').trim()]
}

/**
 * 库行 → 表单值（布尔 → 勾选、`"W,H"` → pair 两格、两个下拉原样回填当前值）。
 * @param {Record<string, unknown>} row
 */
export function rowToForm(row) {
  const source = row && typeof row === 'object' ? row : {}
  const form = defaultForm()
  form.name = String(source.name ?? '')
  form.url = String(source.url ?? '')
  form.desc = String(source.desc ?? '')
  form.ignoreCert = source.ignoreCert === undefined ? true : Boolean(source.ignoreCert)
  form.extraOrigins = String(source.extraOrigins ?? '')
  const [width, height] = splitPair(source.windowSize)
  form.windowSizeW = width
  form.windowSizeH = height
  const [left, top] = splitPair(source.windowPos)
  form.windowPosX = left
  form.windowPosY = top
  form.startMaximized = Boolean(source.startMaximized)
  form.lang = String(source.lang ?? '')
  form.scaleFactor = String(source.scaleFactor ?? '')
  form.disableGpu = Boolean(source.disableGpu)
  if (source.id !== undefined && source.id !== null && source.id !== '') {
    form.id = source.id
  }
  return form
}

/** 两个格子 → `"a,b"`；任一为空 → `''`（交给校验判"必须同时填"） */
function joinPair(first, second) {
  const a = String(first ?? '').trim()
  const b = String(second ?? '').trim()
  if (!a && !b) return ''
  return `${a},${b}`
}

/**
 * 表单 → 保存载荷（**只从已知字段构建**：额外键进不来）。
 * @param {Record<string, unknown>} form
 */
export function buildSavePayload(form) {
  const source = form && typeof form === 'object' ? form : {}
  /** @type {Record<string, unknown>} */
  const payload = {
    name: String(source.name ?? '').trim(),
    url: String(source.url ?? '').trim(),
    desc: String(source.desc ?? ''),
    ignoreCert: Boolean(source.ignoreCert),
    extraOrigins: String(source.extraOrigins ?? ''),
    windowSize: joinPair(source.windowSizeW, source.windowSizeH),
    windowPos: joinPair(source.windowPosX, source.windowPosY),
    startMaximized: Boolean(source.startMaximized),
    lang: String(source.lang ?? ''),
    scaleFactor: String(source.scaleFactor ?? ''),
    disableGpu: Boolean(source.disableGpu)
  }
  if (source.id !== undefined && source.id !== null && source.id !== '') payload.id = source.id
  return payload
}

/**
 * 界面侧校验：**委托后端的同一条实现**（`lib/webapp.mjs` 的 `validateWebapp`），
 * 保证两边的**错误键集合与文案逐字一致**（R-W8 的落点）。
 *
 * 为什么不是"界面再抄一份规则"：那正是 W8 风险（两处漂移）。这里只负责把表单形状
 * 转成后端认识的条目载荷，规则本身只有一份。
 *
 * @param {Record<string, unknown>} form
 * @param {Array<Record<string, unknown>>} [rows] 现有行（判名称唯一；编辑时按 id 排除自己）
 * @returns {{ ok: boolean, errors: Array<{ field: string, message: string }> }}
 */
export function validate(form, rows = []) {
  const payload = buildSavePayload(form)
  const entry = normalizeWebapp(payload)
  return validateWebapp(entry, rows, { raw: payload })
}

/**
 * 字段是否可见。webapp 的字段**全部恒可见**（没有条件字段），
 * 保留这个入口是为了与 rdp 的表单结构同构、并让模板不必内联判断。
 */
export function isFieldVisible() {
  return true
}

/** 按可见性过滤一组字段（模板用它渲染，保证"显示什么"与"提交什么"同源） */
export function visibleFields(group) {
  return (group?.fields ?? []).filter((field) => isFieldVisible(field))
}

/** 白名单开关的字段名（后端 `WHITELIST_KEYS` 的界面侧镜像，供测试比对） */
export const WHITELIST_FIELD_KEYS = WHITELIST_KEYS
