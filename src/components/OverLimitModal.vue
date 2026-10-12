<script setup>
/**
 * 体积超限拦截（R17 的 §15.2 第 6 条）。
 *
 * 三条：
 * 1. **只有三个按钮**：清理缓存并打开 / 仍然打开 / 取消（点遮罩与 Esc 都不关闭）；
 * 2. 必须显示**当前占用 / 上限 / 可清理缓存**三个数字（让用户看清"清了也不够"的现实）；
 * 3. 必须写明"清理缓存会删除该站点的网页缓存，但保留登录状态与 Cookie"。
 */
import { computed, nextTick, onMounted, ref } from 'vue'

const props = defineProps({
  name: { type: String, required: true },
  /** 当前占用字节 */
  bytes: { type: Number, default: 0 },
  /** 上限字节（0 = 未设上限） */
  limitBytes: { type: Number, default: 0 },
  /** 可清理的缓存字节 */
  cacheBytes: { type: Number, default: 0 },
  /** 清理中 / 打开中 */
  busy: { type: Boolean, default: false }
})

const emit = defineEmits(['clean', 'force', 'close'])

const cancelButton = ref(null)

onMounted(() => {
  nextTick(() => cancelButton.value?.focus())
})

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

/** 清理后仍可能超限：如实说明"剩余占用主要不是缓存" */
const cleanWouldHelp = computed(() => props.cacheBytes > 0)
const message = computed(() =>
  cleanWouldHelp.value
    ? '清理缓存会删除该站点的网页缓存，但保留登录状态与 Cookie。'
    : '可清理的缓存已经很小——剩余占用主要不是缓存（例如网站离线数据），清理帮助有限。'
)
</script>

<template>
  <div class="overlay">
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="webapp-limit-title"
      tabindex="-1"
    >
      <header class="modal__header">
        <h2 id="webapp-limit-title" class="modal__title">「{{ name }}」的浏览器数据超过上限</h2>
      </header>
      <div class="modal__body">
        <ul class="limit-list">
          <li>
            当前占用：<strong>{{ formatBytes(bytes) }}</strong>
          </li>
          <li>
            设定上限：<strong>{{ limitBytes > 0 ? formatBytes(limitBytes) : '未设上限' }}</strong>
          </li>
          <li>
            可清理缓存：<strong>{{ formatBytes(cacheBytes) }}</strong>
          </li>
        </ul>
        <p class="modal__text">{{ message }}</p>
        <p class="modal__hint">
          超限只是打开前拦截，<strong>不会</strong>自动删除任何数据；「仍然打开」不改变设置，下次打开仍会拦截。
        </p>
      </div>
      <footer class="modal__footer">
        <button
          ref="cancelButton"
          type="button"
          class="btn"
          :disabled="busy"
          @click="emit('close')"
        >
          取消
        </button>
        <button type="button" class="btn" :disabled="busy" @click="emit('force')">仍然打开</button>
        <button
          type="button"
          class="btn btn--primary"
          :disabled="busy || !cleanWouldHelp"
          @click="emit('clean')"
        >
          <span v-if="busy" class="spinner" aria-hidden="true"></span>
          {{ busy ? '清理中…' : '清理缓存并打开' }}
        </button>
      </footer>
    </div>
  </div>
</template>
