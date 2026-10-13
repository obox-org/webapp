/**
 * 组件源码门禁（**读源码断言关键接线**，与宿主 `test/app-window-wiring.test.ts` 同款手法；
 * 规格 §15.1 / §15.2 的硬要求逐条落在此处）。
 *
 * 为什么读源码而不是挂载组件：扩展没有 jsdom / @vue/test-utils。下面这些接线一旦被改回去，
 * 其它用例**全是绿的**——最典型的就是"模态框又能按 Esc 关闭了"。
 */
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

/** 去掉块注释 / HTML 注释 / 行注释，避免"文档里的示例字符串"把断言喂成假绿 */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

function source(relPath) {
  return stripComments(readFileSync(new URL(`../src/${relPath}`, import.meta.url), 'utf8'))
}

const MODAL = source('components/WebappModal.vue')
const DELETE = source('components/DeleteConfirm.vue')
const FIELD = source('components/WebappField.vue')
const CARD = source('components/WebappCard.vue')
const LIMIT = source('components/OverLimitModal.vue')
const MAIN = source('main.js')
const APP = source('App.vue')
const STYLES = source('styles.css')
const THEME = stripComments(readFileSync(new URL('../src/theme.js', import.meta.url), 'utf8'))

test('模态框只能按钮关闭：不得有遮罩点击关闭，也不得有 Esc/keydown 关闭', () => {
  for (const [name, src] of [
    ['WebappModal.vue', MODAL],
    ['DeleteConfirm.vue', DELETE],
    ['OverLimitModal.vue', LIMIT]
  ]) {
    assert.ok(!src.includes('@mousedown.self'), `${name} 不得绑定遮罩点击关闭`)
    assert.ok(!src.includes('@click.self'), `${name} 不得绑定遮罩点击关闭`)
    assert.ok(!src.includes('Escape'), `${name} 不得响应 Esc 关闭`)
    assert.ok(!src.includes("addEventListener('keydown'"), `${name} 不得装 keydown 监听`)
  }
  // 按钮路径仍在
  assert.ok(MODAL.includes('@click="emit(\'close\')"'), '「✕」「取消」按钮必须还在')
  assert.ok(DELETE.includes('@click="emit(\'close\')"'), '删除确认的「取消」必须还在')
  assert.ok(DELETE.includes('@click="emit(\'confirm\')"'), '删除确认的「删除」必须还在')
  assert.ok(LIMIT.includes('@click="emit(\'close\')"'), '拦截模态框的「取消」必须还在')
})

test('删除确认文案必须写明"浏览器数据"与"不可恢复"', () => {
  assert.ok(DELETE.includes('浏览器数据'), '删除确认必须提到浏览器数据')
  assert.ok(DELETE.includes('不可恢复'), '删除确认必须写明不可恢复')
})

test('R15：TLS 降级标记存在，且受 ignoreCert 条件控制', () => {
  assert.ok(CARD.includes('TLS 已降级'), '卡片必须有「TLS 已降级」字面量')
  assert.ok(CARD.includes('v-if="tlsDegraded"'), '标记必须由 ignoreCert 派生的条件控制')
  assert.ok(
    /const tlsDegraded = computed\(\(\) => props\.row\?\.ignoreCert === true\)/.test(CARD),
    'tlsDegraded 必须严格按 ignoreCert === true 判定'
  )
})

test('下拉渲染与 rdp 同型：选项文本带取值与短说明、title 放细说明、空值项在最前', () => {
  assert.ok(FIELD.includes('{{ option.value }} — {{ option.label }}'), '选项文本必须带取值与短说明')
  assert.ok(FIELD.includes(':title="option.desc"'), '更细的说明放 option 的 title')
  assert.ok(FIELD.includes('v-if="field.optional"'), 'optional 字段必须渲染空值项')
  assert.ok(FIELD.includes('field.emptyLabel'), '空值项文案来自字段定义')
  assert.ok(FIELD.includes('value=""'), '空值项的 value 必须是空串')
})

test('主题桥必须在 mount 之前装上（首帧就有兜底配色）', () => {
  const installAt = MAIN.indexOf('installThemeBridge()')
  const mountAt = MAIN.indexOf('createApp(App).mount(')
  assert.ok(installAt >= 0 && mountAt >= 0, 'main.js 必须既装主题桥又挂载应用')
  assert.ok(installAt < mountAt, 'installThemeBridge() 必须早于 mount')
})

test('R17：拦截模态框有且只有三个动作按钮，且写明保留登录态', () => {
  assert.ok(LIMIT.includes('@click="emit(\'clean\')"'), '缺「清理缓存并打开」')
  assert.ok(LIMIT.includes('@click="emit(\'force\')"'), '缺「仍然打开」')
  assert.ok(LIMIT.includes('@click="emit(\'close\')"'), '缺「取消」')
  assert.ok(LIMIT.includes('保留登录状态与 Cookie'), '必须写明清理保留登录态')
  assert.ok(LIMIT.includes('不会'), '必须写明超限拦截不会自动删除数据')
})

test('R17：列表页有全局清理入口与体积按需查询，且不在加载时扫盘', () => {
  assert.ok(APP.includes('清理全部缓存'), '缺少全局清理入口')
  assert.ok(APP.includes("callExtension('cleanCaches'"), '全局清理必须调 cleanCaches')
  assert.ok(APP.includes("callExtension('profileSize'"), '体积必须按需查询 profileSize')
  assert.ok(APP.includes('保留登录状态与 Cookie'), '全局清理的确认文案必须写明保留登录态')
  // 加载时不查体积：`load()` 里不得出现 profileSize
  const loadBody = APP.slice(APP.indexOf('async function load()'), APP.indexOf('onMounted('))
  assert.ok(!loadBody.includes('profileSize'), 'list 加载路径不得查体积（避免每次 list 都扫盘）')
})

test('「同站点窗口开着时新设置一律不生效」只剩两处落点（高级区说明行 + README）', () => {
  // ⚠️ 原本是三处：① 状态栏成功文案后缀、② 高级选项说明行、③ README。
  // 用户要求**去掉界面底部状态栏**（见 `docs/spec/amendments/05-remove-status-bar.md`），
  // 因此 ① 已不存在——这里只断言 ②；③ 由文档评审保证（README「已知行为」第 1 条）。
  assert.ok(
    MODAL.includes('同一站点的窗口正开着时，新设置一律不生效'),
    '高级选项说明行必须写明这条已知行为'
  )
})

test('状态栏已移除：组件、模板用法、状态字段与 CSS 规则都不得复活', () => {
  assert.ok(!APP.includes('StatusBar'), 'App.vue 不得再引用 StatusBar')
  assert.ok(!APP.includes('statusKind'), 'App.vue 不得再有 statusKind 状态')
  assert.ok(!APP.includes('statusCollapsed'), 'App.vue 不得再有 statusCollapsed 状态')
  assert.ok(!APP.includes('statusbar'), 'App.vue 不得再有 statusbar 相关标记')
  assert.ok(!STYLES.includes('.statusbar'), 'styles.css 不得再有 .statusbar 规则')
  assert.ok(
    !existsSync(fileURLToPath(new URL('../src/components/StatusBar.vue', import.meta.url))),
    'src/components/StatusBar.vue 必须已删除'
  )
  // 但 `setStatus` **必须保留**（唯一的诊断通道，只是改为只写控制台）
  assert.ok(APP.includes('function setStatus('), 'setStatus 必须保留为诊断通道')
  assert.ok(APP.includes('console.error(`[webapp] ${text}`)'), '失败文案必须走 console.error')
  assert.ok(/console\.info\(`\[webapp\] \$\{text\}`\)/.test(APP), '普通文案必须走 console.info')
  assert.ok(!APP.includes('status.value = text'), 'setStatus 不得再写任何响应式 UI 状态')
})

test('主题兜底表与样式表保持同步（消费必有兜底；状态栏 token 不得残留）', () => {
  // 1) 兜底表必须非空
  const fallbackKeys = [...THEME.matchAll(/^ {2}'(--[a-z0-9-]+)'/gm)].map((m) => m[1])
  assert.ok(fallbackKeys.length > 0, 'theme.js 必须导出 FALLBACK_TOKENS')
  const declared = new Set(fallbackKeys)
  // 2) `styles.css` 里 `var(--x)` 消费的每个 token 都必须有兜底值（推送未达也不空白）
  const consumed = [...new Set([...STYLES.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => m[1]))]
  const layoutVars = ['--radius', '--radius-lg', '--label-w']
  assert.deepEqual(
    consumed.filter((name) => !layoutVars.includes(name) && !declared.has(name)),
    [],
    '这些 token 被消费但没有兜底值'
  )
  // 3) 状态栏 token 必须随状态栏一起消失。
  //    ⚠️ 这里**不**断言"兜底表的每一项都被消费"——宿主有 25 个 token，而本界面只用其中一部分
  //    （`--bg-titlebar` / `--fg-link` / `--selection-bg` / `--nav-icon(-size)` / `--icon-size`
  //    在 1.0.1 之前也从未被本界面消费），把"全部都被消费"当门禁会得到假红。
  //    真正要防的是"删掉的功能留下兜底残留"，因此逐个点名删掉的东西。
  assert.ok(!declared.has('--statusbar-bg'), '状态栏已删除，兜底表不得再留 --statusbar-bg')
  assert.ok(!declared.has('--statusbar-fg'), '状态栏已删除，兜底表不得再留 --statusbar-fg')
  assert.ok(
    !/--statusbar[a-z-]*'\s*:/.test(THEME),
    'theme.js 里不得再有任何 statusbar token 的赋值'
  )
  assert.ok(!STYLES.includes('statusbar'), 'styles.css 不得再引用 statusbar')
})

test('搜索框：复用 .input、Esc 清空、无匹配复用同一空态（与 rdp 同形态）', () => {
  assert.ok(APP.includes('class="input search__input"'), '搜索框必须复用 .input 样式')
  assert.ok(APP.includes('搜索名称 / 地址 / 说明'), '占位文案必须说明搜哪些字段')
  assert.ok(APP.includes('@keydown.esc="clearQuery"'), 'Esc 必须清空搜索')
  assert.ok(APP.includes('function clearQuery()'), '清空必须是显式函数（Esc 用）')
  assert.ok(APP.includes('filterAndRank'), '过滤必须走 src/search.js 的纯函数')
  // 空态复用同一个组件（不新造第二套）
  const emptyUses = APP.match(/<EmptyState/g) ?? []
  assert.equal(emptyUses.length, 2, '应该只有两种空态：还没有条目 / 无匹配，且都用 EmptyState')
  assert.ok(APP.includes('没有匹配的网页应用'), '无匹配空态必须有专门文案')
  assert.ok(
    APP.includes(':show-action="false"'),
    '无匹配空态不应再给按钮（清空走 Esc，与 rdp 一致）'
  )
})

test('搜索框美化：胶囊形 + 内嵌放大镜 + 限宽 400px（与 extensions/rdp 逐项一致）', () => {
  // 1) 结构：字段容器内有大镜图标 + 输入框
  assert.ok(APP.includes('class="search"'), '必须有 .search 容器')
  assert.ok(APP.includes('class="search__field"'), '必须有 .search__field 容器')
  assert.ok(APP.includes('class="search__icon"'), '必须有放大镜图标')
  assert.ok(
    APP.includes('stroke="currentColor"'),
    '放大镜必须用 currentColor（色值只由 CSS token 决定，SVG 里不许写色值）'
  )
  // 2) 样式关键值
  assert.match(
    STYLES,
    /\.search\s*\{[^}]*padding:\s*20px 20px 0/,
    '.search 的左右内边距须与 .app__grid 一致'
  )
  assert.match(
    STYLES,
    /\.search__field\s*\{[^}]*max-width:\s*400px/,
    '.search__field 必须限宽 400px'
  )
  assert.match(
    STYLES,
    /\.search__icon\s*\{[^}]*color:\s*var\(--fg-dim\)/,
    '放大镜默认色必须是 --fg-dim'
  )
  assert.match(
    STYLES,
    /\.search__field:focus-within \.search__icon\s*\{[^}]*color:\s*var\(--accent\)/,
    '聚焦时放大镜必须转 --accent'
  )
  // 3) **层叠坑**：必须是 `.search .search__input`（0,2,0），不能是单类（0,1,0）
  assert.match(
    STYLES,
    /\.search \.search__input\s*\{[^}]*border-radius:\s*999px/,
    '必须用 .search .search__input 才能压过后面的 .input（靠特异度，不靠顺序）'
  )
  assert.match(
    STYLES,
    /\.search \.search__input\s*\{[^}]*padding-left:\s*30px/,
    '左内边距要给图标让位'
  )
  assert.match(STYLES, /\.search \.search__input\s*\{[^}]*min-height:\s*32px/, '高度 32px')
  // 不允许退回旧的单类写法（那会被 .input 覆盖）
  assert.ok(
    !/^\s*\.search__input\s*\{/m.test(STYLES),
    '不得出现单类 `.search__input {`（会被后面的 .input 覆盖）'
  )
})

test('反向用例：源码里不得出现 SingletonLock（Windows 上不存在该文件）', () => {
  const dirs = ['', 'components/']
  for (const dir of dirs) {
    const abs = new URL(`../src/${dir}`, import.meta.url)
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (!/\.(js|vue|css|html)$/.test(entry.name)) continue
      const text = readFileSync(new URL(entry.name, abs), 'utf8')
      assert.ok(
        !text.includes('SingletonLock'),
        `src/${dir}${entry.name} 出现了 SingletonLock（Windows 上不存在，判据必须靠 rename/删除的成败）`
      )
    }
  }
})
