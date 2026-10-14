/**
 * **迁移进度模态框的生命周期**（1.0.6，amendment 09 §11）——本仓库**唯一**用宿主 mock 驱动入口的测试。
 *
 * 为什么必须用 mock（而不是像 `test/rootMigration.test.js` / `test/ipcSurface.test.js` 那样只读源码）：
 * 本需求的核心断言是**运行时行为**——"迁移结束时 `webapp.migrationProgress` 一定是空串"。
 * 源码里有 `finally` **不等于**运行时真的清空（顺序、提前 return、异常路径都可能绕过它），
 * 而宿主对 `status + modal:true` 且值非空是**无关闭按钮 / Esc 无效 / 点遮罩无效**：
 * 漏一次清空 = 用户被永久锁在设置页。这类断言只能靠真跑一遍。
 *
 * ⚠️ mock 面**严格限定**在四个能力（`settings` / `ipc` / `fs` / `sqlite`）+ 注册用的 `app`，
 * 不引入任何宿主实现；`lib/**` 一律用真代码（判据、状态机、文本都是真的）。
 *
 * 三条路径（每条的"结束"都必须把进度清空；用户裁定：**成功与失败都是终态**）：
 * 1. **成功**：`migrateRootDir` 回 `done` ⇒ 迁完、写设置、状态项"已完成"；
 * 2. **失败**（业务失败，不抛错）：回 `{ status: 'failed', reason: '[migrate-failed] 磁盘满' }`
 *    ⇒ 状态项首行"失败"+ 原因 + "数据仍在旧根"，进度清空；
 * 3. **异常**：`migrateRootDir` **抛错**（通道断开 / 助手崩）⇒ 状态项写"迁移中断：<原因>"，进度清空。
 */
import assert from 'node:assert/strict'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SETTING_KEYS } from '../lib/profileLimit.mjs'
import webapp from '../index.js'

/** 建一个"扩展 data 目录：默认根里有条目 test、库里有一条 entry"的最小现场 */
function makeScene(name) {
  const tmp = join(
    tmpdir(),
    `webapp-progress-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  const dataDir = join(tmp, 'data')
  const defaultRoot = join(dataDir, 'chrome')
  const targetRoot = join(tmp, 'target')
  mkdirSync(join(defaultRoot, 'test'), { recursive: true })
  mkdirSync(dataDir, { recursive: true })
  writeFileSync(join(defaultRoot, 'test', 'x.txt'), 'login-state')
  rmSync(targetRoot, { recursive: true, force: true })
  return { tmp, dataDir, defaultRoot, targetRoot }
}

/**
 * 宿主 mock。
 * @param {{ tmp: string, dataDir: string, defaultRoot: string }} scene
 * @param {'ok'|'failed'|'throw'} behavior `migrateRootDir action='move'` 的行为
 */
function makeHost(scene, behavior) {
  const settings = new Map()
  const timeline = []
  const listeners = new Set()
  const entriesOf = (root) => {
    if (!existsSync(root)) return []
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name !== '.trash')
      .map((entry) => entry.name)
  }
  const api = {
    app: { register: () => ({ dispose() {} }), onMessage: () => ({ dispose() {} }) },
    settings: {
      get: (key, fallback) => (settings.has(key) ? settings.get(key) : fallback),
      set: (key, value) => {
        settings.set(key, value)
        timeline.push({ key, value: String(value ?? '') })
      },
      onChanged: (callback) => {
        listeners.add(callback)
        return { dispose: () => listeners.delete(callback) }
      }
    },
    fs: {
      readFile: async (rel) => {
        const path = join(scene.dataDir, rel)
        if (!existsSync(path)) throw new Error(`ENOENT: ${rel}`)
        return readFileSync(path, 'utf8')
      },
      writeFile: async (rel, text) => writeFileSync(join(scene.dataDir, rel), text),
      remove: async (rel) => rmSync(join(scene.dataDir, rel), { force: true })
    },
    sqlite: {
      open: async () => ({
        exec: async () => {},
        get_all: async () => [
          {
            id: 1,
            name: 'test',
            url: 'https://a.example',
            profileDir: 'test',
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z'
          }
        ],
        get: async () => null,
        insert: async () => ({}),
        update: async () => {},
        del: async () => {}
      })
    },
    ipc: {
      connect: async () => {},
      onClose: () => ({ dispose() {} }),
      close: async () => {},
      request: async (_channel, method, params = {}) => {
        switch (method) {
          case 'profileRootStatus': {
            const root = params.root ? String(params.root) : scene.defaultRoot
            return {
              root,
              isDefault: root === scene.defaultRoot,
              exists: existsSync(root),
              isDirectory: existsSync(root),
              marked: true,
              unmanaged: false,
              marker: null,
              entries: entriesOf(root)
            }
          }
          case 'prepareRoot':
            mkdirSync(join(String(params.root), '.trash'), { recursive: true })
            writeFileSync(
              join(String(params.root), '.obox-webapp-root'),
              '{"marker":"obox-webapp-root"}'
            )
            return { root: params.root, created: true, marked: true }
          case 'migrateRootDir': {
            if (params.action === 'probe') return { conflict: false }
            if (behavior === 'throw') throw new Error('[webapp] 通道断开（模拟助手崩溃）')
            if (behavior === 'failed') {
              return { status: 'failed', reason: '[migrate-failed] 磁盘满' }
            }
            const from = join(String(params.from), String(params.name))
            const to = join(String(params.to), String(params.name))
            if (existsSync(from)) renameSync(from, to)
            return { status: 'done', files: 1, bytes: 11, copiedFiles: 1, copiedBytes: 11 }
          }
          case 'cleanCaches':
            return { cleaned: [], totalFreedBytes: 0, skipped: [] }
          default:
            throw new Error(`未 mock 的助手方法: ${method}`)
        }
      }
    }
  }
  return { api, settings, timeline, listeners }
}

/** 装好 console 捕获（进度与日志都要能断言，且不刷屏） */
function captureConsole() {
  const logs = []
  const original = { info: console.info, warn: console.warn, error: console.error }
  console.info = (...args) => logs.push(args.join(' '))
  console.warn = (...args) => logs.push(args.join(' '))
  console.error = (...args) => logs.push(args.join(' '))
  return {
    logs,
    restore: () => {
      console.info = original.info
      console.warn = original.warn
      console.error = original.error
    }
  }
}

/** 跑一条完整路径：激活 → 等激活期引导结束 → 触发一次"设置页改根 ⇒ 迁移" */
async function runMigration(behavior) {
  const scene = makeScene(behavior)
  const host = makeHost(scene, behavior)
  const consoleCapture = captureConsole()
  // 捕获分发出去的 handler（公开面只有 onMessage，够驱动整个迁移）
  let handler = null
  const api = {
    ...host.api,
    app: {
      register: () => ({ dispose() {} }),
      onMessage: (fn) => {
        handler = fn
        return { dispose() {} }
      }
    }
  }
  try {
    webapp(api)
    // 等激活期引导（连助手 → 回填 → 对账）跑完：此时 profileRoot 已被回填成默认根，
    // 数据实际所在根 = 默认根 ⇒ 对账判 same-as-current、不会自己发起迁移。
    await new Promise((resolve) => setTimeout(resolve, 80))
    assert.ok(handler, '必须拿到 onMessage 的分发函数')
    // ⚠️ `host.settings` 是 **Map**（没有默认值参数）⇒ 缺键时返回 undefined，必须自己兜底
    const progressAfterActivation = String(host.settings.get(SETTING_KEYS.migrationProgress) ?? '')
    const before = host.timeline.length
    const reply = await handler('startRootMigration', { root: scene.targetRoot })
    // 等所有异步收尾（finally 清空）落定
    await new Promise((resolve) => setTimeout(resolve, 80))
    return {
      scene,
      settings: host.settings,
      timeline: host.timeline.slice(before),
      progressAfterActivation,
      status: String(host.settings.get(SETTING_KEYS.migrationStatus, '')),
      progress: String(host.settings.get(SETTING_KEYS.migrationProgress, '')),
      reply,
      logs: consoleCapture.logs
    }
  } finally {
    consoleCapture.restore()
    // ⚠️ **不要在这里删现场**：断言要看迁移后的文件系统（各用例在 `t.after` 里清理）
  }
}

/** 用例收尾：删掉临时现场（放在 `t.after` 里，保证断言先跑） */
function cleanupAfter(t, run) {
  t.after(() => rmSync(run.scene.tmp, { recursive: true, force: true }))
}

test('11 成功路径：迁移中写进度、结束后 migrationProgress **必为空**（模态框关闭）', async (t) => {
  const run = await runMigration('ok')
  cleanupAfter(t, run)
  // 迁移期间确实写过非空进度（模态框真的弹过），且第一行是 0/N
  const progressWrites = run.timeline
    .filter((item) => item.key === SETTING_KEYS.migrationProgress)
    .map((item) => item.value)
  assert.ok(
    progressWrites.some((text) => text.startsWith('正在迁移浏览器数据：已搬 0/1')),
    `必须写过第一行进度（0/N），实际：${JSON.stringify(progressWrites)}`
  )
  assert.ok(
    progressWrites.some((text) => text.startsWith('正在迁移浏览器数据：已搬 1/1')),
    `每搬完一条要刷新进度，实际：${JSON.stringify(progressWrites)}`
  )
  // 关键断言：结束时是空串
  assert.equal(run.progress, '', '成功结束后 migrationProgress 必须为空串')
  assert.equal(progressWrites[progressWrites.length - 1], '', '时间线的最后一条进度写入必须是清空')
  // 数据真的搬了、设置写到了新根、状态项是"已完成"
  assert.equal(existsSync(join(run.scene.targetRoot, 'test', 'x.txt')), true, '数据应已迁到目标根')
  assert.equal(existsSync(join(run.scene.defaultRoot, 'test')), false, '旧根下的条目应已删除')
  assert.equal(run.settings.get(SETTING_KEYS.profileRoot), run.scene.targetRoot)
  assert.match(run.status, /迁移已完成：已搬 1\/1/)
  assert.equal(run.reply?.ok, true)
  // 激活期结束时进度就是空的（不自作多情地弹模态框）
  assert.equal(run.progressAfterActivation, '', '激活期结束时不应留下非空进度')
})

test('11 失败路径：状态项给失败摘要、migrationProgress **必为空**（失败也是终态）', async (t) => {
  const run = await runMigration('failed')
  cleanupAfter(t, run)
  assert.ok(
    run.timeline.some((item) => item.key === SETTING_KEYS.migrationProgress && item.value !== ''),
    '失败前也真的弹过模态框（否则这条用例证明不了"清空"）'
  )
  assert.equal(
    run.progress,
    '',
    '失败结束后 migrationProgress 必须为空串（用户裁定：失败也是终态）'
  )
  // 失败摘要必须写进**只读状态项**（不能只留控制台日志）
  assert.match(run.status, /浏览器数据迁移失败：已搬 0\/1/)
  assert.match(run.status, /失败 1 项（\[migrate-failed\] 磁盘满）/)
  assert.match(run.status, /数据仍在旧根.*设置值未改/)
  // 失败不得写设置、不得删源
  assert.notEqual(run.settings.get(SETTING_KEYS.profileRoot), run.scene.targetRoot)
  assert.equal(existsSync(join(run.scene.defaultRoot, 'test', 'x.txt')), true, '源必须保留')
  assert.equal(run.reply?.ok, true, '业务失败如实回包（ok:true + blocked），不是异常')
})

test('11 异常路径：状态项写"迁移中断"、migrationProgress **必为空**（finally 兜住异常）', async (t) => {
  const run = await runMigration('throw')
  cleanupAfter(t, run)
  assert.ok(
    run.timeline.some((item) => item.key === SETTING_KEYS.migrationProgress && item.value !== ''),
    '异常前也真的弹过模态框'
  )
  assert.equal(run.progress, '', '异常结束后 migrationProgress 必须为空串（这就是 finally 的意义）')
  assert.match(run.status, /迁移中断：/)
  assert.match(run.status, /通道断开（模拟助手崩溃）/)
  assert.equal(existsSync(join(run.scene.defaultRoot, 'test', 'x.txt')), true, '源必须保留')
  // handler 不抛错（入口口径）：返回 ok:true + blocked（或 ok:false），都算"如实回包"
  assert.ok(run.reply && typeof run.reply === 'object')
})
