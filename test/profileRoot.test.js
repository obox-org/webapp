/**
 * `lib/profileRoot.mjs` 的纯函数单测（规格 §14.1 的 P-1..P-16 逐条落在此处）。
 *
 * 为什么这批用例是**最高价值**的：本需求的不可逆动作（覆盖删除、删源、删条目、清缓存）
 * 全部由这里的纯函数把关——`decideMigrationItem` / `verifyMigration` / `conflictsConfirmed`
 * 判错一次，用户就是**永久**丢掉一份登录态。真机验收只能事后证明"没出事"。
 *
 * 另一类是**反向门禁**（P-14/P-16）：`lib/` 下不得出现第二份根解析实现，
 * 也不得出现任何"覆盖前先留一份"的备份路径（P1 = B：用户明确接受不备份）。
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  ACTIVE_ITEM_STATUSES,
  DEFAULT_ROOT_DIRNAME,
  EXT_ID,
  MARKER_ID,
  MIGRATION_PHASES,
  MIN_COPY_RATIO,
  ROOT_INTENT,
  ROOT_INTENT_KIND,
  ROOT_INTENT_SCHEMA,
  ROOT_MARKER,
  abbreviateRoot,
  advanceMigrationState,
  applyItemResult,
  canonicalRoot,
  checkCandidateRoot,
  checkNotDataDir,
  conflictsConfirmed,
  createMarker,
  createRootIntent,
  decideMigrationItem,
  formatCardDataDir,
  hasActiveItems,
  hasFailedItems,
  isDriveRoot,
  isManagedTargetRoot,
  isMigrationComplete,
  isMigratableIntent,
  isUncPath,
  isUncRoot,
  normalizeIntentItem,
  normalizeRoot,
  pendingConflicts,
  progressText,
  readMarker,
  resolveEffectiveRoot,
  samePath,
  summarize,
  verifyMigration,
  volumeOf
} from '../lib/profileRoot.mjs'

// ---------------------------------------------------------------------------
// P-1..P-7：根路径归一与校验（V1–V5）
// ---------------------------------------------------------------------------

test('P-1：空串 / 纯空白 = 默认根（不是错误）', () => {
  assert.deepEqual(normalizeRoot(''), { kind: 'default' })
  assert.deepEqual(normalizeRoot('   '), { kind: 'default' })
  assert.deepEqual(normalizeRoot(null), { kind: 'default' })
  assert.deepEqual(normalizeRoot(undefined), { kind: 'default' })
})

test('P-2：相对路径一律拒绝，文案指明"绝对路径"', () => {
  for (const value of ['chrome', '.\\profiles', 'profiles\\x', '..\\chrome', './x']) {
    const verdict = normalizeRoot(value)
    assert.equal(verdict.kind, 'invalid', `${value} 应被拒`)
    assert.match(verdict.reason, /绝对路径/)
    // 非法时**必须**回显原始值供界面显示原因
    assert.equal(verdict.value, value)
  }
})

test('P-3：盘符根（C:\\、D:/、C:）一律拒绝，文案指明"磁盘根目录"', () => {
  for (const value of ['C:\\', 'D:/', 'c:\\', 'C:']) {
    assert.equal(isDriveRoot(value), true, `${value} 应被识别为盘符根`)
    const verdict = normalizeRoot(value)
    assert.equal(verdict.kind, 'invalid', `${value} 应被拒`)
    assert.match(verdict.reason, /磁盘根目录/)
  }
  assert.equal(isDriveRoot('C:\\Users'), false)
  assert.equal(isDriveRoot('C:\\Users\\me\\profiles'), false)
})

test('P-4：obox 程序目录（自身或位于其下）被拒，文案含"obox"', () => {
  const execPath = 'C:\\Users\\me\\AppData\\Local\\Programs\\obox\\obox.exe'
  const installDir = 'C:\\Users\\me\\AppData\\Local\\Programs\\obox'
  for (const value of [installDir, `${installDir}\\profiles`, `${installDir}\\data\\chrome`]) {
    const verdict = normalizeRoot(value, { execPath, platform: 'win32' })
    assert.equal(verdict.kind, 'invalid', `${value} 应被拒`)
    assert.match(verdict.reason, /obox/)
  }
  // 路径段里**真的**有名为 obox 的目录 ⇒ 也拒（不靠 execPath 也能判）
  assert.match(
    String(normalizeRoot('D:\\obox\\profiles', { execPath, platform: 'win32' }).reason),
    /obox/
  )
  // 与 obox 安装目录无关的路径正常通过
  assert.equal(
    normalizeRoot('D:\\obox-webapp\\profiles', { execPath, platform: 'win32' }).kind,
    'absolute',
    '`obox-webapp` 不是 `obox` 目录，不得误伤'
  )
  // ⚠️ **不做**"根是安装目录的祖先就拒"：`C:\\Users`、`C:\\Program Files` 这类系统目录
  // 会被一刀切拒掉（过宽）；改为按"路径段里是否有 obox"判（上面那条）
  assert.equal(normalizeRoot('C:\\Users', { execPath, platform: 'win32' }).kind, 'absolute')
})

test('P-5：V6 —— 不能指向扩展 data 目录自身或其祖先', () => {
  const dataDir = 'D:\\data-root\\extensions\\webapp_chenzhi\\data'
  assert.match(String(checkNotDataDir(dataDir, dataDir)?.reason), /数据目录/)
  assert.match(String(checkNotDataDir('D:\\data-root', dataDir)?.reason), /数据目录/)
  assert.match(String(checkNotDataDir('D:\\data-root\\extensions', dataDir)?.reason), /数据目录/)
  assert.equal(checkNotDataDir('D:\\obox-webapp\\profiles', dataDir), null)
  // dataDir 未知（助手侧没有它）⇒ 跳过该条，不误判
  assert.equal(checkNotDataDir('D:\\anything', ''), null)

  const verdict = checkCandidateRoot({
    candidate: dataDir,
    dataDir,
    isDirectory: true,
    platform: 'win32'
  })
  assert.match(String(verdict.invalid?.reason), /数据目录/)
  assert.equal(verdict.root, null)
})

test('P-6：正常绝对路径（含中文/空格）⇒ absolute；尾部分隔符被去掉且幂等', () => {
  const verdict = normalizeRoot('D:\\obox-webapp\\站点 数据\\')
  assert.equal(verdict.kind, 'absolute')
  assert.equal(verdict.root, 'D:\\obox-webapp\\站点 数据')
  assert.equal(verdict.warning, null, '本地路径不得有不必要的警告')
  // 幂等：再归一一次结果不变
  assert.equal(normalizeRoot(verdict.root).root, verdict.root)
  // 反斜杠/正斜杠混写也会被统一
  assert.equal(normalizeRoot('D:/obox-webapp/profiles').root, 'D:\\obox-webapp\\profiles')
})

test('P-7：UNC 允许（P2 已闭合）⇒ kind:absolute-unc + 非空性能警告', () => {
  const verdict = normalizeRoot('\\\\server\\share\\profiles')
  assert.equal(verdict.kind, 'absolute-unc')
  assert.ok(String(verdict.warning ?? '').length > 0, 'UNC 必须带性能警告文案')
  assert.match(verdict.warning, /明显变慢/)
  // 共享的**根**不是合法的数据目录（与盘符根同级）
  assert.equal(isUncPath('\\\\server\\share\\x'), true)
  assert.equal(isUncRoot('\\\\server\\share'), true)
  assert.equal(isUncRoot('\\\\server\\share\\profiles'), false)
  const rootVerdict = normalizeRoot('\\\\server\\share')
  assert.equal(rootVerdict.kind, 'invalid')
  assert.match(rootVerdict.reason, /网络共享的根/)
})

// ---------------------------------------------------------------------------
// P-8：标记文件（P3 = 五字段）
// ---------------------------------------------------------------------------

test('P-8：标记字段集合恰好五字段；readMarker 对非法输入容错', () => {
  const marker = createMarker({
    root: 'D:\\obox-webapp\\profiles',
    now: '2026-10-13T00:00:00.000Z'
  })
  assert.deepEqual(Object.keys(marker).sort(), ['createdAt', 'extId', 'marker', 'root', 'version'])
  assert.equal(marker.marker, MARKER_ID)
  assert.equal(marker.extId, EXT_ID)
  assert.equal(marker.createdAt, '2026-10-13T00:00:00.000Z')
  assert.equal(marker.root, 'D:\\obox-webapp\\profiles')
  assert.equal(ROOT_MARKER, '.obox-webapp-root')

  // 往返
  assert.deepEqual(readMarker(JSON.stringify(marker)), marker)
  // 容错：全部返回 null
  for (const bad of [
    null,
    undefined,
    '',
    'not json',
    '[]',
    '123',
    '{"marker":"other"}',
    JSON.stringify({ ...marker, marker: 'nope' }),
    JSON.stringify({ ...marker, root: '' })
  ]) {
    assert.equal(readMarker(bad), null, `${JSON.stringify(bad)} 必须被判为无标记`)
  }
  // 目标根"必须有标记"
  assert.equal(isManagedTargetRoot(JSON.stringify(marker)), true)
  assert.equal(isManagedTargetRoot(null), false)
  assert.equal(isManagedTargetRoot('{}'), false)
})

// ---------------------------------------------------------------------------
// P-9 / P-15：迁移决策与覆盖确认（P1 = B 的闸门）
// ---------------------------------------------------------------------------

test('P-9：decideMigrationItem 的覆盖输入组合（done / overwritten / skipped / missing / move）', () => {
  const both = { exists: true }
  const neither = { exists: false }
  // 源在、目标不在 ⇒ 正常搬
  assert.equal(decideMigrationItem(both, neither, {}).action, 'move')
  // 目标在、源不在 ⇒ 视为已搬完（断电续做的常见形态）
  assert.equal(decideMigrationItem(neither, both, {}).action, 'done')
  // 两侧都不在 ⇒ missing（不阻塞整体）
  assert.equal(decideMigrationItem(neither, neither, {}).action, 'missing')
  // 冲突 + 未确认 ⇒ skipped（reason 必须是"未确认覆盖"）
  const skipped = decideMigrationItem(both, both, { overwrite: true, confirmed: false })
  assert.equal(skipped.action, 'skipped')
  assert.equal(skipped.reason, '未确认覆盖')
  assert.equal(decideMigrationItem(both, both, {}).action, 'skipped')
  assert.equal(decideMigrationItem(both, both, { userDeclined: true }).action, 'skipped')
  // 冲突 + 已确认 ⇒ overwritten
  assert.equal(
    decideMigrationItem(both, both, { overwrite: true, confirmed: true }).action,
    'overwritten'
  )
  // 只有 overwrite 没有 confirmed **不算**确认（助手不得自行决定覆盖）
  assert.equal(decideMigrationItem(both, both, { overwrite: true }).action, 'skipped')
})

test('P-15：conflictsConfirmed / pendingConflicts —— 续做不得继承一个不存在的确认', () => {
  assert.equal(conflictsConfirmed(null, ['A']), false)
  assert.equal(conflictsConfirmed({ confirmedAt: null, names: ['A'] }, ['A']), false)
  assert.equal(conflictsConfirmed({ confirmedAt: 'x', names: [] }, ['A']), false)
  assert.equal(conflictsConfirmed({ confirmedAt: 'x', names: ['A'] }, ['A']), true)
  assert.equal(conflictsConfirmed({ confirmedAt: 'x', names: ['A'] }, ['A', 'B']), false)
  assert.equal(conflictsConfirmed({ confirmedAt: 'x', names: ['A', 'B'] }, ['A']), true)
  // 快照里多出来的名字不影响（用户可能上次确认了更多）
  assert.equal(conflictsConfirmed({ confirmedAt: 'x', names: [] }, []), true)

  const intent = {
    items: [
      { name: 'A', status: 'pending', overwrite: true },
      { name: 'B', status: 'pending', overwrite: false },
      { name: 'C', status: 'overwritten', overwrite: true }
    ],
    conflicts: { confirmedAt: null, names: [] }
  }
  assert.deepEqual(pendingConflicts(intent), ['A'], '只有"待搬 + overwrite"的条目才需要确认')
  assert.deepEqual(
    pendingConflicts({ ...intent, conflicts: { confirmedAt: 'now', names: ['A'] } }),
    [],
    '确认覆盖了快照里的名字 ⇒ 不再阻塞'
  )
})

// ---------------------------------------------------------------------------
// P-10：完整性判据（C1–C5；**先校验后删源**的唯一守卫）
// ---------------------------------------------------------------------------

const VERIFY_BASE = {
  sourceFiles: 100,
  sourceBytes: 1000,
  targetFiles: 100,
  targetBytes: 1000,
  targetIsDirectory: true,
  sourceHasPreferences: true,
  targetHasPreferences: true,
  sourceHasCookies: true,
  targetHasCookies: true
}

test('P-10：95% 边界（files/bytes 恰好 95% 通过，94.99% 失败，100% 通过）', () => {
  assert.equal(MIN_COPY_RATIO, 0.95)
  // 100% 通过
  assert.equal(verifyMigration(VERIFY_BASE).ok, true)
  // 恰好 95% 通过
  assert.equal(verifyMigration({ ...VERIFY_BASE, targetFiles: 95, targetBytes: 950 }).ok, true)
  // 94.99% 失败（files 94；bytes 949）
  const lowFiles = verifyMigration({ ...VERIFY_BASE, targetFiles: 94 })
  assert.equal(lowFiles.ok, false)
  assert.match(lowFiles.reason, /文件数 94\/100/)
  const lowBytes = verifyMigration({ ...VERIFY_BASE, targetBytes: 949 })
  assert.equal(lowBytes.ok, false)
  assert.match(lowBytes.reason, /字节 949\/1000/)
  // 硬门槛 = floor(source × 0.95)：源 10 个文件时目标至少 9 个
  const smallBase = { ...VERIFY_BASE, sourceFiles: 10, sourceBytes: 100 }
  assert.equal(verifyMigration({ ...smallBase, targetFiles: 9, targetBytes: 95 }).ok, true)
  assert.equal(verifyMigration({ ...smallBase, targetFiles: 8, targetBytes: 95 }).ok, false)
  // 源 1 个文件 ⇒ floor(0.95) = 0 ⇒ 文件数门槛为 0（不得因为小样本把正常条目卡死）
  assert.equal(
    verifyMigration({ ...VERIFY_BASE, sourceFiles: 1, targetFiles: 0, targetBytes: 1000 }).ok,
    true
  )
  // 门槛数字必须出现在失败原因里（可审计）
  assert.match(lowFiles.reason, /需 ≥ 95/)
})

test('P-10b：关键文件缺失（C4/C5）⇒ 失败并点名缺了哪个；源本来没有则不要求', () => {
  const noPrefs = verifyMigration({ ...VERIFY_BASE, targetHasPreferences: false })
  assert.equal(noPrefs.ok, false)
  assert.match(noPrefs.reason, /Default\/Preferences/)
  const noCookies = verifyMigration({ ...VERIFY_BASE, targetHasCookies: false })
  assert.equal(noCookies.ok, false)
  assert.match(noCookies.reason, /Default\/Network\/Cookies/)
  const both = verifyMigration({
    ...VERIFY_BASE,
    targetHasPreferences: false,
    targetHasCookies: false
  })
  assert.match(both.reason, /Default\/Preferences/)
  assert.match(both.reason, /Default\/Network\/Cookies/)
  // 源本来就没有这些文件（例如只开过一次的空 profile）⇒ 不因此判失败
  assert.equal(
    verifyMigration({
      ...VERIFY_BASE,
      sourceHasPreferences: false,
      sourceHasCookies: false,
      targetHasPreferences: false,
      targetHasCookies: false
    }).ok,
    true
  )
})

test('P-10c：C1 —— 目标不存在或不是目录 ⇒ 直接失败', () => {
  assert.equal(verifyMigration({ ...VERIFY_BASE, targetIsDirectory: false }).ok, false)
  assert.match(verifyMigration({ ...VERIFY_BASE, targetIsDirectory: false }).reason, /不是目录/)
  assert.equal(verifyMigration({ ...VERIFY_BASE, targetExists: false }).ok, false)
  // 数字缺失/非法一律按 0 计（调用方忘了传 ⇒ 失败而不是"假通过"）
  assert.equal(verifyMigration({}).ok, false)
})

// ---------------------------------------------------------------------------
// P-11 / P-12：状态机推进与进度汇总
// ---------------------------------------------------------------------------

/** 造一个三条目意图 */
function makeIntent() {
  return createRootIntent({
    from: 'C:\\data\\chrome',
    to: 'D:\\obox-webapp\\profiles',
    now: '2026-10-13T10:15:00.000Z',
    items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }]
  })
}

test('P-11：advanceMigrationState —— pending→running→done；failed 时整体不 done', () => {
  let intent = makeIntent()
  assert.equal(intent.phase, 'pending')
  assert.equal(intent.conflicts.confirmedAt, null)
  assert.equal(intent.conflicts.confirmedBy, 'user', '确认只能由用户做出')
  assert.deepEqual(intent.conflicts.names, [])
  assert.equal(intent.schema, ROOT_INTENT_SCHEMA)
  assert.equal(intent.kind, ROOT_INTENT_KIND)
  assert.equal(intent.summary.total, 3)

  // 第一条完成 ⇒ phase 转 running，未完成 ⇒ 不可写设置
  intent = applyItemResult(intent, { name: 'A', status: 'done' }, { now: 'T1' })
  assert.equal(intent.phase, 'running')
  assert.equal(intent.items[0].status, 'done')
  assert.equal(intent.items[0].at, 'T1')
  assert.equal(intent.updatedAt, 'T1')
  assert.deepEqual(advanceMigrationState(intent), {
    phase: 'running',
    writable: false,
    reason: '仍有未搬完的条目'
  })

  // 第二条覆盖完成
  intent = applyItemResult(intent, { name: 'B', status: 'overwritten', overwrite: true })
  assert.equal(intent.summary.overwritten, 1)
  // 第三条失败 ⇒ 不写设置、不删源
  intent = applyItemResult(intent, { name: 'C', status: 'failed', reason: '[migrate-failed] X' })
  assert.equal(hasFailedItems(intent), true)
  assert.equal(hasActiveItems(intent), false)
  const blocked = advanceMigrationState(intent)
  assert.equal(blocked.writable, false)
  assert.match(blocked.reason, /失败项/)
  assert.equal(blocked.phase, 'running', 'failed 存在时整体**不得**进入 done')
  assert.equal(intent.items[2].attempts, 1, 'failed 必须累计 attempts（诊断用）')

  // 重试成功后 ⇒ done + 可写
  intent = applyItemResult(intent, { name: 'C', status: 'done' })
  assert.equal(advanceMigrationState(intent).writable, true)
  assert.equal(advanceMigrationState(intent).phase, 'done')
  assert.equal(isMigrationComplete(intent), true)

  // abandoned 是终态、不可写
  assert.deepEqual(advanceMigrationState({ ...intent, phase: 'abandoned' }), {
    phase: 'abandoned',
    writable: false,
    reason: '已放弃'
  })
})

test('P-11b：applyItemResult 不改入参、可新增缺失条目、终态集合含全部 5 种', () => {
  const intent = makeIntent()
  const before = JSON.stringify(intent)
  const next = applyItemResult(intent, { name: 'A', status: 'done', files: 10, bytes: 20 })
  assert.equal(JSON.stringify(intent), before, 'applyItemResult 必须是纯函数（不改入参）')
  assert.equal(next.items[0].files, 10)
  assert.equal(next.items[0].bytes, 20)
  // 意图里没有的条目会被补进来（例如库在迁移期间新增了条目）
  const added = applyItemResult(next, { name: 'D', status: 'missing' })
  assert.equal(added.items.length, 4)
  assert.equal(added.items[3].status, 'missing')
  // 非法状态被忽略（不得写进意图文件）
  const weird = applyItemResult(added, { name: 'A', status: 'nonsense' })
  assert.equal(weird.items[0].status, 'done')
  // 五项终态与三项中间态是仅有的合法取值
  assert.deepEqual([...ACTIVE_ITEM_STATUSES].sort(), ['copying', 'pending', 'verifying'])
  assert.deepEqual([...MIGRATION_PHASES].sort(), ['abandoned', 'done', 'pending', 'running'])
})

test('P-12：summarize 与 items 逐条一致，overwritten 单独计数', () => {
  let intent = makeIntent()
  intent = applyItemResult(intent, { name: 'A', status: 'done' })
  intent = applyItemResult(intent, { name: 'B', status: 'overwritten', overwrite: true })
  intent = applyItemResult(intent, { name: 'C', status: 'skipped', reason: '未确认覆盖' })
  assert.deepEqual(summarize(intent), {
    total: 3,
    done: 1,
    overwritten: 1,
    skipped: 1,
    failed: 0,
    missing: 0
  })
  assert.equal(intent.summary.overwritten, 1, 'overwritten 必须与 done **分开**计数（可审计）')
  const sum =
    intent.summary.done +
    intent.summary.overwritten +
    intent.summary.skipped +
    intent.summary.failed +
    intent.summary.missing
  assert.equal(sum, intent.summary.total, 'total 必须等于各项之和')
  // `backup` 恒为 null（P1 = B 不备份）
  assert.ok(intent.items.every((item) => item.backup === null))
  assert.equal(normalizeIntentItem({}).backup, null)
})

test('P-12b：isMigratableIntent 只认本需求的意图形状', () => {
  const good = makeIntent()
  assert.equal(isMigratableIntent(good), true)
  assert.equal(isMigratableIntent(null), false)
  assert.equal(isMigratableIntent({}), false)
  assert.equal(isMigratableIntent({ ...good, schema: 2 }), false, 'schema 不匹配 ⇒ 不迁移只报错')
  assert.equal(isMigratableIntent({ ...good, kind: 'other' }), false)
  assert.equal(isMigratableIntent({ ...good, phase: 'weird' }), false)
  assert.equal(isMigratableIntent({ ...good, from: '' }), false)
  assert.equal(isMigratableIntent({ ...good, items: null }), false)
})

// ---------------------------------------------------------------------------
// 生效根（§9.1 最容易写错的数据安全点）
// ---------------------------------------------------------------------------

test('生效根：迁移未完成时**恒为 from**（哪怕设置值已经是新根）', () => {
  const defaultRoot = 'C:\\data\\chrome'
  const intent = createRootIntent({
    from: defaultRoot,
    to: 'D:\\obox-webapp\\profiles',
    items: [{ name: 'A' }]
  })
  // 宿主已经把设置值写成了新根，但意图还在 running ⇒ 生效根必须是**旧根**
  const running = resolveEffectiveRoot({
    configured: 'D:\\obox-webapp\\profiles',
    defaultRoot,
    intent
  })
  assert.equal(running.root, defaultRoot)
  assert.equal(running.isDefault, true)
  assert.equal(running.source, 'migration-from')

  // 意图进入 done ⇒ 设置值生效（此时它一定等于 to）
  const done = resolveEffectiveRoot({
    configured: 'D:\\obox-webapp\\profiles',
    defaultRoot,
    intent: { ...intent, phase: 'done' }
  })
  assert.equal(done.root, 'D:\\obox-webapp\\profiles')
  assert.equal(done.isDefault, false)
  assert.equal(done.source, 'configured')
})

test('生效根：空配置 ⇒ 默认根；非法配置 ⇒ 用上一次成功的根（回落而非崩溃）', () => {
  const defaultRoot = 'C:\\data\\chrome'
  assert.deepEqual(resolveEffectiveRoot({ configured: '', defaultRoot }), {
    root: defaultRoot,
    isDefault: true,
    source: 'default'
  })
  const invalid = resolveEffectiveRoot({
    configured: 'chrome',
    defaultRoot,
    fallbackRoot: 'E:\\previous\\profiles'
  })
  assert.equal(invalid.root, 'E:\\previous\\profiles')
  assert.equal(invalid.source, 'fallback')
  // 没有任何"上一次成功的值"（进程刚启动）⇒ 回落默认根
  const cold = resolveEffectiveRoot({ configured: 'C:\\', defaultRoot })
  assert.equal(cold.root, defaultRoot)
  assert.equal(cold.source, 'default')
})

test('samePath：大小写与尾部分隔符不敏感（Windows 上同一目录的不同写法）', () => {
  assert.equal(samePath('D:\\a\\b', 'd:/a/b/'), true)
  assert.equal(samePath('D:\\a\\b', 'D:\\a\\c'), false)
  assert.equal(samePath('', ''), true)
  assert.equal(canonicalRoot('D:\\a\\b\\'), 'D:\\a\\b')
  assert.equal(canonicalRoot('D:\\a\\b/'), 'D:\\a\\b')
})

// ---------------------------------------------------------------------------
// P-13：路径预算（复用既有函数）
// ---------------------------------------------------------------------------

test('P-13：生效根很长时，名称预算按根长计算（超预算的名称被拒）', async () => {
  const { assertNameLength, truncateToBudget } = await import('../lib/nameSanitize.mjs')
  const shortRoot = DEFAULT_ROOT_DIRNAME // 'chrome'
  const longName = '内网-运维平台'
  assert.equal(assertNameLength('内网', { profileRoot: shortRoot }).ok, true, '短根下短名必须通过')
  assert.equal(assertNameLength(longName, { profileRoot: shortRoot }).ok, true)
  // 直接按"预算 = root.length + 1 + name.length ≤ 240"构造一个必然超预算的根
  const longRoot = `D:\\${'x'.repeat(240)}`
  assert.ok(
    assertNameLength(longName, { profileRoot: longRoot }).ok === false,
    '长根必须压缩名称预算'
  )
  assert.ok(truncateToBudget(longName, { profileRoot: longRoot }).length < longName.length)
  // 边界：预算 = `root.length + 1(分隔符) + name.length + 1(补一个字符)` ≤ 240
  const edgeRoot = `D:\\${'y'.repeat(236)}` // 239 字符
  assert.equal(assertNameLength('', { profileRoot: edgeRoot }).ok, true, '240 字符整好通过')
  assert.equal(assertNameLength('内', { profileRoot: edgeRoot }).ok, false, '241 字符必须被拒')
})

// ---------------------------------------------------------------------------
// P-14 / P-16：反向门禁
// ---------------------------------------------------------------------------

test('P-14：lib/ 下不得出现第二份根解析实现（防分叉）', () => {
  const libDir = new URL('../lib/', import.meta.url)
  const names = readdirSync(libDir)
    .filter((name) => name.endsWith('.mjs'))
    .sort()
  assert.deepEqual(
    names,
    [
      'chromeArgs.mjs',
      'chromeLaunch.mjs',
      'entryFields.mjs',
      'nameSanitize.mjs',
      'profileLimit.mjs',
      'profileRoot.mjs',
      'webapp.mjs'
    ],
    `lib/ 的模块集合变了（根解析必须只有 profileRoot.mjs 一份）：${names.join('、')}`
  )
  // 只有 `profileRoot.mjs` 允许出现"绝对路径校验"的实现
  for (const name of names) {
    if (name === 'profileRoot.mjs') continue
    const text = readFileSync(new URL(name, libDir), 'utf8')
    assert.ok(
      !/isDriveRoot|isUncRoot|normalizeRoot|checkCandidateRoot|resolveEffectiveRoot/.test(text),
      `${name} 里出现了第二份根解析实现`
    )
  }
})

test('P-14b：profileRoot.mjs **不得** import 任何 node: 内建（它同时被打进浏览器 bundle）', () => {
  // 为什么这条是硬门禁：界面的导入链是 `src/fields.js → lib/webapp.mjs → lib/chromeArgs.mjs → 本模块`，
  // 一旦出现 `node:path`，Vite 会把它外部化成 `__vite-browser-external` 并让 `npm run build` **直接失败**
  // （本模块曾因 `import { isAbsolute } from 'node:path'` 踩过一次；修复方式是把 `node:path` 换成
  // 本模块自带的纯字符串路径工具）。
  const text = readFileSync(new URL('../lib/profileRoot.mjs', import.meta.url), 'utf8')
  const imports = [...text.matchAll(/^\s*import\s+[^'"]*['"]([^'"]+)['"]/gm)].map((m) => m[1])
  assert.deepEqual(imports, [], `profileRoot.mjs 不得有任何 import，实际：${imports.join('、')}`)
  assert.ok(!/from\s+['"]node:/.test(text), '不得出现 `from "node:…"`')
  assert.ok(!/require\(['"]node:/.test(text), '不得出现 `require("node:…")`')
})

test('P-14c：lib/*.mjs 的**代码**里不得引用 `process`（渲染进程没有这个全局）', () => {
  // 为什么是硬门禁：`lib/**` 同时被 Node 侧（`helper.cjs`）与渲染进程（`index.js`）加载，而渲染进程没有
  // `process`。默认参数（`platform = process.platform`）与 `?? process.platform` **只在没传值时才求值**，
  // 所以任何漏传的调用路径都会在渲染进程抛 `process is not defined`——这正是 v1.0.4 的线上报错
  // （`normalizeRoot('')` 每次激活都会走到）。修法是统一用模块内的 `runtimePlatform()` / `runtimeExecPath()`。
  // 注释里提到 `process` 是允许的（本模块顶部就在解释这个坑），所以只看**代码行**。
  const libDir = new URL('../lib/', import.meta.url)
  const offenders = []
  for (const name of readdirSync(libDir)) {
    if (!name.endsWith('.mjs')) continue
    const lines = readFileSync(new URL(name, libDir), 'utf8').split(/\r?\n/)
    lines.forEach((line, idx) => {
      if (/^\s*(\*|\/\/)/.test(line)) return // 整行注释
      const code = line.replace(/\/\/.*$/, '') // 行尾注释
      if (/\bprocess\s*\./.test(code)) offenders.push(`${name}:${idx + 1}`)
    })
  }
  assert.deepEqual(
    offenders,
    [],
    `lib/*.mjs 的代码里不得引用 process（改用 runtimePlatform()/runtimeExecPath()）：${offenders.join('、')}`
  )
})

test('P-16：不得存在任何"覆盖前先留一份"的备份路径（P1 = B 不做备份）', () => {
  const libDir = new URL('../lib/', import.meta.url)
  const danger = [/backup/i, /\.bak\b/i, /\.old\b/i, /copyToTemp/i]
  for (const name of readdirSync(libDir)) {
    if (!name.endsWith('.mjs')) continue
    const text = readFileSync(new URL(name, libDir), 'utf8')
    // 去掉注释与字符串里的字样（`backup: null` 这种**声明式**字段是允许的：
    // 它正是"不备份"的表达，门禁要防的是"真的留一份"的实现）
    const code = text
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .replace(/backup:\s*null/g, '')
    for (const pattern of danger) {
      assert.ok(
        !pattern.test(code),
        `${name} 里出现了备份路径（${pattern}）：P1 = B 明确不备份，覆盖不可逆`
      )
    }
  }
})

// ---------------------------------------------------------------------------
// 展示辅助（§15.2 第 5 条的修订）
// ---------------------------------------------------------------------------

test('formatCardDataDir：默认根用相对形态；自定义根用绝对形态且过长时中间省略', () => {
  assert.equal(formatCardDataDir({ isDefault: true, profileName: '内网' }), 'chrome/内网')
  assert.equal(formatCardDataDir({ profileName: '内网' }), 'chrome/内网')
  assert.equal(
    formatCardDataDir({ isDefault: false, root: 'D:\\obox-webapp\\profiles', profileName: '内网' }),
    'D:\\obox-webapp\\profiles\\内网'
  )
  const longRoot = `D:\\${'非常长的目录层级\\'.repeat(6)}profiles`
  assert.ok(longRoot.length > 48, `测试用的根必须超过 48 字符，实际 ${longRoot.length}`)
  const long = formatCardDataDir({
    isDefault: false,
    root: longRoot,
    profileName: '内网'
  })
  assert.ok(long.startsWith('D:\\'), '必须保留盘符')
  assert.ok(long.endsWith('profiles\\内网'), '必须保留最后两级与条目名')
  assert.ok(long.includes('…'), '中间省略必须有省略号')
  assert.ok(long.length <= 48 + 6, `省略后长度应接近上限，实际 ${long.length} 字：${long}`)
  // 短的根**不动**（不得给用户看省略号）
  assert.equal(
    formatCardDataDir({ isDefault: false, root: 'D:\\a\\b', profileName: '内网' }),
    'D:\\a\\b\\内网'
  )
  // 短根不动
  assert.equal(abbreviateRoot('D:\\a\\b', 48), 'D:\\a\\b')
  // UNC 保留 server\share
  const unc = abbreviateRoot(`\\\\server\\share\\${'子目录\\'.repeat(10)}profiles`, 48)
  assert.ok(unc.startsWith('\\\\server\\share\\'), `UNC 前缀必须保留：${unc}`)
})

test('progressText：X/Y = (done+overwritten)/total，覆盖单独报；volumeOf 取盘符', () => {
  assert.equal(progressText({ total: 5, done: 3 }), '已搬 3/5')
  assert.equal(progressText({ total: 5, done: 3, overwritten: 1 }), '已搬 4/5，覆盖 1')
  assert.equal(
    progressText({ total: 5, done: 1, overwritten: 1, skipped: 1, failed: 1, missing: 1 }),
    '已搬 2/5，覆盖 1，跳过 1，失败 1，缺失 1'
  )
  assert.equal(volumeOf('C:\\a\\b'), 'C:\\')
  assert.equal(volumeOf('D:\\x'), 'D:\\')
})

test('ROOT_INTENT 常量与文件名（界面/README 与实现同源）', () => {
  assert.equal(ROOT_INTENT, '.pending-move-root.json')
  assert.ok(ROOT_INTENT.startsWith('.'), '意图文件是**点文件**（U-5 已核实 api.fs 可写）')
  assert.equal(EXT_ID, 'webapp_chenzhi')
  assert.equal(DEFAULT_ROOT_DIRNAME, 'chrome')
})
