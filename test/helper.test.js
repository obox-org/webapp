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
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
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
