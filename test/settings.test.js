/**
 * R17 设置项与缓存白名单的门禁（规格 §18.1 的 `test/settings.test.js`）。
 *
 * 两份清单是**安全边界**：
 * - `CACHE_DIR_NAMES`（白名单）决定"什么会被删"；
 * - `PROTECTED_DIR_NAMES`（保留清单）决定"什么绝不能删"。
 * 这里把两者的**逐项内容、互斥性、深度语义**全部钉死——它们是删除路径的唯一判据。
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { test } from 'node:test'
import {
  CACHE_DIR_NAMES,
  CACHE_SCAN_DEPTH,
  DEFAULT_DISK_CACHE_MB,
  DEFAULT_PROFILE_LIMIT_MB,
  DISK_CACHE_MB_VALUES,
  MAX_DISK_CACHE_BYTES,
  PROFILE_LIMIT_MB_VALUES,
  PROFILE_SIZE_TTL_MS,
  PROTECTED_DIR_NAMES,
  SETTING_KEYS,
  checkProfileLimit,
  classifyCachePath,
  diskCacheSizeArg,
  formatBytes,
  isCacheDirName,
  isLimitDisabled,
  isProfileSizeCacheValid,
  isProtectedDirName,
  mbToBytes,
  normalizeDiskCacheMb,
  normalizeProfileLimitMb,
  overLimitText
} from '../lib/profileLimit.mjs'

test('缓存白名单恰好 10 项，且与实测结论一致', () => {
  assert.deepEqual(
    [...CACHE_DIR_NAMES],
    [
      'Cache',
      'Code Cache',
      'GPUCache',
      'GrShaderCache',
      'ShaderCache',
      'DawnGraphiteCache',
      'DawnWebGPUCache',
      'Crashpad',
      'BrowserMetrics',
      'optimization_guide_model_store'
    ]
  )
  assert.equal(CACHE_SCAN_DEPTH, 2)
})

test('缓存白名单与保留清单**交集必须为空**（否则白名单能删掉登录态）', () => {
  const cacheKeys = new Set(CACHE_DIR_NAMES.map((name) => name.toLowerCase()))
  const overlap = PROTECTED_DIR_NAMES.filter((name) => cacheKeys.has(name.toLowerCase()))
  assert.deepEqual(overlap, [], `白名单与保留清单不得有交集：${overlap.join('、')}`)
})

test('保留清单覆盖规格 §14.5 点名的每一项', () => {
  const required = [
    'Cookies',
    'Cookies-journal',
    'Login Data',
    'Login Data For Account',
    'Web Data',
    'Local Storage',
    'Session Storage',
    'IndexedDB',
    'Service Worker',
    'CacheStorage',
    'Preferences',
    'Secure Preferences',
    'History',
    'Bookmarks',
    'Favicons',
    'Extensions',
    'Local Extension Settings',
    'Sync Data',
    'Network'
  ]
  for (const name of required) {
    assert.ok(isProtectedDirName(name), `保留清单缺少 ${name}`)
  }
})

test('classifyCachePath：白名单项 clean=true，保留清单项一律 clean=false', () => {
  for (const name of CACHE_DIR_NAMES) {
    assert.equal(classifyCachePath(name).clean, true, `${name} 应可清理`)
    assert.equal(classifyCachePath(`Default/${name}`).clean, true, `Default/${name} 应可清理`)
  }
  for (const name of PROTECTED_DIR_NAMES) {
    const verdict = classifyCachePath(`Default/${name}`)
    assert.equal(verdict.clean, false, `${name} 绝不可清理（${verdict.reason}）`)
  }
})

test('classifyCachePath：黑名单断言（这些路径命中即测试失败）', () => {
  const forbidden = [
    'Default/Cookies',
    'Default/Cookies-journal',
    'Default/Network/Cookies',
    'Default/Network/Cookies-journal',
    'Default/Login Data',
    'Default/Web Data',
    'Default/Local Storage',
    'Default/IndexedDB',
    'Default/Session Storage',
    'Default/Preferences',
    'Default/Secure Preferences',
    'Default/History',
    'Default/Bookmarks',
    'Default/Favicons',
    'Default/Service Worker',
    'Default/Service Worker/CacheStorage',
    'Default/Extensions',
    'Default/Local Extension Settings',
    'Default/Sync Data',
    'Local State'
  ]
  for (const path of forbidden) {
    const verdict = classifyCachePath(path)
    assert.equal(verdict.clean, false, `${path} 必须被拒绝，但被判为可清理`)
    assert.ok(verdict.reason, `${path} 被拒绝时必须给出原因`)
  }
})

test('classifyCachePath：大小写不敏感，但深度与路径形态严格', () => {
  assert.equal(classifyCachePath('cache').clean, true, '目录名匹配必须大小写不敏感')
  assert.equal(classifyCachePath('Default/CODE CACHE').clean, true)
  assert.equal(classifyCachePath('Default/Local Storage/Cache').clean, false, '深度 3 不得清理')
  assert.equal(classifyCachePath('Default/Service Worker/CacheStorage/Cache').clean, false)
  assert.equal(classifyCachePath('a/b/c').clean, false)
  assert.equal(classifyCachePath('../Cache').clean, false, '.. 不得清理')
  assert.equal(classifyCachePath('Default/../Cache').clean, false)
  assert.equal(classifyCachePath('').clean, false)
  assert.equal(classifyCachePath(null).clean, false)
})

test('classifyCachePath：名字含 cache 但不在白名单的目录一律不动（禁止启发式）', () => {
  for (const name of ['MyCache', 'cache2', 'CacheStorage', 'Cache_dir', 'CacheBackup']) {
    assert.equal(classifyCachePath(name).clean, false, `${name} 不得因"名字像缓存"被删`)
  }
})

test('设置键与档位：与 manifest 的 contributes.settings 同源', () => {
  assert.deepEqual(SETTING_KEYS, {
    profileLimitMb: 'webapp.profileLimitMb',
    diskCacheMb: 'webapp.diskCacheMb'
  })
  assert.deepEqual([...PROFILE_LIMIT_MB_VALUES], ['0', '512', '1024', '2048', '4096', '8192'])
  assert.deepEqual([...DISK_CACHE_MB_VALUES], ['-1', '0', '128', '512', '1024'])
  assert.equal(DEFAULT_PROFILE_LIMIT_MB, 2048, '默认 2 GB')
  assert.equal(DEFAULT_DISK_CACHE_MB, -1, '默认禁用磁盘 HTTP 缓存')
})

test('归一：不在档位内 / 非数字 / 负数一律回落默认值并标记 fellBack', () => {
  assert.deepEqual(normalizeProfileLimitMb('2048'), { mb: 2048, fellBack: false })
  assert.deepEqual(normalizeProfileLimitMb(4096), { mb: 4096, fellBack: false })
  for (const bad of ['9999', '2048.5', 'abc', '', null, undefined, -1, {}, []]) {
    const result = normalizeProfileLimitMb(bad)
    assert.equal(result.mb, DEFAULT_PROFILE_LIMIT_MB, `${JSON.stringify(bad)} 应回落 2048`)
    assert.equal(result.fellBack, true)
  }
  assert.deepEqual(normalizeDiskCacheMb('-1'), { mb: -1, fellBack: false })
  assert.deepEqual(normalizeDiskCacheMb('512'), { mb: 512, fellBack: false })
  for (const bad of ['-2', '999', 'abc', '', null]) {
    assert.equal(normalizeDiskCacheMb(bad).mb, DEFAULT_DISK_CACHE_MB)
  }
})

test('mbToBytes：MB → 字节', () => {
  assert.equal(mbToBytes(2048), 2 * 1024 * 1024 * 1024)
  assert.equal(mbToBytes(512), 536870912)
  assert.equal(mbToBytes(0), 0)
  assert.equal(mbToBytes(-1), 0)
  assert.equal(mbToBytes('abc'), 0)
})

test('diskCacheSizeArg：-1 = 禁用；0 = 不传参数；正数 = 字节（且不超 16 GB）', () => {
  assert.equal(diskCacheSizeArg('-1'), '--disk-cache-size=-1')
  assert.equal(diskCacheSizeArg(DEFAULT_DISK_CACHE_MB), '--disk-cache-size=-1')
  assert.equal(diskCacheSizeArg('0'), null, '0 = 不传该参数')
  assert.equal(diskCacheSizeArg('128'), '--disk-cache-size=134217728')
  assert.equal(diskCacheSizeArg('512'), '--disk-cache-size=536870912')
  assert.equal(diskCacheSizeArg('1024'), `--disk-cache-size=${1024 * 1024 * 1024}`)
  assert.ok(MAX_DISK_CACHE_BYTES === 16 * 1024 * 1024 * 1024)
})

test('checkProfileLimit：0 = 关闭（永不拦截）；目录不存在 = 跳过预检', () => {
  assert.equal(isLimitDisabled('0'), true)
  assert.equal(isLimitDisabled(2048), false)
  assert.deepEqual(checkProfileLimit(null, '2048').skip, true, '首次打开（目录不存在）跳过')
  assert.equal(checkProfileLimit(mbToBytes(9999), '0').skip, true, '上限 0 → 不预检、不拦截')
  assert.equal(checkProfileLimit(mbToBytes(9999), '0').overLimit, false)
  assert.equal(checkProfileLimit(mbToBytes(4096), '2048').overLimit, true, '4 GB > 2 GB')
  assert.equal(checkProfileLimit(mbToBytes(2048), '2048').overLimit, false, '等于上限不算超限')
  assert.equal(checkProfileLimit(mbToBytes(2047), '2048').overLimit, false)
  // 上限非法 → 回落 2048 后照常判定
  assert.equal(checkProfileLimit(mbToBytes(4096), '9999').limitBytes, mbToBytes(2048))
})

test('isProfileSizeCacheValid：TTL 60s 命中，force / 过期 / 未来时间戳都失效', () => {
  assert.equal(PROFILE_SIZE_TTL_MS, 60_000, 'TTL 必须按规格 §14.6 是 60 秒')
  const now = 1_000_000
  const fresh = { scannedAt: now - 1000, bytes: 10 }
  assert.equal(isProfileSizeCacheValid(fresh, now), true, '1 秒前的结果应命中')
  assert.equal(isProfileSizeCacheValid(fresh, now, { force: true }), false, 'force 必重算')
  assert.equal(isProfileSizeCacheValid(fresh, now + 59_000), true, '差一点到 TTL 仍命中')
  assert.equal(isProfileSizeCacheValid(fresh, now + 61_000), false, '超过 TTL 失效')
  assert.equal(isProfileSizeCacheValid(null, now), false, '没有缓存')
  assert.equal(isProfileSizeCacheValid({}, now), false, '缺 scannedAt')
  assert.equal(isProfileSizeCacheValid({ scannedAt: now + 5000 }, now), false, '未来时间戳视为失效')
  assert.equal(isProfileSizeCacheValid(fresh, now, { ttlMs: 500 }), false, '显式 ttlMs 覆盖默认值')
})

test('formatBytes 与超限文案', () => {
  assert.equal(formatBytes(0), '0 B')
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(2048), '2.0 KB')
  assert.equal(formatBytes(536870912), '512.0 MB')
  assert.equal(formatBytes(2 * 1024 * 1024 * 1024), '2.0 GB')
  assert.equal(formatBytes(-1), '0 B')
  const text = overLimitText('内网', mbToBytes(4096), mbToBytes(2048), mbToBytes(1024))
  assert.match(text, /内网/)
  assert.match(text, /4\.0 GB/)
  assert.match(text, /2\.0 GB/)
  assert.match(text, /保留登录状态与 Cookie/)
})

test('防复发门禁：只有一个 profileLimit 模块（不得再出现 profileLimits.mjs 分叉）', () => {
  const libDir = new URL('../lib/', import.meta.url)
  const names = readdirSync(libDir).filter((name) => /^profileLimits?\.mjs$/.test(name))
  assert.deepEqual(
    names,
    ['profileLimit.mjs'],
    `profile 相关模块只能有一个，实际：${names.join('、')}`
  )
  assert.equal(
    existsSync(new URL('../lib/profileLimits.mjs', import.meta.url)),
    false,
    'lib/profileLimits.mjs 必须已删除（旧模块与 profileLimit.mjs 分叉过 TTL 与白名单）'
  )
})

test('白名单判定与保留判定都不接受空/非字符串输入', () => {
  for (const bad of ['', null, undefined, 0, {}]) {
    assert.equal(isCacheDirName(bad), false)
    assert.equal(isProtectedDirName(bad), false)
  }
})
