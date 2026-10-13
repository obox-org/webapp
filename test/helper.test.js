/**
 * `helper.cjs` 的**真子进程**集成测（规格 §18.2；照搬 `extensions/rdp/test/helper.test.js` 的骨架）。
 *
 * 覆盖：`--selftest`、ndjson JSON-RPC 往返、`probe`（候选恒为 4 项）、协议错误形状、
 * 以及**只清缓存**的黑名单门禁（Cookies / Login Data / Local Storage / IndexedDB /
 * Service Worker / History / Bookmarks / Preferences 逐字节不变）。
 *
 * ⚠️ `probe` **没有测试注入口**（D-2 = C）：这里不断言"探测顺位回退"那条分支
 * （那需要真机手工验收，见 README 的「已知覆盖缺口」）。
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs'
import { rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import readline from 'node:readline'

const helperPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'helper.cjs')
const nodePath = process.execPath

/**
 * 删临时目录（**带重试**）。
 *
 * 为什么必须重试：Windows 上 `fs.rm` 在"子进程刚退出、句柄还没完全释放"时会报
 * `EPERM: Permission denied`（实测：helper 的 stdout/stderr 管道与 profile 目录里的
 * 文件句柄有一小段释放延迟）。测试的 teardown 不该因此变红——**这是环境竞态，不是断言失败**。
 * `maxRetries` + `retryDelay` 让 Node 自己退避重试；再失败才真的抛。
 */
function cleanupDir(dir) {
  return rm(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
}

/** 跑一次 `node helper.cjs --selftest` */
function runSelftest() {
  return new Promise((resolve, reject) => {
    const child = spawn(nodePath, [helperPath, '--selftest'], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => (stdout += chunk))
    child.stderr.on('data', (chunk) => (stderr += chunk))
    child.on('error', reject)
    child.on('close', (code) => resolve({ code, stdout, stderr }))
  })
}

/**
 * 起一个助手子进程，返回 `{ send, waitFor, close, responses, stderrText }`。
 * `cwd` 即助手的 profile 根所在目录（`<cwd>/chrome/<名>`）。
 */
function startHelper(cwd) {
  const child = spawn(nodePath, [helperPath], { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
  const responses = []
  let stderr = ''
  const rl = readline.createInterface({ input: child.stdout })
  rl.on('line', (line) => {
    const text = String(line).trim()
    if (text) responses.push(JSON.parse(text))
  })
  child.stderr.on('data', (chunk) => (stderr += chunk))

  const waitFor = (predicate) =>
    new Promise((resolve, reject) => {
      const started = Date.now()
      const timer = setInterval(() => {
        const found = responses.find(predicate)
        if (found) {
          clearInterval(timer)
          resolve(found)
        } else if (Date.now() - started > 15_000) {
          clearInterval(timer)
          reject(new Error(`等待响应超时；已收到 ${JSON.stringify(responses)}；stderr: ${stderr}`))
        }
      }, 20)
    })

  const send = (message) => child.stdin.write(`${JSON.stringify(message)}\n`)

  return {
    send,
    waitFor,
    responses,
    stderrText: () => stderr,
    close: async () => {
      child.stdin.end()
      return new Promise((resolve) => child.on('close', resolve))
    }
  }
}

test('helper.cjs --selftest：退出码 0，且不启动 Chrome', async () => {
  const result = await runSelftest()
  assert.equal(
    result.code,
    0,
    `退出码 ${result.code}\nstdout: ${result.stdout}\nstderr: ${result.stderr}`
  )
  assert.match(result.stdout, /selftest 通过/)
  assert.match(result.stdout, /未启动 Chrome/)
})

test('probe 往返：jsonrpc 2.0、cwd 继承、候选恒为 4 项且顺序固定', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'obox-webapp-helper-'))
  const helper = startHelper(cwd)
  try {
    helper.send({ jsonrpc: '2.0', id: 1, method: 'probe', params: {} })
    const probe = await helper.waitFor((r) => r.id === 1)
    assert.equal(probe.jsonrpc, '2.0')
    assert.equal(probe.error, undefined)
    assert.equal(basename(probe.result.cwd), basename(cwd), 'cwd 应继承宿主的 data 目录')
    assert.ok(probe.result.node, 'probe 应返回 node 版本')
    assert.ok('electron' in probe.result)
    assert.ok('runAsNode' in probe.result)
    // D-2 = C：候选恒为 4 项、顺序固定（programfiles → x86 → localappdata → 注册表）
    assert.equal(probe.result.chromeCandidates.length, 4)
    assert.deepEqual(
      probe.result.chromeCandidates.map((item) => item.source),
      ['programfiles', 'programfiles-x86', 'localappdata', 'registry']
    )
    for (const item of probe.result.chromeCandidates) {
      assert.equal(typeof item.path, 'string')
      assert.equal(typeof item.exists, 'boolean')
    }
    assert.ok('chrome' in probe.result)
  } finally {
    await helper.close()
    await cleanupDir(cwd)
  }
})

test('协议错误形状：未知方法 / 缺 jsonrpc / 参数非法（含 --disk-cache-size 值域）', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'obox-webapp-helper-'))
  const helper = startHelper(cwd)
  try {
    helper.send({ jsonrpc: '2.0', id: 2, method: 'nope', params: {} })
    const unknown = await helper.waitFor((r) => r.id === 2)
    assert.equal(unknown.error.code, -32601)
    assert.match(unknown.error.message, /未知方法: nope/)

    helper.send({ id: 3, method: 'probe', params: {} })
    const shorthand = await helper.waitFor((r) => r.id === 3)
    assert.equal(shorthand.error.code, -32602, '缺 jsonrpc 必须被拒（宿主强制该字段）')

    helper.send({ jsonrpc: '2.0', id: 4, method: 'launch', params: { args: 'nope' } })
    const badArgs = await helper.waitFor((r) => r.id === 4)
    assert.equal(badArgs.error.code, -32602, 'args 不是数组 → -32602')

    helper.send({
      jsonrpc: '2.0',
      id: 5,
      method: 'launch',
      params: { args: ['--app=https://a/', '--user-data-dir=chrome/x', '--proxy-server=x'] }
    })
    const forbidden = await helper.waitFor((r) => r.id === 5)
    assert.equal(forbidden.error.code, -32602)
    assert.match(forbidden.error.message, /不接受参数 --proxy-server/)

    helper.send({
      jsonrpc: '2.0',
      id: 6,
      method: 'launch',
      params: { args: ['--app=https://a/', '--user-data-dir=..\\evil'] }
    })
    const traversal = await helper.waitFor((r) => r.id === 6)
    assert.equal(traversal.error.code, -32602)
    assert.match(traversal.error.message, /chrome\/<单层目录名>/)

    // `-1`（禁用磁盘 HTTP 缓存）的合法性在这里**不通过 `launch` 验证**：
    // `launch` 会真的 spawn Chrome（本机装了就会弹一个窗口、并让收尾的目录删除与
    // 进程句柄抢锁 → EPERM / 超时）。校验值域的断言放在
    // `test/chromeArgs.test.js`（纯函数）与 `helper.cjs --selftest`（不起 Chrome）里，
    // 两处都**实际断言** `-1` 通过、`-2` / `-0` / `abc` / 超上限被拒。

    helper.send({ jsonrpc: '2.0', id: 9, method: 'launch', params: { args: ['--app=file:///x'] } })
    const badApp = await helper.waitFor((r) => r.id === 9)
    assert.equal(badApp.error.code, -32602)
    assert.match(badApp.error.message, /--app=/)
  } finally {
    await helper.close()
    await cleanupDir(cwd)
  }
})

/** 造一个"有缓存也有登录态"的假 profile */
function makeProfile(root, name) {
  const profile = join(root, 'chrome', name)
  for (const dir of [
    ['Default', 'Cache'],
    ['Default', 'Code Cache'],
    ['Default', 'Local Storage'],
    ['Default', 'IndexedDB'],
    ['Default', 'Service Worker', 'CacheStorage'],
    ['Default', 'Local Storage', 'Cache'],
    ['GPUCache'],
    ['ShaderCache'],
    ['BrowserMetrics'],
    ['optimization_guide_model_store']
  ]) {
    mkdirSync(join(profile, ...dir), { recursive: true })
  }
  writeFileSync(join(profile, 'Default', 'Cookies'), 'cookie-value', 'utf8')
  writeFileSync(join(profile, 'Default', 'Login Data'), 'login-data', 'utf8')
  writeFileSync(join(profile, 'Default', 'History'), 'history-value', 'utf8')
  writeFileSync(join(profile, 'Default', 'Bookmarks'), 'bookmark-value', 'utf8')
  writeFileSync(join(profile, 'Default', 'Preferences'), '{"a":1}', 'utf8')
  writeFileSync(join(profile, 'Default', 'Cache', 'blob'), 'C'.repeat(4096), 'utf8')
  writeFileSync(join(profile, 'GPUCache', 'gpu'), 'G'.repeat(1024), 'utf8')
  writeFileSync(join(profile, 'ShaderCache', 'shader'), 'S'.repeat(256), 'utf8')
  writeFileSync(join(profile, 'BrowserMetrics', 'metrics.pma'), 'M'.repeat(512), 'utf8')
  writeFileSync(join(profile, 'Default', 'Local Storage', 'Cache', 'deep'), 'D'.repeat(64), 'utf8')
  return profile
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex')

test('cleanCaches：只删白名单缓存，保留清单逐字节不变，深度 3 不删', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'obox-webapp-cache-'))
  const profile = makeProfile(cwd, '示例站点')
  const helper = startHelper(cwd)
  try {
    // 记录"必须保留"的文件的哈希（Cookie 的字节不变是 R17 最关键的判据）
    const keepFiles = [
      ['Default', 'Cookies'],
      ['Default', 'Login Data'],
      ['Default', 'History'],
      ['Default', 'Bookmarks'],
      ['Default', 'Preferences']
    ]
    const before = Object.fromEntries(
      keepFiles.map((parts) => [
        parts.join('/'),
        sha256(readFileSync(join(profile, ...parts), 'utf8'))
      ])
    )

    helper.send({ jsonrpc: '2.0', id: 20, method: 'profileSize', params: { name: '示例站点' } })
    const size = await helper.waitFor((r) => r.id === 20)
    assert.equal(size.result.exists, true)
    assert.ok(size.result.bytes > 0)
    assert.equal(size.result.cached, false)
    assert.ok(size.result.cacheBytes > 0, 'cacheBytes 应统计到可清理的缓存')
    assert.equal(typeof size.result.scannedAt, 'string')
    assert.equal(typeof size.result.expiresAt, 'string')

    // 第二次必须命中 60s TTL 缓存（cached=true 且 scannedAt 不变）
    helper.send({ jsonrpc: '2.0', id: 21, method: 'profileSize', params: { name: '示例站点' } })
    const cached = await helper.waitFor((r) => r.id === 21)
    assert.equal(cached.result.cached, true, '第二次应命中缓存')
    assert.equal(cached.result.scannedAt, size.result.scannedAt, '命中缓存时 scannedAt 不得变化')

    // force: true 必须重算
    helper.send({
      jsonrpc: '2.0',
      id: 22,
      method: 'profileSize',
      params: { name: '示例站点', force: true }
    })
    const forced = await helper.waitFor((r) => r.id === 22)
    assert.equal(forced.result.cached, false, 'force 必须重算')

    helper.send({ jsonrpc: '2.0', id: 23, method: 'cleanCaches', params: { name: '示例站点' } })
    const cleaned = await helper.waitFor((r) => r.id === 23)
    assert.equal(cleaned.error, undefined, `cleanCaches 不得报错：${JSON.stringify(cleaned.error)}`)
    const removed = cleaned.result.cleaned[0].removedDirs
    for (const entry of [
      'Default/Cache',
      'Default/Code Cache',
      'GPUCache',
      'ShaderCache',
      'BrowserMetrics',
      'optimization_guide_model_store'
    ]) {
      assert.ok(removed.includes(entry), `应清掉 ${entry}`)
    }
    assert.ok(!removed.includes('Default/Local Storage/Cache'), '深度 3 的同名目录不得被清')
    assert.ok(cleaned.result.totalFreedBytes > 0)
    assert.deepEqual(cleaned.result.skipped, [])

    // 黑名单断言：保留清单里的文件**逐字节不变**
    for (const parts of keepFiles) {
      const key = parts.join('/')
      assert.ok(readFileSync(join(profile, ...parts), 'utf8').length > 0, `${key} 必须仍然存在`)
      assert.equal(
        sha256(readFileSync(join(profile, ...parts), 'utf8')),
        before[key],
        `${key} 的内容必须逐字节不变`
      )
    }
    // 登录态与离线数据的**目录**也必须还在
    for (const parts of [
      ['Default', 'Local Storage'],
      ['Default', 'IndexedDB'],
      ['Default', 'Service Worker', 'CacheStorage']
    ]) {
      assert.ok(
        existsSync(join(profile, ...parts)),
        `${parts.join('/')} 目录必须保留（登录态与离线数据在那里）`
      )
    }
    assert.ok(
      readFileSync(join(profile, 'Default', 'Local Storage', 'Cache', 'deep'), 'utf8').length > 0,
      '深度 3 目录里的文件必须保留'
    )

    // 清理后必须重算体积（缓存失效条件 ③）
    helper.send({ jsonrpc: '2.0', id: 24, method: 'profileSize', params: { name: '示例站点' } })
    const afterClean = await helper.waitFor((r) => r.id === 24)
    assert.equal(afterClean.result.cached, false, '清理后必须先重算')
    assert.ok(afterClean.result.bytes < size.result.bytes, '清理后体积必须下降')
  } finally {
    await helper.close()
    await cleanupDir(cwd)
  }
})

test('cleanCaches：省略 name = 遍历全部条目；目录不存在的条目进 skipped 而不是报错', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'obox-webapp-cache-all-'))
  makeProfile(cwd, '站点A')
  makeProfile(cwd, '站点B')
  const helper = startHelper(cwd)
  try {
    helper.send({
      jsonrpc: '2.0',
      id: 30,
      method: 'cleanCaches',
      params: { name: '不存在的站点' }
    })
    const missing = await helper.waitFor((r) => r.id === 30)
    assert.equal(missing.error, undefined, '目录不存在不得报错')
    // 目录不存在 → 不进 cleaned（没清到任何东西），只进 skipped（如实说明原因）
    assert.deepEqual(missing.result.cleaned, [])
    assert.equal(missing.result.skipped.length, 1)
    assert.match(missing.result.skipped[0].reason, /不存在/)

    helper.send({ jsonrpc: '2.0', id: 31, method: 'cleanCaches', params: {} })
    const all = await helper.waitFor((r) => r.id === 31)
    assert.equal(all.error, undefined)
    assert.equal(all.result.cleaned.length, 2, '省略 name 应覆盖全部条目')
    // 顺序确定（实现里对目标名排序，避免依赖文件系统枚举顺序）
    assert.deepEqual(
      all.result.cleaned.map((item) => item.name),
      ['站点A', '站点B']
    )
  } finally {
    await helper.close()
    await cleanupDir(cwd)
  }
})

test('路径防护与 profile 生命周期：rename 两阶段、源不存在、删除进 .trash', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'obox-webapp-profile-'))
  makeProfile(cwd, '旧名')
  const helper = startHelper(cwd)
  try {
    // 路径穿越必须被拒
    for (const name of ['../evil', 'a/b', 'C:/Windows', '.trash']) {
      helper.send({ jsonrpc: '2.0', id: 40, method: 'profileStatus', params: { name } })
      const bad = await helper.waitFor((r) => r.id === 40)
      assert.equal(bad.error.code, -32602, `${name} 必须被拒`)
      helper.responses.length = 0
    }

    helper.send({
      jsonrpc: '2.0',
      id: 41,
      method: 'moveProfile',
      params: { from: '旧名', to: '新名' }
    })
    const moved = await helper.waitFor((r) => r.id === 41)
    assert.equal(moved.result.moved, true)
    assert.ok(readFileSync(join(cwd, 'chrome', '新名', 'Default', 'Cookies'), 'utf8').length > 0)

    helper.send({
      jsonrpc: '2.0',
      id: 42,
      method: 'moveProfile',
      params: { from: '不存在', to: '随便' }
    })
    const missing = await helper.waitFor((r) => r.id === 42)
    assert.equal(missing.result.missing, true, '源不存在应返回 missing 而不是报错')

    helper.send({ jsonrpc: '2.0', id: 43, method: 'removeProfile', params: { name: '新名' } })
    const removed = await helper.waitFor((r) => r.id === 43)
    assert.equal(removed.result.removed, true)

    helper.send({ jsonrpc: '2.0', id: 44, method: 'removeProfile', params: { name: '新名' } })
    const again = await helper.waitFor((r) => r.id === 44)
    assert.equal(again.result.removed, false, '目录不存在时应返回 removed:false 而不是报错')
    assert.equal(again.error, undefined)

    helper.send({ jsonrpc: '2.0', id: 45, method: 'profileStatus', params: { name: '新名' } })
    const status = await helper.waitFor((r) => r.id === 45)
    assert.equal(status.result.exists, false)
    assert.equal(status.result.locked, false)
  } finally {
    await helper.close()
    await cleanupDir(cwd)
  }
})

test('stdout 纯净性：整个会话里每一行都能 JSON.parse，且 stdin 关闭后退出码 0', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'obox-webapp-stdout-'))
  const helper = startHelper(cwd)
  try {
    helper.send({ jsonrpc: '2.0', id: 50, method: 'probe', params: {} })
    await helper.waitFor((r) => r.id === 50)
    helper.send({ jsonrpc: '2.0', id: 51, method: 'profileStatus', params: { name: 'x' } })
    await helper.waitFor((r) => r.id === 51)
    // startHelper 的 readline 回调里已对每一行 JSON.parse（解析失败会直接抛错、测试变红）
    assert.ok(helper.responses.length >= 2)
    const code = await helper.close()
    assert.equal(code, 0, `stdin 关闭后助手应自行退出（stderr: ${helper.stderrText()}）`)
  } finally {
    await cleanupDir(cwd)
  }
})

// ---------------------------------------------------------------------------
// v1.0.3：生效根（自定义根）与标记门禁（规格 §9.2 R-6 / §9.3 / §14.2 H-2..H-16）
// ---------------------------------------------------------------------------

/** 造一个"自定义根"下的条目目录（`<root>/<name>/Default/{Cookies,Preferences}` + Cache） */
function makeEntryInRoot(root, name) {
  const profile = join(root, name)
  mkdirSync(join(profile, 'Default', 'Cache'), { recursive: true })
  mkdirSync(join(profile, 'Default', 'Local Storage'), { recursive: true })
  writeFileSync(join(profile, 'Default', 'Cookies'), 'cookie-value', 'utf8')
  writeFileSync(join(profile, 'Default', 'Preferences'), '{"a":1}', 'utf8')
  writeFileSync(join(profile, 'Default', 'Login Data'), 'login-data', 'utf8')
  writeFileSync(join(profile, 'Default', 'Cache', 'blob'), 'C'.repeat(1024), 'utf8')
  return profile
}

/** 起一个助手并把"自定义根"传进每一次调用（`root` 是可选入参，助手逐次解析） */
function sendWithRoot(helper, id, method, params, root) {
  helper.send({ jsonrpc: '2.0', id, method, params: { ...params, root } })
  return helper.waitFor((r) => r.id === id)
}

test('R-6：自定义根下的体积与清理（只删白名单缓存，Cookies 逐字节不变）', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'obox-webapp-custom-root-'))
  const root = join(cwd, 'custom-profiles')
  const helper = startHelper(cwd)
  try {
    // 先 prepareRoot（写标记）：**根还不存在** ⇒ 第一次必须 created:true；默认根豁免标记，自定义根不豁免
    const prepared = await sendWithRoot(helper, 60, 'prepareRoot', {}, root)
    assert.equal(
      prepared.error,
      undefined,
      `prepareRoot 不得报错：${JSON.stringify(prepared.error)}`
    )
    assert.deepEqual(prepared.result, { root, created: true, marked: true })
    assert.ok(existsSync(join(root, '.obox-webapp-root')), '标记文件必须写出')
    // 幂等：第二次 created:false
    const again = await sendWithRoot(helper, 69, 'prepareRoot', {}, root)
    assert.equal(again.result.created, false)

    const profile = makeEntryInRoot(root, '站点C')

    // 体积：dir 必须指向自定义根
    const size = await sendWithRoot(helper, 61, 'profileSize', { name: '站点C' }, root)
    assert.equal(size.result.exists, true)
    assert.equal(size.result.dir, join(root, '站点C'), 'dir 必须落在自定义根下')
    assert.ok(size.result.bytes > 0)

    const before = sha256(readFileSync(join(profile, 'Default', 'Cookies'), 'utf8'))
    const cleaned = await sendWithRoot(helper, 62, 'cleanCaches', { name: '站点C' }, root)
    assert.equal(cleaned.error, undefined)
    assert.equal(cleaned.result.refused, undefined, '有标记 ⇒ 不得拒绝')
    assert.ok(cleaned.result.cleaned[0].removedDirs.includes('Default/Cache'))
    assert.ok(!existsSync(join(profile, 'Default', 'Cache')), '白名单缓存目录必须被删掉')
    assert.equal(
      sha256(readFileSync(join(profile, 'Default', 'Cookies'), 'utf8')),
      before,
      'Cookies 必须逐字节不变'
    )
    assert.ok(existsSync(join(profile, 'Default', 'Login Data')), 'Login Data 必须保留')
    assert.ok(existsSync(join(profile, 'Default', 'Local Storage')), 'Local Storage 必须保留')
  } finally {
    await helper.close()
    await cleanupDir(cwd)
  }
})

test('缺标记拒删 / 拒清理 / 拒改名（自定义根），且一个字节都没动', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'obox-webapp-unmarked-'))
  const root = join(cwd, 'unmarked-root')
  const profile = makeEntryInRoot(root, '站点U')
  const helper = startHelper(cwd)
  try {
    // 只读操作放行（打开是"写"、量体积是"读"）
    const status = await sendWithRoot(helper, 70, 'profileRootStatus', {}, root)
    assert.equal(status.result.marked, false)
    assert.equal(status.result.unmanaged, true, '自定义根缺标记 ⇒ unmanaged')
    assert.deepEqual(status.result.entries, ['站点U'], 'entries 只回目录名')
    assert.equal(status.error, undefined)

    const size = await sendWithRoot(helper, 71, 'profileSize', { name: '站点U' }, root)
    assert.equal(size.error, undefined, '量体积是只读 ⇒ 缺标记也必须放行（降级原则）')

    const before = sha256(readFileSync(join(profile, 'Default', 'Cookies'), 'utf8'))

    // 删：拒绝（-32603 [profile-root-unmarked]）
    const removed = await sendWithRoot(helper, 72, 'removeProfile', { name: '站点U' }, root)
    assert.equal(removed.error.code, -32603, `删除必须被拒：${JSON.stringify(removed.result)}`)
    assert.match(removed.error.message, /\[profile-root-unmarked\]/)
    assert.match(removed.error.message, /不是本扩展管理的目录/)
    assert.ok(existsSync(profile), '被拒的删除不得动目录')

    // 清理：整体拒绝（**不抛错**，回 refused）
    const cleaned = await sendWithRoot(helper, 73, 'cleanCaches', { name: '站点U' }, root)
    assert.equal(cleaned.error, undefined, '清理被拒必须回结果而不是抛错')
    assert.match(String(cleaned.result.refused), /\[profile-root-unmarked\]/)
    assert.deepEqual(cleaned.result.cleaned, [])
    assert.ok(existsSync(join(profile, 'Default', 'Cache')), '被拒的清理不得动缓存目录')

    // 改名：拒绝（改名会移动数据）
    const moved = await sendWithRoot(
      helper,
      74,
      'moveProfile',
      { from: '站点U', to: '站点U2' },
      root
    )
    assert.equal(moved.error.code, -32603)
    assert.match(moved.error.message, /\[profile-root-unmarked\]/)
    assert.ok(existsSync(profile), '被拒的改名不得动源')
    assert.ok(!existsSync(join(root, '站点U2')), '被拒的改名不得产生目标')

    assert.equal(
      sha256(readFileSync(join(profile, 'Default', 'Cookies'), 'utf8')),
      before,
      '三次被拒的操作之后 Cookies 必须逐字节未变'
    )
  } finally {
    await helper.close()
    await cleanupDir(cwd)
  }
})

test('默认根**豁免**标记校验：删掉标记文件后删除/清理/改名仍然放行', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'obox-webapp-default-exempt-'))
  makeProfile(cwd, '站点D')
  const helper = startHelper(cwd)
  try {
    // 默认根下**没有**标记文件（1.0.2 从未写过）——这正是"默认根天然可信"的场景
    assert.ok(!existsSync(join(cwd, 'chrome', '.obox-webapp-root')), '默认根下本来就没有标记文件')
    const status = await helper.waitFor(
      (() => {
        helper.send({ jsonrpc: '2.0', id: 80, method: 'profileRootStatus', params: {} })
        return (r) => r.id === 80
      })()
    )
    assert.equal(status.result.isDefault, true)
    assert.equal(status.result.unmanaged, false, '默认根永远不算"未受管"')

    // 清理放行
    helper.send({ jsonrpc: '2.0', id: 81, method: 'cleanCaches', params: { name: '站点D' } })
    const cleaned = await helper.waitFor((r) => r.id === 81)
    assert.equal(cleaned.result.refused, undefined, '默认根缺标记也必须放行清理')
    assert.ok(cleaned.result.cleaned[0].removedDirs.length > 0)

    // 改名放行
    helper.send({
      jsonrpc: '2.0',
      id: 82,
      method: 'moveProfile',
      params: { from: '站点D', to: '站点D2' }
    })
    const moved = await helper.waitFor((r) => r.id === 82)
    assert.equal(moved.error, undefined, '默认根缺标记也必须放行改名')
    assert.equal(moved.result.moved, true)

    // 删除放行
    helper.send({ jsonrpc: '2.0', id: 83, method: 'removeProfile', params: { name: '站点D2' } })
    const removed = await helper.waitFor((r) => r.id === 83)
    assert.equal(removed.error, undefined, '默认根缺标记也必须放行删除')
    assert.equal(removed.result.removed, true)
  } finally {
    await helper.close()
    await cleanupDir(cwd)
  }
})

test('「永不删根」：根目录本身永远不是删/移的对象', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'obox-webapp-never-root-'))
  const root = join(cwd, 'keep-root')
  makeEntryInRoot(root, '保留条目')
  writeFileSync(join(root, 'marker.txt'), 'not a profile', 'utf8')
  mkdirSync(join(root, 'not-an-entry'), { recursive: true })
  const helper = startHelper(cwd)
  try {
    // 用尽各种"想删根"的名字：空串 / `.` / `..` / `.trash` / 带分隔符 / 盘符
    for (const [id, name] of [
      [90, ''],
      [91, '.'],
      [92, '..'],
      [93, '.trash'],
      [94, 'a/b'],
      [95, 'C:\\'],
      [96, '..\\..']
    ]) {
      helper.send({ jsonrpc: '2.0', id, method: 'removeProfile', params: { name, root } })
      const bad = await helper.waitFor((r) => r.id === id)
      assert.ok(bad.error, `name=${JSON.stringify(name)} 必须被拒`)
      assert.equal(bad.error.code, -32602, `name=${JSON.stringify(name)} 应是 -32602`)
      helper.responses.length = 0
    }
    assert.ok(existsSync(root), '根目录本身必须仍在')
    assert.ok(existsSync(join(root, 'marker.txt')), '根下的非条目文件必须未被触碰')
    assert.ok(existsSync(join(root, 'not-an-entry')), '根下的非条目目录必须未被触碰')

    // `profileRootStatus.entries` 只回目录、且排除 `.trash`
    mkdirSync(join(root, '.trash'), { recursive: true })
    const status = await sendWithRoot(helper, 97, 'profileRootStatus', {}, root)
    assert.deepEqual(
      status.result.entries,
      ['not-an-entry', '保留条目'],
      'entries 只含目录且排除 .trash'
    )
  } finally {
    await helper.close()
    await cleanupDir(cwd)
  }
})

test('prepareRoot 幂等 + checkRootCandidate 纯只读 + migrateRootDir 三态', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'obox-webapp-migrate-'))
  const root = join(cwd, 'target-root')
  const helper = startHelper(cwd)
  try {
    // prepareRoot：第一次 created，第二次不 created，标记文件仍只有一个
    const first = await sendWithRoot(helper, 100, 'prepareRoot', {}, root)
    assert.deepEqual(first.result, { root, created: true, marked: true })
    const second = await sendWithRoot(helper, 101, 'prepareRoot', {}, root)
    assert.equal(second.result.created, false)
    const markerFiles = readdirSync(root).filter((name) => name === '.obox-webapp-root')
    assert.equal(markerFiles.length, 1)
    assert.deepEqual(
      Object.keys(JSON.parse(readFileSync(join(root, '.obox-webapp-root'), 'utf8'))).sort(),
      ['createdAt', 'extId', 'marker', 'root', 'version'],
      '标记内容字段集合必须恰好五字段'
    )

    // checkRootCandidate：**纯只读**（跑完磁盘上没有任何新增文件）
    const someFile = join(cwd, 'some-file.txt')
    writeFileSync(someFile, 'x', 'utf8')
    const beforeList = readdirSync(cwd).sort()
    const asDir = await helper.waitFor(
      (() => {
        helper.send({
          jsonrpc: '2.0',
          id: 102,
          method: 'checkRootCandidate',
          params: { candidate: someFile }
        })
        return (r) => r.id === 102
      })()
    )
    assert.equal(asDir.result.isDirectory, false, '传文件 ⇒ isDirectory:false（老宿主的降级信号）')
    assert.equal(asDir.result.parent, cwd, 'parent 必须是其父目录')
    assert.equal(asDir.result.invalid, null)

    helper.send({
      jsonrpc: '2.0',
      id: 103,
      method: 'checkRootCandidate',
      params: { candidate: 'cap-relative' }
    })
    const relative = await helper.waitFor((r) => r.id === 103)
    assert.match(String(relative.result.invalid?.reason), /绝对路径/)

    helper.send({
      jsonrpc: '2.0',
      id: 104,
      method: 'checkRootCandidate',
      params: { candidate: 'C:\\' }
    })
    const drive = await helper.waitFor((r) => r.id === 104)
    assert.match(String(drive.result.invalid?.reason), /磁盘根目录/)

    helper.send({
      jsonrpc: '2.0',
      id: 105,
      method: 'checkRootCandidate',
      params: { candidate: '\\\\server\\share\\profiles' }
    })
    const unc = await helper.waitFor((r) => r.id === 105)
    assert.equal(unc.result.kind, 'absolute-unc')
    assert.ok(String(unc.result.warning ?? '').length > 0, 'UNC 必须带性能警告')

    assert.deepEqual(readdirSync(cwd).sort(), beforeList, 'checkRootCandidate 不得写任何东西')

    // migrateRootDir：probe（只读）→ 未确认覆盖 ⇒ skipped → 已确认 ⇒ overwritten
    const fromRoot = join(cwd, 'from-root')
    makeEntryInRoot(fromRoot, '迁移条目')
    makeEntryInRoot(root, '迁移条目') // 目标已有同名 ⇒ 冲突
    const targetMarker = readFileSync(join(root, '迁移条目', 'Default', 'Preferences'), 'utf8')

    const probe = await helper.waitFor(
      (() => {
        helper.send({
          jsonrpc: '2.0',
          id: 110,
          method: 'migrateRootDir',
          params: { from: fromRoot, to: root, name: '迁移条目', action: 'probe' }
        })
        return (r) => r.id === 110
      })()
    )
    assert.equal(probe.result.source.exists, true)
    assert.equal(probe.result.target.exists, true)
    assert.equal(probe.result.conflict, true, '两侧同名 ⇒ conflict')
    assert.equal(probe.result.sameVolume, true)

    // 未确认 ⇒ skipped，**两侧逐字节未变**
    const sourceCookie = sha256(
      readFileSync(join(fromRoot, '迁移条目', 'Default', 'Cookies'), 'utf8')
    )
    const skipped = await helper.waitFor(
      (() => {
        helper.send({
          jsonrpc: '2.0',
          id: 111,
          method: 'migrateRootDir',
          params: { from: fromRoot, to: root, name: '迁移条目', action: 'move' }
        })
        return (r) => r.id === 111
      })()
    )
    assert.equal(skipped.result.status, 'skipped')
    assert.match(skipped.result.reason, /未确认覆盖/)
    assert.equal(skipped.result.targetRemoved, false)
    assert.equal(
      readFileSync(join(root, '迁移条目', 'Default', 'Preferences'), 'utf8'),
      targetMarker,
      '未确认时目标内容必须一字未动'
    )
    assert.equal(
      sha256(readFileSync(join(fromRoot, '迁移条目', 'Default', 'Cookies'), 'utf8')),
      sourceCookie,
      '未确认时源内容必须一字未动'
    )

    // 已确认 ⇒ overwritten：目标旧内容消失、源已删
    const overwritten = await helper.waitFor(
      (() => {
        helper.send({
          jsonrpc: '2.0',
          id: 112,
          method: 'migrateRootDir',
          params: { from: fromRoot, to: root, name: '迁移条目', action: 'move', overwrite: true }
        })
        return (r) => r.id === 112
      })()
    )
    assert.equal(overwritten.result.status, 'overwritten')
    assert.equal(overwritten.result.overwritten, true)
    assert.equal(overwritten.result.targetRemoved, true, '覆盖必须先删目标同名目录')
    assert.equal(
      sha256(readFileSync(join(root, '迁移条目', 'Default', 'Cookies'), 'utf8')),
      sourceCookie,
      '覆盖后目标内容必须等于源内容'
    )
    assert.ok(!existsSync(join(fromRoot, '迁移条目')), '覆盖后源必须已删除')

    // 源与目标都不存在 ⇒ missing（不阻塞整体）
    const missing = await helper.waitFor(
      (() => {
        helper.send({
          jsonrpc: '2.0',
          id: 113,
          method: 'migrateRootDir',
          params: { from: fromRoot, to: root, name: '不存在的条目', action: 'move' }
        })
        return (r) => r.id === 113
      })()
    )
    assert.equal(missing.result.status, 'missing')
  } finally {
    await helper.close()
    await cleanupDir(cwd)
  }
})

test('migrateRootDir：跨卷（forceCopy）先校验后删源；根缺标记的**源**仍然放行', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'obox-webapp-crossvol-'))
  // ⚠️ 源根**故意不写标记**（P3b = A：迁移的源根允许缺标记，否则"手工拷出来的旧根"永远搬不动）
  const fromRoot = join(cwd, 'manual-copy-root')
  const toRoot = join(cwd, 'new-root')
  makeEntryInRoot(fromRoot, '手工搬来的条目')
  mkdirSync(toRoot, { recursive: true })
  const helper = startHelper(cwd)
  try {
    const sourceCookie = sha256(
      readFileSync(join(fromRoot, '手工搬来的条目', 'Default', 'Cookies'), 'utf8')
    )
    const moved = await helper.waitFor(
      (() => {
        helper.send({
          jsonrpc: '2.0',
          id: 120,
          method: 'migrateRootDir',
          params: {
            from: fromRoot,
            to: toRoot,
            name: '手工搬来的条目',
            action: 'move',
            forceCopy: true
          }
        })
        return (r) => r.id === 120
      })()
    )
    assert.equal(moved.result.status, 'done', `跨卷迁移应成功：${moved.result.reason}`)
    assert.equal(moved.result.crossVolume, true)
    assert.equal(
      sha256(readFileSync(join(toRoot, '手工搬来的条目', 'Default', 'Cookies'), 'utf8')),
      sourceCookie,
      '复制后目标内容必须与源逐字节一致'
    )
    assert.ok(
      existsSync(join(toRoot, '手工搬来的条目', 'Default', 'Preferences')),
      '关键文件必须搬全'
    )
    assert.ok(!existsSync(join(fromRoot, '手工搬来的条目')), '校验通过后才允许删源')
    // 源根缺标记**不是**拒绝理由（P3b）
    assert.ok(!existsSync(join(fromRoot, '.obox-webapp-root')), '源根本来就没有标记')
  } finally {
    await helper.close()
    await cleanupDir(cwd)
  }
})

test('root 入参校验：相对路径 / 盘符根 ⇒ -32602 [profile-root-invalid]', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'obox-webapp-root-invalid-'))
  const helper = startHelper(cwd)
  try {
    for (const [id, root] of [
      [130, 'chrome'],
      [131, 'C:\\'],
      [132, 'profiles\\x'],
      [133, '\\\\server\\share']
    ]) {
      helper.send({
        jsonrpc: '2.0',
        id,
        method: 'profileRootStatus',
        params: { root }
      })
      const bad = await helper.waitFor((r) => r.id === id)
      assert.ok(bad.error, `root=${root} 必须被拒`)
      assert.equal(bad.error.code, -32602, `root=${root} 应是 -32602`)
      assert.match(bad.error.message, /\[profile-root-invalid\]/)
      helper.responses.length = 0
    }
    // 合法自定义根（不存在的目录也算合法：V7 允许创建）
    helper.send({
      jsonrpc: '2.0',
      id: 134,
      method: 'profileRootStatus',
      params: { root: join(cwd, 'not-created-yet') }
    })
    const okRoot = await helper.waitFor((r) => r.id === 134)
    assert.equal(okRoot.error, undefined)
    assert.equal(okRoot.result.exists, false)
    assert.equal(okRoot.result.isDefault, false)
  } finally {
    await helper.close()
    await cleanupDir(cwd)
  }
})

test('launch 的 --user-data-dir 两种形态：默认根相对、自定义根绝对（其它绝对路径一律拒）', async () => {
  const cwd = mkdtempSync(join(tmpdir(), 'obox-webapp-udd-'))
  const root = join(cwd, 'my-root')
  mkdirSync(root, { recursive: true })
  const helper = startHelper(cwd)
  try {
    // 形态非法（绝对但不在生效根内）⇒ -32602，且**不得**真的去 spawn Chrome
    helper.send({
      jsonrpc: '2.0',
      id: 140,
      method: 'launch',
      params: {
        args: ['--app=https://a/', `--user-data-dir=${join(cwd, 'other-root', 'x')}`],
        root
      }
    })
    const bad = await helper.waitFor((r) => r.id === 140)
    assert.equal(bad.error.code, -32602)
    assert.match(bad.error.message, /只允许 chrome\/<单层目录名> 形态/)

    // 相对形态 + 自定义根：相对形态一律解析为 `chrome/<名>`（生效根只影响绝对形态）
    helper.send({
      jsonrpc: '2.0',
      id: 141,
      method: 'launch',
      params: { args: ['--app=https://a/', '--user-data-dir=chrome/x', '--proxy-server=p'], root }
    })
    const forbidden = await helper.waitFor((r) => r.id === 141)
    assert.equal(forbidden.error.code, -32602)
    assert.match(forbidden.error.message, /不接受参数 --proxy-server/)
  } finally {
    await helper.close()
    await cleanupDir(cwd)
  }
})
