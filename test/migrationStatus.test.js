/**
 * 1.0.4 的三条"设置面"需求（`docs/spec/amendments/09-chrome-orphan-launch.md` §2.6 / §3 / §4）：
 *
 * - **③ 迁移状态写进只读设置项** `webapp.migrationStatus`：文本必须能独立读懂
 *   （已搬 X/Y、覆盖 N 项（不可恢复）、失败原因摘要）；
 * - **④ 默认根回填**：设置里为空时把 `<扩展 data>/chrome` 的绝对路径写回 `webapp.profileRoot`，
 *   且**规范化同路径不得触发迁移**；
 * - **⑥ 设置页改根 = 迁移的触发点**：`onChanged(profileRoot)` ⇒ 自动开始迁移，但
 *   空值 / 同路径 / 回填 / 与迁移目标同路径 / 非法值 / 迁移进行中**都不得触发**。
 *
 * 前半是纯函数矩阵（`lib/profileRoot.mjs`），后半是 `index.js` 的**源码门禁**
 * （与 `test/rootMigration.test.js` 同款手法：入口不引宿主 mock）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  MIGRATION_STATUS_IDLE,
  createRootIntent,
  migrationStatusText,
  planDefaultRootBackfill,
  planRootChangeTrigger,
  treatAsDefaultRoot
} from '../lib/profileRoot.mjs'

const INDEX = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
/** 去掉块注释与行注释：避免注释里的示例把断言喂成假绿 */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}
const INDEX_CODE = code(INDEX)

// ---------------------------------------------------------------------------
// ③ 状态文本
// ---------------------------------------------------------------------------

test('migrationStatusText：没有迁移 ⇒ 空闲文案（固定常量）', () => {
  assert.equal(MIGRATION_STATUS_IDLE, '当前无未完成的迁移')
  assert.equal(migrationStatusText(null), MIGRATION_STATUS_IDLE)
  assert.equal(migrationStatusText(undefined), MIGRATION_STATUS_IDLE)
  assert.equal(migrationStatusText('nope'), MIGRATION_STATUS_IDLE)
})

test('migrationStatusText：进行中 ⇒ 已搬 X/Y + 覆盖（不可恢复）+ 失败原因摘要', () => {
  const intent = createRootIntent({
    from: 'C:\\data\\chrome',
    to: 'D:\\obox-webapp\\profiles',
    items: [
      { name: 'A', status: 'done' },
      { name: 'B', status: 'overwritten', overwrite: true },
      { name: 'C', status: 'skipped', reason: '未确认覆盖' },
      { name: 'D', status: 'failed', reason: '[migrate-failed] 磁盘满' },
      { name: 'E' }
    ]
  })
  const text = migrationStatusText(intent)
  assert.match(text, /进行中/)
  assert.match(text, /已搬 2\/5/, '已搬 = done + overwritten')
  assert.match(text, /已覆盖 1 项（不可恢复）/, '覆盖必须明确写出不可恢复')
  assert.match(text, /跳过 1 项/)
  assert.match(text, /失败 1 项（\[migrate-failed\] 磁盘满）/, '必须带失败原因摘要')
  assert.match(text, /目标根 = D:\\obox-webapp\\profiles/)
  // 宿主（≥ 1.0.9）的 status 渲染把含 \n 的值按行渲染成列表（`SettingsView.vue` 的 `statusLines`）
  const lines = text.split('\n')
  assert.ok(lines.length >= 4, `状态文本应是多行（按行渲染更好读），实际 ${lines.length} 行`)
  assert.equal(lines[0], '浏览器数据迁移进行中：已搬 2/5', '第一行是阶段与进度')
  assert.ok(lines.includes('已覆盖 1 项（不可恢复）'), '覆盖必须独占一行（用户最需要看到的那条）')
  assert.ok(!lines.some((line) => line.trim() === ''), '不得出现空行（列表渲染会多出空隙）')
})

test('migrationStatusText：空闲态刻意是**单行**（宿主按单行渲染，不出现列表）', () => {
  assert.ok(!MIGRATION_STATUS_IDLE.includes('\n'), '空闲文案必须单行')
  assert.ok(!migrationStatusText(null).includes('\n'))
})

test('migrationStatusText：完成 / 放弃两种终态各有专门文案，且都带生效根', () => {
  const done = migrationStatusText({
    phase: 'done',
    from: 'C:\\a',
    to: 'D:\\b',
    items: [{ name: 'A', status: 'done' }]
  })
  assert.match(done, /已完成/)
  assert.match(done, /已搬 1\/1/)
  assert.match(done, /生效根 = D:\\b/)
  assert.ok(!done.includes('进行中'))

  const abandoned = migrationStatusText({
    phase: 'abandoned',
    from: 'C:\\a',
    to: 'D:\\b',
    items: [{ name: 'A', status: 'done' }]
  })
  assert.match(abandoned, /已放弃/)
  assert.match(abandoned, /写回旧根|当前生效根 = C:\\a/)
  assert.match(abandoned, /保留在磁盘上/, '必须说清"已复制到目标根的数据保留"')
})

test('migrationStatusText：失败原因过长会截断（状态项不该塞进整篇错误）', () => {
  const long = 'x'.repeat(500)
  const text = migrationStatusText({
    phase: 'running',
    from: 'C:\\a',
    to: 'D:\\b',
    items: [{ name: 'A', status: 'failed', reason: long }]
  })
  assert.ok(text.length < 300, `状态文本不该被超长原因撑爆，实际 ${text.length} 字符`)
  assert.match(text, /…/, '截断必须留下省略号')
})

// ---------------------------------------------------------------------------
// ④ 默认根回填
// ---------------------------------------------------------------------------

const DEFAULT_ROOT =
  'C:\\Users\\me\\AppData\\Roaming\\obox\\extensions\\webapp_chenzhi\\data\\chrome'

test('planDefaultRootBackfill：空/纯空白 ⇒ 回填默认根绝对路径', () => {
  assert.deepEqual(planDefaultRootBackfill({ configured: '', defaultRoot: DEFAULT_ROOT }), {
    write: true,
    root: DEFAULT_ROOT,
    reason: 'configured-empty'
  })
  assert.deepEqual(planDefaultRootBackfill({ configured: '   ', defaultRoot: DEFAULT_ROOT }), {
    write: true,
    root: DEFAULT_ROOT,
    reason: 'configured-empty'
  })
  assert.deepEqual(planDefaultRootBackfill({ defaultRoot: DEFAULT_ROOT }).write, true)
})

test('planDefaultRootBackfill：默认根里有 `obox` 段也照写（V5 防的是安装目录，不是它）', () => {
  // 真实默认根 = `%APPDATA%\obox\extensions\…\chrome`；`normalizeRoot` 的 V5 会把带 `obox` 段的
  // 路径判成"obox 自己的安装目录" ⇒ 回填的判据**只做形状检查**，不得套 V2–V5（否则永远回填不了）
  assert.match(DEFAULT_ROOT, /\\obox\\/)
  assert.equal(planDefaultRootBackfill({ configured: '', defaultRoot: DEFAULT_ROOT }).write, true)
})

test('planDefaultRootBackfill：规范化后**同路径** ⇒ 不写（同一份数据不得因回填而迁移）', () => {
  // 大小写 / 分隔符 / 尾斜杠不同，规范化后是同一个目录；⚠️ 这一条必须**先于** V2–V5 判定，
  // 否则会撞上 V5 的 `obox` 段规则而被误报成"非法"
  const plan = planDefaultRootBackfill({
    configured: 'c:/Users/me/AppData/Roaming/obox/extensions/webapp_chenzhi/data/chrome/',
    defaultRoot: DEFAULT_ROOT
  })
  assert.equal(plan.write, false)
  assert.equal(plan.reason, 'already-default')
})

test('planDefaultRootBackfill：别的自定义根 / 非法值 ⇒ 不覆盖用户的值', () => {
  assert.deepEqual(
    planDefaultRootBackfill({ configured: 'D:\\obox-webapp', defaultRoot: DEFAULT_ROOT }),
    {
      write: false,
      root: '',
      reason: 'configured-custom'
    }
  )
  // 非法值（相对路径）不得被悄悄改成默认根：要让用户看到并自己改
  assert.equal(
    planDefaultRootBackfill({ configured: 'profiles\\x', defaultRoot: DEFAULT_ROOT }).reason,
    'configured-invalid'
  )
  // 盘符根同样是非法值
  assert.equal(
    planDefaultRootBackfill({ configured: 'C:\\', defaultRoot: DEFAULT_ROOT }).reason,
    'configured-invalid'
  )
})

test('planDefaultRootBackfill：拿不到/不是绝对路径的默认根 ⇒ 什么都不写', () => {
  for (const defaultRoot of ['', '   ', null, undefined, 'chrome', 'data\\chrome']) {
    const plan = planDefaultRootBackfill({ configured: '', defaultRoot })
    assert.equal(plan.write, false, `defaultRoot=${String(defaultRoot)} 不该回填`)
    assert.equal(plan.reason, 'no-default-root')
  }
})

test('④ readSettings：回填进来的默认根**先于 V5** 判掉，不刷"设置不合法"的警告', () => {
  const fn = functionBody(INDEX_CODE, 'function readSettings(')
  const specialCaseAt = fn.indexOf('defaultRootAbs')
  const warnAt = fn.indexOf('设置 ${SETTING_KEYS.profileRoot} 不合法')
  assert.ok(specialCaseAt > 0, 'readSettings 必须对"回填的默认根"有专门判断')
  assert.ok(
    warnAt > specialCaseAt,
    '专门判断必须**早于**不合法警告（否则真实默认根每次读设置都会报警）'
  )
  assert.match(fn, /let rootVerdict = normalizeRoot\(profileRoot\)/, '归一结果必须可被这一步改写')
  assert.match(fn, /rootVerdict = \{ kind: 'default' \}/, '同路径 ⇒ 按默认根处理')
})

// ---------------------------------------------------------------------------
// ⑥ 设置页改根 = 迁移的触发点（纯函数判据）
// ---------------------------------------------------------------------------

const DATA_ROOT = 'D:\\obox-webapp\\profiles'

test('⑥ 正常触发：无进行中迁移 + 选了**另一个**根 ⇒ trigger', () => {
  const plan = planRootChangeTrigger({ configured: 'E:\\new-root', dataRoot: DATA_ROOT })
  assert.deepEqual(plan, { changed: true, trigger: true, root: 'E:\\new-root', reason: 'changed' })
})

test('⑥ 不触发 1/4：**扩展自己写回的值**（迁移完成回写 / 默认根回填）不算用户改根', () => {
  // 迁移完成回写：通知到达时数据根已经是新值
  assert.deepEqual(planRootChangeTrigger({ configured: DATA_ROOT, dataRoot: DATA_ROOT }), {
    changed: false,
    trigger: false,
    root: '',
    reason: 'same-as-current'
  })
  // 迁移完成回写的**异步投递**变体：意图已清掉，但设置值 == 当前数据根
  assert.equal(
    planRootChangeTrigger({ configured: 'd:/obox-webapp/profiles/', dataRoot: DATA_ROOT }).reason,
    'same-as-current'
  )
  // 默认根回填：写的就是默认根（真实默认根含 `obox` 段，会被 V5 判非法 ⇒ 必须先比路径）
  const backfill = planRootChangeTrigger({ configured: DEFAULT_ROOT, dataRoot: DEFAULT_ROOT })
  assert.equal(backfill.trigger, false)
  assert.equal(backfill.changed, false)
  assert.equal(backfill.reason, 'same-as-current')
})

test('⑥ 不触发 2/4：同路径写入（大小写 / 尾斜杠 / 分隔符差异）⇒ 什么都不做', () => {
  for (const value of [
    'D:\\obox-webapp\\profiles',
    'd:/obox-webapp/profiles',
    'D:\\obox-webapp\\profiles\\'
  ]) {
    const plan = planRootChangeTrigger({ configured: value, dataRoot: DATA_ROOT })
    assert.equal(plan.changed, false, `${value} 不该被当成改根`)
    assert.equal(plan.reason, 'same-as-current')
  }
})

test('⑥ 不触发 3/4：已有未完成迁移 ⇒ 交给既有对账续做，不叠开第二个迁移', () => {
  // 选了**别的**根：changed=true 但 trigger=false ⇒ 调用方走"拒绝 + 回写 + 写状态"
  const other = planRootChangeTrigger({
    configured: 'E:\\other',
    dataRoot: DATA_ROOT,
    migrationTarget: 'F:\\target',
    hasActiveIntent: true
  })
  assert.deepEqual(other, {
    changed: true,
    trigger: false,
    root: 'E:\\other',
    reason: 'migration-active'
  })
  // 又选了一次**当前迁移的目标根**：连 changed 都不是（幂等，什么都不做）
  const same = planRootChangeTrigger({
    configured: 'f:/target/',
    dataRoot: DATA_ROOT,
    migrationTarget: 'F:\\target',
    hasActiveIntent: true
  })
  assert.equal(same.changed, false)
  assert.equal(same.reason, 'same-as-migration-target')
})

test('⑥ 不触发 4/4：值非法（V2–V5 / 形态非法）与空值 ⇒ 只写状态与日志，不迁移', () => {
  const relative = planRootChangeTrigger({ configured: 'profiles\\x', dataRoot: DATA_ROOT })
  assert.equal(relative.trigger, false)
  assert.equal(relative.changed, false)
  assert.equal(relative.reason, 'configured-invalid')
  assert.match(String(relative.detail), /绝对路径/, '必须带上不通过的原因，供日志与状态使用')
  // 盘符根 / UNC 根同样是"非法"（V3）——不得触发迁移
  assert.equal(
    planRootChangeTrigger({ configured: 'C:\\', dataRoot: DATA_ROOT }).reason,
    'configured-invalid'
  )
  assert.equal(
    planRootChangeTrigger({ configured: '\\\\server\\share', dataRoot: DATA_ROOT }).reason,
    'configured-invalid'
  )
  // 空 / 纯空白：唯一来源是回填/清除；"空 = 默认根"由扩展语义承担 ⇒ 不触发（边界已登记）
  for (const value of ['', '   ', null, undefined]) {
    const plan = planRootChangeTrigger({ configured: value, dataRoot: DATA_ROOT })
    assert.equal(plan.trigger, false)
    assert.equal(plan.reason, 'configured-empty')
  }
})

test('treatAsDefaultRoot：回填后的值仍按"默认根"处理（行为不随回填漂移）', () => {
  const resolved = { root: DEFAULT_ROOT, isDefault: false, source: 'configured' }
  assert.deepEqual(treatAsDefaultRoot(resolved, DEFAULT_ROOT), {
    root: DEFAULT_ROOT,
    isDefault: true,
    source: 'default'
  })
  // 大小写/斜杠差异也算同一个目录
  assert.equal(treatAsDefaultRoot(resolved, DEFAULT_ROOT.toUpperCase()).isDefault, true)
  // 别的根 / 拿不到默认根 ⇒ 原样
  assert.equal(treatAsDefaultRoot(resolved, 'D:\\other').isDefault, false)
  assert.equal(treatAsDefaultRoot(resolved, '').isDefault, false)
  // 已经是默认根 ⇒ 原样返回（不复制对象也无所谓）
  const already = { root: '', isDefault: true, source: 'default' }
  assert.equal(treatAsDefaultRoot(already, DEFAULT_ROOT), already)
})

// ---------------------------------------------------------------------------
// 源码门禁：接线（回填不触发迁移、状态写入不参与改根）
// ---------------------------------------------------------------------------

/**
 * 取一个函数声明的**函数体**（花括号配对；比 indexOf 切片稳，免得改一行注释就失配）。
 * @param {string} source
 * @param {string} signature 形如 `async function backfillDefaultRoot(`
 */
function functionBody(source, signature) {
  const start = source.indexOf(signature)
  assert.ok(start > 0, `找不到 ${signature}`)
  const open = source.indexOf('{', start)
  assert.ok(open > start, `${signature} 后应有函数体`)
  let depth = 0
  for (let index = open; index < source.length; index += 1) {
    const ch = source[index]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return source.slice(open, index + 1)
    }
  }
  assert.fail(`无法匹配 ${signature} 的函数体`)
}

test('④ 回填时机是"通道建立后"（不在激活瞬间连助手），且幂等', () => {
  assert.match(INDEX_CODE, /async function backfillDefaultRoot\(/, '必须有回填实现')
  assert.match(INDEX_CODE, /let defaultRootBackfilled = false/, '必须有进程内一次性的开关')
  const body = functionBody(INDEX_CODE, 'async function backfillDefaultRoot(')
  assert.match(body, /planDefaultRootBackfill\(/, '判据必须复用纯函数（不得自己写一份）')
  assert.match(body, /profileRootStatus/, '默认根绝对路径只能来自助手')
  assert.match(body, /if \(defaultRootBackfilled\) return/, '必须幂等（进程内只做一次）')
  // 时机：ensureHelper 的 then 里触发（不是模块顶层 / 激活瞬间）
  const helperFn = functionBody(INDEX_CODE, 'function ensureHelper(')
  assert.match(helperFn, /backfillDefaultRoot\(\)/, '回填必须挂在本进程第一次连上助手之后')
})

test('④ 回填**绝不触发迁移**：不写意图、不看冲突、不调对账', () => {
  const fn = functionBody(INDEX_CODE, 'async function backfillDefaultRoot(')
  for (const forbidden of [
    'writeRootIntent',
    'createRootIntent',
    'reconcileNow',
    'reconcileIntent',
    'prepareRoot',
    'migrateRootDir',
    'clearRootIntent',
    'activeIntent'
  ]) {
    assert.ok(!fn.includes(forbidden), `回填里不得出现 ${forbidden}（回填不改根、不迁移）`)
  }
  assert.match(fn, /api\.settings\.set\(SETTING_KEYS\.profileRoot/, '回填只写 profileRoot')
  assert.ok(!/api\.settings\.set\(SETTING_KEYS\.migrationStatus/.test(fn), '回填不得顺手写状态文本')
})

test('③ 状态写入只有一处，且只写 migrationStatus（改根判定只读 profileRoot）', () => {
  const writes = [...INDEX_CODE.matchAll(/api\.settings\.set\(/g)]
  assert.equal(writes.length, 6, `api.settings.set 应恰好 6 处，实际 ${writes.length}`)
  assert.match(INDEX_CODE, /function writeMigrationStatus\(/, '必须集中成一个写入函数')
  assert.match(
    INDEX_CODE,
    /api\.settings\.set\(SETTING_KEYS\.migrationStatus, text\)/,
    '状态文本必须写进 migrationStatus'
  )
  // 值没变就不写（避免每搬一条都落盘 + 触发 onChanged）
  const fn = functionBody(INDEX_CODE, 'function writeMigrationStatusText(')
  assert.match(
    fn,
    /if \(String\(current \?\? ''\) === String\(text \?\? ''\)\) return/,
    '值没变必须直接返回'
  )
  const wrapper = functionBody(INDEX_CODE, 'function writeMigrationStatus(')
  assert.match(wrapper, /migrationStatusText\(intent\)/, '文本必须来自纯函数')
  // 改根判定（readSettings）只读 profileRoot
  const readSettingsFn = functionBody(INDEX_CODE, 'function readSettings(')
  assert.ok(!readSettingsFn.includes('migrationStatus'), '改根判定不得读 migrationStatus')
  // onChanged：只有三个真正的配置键才作废体积缓存
  const onChangedAt = INDEX_CODE.indexOf('api.settings.onChanged(')
  const onChangedFn = INDEX_CODE.slice(onChangedAt, INDEX_CODE.indexOf('// ---- 方法实现 ----'))
  assert.ok(onChangedAt > 0 && onChangedFn.length > 0, '必须能定位到 onChanged 的接线')
  assert.ok(
    !/key\.startsWith\('webapp\.'\)/.test(onChangedFn),
    'onChanged 不得对一切 webapp.* 键都作废缓存（migrationStatus 会被频繁写）'
  )
  assert.match(onChangedFn, /SETTING_KEYS\.profileRoot/, 'profileRoot 变更仍必须作废体积缓存')
})

test('③ 状态文本在"开始 / 逐条推进 / 完成 / 失败 / 空闲"五处都被写入', () => {
  const calls = [...INDEX_CODE.matchAll(/writeMigrationStatus\(/g)].length
  assert.ok(calls >= 6, `writeMigrationStatus 的调用点应覆盖各阶段，实际 ${calls} 处`)
  assert.match(INDEX_CODE, /writeMigrationStatus\(null\)/, '没有未完成迁移时必须写空闲文案')
  assert.match(INDEX_CODE, /writeMigrationStatus\(current\)/, '推进/完成/失败路径必须写状态')
})

test('⑥ 接线：onChanged(profileRoot) ⇒ 判据纯函数 ⇒ 与「迁移到此目录」同一个入口', () => {
  const onChangedAt = INDEX_CODE.indexOf('api.settings.onChanged(')
  const onChangedFn = INDEX_CODE.slice(onChangedAt, INDEX_CODE.indexOf('// ---- 方法实现 ----'))
  assert.match(
    onChangedFn,
    /void onProfileRootSettingChanged\(\)/,
    'profileRoot 变更必须调用触发点处理函数'
  )
  const handler = functionBody(INDEX_CODE, 'async function onProfileRootSettingChanged(')
  assert.match(handler, /planRootChangeTrigger\(/, '判据必须复用纯函数（不得自己写一份）')
  assert.match(handler, /startRootMigration\(\{ root: plan\.root \}\)/, '必须走同一个状态机入口')
  assert.match(handler, /if \(!plan\.changed\)/, '不 changed ⇒ 直接返回（同路径/回填/非法）')
  assert.match(handler, /if \(!plan\.trigger\)/, 'migration-active ⇒ 走拒绝分支')
  // 拒绝分支：回写设置值 + 写状态 + 记日志（不叠开第二个迁移）
  assert.match(
    handler,
    /api\.settings\.set\(SETTING_KEYS\.profileRoot, restore\)/,
    '必须把设置值回写成迁移目标根'
  )
  assert.match(handler, /writeMigrationStatusText\(/, '必须写一条明确的状态文本')
  assert.match(handler, /改根被拒绝：已有迁移进行中/, '状态文本必须写明"已有迁移进行中"')
  // 拒绝分支里**不得**调 startRootMigration（不叠开第二个迁移）
  // ⚠️ 边界用**运行期字符串**，不用注释：INDEX_CODE 是剥掉注释后的源码
  const rejectAt = handler.indexOf('if (!plan.trigger)')
  const noticeAt = handler.indexOf('改根被拒绝：已有迁移进行中')
  assert.ok(rejectAt > 0 && noticeAt > rejectAt, '必须能定位到"迁移中改根被拒"的分支')
  assert.ok(
    !handler.slice(rejectAt, noticeAt).includes('startRootMigration'),
    '迁移进行中不得再调 startRootMigration（不叠开第二个迁移）'
  )
})

test('⑥ 补触发点**没有把界面加回来**：触发逻辑只在入口侧，扩展页面仍是零迁移展示', () => {
  const app = readFileSync(new URL('../src/App.vue', import.meta.url), 'utf8')
  for (const needle of [
    'rootbar',
    'startRootMigration',
    'browseRootDir',
    'ConfirmOverwrite',
    'migrationText',
    'manualRoot'
  ]) {
    assert.ok(!app.includes(needle), `App.vue 不得因为补触发点而出现 ${needle}`)
  }
  assert.ok(
    !/onChanged|planRootChangeTrigger/.test(app),
    '触发点必须在扩展入口（index.js）里，不能让界面订阅设置'
  )
})
