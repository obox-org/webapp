<script setup>
/**
 * 空态（规格 §15.1 的卡片网格与空态）。
 * 一句说明 + 一个主行动按钮；不画插图（避免自造色值）。
 */
defineProps({
  /** 主行动按钮文案 */
  actionLabel: { type: String, default: '＋ 新建' }
})

const emit = defineEmits(['action'])
</script>

<template>
  <div class="empty">
    <p class="empty__title">还没有网页应用</p>
    <p class="empty__hint">把内部站点登记进来，点一下就用独立的 Chrome 应用窗口打开。</p>
    <button type="button" class="btn btn--primary" @click="emit('action')">
      {{ actionLabel }}
    </button>
  </div>
</template>
