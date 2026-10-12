/**
 * 打包门禁（规格 §20.1；`test/pack.test.js`）。
 *
 * 为什么必须单测：`pack.mjs` 是"哪些文件会进用户机器"的唯一决定点，
 * 一旦白名单失手把 `data/` 打进去，宿主安装器会**直接拒绝**整包（`forbidden-entry`）；
 * 一旦把 `src/` 或 `node_modules/` 打进去，包体积会失控。
 *
 * 这里**不真的跑 pack**（那会写 `out/`），而是把 `pack.mjs` 的白名单/排除清单读出来做断言，
 * 再对**当前工作区**跑一遍收集逻辑，验证"现在我们这份源码能产出干净包"。
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

const root = fileURLToPath(new URL('..', import.meta.url))
const packSource = readFileSync(join(root, 'scripts', 'pack.mjs'), 'utf8')

/** 从源码里取出两个清单（`const INCLUDE = [...]` / `const EXCLUDE_DIRS = new Set([...])`） */
function listLiteral(name) {
  const match = packSource.match(new RegExp(`${name}\\s*=\\s*(?:new Set\\()?\\[([\\s\\S]*?)\\]`))
  assert.ok(match, `pack.mjs 里找不到 ${name}`)
  return [...match[1].matchAll(/'([^']+)'/g)].map((item) => item[1])
}

const INCLUDE = listLiteral('INCLUDE')
const EXCLUDE_DIRS = listLiteral('EXCLUDE_DIRS')
const REQUIRED = listLiteral('REQUIRED')
const REQUIRED_LIB = listLiteral('REQUIRED_LIB')

test('白名单包含必须分发的五类文件', () => {
  for (const entry of ['manifest.json', 'index.js', 'helper.cjs', 'lib', 'ui']) {
    assert.ok(INCLUDE.includes(entry), `INCLUDE 缺少 ${entry}`)
  }
})

test('排除清单必须含 data/、out/、node_modules/、src/、.git/', () => {
  for (const entry of ['data', 'out', 'node_modules', 'src', '.git']) {
    assert.ok(EXCLUDE_DIRS.includes(entry), `EXCLUDE_DIRS 缺少 ${entry}`)
  }
})

test('必须存在的分发文件与库模块清单非空且合理', () => {
  assert.deepEqual(REQUIRED, ['manifest.json', 'index.js', 'helper.cjs'])
  for (const rel of REQUIRED_LIB) {
    assert.ok(rel.startsWith('lib/'), `${rel} 应位于 lib/`)
    assert.ok(existsSync(join(root, rel)), `${rel} 在仓库里不存在`)
  }
  // 四个库模块都在（index.js / helper.cjs 会加载它们）
  for (const rel of [
    'lib/webapp.mjs',
    'lib/chromeArgs.mjs',
    'lib/nameSanitize.mjs',
    'lib/profileLimit.mjs'
  ]) {
    assert.ok(REQUIRED_LIB.includes(rel), `REQUIRED_LIB 缺少 ${rel}`)
  }
})

test('源码里有硬闸门：包内出现 data/ 或 src/ 条目即抛错', () => {
  assert.match(packSource, /产物含 data\/ 条目/, '必须有"包内无 data/"的自检')
  assert.match(packSource, /拒绝打包：条目 .* 落在排除目录/, '必须有"条目落在排除目录"的硬闸门')
  assert.match(packSource, /EOCD/, '必须有 EOCD 回读自检')
  assert.match(packSource, /条目数不一致/, '必须有条目数自检')
})

/** 复刻 pack.mjs 的收集逻辑（同一份规则，避免"测试与实现各写一套"） */
function collect(rel) {
  const abs = join(root, rel)
  if (!existsSync(abs)) return []
  const info = statSync(abs)
  if (info.isFile()) return [rel]
  const found = []
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    if (EXCLUDE_DIRS.includes(entry.name)) continue
    found.push(...collect(`${rel}/${entry.name}`))
  }
  return found
}

test('按当前工作区收集：产出里没有任何 data/ 或 src/ 条目', () => {
  const entries = [...new Set(INCLUDE.flatMap((rel) => collect(rel)))]
  for (const entryName of entries) {
    const first = entryName.split('/')[0]
    assert.ok(first !== 'data', `收集到了 data/ 条目：${entryName}`)
    assert.ok(first !== 'src', `收集到了 src/ 条目：${entryName}`)
    assert.ok(first !== 'node_modules', `收集到了 node_modules/ 条目：${entryName}`)
    assert.ok(first !== 'out', `收集到了 out/ 条目：${entryName}`)
    assert.ok(first !== 'test', `收集到了 test/ 条目：${entryName}`)
    assert.ok(first !== 'scripts', `收集到了 scripts/ 条目：${entryName}`)
  }
  // 五类必需文件都要收集到
  for (const entry of ['manifest.json', 'index.js', 'helper.cjs']) {
    assert.ok(entries.includes(entry), `收集结果缺少 ${entry}`)
  }
  assert.ok(entries.includes('lib/webapp.mjs'), '收集结果缺少 lib/webapp.mjs')
})

test('产物中不得出现"存在某个锁文件即判定被占用"这类注释/代码（Windows 上不存在 POSIX 锁文件）', () => {
  // ⚠️ **不能**直接搜 "SingletonLock"：`helper.cjs` 的注释里必须写出这个名字才能说明
  // "Windows 上不存在它"（写清反面事实正是这道门禁的目的）。因此这里搜的是
  // **把锁文件当判据**的两种危险写法。
  const dangerPatterns = [
    /SingletonLock'\s*\)\s*\{/,
    /existsSync\([^)]*SingletonLock/,
    /lstatSync\([^)]*SingletonLock/,
    /readFileSync\([^)]*SingletonLock/
  ]
  const entries = [...new Set(INCLUDE.flatMap((rel) => collect(rel)))]
  for (const entryName of entries) {
    if (!/\.(js|mjs|cjs)$/.test(entryName)) continue
    const text = readFileSync(join(root, entryName), 'utf8')
    for (const pattern of dangerPatterns) {
      assert.ok(
        !pattern.test(text),
        `${entryName} 把锁文件当成了占用判据（${pattern}）：判据必须靠 rename/删除的成败`
      )
    }
  }
})

test('package.json 的 scripts 齐备（dev/build/test/pack/release）', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  for (const name of ['dev', 'build', 'test', 'pack', 'release']) {
    assert.ok(pkg.scripts?.[name], `package.json 缺少 scripts.${name}`)
  }
  assert.equal(pkg.type, 'module')
})
