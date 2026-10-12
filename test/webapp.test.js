/**
 * 条目数据模型与校验的单测（规格 §18.1 的 `test/webapp.test.js` 表逐例）。
 *
 * 三件事必须钉死：
 * 1. **归一后每一列都有具体值**（`api.sqlite` 的列类型由首次 insert 的 JS 类型推断，
 *    漏字段会把列漂成 TEXT，见规格 §13.2）；
 * 2. **字段级文案与规格 §12.3 的文案表逐字一致**（界面 `src/fields.js` 复用同一套）；
 * 3. **枚举单一来源**：`LANG_VALUES` / `SCALE_VALUES` 由本文件再导出，定义在 chromeArgs.mjs。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  BOOLEAN_KEYS,
  COLUMNS,
  LANG_VALUES,
  MAX_DESC_LENGTH,
  MAX_EXTRA_ORIGINS,
  SCALE_VALUES,
  STRING_KEYS,
  TIMESTAMP_KEYS,
  WHITELIST_KEYS,
  fromDbRow,
  normalizeWebapp,
  toBool,
  toDbRow,
  validateWebapp
} from '../lib/webapp.mjs'
import {
  LANG_VALUES as LANG_FROM_ARGS,
  SCALE_VALUES as SCALE_FROM_ARGS
} from '../lib/chromeArgs.mjs'

/**
 * 归一 + 校验的便捷封装。
 * `options.raw` 传原始输入：两个下拉按**原始类型**校验（number 判非法）、额外 origin 按
 * **原始行号**报错（归一值会 trim 掉首尾换行）。
 */
function check(input, rows = [], options = {}) {
  const entry = normalizeWebapp(input)
  const result = validateWebapp(entry, rows, { ...options, raw: input })
  return { entry, ...result }
}

/** 错误 → `field: message` 映射（文案断言用） */
function errorMap(result) {
  return Object.fromEntries(result.errors.map((error) => [error.field, error.message]))
}

test('normalizeWebapp：空输入 → 每一列都有具体值', () => {
  const entry = normalizeWebapp({})
  for (const key of STRING_KEYS) {
    assert.equal(entry[key], '', `字符串列 ${key} 应归一为 ''`)
  }
  assert.equal(entry.ignoreCert, true, 'ignoreCert 默认必须为 true（R3）')
  for (const key of BOOLEAN_KEYS) {
    if (key === 'ignoreCert') continue
    assert.equal(entry[key], false, `布尔列 ${key} 应归一为 false`)
  }
  // 两个下拉的"不指定"是空串而不是哨兵值（规格 §13.2 的修订说明）
  assert.equal(entry.lang, '')
  assert.equal(entry.scaleFactor, '')
  // 归一产物不得含未知键，也不得凭空多出列
  assert.deepEqual(Object.keys(entry).sort(), [...COLUMNS].sort())
})

test('normalizeWebapp：未知键一律丢弃（白名单归一）', () => {
  const entry = normalizeWebapp({
    name: '内网',
    url: 'https://a/',
    proxyServer: 'http://evil:8080',
    remoteDebuggingPort: 9222,
    loadExtension: 'x'
  })
  assert.equal('proxyServer' in entry, false)
  assert.equal('remoteDebuggingPort' in entry, false)
  assert.equal('loadExtension' in entry, false)
})

test("toBool：`0/1/'1'/'true'` 与 rdp 的 isTruthyFlag 同口径", () => {
  for (const value of [true, 1, '1', 'true', 'TRUE', 'yes', 'on']) {
    assert.equal(toBool(value), true, `${JSON.stringify(value)} 应算真`)
  }
  for (const value of [false, 0, '0', 'false', 'no', 'off', '', null, undefined, 'other']) {
    assert.equal(toBool(value), false, `${JSON.stringify(value)} 应算假`)
  }
  assert.equal(toBool('', true), true, 'fallback 生效')
  assert.equal(toBool('1', false), true, '明确的真值优先于 fallback')
})

test('normalizeWebapp：布尔列接受 0/1 与字符串', () => {
  const on = normalizeWebapp({ ignoreCert: '1', startMaximized: '1', disableGpu: 1 })
  assert.equal(on.ignoreCert, true)
  assert.equal(on.startMaximized, true)
  assert.equal(on.disableGpu, true)
  const off = normalizeWebapp({ ignoreCert: 0, startMaximized: '0', disableGpu: false })
  assert.equal(off.ignoreCert, false)
  assert.equal(off.startMaximized, false)
  assert.equal(off.disableGpu, false)
})

test('normalizeWebapp：组合列归一（`W,H` 去空白；非该形态原样保留交给校验）', () => {
  assert.equal(normalizeWebapp({ windowSize: ' 900 , 600 ' }).windowSize, '900,600')
  assert.equal(normalizeWebapp({ windowPos: '-100,50' }).windowPos, '-100,50')
  assert.equal(normalizeWebapp({ windowSize: '' }).windowSize, '')
  assert.equal(normalizeWebapp({ windowSize: 'abc' }).windowSize, 'abc')
})

test('validateWebapp：名称错误文案逐条匹配（规格 §12.3）', () => {
  const base = { url: 'https://a/' }

  assert.equal(errorMap(check({ ...base, name: '' })).name, '名称不能为空', '空名称文案')

  const illegal = errorMap(check({ ...base, name: 'a<b' })).name
  assert.match(illegal, /^名称包含不能用于目录的字符，建议改为：/)
  assert.match(illegal, /a-b/, '建议名应是净化后的形态')

  const reserved = errorMap(check({ ...base, name: 'CON' })).name
  assert.match(
    reserved,
    /^名称不能是 Windows 保留名（CON\/PRN\/AUX\/NUL\/COM1-9\/LPT1-9，不分大小写），建议改为：/
  )

  const trailing = errorMap(check({ ...base, name: '站点 ' })).name
  assert.match(trailing, /^名称不能以点或空格结尾，建议改为：/)

  const tooLong = errorMap(check({ ...base, name: 'x'.repeat(300) })).name
  assert.match(tooLong, /^名称过长（连路径最多 240 个字符），建议改为：/)

  const duplicate = check({ ...base, name: 'Intranet' }, [{ id: 1, name: 'intranet' }])
  assert.equal(errorMap(duplicate).name, '名称「Intranet」已存在，请换一个')
})

test('validateWebapp：名称查重大小写不敏感，编辑时排除自己', () => {
  const rows = [
    { id: 1, name: 'Intranet' },
    { id: 2, name: '内网' }
  ]
  for (const name of ['intranet', 'INTRANET', 'IntraNet']) {
    const result = check({ name, url: 'https://a/' }, rows)
    assert.equal(result.ok, false, `${name} 应判为重名`)
  }
  const self = check({ id: 1, name: 'INTRANET', url: 'https://a/' }, rows)
  assert.equal(self.ok, true, '编辑自己时不该报重名')
  const other = check({ id: 2, name: 'intranet', url: 'https://a/' }, rows)
  assert.equal(other.ok, false, '改成别人的名字应报重名')
  assert.equal(check({ name: '内网', url: 'https://a/' }, rows).ok, false, '完全相同的中文名算重名')
})

test('validateWebapp：网址校验（仅 http/https；硬拒绝清单）', () => {
  const okUrls = ['https://a/', 'http://intranet', 'https://10.0.0.5:8443/app?x=1#y']
  for (const url of okUrls) {
    const result = check({ name: '站点', url })
    assert.equal(result.ok, true, `${url} 应通过：${JSON.stringify(result.errors)}`)
  }

  assert.equal(errorMap(check({ name: '站点', url: '' })).url, '网址不能为空')

  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'chrome://settings',
    'data:text/html,x',
    'about:blank',
    'ftp://h/x',
    'intranet.local',
    './x',
    '/x'
  ]) {
    assert.equal(
      errorMap(check({ name: '站点', url })).url,
      '网址只能是 http:// 或 https:// 开头',
      `${url} 应被拒`
    )
  }
})

test('validateWebapp：说明过长 / 宽高 / 位置 / 枚举的字段级文案', () => {
  const longDesc = errorMap(
    check({ name: '站点', url: 'https://a/', desc: 'x'.repeat(MAX_DESC_LENGTH + 1) })
  ).desc
  assert.equal(longDesc, `说明最多 ${MAX_DESC_LENGTH} 个字符`)

  const sizeHalf = errorMap(check({ name: '站点', url: 'https://a/', windowSize: '900,' }))
  assert.equal(sizeHalf.windowSize, '窗口宽高必须同时填写或同时留空')

  assert.equal(
    errorMap(check({ name: '站点', url: 'https://a/', windowSize: '319,600' })).windowSize,
    '窗口宽度必须是 320–7680 的整数'
  )
  assert.equal(
    errorMap(check({ name: '站点', url: 'https://a/', windowSize: '7681,600' })).windowSize,
    '窗口宽度必须是 320–7680 的整数'
  )
  assert.equal(
    errorMap(check({ name: '站点', url: 'https://a/', windowSize: '900,239' })).windowSize,
    '窗口高度必须是 240–4320 的整数'
  )
  assert.equal(
    errorMap(check({ name: '站点', url: 'https://a/', windowPos: '-10001,0' })).windowPos,
    '窗口左坐标必须是 -10000–10000 的整数'
  )
  assert.equal(
    errorMap(check({ name: '站点', url: 'https://a/', windowPos: '0,10001' })).windowPos,
    '窗口上坐标必须是 -10000–10000 的整数'
  )
  assert.equal(
    errorMap(check({ name: '站点', url: 'https://a/', windowPos: '0,' })).windowPos,
    '窗口位置必须同时填写或同时留空'
  )
  // 合法边界必须放行（避免"一刀切报错"的假绿）
  assert.equal(check({ name: '站点', url: 'https://a/', windowSize: '320,240' }).ok, true)
  assert.equal(check({ name: '站点', url: 'https://a/', windowSize: '7680,4320' }).ok, true)
  assert.equal(check({ name: '站点', url: 'https://a/', windowPos: '-10000,10000' }).ok, true)

  // D-3 之后两个下拉是**枚举成员校验**
  assert.equal(
    errorMap(check({ name: '站点', url: 'https://a/', lang: 'xx-YY' })).lang,
    '界面语言不在可选清单内（请从下拉中选择）'
  )
  assert.equal(
    errorMap(check({ name: '站点', url: 'https://a/', lang: 'zh_CN' })).lang,
    '界面语言不在可选清单内（请从下拉中选择）'
  )
  assert.equal(
    errorMap(check({ name: '站点', url: 'https://a/', scaleFactor: '1.50' })).scaleFactor,
    '缩放比例不在可选清单内（请从下拉中选择）'
  )
  assert.equal(
    errorMap(check({ name: '站点', url: 'https://a/', scaleFactor: 1.5 })).scaleFactor,
    '缩放比例不在可选清单内（请从下拉中选择）',
    'number 类型不算合法枚举值（存储形态是字符串）'
  )
})

test('validateWebapp：额外 origin 的三种文案（行号按原始输入算）', () => {
  const base = { name: '站点', url: 'https://a/' }
  assert.equal(
    errorMap(check({ ...base, extraOrigins: 'not a url' })).extraOrigins,
    '额外 origin 第 1 行不是合法的 http/https 地址'
  )
  assert.equal(
    errorMap(check({ ...base, extraOrigins: '\nhttp://b' })).extraOrigins,
    '额外 origin 第 2 行必须与主网址同协议（https:）'
  )
  const many = Array.from({ length: 9 }, (_, i) => `https://h${i}`).join('\n')
  assert.equal(
    errorMap(check({ ...base, extraOrigins: many })).extraOrigins,
    `额外 origin 最多 ${MAX_EXTRA_ORIGINS} 条`
  )
  // 关掉证书忽略时，额外 origin 不参与校验（它本来就不会被拼进参数）
  assert.equal(check({ ...base, ignoreCert: false, extraOrigins: 'not a url' }).ok, true)
})

test('validateWebapp：合法条目通过', () => {
  const result = check({
    name: '内网-运维平台',
    url: 'https://10.0.0.5:8443',
    desc: '生产环境，别乱点',
    ignoreCert: true,
    extraOrigins: 'https://10.0.0.6:8443',
    windowSize: '900,600',
    windowPos: '-100,50',
    startMaximized: false,
    lang: 'zh-CN',
    scaleFactor: '1.5',
    disableGpu: false
  })
  assert.deepEqual(result.errors, [])
  assert.equal(result.ok, true)
})

test('toDbRow / fromDbRow：往返后所有列类型不变', () => {
  const input = {
    id: 7,
    name: 'Intranet',
    url: 'https://a:8443/x',
    desc: '一句话',
    ignoreCert: true,
    extraOrigins: 'https://b',
    windowSize: '900,600',
    windowPos: '-100,50',
    startMaximized: true,
    lang: 'ja-JP',
    scaleFactor: '2.25',
    disableGpu: true,
    profileDir: 'Intranet',
    createdAt: '2026-10-12T00:00:00.000Z',
    updatedAt: '2026-10-12T00:00:01.000Z'
  }
  const row = toDbRow(input)
  assert.deepEqual(Object.keys(row).sort(), [...COLUMNS, 'id'].sort())
  for (const key of TIMESTAMP_KEYS) assert.equal(key in row, false, `${key} 由调用方补`)

  const roundTrip = fromDbRow(row)
  assert.equal(typeof roundTrip.ignoreCert, 'boolean')
  assert.equal(typeof roundTrip.startMaximized, 'boolean')
  assert.equal(typeof roundTrip.disableGpu, 'boolean')
  assert.equal(roundTrip.ignoreCert, true)
  assert.equal(roundTrip.startMaximized, true)
  assert.equal(roundTrip.disableGpu, true)
  assert.equal(typeof roundTrip.lang, 'string')
  assert.equal(roundTrip.lang, 'ja-JP')
  assert.equal(typeof roundTrip.scaleFactor, 'string')
  assert.equal(roundTrip.scaleFactor, '2.25', '缩放比例不得被转成数字')
  assert.equal(roundTrip.windowSize, '900,600')
  assert.equal(roundTrip.id, 7)
})

test('fromDbRow：宿主读回的 0/1 也归一成真 boolean；时间戳原样带上', () => {
  const entry = fromDbRow({
    id: 3,
    name: 'x',
    url: 'https://a/',
    ignoreCert: 1,
    startMaximized: 0,
    disableGpu: '1',
    lang: '',
    scaleFactor: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-02T00:00:00.000Z'
  })
  assert.equal(entry.ignoreCert, true)
  assert.equal(entry.startMaximized, false)
  assert.equal(entry.disableGpu, true)
  assert.equal(entry.createdAt, '2026-01-01T00:00:00.000Z')
  assert.equal(entry.updatedAt, '2026-01-02T00:00:00.000Z')
})

test('枚举常量：只读、空值项在最前、SCALE_VALUES 恰为 15 项步进 0.25、两处逐项相等', () => {
  assert.ok(Object.isFrozen(LANG_VALUES), 'LANG_VALUES 必须只读')
  assert.ok(Object.isFrozen(SCALE_VALUES), 'SCALE_VALUES 必须只读')
  assert.equal(LANG_VALUES[0], '', '空值项必须在最前')
  assert.equal(SCALE_VALUES[0], '', '空值项必须在最前')

  const numbers = SCALE_VALUES.slice(1)
  assert.equal(numbers.length, 15, '数值项必须恰好 15 项')
  for (let k = 0; k < 15; k++) {
    assert.equal(numbers[k], String(0.5 + 0.25 * k), `第 ${k} 项应为 0.5 + 0.25*${k}`)
  }
  assert.equal(new Set(SCALE_VALUES).size, SCALE_VALUES.length, '不得有重复项')
  assert.equal(SCALE_VALUES.length, 16, '15 个数值项 + 1 个空值项')

  assert.equal(LANG_VALUES.length, 13, '空值 + 12 个语言')
  assert.equal(new Set(LANG_VALUES).size, LANG_VALUES.length, '不得有重复项')
  for (const value of LANG_VALUES.slice(1)) {
    assert.match(value, /^[a-z]{2}-[A-Z]{2}$/, `${value} 形态不符`)
  }

  // 再导出必须与定义逐项相等（防两处漂移）
  assert.deepEqual([...LANG_VALUES], [...LANG_FROM_ARGS])
  assert.deepEqual([...SCALE_VALUES], [...SCALE_FROM_ARGS])
})

test('WHITELIST_KEYS：恰好 6 个白名单开关（R11，多一个都算越界）', () => {
  assert.deepEqual(
    [...WHITELIST_KEYS],
    ['windowSize', 'windowPos', 'startMaximized', 'lang', 'scaleFactor', 'disableGpu']
  )
})
