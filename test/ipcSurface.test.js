/**
 * 接线层门禁（**防复发**）：`src/**` 调用的每个扩展方法都必须被 `index.js` 真正分发。
 *
 * 为什么需要它：曾经出现过"界面已经接线、入口还是骨架"的状态——
 * 点「新建」得到 `未知方法: save`、点「打开」得到 `未知方法: open`，
 * 而所有单测都是绿的（因为它们各自只测自己那一半）。这类问题不能靠人工发现。
 *
 * 两条方向都断言：
 * 1. **正向**：`src/**` 里 `callExtension('x', …)` 用到的每个 `x`，`index.js` 必须有 `case 'x'`；
 * 2. **反向**：`index.js` 分发的每个方法，都应能在 `src/**` 里找到调用点（否则是死代码，
 *    或者是"实现了但没接上"）。
 *
 * ⚠️ 除 `api.app.onMessage` 的**扩展内方法**外，`src/**` 还会调 `api.ipc` 吗？不会——
 * 子窗口页面里没有 `api` 对象，一切走 `bridge.js` 的 `callExtension`。因此这一层只需对齐
 * "`callExtension` 的方法名" ↔ "`onMessage` 的分发表"。
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { test } from 'node:test'

const SRC_DIR = new URL('../src/', import.meta.url)
const INDEX_URL = new URL('../index.js', import.meta.url)

/** 递归收集 `src/**` 下的源码文件 */
function collectSources(dir = SRC_DIR, prefix = '') {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    if (entry.isDirectory()) {
      found.push(...collectSources(new URL(`${entry.name}/`, dir), `${prefix}${entry.name}/`))
      continue
    }
    if (/\.(js|vue)$/.test(entry.name))
      found.push({ name: `${prefix}${entry.name}`, url: new URL(entry.name, dir) })
  }
  return found
}

/** `src/**` 里 `callExtension('method', …)` 用到的方法名 */
function calledMethods() {
  const methods = new Set()
  for (const file of collectSources()) {
    const text = readFileSync(file.url, 'utf8')
    for (const match of text.matchAll(/callExtension\(\s*'([a-zA-Z][\w]*)'/g)) {
      methods.add(match[1])
    }
  }
  return [...methods].sort()
}

/** `index.js` 的 `onMessage` 分发表里的方法名 */
function dispatchedMethods() {
  const text = readFileSync(INDEX_URL, 'utf8')
  const switchBlock = text.slice(text.indexOf('switch (method)'), text.indexOf('default:'))
  const methods = [...switchBlock.matchAll(/case\s+'([a-zA-Z][\w]*)'/g)].map((m) => m[1])
  return [...new Set(methods)].sort()
}

/**
 * **保留但当前没有界面调用点**的通道方法（1.0.4 起）。
 *
 * 为什么需要这个白名单：1.0.4 的用户决策是"扩展页面**不再显示任何迁移信息**"
 * （`docs/spec/amendments/09-chrome-orphan-launch.md`），于是"浏览…"（`browseRootDir`）与
 * "开始迁移"（`startRootMigration`）失去了唯一的界面入口。但**状态机与安全护栏必须原样保留**
 * （意图文件 / `effectiveRoot` 恒为旧根 / 完整性判据 / 冲突覆盖策略 / 设置值最后写入），
 * 且"状态放哪"的最终产品决定尚未关闭——因此这两个方法**留在分发表里**，只把它们从
 * "必须有界面调用点"这条断言里豁免，并**单独断言它们确实没有调用点**（有的话必须从本表移除）。
 *
 * ⚠️ 这是**有意的、被记录的**豁免，不是"顺手放宽"：除这两个方法外，反向门禁逐条照旧。
 */
const NO_UI_CALLER = new Set(['browseRootDir', 'startRootMigration'])

test('正向：src 调用的每个方法，index.js 都必须分发（否则界面会拿到"未知方法"）', () => {
  const called = calledMethods()
  const dispatched = dispatchedMethods()
  assert.ok(called.length >= 6, `src 里至少应调用 6 个方法，实际识别到 ${called.length}：${called}`)
  const missing = called.filter((method) => !dispatched.includes(method))
  assert.deepEqual(missing, [], `index.js 未分发这些被界面调用的方法：${missing.join('、')}`)
})

test('反向：index.js 分发的每个方法，src 里都应有调用点（只有 NO_UI_CALLER 例外）', () => {
  const called = calledMethods()
  const dispatched = dispatchedMethods()
  const dead = dispatched.filter((method) => !called.includes(method) && !NO_UI_CALLER.has(method))
  assert.deepEqual(dead, [], `这些方法被实现但没有界面调用点：${dead.join('、')}`)
  // 豁免表本身也要对账：方法一旦重新有调用点，必须从表里删掉（否则豁免会悄悄扩大）
  const stray = [...NO_UI_CALLER].filter((method) => called.includes(method))
  assert.deepEqual(
    stray,
    [],
    `这些方法已经有界面调用点了，请从 NO_UI_CALLER 移除：${stray.join('、')}`
  )
})

test('1.0.4：扩展页面不再调用迁移相关方法（界面不显示迁移信息），但状态机仍在入口里', () => {
  const called = calledMethods()
  for (const method of ['startRootMigration', 'browseRootDir']) {
    assert.ok(!called.includes(method), `src 里不得再调用 ${method}（迁移信息不上界面）`)
  }
  // 静默续做仍然在（启动时推一下），因此这两个方法必须有调用点
  for (const method of ['rootStatus', 'resolveRootMigration']) {
    assert.ok(called.includes(method), `${method} 必须仍有调用点（静默续做的唯一通道）`)
  }
  const text = readFileSync(INDEX_URL, 'utf8')
  for (const guard of [
    'prepareRoot',
    'conflictsConfirmed',
    'pendingConflicts',
    'advanceMigrationState',
    'migrateRootDir',
    'ROOT_INTENT_REL'
  ]) {
    assert.match(text, new RegExp(guard), `${guard} 是迁移安全护栏，禁止随界面一起删掉`)
  }
})

test('方法集合与规格一致（v1.0.3 起恰好 12 个：8 个既有 + 4 个 profile 根相关，不多不少）', () => {
  assert.deepEqual(dispatchedMethods(), [
    'browseRootDir',
    'cleanCaches',
    'list',
    'open',
    'probe',
    'profileInfo',
    'profileSize',
    'remove',
    'resolveRootMigration',
    'rootStatus',
    'save',
    'startRootMigration'
  ])
})

test('R-17/R-25：四个新方法都有真实实现（不是只挂在分发表上）', () => {
  const text = readFileSync(INDEX_URL, 'utf8')
  // `rootStatus`：读设置 + 读根状态 + 回生效根
  assert.match(text, /profileRootStatus/, 'rootStatus 必须调助手的 profileRootStatus')
  assert.match(text, /effectiveRoot/, 'rootStatus 必须回生效根（迁移未完成时 = 旧根）')
  assert.match(text, /SETTING_KEYS\.profileRoot|'webapp\.profileRoot'/, '必须读第三个设置键')
  // `startRootMigration`：建根写标记 + 冲突预检 + **自动覆盖**（1.0.4 用户决策，amendment 09 §2）
  assert.match(text, /prepareRoot/, '迁移前必须 prepareRoot（目标根必须有标记）')
  assert.match(
    text,
    /auto-overwrite/,
    '冲突必须按已接受的策略自动确认覆盖（confirmedBy: auto-overwrite），不再等界面确认'
  )
  assert.match(text, /自动覆盖（不可恢复）/, '逐条覆盖必须留日志（不可恢复）')
  assert.match(text, /confirmOverwrite/, '必须支持"调用方已声明确认覆盖"的入参（调用面不变）')
  // `resolveRootMigration`：三个动作
  for (const action of ["'continue'", "'abandon'", "'confirm-overwrite'"]) {
    assert.ok(text.includes(action), `resolveRootMigration 必须支持 ${action}`)
  }
  // `browseRootDir`：目录能力 + 降级（老宿主不得报错）
  assert.match(text, /properties: \['openDirectory'\]/, '必须请求目录选择')
  assert.match(text, /checkRootCandidate/, '候选路径的判定必须落到助手侧')
  assert.match(text, /supported/, '必须回 supported 供界面决定降级形态')
})

test('数据安全：改根设置（profileRoot）只在明确的三处 + 默认根回填处写入', () => {
  // ⚠️ 必须**去掉注释**再数：`reconcileIntent` 的 JSDoc 里就写着这个调用点（举例），
  // 按原文计数会把它也数进去。
  const text = readFileSync(INDEX_URL, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
  // 1.0.4 起 `api.settings.set` 还写**只读状态项** `migrationStatus`，因此判据必须**按 key** 数：
  // 写 `profileRoot` = 迁移完成 / 放弃回写 / 无存量条目 / 默认根回填（4 处）；
  // 写 `migrationStatus` = 只有 `writeMigrationStatus` 一处（展示用，绝不参与改根判定）。
  const rootWrites = [...text.matchAll(/api\.settings\.set\(\s*SETTING_KEYS\.profileRoot/g)]
  assert.equal(
    rootWrites.length,
    5,
    `写 profileRoot 必须恰好 5 处（完成 / 放弃回写 / 无存量条目 / 默认根回填 / 迁移中改根的回写），实际 ${rootWrites.length}`
  )
  const statusWrites = [...text.matchAll(/api\.settings\.set\(\s*SETTING_KEYS\.migrationStatus/g)]
  assert.equal(statusWrites.length, 1, '状态文本必须只有一个写入点（writeMigrationStatus）')
  // 迁移完成那次必须在 advanceMigrationState 判定之后
  const completeAt = text.indexOf('advanceMigrationState(current)')
  const setAfter = text.indexOf(
    'api.settings.set(SETTING_KEYS.profileRoot, current.to)',
    completeAt
  )
  assert.ok(completeAt > 0 && setAfter > completeAt, '写设置必须发生在"全部完成"判定之后')
  // 改根判定**只读 profileRoot**：`readSettings` 里不得出现 migrationStatus
  const readSettingsFn = text.slice(
    text.indexOf('function readSettings('),
    text.indexOf('async function', text.indexOf('function readSettings('))
  )
  assert.ok(readSettingsFn.includes('normalizeRoot'), '必须能定位到 readSettings 的实现')
  assert.ok(
    !readSettingsFn.includes('migrationStatus'),
    'readSettings 不得读 migrationStatus（写状态绝不能影响改根判定）'
  )
})

test('数据安全：意图文件写在扩展 data 目录（api.fs），**不得**写进根里', () => {
  const text = readFileSync(INDEX_URL, 'utf8')
  // 意图文件名由 `lib/profileRoot.mjs` 的 `ROOT_INTENT` 常量提供（单一来源），
  // `index.js` 里是 `ROOT_INTENT_REL`（同一来源的别名）
  assert.match(
    text,
    /ROOT_INTENT_REL|\.pending-move-root\.json/,
    '必须出现意图文件名（或它的常量）'
  )
  assert.match(
    text,
    /api\.fs\.(readFile|writeFile|remove)/,
    '意图文件必须经 api.fs（data 目录内）读写'
  )
  assert.ok(
    !/join\([^)]*root[^)]*(ROOT_INTENT|pending-move-root)/i.test(text),
    '不得把意图文件拼到 profile 根里（根会移动 ⇒ 中立性丢失）'
  )
})

test('顺序与互斥：迁移未完成时禁止改名与再次改根', () => {
  const text = readFileSync(INDEX_URL, 'utf8')
  assert.match(text, /migrationBlocksRename/, '改名必须检查迁移互斥')
  assert.match(text, /浏览器数据正在迁移，请先完成或放弃迁移后再改名/, '改名被拒的文案必须存在')
  assert.match(
    text,
    /已有一次未完成的浏览器数据迁移，请先完成或放弃后再改根/,
    '再次改根被拒的文案必须存在'
  )
})

test('卸载语义（P4）：uninstall 钩子不触碰外部根，并把两句话写清楚', () => {
  const text = readFileSync(INDEX_URL, 'utf8')
  const start = text.indexOf('export async function uninstall')
  assert.ok(start > 0, '必须有 uninstall 钩子')
  const body = text.slice(start)
  assert.match(body, /卸载扩展时不会删除它/, '必须写明外部根不会被卸载删除')
  assert.match(body, /需你自行清理/, '必须写明外部根需用户自行清理')
  assert.match(body, /ROOT_INTENT_REL/, '卸载时允许删掉迁移意图文件（避免重装后误判）')
  assert.ok(
    !/\.(rm|rmdir|rename|unlink|copyFile)\(/.test(body),
    'uninstall 里不得出现任何搬移/删除数据的调用（只允许删意图文件与记日志）'
  )
})

test('R17：index.js 真的读了两个设置键，并真的产出 [profile-over-limit]', () => {
  const text = readFileSync(INDEX_URL, 'utf8')
  assert.match(text, /SETTING_KEYS\.profileLimitMb|'webapp\.profileLimitMb'/, '必须读单站点上限')
  assert.match(text, /SETTING_KEYS\.diskCacheMb|'webapp\.diskCacheMb'/, '必须读磁盘缓存档位')
  assert.match(text, /api\.settings/, '必须经 api.settings 读取设置')
  assert.match(text, /OVER_LIMIT/, '必须产出 [profile-over-limit] 前缀')
  assert.match(text, /profile-size-failed/, '量体积失败必须降级放行并留痕')
  assert.match(text, /checkProfileLimit/, '超限判定必须复用 lib 的纯函数')
})

test('sqlite：建表 + 大小写不敏感唯一索引都在（库层兜底）', () => {
  const text = readFileSync(INDEX_URL, 'utf8')
  assert.match(text, /CREATE TABLE IF NOT EXISTS webapp/, '必须建表')
  assert.match(
    text,
    /CREATE UNIQUE INDEX IF NOT EXISTS webapp_name_nocase ON webapp \(name COLLATE NOCASE\)/,
    '必须建大小写不敏感的唯一索引'
  )
})

test('改名/删除分别衔接 moveProfile / removeProfile，且占用文案归一（不硬编码文件名）', () => {
  const text = readFileSync(INDEX_URL, 'utf8')
  assert.match(text, /callHelper\('moveProfile'/, '改名必须走 moveProfile')
  assert.match(text, /callHelper\('removeProfile'/, '删除必须走 removeProfile')
  assert.match(text, /\[profile-busy\]/, '占用错误必须按 [profile-busy] 归一')
  assert.ok(!text.includes('journal.baj'), '占用文案不得硬编码具体文件名（真实错误由助手给出）')
})

test('每个 helper 方法名都在 index.js 里有调用点（助手能力不被漏接）', () => {
  const helperText = readFileSync(new URL('../helper.cjs', import.meta.url), 'utf8')
  const table = helperText.slice(
    helperText.indexOf('const METHODS = {'),
    helperText.indexOf('}', helperText.indexOf('const METHODS = {'))
  )
  const helperMethods = [...table.matchAll(/^\s{2}([a-zA-Z]\w*),?$/gm)].map((m) => m[1])
  const indexText = readFileSync(INDEX_URL, 'utf8')
  const missing = helperMethods.filter((method) => !indexText.includes(`'${method}'`))
  assert.deepEqual(missing, [], `index.js 从未调用这些助手方法：${missing.join('、')}`)
})
