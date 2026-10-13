/**
 * Chrome 参数构造与 origin 推导的单测（规格 §18.1 的 `test/chromeArgs.test.js` 表逐例）。
 *
 * 最高价值的一条：把 R9–R11 与 R17 的参数规则**钉成可执行断言**——
 * 顺序固定、空值不传、枚举边界、白名单之外一律拒绝。
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ChromeArgsError,
  DISABLE_FEATURES_ARG,
  IGNORE_CERT_ARG,
  buildChromeArgs,
  deriveOrigin,
  describeLaunch,
  insecureOriginValue,
  maskUserInfo,
  normalizeExtraOrigins,
  userDataDirArg,
  validateWhitelistFields
} from '../lib/chromeArgs.mjs'
import { normalizeWebapp } from '../lib/webapp.mjs'

/** 归一 + 构造参数（失败时把字段级错误抛出来，便于断言） */
function argsOf(input, options) {
  return buildChromeArgs(normalizeWebapp(input), options)
}

/** 取字段级错误（断言"报错而非产出半个数组"） */
function errorsOf(input, options) {
  try {
    buildChromeArgs(normalizeWebapp(input), options)
    return null
  } catch (err) {
    assert.ok(err instanceof ChromeArgsError, `应抛 ChromeArgsError，实际 ${err?.name}`)
    return err.errors
  }
}

test('最小条目：数组逐一相等（顺序 ①–③ 固定）', () => {
  assert.deepEqual(argsOf({ name: 'A', url: 'https://a/', ignoreCert: true }), [
    '--app=https://a/',
    '--user-data-dir=chrome/A',
    '--disable-features=DownloadBubble',
    '--disk-cache-size=-1',
    '--ignore-certificate-errors',
    '--unsafely-treat-insecure-origin-as-secure=https://a'
  ])
})

test('ignoreCert=false：不出现证书相关的两个参数，其余完全相同', () => {
  const off = argsOf({ name: 'A', url: 'https://a/', ignoreCert: false })
  assert.deepEqual(off, [
    '--app=https://a/',
    '--user-data-dir=chrome/A',
    '--disable-features=DownloadBubble',
    '--disk-cache-size=-1'
  ])
  assert.ok(!off.includes(IGNORE_CERT_ARG))
  assert.ok(!off.some((arg) => arg.startsWith('--unsafely-treat-insecure-origin-as-secure')))
})

test('全部白名单开关都填：顺序恰为 ①–⑪，值形态正确（1.5 不是 1.50）', () => {
  const args = argsOf({
    name: '内网',
    url: 'https://10.0.0.5:8443/app?x=1#y',
    ignoreCert: true,
    extraOrigins: 'https://10.0.0.6:8443\nhttps://10.0.0.7',
    windowSize: '900,600',
    windowPos: '-100,50',
    startMaximized: true,
    lang: 'zh-CN',
    scaleFactor: '1.5',
    disableGpu: true
  })
  assert.deepEqual(args, [
    '--app=https://10.0.0.5:8443/app?x=1#y',
    '--user-data-dir=chrome/内网',
    '--disable-features=DownloadBubble',
    '--disk-cache-size=-1',
    '--ignore-certificate-errors',
    '--unsafely-treat-insecure-origin-as-secure=https://10.0.0.5:8443,https://10.0.0.6:8443,https://10.0.0.7',
    '--window-size=900,600',
    '--window-position=-100,50',
    '--start-maximized',
    '--lang=zh-CN',
    '--force-device-scale-factor=1.5',
    '--disable-gpu'
  ])
})

test('空值不传（表驱动）：每个开关单独留空 → 该参数不出现', () => {
  const base = { name: 'A', url: 'https://a/', ignoreCert: false }
  const cases = [
    { windowSize: '' },
    { windowSize: '' },
    { windowPos: '' },
    { startMaximized: false },
    { lang: '' },
    { scaleFactor: '' },
    { disableGpu: false }
  ]
  for (const extra of cases) {
    const args = argsOf({ ...base, ...extra })
    assert.deepEqual(args, [
      '--app=https://a/',
      '--user-data-dir=chrome/A',
      DISABLE_FEATURES_ARG,
      '--disk-cache-size=-1'
    ])
  }
  // 两个下拉停在"不指定"：关键断言（D-3）
  const noDropdowns = argsOf({ ...base, lang: '', scaleFactor: '' })
  assert.ok(!noDropdowns.some((arg) => arg.startsWith('--lang')))
  assert.ok(!noDropdowns.some((arg) => arg.startsWith('--force-device-scale-factor')))
  // 绝不产出空值形式
  assert.ok(!noDropdowns.includes('--lang='))
  assert.ok(!noDropdowns.includes('--force-device-scale-factor='))
})

test('pair 只填一半 → 返回字段级错误而不是部分参数', () => {
  assert.deepEqual(errorsOf({ name: 'A', url: 'https://a/', windowSize: '900,' }), [
    { field: 'windowSize', message: '窗口宽高必须同时填写或同时留空' }
  ])
  assert.deepEqual(errorsOf({ name: 'A', url: 'https://a/', windowPos: ',50' }), [
    { field: 'windowPos', message: '窗口位置必须同时填写或同时留空' }
  ])
})

test('origin 推导（表驱动）：实测样例逐条对齐', () => {
  const cases = [
    ['https://10.0.0.5:8443/app/x?y=1#z', 'https://10.0.0.5:8443'],
    ['http://intranet/', 'http://intranet'],
    ['https://[::1]:9443/a', 'https://[::1]:9443'],
    ['http://user:pw@h:8080/x', 'http://h:8080'],
    ['https://h/', 'https://h'],
    ['http://intranet', 'http://intranet'],
    ['HTTPS://Intranet:8443/A', 'https://intranet:8443']
  ]
  for (const [url, origin] of cases) {
    assert.equal(deriveOrigin(url), origin, `${url} 的 origin`)
  }
})

test('extraOrigins：多行 → 逗号连接、主 origin 恒在最前、去重、空行忽略', () => {
  const args = argsOf({
    name: 'A',
    url: 'https://a/',
    ignoreCert: true,
    extraOrigins: '\nhttps://b\n\nhttps://a\nhttps://B\n'
  })
  const value = args.find((arg) => arg.startsWith('--unsafely-treat-insecure-origin-as-secure='))
  assert.equal(value, '--unsafely-treat-insecure-origin-as-secure=https://a,https://b')
  // `normalizeExtraOrigins` 只做"额外列表内部"的归一/去重：它不知道主 origin，
  // 所以 `https://a` 会留在里面；**与主 origin 的去重发生在合并时**（`buildChromeArgs`）。
  const normalized = normalizeExtraOrigins('\nhttps://b\n\nhttps://a\nhttps://B\n', 'https://a/')
  assert.deepEqual(normalized.origins, ['https://b', 'https://a'])
  assert.deepEqual(normalized.errors, [])
})

test('extraOrigins：协议不符 / 非法行 / 超 8 条都报字段级错误（行号按原始输入）', () => {
  const mismatch = normalizeExtraOrigins('\nhttp://b', 'https://a/')
  assert.deepEqual(mismatch.errors, [
    { field: 'extraOrigins', message: '额外 origin 第 2 行必须与主网址同协议（https:）' }
  ])
  const illegal = normalizeExtraOrigins('not a url', 'https://a/')
  assert.deepEqual(illegal.errors, [
    { field: 'extraOrigins', message: '额外 origin 第 1 行不是合法的 http/https 地址' }
  ])
  const many = Array.from({ length: 9 }, (_, i) => `https://h${i}`).join('\n')
  const overflow = normalizeExtraOrigins(many, 'https://a/')
  assert.deepEqual(overflow.errors, [{ field: 'extraOrigins', message: '额外 origin 最多 8 条' }])
  assert.equal(overflow.origins.length, 8, '前 8 条仍然保留')
})

test('insecureOriginValue / maskUserInfo / describeLaunch 的脱敏与摘要', () => {
  assert.equal(insecureOriginValue(['https://a', 'https://b']), 'https://a,https://b')
  assert.equal(insecureOriginValue([]), '')
  assert.equal(maskUserInfo('http://user:pw@h:8080/x'), 'http://***@h:8080/x')
  assert.equal(maskUserInfo('https://h/x'), 'https://h/x')
  const args = argsOf({ name: 'A', url: 'https://user:pw@h/x', ignoreCert: false })
  const summary = describeLaunch({ exe: 'C:\\chrome.exe', args })
  assert.ok(!summary.includes('pw'), `摘要不得出现 userinfo 原文：${summary}`)
  assert.ok(summary.includes('https://***@h'), '摘要里的 userinfo 必须脱敏')
  assert.match(summary, /参数=4 个/)
  assert.match(summary, /profile=chrome\/A/)
})

test('白名单边界（表驱动）：宽 320/7680、高 240/4320、位置 -10000/10000', () => {
  const cases = [
    ['319,600', '窗口宽度必须是 320–7680 的整数'],
    ['7681,600', '窗口宽度必须是 320–7680 的整数'],
    ['900,239', '窗口高度必须是 240–4320 的整数'],
    ['900,4321', '窗口高度必须是 240–4320 的整数'],
    ['abc,600', '窗口宽度必须是 320–7680 的整数'],
    ['900.5,600', '窗口宽度必须是 320–7680 的整数']
  ]
  for (const [value, message] of cases) {
    assert.deepEqual(
      errorsOf({ name: 'A', url: 'https://a/', windowSize: value }),
      [{ field: 'windowSize', message }],
      `windowSize=${value}`
    )
  }
  const posCases = [
    ['-10001,0', '窗口左坐标必须是 -10000–10000 的整数'],
    ['0,10001', '窗口上坐标必须是 -10000–10000 的整数']
  ]
  for (const [value, message] of posCases) {
    assert.deepEqual(errorsOf({ name: 'A', url: 'https://a/', windowPos: value }), [
      { field: 'windowPos', message }
    ])
  }
  // 恰好边界必须放行
  assert.equal(errorsOf({ name: 'A', url: 'https://a/', windowSize: '320,240' }), null)
  assert.equal(errorsOf({ name: 'A', url: 'https://a/', windowSize: '7680,4320' }), null)
  assert.equal(errorsOf({ name: 'A', url: 'https://a/', windowPos: '-10000,10000' }), null)
})

test('枚举边界（表驱动，D-3）：scaleFactor 15 项合法、其余一律字段级错误', () => {
  const legal = [
    '0.5',
    '0.75',
    '1',
    '1.25',
    '1.5',
    '1.75',
    '2',
    '2.25',
    '2.5',
    '2.75',
    '3',
    '3.25',
    '3.5',
    '3.75',
    '4'
  ]
  for (const value of legal) {
    const args = argsOf({ name: 'A', url: 'https://a/', scaleFactor: value, ignoreCert: false })
    assert.ok(
      args.includes(`--force-device-scale-factor=${value}`),
      `${value} 应产出参数，且不得补尾随零`
    )
  }
  for (const bad of ['0.49', '4.1', '1.3', '1.50', '2.0']) {
    assert.deepEqual(
      errorsOf({ name: 'A', url: 'https://a/', scaleFactor: bad }),
      [{ field: 'scaleFactor', message: '缩放比例不在可选清单内（请从下拉中选择）' }],
      `scaleFactor=${JSON.stringify(bad)}`
    )
  }
  // ⚠️ **数值 `1.5` 在这一层是合法的**（不是漏检）：`normalizeWebapp` 会把字符串列统一转成
  // 字符串（保证 `api.sqlite` 的列类型稳定），所以数值 `1.5` 到这里已经是 `'1.5'`。
  // "表单里传来数字类型"这件事由**校验层**拒绝：`lib/webapp.mjs` 的 `validateWebapp`
  // 带 `{ raw }` 时按原始类型判定（`test/webapp.test.js` 有对应用例）。
  // 两层各管一段：`buildChromeArgs` 只管"参数怎么拼"，`validateWebapp` 只管"要不要拒"。
  const fromNumber = argsOf({ name: 'A', url: 'https://a/', scaleFactor: 1.5, ignoreCert: false })
  assert.ok(fromNumber.includes('--force-device-scale-factor=1.5'))
})

test('枚举边界（表驱动，D-3）：lang 12 项合法、其余一律字段级错误', () => {
  for (const value of ['zh-CN', 'en-US', 'ja-JP', 'it-IT']) {
    const args = argsOf({ name: 'A', url: 'https://a/', lang: value, ignoreCert: false })
    assert.ok(args.includes(`--lang=${value}`))
  }
  for (const bad of ['xx-YY', 'zh_CN', 'ZH-CN', 'zh', 123]) {
    assert.deepEqual(
      errorsOf({ name: 'A', url: 'https://a/', lang: bad }),
      [{ field: 'lang', message: '界面语言不在可选清单内（请从下拉中选择）' }],
      `lang=${JSON.stringify(bad)}`
    )
  }
})

test('非法 url：硬拒绝清单全部字段级错误', () => {
  for (const url of [
    'file:///etc/passwd',
    'javascript:alert(1)',
    'chrome://settings',
    'chrome-extension://abc/x',
    'data:text/html,x',
    'about:blank',
    'ftp://h/x',
    'intranet.local',
    './x',
    '/x'
  ]) {
    const errors = errorsOf({ name: 'A', url })
    assert.deepEqual(
      errors,
      [{ field: 'url', message: '网址只能是 http:// 或 https:// 开头' }],
      url
    )
  }
  assert.deepEqual(errorsOf({ name: 'A', url: '' }), [{ field: 'url', message: '网址不能为空' }])
})

test('未知键被丢弃：proxyServer 不进归一、也不产出参数', () => {
  const entry = normalizeWebapp({ name: 'A', url: 'https://a/', proxyServer: 'http://evil:8080' })
  assert.equal('proxyServer' in entry, false)
  const args = buildChromeArgs(entry)
  assert.ok(!args.some((arg) => arg.includes('proxy-server')))
})

test('R17：--disk-cache-size 的三档语义（-1 禁用 / 0 不传 / 正数按字节）', () => {
  const entry = normalizeWebapp({ name: 'A', url: 'https://a/', ignoreCert: false })
  // 默认 = -1（禁用磁盘 HTTP 缓存，唯一真正限体积的取值）
  assert.ok(buildChromeArgs(entry).includes('--disk-cache-size=-1'))
  assert.ok(buildChromeArgs(entry, { diskCacheMb: '-1' }).includes('--disk-cache-size=-1'))
  // 0 = 不传该参数
  assert.ok(
    !buildChromeArgs(entry, { diskCacheMb: 0 }).some((a) => a.startsWith('--disk-cache-size'))
  )
  assert.ok(
    !buildChromeArgs(entry, { diskCacheMb: '0' }).some((a) => a.startsWith('--disk-cache-size'))
  )
  // 正数 = 字节（不是 MB）
  assert.ok(buildChromeArgs(entry, { diskCacheMb: 512 }).includes('--disk-cache-size=536870912'))
  assert.ok(buildChromeArgs(entry, { diskCacheMb: 128 }).includes('--disk-cache-size=134217728'))
  assert.ok(buildChromeArgs(entry, { diskCacheMb: 1024 }).includes('--disk-cache-size=1073741824'))
  // 不在档位内 → 回落默认（-1）
  assert.ok(buildChromeArgs(entry, { diskCacheMb: 999 }).includes('--disk-cache-size=-1'))
})

test('userDataDirArg：缺省仍产出相对形态 chrome/<净化名>（1.0.2 行为一字不变）', () => {
  assert.equal(userDataDirArg('内网'), '--user-data-dir=chrome/内网')
  assert.equal(userDataDirArg('a<b'), '--user-data-dir=chrome/a-b')
  assert.equal(userDataDirArg('内网', { rootMode: 'relative' }), '--user-data-dir=chrome/内网')
  // 自定义根但根为空 ⇒ 退回相对形态（由助手侧的根校验兜底，界面绝不自己发明一个根）
  assert.equal(userDataDirArg('内网', { rootMode: 'absolute' }), '--user-data-dir=chrome/内网')
  assert.equal(
    userDataDirArg('内网', { rootMode: 'absolute', root: '' }),
    '--user-data-dir=chrome/内网'
  )
})

test('userDataDirArg：rootMode=absolute 产出 <绝对根>\\<净化名>（规格 §9.2 末的 D2 裁定）', () => {
  assert.equal(
    userDataDirArg('内网', { rootMode: 'absolute', root: 'D:\\obox-webapp\\profiles' }),
    '--user-data-dir=D:\\obox-webapp\\profiles\\内网'
  )
  // 尾部分隔符被规范化（不会产出双反斜杠）
  assert.equal(
    userDataDirArg('内网', { rootMode: 'absolute', root: 'D:\\obox-webapp\\profiles\\' }),
    '--user-data-dir=D:\\obox-webapp\\profiles\\内网'
  )
  // UNC 根同样成立
  assert.equal(
    userDataDirArg('内网', { rootMode: 'absolute', root: '\\\\server\\share\\profiles' }),
    '--user-data-dir=\\\\server\\share\\profiles\\内网'
  )
  // 名称仍然净化（非法字符 → `-`）
  assert.equal(
    userDataDirArg('a<b', { rootMode: 'absolute', root: 'D:\\p' }),
    '--user-data-dir=D:\\p\\a-b'
  )
})

test('buildChromeArgs：absolute 模式把根写进参数；根非法 ⇒ 字段级错误而非静默回落', () => {
  const entry = normalizeWebapp({ name: 'A', url: 'https://a/', ignoreCert: false })
  const withRoot = buildChromeArgs(entry, {
    rootMode: 'absolute',
    root: 'D:\\obox-webapp\\profiles'
  })
  assert.ok(
    withRoot.includes('--user-data-dir=D:\\obox-webapp\\profiles\\A'),
    `absolute 模式必须产出绝对形态：${JSON.stringify(withRoot)}`
  )
  // 默认（不传 rootMode）仍然是相对形态 —— 这条是"默认根零回归"在纯函数层的守卫
  assert.ok(buildChromeArgs(entry).includes('--user-data-dir=chrome/A'))
  // absolute 模式但根为空/非法 ⇒ 抛字段级错误（**不得**悄悄落到默认根）
  assert.deepEqual(errorsOf({ name: 'A', url: 'https://a/' }, { rootMode: 'absolute', root: '' }), [
    { field: 'profileRoot', message: '自定义根必须是绝对路径' }
  ])
})

test('describeLaunch：自定义根下摘要里带绝对路径（日志更有用，且仍不打印完整命令行）', () => {
  const args = argsOf(
    { name: 'A', url: 'https://a/', ignoreCert: false },
    { rootMode: 'absolute', root: 'D:\\obox-webapp\\profiles' }
  )
  const text = describeLaunch({ args })
  assert.match(text, /profile=D:\\obox-webapp\\profiles\\A/)
  assert.ok(!text.includes('--disable-features'), '摘要不得包含完整命令行')
})

test('validateWhitelistFields：空条目不报错，非法才报', () => {
  assert.deepEqual(validateWhitelistFields({}), [])
  assert.deepEqual(validateWhitelistFields({ lang: 'zh-CN', scaleFactor: '1.5' }), [])
  assert.deepEqual(validateWhitelistFields({ lang: 'nope' }), [
    { field: 'lang', message: '界面语言不在可选清单内（请从下拉中选择）' }
  ])
})
