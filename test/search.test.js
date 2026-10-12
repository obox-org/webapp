/**
 * 模糊搜索的单测（`src/search.js` 是纯函数，零依赖，直接 `node --test`）。
 *
 * 覆盖规格 `docs/spec/amendments/06-search-box.md` 的每一条语义：
 * 子序列命中 / 大小写不敏感 / 前缀与连续片段加权更高 / 中文与 URL /
 * 多词 AND / 空查询返回全部且保序 / 空白与首尾空格。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  filterAndRank,
  isSearching,
  isWordStart,
  parseQuery,
  scoreEntry,
  scoreTerm
} from '../src/search.js'

/** 造条目 */
const entry = (name, url = '', desc = '') => ({ id: name, name, url, desc })

const ROWS = [
  entry('内网-运维平台', 'https://10.0.0.5:8443', '生产环境，别乱点'),
  entry('Intranet', 'http://intranet.local/', '办公网门户'),
  entry('GitLab', 'https://gitlab.example.com/', '代码托管'),
  entry('Google', 'https://www.google.com/search', '搜索引擎'),
  entry('维基百科', 'https://zh.wikipedia.org/', '参考资料')
]

const names = (rows) => rows.map((row) => row.name)

test('parseQuery：按空白拆词、去空段、转小写、去首尾空格', () => {
  assert.deepEqual(parseQuery('  Foo   Bar  '), ['foo', 'bar'])
  assert.deepEqual(parseQuery(''), [])
  assert.deepEqual(parseQuery('   '), [])
  assert.deepEqual(parseQuery(null), [])
  assert.deepEqual(parseQuery(123), ['123'])
  assert.deepEqual(parseQuery('\tA\nb '), ['a', 'b'])
})

test('isSearching：只有纯空白不算在搜索', () => {
  assert.equal(isSearching(''), false)
  assert.equal(isSearching('   '), false)
  assert.equal(isSearching(null), false)
  assert.equal(isSearching('a'), true)
})

test('子序列命中：字符按顺序出现即命中（不要求连续）', () => {
  // "gtlb" 是 "gitlab" 的子序列
  assert.equal(scoreTerm('gitlab', 'gtlb').matched, true)
  // 顺序不对 → 不命中
  assert.equal(scoreTerm('gitlab', 'bltg').matched, false)
  // 缺字符 → 不命中
  assert.equal(scoreTerm('gitlab', 'gitlbs').matched, false)
  // 单字符
  assert.equal(scoreTerm('gitlab', 'g').matched, true)
})

test('大小写不敏感（界面侧传小写词，scoreTerm 也接受任意大小写字段）', () => {
  const lower = scoreEntry(entry('GitLab'), ['gitlab'])
  const upper = scoreEntry(entry('GitLab'), ['GITLAB'.toLowerCase()])
  assert.ok(lower > 0)
  assert.equal(lower, upper)
  // 通过 filterAndRank 走完整链路：大写查询命中小写条目
  assert.deepEqual(names(filterAndRank(ROWS, 'GITLAB')), ['GitLab'])
  assert.deepEqual(names(filterAndRank(ROWS, 'intranet')), ['Intranet'])
})

test('加权：整串包含 > 前缀 > 词首 > 离散子序列', () => {
  // 同一字段上的四种命中方式
  const substring = scoreTerm('xgitlab', 'gitlab').score
  const prefix = scoreTerm('gitlabx', 'gitlab').score
  const wordStart = scoreTerm('my-gitlab', 'gitlab').score
  const subsequence = scoreTerm('g1i2t3l4a5b', 'gitlab').score
  assert.ok(prefix > substring, `前缀(${prefix}) 应高于普通包含(${substring})`)
  assert.ok(wordStart > substring, `词首(${wordStart}) 应高于普通包含(${substring})`)
  assert.ok(substring > subsequence, `连续包含(${substring}) 应高于离散子序列(${subsequence})`)
  assert.ok(prefix > subsequence)
})

test('加权：离散子序列里越紧凑得分越高', () => {
  const tight = scoreTerm('gitlabxx', 'gtlb').score
  const loose = scoreTerm('g-x-x-t-x-x-l-x-x-b', 'gtlb').score
  assert.ok(tight > loose, `紧凑(${tight}) 应高于离散(${loose})`)
})

test('isWordStart：分隔符与驼峰边界都算词首', () => {
  assert.equal(isWordStart('gitlab', 0), true)
  assert.equal(isWordStart('my-gitlab', 3), true, '- 之后是词首')
  assert.equal(isWordStart('my_gitlab', 3), true, '_ 之后是词首')
  assert.equal(isWordStart('a/b', 2), true, '/ 之后是词首')
  assert.equal(isWordStart('myGitLab', 2), true, '驼峰 G 是词首')
  assert.equal(isWordStart('mygitlab', 2), false, '普通字母位置不是词首')
})

test('三个字段分别打分取最优：name / url / desc 任一命中即可', () => {
  const byName = entry('GitLab', 'https://x.example/', 'y')
  const byUrl = entry('甲', 'https://gitlab.example.com/', 'y')
  const byDesc = entry('甲', 'https://x.example/', '内部 gitlab 镜像')
  assert.ok(scoreEntry(byName, ['gitlab']) > 0)
  assert.ok(scoreEntry(byUrl, ['gitlab']) > 0)
  assert.ok(scoreEntry(byDesc, ['gitlab']) > 0)
  // 名字命中比 URL 命中分高（取最优而不是相加，所以同一词只算一次）
  assert.ok(scoreEntry(byName, ['gitlab']) > scoreEntry(byUrl, ['gitlab']))
  // 三处都不命中
  assert.equal(scoreEntry(entry('甲', 'https://x/', 'y'), ['gitlab']), 0)
})

test('中文命中：整串、前缀、子序列都成立', () => {
  assert.ok(scoreEntry(entry('内网-运维平台'), ['运维']) > 0)
  assert.ok(scoreEntry(entry('内网-运维平台'), ['内网']) > 0, '前缀命中')
  assert.ok(scoreEntry(entry('内网-运维平台'), ['内运平']) > 0, '子序列命中')
  assert.equal(scoreEntry(entry('内网-运维平台'), ['外网']), 0)
  assert.deepEqual(names(filterAndRank(ROWS, '运维')), ['内网-运维平台'])
})

test('URL 命中：域名与路径都能搜到', () => {
  assert.deepEqual(names(filterAndRank(ROWS, 'gitlab.example.com')), ['GitLab'])
  assert.deepEqual(names(filterAndRank(ROWS, 'wikipedia')), ['维基百科'])
  assert.deepEqual(names(filterAndRank(ROWS, 'https://10.0.0.5')), ['内网-运维平台'])
  assert.deepEqual(names(filterAndRank(ROWS, 'search')), ['Google'])
})

test('说明字段命中', () => {
  assert.deepEqual(names(filterAndRank(ROWS, '生产环境')), ['内网-运维平台'])
  assert.deepEqual(names(filterAndRank(ROWS, '代码托管')), ['GitLab'])
})

test('多词 AND：所有词都要命中（可以落在不同字段）', () => {
  // "gitlab" 在 name、"托管" 在 desc
  assert.deepEqual(names(filterAndRank(ROWS, 'gitlab 托管')), ['GitLab'])
  // 一个词命中不了 → 整条排除
  assert.deepEqual(names(filterAndRank(ROWS, 'gitlab 不存在的词')), [])
  // 两个词都在 URL 里
  assert.deepEqual(names(filterAndRank(ROWS, 'example gitlab')), ['GitLab'])
})

test('空查询 / 纯空白 → 返回全部且**不改变原顺序**', () => {
  const original = names(ROWS)
  for (const query of ['', '   ', '\t', null, undefined]) {
    const result = filterAndRank(ROWS, query)
    assert.deepEqual(names(result), original, `查询 ${JSON.stringify(query)} 应原序返回全部`)
  }
  // 必须是新数组（调用方可以放心再排序/反转，不会改到源数组）
  const result = filterAndRank(ROWS, '')
  assert.notEqual(result, ROWS)
  assert.deepEqual(names(ROWS), original, '源数组不得被修改')
})

test('排序：按分数降序，多条命中时分数高的在前', () => {
  // ⚠️ 注意用词：`gtlb-x` **不是** `gitlab` 的子序列（缺 `i`），所以它不命中——
  // 想造"离散子序列"的对照，必须让查询字符真的**按顺序**都能在候选里找到。
  const rows = [
    entry('x-gitlab'),
    entry('gitlab'),
    entry('my gitlab page'),
    entry('g-i-t-l-a-b') // `gitlab` 是它的子序列（字符按序出现，但不连续）
  ]
  const ranked = names(filterAndRank(rows, 'gitlab'))
  assert.equal(ranked.length, 4, `四条都应命中：${ranked.join(' > ')}`)
  assert.equal(ranked[0], 'gitlab', `前缀命中应排第一：${ranked.join(' > ')}`)
  assert.equal(
    ranked[ranked.length - 1],
    'g-i-t-l-a-b',
    `离散子序列应排最后：${ranked.join(' > ')}`
  )
  // 分数关系（用分数断言，不依赖具体名次）
  assert.ok(
    scoreEntry(entry('x-gitlab'), ['gitlab']) > scoreEntry(entry('g-i-t-l-a-b'), ['gitlab']),
    '连续命中必须严格高于离散子序列命中'
  )
  assert.ok(
    scoreEntry(entry('gitlab'), ['gitlab']) > scoreEntry(entry('x-gitlab'), ['gitlab']),
    '前缀命中必须严格高于普通包含'
  )
})

test('子序列匹配的判据是"严格按顺序"，不是"凑齐字母"', () => {
  // 反例：`gitlab` 缺 `i`（`gtlb-x` 里没有 i）→ 不命中
  assert.equal(scoreEntry(entry('gtlb-x'), ['gitlab']), 0)
  // 正例：字符按顺序都在（`g-i-t-l-a-b` 里 `gitlab` 是子序列）
  assert.ok(scoreEntry(entry('g-i-t-l-a-b'), ['gitlab']) > 0)
  // 反例：顺序颠倒不算
  assert.equal(scoreEntry(entry('balgit'), ['gitlab']), 0)
  // 反例：缺一个字符不算
  assert.equal(scoreEntry(entry('gitlb'), ['gitlab']), 0)
  // 但更短的查询可以命中：`gitlb` 是 `gitlab` 的子序列
  assert.ok(scoreEntry(entry('gitlab'), ['gitlb']) > 0)
})

test('排序：同分保持原序（稳定）', () => {
  const rows = [
    entry('alpha', 'https://a/'),
    entry('bravo', 'https://b/'),
    entry('charlie', 'https://c/')
  ]
  // 三个词分别只命中一条，但用同一个查询词让它们同分：都只在 url 里出现 "https"
  const ranked = names(filterAndRank(rows.slice().reverse(), 'https'))
  assert.deepEqual(ranked, ['charlie', 'bravo', 'alpha'], '同分必须保持输入顺序')
})

test('无匹配 → 返回空数组（界面据此显示"无匹配"空态）', () => {
  assert.deepEqual(filterAndRank(ROWS, 'zzzzz'), [])
  assert.deepEqual(filterAndRank(ROWS, '内网 zzz'), [], '一个词不命中就整条排除')
  assert.deepEqual(filterAndRank([], 'gitlab'), [])
})

test('非数组输入与缺字段条目都不抛错（界面可能拿到脏数据）', () => {
  assert.deepEqual(filterAndRank(null, 'x'), [])
  assert.deepEqual(filterAndRank(undefined, 'x'), [])
  assert.equal(scoreEntry(null, ['x']), 0)
  assert.equal(scoreEntry({}, ['x']), 0)
  assert.equal(scoreEntry({ name: 'x' }, ['x']) > 0, true)
  assert.equal(scoreEntry({ name: 'x' }, []), 0)
})

test('搜索不修改条目对象（只读展示字段）', () => {
  const rows = [entry('GitLab', 'https://gitlab.example.com/', '代码托管')]
  const snapshot = JSON.stringify(rows)
  filterAndRank(rows, 'gitlab')
  scoreEntry(rows[0], ['gitlab'])
  assert.equal(JSON.stringify(rows), snapshot, '条目对象不得被修改')
})
