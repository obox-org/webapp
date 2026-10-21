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

test('manifest.contributes.settings 存在且形状正确（1.0.6 起恰好五个设置项）', () => {
  assert.ok(settings, 'contributes.settings 必须存在（R17 的设置页）')
  assert.equal(settings.id, 'webapp.settings')
  assert.ok(String(settings.title ?? '').trim(), 'settings.title 必须非空')
  assert.ok(Array.isArray(fields), 'settings.fields 必须是数组')
  assert.equal(
    fields.length,
    5,
    '恰好五个设置项（两个 select + directory + status + 1.0.6 的 modal status，不多不少）'
  )
  for (const field of fields) {
    assert.ok(String(field.key ?? '').trim(), '每个字段必须有 key')
    assert.ok(String(field.label ?? '').trim(), `${field.key} 必须有 label`)
    assert.ok(
      // 1.0.4 用到宿主新增的两种类型：`directory`（输入框 + 浏览按钮）与 `status`（只读展示）
      ['text', 'number', 'boolean', 'select', 'directory', 'status'].includes(field.type),
      `${field.key} 的 type 必须在宿主支持的类型内，实际 ${field.type}`
    )
    assert.ok(field.default !== undefined, `${field.key} 必须有 default`)
    assert.ok(String(field.description ?? '').trim(), `${field.key} 必须有 description（一行说明）`)
  }
})

test('五个键名固定：profileLimitMb / diskCacheMb / profileRoot / migrationStatus / migrationProgress', () => {
  assert.deepEqual(fields.map((field) => field.key).sort(), [
    SETTING_KEYS.diskCacheMb,
    SETTING_KEYS.migrationProgress,
    SETTING_KEYS.migrationStatus,
    SETTING_KEYS.profileLimitMb,
    SETTING_KEYS.profileRoot
  ])
  for (const field of fields) {
    assert.ok(field.key.startsWith('webapp.'), `${field.key} 必须带 webapp. 前缀`)
  }
  // ⚠️ 三个"状态类"键必须彼此独立：写状态/进度绝不能参与"改根"判定
  assert.notEqual(SETTING_KEYS.profileRoot, SETTING_KEYS.migrationStatus)
  assert.notEqual(SETTING_KEYS.profileRoot, SETTING_KEYS.migrationProgress)
  assert.notEqual(SETTING_KEYS.migrationStatus, SETTING_KEYS.migrationProgress)
})

test('1.0.6：迁移进度项必须是 `status` + `modal: true` + **默认空串**（模态框显隐只看它）', () => {
  const field = byKey[SETTING_KEYS.migrationProgress]
  assert.ok(field, '必须有 webapp.migrationProgress 字段')
  assert.equal(field.type, 'status', '必须是 status（只读展示；宿主据 modal 决定弹遮罩）')
  assert.equal(field.modal, true, '必须带 modal: true —— 宿主据此渲染不可关闭的等待模态框')
  assert.equal(field.default, '', '默认值必须是**空串**（非空即弹模态框，空闲时绝不能弹）')
  assert.equal(field.options, undefined, 'status 字段不得带 options')
  assert.ok(String(field.label ?? '').trim(), '必须有 label（模态框标题）')
  // description 必须说清"结束（成功或失败）后自动消失"——不得承诺"只有成功才消失"
  assert.match(field.description, /只读/)
  assert.match(field.description, /迁移/)
  assert.match(field.description, /成功或失败/)
  assert.match(field.description, /消失/)
  assert.ok(!/只有.*成功/.test(field.description), '不得承诺"只有成功才消失"（失败也是终态）')
  assert.ok(!/[*_`#]/.test(field.description), 'description 里不得出现 Markdown 标记')
})

test('两个下拉仍是 select、根目录是 directory、两个状态项都是 status（只读）', () => {
  for (const field of fields) {
    if (field.key === SETTING_KEYS.profileRoot) {
      assert.equal(field.type, 'directory', 'profileRoot 必须是 directory（1.0.4 起）')
      continue
    }
    if (field.key === SETTING_KEYS.migrationStatus) {
      assert.equal(field.type, 'status', 'migrationStatus 必须是 status（只读展示，无按钮）')
      assert.equal(field.options, undefined, 'status 字段不得带 options')
      assert.equal(
        field.modal,
        undefined,
        'migrationStatus 不得是模态框（那是 migrationProgress 的职责）'
      )
      continue
    }
    if (field.key === SETTING_KEYS.migrationProgress) {
      assert.equal(field.type, 'status', 'migrationProgress 必须是 status（只读展示）')
      assert.equal(field.options, undefined, 'status 字段不得带 options')
      continue
    }
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

test('webapp.migrationStatus：status、默认"当前无未完成的迁移"、description 写明只读与不可恢复', () => {
  const field = byKey[SETTING_KEYS.migrationStatus]
  assert.equal(field.type, 'status', '必须是宿主新增的 status 类型（只读展示）')
  assert.equal(field.default, '当前无未完成的迁移', '默认文本必须与 lib 的空闲态文案一致')
  assert.equal(field.options, undefined, 'status 字段不得带 options')
  // 文案要能让用户理解"为什么扩展页面看不到迁移信息"以及"覆盖不可恢复"
  assert.match(field.description, /只读/)
  assert.match(field.description, /不可恢复/)
  assert.match(field.description, /迁移/)
  assert.ok(!/[*_`#]/.test(field.description), 'description 里不得出现 Markdown 标记')
})

test('webapp.profileRoot：directory、默认空串（= 用默认根）、description 必须含卸载语义与迁移语义', () => {
  const field = byKey[SETTING_KEYS.profileRoot]
  // 1.0.4：宿主新增了 `directory` 类型（渲染"可编辑文本框 + 浏览…按钮"，
  // `src/api/contributions.ts:72-87`），本字段改用它；`text` 会退化成没有目录选择按钮的旧形态
  assert.equal(field.type, 'directory', '根目录必须是 directory（宿主已支持目录选择控件）')
  // 默认值必须是空串：**扩展的既有约定**是"空 = 默认根 `<扩展 data>/chrome`"
  // （`lib/profileRoot.mjs` 的 `normalizeRoot('')` → `kind:'default'`；`helper.cjs` 的
  // `resolveRoot` 同样把空值解析成 `<cwd>/chrome`）。manifest 里**无法**表达 `<扩展 data>`
  // 这个运行期路径，因此只能写空串，由 description 说明语义。
  assert.equal(field.default, '', '默认值必须是空串（= 用默认根 `<扩展 data>/chrome`）')
  assert.equal(field.options, undefined, 'directory 字段不得带 options')
  // P4 = A：设置项 description 必须包含卸载语义（四处文案之一）
  assert.match(field.description, /卸载时只有默认目录下的数据会被删除/)
  assert.match(field.description, /需你自行清理/)
  // 迁移语义 + 默认值语义（默认值写的是空串，必须由 description 说清"空 = 默认根"）
  assert.match(field.description, /迁移/)
  assert.match(field.description, /绝对路径/)
  assert.match(
    field.description,
    /留空 = 用默认目录/,
    '必须说明"空 = 默认根"（manifest 无法表达它）'
  )
  // 1.0.4 起"改这里 = 自动开始迁移"（§2.6 的触发点）已经成立，description 的说法是准确的；
  // 同时必须写明"同名冲突会被覆盖且不可恢复"（这是该字段最危险的一条后果）
  assert.match(field.description, /自动迁移到新目录/, '改根会自动迁移——这条必须与实现一致')
  assert.match(field.description, /同名数据会被覆盖（不可恢复、无备份）/, '必须写明覆盖不可恢复')
  // ⚠️ 老宿主（≤ obox v1.0.8）渲染链没有兜底分支（`SettingsView.vue:643-676`），
  // 对 `directory` 只显示 label + description、**没有输入控件**；处理方式与证据见
  // `docs/spec/amendments/09-chrome-orphan-launch.md` 的"老宿主兼容"段与 README §3。
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
  // v1.0.6 是本需求的修复版（1.0.6 = "设置里的配置没生效"的根因修复）：
  // ① 迁移的**源**不再取设置值（取实际数据根）⇒ 1.0.3–1.0.5 的"改根自动迁移"事实上从未生效；
  // ② 激活期**主动**连助手 → 回填默认根（设置页一打开就能看到真实路径）+ 改根对账（补做错过的迁移）；
  // ③ `webapp.migrationStatus` 在无迁移时也写出"当前生效根 / 设置值"，被拒绝的设置值**显式写进状态项**；
  // ④ V5 收紧到"只拒真正的 obox 安装目录"（旧实现的"路径段含 obox ⇒ 一律拒"是静默误伤）。
  // 五处一致之外再钉一次具体值，避免"五处一起漂而没有任何一处改过"这种静默失误
  // 1.0.7：修宿主模式下卡片白窗（页面 URL 变 file://）+ settings 冷缓存下两处不可逆动作
  //       （清空迁移进度改强制写、默认根回填加冷缓存闸门）
  assert.equal(unique[0], '1.0.7', `本次发布的版本必须是 1.0.7，实际 ${unique[0]}`)
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
