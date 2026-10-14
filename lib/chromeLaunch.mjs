/**
 * `cmd /c start "" <chrome.exe 绝对路径> <参数…>` 的命令行构造（纯函数，零依赖）。
 *
 * **为什么绕一层 cmd**：直接 `spawn(chromeExe, args, { detached: true })` 会让 Chrome 成为助手的
 * **直接子进程**，任务管理器里能看见 `obox.exe → 助手 node → chrome.exe` 这条链；于是"关掉 obox
 * 会不会带走已打开的站点窗口"就取决于宿主的实现细节（宿主结束 IPC 助手时只 `child.kill()`
 * 直接子进程，不做树杀），而不是结构上的保证。经 `cmd /c start` 派发后 `cmd` 立即自己退出，
 * Chrome 的父进程变成一条**已断开的链**：它既不是助手、也不是 obox 的后代。
 *
 * ⚠️ **与 `extensions/rdp/lib/mstscArgs.mjs` 同源同护栏**：本模块是那份实现的 Chrome 版——
 * 同一套"三个不能改的点"、同一套 `%VAR%` / 引号 / 换行的拦截口径、同一句"绝不自己加引号"。
 * 完整取舍（被否决的备选、退出码判据的代价、真机验收步骤）见
 * `docs/spec/amendments/09-chrome-orphan-launch.md`。
 *
 * **三个不能改的点**（改了会静默出错，单测全绿也不代表真机对）：
 *
 * 1. **必须是参数数组，不能把整串命令写成一个参数**。写成
 *    `spawn('cmd.exe', ['/c', 'start "" "C:\\…\\chrome.exe" "--app=…"'])` 时，Node 在 Windows 上会为
 *    "含空格的单参数"**整体再包一层引号**，真正的命令行变成
 *    `cmd /c "start "" "C:\Program Files\…\chrome.exe" "--app=…""`，而 `cmd` 的引号消解规则会把里层
 *    引号全部吃掉 ⇒ `start` 收到的目标与参数不是我们要的那些 token（真机现象：路径/URL 在 `&`
 *    处被截断，`cmd` 却仍然 `exit 0`——静默走错）。
 * 2. **本模块不做任何引号/转义**：原样返回，转义交给 Node 在
 *    `windowsVerbatimArguments: false` 下按"标准命令行解析器"完成（`helper.cjs` 的 `startViaCmd`
 *    处写死了这个取值，理由见那里）。⚠️ 这里**绝不能**照着 `quoteForCmdkey` 那种形态再加一层引号。
 * 3. **`start` 后面的空 `""` 必须保留**：它是窗口标题占位；没有它时 `start` 会把第一个带引号的
 *    参数**当成窗口标题**，可执行文件路径就丢了。
 *
 * **只拦 `%VAR%` 与引号/换行，且必须逐个参数查**（`&` `^` `|` `<` `>` `(` `)` `!` 与
 * **不配对的单个 `%`** 一律放行）：真机实测（`extensions/rdp/docs/adr/0003` 的探针，
 * Windows 11 build 26200）这些字符经 `cmd /c start` 全部原样到达目标进程，唯一的例外是 `%VAR%`
 * 会被 cmd 展开成变量值（未定义时是空串）——URL/profile 路径被**静默改写**。
 *
 * ⚠️ **与 rdp 的两点刻意不同**（都由"Chrome 的参数是一个数组"带来）：
 *
 * - rdp 只需检查**一个** `.rdp` 路径；这里是一整个白名单数组
 *   （`--app=<url>`、`--user-data-dir=<生效根>\<净化名>`、若干开关），所以要**逐个元素**检查。
 *   只查 `args[0]` 会让 `--user-data-dir` 里的 `%VAR%` 静默改写 profile 路径（症状：
 *   登录态被写进另一个目录）。
 * - **不做 `trim()`**：rdp 对单个路径 trim 是因为路径不该带首尾空白；这里任何对参数的改写都可能
 *   改变语义（URL 里的空白必须原样交给 Chrome），因此空/纯空白参数**直接拒绝**，绝不改写。
 *
 * **已知代价**：合法的百分号编码 URL（`…/a%20b%20c`，含 ≥2 个 `%`）会被这条护栏**拒掉**。
 * 这是刻意并已接受的取舍：放行意味着 cmd 把 `%20b%` 当变量展开、URL 被静默截断，
 * 而报错是可见的、可解释的（见 amendment 09 的"代价"段）。
 *
 * **不在这里解析 chrome.exe 路径**：本仓库的 Chrome 探测是 `helper.cjs` 的 `detectChrome()`
 * （3 处固定路径 + 注册表第 4 顺位，含 `existsSync` / `reg query`，本身不是纯函数）。
 * 它是**唯一实现**，`launch` 已复用它并把绝对路径传进来——在这里再造一个"纯函数版探测"
 * 会立刻变成第二份事实来源（这正是 rdp 那边**可以**有 `resolveMstscPath` 而这里不重复造的原因：
 * mstsc 的路径是纯函数可算的 `%SystemRoot%\System32`，Chrome 的路径不是）。
 */

/** `%VAR%` 形态（含 `%%`）：cmd 会把它展开成变量值（未定义则是空串）⇒ URL/路径被静默改写 */
const CMD_VARIABLE_PATTERN = /%[^%]*%/

/** 会毁掉 `cmd` 分词的字符：双引号、CR、LF（与 rdp 同一口径） */
const UNSAFE_CHARS_PATTERN = /["\r\n]/

/**
 * `cmd /c start "" <chrome.exe 绝对路径> <参数…>` 的参数数组。
 *
 * 规则：**不做任何引号/转义/trim**（见文件头第 2 条），原样返回。
 *
 * @param {string} chromeExePath chrome.exe 的绝对路径（由 `helper.cjs` 的 `detectChrome()` 得到）
 * @param {string[]} args 已过白名单校验的 Chrome 参数（`--app=<url>`、`--user-data-dir=…`、开关…）
 * @returns {string[]} 恰好 `4 + args.length` 个元素：`['/c', 'start', '', <chrome.exe>, ...args]`
 * @throws {Error} 任一参数命中 `%VAR%` / 双引号 / 换行，或形态非法（cmd 会吃掉它们，无法安全派发）
 */
export function buildStartArgs(chromeExePath, args) {
  const exe = String(chromeExePath ?? '').trim()
  if (!exe) throw new Error('buildStartArgs 需要 chrome.exe 的绝对路径')
  if (!Array.isArray(args)) throw new Error('buildStartArgs 需要 Chrome 参数数组')
  if (!args.length) throw new Error('buildStartArgs 需要至少一个 Chrome 参数')

  const checked = []
  args.forEach((raw, index) => {
    if (typeof raw !== 'string') {
      throw new Error(`buildStartArgs 的第 ${index} 个参数不是字符串，无法安全派发`)
    }
    if (!raw.trim()) throw new Error(`buildStartArgs 的第 ${index} 个参数是空串，无法安全派发`)
    if (CMD_VARIABLE_PATTERN.test(raw)) {
      throw new Error(
        `Chrome 参数含 %VAR%（第 ${index} 个：${raw}）：cmd 会把它当变量展开成变量值，` +
          'URL 或 profile 路径会被静默改写，无法安全派发'
      )
    }
    if (UNSAFE_CHARS_PATTERN.test(raw)) {
      throw new Error(`Chrome 参数含双引号或换行（第 ${index} 个：${raw}），无法安全派发`)
    }
    checked.push(raw)
  })

  return ['/c', 'start', '', exe, ...checked]
}
