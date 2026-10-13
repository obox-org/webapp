<script setup>
/**
 * 覆盖确认框（规格 §8.2 / §9.4「覆盖语义的确认步骤」；P1 = B 的唯一闸门）。
 *
 * 为什么必须有这个框、且**只能按钮关闭**：
 * 目标根下已存在同名目录时，迁移的处置是「**先递归删除目标同名目录 → 再把源搬过去**」，
 * 目标里原有的浏览器数据（含登录态、Cookie、书签、IndexedDB）**永久丢失且无法恢复**。
 * 用户已明确接受这一后果（P1 = B），但**没有**授权静默覆盖 —— 因此：
 * - 必须**逐条列出**将被覆盖的目录名（完整列出，不截断、不折叠）；
 * - 必须写明"永久删除且无法恢复"；
 * - 关闭口径与其它模态框一致：点遮罩、按 Esc **都不**关闭，只能走「取消 / 覆盖并继续」两个按钮；
 * - **不提供**"备份目标"选项（P1 = B：不做任何备份，`items[].backup` 恒为 null）。
 */
import { nextTick, onMounted, ref } from 'vue'

const props = defineProps({
  /** 将被覆盖的条目目录名（**逐条完整列出**） */
  names: { type: Array, default: () => [] },
  /** 覆盖请求进行中 */
  submitting: { type: Boolean, default: false }
})

const emit = defineEmits(['close', 'confirm'])

const cancelButton = ref(null)

onMounted(() => {
  // 破坏性操作：焦点落在「取消」上，避免回车误触覆盖
  nextTick(() => cancelButton.value?.focus())
})
</script>

<template>
  <div class="overlay">
    <div
      class="modal modal--sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="webapp-overwrite-title"
      tabindex="-1"
    >
      <header class="modal__header">
        <h2 id="webapp-overwrite-title" class="modal__title">
          有 {{ names.length }} 个站点在目标目录里已经有数据，迁移会覆盖它们
        </h2>
      </header>
      <div class="modal__body">
        <!-- 逐条完整列出（不截断、不折叠）：用户必须看到**具体哪几个**目录会被删 -->
        <ul class="overwrite__list">
          <li v-for="name in names" :key="name" class="overwrite__item">{{ name }}</li>
        </ul>
        <p class="modal__text">目标目录里已有的浏览器数据（含登录态）会被永久删除且无法恢复。</p>
        <p class="modal__hint">
          覆盖是不可逆的：本扩展不会为被覆盖的目录保留备份。若想保留它们，请点「取消」，先自行备份或改名。
        </p>
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
          {{ submitting ? '覆盖中…' : '覆盖并继续' }}
        </button>
      </footer>
    </div>
  </div>
</template>
