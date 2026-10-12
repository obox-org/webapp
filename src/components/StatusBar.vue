<script setup>
/**
 * 底部状态栏（规格 §15.1）：40px，一行文本记录最近一次操作结果（成功/失败原因原文），
 * 点一下折叠，默认展开。成功/错误色分别用 `--fg-success` / `--fg-error`。
 */
const props = defineProps({
  /** 最近一次操作结果文案 */
  text: { type: String, default: '' },
  /** info | ok | error */
  kind: { type: String, default: 'info' },
  collapsed: { type: Boolean, default: false }
})

const emit = defineEmits(['toggle'])
</script>

<template>
  <footer class="statusbar" :class="[`statusbar--${kind}`, { 'statusbar--collapsed': collapsed }]">
    <button
      type="button"
      class="statusbar__toggle"
      :aria-expanded="!collapsed"
      aria-controls="webapp-status-text"
      :aria-label="collapsed ? '展开状态栏' : '折叠状态栏'"
      @click="emit('toggle')"
    >
      <span aria-hidden="true">{{ collapsed ? '▸' : '▾' }}</span>
    </button>
    <span v-show="!collapsed" id="webapp-status-text" class="statusbar__text" role="status">
      最近：{{ props.text || '就绪' }}
    </span>
  </footer>
</template>
