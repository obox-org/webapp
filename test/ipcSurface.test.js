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

test('正向：src 调用的每个方法，index.js 都必须分发（否则界面会拿到"未知方法"）', () => {
  const called = calledMethods()
  const dispatched = dispatchedMethods()
  assert.ok(called.length >= 6, `src 里至少应调用 6 个方法，实际识别到 ${called.length}：${called}`)
  const missing = called.filter((method) => !dispatched.includes(method))
  assert.deepEqual(missing, [], `index.js 未分发这些被界面调用的方法：${missing.join('、')}`)
})

test('反向：index.js 分发的每个方法，src 里都应有调用点（不是死代码）', () => {
  const called = calledMethods()
  const dispatched = dispatchedMethods()
  const dead = dispatched.filter((method) => !called.includes(method))
  assert.deepEqual(dead, [], `这些方法被实现但没有界面调用点：${dead.join('、')}`)
})

test('方法集合与规格 §11.1 一致（恰好 8 个，不多不少）', () => {
  assert.deepEqual(dispatchedMethods(), [
    'cleanCaches',
    'list',
    'open',
    'probe',
    'profileInfo',
    'profileSize',
    'remove',
    'save'
  ])
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
