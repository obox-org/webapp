/**
 * 组件库接入门禁（v1.1 起）。
 *
 * 本扩展已**不再带样式表**：按钮/输入/卡片/弹窗/空态/页架的外观全部来自宿主组件库
 * `app://obox/ui.css`（`obox-*` class，纯 CSS、只消费主题 token）。因此这里守的是"扩展这一侧"：
 * 1. 不再有自带 CSS；
 * 2. 页面确实引入了组件库；
 * 3. 组件只用库的 class（旧 `.card__*` / `.modal__*` / `.field__*` / `.btn` 不许回来）；
 * 4. 表单字段仍保留 4 个槽位（label / control / desc / error）与勾选/成对字段的特殊结构。
 *
 * 视觉与"零色值字面量"的通用约束由宿主的 `test/ui-css.test.ts` 守着。
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import test from 'node:test'

const SRC = new URL('../src/', import.meta.url)

function read(rel) {
  return readFileSync(new URL(rel, SRC), 'utf8')
}

function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
}

const COMPONENTS = readdirSync(new URL('components/', SRC))
  .filter((name) => name.endsWith('.vue'))
  .map((name) => ({ name, text: stripComments(read(`components/${name}`)) }))
const APP = stripComments(read('App.vue'))

test('src 下不再有自带样式表', () => {
  const css = [...readdirSync(SRC), ...readdirSync(new URL('components/', SRC))].filter((name) =>
    name.endsWith('.css')
  )
  assert.deepEqual(css, [], '不应再有 .css 文件；需要通用外观请在宿主 ui.css 里补组件')
})

test('页面引入宿主组件库 app://obox/ui.css', () => {
  const html = read('index.html')
  assert.match(html, /<link[^>]+rel="stylesheet"[^>]+href="app:\/\/obox\/ui\.css"/)
  assert.match(html, /<body[^>]*class="obox-base"/)
})

test('main.js 不再 import 本地样式表', () => {
  assert.ok(!/\.css['"]/.test(read('main.js')))
})

test('组件只用组件库 class：旧类名一律不许回来', () => {
  for (const { name, text } of [{ name: 'App.vue', text: APP }, ...COMPONENTS]) {
    const tokens = []
    for (const m of text.matchAll(/(?<!:)class="([^"]+)"/g)) {
      for (const token of m[1].split(/\s+/)) if (token) tokens.push(token)
    }
    const offenders = tokens.filter((token) => !token.startsWith('obox-'))
    assert.deepEqual(offenders, [], `${name} 仍有非组件库 class：${offenders.join(', ')}`)
  }
})

test('页面骨架 / 卡片网格 / 搜索框用库', () => {
  assert.ok(APP.includes('obox-page'))
  assert.ok(APP.includes('obox-page__header'))
  assert.ok(APP.includes('obox-card-grid'))
  assert.ok(APP.includes('obox-input-group'))
  assert.ok(APP.includes('obox-input-group__prefix'))
})

test('卡片 / 空态 / 弹窗用库结构', () => {
  const card = COMPONENTS.find((c) => c.name === 'WebappCard.vue').text
  const empty = COMPONENTS.find((c) => c.name === 'EmptyState.vue').text
  const modal = COMPONENTS.find((c) => c.name === 'WebappModal.vue').text
  for (const cls of ['obox-card', 'obox-card__header', 'obox-card__footer']) {
    assert.ok(card.includes(cls), `WebappCard.vue 缺少 ${cls}`)
  }
  assert.ok(empty.includes('obox-empty'))
  for (const cls of ['obox-modal__mask', 'obox-modal__panel', 'obox-modal__header', 'obox-modal__body', 'obox-modal__footer']) {
    assert.ok(modal.includes(cls), `WebappModal.vue 缺少 ${cls}`)
  }
  assert.ok(modal.includes('obox-disclosure'), '高级选项应使用库的折叠区')
  assert.ok(modal.includes('obox-form-section'), '表单分组应使用库的分组标题')
})

test('表单字段仍保留 4 个槽位与特殊结构', () => {
  const field = COMPONENTS.find((c) => c.name === 'WebappField.vue').text
  for (const cls of [
    'obox-form-row',
    'obox-form-row__label',
    'obox-form-row__control',
    'obox-form-row__desc',
    'obox-form-row__error'
  ]) {
    assert.ok(field.includes(cls), `WebappField.vue 缺少 ${cls}`)
  }
  assert.match(field, /v-if="field\.type === 'check'"/)
  assert.ok(field.includes('obox-form-row__label" aria-hidden="true"'))
  assert.ok(field.includes('obox-field-pair'), '成对字段（宽×高 或 路径对）应用库的成对布局')
})

test('忙碌态用语义属性而不是私有类', () => {
  const card = COMPONENTS.find((c) => c.name === 'WebappCard.vue').text
  assert.ok(card.includes(':aria-busy="state === \'opening\'"'))
  assert.ok(!card.includes('card--busy'))
})
