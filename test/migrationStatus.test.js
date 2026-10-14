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
 * **1.0.6 增补**（"设置里的配置没生效"的修复，见 amendment 09 的 1.0.6 段）：
 * - **A 激活期对账**：`planActivationRootReconcile` 的判据矩阵 + 接线门禁；
 * - **B 激活期回填**：主动连助手 → 回填默认根（见 ④ 的时机用例）；
 * - **C 状态项自述**：无迁移时也写 `当前生效根 = …（来源：…）`、`设置值 = …`；
 *   设置值被拒绝时**必须**写出 `设置值被拒绝：<原因>（配置值：<原样>）`（不许只留控制台日志）。
 *
 * 前半是纯函数矩阵（`lib/profileRoot.mjs`），后半是 `index.js` 的**源码门禁**
 * （与 `test/rootMigration.test.js` 同款手法：入口不引宿主 mock）。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  MIGRATION_STATUS_IDLE,
  MIGRATION_STATUS_ROOT_UNKNOWN,
  createRootIntent,
  migrationProgressText,
  migrationStatusText,
  planActivationRootReconcile,
  planDataRootProbe,
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

test('migrationStatusText：进行中 ⇒ 已搬 X/Y + 覆盖（不可恢复）+ 跳过', () => {
  const intent = createRootIntent({
    from: 'C:\\data\\chrome',
    to: 'D:\\obox-webapp\\profiles',
    items: [
      { name: 'A', status: 'done' },
      { name: 'B', status: 'overwritten', overwrite: true },
      { name: 'C', status: 'skipped', reason: '未确认覆盖' },
      { name: 'D' }
    ]
  })
  const text = migrationStatusText(intent)
  assert.match(text, /进行中/)
  assert.match(text, /已搬 2\/4/, '已搬 = done + overwritten')
  assert.match(text, /已覆盖 1 项（不可恢复）/, '覆盖必须明确写出不可恢复')
  assert.match(text, /跳过 1 项/)
  assert.match(text, /目标根 = D:\\obox-webapp\\profiles/)
  // 宿主（≥ 1.0.9）的 status 渲染把含 \n 的值按行渲染成列表（`SettingsView.vue` 的 `statusLines`）
  const lines = text.split('\n')
  assert.ok(lines.length >= 4, `状态文本应是多行（按行渲染更好读），实际 ${lines.length} 行`)
  assert.equal(lines[0], '浏览器数据迁移进行中：已搬 2/4', '第一行是阶段与进度')
  assert.ok(lines.includes('已覆盖 1 项（不可恢复）'), '覆盖必须独占一行（用户最需要看到的那条）')
  assert.ok(!lines.some((line) => line.trim() === ''), '不得出现空行（列表渲染会多出空隙）')
})

test('migrationStatusText（1.0.6）：有失败项 ⇒ 首行"失败"，并写明数据仍在旧根、设置未改', () => {
  // 用户裁定：**失败也是终态**（模态框释放、状态项给结论）⇒ 首行必须是"失败"而不是"进行中"，
  // 并明确"数据还在旧根、设置值没改"，同时保留失败原因摘要与下一步。
  const intent = createRootIntent({
    from: 'C:\\data\\chrome',
    to: 'D:\\obox-webapp\\profiles',
    items: [
      { name: 'A', status: 'done' },
      { name: 'B', status: 'overwritten', overwrite: true },
      { name: 'C', status: 'failed', reason: '[migrate-failed] 磁盘满' },
      { name: 'D', status: 'skipped', reason: '未确认覆盖' }
    ]
  })
  const text = migrationStatusText(intent)
  const lines = text.split('\n')
  assert.equal(lines[0], '浏览器数据迁移失败：已搬 2/4', '首行必须说"失败"（不是"进行中"）')
  assert.ok(!/进行中/.test(text), '失败终态不得再自称"进行中"')
  assert.ok(lines.includes('失败 1 项（[migrate-failed] 磁盘满）'), '必须带失败原因摘要')
  assert.ok(lines.includes('已覆盖 1 项（不可恢复）'))
  assert.ok(
    lines.some((line) => /数据仍在旧根.*C:\\data\\chrome.*设置值未改/.test(line)),
    `必须写明"数据仍在旧根、设置值未改"（否则用户以为数据丢了），实际：${text}`
  )
  assert.ok(lines.length >= 5)
  assert.ok(!lines.some((line) => line.trim() === ''), '不得出现空行')
})

test('migrationProgressText（1.0.6）：进行中给进度；**终态与无意图一律空串**（模态框释放）', () => {
  const intent = createRootIntent({
    from: 'C:\\data\\chrome',
    to: 'D:\\obox-webapp\\profiles',
    items: [
      { name: 'A', status: 'done' },
      { name: 'B', status: 'overwritten', overwrite: true },
      { name: 'C' }
    ]
  })
  const text = migrationProgressText(intent)
  const lines = text.split('\n')
  assert.equal(lines[0], '正在迁移浏览器数据：已搬 2/3', '首行是阶段与进度')
  assert.ok(lines.includes('已覆盖 1 项（不可恢复）'))
  assert.ok(lines.includes('目标根 = D:\\obox-webapp\\profiles'))
  assert.ok(
    lines.some((line) => /迁移结束（成功或失败）后此窗口会自动关闭/.test(line)),
    '必须说明"成功或失败都自动关闭"'
  )
  assert.ok(!/只有.*成功.*(关闭|消失)/.test(text), '不得承诺"只有成功才消失"')
  // 失败进行中也要能看到失败条数（结束后看「迁移状态」）
  const failing = migrationProgressText(
    createRootIntent({
      from: 'C:\\a',
      to: 'D:\\b',
      items: [{ name: 'A', status: 'failed', reason: 'x' }]
    })
  )
  assert.match(failing, /失败 1 项（结束后见「迁移状态」）/)
  // **终态 ⇒ 空串**：模态框的显隐只看这个值，非空即弹 ⇒ 终态绝不能非空
  for (const phase of ['done', 'abandoned']) {
    assert.equal(
      migrationProgressText({ phase, from: 'C:\\a', to: 'D:\\b', items: [] }),
      '',
      `${phase} 必须返回空串（关闭模态框）`
    )
  }
  for (const bad of [null, undefined, 0, 'nope']) {
    assert.equal(migrationProgressText(bad), '', `${String(bad)} 必须返回空串`)
  }
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
// ③（1.0.6）状态项自述：当前生效根 / 设置值 / 被拒绝的设置值
// ---------------------------------------------------------------------------

const EFFECTIVE_DEFAULT =
  'C:\\Users\\me\\AppData\\Roaming\\obox\\extensions\\webapp_chenzhi\\data\\chrome'
/** "数据实际所在根"（用户现场数据仍在默认根） */
const ACTUAL_ROOT = EFFECTIVE_DEFAULT
const CONFIGURED_NEW = 'D:\\obox-webapp\\profiles'

test('③（1.0.6）无迁移 + 上下文 ⇒ 空闲行 + 当前生效根（默认根）+ 设置值', () => {
  const idle = migrationStatusText(null, {
    root: EFFECTIVE_DEFAULT,
    isDefault: true,
    configured: '',
    env: { platform: 'win32' }
  })
  const lines = idle.split('\n')
  assert.equal(lines[0], MIGRATION_STATUS_IDLE, '第一行仍是空闲文案（常量不变）')
  assert.ok(
    lines.includes(`当前生效根 = ${EFFECTIVE_DEFAULT}（来源：默认根）`),
    `必须写出当前生效根与来源，实际：${idle}`
  )
  assert.ok(
    lines.includes('设置值 = （空，表示用默认根）'),
    '空设置值也要写出来（说明空 = 默认根）'
  )
  assert.ok(!lines.some((line) => line.trim() === ''), '不得出现空行（列表渲染会多出空隙）')
})

test('③（1.0.6）来源标注：已配置 ⇒ "设置"；迁移未完成 ⇒ "迁移中的旧根"', () => {
  const configured = migrationStatusText(null, {
    root: CONFIGURED_NEW,
    isDefault: false,
    source: 'configured',
    configured: CONFIGURED_NEW,
    env: { platform: 'win32' }
  })
  assert.match(configured, /当前生效根 = D:\\obox-webapp\\profiles（来源：设置）/)
  assert.match(configured, /设置值 = D:\\obox-webapp\\profiles/)
  const migrating = migrationStatusText(null, {
    root: 'C:\\old',
    isDefault: false,
    source: 'migration-from',
    env: { platform: 'win32' }
  })
  assert.match(migrating, /当前生效根 = C:\\old（来源：迁移中的旧根）/)
})

test('③（1.0.6）设置值被拒绝 ⇒ **必须**写出原因与原样值（不许只留控制台日志）', () => {
  // 用户现场：设置页显示着自己选的值，实际却一直用默认根。原因只有控制台能看到 = 不可自查。
  const text = migrationStatusText(null, {
    root: EFFECTIVE_DEFAULT,
    isDefault: true,
    configured: 'D:\\obox\\profiles',
    invalid: {
      value: 'D:\\obox\\profiles',
      reason: '不能指向 obox 自己的安装目录'
    },
    env: { platform: 'win32' }
  })
  const lines = text.split('\n')
  assert.ok(
    lines.includes('设置值被拒绝：不能指向 obox 自己的安装目录（配置值：D:\\obox\\profiles）'),
    `必须有"设置值被拒绝 + 原因 + 原样配置值"这一行，实际：${text}`
  )
  assert.ok(
    lines.includes(`当前生效根 = ${EFFECTIVE_DEFAULT}（来源：默认根）`),
    '同时必须写出**实际生效**的根（否则用户不知道现在到底用的是哪个）'
  )
  assert.ok(lines.length >= 3, `至少三行（空闲 / 设置值 / 拒绝 / 生效根），实际 ${lines.length}`)
  // 被拒绝值的**原样**回显：大小写与多余空白都不许"美化"
  const spaced = migrationStatusText(null, {
    root: EFFECTIVE_DEFAULT,
    isDefault: true,
    configured: '  D:\\obox\\profiles  ',
    invalid: { value: '  D:\\obox\\profiles  ', reason: 'x' },
    env: { platform: 'win32' }
  })
  assert.match(spaced, /配置值： {2}D:\\obox\\profiles {2}/, '配置值必须原样回显')
})

test('③（1.0.6）生效根未知 ⇒ 明说"未知"（省略等于看起来一切正常）', () => {
  const text = migrationStatusText(null, { root: '', isDefault: true, configured: '' })
  assert.ok(text.includes(MIGRATION_STATUS_ROOT_UNKNOWN), `拿不到路径必须写出来，实际：${text}`)
  assert.equal(MIGRATION_STATUS_ROOT_UNKNOWN.includes('\n'), false, '该行必须单行')
})

test('③（1.0.6）"数据实际所在根"与"当前生效根"并列（用户一眼看出该用 A、数据却在 B）', () => {
  const text = migrationStatusText(null, {
    root: 'C:\\Users\\chenzhi\\Downloads',
    isDefault: false,
    source: 'configured',
    dataRoot: ACTUAL_ROOT,
    configured: 'C:\\Users\\chenzhi\\Downloads',
    env: { platform: 'win32' }
  })
  const lines = text.split('\n')
  assert.ok(lines.includes(`当前生效根 = C:\\Users\\chenzhi\\Downloads（来源：设置）`))
  assert.ok(
    lines.includes(`数据实际所在根 = ${ACTUAL_ROOT}`),
    `必须写出数据实测所在根，实际：${text}`
  )
  assert.ok(
    lines.indexOf(`当前生效根 = C:\\Users\\chenzhi\\Downloads（来源：设置）`) <
      lines.indexOf(`数据实际所在根 = ${ACTUAL_ROOT}`),
    '先"该用哪个"再"数据在哪"，读起来是"两件事对不上"'
  )
  // 探测不出数据在哪（两边都没有条目目录）⇒ 明说"无法判定 + 本次不迁移"
  const unknown = migrationStatusText(null, {
    root: 'C:\\Users\\chenzhi\\Downloads',
    isDefault: false,
    dataRoot: '',
    configured: 'C:\\Users\\chenzhi\\Downloads'
  })
  assert.match(unknown, /数据实际所在根 = 无法判定（.*本次不迁移）/)
  // 不传 dataRoot 键 ⇒ 不产出该行（向后兼容）
  assert.ok(!/数据实际所在根/.test(migrationStatusText(null, { root: ACTUAL_ROOT })))
})

test('③ 兼容：**不传**上下文时文本与 1.0.5 逐字一致（老调用方与老单测不受影响）', () => {
  assert.equal(migrationStatusText(null), MIGRATION_STATUS_IDLE)
  assert.equal(
    migrationStatusText({ phase: 'running', from: 'C:\\a', to: 'D:\\b', items: [] }),
    '浏览器数据迁移进行中：已搬 0/0\n目标根 = D:\\b'
  )
  // 上下文里**没有 root 这个键** ⇒ 不产出"当前生效根"行（只有 root 键存在才产出）
  const partial = migrationStatusText(null, { configured: '' })
  assert.equal(partial, `${MIGRATION_STATUS_IDLE}\n设置值 = （空，表示用默认根）`)
})

test('③（1.0.6）迁移进行中也带当前状态：既有进度文本一字未动 + 追加生效根/设置值', () => {
  const intent = createRootIntent({
    from: 'C:\\data\\chrome',
    to: CONFIGURED_NEW,
    items: [
      { name: 'A', status: 'done' },
      { name: 'B', status: 'overwritten', overwrite: true }
    ]
  })
  const text = migrationStatusText(intent, {
    root: 'C:\\data\\chrome',
    isDefault: true,
    source: 'migration-from',
    configured: CONFIGURED_NEW,
    env: { platform: 'win32' }
  })
  const lines = text.split('\n')
  assert.equal(lines[0], '浏览器数据迁移进行中：已搬 2/2', '既有进度文本必须一字未动')
  assert.ok(lines.includes('已覆盖 1 项（不可恢复）'))
  assert.ok(lines.includes(`当前生效根 = C:\\data\\chrome（来源：默认根）`))
  assert.ok(lines.includes(`设置值 = ${CONFIGURED_NEW}`))
  assert.ok(lines.includes(`目标根 = ${CONFIGURED_NEW}`), '既有"目标根"行仍在')
})

test('③（1.0.6）非阻塞提示（obox 段 / UNC）也进状态项', () => {
  const text = migrationStatusText(null, {
    root: EFFECTIVE_DEFAULT,
    isDefault: true,
    configured: 'D:\\obox\\profiles',
    warning: '提示：路径里有一段目录名叫 obox，请确认它不是 obox 程序自己的目录',
    env: { platform: 'win32' }
  })
  assert.match(text, /设置提示：提示：路径里有一段目录名叫 obox/)
  assert.ok(!/设置值被拒绝/.test(text), '只是提示，不构成拒绝')
})

// ---------------------------------------------------------------------------
// A（1.0.6）"数据现在到底在哪个根"的判据（纯函数 planDataRootProbe）
// ---------------------------------------------------------------------------

/** 用户机器实测的现场：默认根下仍有条目目录，设置值指向一个还不存在的目标根 */
const PROBE_SCENE = {
  entryNames: ['test'],
  defaultRoot: ACTUAL_ROOT,
  configuredRoot: 'C:\\Users\\chenzhi\\Downloads'
}

test('A 主用例（用户现场）：默认根下**仍有**该条目、目标根下没有 ⇒ known=默认根 ⇒ 触发迁移', () => {
  const verdict = planDataRootProbe({
    ...PROBE_SCENE,
    candidates: [
      { root: ACTUAL_ROOT, entries: ['test'] },
      { root: 'C:\\Users\\chenzhi\\Downloads', entries: [] }
    ]
  })
  assert.deepEqual(verdict, {
    root: ACTUAL_ROOT,
    isDefault: true,
    known: true,
    reason: 'matched-default',
    hits: 1
  })
  // ① 与激活期/设置变更对账连起来：**必须 trigger**（这正是"设置显示正常但什么都不发生"的反例）
  assert.equal(
    planActivationRootReconcile({
      configured: PROBE_SCENE.configuredRoot,
      dataRoot: verdict.root
    }).migrate,
    true
  )
  assert.equal(
    planRootChangeTrigger({ configured: PROBE_SCENE.configuredRoot, dataRoot: verdict.root })
      .trigger,
    true
  )
  // ② 迁移完成后同一套判据必须判"不触发"（防重复迁移）：条目目录已经出现在目标根下
  const after = planDataRootProbe({
    ...PROBE_SCENE,
    candidates: [
      { root: ACTUAL_ROOT, entries: [] },
      { root: 'C:\\Users\\chenzhi\\Downloads', entries: ['test'] }
    ]
  })
  assert.equal(after.root, 'C:\\Users\\chenzhi\\Downloads')
  assert.equal(after.reason, 'matched-configured')
  assert.equal(after.isDefault, false)
  assert.equal(
    planActivationRootReconcile({ configured: PROBE_SCENE.configuredRoot, dataRoot: after.root })
      .migrate,
    false,
    '迁移完成后再跑一次对账必须"不触发"（幂等）'
  )
})

test('A 判据：两边都无该条目 ⇒ known:false（无数据可迁，只写状态、不建意图不报错）', () => {
  const verdict = planDataRootProbe({
    entryNames: ['test'],
    defaultRoot: ACTUAL_ROOT,
    configuredRoot: 'C:\\Users\\chenzhi\\Downloads',
    candidates: [
      { root: ACTUAL_ROOT, entries: ['other'] },
      { root: 'C:\\Users\\chenzhi\\Downloads', entries: [] }
    ]
  })
  assert.deepEqual(verdict, {
    root: '',
    isDefault: false,
    known: false,
    reason: 'not-found',
    hits: 0
  })
  assert.equal(
    planActivationRootReconcile({
      configured: 'C:\\Users\\chenzhi\\Downloads',
      dataRoot: verdict.root
    }).migrate,
    false
  )
})

test('A 判据：库里没有条目 ⇒ 没有数据要迁，数据根 = 设置值（未配置则默认根）', () => {
  const configured = planDataRootProbe({
    entryNames: [],
    defaultRoot: ACTUAL_ROOT,
    configuredRoot: 'C:\\Users\\chenzhi\\Downloads',
    candidates: [
      { root: ACTUAL_ROOT, entries: [] },
      { root: 'C:\\Users\\chenzhi\\Downloads', entries: [] }
    ]
  })
  assert.deepEqual(configured, {
    root: 'C:\\Users\\chenzhi\\Downloads',
    isDefault: false,
    known: true,
    reason: 'no-entries',
    hits: 0
  })
  const fallback = planDataRootProbe({
    entryNames: [],
    defaultRoot: ACTUAL_ROOT,
    candidates: [{ root: ACTUAL_ROOT, entries: [] }]
  })
  assert.equal(fallback.root, ACTUAL_ROOT)
  assert.equal(fallback.isDefault, true)
})

test('A 判据：一个候选根都拿不到 ⇒ known:false（默认根未知 + 未配置）', () => {
  const verdict = planDataRootProbe({ entryNames: ['test'], candidates: [] })
  assert.equal(verdict.known, false)
  assert.equal(verdict.reason, 'no-candidates')
  assert.equal(planDataRootProbe({ entryNames: [], candidates: [] }).reason, 'no-candidates')
})

test('A 判据：多个条目按**命中数最多**取；同分时默认根优先；候选去重', () => {
  // 部分搬完的中间态：旧根命中 2、新根命中 1 ⇒ 取旧根（源仍在旧根）
  const partial = planDataRootProbe({
    entryNames: ['a', 'b', 'c'],
    defaultRoot: ACTUAL_ROOT,
    configuredRoot: 'E:\\new',
    candidates: [
      { root: ACTUAL_ROOT, entries: ['a', 'b'] },
      { root: 'E:\\new', entries: ['c'] }
    ]
  })
  assert.equal(partial.root, ACTUAL_ROOT)
  assert.equal(partial.hits, 2)
  // 同分 ⇒ 默认根优先（它是第一个候选）
  const tie = planDataRootProbe({
    entryNames: ['a', 'b'],
    defaultRoot: ACTUAL_ROOT,
    configuredRoot: 'E:\\new',
    candidates: [
      { root: ACTUAL_ROOT, entries: ['a'] },
      { root: 'E:\\new', entries: ['b'] }
    ]
  })
  assert.equal(tie.root, ACTUAL_ROOT)
  assert.equal(tie.isDefault, true)
  // 同一个根传两次（大小写/尾斜杠差异）⇒ 去重，不会因重复而改变结论
  const dup = planDataRootProbe({
    entryNames: ['a'],
    defaultRoot: ACTUAL_ROOT,
    candidates: [
      { root: ACTUAL_ROOT, entries: ['a'] },
      { root: `${ACTUAL_ROOT.toUpperCase()}\\`, entries: [] }
    ]
  })
  assert.equal(dup.hits, 1)
  // 大小写不敏感：设置值写成小写/正斜杠也要认出它
  const normalized = planDataRootProbe({
    entryNames: ['test'],
    defaultRoot: ACTUAL_ROOT,
    configuredRoot: 'c:/users/chenzhi/downloads',
    candidates: [
      { root: ACTUAL_ROOT, entries: [] },
      { root: 'C:\\Users\\chenzhi\\Downloads', entries: ['test'] }
    ],
    env: { platform: 'win32' }
  })
  assert.equal(normalized.reason, 'matched-configured')
  assert.equal(normalized.root, 'C:\\Users\\chenzhi\\Downloads')
})

test('A 判据：条目名空白/重复不影响结论（归一后再比）', () => {
  const verdict = planDataRootProbe({
    entryNames: [' test ', 'test', '', null],
    defaultRoot: ACTUAL_ROOT,
    candidates: [{ root: ACTUAL_ROOT, entries: ['test'] }]
  })
  assert.equal(verdict.hits, 1)
  assert.equal(verdict.known, true)
})

// ---------------------------------------------------------------------------
// A（1.0.6）激活期对账：设置值 ≠ 实际数据根 ⇒ 自动开始迁移
// ---------------------------------------------------------------------------

test('A 激活期对账：**无配置** ⇒ 不迁移（空 = 默认根，回填后更是同路径）', () => {
  for (const configured of ['', '   ', null, undefined]) {
    const plan = planActivationRootReconcile({ configured, dataRoot: ACTUAL_ROOT })
    assert.deepEqual(plan, { migrate: false, root: '', reason: 'configured-empty' })
  }
})

test('A 激活期对账：配置值 == 实际数据根 ⇒ 不迁移（**对账幂等** / 不会重复搬）', () => {
  // 迁移完成后再激活的形态：设置值就是新家，探测出的数据根也是它
  for (const configured of [
    ACTUAL_ROOT,
    'c:/users/me/appdata/roaming/obox/extensions/webapp_chenzhi/data/chrome',
    `${ACTUAL_ROOT}\\`
  ]) {
    const plan = planActivationRootReconcile({ configured, dataRoot: ACTUAL_ROOT })
    assert.equal(plan.migrate, false, `${configured} 与实际数据根同路径 ⇒ 不得迁移`)
    assert.equal(plan.reason, 'same-as-current')
  }
  // 默认根回填的形态：设置里被写成默认根绝对路径 ⇒ 仍是"同路径"
  assert.equal(
    planActivationRootReconcile({ configured: ACTUAL_ROOT, dataRoot: ACTUAL_ROOT }).migrate,
    false
  )
})

test('A 激活期对账：**配置值 ≠ 实际数据根且无意图 ⇒ 迁移**（本次报障的主路径）', () => {
  // 用户现场：设置里有值（合法、目标目录还不存在），数据仍在默认根 ⇒ 必须触发
  const plan = planActivationRootReconcile({
    configured: CONFIGURED_NEW,
    dataRoot: ACTUAL_ROOT
  })
  assert.deepEqual(plan, { migrate: true, root: CONFIGURED_NEW, reason: 'changed' })
  // 目标根**不存在**不是跳过理由（由 prepareRoot 建目录 + 写标记）
  assert.equal(
    planActivationRootReconcile({ configured: 'E:\\new', dataRoot: ACTUAL_ROOT }).migrate,
    true
  )
  // 旧根是"自定义根"时同样触发（数据根来自探测，不限于默认根）
  assert.equal(
    planActivationRootReconcile({ configured: 'E:\\new', dataRoot: 'D:\\obox-webapp\\old' })
      .migrate,
    true
  )
})

test('A 激活期对账：已有未完成意图 ⇒ 不迁移（交给既有对账续做，不叠开第二个）', () => {
  const plan = planActivationRootReconcile({
    configured: 'E:\\other',
    dataRoot: ACTUAL_ROOT,
    migrationTarget: 'F:\\target',
    hasActiveIntent: true
  })
  assert.equal(plan.migrate, false)
  assert.equal(plan.reason, 'migration-active')
  // 意图的目标根 == 配置值 ⇒ 同样不动（幂等）
  const same = planActivationRootReconcile({
    configured: 'f:/target/',
    dataRoot: ACTUAL_ROOT,
    migrationTarget: 'F:\\target',
    hasActiveIntent: true
  })
  assert.equal(same.migrate, false)
  assert.equal(same.reason, 'same-as-migration-target')
})

test('A 激活期对账：配置值非法 ⇒ 不迁移（只写状态 + 日志）；V5 收紧后 `D:\\obox\\profiles` 是合法的', () => {
  // ⚠️ 1.0.6 收紧了 V5：`D:\obox\profiles`（只是"某段目录名叫 obox"）**不再被拒**，因此它是
  // **合法根**、应当触发迁移——旧实现的静默误伤正是本次"配置没生效"的来源之一（见 P-4）。
  const accepted = planActivationRootReconcile({
    configured: 'D:\\obox\\profiles',
    dataRoot: ACTUAL_ROOT,
    env: { platform: 'win32' }
  })
  assert.deepEqual(accepted, {
    migrate: true,
    root: 'D:\\obox\\profiles',
    reason: 'changed'
  })
  // 真正的非法形态一律不迁移（相对路径 / 盘符根 / UNC 根），且必须带原因供状态与日志
  for (const configured of ['profiles\\x', 'C:\\', '\\\\server\\share']) {
    const bad = planActivationRootReconcile({
      configured,
      dataRoot: ACTUAL_ROOT,
      env: { platform: 'win32' }
    })
    assert.equal(bad.migrate, false, `${configured} 非法 ⇒ 不得迁移`)
    assert.equal(bad.reason, 'configured-invalid')
    assert.ok(String(bad.detail ?? '').length > 0, '非法必须带上原因（供状态与日志）')
  }
})

test('A 激活期对账：**实际数据根未知 ⇒ 一律不迁移**（保守闸门，绝不搬错一侧）', () => {
  for (const dataRoot of ['', '   ', null, undefined]) {
    const plan = planActivationRootReconcile({ configured: CONFIGURED_NEW, dataRoot })
    assert.equal(plan.migrate, false, `dataRoot=${String(dataRoot)} 时不得迁移`)
    assert.equal(plan.reason, 'data-root-unknown')
  }
})

test('A 反向验收（1.0.6）：数据在自定义根、设置改回默认根 ⇒ 触发，且 `from` = **数据实际所在的根**', () => {
  // 现场补充：助手已手工把 `data\chrome\test` 搬到 `C:\Users\chenzhi\Downloads\新建文件夹`，
  // 默认根现在是空的。此时若把设置改回默认根（或改到另一个新目录），必须：
  //   ① 判出"数据实际在 新建文件夹"（**不是**默认根）；
  //   ② 以它为**源**触发迁移。
  const customRoot = 'C:\\Users\\chenzhi\\Downloads\\新建文件夹'
  const probe = planDataRootProbe({
    entryNames: ['test'],
    defaultRoot: ACTUAL_ROOT,
    configuredRoot: ACTUAL_ROOT, // 设置已经改回默认根
    candidates: [
      { root: ACTUAL_ROOT, entries: [] }, // 默认根现在是空的
      { root: customRoot, entries: ['test'] } // 数据在这儿
    ]
  })
  assert.equal(probe.root, customRoot, '数据实际所在根必须是"新建文件夹"，而不是默认根')
  assert.equal(probe.reason, 'matched-configured')
  assert.equal(probe.isDefault, false)
  // ① 改回**默认根**（配置值是默认根的绝对路径）⇒ 必须触发，目标是默认根
  assert.deepEqual(planActivationRootReconcile({ configured: ACTUAL_ROOT, dataRoot: probe.root }), {
    migrate: true,
    root: ACTUAL_ROOT,
    reason: 'changed'
  })
  // ② 改到**另一个新目录** ⇒ 同样触发，目标 = 新目录，源仍是 probe.root
  assert.deepEqual(
    planActivationRootReconcile({ configured: 'E:\\another-new', dataRoot: probe.root }),
    { migrate: true, root: 'E:\\another-new', reason: 'changed' }
  )
  // ③ 设置仍是"新建文件夹"（数据也在那儿）⇒ 不触发（这就是用户装 1.0.6 后的状态，不得重复迁移）
  assert.equal(
    planActivationRootReconcile({ configured: customRoot, dataRoot: probe.root }).migrate,
    false
  )
  // 大小写/正斜杠写法也要认得出来（配置值与数据根同路径）
  assert.equal(
    planActivationRootReconcile({
      configured: 'c:/users/chenzhi/downloads/新建文件夹/',
      dataRoot: customRoot,
      env: { platform: 'win32' }
    }).migrate,
    false
  )
})

test('A 激活期对账：与设置变更触发点**共用同一份路径比较**（判据不会漂移）', () => {
  for (const input of [
    { configured: '', dataRoot: ACTUAL_ROOT },
    { configured: CONFIGURED_NEW, dataRoot: ACTUAL_ROOT },
    { configured: ACTUAL_ROOT, dataRoot: ACTUAL_ROOT },
    { configured: 'F:\\target', dataRoot: ACTUAL_ROOT, migrationTarget: 'F:\\target' },
    { configured: 'profiles\\x', dataRoot: ACTUAL_ROOT },
    { configured: 'E:\\other', dataRoot: ACTUAL_ROOT, hasActiveIntent: true }
  ]) {
    const base = planRootChangeTrigger(input)
    const activation = planActivationRootReconcile(input)
    assert.equal(
      activation.migrate,
      base.trigger,
      `两条触发点的结论必须一致：${JSON.stringify(input)}`
    )
    assert.equal(activation.reason, base.reason)
  }
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

test('④ 回填时机（1.0.6 修订）：**激活期主动**调它（不再挂 ensureHelper 的 fire-and-forget），且幂等', () => {
  assert.match(INDEX_CODE, /async function backfillDefaultRoot\(/, '必须有回填实现')
  assert.match(INDEX_CODE, /let defaultRootBackfilled = false/, '必须有进程内一次性的开关')
  const body = functionBody(INDEX_CODE, 'async function backfillDefaultRoot(')
  assert.match(body, /planDefaultRootBackfill\(/, '判据必须复用纯函数（不得自己写一份）')
  assert.match(body, /profileRootStatus/, '默认根绝对路径只能来自助手')
  assert.match(body, /if \(defaultRootBackfilled\) return/, '必须幂等（进程内只做一次）')
  // ⚠️ **1.0.6 的时机变更**：1.0.5 把回填挂在 `ensureHelper().then()` 里（= 用户第一次用助手之后）
  // 且不 await；用户报障"设置页显示不出当前路径"正来自这里（要打开过卡片才回填）。
  // 现在由**激活期引导** `await` 调用，且**只能有这一个调用点**（两处会互相抢跑：幂等开关在入口
  // 就置位，导致后到的那次立刻返回、`defaultRootAbs` 还没写进去，对账会拿到"数据根未知"）。
  const helperFn = functionBody(INDEX_CODE, 'function ensureHelper(')
  assert.ok(
    !helperFn.includes('backfillDefaultRoot'),
    '回填不得再挂在 ensureHelper 里（fire-and-forget 会与激活期引导抢跑）'
  )
  const bootstrapFn = functionBody(INDEX_CODE, 'async function bootstrapRootsOnActivation(')
  assert.match(bootstrapFn, /await ensureHelper\(\)/, '激活期必须主动连助手')
  assert.match(
    bootstrapFn,
    /await backfillDefaultRoot\(\)/,
    '连上之后必须回填（await：顺序不可颠倒）'
  )
  assert.match(
    bootstrapFn,
    /await reconcileRootOnActivation\(\)/,
    '回填之后必须做改根对账（见 A 项矩阵）'
  )
  const order = ['ensureHelper()', 'backfillDefaultRoot()', 'reconcileRootOnActivation()'].map(
    (needle) => bootstrapFn.indexOf(needle)
  )
  assert.ok(
    order[0] < order[1] && order[1] < order[2],
    '顺序必须是 连助手 → 回填（拿到默认根）→ 对账（否则"实际数据根"未知，对账会保守地不动）'
  )
  // 激活期引导必须真的被调用，且**不 await**（激活本身不许被阻塞）
  assert.match(INDEX_CODE, /void bootstrapRootsOnActivation\(\)/, '激活期引导必须被调用')
  // 任何一步失败都只 warn：引导整体包在 try/catch 里（1.0.4 的崩溃态正是"激活期抛错"）
  assert.match(bootstrapFn, /catch \(err\)/, '引导必须自己吞掉异常（绝不让激活失败）')
  assert.match(bootstrapFn, /console\.warn/, '失败必须留痕')
  assert.ok(
    !/throw /.test(bootstrapFn),
    '引导不得抛错（助手连不上时只是跳过，首次用到助手时会再试）'
  )
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
  assert.equal(
    writes.length,
    7,
    `api.settings.set 应恰好 7 处（5 profileRoot + 1 status + 1 progress），实际 ${writes.length}`
  )
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
  assert.match(wrapper, /migrationStatusText\(intent, statusContext\(\)\)/, '文本必须来自纯函数')
  // 1.0.6：无迁移时也要写出"当前生效根 / 设置值"（用户只打开设置页就能自查）
  assert.match(
    INDEX_CODE,
    /function statusContext\(/,
    '必须有状态上下文（生效根 + 设置值 + 被拒原因）'
  )
  // 改根判定（readSettings）只读 profileRoot
  const readSettingsFn = functionBody(INDEX_CODE, 'function readSettings(')
  assert.ok(!readSettingsFn.includes('migrationStatus'), '改根判定不得读 migrationStatus')
  assert.ok(
    !readSettingsFn.includes('migrationProgress'),
    '改根判定不得读 migrationProgress（模态框进度与改根无关）'
  )
  // onChanged：只有三个真正的配置键才作废体积缓存
  const onChangedAt = INDEX_CODE.indexOf('api.settings.onChanged(')
  const onChangedFn = INDEX_CODE.slice(onChangedAt, INDEX_CODE.indexOf('// ---- 方法实现 ----'))
  assert.ok(onChangedAt > 0 && onChangedFn.length > 0, '必须能定位到 onChanged 的接线')
  assert.ok(
    !/key\.startsWith\('webapp\.'\)/.test(onChangedFn),
    'onChanged 不得对一切 webapp.* 键都作废缓存（migrationStatus/migrationProgress 会被频繁写）'
  )
  assert.match(onChangedFn, /SETTING_KEYS\.profileRoot/, 'profileRoot 变更仍必须作废体积缓存')
  assert.ok(
    !/SETTING_KEYS\.migrationProgress/.test(onChangedFn),
    'onChanged 不得订阅 migrationProgress（每搬一条都写它，订阅会让别的逻辑被高频触发）'
  )
})

test('③（1.0.6）`api.settings.set` 的**按 key 计数门禁**：每个 key 的写入点数量与理由', () => {
  // 为什么按 key 数而不是只数总数：每个 key 的写入点各有安全含义（理由见下）。
  // 总数变化时先看"哪个 key 多了一处"——那才是需要解释的东西。
  const countOf = (key) =>
    [...INDEX_CODE.matchAll(new RegExp(`api\\.settings\\.set\\(\\s*SETTING_KEYS\\.${key}`, 'g'))]
      .length
  assert.deepEqual(
    {
      profileRoot: countOf('profileRoot'),
      migrationStatus: countOf('migrationStatus'),
      migrationProgress: countOf('migrationProgress')
    },
    {
      // 迁移完成 / 放弃回写 / 无存量条目 / 默认根回填 / 迁移中改根的回写（5 处，均为"改根"语义）
      profileRoot: 5,
      // 只有 writeMigrationStatusText 一处（其余调用都经它）
      migrationStatus: 1,
      // **只有 writeMigrationProgress 一处**：分散写会让 `finally` 的清空漏掉某条路径
      // ⇒ 用户被永久锁在不可关闭的模态框里（本需求最危险的失败模式）
      migrationProgress: 1
    },
    '写入点数量变了：多一处就要在注释里写清"它为什么必须存在"'
  )
  const progressWrites = functionBody(INDEX_CODE, 'function writeMigrationProgress(')
  assert.match(progressWrites, /api\.settings\.set\(SETTING_KEYS\.migrationProgress, text\)/)
  assert.match(progressWrites, /migrationProgressText\(value\)/, '文本必须来自纯函数')
  assert.match(progressWrites, /if \(String\(current \?\? ''\) === text\) return/, '值没变不写')
})

test('11（1.0.6）模态框的**关闭信号**：清空点必须覆盖成功 / 失败 / 异常三条路径', () => {
  // 宿主的等待模态框对"`status` + `modal:true` 且值非空"是**无关闭按钮 / Esc 无效 / 点遮罩无效**，
  // 唯一出口就是扩展把 `webapp.migrationProgress` 写成空串 ⇒ 清空点漏一个，用户就被锁死。
  const fn = INDEX_CODE.slice(INDEX_CODE.indexOf('async function reconcileIntent('))
  assert.match(fn, /writeMigrationProgress\(current\)/, '循环入口要挂上模态框（第一行 0/N）')
  const finallyAt = fn.indexOf('.finally(() => {')
  assert.ok(finallyAt > 0, '必须有 finally')
  const clearAt = fn.indexOf('clearMigrationProgress()', finallyAt)
  assert.ok(
    clearAt > finallyAt,
    'finally 里必须调 clearMigrationProgress()（成功/失败/异常都经它）'
  )
  const catchAt = fn.indexOf('.catch((err) => {')
  assert.ok(
    catchAt > 0 && catchAt < finallyAt,
    '必须有 catch 且排在 finally 之前（异常也要落到 finally）'
  )
  assert.match(
    fn.slice(catchAt, finallyAt),
    /writeMigrationStatusText\(/,
    '异常路径必须把"迁移中断：<原因>"写进 migrationStatus（不能只留控制台日志）'
  )
  assert.ok(
    !/clearMigrationProgress\(\)/.test(fn.slice(catchAt, finallyAt)),
    '清空只在 finally 里做（写两处会出现"先清后又写回"的顺序问题）'
  )
  // 迁移开始前也要写第一行进度（用户点完目录立刻看到模态框）
  const startFn = functionBody(INDEX_CODE, 'async function startRootMigration(')
  assert.match(
    startFn,
    /writeMigrationProgress\(intent\)[\s\S]*await reconcileNow\(\)/,
    'startRootMigration 必须在真正动手前就写上第一行进度'
  )
  // 激活期自愈：进程被杀导致进度残留时，下次激活必须先清空（否则设置页被打不开的遮罩锁住）
  const bootstrap = functionBody(INDEX_CODE, 'async function bootstrapRootsOnActivation(')
  assert.match(bootstrap, /clearMigrationProgress\(\)/, '激活期必须先清空残留进度（自愈）')
  assert.ok(
    bootstrap.indexOf('clearMigrationProgress()') < bootstrap.indexOf('ensureHelper()'),
    '清空必须发生在连助手/对账**之前**'
  )
  // 卸载/停用也尽力清空（第一道防线）
  assert.match(
    INDEX_CODE.slice(INDEX_CODE.indexOf('return () => {')),
    /clearMigrationProgress\(\)/,
    '扩展停用/卸载时也要尽力清空'
  )
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

// ---------------------------------------------------------------------------
// A（1.0.6）接线：迁移的**源**必须是"实际数据根"，不是设置值
// ---------------------------------------------------------------------------

test('A 根因门禁：迁移的源不再取设置值（`effectiveRootNow()`），改由 `resolveDataRoot()` 探测', () => {
  // ⚠️ 这是本次报障的**根因**：宿主设置页会把用户选的值立刻写进设置，而 `effectiveRootNow()`
  // 就是从设置值推出来的 ⇒ `configured == dataRoot` 恒成立 ⇒ `same-as-current` / `无需迁移`
  // ⇒ 1.0.3–1.0.5 的"改根自动迁移"事实上从未生效（用户现场：设置里有值、profile 原地未动、
  // 目标目录不存在、连意图文件都没有）。
  assert.match(INDEX_CODE, /async function resolveDataRoot\(/, '必须有"实际数据根"的探测')
  const probe = functionBody(INDEX_CODE, 'async function resolveDataRoot(')
  // 探测必须**只读**：不建根、不搬、不删、不写设置
  for (const forbidden of [
    'api.settings.set',
    'prepareRoot',
    'migrateRootDir',
    'removeProfile',
    'cleanCaches',
    'writeRootIntent',
    'createRootIntent'
  ]) {
    assert.ok(!probe.includes(forbidden), `实际数据根的探测里不得出现 ${forbidden}（必须只读）`)
  }
  // 取数与判据分离：探测只负责**实测**（助手只读列目录 + 读库），判据在纯函数里（有表驱动单测）
  assert.match(probe, /probeRoot\(/, '必须由助手实测两条候选根（不是问设置）')
  const probeRootFn = functionBody(INDEX_CODE, 'async function probeRoot(')
  assert.match(probeRootFn, /profileRootStatus/, '实测必须走助手的 profileRootStatus（entries）')
  assert.match(probe, /planDataRootProbe\(/, '判据必须复用纯函数（不得自己写一份）')
  assert.match(probe, /entryNames/, '必须拿条目库里的目录名当探针')
  assert.ok(
    !/\.entries\.has\(|includes\(name\)/.test(probe),
    '不得在入口里自己算"命中数"（那是纯函数 planDataRootProbe 的职责）'
  )
  assert.match(probe, /known: false/, '判定不出来时必须显式标成未知（禁止猜）')

  // 三个迁移入口都必须用实际数据根
  const handler = functionBody(INDEX_CODE, 'async function onProfileRootSettingChanged(')
  assert.match(handler, /await resolveDataRoot\(\)/, '设置变更触发点必须用实际数据根比较')
  assert.ok(
    !/info\.isDefault \? defaultRootAbs : info\.root/.test(handler),
    '不得再用 `effectiveRootNow()` 的根当"数据当前所在根"（那正是"永不触发"的根因）'
  )
  const startFn = functionBody(INDEX_CODE, 'async function startRootMigration(')
  assert.match(startFn, /await resolveDataRoot\(\)/, '状态机入口必须用实际数据根当**源**')
  assert.ok(
    !/info\.root/.test(startFn),
    'startRootMigration 里不得再出现 `info.root`（设置值不当源）'
  )
  assert.match(startFn, /const sourceRoot = /, '源根必须是显式变量（可审计）')
  assert.match(startFn, /from: sourceRoot/, '意图的 `from` 必须是实际数据根')
  assert.match(startFn, /listRootEntries\(sourceRoot\)/, '条目扫描必须针对实际数据根')
  assert.match(
    startFn,
    /无法确定浏览器数据当前所在根/,
    '探测不出数据在哪时必须**拒绝迁移**（宁可不动，也不搬错一侧）'
  )
  // 有未完成意图时以意图的 `from` 为准（迁移中实时命中数会从旧根漂向新根）
  assert.match(startFn, /active\?\.from/, '有意图时必须用意图里的 from（源根不可半路改）')
})

test('A 接线：激活期对账走**同一个状态机入口**，且不自己做迁移、不预检目标根是否存在', () => {
  assert.match(INDEX_CODE, /planActivationRootReconcile/, '必须复用纯函数判据')
  const fn = functionBody(INDEX_CODE, 'async function reconcileRootOnActivation(')
  assert.match(fn, /await resolveDataRoot\(\)/, '对账的 dataRoot 必须来自探测')
  assert.match(fn, /await startRootMigration\(\{ root: plan\.root \}\)/, '必须走同一个状态机入口')
  assert.ok(
    !/prepareRoot|migrateRootDir|createRootIntent|writeRootIntent/.test(fn),
    '不得在激活期对账里自己拼一套迁移（必须走同一个状态机入口）'
  )
  // 自愈的前提：**不得**因为"目标根不存在"就跳过（目标根由 prepareRoot 建 + 写标记）
  assert.ok(
    !/isDirectory|existsSync|exists\b/.test(fn),
    '不得预检目标根是否存在——用户现场的目标根就是"还不存在"，跳过等于永不迁移'
  )
  // 无论走哪条分支，都要留下**可读的日志**（用户现场需要"检测到不同 ⇒ 自动开始迁移"这一行）
  assert.match(fn, /检测到设置里的根与实际数据根不同 ⇒ 自动开始迁移/)
  assert.match(fn, /激活期对账：无需迁移/)
  // 失败不得影响激活
  assert.match(fn, /catch \(err\)/)
  assert.match(fn, /激活期对账失败（不影响其它功能）/)
})

test('A 幂等：迁移完成 / 放弃 / "无需迁移"改根三处都刷新"实际数据根"', () => {
  assert.match(INDEX_CODE, /function rememberMigratedRoot\(/, '必须有刷新实际数据根的落点')
  // ⚠️ `reconcileIntent(options = {})` 的默认参数里有花括号，`functionBody` 会切错位置
  // ⇒ 这一条直接对整份源码断言（字符串在入口里唯一）
  assert.match(
    INDEX_CODE,
    /rememberMigratedRoot\(current\.to, 'migrated'\)/,
    '迁移完成后数据在新根 ⇒ 下次激活对账判"同路径"、不会重复搬（幂等的落点）'
  )
  const resolveFn = functionBody(INDEX_CODE, 'async function resolveRootMigration(')
  assert.match(resolveFn, /rememberMigratedRoot\(from, 'abandoned'\)/, '放弃后数据仍在旧根')
  const startFn = functionBody(INDEX_CODE, 'async function startRootMigration(')
  assert.match(
    startFn,
    /rememberMigratedRoot\(target\.root, 'no-entries'\)/,
    '无存量条目时数据根 = 目标根'
  )
})

test('C 被拒绝的设置值**必须写进状态项**（不许只留控制台日志）', () => {
  // 用户现场的另一半：设置页显示着自己的值、实际一直用默认根，而原因只在控制台 ⇒ 无从自查。
  const handler = functionBody(INDEX_CODE, 'async function onProfileRootSettingChanged(')
  const unchangedAt = handler.indexOf('if (!plan.changed)')
  const rejectAt = handler.indexOf('if (!plan.trigger)')
  assert.ok(unchangedAt > 0 && rejectAt > unchangedAt, '必须能定位到"这次变更被忽略"的分支')
  const ignored = handler.slice(unchangedAt, rejectAt)
  assert.match(
    ignored,
    /writeMigrationStatus\(active\)/,
    '被忽略的变更（含值非法）必须刷新状态项——那里会写出"设置值被拒绝：<原因>（配置值：<原样>）"'
  )
  // 状态上下文必须把"被拒绝的值 + 原因"交给纯函数
  const ctx = functionBody(INDEX_CODE, 'function statusContext(')
  assert.match(ctx, /invalid:/, '必须把 invalid 交给纯函数')
  assert.match(ctx, /verdict\.reason/, '必须带上不通过的原因')
  assert.match(ctx, /configured: settings\.profileRoot/, '必须把设置里读到的**原样**值交出去')
  assert.match(ctx, /dataRootProbe/, '必须把"数据实际所在根"的探测结论交出去（与生效根并列）')
  assert.match(ctx, /warning/, '非阻塞提示（obox 段 / UNC）也要进状态项')
})
