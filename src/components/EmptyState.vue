<script setup>
/**
 * 空态（规格 §15.1 的卡片网格与空态；1.0.1 起同时承担"搜索无匹配"）。
 *
 * 一个组件两种用法（**不新造第二套空态**，与 `extensions/rdp/src/components/EmptyState.vue` 同形态）：
 * - 还没有任何条目：「还没有网页应用」+「＋ 新建」（默认值）；
 * - 搜索无匹配：「没有匹配的网页应用」+ **不给按钮**（`:show-action="false"`）——
 *   清空搜索走搜索框自己的 `Esc`，空态里不重复放一个按钮。
 *
 * 文案与按钮都从外面传，因此这里不写死任何一种场景。不画插图（避免自造色值）。
 */
defineProps({
  /** 主标题 */
  title: { type: String, default: '还没有网页应用' },
  /** 说明行 */
  hint: {
    type: String,
    default: '把内部站点登记进来，点一下就用独立的 Chrome 应用窗口打开。'
  },
  /** 主行动按钮文案 */
  actionLabel: { type: String, default: '＋ 新建' },
  /** 是否显示主按钮（搜索无匹配时没有"要新建"的语义） */
  showAction: { type: Boolean, default: true }
})

const emit = defineEmits(['action'])
</script>

<template>
  <div class="empty">
    <p class="empty__title">{{ title }}</p>
    <p class="empty__hint">{{ hint }}</p>
    <button v-if="showAction" type="button" class="btn btn--primary" @click="emit('action')">
      {{ actionLabel }}
    </button>
  </div>
</template>
