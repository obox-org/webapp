/**
 * `index.js` 的迁移编排层门禁（规格 §14.3 的 I-1..I-9）。
 *
 * 手法与 `test/ipcSurface.test.js` / `test/componentSource.test.js` 一致：**读源码断言接线**。
 * 为什么不给 `index.js` 引入宿主 mock：既有仓库对入口一律读源码（`ipcSurface.test.js:1-16`
 * 记录了原因），引 mock 会让门禁风格分裂（规格 §14.5 的裁定）。
 *
 * ⚠️ 这是**数据安全**的门禁：这里断言的每一条（改根唯一写点、覆盖必须走显式确认记录 + 逐条留痕、
 * 无备份、意图文件位置）都对应一个"错了就永久丢数据"的实现细节。纯逻辑由 `test/profileRoot.test.js`
 * 覆盖，进程行为由 `test/helper.test.js` 覆盖，本文件补的是"入口真的把它们接上了"。
 *
 * ⚠️ **1.0.4 的政策变化（用户决策，amendment 09 §2）**：冲突不再等界面确认，改为**自动覆盖**
 * （先删目标同名目录再搬源、不可恢复）。I-6 因此从"未确认 ⇒ 不动手"改写为
 * "自动覆盖，但必须留下显式确认记录与逐条日志"——**结构的闸门没拆，只是确认来源变了**。
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  advanceMigrationState,
  applyItemResult,
  conflictsConfirmed,
  createRootIntent,
  decideMigrationItem,
  pendingConflicts,
  progressText,
  resolveEffectiveRoot,
  summarize
} from '../lib/profileRoot.mjs'

const INDEX = readFileSync(new URL('../index.js', import.meta.url), 'utf8')
/** 去掉块注释与行注释：避免注释里的示例把断言喂成假绿 */
function code(text) {
  return text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
}
const INDEX_CODE = code(INDEX)

test('I-1：设置读取真的读第三个键，且归一失败不抛错', () => {
  assert.match(INDEX_CODE, /SETTING_KEYS\.profileRoot|'webapp\.profileRoot'/, '必须读 profileRoot')
  assert.match(INDEX_CODE, /api\.settings\?\.get|api\.settings\.get/, '必须经 api.settings 读取')
  assert.match(INDEX_CODE, /normalizeRoot/, '必须用 lib 的纯函数归一（不得自己写一份）')
  assert.match(INDEX_CODE, /rootVerdict\.kind === 'invalid'/, '归一失败必须走"回落"分支')
  // 归一失败只 warn，绝不 throw（否则改错一个字符就打不开设置/列表）
  const settingsFn = INDEX_CODE.slice(
    INDEX_CODE.indexOf('function readSettings('),
    INDEX_CODE.indexOf('// ---- profile 根')
  )
  assert.ok(!/throw /.test(settingsFn), 'readSettings 不得抛错')
  assert.match(settingsFn, /console\.warn/, '归一失败必须留痕')
})

test('I-2：迁移编排存在，且意图文件名与"唯一写点"都对', () => {
  for (const method of [
    'rootStatus',
    'startRootMigration',
    'resolveRootMigration',
    'browseRootDir'
  ]) {
    assert.ok(INDEX_CODE.includes(`case '${method}'`), `分发表缺 ${method}`)
    assert.ok(INDEX_CODE.includes(`async function ${method}(`), `缺 ${method} 的实现`)
  }
  assert.match(INDEX_CODE, /ROOT_INTENT_REL/, '意图文件名必须是常量（单一来源）')
  assert.match(INDEX_CODE, /ROOT_INTENT\b/, '常量必须来自 lib/profileRoot.mjs 的 ROOT_INTENT')
  // **改根的唯一写点**：写 `profileRoot` 恰好 3 处（迁移完成 / 放弃回写 / 无存量条目）。
  // ⚠️ 1.0.4 起 `api.settings.set` 还有**另一类**调用——写只读的 `migrationStatus`
  // （迁移过程状态）与默认根回填（`profileRoot`，但语义是"把默认根写成绝对路径"）。
  // 因此判据必须**按 key** 数，而不是按 `api.settings.set` 的出现次数：
  const rootWrites = [...INDEX_CODE.matchAll(/api\.settings\.set\(\s*SETTING_KEYS\.profileRoot/g)]
  assert.equal(
    rootWrites.length,
    5,
    `写 profileRoot 必须恰好 5 处（完成 / 放弃回写 / 无存量条目 / 默认根回填 / 迁移中改根的回写），实际 ${rootWrites.length}`
  )
  const completeAt = INDEX_CODE.indexOf('advanceMigrationState(current)')
  const setAfter = INDEX_CODE.indexOf(
    'api.settings.set(SETTING_KEYS.profileRoot, current.to)',
    completeAt
  )
  assert.ok(
    completeAt > 0 && setAfter > completeAt,
    '写设置必须排在"全部完成"判定（advanceMigrationState）之后'
  )
  // 有 failed 时不得写设置：`state.writable` 为假就直接 return
  assert.match(INDEX_CODE, /if \(!state\.writable\)/, '不可写时必须提前返回（不写设置）')
  // 状态项写入必须**只**写 migrationStatus 键，且经纯函数的文本（见 test/migrationStatus.test.js）
  const statusWrites = [
    ...INDEX_CODE.matchAll(/api\.settings\.set\(\s*SETTING_KEYS\.migrationStatus/g)
  ]
  assert.equal(statusWrites.length, 1, 'status 文本必须只有一个写入点（writeMigrationStatus）')
})

test('I-3：顺序与互斥 —— 先根迁移后改名；迁移中禁止改名与再次改根', () => {
  // `list` 里先做根迁移对账，之后才轮到既有的改名 intent 对账（改名 intent 在 helper 侧读）
  const listFn = INDEX_CODE.slice(INDEX_CODE.indexOf('async function list('))
  assert.match(listFn, /reconcileNow/, 'list 必须触发一次根迁移对账')
  const reconcileAt = listFn.indexOf('reconcileNow')
  const getRowsAt = listFn.indexOf('db.get_all()')
  assert.ok(reconcileAt < getRowsAt, '对账必须发生在读取条目之前（懒执行一次）')
  assert.match(listFn, /rootIntentChecked/, '只能对账一次（不做轮询/定时器）')
  // 互斥
  assert.match(INDEX_CODE, /migrationBlocksRename\(\)/, '改名必须查迁移互斥')
  assert.match(INDEX_CODE, /浏览器数据正在迁移，请先完成或放弃迁移后再改名/)
  assert.match(INDEX_CODE, /已有一次未完成的浏览器数据迁移，请先完成或放弃后再改根/)
  // 迁移中**允许**打开/删除/清理（只有改名与再次改根被拒）：open/remove/cleanCaches 不得查互斥
  for (const fnName of [
    'async function open(',
    'async function remove(',
    'async function cleanCaches('
  ]) {
    const body = INDEX_CODE.slice(INDEX_CODE.indexOf(fnName))
    const slice = body.slice(0, body.indexOf('\n  }'))
    assert.ok(
      !slice.includes('migrationBlocksRename'),
      `${fnName} 不得因迁移被拒（规格 §9.4 互斥表）`
    )
  }
})

test('I-4：意图文件经 api.fs 写在 data 目录（**不得**写进根里）', () => {
  assert.match(INDEX_CODE, /api\.fs\.readFile\(intentPath\(\)\)/, '读意图必须经 api.fs')
  assert.match(INDEX_CODE, /api\.fs\.writeFile\(/, '写意图必须经 api.fs')
  assert.match(INDEX_CODE, /api\.fs\.remove\(/, '清意图必须经 api.fs')
  assert.match(INDEX_CODE, /function intentPath\(\)/, '意图路径必须集中成一个函数（唯一来源）')
  // 不得把意图文件拼到 profile 根下
  assert.ok(
    !/join\([^)]*intent[^)]*root/i.test(INDEX_CODE),
    '不得把意图文件拼到 profile 根里（根会移动 ⇒ 中立性丢失）'
  )
  // 写入用"临时文件 + 正式文件"两步（api.fs 没有 rename），且读侧对不完整 JSON 容错
  assert.match(INDEX_CODE, /intentPath\(\)\}\.tmp/, '必须写 .tmp 过渡文件')
  assert.match(INDEX_CODE, /catch \{\s*return null\s*\}/, '读意图必须容错（不完整 JSON ⇒ null）')
})

test('I-6（1.0.4 修订）：冲突**自动覆盖**，但"覆盖"仍必须走显式确认记录 + 逐条留痕', () => {
  // ⚠️ **语义变化（用户决策，amendment 09 §2）**：界面不再有覆盖确认框，冲突改为
  // **按用户已接受的策略自动覆盖**（先删目标同名目录再搬源、不可恢复）。
  // 因此本用例从"未确认 ⇒ 不动手"改成断言下面四条**新的**数据安全要求：
  //   ① 冲突仍必须**逐条预检**（`action: 'probe'`，只读，任何删除之前）；
  //   ② "确认"仍必须**显式落进意图**（`confirmedAt` + `confirmedBy: 'auto-overwrite'` + 逐条 `names`），
  //      不允许出现"没有确认记录也直接 overwrite"的写法；
  //   ③ 每一处 `overwrite: true` 都必须挂在**名字清单**上（声明的或自动确认的），不得无条件置位；
  //   ④ 覆盖必须**逐条留痕**（日志里写明"自动覆盖（不可恢复）"）。
  const startFn = INDEX_CODE.slice(
    INDEX_CODE.indexOf('async function startRootMigration('),
    INDEX_CODE.indexOf('async function resolveRootMigration(')
  )
  assert.match(INDEX_CODE, /async function probeItem\(/, '必须有逐条探测函数')
  assert.match(INDEX_CODE, /action: 'probe'/, '探测必须用 action=probe（只读）')
  assert.match(startFn, /await probeItem\(intent, item\.name\)/, 'startRootMigration 必须逐条预检')
  assert.match(startFn, /conflicts\.push/, '必须收集冲突清单')
  // ② 自动确认也必须是"显式记录"，且必须能看出确认来源是自动策略而非用户
  assert.match(startFn, /confirmedAt: now/, '确认必须记录时刻')
  assert.match(
    startFn,
    /'auto-overwrite'/,
    '自动覆盖必须留下 confirmedBy: auto-overwrite 的来源标记'
  )
  assert.match(
    INDEX_CODE,
    /async function autoConfirmOverwrite\(/,
    '续做路径必须有自动确认覆盖的落点（否则收尾判定会把冲突当"未确认"）'
  )
  assert.match(INDEX_CODE, /confirmedBy: 'auto-overwrite'/, '自动确认必须写进意图的 conflicts 记录')
  // ③ 每一处 overwrite: true 都必须按名字清单逐条置位
  // （声明的清单 / 续做确认的清单 / 自动确认覆盖时的冲突名）
  const overwriteLiterals = [...INDEX_CODE.matchAll(/overwrite: true/g)]
  assert.ok(overwriteLiterals.length >= 3, `overwrite:true 应有多处（每条清单各一处）`)
  for (const line of INDEX_CODE.split('\n').filter((text) => text.includes('overwrite: true'))) {
    assert.match(
      line,
      /confirmedNames\.includes\(item\.name\)|names\.includes\(item\.name\)|autoNames\.includes\(item\.name\)|String\(item\?\.name\) === String\(name\)/,
      `overwrite:true 必须按"确认过的名字"逐条置位，实际：${line.trim()}`
    )
  }
  assert.ok(!/overwrite\s*=\s*true/.test(INDEX_CODE), '不得有"默认就把 overwrite 置 true"的赋值')
  // 调用方显式声明过确认的老路径仍然要校验"声明覆盖了当前冲突集"（防止被当成万能开关）
  assert.match(
    startFn,
    /const covered = conflictsConfirmed\(/,
    '声明式确认仍必须校验清单覆盖当前冲突集'
  )
  assert.match(startFn, /names: declaredNames \}/, '被校验的清单必须来自调用方声明的 names')
  assert.ok(
    !/names: \[\.\.\.conflicts\]/.test(startFn),
    '不得把"服务端扫描结果"直接当成用户声明过的清单'
  )
  // ④ 逐条留痕：日志里必须出现"自动覆盖（不可恢复）"
  assert.match(INDEX_CODE, /自动覆盖（不可恢复）/, '覆盖是不可恢复的删数据动作，必须逐条写日志')
  // 续做路径的确认动作仍在（状态机不改），没有待确认项时才降级为"继续"
  const resolveFn = INDEX_CODE.slice(INDEX_CODE.indexOf('async function resolveRootMigration('))
  assert.match(resolveFn, /confirm-overwrite/, '必须有显式的确认动作')
  assert.match(resolveFn, /pendingConflicts\(intent\)/, '没有待确认项时才降级为"继续"')
  // 助手侧不得自行决定覆盖：`overwrite` 由扩展侧传入且来源于意图记录
  assert.match(INDEX_CODE, /overwrite: overwriting/, 'overwrite 必须由扩展侧显式传入')
})

test('I-10（1.0.4）：设置页改根 = 迁移的触发点（与「迁移到此目录」同一个状态机入口）', () => {
  // 用户决策：扩展页面不再有迁移按钮 ⇒ "用户选了新目录"由设置变更通知驱动。
  // 判据在纯函数 `planRootChangeTrigger`（矩阵见 `test/migrationStatus.test.js`），
  // 这里只断言"入口真的把它接上了"，且**没有**因为补触发点而绕过既有护栏。
  assert.match(INDEX_CODE, /planRootChangeTrigger/, '必须复用纯函数判据')
  assert.match(INDEX_CODE, /async function onProfileRootSettingChanged\(/, '必须有触发点处理函数')
  assert.match(
    INDEX_CODE,
    /void onProfileRootSettingChanged\(\)/,
    'onChanged(profileRoot) 必须调用它（同一条订阅里仍要作废体积缓存）'
  )
  // 状态机入口必须是**同一个** `startRootMigration`（自动覆盖、prepareRoot、冲突预检都在里面）
  const handler = (() => {
    const start = INDEX_CODE.indexOf('async function onProfileRootSettingChanged(')
    const open = INDEX_CODE.indexOf('{', start)
    let depth = 0
    for (let i = open; i < INDEX_CODE.length; i += 1) {
      if (INDEX_CODE[i] === '{') depth += 1
      else if (INDEX_CODE[i] === '}') {
        depth -= 1
        if (depth === 0) return INDEX_CODE.slice(open, i + 1)
      }
    }
    return ''
  })()
  assert.ok(handler.length > 0, '必须能定位到触发点处理函数体')
  assert.match(handler, /await startRootMigration\(/, '必须调既有的 startRootMigration')
  assert.ok(
    !/prepareRoot|migrateRootDir|createRootIntent|writeRootIntent/.test(handler),
    '不得在触发点里自己拼一套迁移（必须走同一个状态机入口）'
  )
  // 迁移进行中不得叠开：拒绝分支里不得出现 startRootMigration
  // ⚠️ 边界用**运行期字符串**，不用注释：INDEX_CODE 是剥掉注释后的源码
  const rejectAt = handler.indexOf('if (!plan.trigger)')
  const noticeAt = handler.indexOf('改根被拒绝：已有迁移进行中')
  assert.ok(rejectAt > 0 && noticeAt > rejectAt, '必须能区分"拒绝分支"与"正常路径"')
  assert.ok(
    !handler.slice(rejectAt, noticeAt).includes('startRootMigration'),
    '拒绝分支不得开始新迁移'
  )
})

test('I-7：**无备份**（反向门禁）——覆盖前不得先留一份', () => {
  const danger = [/backup/i, /\.bak\b/i, /\.old\b/i, /copyToTemp/i, /keepCopy/i]
  for (const pattern of danger) {
    assert.ok(!pattern.test(INDEX_CODE), `index.js 出现了备份路径（${pattern}）：P1 = B 明确不备份`)
  }
})

test('I-8：「浏览…」的降级接线与"不报错"', () => {
  assert.match(INDEX_CODE, /properties: \['openDirectory'\]/, '必须请求选目录')
  assert.match(INDEX_CODE, /isDirectory === true/, '能力判据必须是"拿到的路径是不是目录"')
  assert.ok(!/getOboxVersion/.test(INDEX_CODE), '禁止用宿主版本号判断能力（D18：版本号不可靠）')
  assert.match(INDEX_CODE, /supported: false/, '不支持时必须回 supported:false 而不是抛错')
  assert.match(INDEX_CODE, /degraded: true/, '降级路径必须显式标记 degraded')
  // browseRootDir 的每个分支都 return ok(...)，不得 throw（除入参校验外）
  const browseFn = INDEX_CODE.slice(
    INDEX_CODE.indexOf('async function browseRootDir('),
    INDEX_CODE.indexOf('// ---- 注册 ----')
  )
  assert.ok(!/throw /.test(browseFn), 'browseRootDir 不得抛错（降级必须"说出来"而不是失败）')
  assert.match(browseFn, /console\.info\('\[webapp\] 「浏览…」被取消/, '取消必须只记 info')
  // supported 只缓存在本会话内存（不落库、不写设置）
  assert.match(INDEX_CODE, /let browseSupported = null/, 'supported 必须是内存变量')
  assert.ok(!/api\.settings\.set\([^)]*supported/.test(INDEX_CODE), 'supported 不得写进设置')
})

test('I-9：卸载提示文案（P4）在入口里存在', () => {
  const start = INDEX_CODE.indexOf('export async function uninstall')
  const body = INDEX_CODE.slice(start)
  assert.match(body, /卸载扩展时不会删除它/, '必须写明外部根不会被卸载删除')
  assert.match(body, /需你自行清理/, '必须写明需用户自行清理')
  assert.ok(!/api\.(dialog|ui)/.test(body), '卸载钩子不得做交互（10s 预算、无交互通道）')
})

test('编排状态机的纯逻辑（把 index.js 的循环用同一批纯函数跑一遍）', () => {
  // 场景：五条 —— 两条正常、一条覆盖（已确认）、一条未确认、一条失败
  let intent = createRootIntent({
    from: 'C:\\data\\chrome',
    to: 'D:\\obox-webapp\\profiles',
    items: [{ name: 'A' }, { name: 'B' }, { name: 'C' }, { name: 'D' }, { name: 'E' }]
  })
  // 生效根在迁移未完成时**恒为旧根**，哪怕设置值已变成新根
  assert.equal(
    resolveEffectiveRoot({ configured: intent.to, defaultRoot: intent.from, intent }).root,
    intent.from
  )
  intent = applyItemResult(intent, { name: 'A', status: 'done' })
  intent = applyItemResult(intent, { name: 'B', status: 'done' })
  intent = applyItemResult(intent, { name: 'C', status: 'overwritten', overwrite: true })
  intent = applyItemResult(intent, { name: 'D', status: 'skipped', reason: '未确认覆盖' })
  assert.equal(advanceMigrationState(intent).writable, false, '还有未终结项 ⇒ 不写设置')
  assert.equal(progressText(intent.summary), '已搬 3/5，覆盖 1，跳过 1')
  intent = applyItemResult(intent, { name: 'E', status: 'failed', reason: '[migrate-failed] x' })
  assert.equal(advanceMigrationState(intent).writable, false, '有 failed ⇒ 不写设置、不删源')
  assert.equal(progressText(intent.summary), '已搬 3/5，覆盖 1，跳过 1，失败 1')
  assert.deepEqual(summarize(intent), {
    total: 5,
    done: 2,
    overwritten: 1,
    skipped: 1,
    failed: 1,
    missing: 0
  })
  // 重试成功后：只剩 skipped（skipped 是终态、不阻塞） ⇒ 可写
  intent = applyItemResult(intent, { name: 'E', status: 'done' })
  assert.equal(advanceMigrationState(intent).writable, true)
  assert.deepEqual(pendingConflicts(intent), [], '已覆盖的条目不再需要确认')
  assert.equal(conflictsConfirmed(intent.conflicts, ['C']), false, '未写入确认记录 ⇒ 视为未确认')
})

test('单条目决策在"目标已存在且未确认"时一定返回 skipped（编排层据此自动确认后才覆盖）', () => {
  const decided = decideMigrationItem({ exists: true }, { exists: true }, { overwrite: true })
  assert.equal(decided.action, 'skipped')
  assert.equal(decided.reason, '未确认覆盖')
  // ⚠️ 1.0.4：编排层在**真正动手之前**就把冲突记成自动确认（`autoConfirmOverwrite`），
  // 因此"未确认"这条分支在编排路径上不可达——但判据本身**不得**放宽（纯函数仍是
  // "确认过才允许覆盖"），这样"自动确认"始终是一处**显式**的记录，而不是隐式的默认行为。
  const confirmed = decideMigrationItem(
    { exists: true },
    { exists: true },
    { overwrite: true, confirmed: true }
  )
  assert.equal(confirmed.action, 'overwritten')
  // 编排层把 skipped 写进意图后，该条目**不再**尝试搬运
  const intent = createRootIntent({
    from: 'C:\\a',
    to: 'D:\\b',
    items: [{ name: 'X', overwrite: true }]
  })
  const next = applyItemResult(intent, { name: 'X', status: 'skipped', reason: decided.reason })
  assert.equal(next.items[0].status, 'skipped')
  assert.deepEqual(pendingConflicts(next), ['X'], '未确认的覆盖项必须一直阻塞写设置')
})
