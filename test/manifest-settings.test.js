/**
 * `contributes.settings` 形状门禁（R17 / 规格 §10.4）。
 *
 * ⚠️ **这个测试是唯一防线**：`skills/obox-ext-dev/scripts/validate-manifest.mjs`
 * **不检查** `settings` 的形状（只校验 `contributes` 是对象），宿主侧也只做 `if (c.settings)`
 * 真值判断（`src/renderer/src/core/host.ts:179`）——键名或类型写错只会**静默不显示**，不报错。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  DEFAULT_DISK_CACHE_MB,
  DEFAULT_PROFILE_LIMIT_MB,
  DISK_CACHE_MB_VALUES,
  PROFILE_LIMIT_MB_VALUES,
  SETTING_KEYS,
  normalizeDiskCacheMb,
  normalizeProfileLimitMb
} from '../lib/profileLimit.mjs'
import { LANG_VALUES, SCALE_VALUES } from '../lib/webapp.mjs'

const manifest = JSON.parse(readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'))
const settings = manifest.contributes?.settings
const fields = settings?.fields ?? []
const byKey = Object.fromEntries(fields.map((field) => [field.key, field]))

test('manifest.contributes.settings 存在且形状正确', () => {
  assert.ok(settings, 'contributes.settings 必须存在（R17 的设置页）')
  assert.equal(settings.id, 'webapp.settings')
  assert.ok(String(settings.title ?? '').trim(), 'settings.title 必须非空')
  assert.ok(Array.isArray(fields), 'settings.fields 必须是数组')
  assert.equal(fields.length, 2, '恰好两个设置项（不多不少）')
  for (const field of fields) {
    assert.ok(String(field.key ?? '').trim(), '每个字段必须有 key')
    assert.ok(String(field.label ?? '').trim(), `${field.key} 必须有 label`)
    assert.ok(
      ['text', 'number', 'boolean', 'select'].includes(field.type),
      `${field.key} 的 type 必须在四类枚举内，实际 ${field.type}`
    )
    assert.ok(field.default !== undefined, `${field.key} 必须有 default`)
    assert.ok(String(field.description ?? '').trim(), `${field.key} 必须有 description（一行说明）`)
  }
})

test('两个键名固定：webapp.profileLimitMb 与 webapp.diskCacheMb（且含扩展前缀）', () => {
  assert.deepEqual(fields.map((field) => field.key).sort(), [
    SETTING_KEYS.diskCacheMb,
    SETTING_KEYS.profileLimitMb
  ])
  for (const field of fields) {
    assert.ok(field.key.startsWith('webapp.'), `${field.key} 必须带 webapp. 前缀`)
  }
})

test('两项都是 select（宿主 SettingField 没有 min/max，枚举是唯一能约束取值的手段）', () => {
  for (const field of fields) {
    assert.equal(field.type, 'select', `${field.key} 必须是 select（R-W19）`)
    assert.ok(
      Array.isArray(field.options) && field.options.length > 0,
      `${field.key} 必须有 options`
    )
    for (const option of field.options) {
      assert.equal(typeof option.value, 'string', `${field.key} 的 option.value 必须是字符串`)
      assert.ok(String(option.label ?? '').trim(), `${field.key} 的 option 缺 label`)
    }
  }
})

test('webapp.profileLimitMb：档位与默认值与 lib 常量逐项一致（2 GB 默认，0 = 不限制）', () => {
  const field = byKey[SETTING_KEYS.profileLimitMb]
  assert.equal(field.default, '2048')
  assert.equal(String(DEFAULT_PROFILE_LIMIT_MB), field.default)
  assert.deepEqual(
    field.options.map((option) => option.value),
    [...PROFILE_LIMIT_MB_VALUES]
  )
  // 默认值必须真的能通过归一（不回落）
  assert.deepEqual(normalizeProfileLimitMb(field.default), { mb: 2048, fellBack: false })
  assert.ok(
    field.options.some((option) => option.value === '0'),
    '必须有"不限制"档位（0）'
  )
})

test('webapp.diskCacheMb：档位含 -1（禁用）与 0（不传参），默认 -1 与 lib 常量一致', () => {
  const field = byKey[SETTING_KEYS.diskCacheMb]
  assert.equal(field.default, '-1')
  assert.equal(String(DEFAULT_DISK_CACHE_MB), field.default)
  assert.deepEqual(
    field.options.map((option) => option.value),
    [...DISK_CACHE_MB_VALUES]
  )
  assert.deepEqual(normalizeDiskCacheMb(field.default), { mb: -1, fellBack: false })
  assert.ok(
    field.options.some((option) => option.value === '-1'),
    '必须有 -1（禁用）档位'
  )
  assert.ok(
    field.options.some((option) => option.value === '0'),
    '必须有 0（不传参）档位'
  )
  // 描述必须诚实写清"正数只限制单条准入、不限制总量"与"与目录上限不是一回事"
  assert.match(field.description, /单条|准入/)
  assert.match(field.description, /不是一回事/)
})

test('contributes 只多这一个设置页（不贡献导航/状态栏/命令/树/主题/快捷键/菜单/i18n）', () => {
  assert.ok(manifest.contributes.ipcChannels, 'ipcChannels 必须还在')
  const extraKeys = Object.keys(manifest.contributes).filter(
    (key) => !['ipcChannels', 'settings'].includes(key)
  )
  assert.deepEqual(extraKeys, [], `contributes 里多出了：${extraKeys.join('、')}`)
})

test('manifest 身份字段与规格一致（名称/版本/作者决定安装目录名与数据目录）', () => {
  assert.equal(manifest.name, 'webapp')
  assert.equal(manifest.version, '1.0.0')
  assert.equal(manifest.author, 'chenzhi')
  assert.equal(manifest.main, './index.js')
  assert.equal(manifest.contributes.ipcChannels.length, 1)
  assert.deepEqual(manifest.contributes.ipcChannels[0], {
    id: 'webapp.helper',
    transport: 'stdio',
    program: './helper.cjs',
    framing: 'ndjson'
  })
})

test('两个下拉的枚举清单仍由 lib 提供（界面只从 lib 取，不自己抄一份）', () => {
  assert.equal(LANG_VALUES.length, 13)
  assert.equal(SCALE_VALUES.length, 16)
})
