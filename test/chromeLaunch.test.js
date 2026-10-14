/**
 * `lib/chromeLaunch.mjs` 的纯函数测试：`cmd /c start` 的命令行构造与护栏。
 *
 * 与 `extensions/rdp/test/mstscArgs.test.js` **同源同护栏**，Chrome 版多出的矩阵是
 * "**逐个参数**检查"（Chrome 的参数是一整个白名单数组，不是单个 `.rdp` 路径）。
 *
 * **故意不真的派发**（不 spawn cmd/Chrome）：本文件只钉"参数数组长什么样、什么该被拒"。
 * 真机语义（Chrome 的父进程已死、关掉 obox 后站点窗口仍在、Chrome 单实例复用 profile）
 * 需要真实窗口与进程树，属人工验收（见 `docs/spec/amendments/09-chrome-orphan-launch.md`）。
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { buildStartArgs } from '../lib/chromeLaunch.mjs'

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const APP = '--app=https://intranet.example.com/'

describe('buildStartArgs：参数数组形态', () => {
  it('恰好 4 + args.length 个元素：/c start "" <chrome.exe> <参数…>', () => {
    const args = buildStartArgs(CHROME, [APP])
    assert.deepEqual(args, ['/c', 'start', '', CHROME, APP])
    assert.equal(args.length, 5)
  })

  it('第 3 个元素必须是空串：start 的窗口标题占位不能丢（丢了参数会被当标题）', () => {
    assert.equal(buildStartArgs(CHROME, [APP])[2], '')
  })

  it('多个参数**顺序不变**地原样跟在 chrome.exe 之后', () => {
    const input = [
      APP,
      '--user-data-dir=D:\\obox-webapp\\profiles\\内网',
      '--disable-features=DownloadBubble',
      '--disk-cache-size=-1',
      '--window-size=1280,800'
    ]
    const args = buildStartArgs(CHROME, input)
    assert.equal(args.length, 4 + input.length)
    assert.deepEqual(args.slice(4), input)
  })

  it('chrome.exe 路径首尾空白会被 trim（路径本身不该带空白，但别把空白传成 token）', () => {
    assert.deepEqual(buildStartArgs(` ${CHROME} `, [APP]), ['/c', 'start', '', CHROME, APP])
  })

  it('参数**不做 trim**：URL 里的首尾空白原样交给 Chrome（改写语义比报错更危险）', () => {
    const spaced = '--app=https://a/ b '
    assert.equal(buildStartArgs(CHROME, [spaced])[4], spaced)
  })
})

describe('buildStartArgs：转义矩阵（函数不加引号、不转义、不截断）', () => {
  // 真机实测（转述 `extensions/rdp/docs/adr/0003` 的探针，Windows 11 build 26200）：
  // 下列字符经 `cmd /c start` 全部**原样到达**目标进程，唯一会被展开的是 `%VAR%`
  // （见拒绝矩阵）→ 函数必须原样返回。
  const cases = [
    ['空格', '--user-data-dir=D:\\obox probe\\站点'],
    ['中文/井号', '--user-data-dir=D:\\会话 #1'],
    ['&', '--app=https://a/b&c'],
    ['^', '--app=https://a/b^c'],
    ['括号', '--user-data-dir=D:\\(a) b'],
    ['!', '--app=https://a/b!c'],
    ['% 不配对（探针实测原样到达）', '--app=https://a/100% done'],
    ['| < >', '--app=https://a/b|c<d>e']
  ]

  for (const [name, arg] of cases) {
    it(`${name}：第 5 个元素与输入逐字符相同`, () => {
      const args = buildStartArgs(CHROME, [arg])
      assert.equal(args[4], arg)
      assert.equal(args.length, 5)
    })
  }

  it('第 4 个元素（chrome.exe 路径）同样原样传', () => {
    assert.equal(buildStartArgs('C:\\a b\\chrome.exe', [APP])[3], 'C:\\a b\\chrome.exe')
  })
})

describe('buildStartArgs：拒绝矩阵', () => {
  it('%VAR% 形态：抛错（cmd 会把它展开成变量值，URL/profile 路径被静默改写）', () => {
    assert.throws(() => buildStartArgs(CHROME, ['--app=https://a/%TEMP%/x']), /%VAR%/)
  })

  it('其它 %VAR% 变体也抛错：未定义变量、%%、两个不相关的 %', () => {
    assert.throws(() => buildStartArgs(CHROME, ['--app=https://a/%NOSUCHVAR%/x']), /%VAR%/)
    assert.throws(() => buildStartArgs(CHROME, ['--app=https://a/%%/x']), /%VAR%/)
    assert.throws(() => buildStartArgs(CHROME, ['--app=https://a/%x/b%c']), /%VAR%/)
  })

  it('**逐个参数**检查：第 2 个参数（--user-data-dir）里的 %VAR% 同样被拒', () => {
    // 只查 args[0] 的实现会漏掉这条 —— 后果是 profile 被静默写到别处（登录态搬家）
    assert.throws(() => buildStartArgs(CHROME, [APP, '--user-data-dir=D:\\%TEMP%\\x']), /%VAR%/)
  })

  it('只有**不配对**的单个 % 放行（与 rdp 的字符表同一口径）', () => {
    assert.equal(buildStartArgs(CHROME, ['--app=https://a/50%/x'])[4], '--app=https://a/50%/x')
    assert.equal(
      buildStartArgs(CHROME, ['--app=https://a/100% done'])[4],
      '--app=https://a/100% done'
    )
  })

  it('双引号：抛错', () => {
    assert.throws(() => buildStartArgs(CHROME, ['--app=https://a/b"c']), /引号或换行/)
  })

  it('换行（\\n / \\r）：抛错', () => {
    assert.throws(() => buildStartArgs(CHROME, ['--app=https://a/b\nc']), /引号或换行/)
    assert.throws(() => buildStartArgs(CHROME, ['--app=https://a/b\rc']), /引号或换行/)
  })

  it('空/纯空白参数、非字符串参数、空数组：抛错（绝不"帮它改成空串"）', () => {
    assert.throws(() => buildStartArgs(CHROME, ['']), /空串/)
    assert.throws(() => buildStartArgs(CHROME, ['   ']), /空串/)
    assert.throws(() => buildStartArgs(CHROME, [123]), /不是字符串/)
    assert.throws(() => buildStartArgs(CHROME, []), /至少一个/)
    assert.throws(() => buildStartArgs(CHROME, APP), /参数数组/)
  })

  it('chrome.exe 路径缺失/空白：抛错（不给 cmd 一个空目标）', () => {
    assert.throws(() => buildStartArgs('', [APP]), /绝对路径/)
    assert.throws(() => buildStartArgs('   ', [APP]), /绝对路径/)
    assert.throws(() => buildStartArgs(undefined, [APP]), /绝对路径/)
  })
})

describe('buildStartArgs：回归护栏（防"好心加引号"）', () => {
  it('函数永远不自己加引号：那是 Node 在 windowsVerbatimArguments:false 下的事', () => {
    // 后人若"按 Windows 的习惯"给这里再包一层引号，`cmd` 会先吃掉自己那层引号，
    // `start` 拿到的就不再是我们要的 token（路径/URL 在空格处被截断），而 cmd 仍然 exit 0。
    for (const input of [
      [CHROME, '--app=https://a/b c'],
      [CHROME, '--user-data-dir=D:\\会话 #1'],
      ['C:\\a b\\chrome.exe', '--app=https://a/b&c']
    ]) {
      const args = buildStartArgs(input[0], [input[1]])
      for (const value of args.slice(3)) {
        assert.ok(
          !(value.startsWith('"') && value.endsWith('"')),
          `${value} 不得被加引号（转义是 Node 的事）`
        )
        assert.ok(!value.includes('\\"'), '不得用反斜杠转义引号')
      }
      assert.equal(args[3], input[0])
      assert.equal(args[4], input[1])
    }
  })
})

describe('源码门禁：派发机制不得回退成"直接 spawn Chrome"', () => {
  /** 去掉块注释与行注释：文档里必须能写出反面写法（`spawn(exe, args, …)`），不能被自己的说明喂成假红 */
  const stripComments = (text) =>
    text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  const helper = stripComments(readFileSync(new URL('../helper.cjs', import.meta.url), 'utf8'))
  const index = readFileSync(new URL('../index.js', import.meta.url), 'utf8')

  it('helper.cjs 经 `cmd.exe` 派发，且 windowsVerbatimArguments 取 false', () => {
    assert.match(helper, /spawn\('cmd\.exe',\s*args,/, '必须 spawn cmd.exe 并传参数数组')
    assert.match(helper, /windowsVerbatimArguments:\s*false/, '必须是 false（见文件头第 2 条）')
    assert.match(helper, /buildStartArgs\(exe, args\)/, '参数数组必须由 lib/chromeLaunch.mjs 构造')
  })

  it('helper.cjs 不得再直接 spawn Chrome（那是"obox 的子进程"的老实现）', () => {
    // 反例（1.0.3 的实现）：`spawn(exe, args, { detached: true, stdio: 'ignore' })`
    assert.ok(
      !/spawn\(\s*(?:exe|chromeExe|detected\.chrome\.path)\s*,/.test(helper),
      'helper.cjs 又出现了直接 spawn Chrome 的调用'
    )
    assert.match(helper, /pid: null/, '`pid` 必须恒为 null（经 cmd 派发拿不到 pid）')
  })

  it('index.js 的 open 判据必须是"回包是对象"，不得再要求 pid', () => {
    assert.match(index, /typeof result !== 'object'/, 'open 必须判"回包是不是对象"')
    assert.ok(!/if\s*\(!pid\)/.test(index), 'open 不得再有 `if (!pid)` 的旧判据')
    assert.match(index, /launch 回复不是对象/, '失败分支的告警文案必须存在（沿用既有风格）')
  })
})
