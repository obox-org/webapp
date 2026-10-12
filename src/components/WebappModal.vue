<script setup>
/**
 * 新建 / 编辑条目模态框（规格 §15.2）。
 *
 * 表单受控：值在本地 reactive form 上，校验通过后 `emit('save', payload)`，
 * 提交中的 loading 与失败原因由父级回传。
 *
 * **关闭路径只有按钮**（R14 的硬要求）：点遮罩、按 Esc 都**不**关闭——
 * 只有右上「✕」「取消」「保存成功」三条路径。守卫见 `test/componentSource.test.js`。
 */
import { computed, reactive, ref, watch } from 'vue'
import WebappField from './WebappField.vue'
import {
  ADVANCED_GROUPS,
  COMMON_GROUPS,
  buildSavePayload,
  defaultForm,
  rowToForm,
  validate,
  visibleFields
} from '../fields.js'

const props = defineProps({
  /** create | edit */
  mode: { type: String, default: 'create' },
  row: { type: Object, default: null },
  /** 现有条目，用于「名称唯一」校验 */
  rows: { type: Array, default: () => [] },
  submitting: { type: Boolean, default: false },
  /** 父级回传的保存失败原因 */
  error: { type: String, default: '' }
})

const emit = defineEmits(['close', 'save'])

/** 表单以 `defaultForm()` 建空壳，再由 props.row 同步（props 是唯一真源） */
const form = reactive(defaultForm())
/** 动过表单（或提交过）才把红字铺出来，避免一打开就满屏红 */
const dirty = ref(false)
const advancedOpen = ref(false)
/** 本地校验结果（父级回传的 `error` 只用于后端失败文案） */
const localErrors = ref({})

watch(
  () => props.row,
  (row) => {
    Object.assign(form, rowToForm(row))
    // 新建时必须清掉可能残留的 id，否则会把"新建"当成"更新"提交
    if (row?.id === undefined || row?.id === null || row?.id === '') delete form.id
    dirty.value = false
    localErrors.value = {}
    advancedOpen.value = row ? hasAdvancedValue(row) : false
  },
  { immediate: true }
)

/** 编辑既有条目时，若任一高级字段有值就自动展开高级区（否则用户看不到自己配过什么） */
function hasAdvancedValue(row) {
  return ['windowSize', 'windowPos', 'startMaximized', 'lang', 'scaleFactor', 'disableGpu'].some(
    (key) => {
      const value = row?.[key]
      if (typeof value === 'boolean') return value
      return value !== undefined && value !== null && String(value) !== ''
    }
  )
}

const title = computed(() => (props.mode === 'edit' ? '编辑网页应用' : '新建网页应用'))

const errorBanner = computed(() => props.error || '')

/** 字段级红字：本地校验（dirty 之后）优先，其次不显示（后端失败走横幅） */
function fieldError(key) {
  if (!dirty.value) return ''
  return localErrors.value[key] || ''
}

function onChange(key, value) {
  form[key] = value
  dirty.value = true
}

function runValidate() {
  const result = validate(form, props.rows)
  localErrors.value = Object.fromEntries(result.errors.map((item) => [item.field, item.message]))
  return result.ok
}

function submit() {
  dirty.value = true
  if (!runValidate()) return
  emit('save', buildSavePayload(form))
}
</script>

<template>
  <div class="overlay">
    <div
      class="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="webapp-modal-title"
      tabindex="-1"
    >
      <header class="modal__header">
        <h2 id="webapp-modal-title" class="modal__title">{{ title }}</h2>
        <button
          type="button"
          class="btn modal__close"
          aria-label="关闭"
          :disabled="submitting"
          @click="emit('close')"
        >
          ✕
        </button>
      </header>

      <div class="modal__body">
        <p v-if="errorBanner" class="alert alert--error">{{ errorBanner }}</p>

        <div v-for="group in COMMON_GROUPS" :key="group.title" class="form-group">
          <WebappField
            v-for="field in visibleFields(group)"
            :key="field.key"
            :field="field"
            :form="form"
            :error="fieldError(field.key)"
            @change="onChange"
          />
        </div>

        <div class="accordion">
          <button
            type="button"
            class="accordion__toggle"
            :aria-expanded="advancedOpen"
            aria-controls="webapp-advanced"
            @click="advancedOpen = !advancedOpen"
          >
            <span aria-hidden="true">{{ advancedOpen ? '▾' : '▸' }}</span>
            高级选项
          </button>
          <div v-show="advancedOpen" id="webapp-advanced" class="accordion__body">
            <div v-for="group in ADVANCED_GROUPS" :key="group.title" class="form-group">
              <WebappField
                v-for="field in visibleFields(group)"
                :key="field.key"
                :field="field"
                :form="form"
                :error="fieldError(field.key)"
                @change="onChange"
              />
            </div>
            <p class="accordion__hint">
              同一站点的窗口正开着时，新设置一律不生效，请先关闭该站点的窗口再打开。
            </p>
          </div>
        </div>
      </div>

      <footer class="modal__footer">
        <button type="button" class="btn" :disabled="submitting" @click="emit('close')">
          取消
        </button>
        <button type="button" class="btn btn--primary" :disabled="submitting" @click="submit">
          <span v-if="submitting" class="spinner" aria-hidden="true"></span>
          {{ submitting ? '保存中…' : '保存' }}
        </button>
      </footer>
    </div>
  </div>
</template>
