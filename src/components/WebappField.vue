<script setup>
/**
 * 单个表单控件（按 `src/fields.js` 的字段描述渲染）。
 * 只读父级的 form 对象，改动通过 change 事件回传，避免在子组件里改 prop。
 *
 * 结构（沿用 `extensions/rdp/src/components/ConnectionField.vue` 的落位规则）：
 *   `.field` 自身就是**两列栅格**（`--label-w` 固定标签列 + 控件列，见 styles.css），
 *   它的**直接子元素**就是栅格项：
 *     ├─ 第 1 行：`.field__label`（标签列，固定宽 + 左对齐）+ `.field__control`（控件列，左对齐）
 *     └─ 第 2/3 行：`.field__desc` / `.field__error` / `.field__warn`（**只在控件列内**）
 *
 * ⚠️ 不得再给"标签 + 控件"套一层 `.field__row` 之类的**嵌套栅格**：那一层会被外层栅格当成
 * "第 1 列的栅格项"，宽度只剩 `--label-w`，内层的控件列直接塌成 0。
 *
 * 下拉（R14 的"取值说明写在选项内"，D-3 后对本扩展**正式生效**）：
 *   - 可见文本 = `取值 — 短说明`（`options[].label`）；
 *   - 更细的一句放该 `<option>` 的 `title`（`options[].desc`）；
 *   - `optional` 字段最前面多一个空值选项（`value=""`），文本 `不指定（用 Chrome 默认）`。
 *
 * ⚠️ 本扩展的下拉取值是**字符串枚举**（`'1.5'`、`'zh-CN'`），
 * 因此**绝不能**像 rdp 那样写 `Number(raw)`——那会把 `''` 变成 `0`、把 `'1.5'` 变成 `1.5`。
 */
import { computed } from 'vue'

const props = defineProps({
  field: { type: Object, required: true },
  form: { type: Object, required: true },
  error: { type: String, default: '' }
})

const emit = defineEmits(['change'])

const inputId = `webapp-field-${props.field.key}`

/** 说明行：`hint` 优先于 `desc`（一个字段只占一行灰字） */
const desc = computed(() => props.field.hint || props.field.desc || '')

/** 勾选类字段的警示行（`ignoreCert` 的 TLS 降级提示） */
const warn = computed(() =>
  props.field.warnWhenChecked && props.form[props.field.key] ? props.field.warnWhenChecked : ''
)

/** 成对字段的当前值所在键（无 `keys` 时退化为字段自身 key） */
const pairKeys = computed(() => props.field.keys ?? [props.field.key, `${props.field.key}2`])

function change(key, value) {
  emit('change', key, value)
}
</script>

<template>
  <div class="field" :class="{ 'field--full': field.full || field.type === 'textarea' }">
    <!-- 勾选框：标签列留空占位（方框落到控件列 ⇒ 与其它控件的左边缘同一条竖线） -->
    <template v-if="field.type === 'check'">
      <span class="field__label field__label--empty" aria-hidden="true"></span>
      <div class="field__control">
        <label class="check" :for="inputId">
          <input
            :id="inputId"
            type="checkbox"
            :checked="!!form[field.key]"
            @change="change(field.key, $event.target.checked)"
          />
          <span>{{ field.label }}</span>
        </label>
      </div>
    </template>

    <template v-else>
      <label class="field__label" :for="inputId">
        {{ field.label }}
        <span v-if="field.required" class="field__required" aria-hidden="true">*</span>
      </label>

      <div class="field__control">
        <!-- 单行文本 -->
        <input
          v-if="field.type === 'text'"
          :id="inputId"
          class="input"
          :class="{ 'input--error': !!error }"
          type="text"
          :aria-invalid="!!error"
          :value="form[field.key]"
          @input="change(field.key, $event.target.value)"
        />

        <!-- 多行文本（额外 origin：一行一个） -->
        <textarea
          v-else-if="field.type === 'textarea'"
          :id="inputId"
          class="input textarea"
          :class="{ 'input--error': !!error }"
          :rows="field.rows || 4"
          :aria-invalid="!!error"
          :value="form[field.key]"
          @input="change(field.key, $event.target.value)"
        ></textarea>

        <!-- 下拉：选项内自带短说明，更细的一句在该 option 的 title 里 -->
        <select
          v-else-if="field.type === 'select'"
          :id="inputId"
          class="select"
          :class="{ 'select--error': !!error }"
          :aria-invalid="!!error"
          :value="form[field.key]"
          @change="change(field.key, $event.target.value)"
        >
          <option v-if="field.optional" value="" :title="field.emptyDesc">
            {{ field.emptyLabel || '不指定（用 Chrome 默认）' }}
          </option>
          <option
            v-for="option in field.options"
            :key="option.value"
            :value="option.value"
            :title="option.desc"
          >
            {{ option.value }} — {{ option.label }}
          </option>
        </select>

        <!-- 成对输入（窗口尺寸 / 窗口位置） -->
        <div v-else-if="field.type === 'pair'" class="pair">
          <input
            :id="inputId"
            class="input"
            type="text"
            inputmode="numeric"
            :aria-label="`${field.label}（${field.units ? field.units[0] : '前'}）`"
            :value="form[pairKeys[0]]"
            @input="change(pairKeys[0], $event.target.value)"
          />
          <span class="pair__sep" aria-hidden="true">,</span>
          <input
            class="input"
            type="text"
            inputmode="numeric"
            :aria-label="`${field.label}（${field.units ? field.units[1] : '后'}）`"
            :value="form[pairKeys[1]]"
            @input="change(pairKeys[1], $event.target.value)"
          />
        </div>
      </div>
    </template>

    <p v-if="desc" class="field__desc">{{ desc }}</p>
    <p v-if="warn" class="field__warn">{{ warn }}</p>
    <p v-if="error" class="field__error">{{ error }}</p>
  </div>
</template>
