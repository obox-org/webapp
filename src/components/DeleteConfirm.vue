<script setup>
/**
 * 删除二次确认（规格 §15.2 第 2 条）。
 *
 * **文案是硬要求**：必须写明"连该站点的浏览器数据一起删除、且不可恢复"，
 * `test/componentSource.test.js` 断言"不可恢复"与"浏览器数据"两个关键词存在。
 *
 * 破坏性操作：打开时焦点落在「取消」上，避免 Enter 误删；只有删除按钮用危险色。
 * 关闭口径与主模态框一致：点遮罩、按 Esc 都**不**关闭，只能走「取消」「删除」按钮。
 */
import { nextTick, onMounted, ref } from 'vue'

const props = defineProps({
  /** 条目名称 */
  name: { type: String, required: true },
  /** 删除请求进行中 */
  submitting: { type: Boolean, default: false },
  /** 删除前的磁盘状态提示（来自 `profileInfo` 的只读探测；空串 = 不显示） */
  warning: { type: String, default: '' }
})

const emit = defineEmits(['close', 'confirm'])

const cancelButton = ref(null)

onMounted(() => {
  nextTick(() => cancelButton.value?.focus())
})
</script>

<template>
  <div class="overlay">
    <div
      class="modal modal--sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="webapp-delete-title"
      tabindex="-1"
    >
      <header class="modal__header">
        <h2 id="webapp-delete-title" class="modal__title">删除网页应用「{{ name }}」？</h2>
      </header>
      <div class="modal__body">
        <p v-if="warning" class="modal__hint">{{ warning }}</p>
        <p class="modal__text">
          这会同时删除该站点的浏览器数据（登录状态、Cookie、缓存），删除后不可恢复。
        </p>
        <p class="modal__hint">若该站点的窗口正开着，请先关闭它，否则删除会失败。</p>
      </div>
      <footer class="modal__footer">
        <button
          ref="cancelButton"
          type="button"
          class="btn"
          :disabled="submitting"
          @click="emit('close')"
        >
          取消
        </button>
        <button
          type="button"
          class="btn btn--danger"
          :disabled="submitting"
          @click="emit('confirm')"
        >
          <span v-if="submitting" class="spinner" aria-hidden="true"></span>
          {{ submitting ? '删除中…' : '删除' }}
        </button>
      </footer>
    </div>
  </div>
</template>
