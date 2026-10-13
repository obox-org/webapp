<script setup>
/**
 * 条目卡片（规格 §15.2 的界面规范 + R15 的 TLS 标记）。
 *
 * 每项一行标题 + 一行灰色说明（R14）：
 *   - 标题行：名称（单行省略，`title` 给全量）+ 右侧 **TLS 已降级** 标记（仅 `ignoreCert`）；
 *   - 第 2 行：网址（单行省略）；
 *   - 第 3 行：说明（单行灰字，`min-height` 保证空说明时行高一致）；
 *   - 动作行：打开 / 编辑 / 删除。
 *
 * 悬浮 `title` 里带数据目录提示（规格 §15.2 第 5 条，**被本需求修订为按生效根动态渲染**）：
 * 默认根显示相对形态 `chrome/<名>`；自定义根显示 `<根>\<名>`（根过长时中间省略）——
 * **不在列表上显示实时体积**（避免每次 list 都算目录大小；体积要用户显式点「体积」才查）。
 *
 * ⚠️ **界面不做路径拼接**：`dataDir` 由扩展入口（`index.js`）用 `lib/profileRoot.mjs` 的
 * 唯一实现算好后传进来。子窗口是浏览器环境，**不能** import `lib/*.mjs`
 * （`node:path` 在那里不可用），若在组件里自己拼一份，就会出现"第二份根解析实现"。
 */
import { computed } from 'vue'

const props = defineProps({
  row: { type: Object, required: true },
  /** idle | opening | ok | error */
  state: { type: String, default: 'idle' },
  /** 该条目已查到的体积（`{ bytes, limitBytes }`；未查过为 null） */
  size: { type: Object, default: null },
  /** 体积查询中 */
  sizeLoading: { type: Boolean, default: false },
  /** 数据目录文案（由扩展入口按**生效根**算好；缺省回落到默认根的相对形态） */
  dataDir: { type: String, default: '' }
})

const emit = defineEmits(['open', 'edit', 'delete', 'size'])

const name = computed(() => String(props.row?.name ?? ''))
const url = computed(() => String(props.row?.url ?? ''))
const desc = computed(() => String(props.row?.desc ?? ''))
/** 数据目录名（净化后）——后端在建库时写入 `profileDir`，缺失时退化为名称 */
const profileDir = computed(() => String(props.row?.profileDir || props.row?.name || ''))

/** TLS 降级标记：**仅** `ignoreCert === true` 时渲染（R15 的门禁断言此条件） */
const tlsDegraded = computed(() => props.row?.ignoreCert === true)

/**
 * 数据目录提示（规格 §15.2 第 5 条的修订）：**按生效根动态渲染**。
 *
 * 文案由扩展入口算好（`dataDir` prop）以免在界面里出现第二份根解析实现；
 * 缺省（老界面/未传）时回落到默认根的相对形态，保持 1.0.2 的文案不变。
 */
const dataDirText = computed(() => String(props.dataDir || '') || `chrome/${profileDir.value}`)

const cardTitle = computed(() => `数据目录：${dataDirText.value}；体积可能达到 GB 级`)

/** 体积展示（按需查询才有值；规格 §15.2 第 5 条） */
const sizeText = computed(() => {
  if (!props.size) return ''
  const used = formatBytes(props.size.bytes)
  if (props.size.limitBytes > 0) return `已用 ${used} / 上限 ${formatBytes(props.size.limitBytes)}`
  return `已用 ${used}（未设上限）`
})

/** 人类可读体积（与 `lib/profileLimit.mjs` 的 formatBytes 同口径；界面不依赖 lib 类型） */
function formatBytes(bytes) {
  const value = Number(bytes)
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let index = 0
  let scaled = value
  while (scaled >= 1024 && index < units.length - 1) {
    scaled /= 1024
    index += 1
  }
  return index === 0
    ? `${Math.round(scaled)} ${units[index]}`
    : `${(Math.round(scaled * 10) / 10).toFixed(1)} ${units[index]}`
}
</script>

<template>
  <article class="card" :class="{ 'card--busy': state === 'opening' }">
    <div class="card__head">
      <h3 class="card__title" :title="`${name}｜${cardTitle}`">{{ name }}</h3>
      <span
        v-if="tlsDegraded"
        class="tls-badge"
        title="该条目的证书校验已关闭，流量可能被同网段攻击者读取或改写。"
        >TLS 已降级</span
      >
    </div>
    <p class="card__url" :title="url">{{ url }}</p>
    <p class="card__subtitle">{{ desc }}</p>
    <p v-if="sizeText || sizeLoading" class="card__size">
      {{ sizeLoading ? '正在统计大小…' : sizeText }}
    </p>

    <div class="card__actions">
      <button
        type="button"
        class="btn"
        :aria-label="`打开 ${name}`"
        :disabled="state === 'opening'"
        @click="emit('open')"
      >
        {{ state === 'opening' ? '正在打开…' : '打开' }}
      </button>
      <button type="button" class="btn" :aria-label="`编辑 ${name}`" @click="emit('edit')">
        编辑
      </button>
      <button
        type="button"
        class="btn"
        :aria-label="`查看 ${name} 的体积`"
        :disabled="sizeLoading"
        @click="emit('size')"
      >
        体积
      </button>
      <button
        type="button"
        class="btn btn--danger"
        :aria-label="`删除 ${name}`"
        @click="emit('delete')"
      >
        删除
      </button>
    </div>
  </article>
</template>
