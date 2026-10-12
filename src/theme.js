/**
 * 子窗口主题接收桥（设计文档 §2.7.8 E1）。
 *
 * 硬约束（为什么不能"直接继承 CSS 变量"）：App 卡片子窗口的 iframe 加载的是 `app://` 静态页，
 * 与父文档（dev 的 `http://localhost:5173` / 打包的 `file://`）**跨源** ⇒
 *   ① CSS 自定义属性不跨文档继承；
 *   ② `iframe.contentDocument` 恒为 `null`，宿主无法注入 `<style>`。
 * 因此 token **只能经消息送达**（`postMessage` 不受同源限制）：
 *
 *   宿主 → 子窗口：`{ source:'obox-app', action:'obox-theme', themeId, tokens }`
 *   子窗口 → 宿主：`{ source:'obox-app', action:'obox-theme-request' }`（启动后 0 / 300 / 1000 ms 各一次）
 *
 * 首帧兜底：模块脚本执行前不会有任何推送，所以 `installThemeBridge()` 必须**先同步**把
 * `FALLBACK_TOKENS` 写到自己的 `documentElement`（首帧就有配色）。`styles.css` 只写**裸**
 * `var(--token)`（R-D1 要求"零色彩/字体字面量"），于是兜底值集中在这一处 JS 常量里。
 * 它同时是一笔**有意的技术债**：兜底表是宿主 `main.css` 默认色的副本，会随宿主漂移
 * （只在"拿不到推送"时可感知）；退场条件见 `docs/adr/0002`。
 *
 * 本模块**顶层零副作用**：所有 DOM 访问都在函数内、且可注入，node 环境下可直接单测。
 */

/** 宿主当前主题 token 的兜底值（= 宿主 dark 默认值，逐条对齐 `src/renderer/src/assets/main.css:2-29`） */
export const FALLBACK_TOKENS = {
  '--bg': '#1e1e1e',
  '--bg-panel': '#252526',
  '--bg-sidebar': '#333333',
  '--bg-titlebar': '#323233',
  '--bg-input': '#3c3c3c',
  '--border': '#3c3c3c',
  '--fg': '#cccccc',
  '--fg-dim': '#6e6e6e',
  '--fg-bright': '#ffffff',
  '--fg-link': '#75beff',
  '--fg-error': '#f48771',
  '--fg-warning': '#cca700',
  '--fg-success': '#4ec9b0',
  '--accent': '#007acc',
  '--hover-bg': 'rgba(255, 255, 255, 0.1)',
  '--selection-bg': '#094771',
  '--nav-icon': '#858585',
  '--statusbar-bg': '#2a2a2a',
  '--statusbar-fg': '#cccccc',
  '--font-family':
    "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif",
  '--font-size': '13px',
  '--font-size-sm': '12px',
  '--font-size-lg': '16px',
  '--nav-icon-size': '24px',
  '--icon-size': '24px'
}

/** 协议字面量（与设计 §2.7.2 的协议表逐字一致，改这里等于改协议） */
const PUSH_ACTION = 'obox-theme'
const REQUEST_ACTION = 'obox-theme-request'
const SOURCE = 'obox-app'

/** token 名合法性：`--` 开头 + 小写字母/数字/连字符 */
export function isTokenName(name) {
  return typeof name === 'string' && /^--[a-z0-9-]+$/.test(name)
}

/**
 * 过滤宿主下发的 token：非法键名 / 非字符串 / 空串一律**丢弃**（不抛错）。
 * 宿主侧构造时已过滤一次（`sanitizeThemeTokens`），这里是双保险。
 *
 * ⚠️ **有意的口径差**：宿主侧只判 `value === ''`，这里更严——`value.trim() === ''`
 * （纯空白也算空）。理由是"空值"在本页会直接让 `var(--token)` 求值为空 ⇒ 文字/底色消失；
 * CSS 也把纯空白当无效值。（宿主侧 src/renderer/src/core/appTheme.ts 不跟着改。）
 */
export function sanitizeThemeTokens(input) {
  const clean = {}
  if (!input || typeof input !== 'object') return clean
  for (const [name, value] of Object.entries(input)) {
    if (!isTokenName(name)) continue
    if (typeof value !== 'string' || value.trim() === '') continue
    clean[name] = value
  }
  return clean
}

/**
 * 把 token 逐条 `setProperty` 到给定根元素上。返回成功应用的条数。
 * 任何异常只 `console.warn`（主题拿不到不该让页面挂掉），**不抛错**。
 */
export function applyThemeTokens(tokens, root) {
  const clean = sanitizeThemeTokens(tokens)
  let applied = 0
  for (const [name, value] of Object.entries(clean)) {
    try {
      root?.style?.setProperty(name, value)
      applied += 1
    } catch (err) {
      console.warn('[webapp] 主题应用失败', err)
    }
  }
  return applied
}

/**
 * 由主题 id 推 `color-scheme`（只影响 UA 绘制的原生控件/滚动条底色，不影响任何自绘配色）。
 * 扩展侧**不得**把 themeId 当色值用；id 里含 `light` 判浅色，其余判深色。
 */
export function colorSchemeForThemeId(themeId) {
  return /light/i.test(String(themeId ?? '')) ? 'light' : 'dark'
}

/**
 * 装上主题接收桥（在 `createApp().mount()` **之前**调用，保证首帧就有兜底配色）。
 *
 * @param {object} [options]
 * @param {Window} [options.window] 默认取全局 `window`
 * @param {HTMLElement} [options.root] 默认取 `document.documentElement`
 * @param {(message: object) => void} [options.post] 默认 `parent.postMessage(message, '*')`
 * @param {(fn: () => void, ms: number) => unknown} [options.schedule] 默认 `setTimeout`
 * @param {(id: unknown) => void} [options.cancel] 默认 `clearTimeout`
 * @param {number[]} [options.requestDelaysMs] 默认 `[0, 300, 1000]`
 * @returns {{ dispose: () => void }}
 */
export function installThemeBridge(options = {}) {
  const win = options.window ?? (typeof window !== 'undefined' ? window : undefined)
  const root = options.root ?? win?.document?.documentElement
  // node 单测 / 无 DOM 环境：安全空转，不抛错
  if (!win || !root) return { dispose() {} }

  const post = options.post ?? ((message) => win.parent.postMessage(message, '*'))
  const schedule = options.schedule ?? ((fn, ms) => win.setTimeout(fn, ms))
  const cancel = options.cancel ?? ((id) => win.clearTimeout(id))
  const requestDelaysMs = options.requestDelaysMs ?? [0, 300, 1000]

  // ① 同步写兜底：模块脚本一执行就有配色（推送是异步的，首帧等不到）
  applyThemeTokens(FALLBACK_TOKENS, root)
  root.style.colorScheme = 'dark'

  let received = false
  let disposed = false
  /** **仍挂着**的请求定时器：触发即出账，cancelPending 只处理还挂着的（不重复取消已执行的） */
  let pending = []

  function cancelPending() {
    for (const timer of pending) cancel(timer)
    pending = []
  }

  function onMessage(event) {
    // 只认"来自父窗口"的推送（不校验 origin：app:// 的 origin 规范化不确定，同源性判据更稳）
    if (event?.source !== win.parent) return
    const data = event.data
    if (!data || typeof data !== 'object') return
    if (data.source !== SOURCE || data.action !== PUSH_ACTION) return
    received = true
    cancelPending()
    const total =
      data.tokens && typeof data.tokens === 'object' ? Object.keys(data.tokens).length : 0
    const applied = applyThemeTokens(data.tokens, root)
    if (applied < total)
      console.warn(`[webapp] 主题推送里有 ${total - applied} 条非法 token，已丢弃`)
    root.style.colorScheme = colorSchemeForThemeId(data.themeId)
    console.log(`[webapp] 主题已应用 ${data.themeId || '(无主题 id)'}（${applied} 个 token）`)
  }

  win.addEventListener('message', onMessage)

  // ② 请求重发：0 / 300 / 1000 ms 各一次；收到推送即停，最后一次仍无响应则 warn 一次
  function requestTokens() {
    post({ source: SOURCE, action: REQUEST_ACTION })
  }
  requestDelaysMs.forEach((delay, index) => {
    const isLast = index === requestDelaysMs.length - 1
    let timer
    timer = schedule(() => {
      // 一触发就出账：这样 dispose()/收到推送时只去取消"还没跑到的"那些
      pending = pending.filter((item) => item !== timer)
      if (received || disposed) return
      requestTokens()
      if (isLast) {
        console.warn('[webapp] 未收到宿主主题推送（3 次请求无响应），使用内置兜底配色')
      }
    }, delay)
    pending.push(timer)
  })

  return {
    dispose() {
      disposed = true
      cancelPending()
      win.removeEventListener('message', onMessage)
    }
  }
}
