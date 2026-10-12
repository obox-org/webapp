/**
 * 名称净化与 Windows 目录名的单测（规格 §18.1 的 `test/nameSanitize.test.js` 表逐例）。
 *
 * 关键口径（规格 S1 的裁定）：
 * - 非法字符替换为 `-`，**连续非法字符合并成一个 `-`**；
 * - 大小写原样保留（`Intranet` 就是 `Intranet`）；
 * - 保留名按"第一个 `.` 之前的基名"比较（`CON.txt` 也算保留名）；
 * - 长度预算 = `<profileRoot>\<name>` ≤ 240 个字符（规格 §12.3）。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MAX_PATH_LENGTH,
  PATH_SEPARATOR,
  PROFILE_ROOT,
  assertNameLength,
  isReservedName,
  nameKey,
  sanitizeName,
  suggestName,
  truncateToBudget
} from '../lib/nameSanitize.mjs'

test('sanitizeName：非法字符合并成一个 `-`（不是逐个替换）', () => {
  assert.equal(sanitizeName('a\\b/c:d*e?f"g<h>i|j'), 'a-b-c-d-e-f-g-h-i-j')
  // 连续非法字符 → 只留一个 `-`（规格 S1：合并，避免 `a\\\\b` 变成 `----`）
  assert.equal(sanitizeName('a\\\\b'), 'a-b')
  assert.equal(sanitizeName('a<>|b'), 'a-b')
  assert.equal(sanitizeName('a\\/b'), 'a-b')
  // 合法字符原样保留（含中文、连字符、下划线、空格、括号）
  assert.equal(sanitizeName('内网-运维平台'), '内网-运维平台')
  assert.equal(sanitizeName('My_App (prod)'), 'My_App (prod)')
  // 大小写不敏感的唯一性由 webapp.mjs 负责，这里**不做**任何大小写改写
  assert.equal(sanitizeName('Intranet'), 'Intranet')
})

test('sanitizeName：去掉尾部的点与空格', () => {
  assert.equal(sanitizeName('名.'), '名')
  assert.equal(sanitizeName('名 '), '名')
  assert.equal(sanitizeName('名 . '), '名')
  assert.equal(sanitizeName('名...'), '名')
  // 中间的点与空格不动（只有尾部才非法）
  assert.equal(sanitizeName('a.b c'), 'a.b c')
})

test('sanitizeName：全非法字符 → 空串（由上层给出建议名）', () => {
  assert.equal(sanitizeName('<>|'), '')
  assert.equal(sanitizeName('   '), '')
  assert.equal(sanitizeName(''), '')
  assert.equal(sanitizeName(null), '')
})

test('isReservedName：CON/PRN/AUX/NUL/COM1-9/LPT1-9（不分大小写、含扩展名形式）', () => {
  for (const name of [
    'CON',
    'con',
    'Con',
    'PRN',
    'AUX',
    'NUL',
    'COM1',
    'COM9',
    'LPT1',
    'LPT9',
    'CON.txt',
    'nul.log'
  ]) {
    assert.equal(isReservedName(name), true, `${name} 应判为保留名`)
  }
  for (const name of ['CONSOLE', 'COM', 'COM10', 'LPT', 'LPT0', 'NUL2', '我的站点', 'intranet']) {
    assert.equal(isReservedName(name), false, `${name} 不该判为保留名`)
  }
})

test('assertNameLength：连路径 ≤ 240 个字符（240 通过 / 241 报错）', () => {
  const budget = MAX_PATH_LENGTH - PROFILE_ROOT.length - PATH_SEPARATOR.length // 240 - 6 - 1 = 233
  const okName = 'a'.repeat(budget)
  const tooLong = 'a'.repeat(budget + 1)

  assert.equal(assertNameLength(okName).ok, true, `chrome\\<${budget} 个字符> 应为 240，需通过`)
  const failed = assertNameLength(tooLong)
  assert.equal(failed.ok, false, '241 个字符必须报错')
  assert.match(failed.message, /名称过长（连路径最多 240 个字符）/)

  // 自定义 profileRoot / maxLength 也走同一算式
  assert.equal(assertNameLength('abcdef', { profileRoot: 'R', maxLength: 8 }).ok, true)
  assert.equal(assertNameLength('abcdef', { profileRoot: 'R', maxLength: 7 }).ok, false)
})

test('truncateToBudget：截断到预算内（边界不外溢）', () => {
  const budget = MAX_PATH_LENGTH - PROFILE_ROOT.length - PATH_SEPARATOR.length
  assert.equal(truncateToBudget('x'.repeat(budget + 50)).length, budget)
  assert.equal(truncateToBudget('short').length, 5)
  assert.equal(truncateToBudget('abc', { profileRoot: '', maxLength: 0 }), '')
  assert.equal(truncateToBudget('abc', { profileRoot: 'x'.repeat(300) }), '')
})

test('suggestName：每个错误场景都给非空建议名，且建议名自身可用（一致性）', () => {
  const cases = [
    { input: '<>|', why: '净化后为空' },
    { input: 'CON', why: '保留名' },
    { input: 'con.txt', why: '保留名（带扩展名）' },
    { input: 'a<b', why: '含非法字符' },
    { input: '名字 ', why: '尾部空格' },
    { input: '名字.', why: '尾部点' },
    { input: 'x'.repeat(300), why: '超长' }
  ]
  for (const { input, why } of cases) {
    const suggestion = suggestName(input)
    assert.ok(suggestion.length > 0, `${why}：建议名不得为空`)
    // 自身一致性：建议名再净化一次仍可用、不超预算、不是保留名、不以点或空格结尾
    const cleaned = sanitizeName(suggestion)
    assert.ok(cleaned.length > 0, `${why}：建议名净化后为空（${suggestion}）`)
    assert.equal(isReservedName(cleaned), false, `${why}：建议名仍是保留名（${suggestion}）`)
    assert.ok(!/[. ]$/.test(cleaned), `${why}：建议名仍以点或空格结尾（${suggestion}）`)
    assert.equal(assertNameLength(cleaned).ok, true, `${why}：建议名超出长度预算（${suggestion}）`)
    // 建议名必须与原名不同（否则"建议"没有意义）
    assert.notEqual(cleaned, input, `${why}：建议名与原名相同（${suggestion}）`)
  }
})

test('nameKey：大小写不敏感的比较键（中文名原样）', () => {
  assert.equal(nameKey('Intranet'), nameKey('intranet'))
  assert.equal(nameKey('INTRANET'), nameKey('Intranet'))
  assert.equal(nameKey(' 内网 '), '内网')
  assert.notEqual(nameKey('内网'), nameKey('外网'))
})
