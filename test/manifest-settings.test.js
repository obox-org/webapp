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

test('manifest.contributes.settings 存在且形状正确（v1.0.3 起恰好三个设置项）', () => {
  assert.ok(settings, 'contributes.settings 必须存在（R17 的设置页）')
  assert.equal(settings.id, 'webapp.settings')
  assert.ok(String(settings.title ?? '').trim(), 'settings.title 必须非空')
  assert.ok(Array.isArray(fields), 'settings.fields 必须是数组')
  assert.equal(fields.length, 3, '恰好三个设置项（两个 select + 一个 text，不多不少）')
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

test('三个键名固定：profileLimitMb / diskCacheMb / profileRoot（且含扩展前缀）', () => {
  assert.deepEqual(fields.map((field) => field.key).sort(), [
    SETTING_KEYS.diskCacheMb,
    SETTING_KEYS.profileLimitMb,
    SETTING_KEYS.profileRoot
  ])
  for (const field of fields) {
    assert.ok(field.key.startsWith('webapp.'), `${field.key} 必须带 webapp. 前缀`)
  }
})

test('两个下拉仍是 select、新字段是 text（text 必须有非空 default）', () => {
  for (const field of fields) {
    if (field.key === SETTING_KEYS.profileRoot) continue
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

test('webapp.profileRoot：text、默认空串（= 用默认根）、description 必须含卸载语义与迁移语义', () => {
  const field = byKey[SETTING_KEYS.profileRoot]
  assert.equal(field.type, 'text', '根目录只能是 text（宿主没有目录选择控件）')
  assert.equal(field.default, '', '默认值必须是空串（= 用默认根 `<扩展 data>/chrome`）')
  assert.equal(field.options, undefined, 'text 字段不得带 options')
  // P4 = A：设置项 description 必须包含卸载语义（四处文案之一）
  assert.match(field.description, /卸载时只有默认目录下的数据会被删除/)
  assert.match(field.description, /需你自行清理/)
  // 迁移语义
  assert.match(field.description, /迁移/)
  assert.match(field.description, /绝对路径/)
  // ⚠️ 这段文字原样进 manifest.json，所以不得出现 Markdown 标记
  assert.ok(!/[*_`#]/.test(field.description), 'description 里不得出现 Markdown 标记')
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

test('manifest 身份字段与规格一致（名称/作者决定安装目录名与数据目录）', () => {
  assert.equal(manifest.name, 'webapp')
  // 版本号随 amendment 08（可配置 profile 根 + 自动迁移）升到 1.0.3——这里只要求"是合法 semver"
  // 与"五处一致"（后者由下一条用例钉住），不把具体版本写死两份
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, `版本应是合法 semver，实际 ${manifest.version}`)
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

test('版本号在五处必须完全一致（manifest / package / lock 顶层 / lock packages[""] / index.js 卡片）', () => {
  // 为什么要有这条：1.0.1 那次只改了 manifest 与 package.json，**漏了**
  // `package-lock.json` 与 `index.js` 里卡片注册的 `version`——卡片版本是宿主详情页显示的版本号，
  // 漏改会让用户看到旧版本。这类"多处版本源"的漂移必须由门禁挡住。
  //
  // v1.0.3 起 `index.js` 把版本抽成常量 `EXT_VERSION`（同一个常量同时进卡片注册与迁移意图文件），
  // 因此这里按"常量的值"参与比对，而不是要求卡片注册处再写一遍字面量。
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const lock = JSON.parse(readFileSync(new URL('../package-lock.json', import.meta.url), 'utf8'))
  const indexSource = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
  const constantVersion = (indexSource.match(/const EXT_VERSION = '([^']+)'/) ?? [])[1]
  assert.ok(constantVersion, 'index.js 必须声明 EXT_VERSION 常量（版本号的单一来源）')
  const cardVersion = indexSource.match(/version:\s*EXT_VERSION/g) ?? []
  assert.equal(
    cardVersion.length,
    2,
    `卡片注册与迁移意图都要用 EXT_VERSION，实际 ${cardVersion.length} 处`
  )

  const versions = {
    'manifest.json': manifest.version,
    'package.json': pkg.version,
    'package-lock.json 顶层': lock.version,
    'package-lock.json packages[""]': lock.packages?.['']?.version,
    'index.js EXT_VERSION': constantVersion
  }
  const unique = [...new Set(Object.values(versions))]
  assert.equal(
    unique.length,
    1,
    `五处版本必须一致，实际：${Object.entries(versions)
      .map(([where, value]) => `${where}=${value}`)
      .join('、')}`
  )
  assert.match(String(unique[0]), /^\d+\.\d+\.\d+$/, '版本必须是合法 semver')
  // v1.0.3 是本需求的发布版本（amendment 08）；五处一致之外再钉一次具体值，
  // 避免"五处一起漂到 1.0.4 而没有任何一处改过"这种静默失误
  assert.equal(unique[0], '1.0.3', `本次发布的版本必须是 1.0.3，实际 ${unique[0]}`)
})

test('manifest 与 package.json 的版本必须一致（避免产物名与包元数据漂移）', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(
    pkg.version,
    manifest.version,
    `manifest ${manifest.version} 与 package.json ${pkg.version} 不一致`
  )
})

test('两个下拉的枚举清单仍由 lib 提供（界面只从 lib 取，不自己抄一份）', () => {
  assert.equal(LANG_VALUES.length, 13)
  assert.equal(SCALE_VALUES.length, 16)
})
