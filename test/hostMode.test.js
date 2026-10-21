/**
 * **宿主模式（obox 2.0.0）适配**的两条回归门禁。
 *
 * 背景：用户扩展的入口从渲染进程搬进了 **Extension Host Process**（独立 Node 进程、无 DOM），
 * 由此带来两处**运行期语义**变化，都不是"读源码就能看出来"的：
 *
 * 1. **入口按 `file://` 加载** ⇒ `import.meta.url` 不再是 `app://`，用它拼出来的卡片页地址是
 *    `file://…/ui/index.html`，会被渲染侧 CSP（`default-src 'self' app:`）拦掉 ⇒ 卡片白屏。
 * 2. **`api.settings.get` 读的是渲染侧推上来的快照缓存**，第一份快照到达前返回**缺省值**；而宿主
 *    **不通知**"快照已到"（首个快照按初始化处理、不触发 `onChanged`）⇒ "用户确实没配"与"缓存还
 *    没热"在扩展侧**不可区分**。据此写的任何**不可逆**动作都可能做错：
 *    - 默认根回填若把冷读的空串当真，会把用户配好的**外部根覆盖成默认根**（配置丢失，不可恢复）；
 *    - 清空迁移进度若先读当前值再比较，冷缓存下"读到空串 == 要写的空串" ⇒ 自愈被吞掉，
 *      用户继续被上次崩溃留下的**不可关闭模态框**锁住。
 *
 * ⚠️ 这两条都**必须真跑一遍**（源码门禁只能证明"写了这段代码"，证明不了运行时行为），
 * 所以本文件用宿主 mock 驱动入口，口径与 `test/migrationProgress.test.js` 一致：mock 面只含
 * `app` / `settings` / `ipc` / `fs` / `sqlite`，`lib/**` 全用真代码。
 */
import assert from 'node:assert/strict'
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { SETTING_KEYS } from '../lib/profileLimit.mjs'
import webapp, { WEBAPP_CONSTANTS } from '../index.js'

/** 用户配置过的外部根（回填**绝不允许**把它覆盖掉） */
const CUSTOM_ROOT = process.platform === 'win32' ? 'D:\\obox-webapp-profiles' : '/tmp/obox-webapp'

// ---------------------------------------------------------------------------
// ① 卡片页 URL（宿主里 import.meta.url 是 file://）
// ---------------------------------------------------------------------------

test('① 卡片页 URL 必须是 `app://extensions/<安装目录名>/ui/index.html`，**不得**是 file://', () => {
  const url = WEBAPP_CONSTANTS.PAGE_URL
  assert.equal(typeof url, 'string')
  assert.equal(url.startsWith('file:'), false, `宿主模式下拼成 file:// 会被 CSP 拦掉：${url}`)
  assert.match(
    url,
    /^app:\/\/extensions\/[^/]+\/ui\/index\.html$/,
    `必须是 app://extensions/<安装目录名>/ui/index.html 形状（安装目录名 ≠ manifest.name）：${url}`
  )
  // 回归钉：入口是 file:// 时，目录名必须来自入口路径自身（而不是 manifest.name / 硬编码）
  const entryDir = new URL('..', import.meta.url).pathname.split(/[\\/]/).filter(Boolean).pop()
  assert.equal(decodeURIComponent(entryDir), url.split('/')[3])
})

// ---------------------------------------------------------------------------
// ② settings 冷缓存：不可逆动作不得建立在"读到缺省值"上
// ---------------------------------------------------------------------------

/** 一个"设置快照还没热"的最小现场：默认根目录存在、库里没有条目 */
function makeScene(name) {
  const tmp = join(
    tmpdir(),
    `webapp-hostmode-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`
  )
  const dataDir = join(tmp, 'data')
  const defaultRoot = join(dataDir, 'chrome')
  mkdirSync(defaultRoot, { recursive: true })
  return { tmp, dataDir, defaultRoot }
}

/**
 * 宿主 mock。
 *
 * @param {{ dataDir: string, defaultRoot: string }} scene
 * @param {{ cold: boolean, seed?: Record<string, string> }} options
 *   `cold: true` ⇒ 模拟"第一份快照还没到"：`settings.get` **一律**返回缺省值（哪怕 store 里已经有值）
 */
function makeHost(scene, options) {
  const settings = new Map(Object.entries(options.seed ?? {}))
  const timeline = []
  const listeners = new Set()
  const state = { cold: options.cold === true }
  const entriesOf = (root) => {
    try {
      return readdirSync(root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && entry.name !== '.trash')
        .map((entry) => entry.name)
    } catch {
      return []
    }
  }
  const api = {
    app: { register: () => ({ dispose() {} }), onMessage: () => ({ dispose() {} }) },
    settings: {
      // ⚠️ 冷缓存的准确语义：返回值**只**看快照，不看 store（store 里的值要等快照到了才可见）
      get: (key, fallback) =>
        state.cold ? fallback : settings.has(key) ? settings.get(key) : fallback,
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
        try {
          return readFileSync(join(scene.dataDir, rel), 'utf8')
        } catch {
          throw new Error(`ENOENT: ${rel}`)
        }
      },
      writeFile: async (rel, text) => writeFileSync(join(scene.dataDir, rel), text),
      remove: async (rel) => rmSync(join(scene.dataDir, rel), { force: true })
    },
    sqlite: {
      open: async () => ({
        exec: async () => {},
        get_all: async () => [],
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
        if (method !== 'profileRootStatus') throw new Error(`未 mock 的助手方法: ${method}`)
        const root = params.root ? String(params.root) : scene.defaultRoot
        return { root, isDefault: root === scene.defaultRoot, entries: entriesOf(root) }
      }
    }
  }
  return {
    api,
    settings,
    timeline,
    /** 模拟"快照到达 + 任意一个键变化"（宿主模式下这是唯一能拿到的"缓存已热"证据） */
    warmUp(key = SETTING_KEYS.migrationStatus) {
      state.cold = false
      for (const listener of [...listeners]) listener(key)
    }
  }
}

/** 跑一次激活期引导（不 await，与入口一致；轮询等它落定） */
async function activate(host) {
  webapp(host.api)
  // 引导是 fire-and-forget（`void bootstrapRootsOnActivation()`）⇒ 只能等它自己跑完。
  // 判据：对账结束时一定写过 migrationStatus（1.0.6 的"当前状态"文案）。
  for (let i = 0; i < 80; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 25))
    if (host.settings.has(SETTING_KEYS.migrationStatus)) return
  }
  assert.fail('激活期引导没有跑完（等不到 migrationStatus 写入）')
}

/** 用例收尾 */
function cleanupAfter(t, scene) {
  t.after(() => rmSync(scene.tmp, { recursive: true, force: true }))
}

test('② 冷缓存：默认根回填**绝不**覆盖用户配好的外部根（读到的空串不能当真）', async (t) => {
  const scene = makeScene('cold')
  cleanupAfter(t, scene)
  const host = makeHost(scene, { cold: true, seed: { [SETTING_KEYS.profileRoot]: CUSTOM_ROOT } })
  await activate(host)
  // 冷缓存期间一次都没写过 profileRoot（覆盖是不可恢复的：原值再也拿不回来）
  assert.deepEqual(
    host.timeline.filter((item) => item.key === SETTING_KEYS.profileRoot),
    [],
    '冷缓存下不得回填（否则会把用户的外部根覆盖成默认根）'
  )
  // 快照到达（= 缓存已热）后再补做：此时读到的是真实值 ⇒ 判 `configured-custom`、仍不写。
  // 触发用**别的键**（模拟"用户改了任意一项设置"）——不要用 `profileRoot`，那会顺带走到
  // "改根 ⇒ 迁移" 的既有分支，把本用例的意图搅浑。
  host.warmUp()
  await new Promise((resolve) => setTimeout(resolve, 80))
  assert.deepEqual(
    host.timeline.filter((item) => item.key === SETTING_KEYS.profileRoot),
    [],
    '缓存已热后读到的是用户的自定义根 ⇒ 回填判据必须判"不覆盖"'
  )
  // 设置里用户的值原样保留
  assert.equal(host.settings.get(SETTING_KEYS.profileRoot), CUSTOM_ROOT)
})

test('② 冷缓存：清空迁移进度是**强制写**（先读当前值会把自愈吞掉）', async (t) => {
  const scene = makeScene('progress')
  cleanupAfter(t, scene)
  // 现场：上次迁移被强杀，进度键里留着一串非空文本（宿主的等待模态框正在弹）
  const host = makeHost(scene, {
    cold: true,
    seed: { [SETTING_KEYS.migrationProgress]: '正在迁移浏览器数据：已搬 1/3' }
  })
  await activate(host)
  const clears = host.timeline.filter((item) => item.key === SETTING_KEYS.migrationProgress)
  assert.ok(clears.length >= 1, '激活期必须真的写一次空串（冷缓存下"值没变不写"会让它一次都不写）')
  assert.equal(clears[0].value, '', '激活期第一次写的必须是空串（关闭模态框的唯一信号）')
  assert.equal(host.settings.get(SETTING_KEYS.migrationProgress), '')
})

test('② 热缓存（上次会话写过状态项）+ 未配过 root ⇒ 仍然回填默认根（1.0.6 行为不变）', async (t) => {
  const scene = makeScene('warm')
  cleanupAfter(t, scene)
  // 第二次及以后的激活就是这个样子：状态项里有上次写的文本 ⇒ "缓存已热"有正证据
  const host = makeHost(scene, {
    cold: false,
    seed: { [SETTING_KEYS.migrationStatus]: '当前无未完成的迁移' }
  })
  await activate(host)
  const writes = host.timeline.filter((item) => item.key === SETTING_KEYS.profileRoot)
  assert.equal(writes.length, 1, '热缓存 + 未配置 ⇒ 恰好回填一次')
  assert.equal(writes[0].value, scene.defaultRoot)
})

test('② 首次会话（store 里还没有本扩展的任何键）⇒ **保守跳过**，不改写、下次再补（如实钉住代价）', async (t) => {
  // 这是"证明缓存已热"这套判据的**已知代价**：全新安装的第一次激活里，设置 store 里既没有
  // `profileRoot`（用户没配）也没有 `migrationStatus`（上次会话还没写过）⇒ 拿不到任何正证据，
  // 于是本次不回填（信息项 `migrationStatus` 里仍有"当前生效根 = <默认根>"，用户不会有信息盲区），
  // 下一次激活或用户第一次改设置时补上。**宁可晚一次，也不覆盖用户的外部根。**
  const scene = makeScene('first')
  cleanupAfter(t, scene)
  const host = makeHost(scene, { cold: false })
  const logs = []
  const originalInfo = console.info
  console.info = (...args) => logs.push(args.join(' '))
  try {
    await activate(host)
  } finally {
    console.info = originalInfo
  }
  assert.deepEqual(
    host.timeline.filter((item) => item.key === SETTING_KEYS.profileRoot),
    [],
    '无正证据时不得回填（这条"晚一次"的行为是被接受并记录在案的取舍）'
  )
  assert.ok(
    logs.some((line) => line.includes('宿主设置快照还没到')),
    '跳过必须留痕（否则现场只能看到"设置页不显示路径"）'
  )
})
