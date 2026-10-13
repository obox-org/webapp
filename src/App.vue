<script setup>
/**
 * 网页应用列表页（规格 §15.2 的界面规范 + R17 的体积节流链路）。
 *
 * 数据流：`list` 拉条目 → 卡片网格；新建/编辑走 `WebappModal` → `save`；
 * 删除走 `DeleteConfirm` → `remove`；打开走 `open`。
 *
 * **R17 的三条界面链路**（票 11）：
 * 1. `open` 被体积上限拦截（`error` 以 `[profile-over-limit]` 开头）→ 弹 `OverLimitModal`；
 *    「清理缓存并打开」→ `cleanCaches({ id })` → 重新 `open`；「仍然打开」→ `open({ id, force: true })`；
 * 2. 列表页右上「清理全部缓存」→ 二次确认 → `cleanCaches({})`（结果走控制台，见 `setStatus`）；
 * 3. 卡片上的「体积」按钮 → `profileSize({ id })` **按需**查询（绝不常驻轮询、不在 list 时扫盘）。
 *
 * 界面**从不算体积、从不删数据**：一切都是用户点出来的动作，删除只发生在用户确认之后。
 *
 * ⚠️ **本界面没有底部状态栏**（用户要求"彻底不要提示"，见
 * `docs/spec/amendments/05-remove-status-bar.md`）：所有操作/错误文案只进开发者控制台。
 */
import { computed, nextTick, onMounted, ref } from 'vue'
import WebappCard from './components/WebappCard.vue'
import WebappModal from './components/WebappModal.vue'
import DeleteConfirm from './components/DeleteConfirm.vue'
import OverLimitModal from './components/OverLimitModal.vue'
import EmptyState from './components/EmptyState.vue'
import { callExtension } from './bridge.js'
import { filterAndRank, isSearching } from './search.js'

/** 体积超限的错误前缀（规格 S17：唯一用 `ok:false` 承载"需要用户选择"的场景） */
const OVER_LIMIT_PREFIX = '[profile-over-limit]'

const rows = ref([])
const loading = ref(true)
const loadError = ref('')

/** 模态框状态 */
const modalOpen = ref(false)
const modalMode = ref('create')
const modalRow = ref(null)
const modalSubmitting = ref(false)
const modalError = ref('')

/** 删除确认 */
const deleteOpen = ref(false)
const deleteRow = ref(null)
const deleteSubmitting = ref(false)
/** 删除前的磁盘状态提示（来自 `profileInfo`，只读探测） */
const deleteWarning = ref('')
/** 环境检查进行中 */
const envChecking = ref(false)

/** 体积超限拦截 */
const limitOpen = ref(false)
const limitTarget = ref(null)
const limitInfo = ref({ bytes: 0, limitBytes: 0, cacheBytes: 0 })
const limitBusy = ref(false)

/** 打开中的条目 id（禁用按钮，避免重复点击） */
const openingId = ref(null)
/** 条目 id → 已查到的体积（按需查询后才有值） */
const sizeById = ref({})
/** 正在查体积的条目 id */
const sizeLoadingId = ref(null)

// ---- 搜索（模糊匹配的实现在 `src/search.js`，纯函数、可单测） ----

/** 搜索框的当前输入（原始字符串） */
const query = ref('')
/** 搜索框元素（清空后把焦点还回去） */
const searchInput = ref(null)

/** 是否是"正在搜索"（区分「还没有条目」与「无匹配」两种空态） */
const searching = computed(() => isSearching(query.value))

/**
 * 展示顺序：**按匹配分数降序**（无查询时保持"新条目在最上面"）。
 * 先把后端的 createdAt 升序倒过来，再交给 `filterAndRank` 打分排序。
 */
const displayRows = computed(() => {
  const newestFirst = [...rows.value].reverse()
  if (!searching.value) return newestFirst
  return filterAndRank(newestFirst, query.value)
})

/** 清空搜索（Esc 与「清空」按钮共用；清空后把焦点还给搜索框，方便继续输入） */
function clearQuery() {
  query.value = ''
  nextTick(() => searchInput.value?.focus())
}

/**
 * 记录一次操作结果。
 *
 * ⚠️ **用户已要求界面不显示操作/错误提示**（连 R8 的"未找到 Chrome 时列出查找过的路径"
 * 也不再显示），因此这里**只写控制台**、不写任何 UI。
 *
 * 为什么保留全部调用点而不是把调用删掉：这些日志是**唯一的诊断通道**
 * （子窗口日志会经主进程转发到终端，前缀 `[child-renderer:*]`）。
 * 出问题时让用户开 DevTools / 看终端即可还原完整过程。
 *
 * @param {string} text 面向人的一句话
 * @param {'info'|'ok'|'error'} [kind] 成功走 `console.info`、失败走 `console.error`
 */
function setStatus(text, kind = 'info') {
  if (kind === 'error') console.error(`[webapp] ${text}`)
  else console.info(`[webapp] ${text}`)
}

function messageOf(err) {
  return err instanceof Error ? err.message : String(err)
}

async function load() {
  loading.value = true
  loadError.value = ''
  try {
    const data = await callExtension('list', {})
    rows.value = Array.isArray(data) ? data : []
  } catch (err) {
    loadError.value = messageOf(err)
  } finally {
    loading.value = false
  }
}

onMounted(() => {
  void load()
})

// ---- 新建 / 编辑 ----

function openCreate() {
  modalMode.value = 'create'
  modalRow.value = null
  modalError.value = ''
  modalOpen.value = true
}

function openEdit(row) {
  modalMode.value = 'edit'
  modalRow.value = row
  modalError.value = ''
  modalOpen.value = true
}

function closeModal() {
  if (modalSubmitting.value) return
  modalOpen.value = false
}

async function onSave(payload) {
  modalSubmitting.value = true
  modalError.value = ''
  try {
    const saved = await callExtension('save', payload)
    const isEdit = modalMode.value === 'edit'
    modalOpen.value = false
    setStatus(`已${isEdit ? '保存' : '新建'}网页应用 ${saved?.name ?? payload.name}`, 'ok')
    await load()
  } catch (err) {
    // 字段级错误在模态框内展示（文案由后端 `lib/webapp.mjs` 给出，与界面同一套）
    modalError.value = messageOf(err)
  } finally {
    modalSubmitting.value = false
  }
}

// ---- 删除 ----

async function openDelete(row) {
  deleteRow.value = row
  deleteOpen.value = true
  deleteWarning.value = ''
  // 删除前用 `profileInfo` 探一次磁盘状态（**只读，不改任何状态**）：
  // 目录根本不存在 → 提示"只会删条目"；被占用 → 提前说"先关窗口"，
  // 比等删除失败再报错更友好。
  try {
    const info = await callExtension('profileInfo', { id: row.id })
    if (!info?.exists) {
      deleteWarning.value = '该站点还没有浏览器数据（未打开过），本次只会删除条目。'
    } else if (info?.locked) {
      deleteWarning.value = '检测到该站点的窗口可能正开着，请先关闭它，否则删除会失败。'
    }
  } catch {
    // 探不到就不提示：不能让"探不到状态"挡住用户删除
  }
}

function closeDelete() {
  if (deleteSubmitting.value) return
  deleteOpen.value = false
}

// ---- 环境检查（probe）----

/**
 * 「环境检查」：把助手的 Chrome 探测结果展示出来（R8 的"明确报错、不静默换浏览器"）。
 * 未找到时**原样列出查找过的路径**，方便用户判断是不是装在自定义位置。
 */
async function checkEnvironment() {
  envChecking.value = true
  try {
    const info = await callExtension('probe', {})
    const chrome = info?.chrome
    if (chrome?.path) {
      const version = chrome.version ? `，版本 ${chrome.version}` : ''
      setStatus(`已找到 Chrome（${chrome.source}）：${chrome.path}${version}`, 'ok')
    } else {
      const searched = (info?.chromeCandidates ?? []).map((item) => item.path).join('；')
      setStatus(`未找到 Chrome（已查找：${searched}）`, 'error')
    }
  } catch (err) {
    setStatus(`环境检查失败：${messageOf(err)}`, 'error')
  } finally {
    envChecking.value = false
  }
}

async function confirmDelete() {
  const row = deleteRow.value
  if (!row) return
  deleteSubmitting.value = true
  try {
    await callExtension('remove', { id: row.id })
    deleteOpen.value = false
    setStatus(`已删除网页应用 ${row.name}`, 'ok')
    await load()
  } catch (err) {
    deleteOpen.value = false
    setStatus(messageOf(err), 'error')
  } finally {
    deleteSubmitting.value = false
  }
}

// ---- 打开（含体积预检拦截，R17） ----

async function doOpen(row, force = false) {
  openingId.value = row.id
  setStatus(`正在打开 ${row.name}…`)
  try {
    const data = await callExtension('open', force ? { id: row.id, force: true } : { id: row.id })
    const warnings = Array.isArray(data?.warnings) ? data.warnings : []
    const suffix = '（同站点窗口开着时新设置一律不生效，请先关闭该窗口）'
    setStatus(
      warnings.length
        ? `已打开 ${row.name}：${warnings.join('；')}${suffix}`
        : `已打开 ${row.name}${suffix}`,
      'ok'
    )
  } catch (err) {
    const message = messageOf(err)
    if (message.startsWith(OVER_LIMIT_PREFIX)) {
      // 需要用户选择：弹出拦截模态框（不是"错误"，是"超限"）
      limitTarget.value = row
      // 扩展侧的 `data` 在这一层拿不到（错误信封只带 message），因此**重新量一次**
      // 以便模态框显示真实数字（走助手的 60s 缓存，通常命中、不扫盘）
      limitInfo.value = { bytes: 0, limitBytes: 0, cacheBytes: 0 }
      limitOpen.value = true
      setStatus(`「${row.name}」的浏览器数据超过上限，已暂停打开`, 'error')
      void refreshLimitInfo(row)
      return
    }
    setStatus(`打开 ${row.name} 失败：${message}`, 'error')
  } finally {
    openingId.value = null
  }
}

/** 补全拦截模态框里的三个数字（失败就保持 0，不挡用户做选择） */
async function refreshLimitInfo(row) {
  try {
    const info = await callExtension('profileSize', { id: row.id })
    limitInfo.value = {
      bytes: Number(info?.bytes ?? 0),
      limitBytes: Number(info?.limitBytes ?? 0),
      cacheBytes: Number(info?.cacheBytes ?? 0)
    }
  } catch {
    // 量不到体积不该挡住"仍然打开"：数字留空即可
  }
}

/** 拦截模态框：清理缓存后重新打开 */
async function cleanAndOpen() {
  const row = limitTarget.value
  if (!row) return
  limitBusy.value = true
  try {
    const cleaned = await callExtension('cleanCaches', { id: row.id })
    const freed = Number(cleaned?.totalFreedBytes ?? 0)
    // 清理后重新预检：交给 `open` 自己再判一次（设置没变，仍超限就再弹）
    limitOpen.value = false
    delete sizeById.value[row.id]
    setStatus(`已清理缓存，释放 ${formatBytes(freed)}，正在重新打开…`, 'ok')
    await doOpen(row)
  } catch (err) {
    setStatus(`清理缓存失败：${messageOf(err)}`, 'error')
  } finally {
    limitBusy.value = false
  }
}

/** 拦截模态框：仍然打开（**不持久化**：下次打开仍会拦截） */
async function forceOpen() {
  const row = limitTarget.value
  if (!row) return
  limitOpen.value = false
  await doOpen(row, true)
}

function closeLimit() {
  if (limitBusy.value) return
  limitOpen.value = false
}

// ---- 全局「清理全部缓存」（R17） ----

const cleanAllOpen = ref(false)
const cleanAllBusy = ref(false)

async function confirmCleanAll() {
  cleanAllBusy.value = true
  try {
    const result = await callExtension('cleanCaches', {})
    const cleaned = Array.isArray(result?.cleaned) ? result.cleaned : []
    const skipped = Array.isArray(result?.skipped) ? result.skipped : []
    const freed = Number(result?.totalFreedBytes ?? 0)
    const cleanedCount = cleaned.filter((item) => (item?.removedDirs ?? []).length > 0).length
    const parts = [`已清理 ${cleanedCount} 项，释放 ${formatBytes(freed)}`]
    if (skipped.length) {
      parts.push(`${skipped.length} 项被跳过（可能窗口正开着，请先关闭该站点的窗口）`)
    }
    setStatus(parts.join('；'), skipped.length ? 'error' : 'ok')
    sizeById.value = {}
    cleanAllOpen.value = false
  } catch (err) {
    setStatus(`清理全部缓存失败：${messageOf(err)}`, 'error')
    cleanAllOpen.value = false
  } finally {
    cleanAllBusy.value = false
  }
}

// ---- 按需查询体积（R17：绝不常驻轮询） ----

async function querySize(row) {
  sizeLoadingId.value = row.id
  try {
    const info = await callExtension('profileSize', { id: row.id, force: true })
    sizeById.value = {
      ...sizeById.value,
      [row.id]: { bytes: Number(info?.bytes ?? 0), limitBytes: Number(info?.limitBytes ?? 0) }
    }
    setStatus(`已查询 ${row.name} 的体积`, 'ok')
  } catch (err) {
    setStatus(`查询体积失败：${messageOf(err)}`, 'error')
  } finally {
    sizeLoadingId.value = null
  }
}

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
  <div class="app">
    <header class="app__header">
      <h1 class="app__title">网页应用</h1>
      <div class="app__actions">
        <button type="button" class="btn" :disabled="envChecking" @click="checkEnvironment">
          {{ envChecking ? '检查中…' : '环境检查' }}
        </button>
        <button type="button" class="btn" @click="cleanAllOpen = true">清理全部缓存</button>
        <button type="button" class="btn btn--primary" @click="openCreate">＋ 新建</button>
      </div>
    </header>

    <main class="app__main">
      <p v-if="loading" class="app__loading">正在加载…</p>
      <p v-else-if="loadError" class="alert alert--error">{{ loadError }}</p>
      <template v-else>
        <!-- 搜索框（v1.0.2）：只在确实有条目时出现；输入即过滤，Esc 清空。
             形态与 extensions/rdp 的搜索框**逐项一致**：胶囊形 + 内嵌放大镜 + 限宽 400px。 -->
        <div class="search">
          <div class="search__field">
            <!-- 放大镜：描边取 currentColor（颜色由 CSS 的 token 决定，这里不写任何色值） -->
            <svg class="search__icon" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <circle
                cx="6.5"
                cy="6.5"
                r="4.5"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
              />
              <path
                d="M10 10l4.2 4.2"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
            <input
              ref="searchInput"
              v-model="query"
              type="text"
              class="input search__input"
              placeholder="搜索名称 / 地址 / 说明"
              aria-label="搜索网页应用"
              @keydown.esc="clearQuery"
            />
          </div>
        </div>

        <EmptyState
          v-if="!rows.length"
          title="还没有网页应用"
          hint="把内部站点登记进来，点一下就用独立的 Chrome 应用窗口打开。"
          action-label="＋ 新建"
          @action="openCreate"
        />
        <!-- 无匹配：复用同一个空态组件（不新造一套）；清空走搜索框自己的 Esc，这里不重复给按钮 -->
        <EmptyState
          v-else-if="searching && !displayRows.length"
          title="没有匹配的网页应用"
          hint="换个关键词试试；按 Esc 清空搜索框即可恢复全部"
          :show-action="false"
        />
        <div v-else class="app__grid">
          <WebappCard
            v-for="row in displayRows"
            :key="row.id"
            :row="row"
            :state="openingId === row.id ? 'opening' : 'idle'"
            :size="sizeById[row.id] || null"
            :size-loading="sizeLoadingId === row.id"
            @open="doOpen(row)"
            @edit="openEdit(row)"
            @delete="openDelete(row)"
            @size="querySize(row)"
          />
        </div>
      </template>
    </main>

    <WebappModal
      v-if="modalOpen"
      :mode="modalMode"
      :row="modalRow"
      :rows="rows"
      :submitting="modalSubmitting"
      :error="modalError"
      @close="closeModal"
      @save="onSave"
    />

    <DeleteConfirm
      v-if="deleteOpen && deleteRow"
      :name="deleteRow.name"
      :submitting="deleteSubmitting"
      :warning="deleteWarning"
      @close="closeDelete"
      @confirm="confirmDelete"
    />

    <OverLimitModal
      v-if="limitOpen && limitTarget"
      :name="limitTarget.name"
      :bytes="limitInfo.bytes"
      :limit-bytes="limitInfo.limitBytes"
      :cache-bytes="limitInfo.cacheBytes"
      :busy="limitBusy"
      @clean="cleanAndOpen"
      @force="forceOpen"
      @close="closeLimit"
    />

    <!-- 全局清理的二次确认：文案必须写清"保留登录状态"与"先关闭窗口" -->
    <div v-if="cleanAllOpen" class="overlay">
      <div
        class="modal modal--sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="webapp-clean-title"
      >
        <header class="modal__header">
          <h2 id="webapp-clean-title" class="modal__title">清理全部站点的网页缓存？</h2>
        </header>
        <div class="modal__body">
          <p class="modal__text">
            会删除所有站点的网页缓存，但保留登录状态与 Cookie；清理期间请先关闭这些站点的窗口。
          </p>
          <p class="modal__hint">
            只清缓存目录，不动条目、不动登录态；被占用的目录会跳过并如实报告。
          </p>
        </div>
        <footer class="modal__footer">
          <button type="button" class="btn" :disabled="cleanAllBusy" @click="cleanAllOpen = false">
            取消
          </button>
          <button
            type="button"
            class="btn btn--primary"
            :disabled="cleanAllBusy"
            @click="confirmCleanAll"
          >
            <span v-if="cleanAllBusy" class="spinner" aria-hidden="true"></span>
            {{ cleanAllBusy ? '清理中…' : '清理全部缓存' }}
          </button>
        </footer>
      </div>
    </div>
  </div>
</template>
