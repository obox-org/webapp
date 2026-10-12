/**
 * 界面字段表与纯逻辑的单测（规格 §18.1 的 `test/fields.test.js`）。
 *
 * 最关键的一条：**界面侧与扩展侧的校验口径必须同源**——
 * 同一个输入分别过 `src/fields.js` 的 `validate` 与 `lib/webapp.mjs` 的
 * `validateWebapp`，**错误键集合必须完全一致**（R-W8 的防漂移门禁）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ADVANCED_GROUPS,
  ALL_FIELDS,
  COMMON_GROUPS,
  buildSavePayload,
  defaultForm,
  rowToForm,
  validate,
  visibleFields
} from '../src/fields.js'
import { MAX_DESC_LENGTH, normalizeWebapp, validateWebapp } from '../lib/webapp.mjs'
import { buildChromeArgs } from '../lib/chromeArgs.mjs'

/** 表驱动输入：每一条都是"用户可能填出来的形状" */
const CASES = [
  { name: '', url: '' },
  { name: '内网', url: 'https://a/' },
  { name: 'a<b', url: 'https://a/' },
  { name: 'CON', url: 'https://a/' },
  { name: '站点 ', url: 'https://a/' },
  { name: 'x'.repeat(300), url: 'https://a/' },
  { name: '内网', url: '文件' },
  { name: '内网', url: 'file:///etc/passwd' },
  { name: '内网', url: 'https://a/', desc: 'x'.repeat(MAX_DESC_LENGTH + 1) },
  { name: '内网', url: 'https://a/', windowSizeW: '900', windowSizeH: '' },
  { name: '内网', url: 'https://a/', windowSizeW: '319', windowSizeH: '600' },
  { name: '内网', url: 'https://a/', windowSizeW: '900', windowSizeH: '239' },
  { name: '内网', url: 'https://a/', windowPosX: '-10001', windowPosY: '0' },
  { name: '内网', url: 'https://a/', windowPosX: '0', windowPosY: '10001' },
  { name: '内网', url: 'https://a/', windowPosX: '0', windowPosY: '' },
  { name: '内网', url: 'https://a/', extraOrigins: 'not a url' },
  { name: '内网', url: 'https://a/', extraOrigins: '\nhttp://b' },
  {
    name: '内网',
    url: 'https://a/',
    extraOrigins: Array.from({ length: 9 }, (_, i) => `https://h${i}`).join('\n')
  },
  { name: '内网', url: 'https://a/', lang: 'xx-YY' },
  { name: '内网', url: 'https://a/', scaleFactor: '1.50' },
  { name: '内网', url: 'https://a/', lang: 'zh-CN', scaleFactor: '1.5' },
  { name: '内网', url: 'https://a/', windowSizeW: '900', windowSizeH: '600' }
]

/** 把"扁平用例"塞进表单形状（用例里的 `windowSizeW` 等键与表单同名） */
function formFrom(input) {
  return { ...defaultForm(), ...input }
}

test('defaultForm：ignoreCert 默认勾选，两个下拉默认"不指定"', () => {
  const form = defaultForm()
  assert.equal(form.ignoreCert, true, 'R3：默认忽略证书问题')
  assert.equal(form.lang, '', '下拉默认停在空值项')
  assert.equal(form.scaleFactor, '', '下拉默认停在空值项')
  for (const key of [
    'name',
    'url',
    'desc',
    'extraOrigins',
    'windowSizeW',
    'windowSizeH',
    'windowPosX',
    'windowPosY'
  ]) {
    assert.equal(form[key], '', `${key} 默认空`)
  }
  for (const key of ['startMaximized', 'disableGpu']) {
    assert.equal(form[key], false, `${key} 默认不勾选`)
  }
})

test('rowToForm / buildSavePayload：往返不丢信息', () => {
  const row = {
    id: 5,
    name: '内网',
    url: 'https://a:8443/x',
    desc: '备注',
    ignoreCert: false,
    extraOrigins: 'https://b',
    windowSize: '900,600',
    windowPos: '-100,50',
    startMaximized: true,
    lang: 'ja-JP',
    scaleFactor: '2.25',
    disableGpu: true,
    profileDir: '内网'
  }
  const form = rowToForm(row)
  assert.equal(form.id, 5)
  assert.equal(form.ignoreCert, false)
  assert.equal(form.windowSizeW, '900')
  assert.equal(form.windowSizeH, '600')
  assert.equal(form.windowPosX, '-100')
  assert.equal(form.windowPosY, '50')
  assert.equal(form.lang, 'ja-JP')
  assert.equal(form.scaleFactor, '2.25')

  const payload = buildSavePayload(form)
  assert.equal(payload.id, 5)
  assert.equal(payload.windowSize, '900,600')
  assert.equal(payload.windowPos, '-100,50')
  assert.equal(payload.lang, 'ja-JP')
  assert.equal(payload.scaleFactor, '2.25', '缩放比例保持字符串形态，不得被转成数字')
  assert.equal(payload.startMaximized, true)
  // 界面内部键不得漏进载荷
  assert.equal('windowSizeW' in payload, false)
  assert.equal('windowSizeH' in payload, false)
})

test('buildSavePayload：只从已知字段构建（额外键进不来，R11 的第三层）', () => {
  const form = { ...defaultForm(), name: 'x', url: 'https://a/', proxyServer: 'http://evil' }
  const payload = buildSavePayload(form)
  assert.equal('proxyServer' in payload, false)
})

test('buildSavePayload：空的一对 → 空串（交给校验判"必须同时填"）', () => {
  const payload = buildSavePayload({ ...defaultForm(), windowSizeW: '', windowSizeH: '' })
  assert.equal(payload.windowSize, '')
  const half = buildSavePayload({ ...defaultForm(), windowSizeW: '900', windowSizeH: '' })
  assert.equal(half.windowSize, '900,')
})

test('界面侧与扩展侧校验：错误键集合完全一致（防两处漂移）', () => {
  const rows = [{ id: 1, name: '已存在' }]
  for (const input of CASES) {
    const form = formFrom({ ...input, name: input.name || '' })
    const uiResult = validate(form, rows)
    // 扩展侧：先在**同一个载荷**上归一，再用同一份原始载荷做类型/行号守卫
    const payload = buildSavePayload(form)
    const backend = validateWebapp(normalizeWebapp(payload), rows, { raw: payload })
    assert.deepEqual(
      uiResult.errors.map((item) => item.field).sort(),
      backend.errors.map((item) => item.field).sort(),
      `错误键集合不一致：${JSON.stringify(input)}`
    )
    assert.equal(uiResult.ok, backend.ok, `ok 不一致：${JSON.stringify(input)}`)
  }
})

test('界面侧与扩展侧校验：同名输入的重名文案一致', () => {
  const rows = [{ id: 1, name: 'Intranet' }]
  const uiResult = validate(formFrom({ name: 'intranet', url: 'https://a/' }), rows)
  const payload = buildSavePayload(formFrom({ name: 'intranet', url: 'https://a/' }))
  const backend = validateWebapp(normalizeWebapp(payload), rows, { raw: payload })
  assert.deepEqual(
    uiResult.errors.map((item) => item.message),
    backend.errors.map((item) => item.message)
  )
})

test('每个字段（含高级区）都有非空说明行', () => {
  for (const field of ALL_FIELDS) {
    const text = String(field.hint || field.desc || '')
    assert.ok(text.trim().length > 0, `字段 ${field.key} 缺说明行`)
  }
})

test('visibleFields：恒返回该组全部字段（webapp 没有条件字段）', () => {
  for (const group of [...COMMON_GROUPS, ...ADVANCED_GROUPS]) {
    assert.equal(visibleFields(group).length, group.fields.length)
  }
})

test('下拉门禁（D-3 正式生效）：恰好 2 个 select、空值项在最前、每项 label/desc 非空', () => {
  const selects = ALL_FIELDS.filter((field) => field.type === 'select')
  assert.equal(selects.length, 2, '恰好两个下拉：lang 与 scaleFactor')
  assert.deepEqual(selects.map((field) => field.key).sort(), ['lang', 'scaleFactor'])
  for (const field of selects) {
    assert.equal(field.optional, true, `${field.key} 必须是 optional（有"不指定"项）`)
    assert.ok(String(field.emptyLabel ?? '').trim(), `${field.key} 缺空值项文案`)
    assert.ok(String(field.emptyDesc ?? '').trim(), `${field.key} 的空值项缺说明`)
    assert.ok(field.options.length > 0)
    for (const option of field.options) {
      assert.ok(String(option.value).trim() !== '', `${field.key} 的选项 value 不得为空`)
      assert.ok(
        String(option.label).trim().length > 0,
        `${field.key} 选项 ${option.value} 缺 label`
      )
      assert.ok(String(option.desc).trim().length > 0, `${field.key} 选项 ${option.value} 缺 desc`)
    }
  }
})

test('scaleFactor 的 15 项数值选项与 SCALE_VALUES 逐项一致', () => {
  const field = ALL_FIELDS.find((item) => item.key === 'scaleFactor')
  assert.deepEqual(
    field.options.map((option) => option.value),
    [
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
    ]
  )
})

test('两个下拉的"不指定"不产出参数（空值 = 不传）', () => {
  const entry = normalizeWebapp({ name: '内网', url: 'https://a/', lang: '', scaleFactor: '' })
  const args = buildChromeArgs(entry)
  assert.equal(
    args.some((arg) => arg.startsWith('--lang')),
    false
  )
  assert.equal(
    args.some((arg) => arg.startsWith('--force-device-scale-factor')),
    false
  )

  const withValues = buildChromeArgs(
    normalizeWebapp({ name: '内网', url: 'https://a/', lang: 'zh-CN', scaleFactor: '1.5' })
  )
  assert.ok(withValues.includes('--lang=zh-CN'))
  assert.ok(withValues.includes('--force-device-scale-factor=1.5'))
})

test('默认档位：磁盘 HTTP 缓存禁用（--disk-cache-size=-1）', () => {
  const entry = normalizeWebapp({ name: '内网', url: 'https://a/' })
  assert.ok(buildChromeArgs(entry).includes('--disk-cache-size=-1'), '默认 = 禁用磁盘缓存')
  assert.equal(
    buildChromeArgs(entry, { diskCacheMb: 0 }).some((arg) => arg.startsWith('--disk-cache-size')),
    false,
    '0 = 不传该参数'
  )
  assert.ok(buildChromeArgs(entry, { diskCacheMb: 512 }).includes('--disk-cache-size=536870912'))
})
