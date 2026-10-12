/**
 * 组件源码门禁（**读源码断言关键接线**，与宿主 `test/app-window-wiring.test.ts` 同款手法；
 * 规格 §15.1 / §15.2 的硬要求逐条落在此处）。
 *
 * 为什么读源码而不是挂载组件：扩展没有 jsdom / @vue/test-utils。下面这些接线一旦被改回去，
 * 其它用例**全是绿的**——最典型的就是"模态框又能按 Esc 关闭了"。
 */
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
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

test('"同站点窗口开着时新设置一律不生效"必须出现在状态栏文案与高级区说明', () => {
  assert.ok(APP.includes('同站点窗口开着时新设置一律不生效'), '状态栏成功文案必须带该提示')
  assert.ok(
    MODAL.includes('同一站点的窗口正开着时，新设置一律不生效'),
    '高级选项说明行必须写明这条已知行为'
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
