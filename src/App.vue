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
import ConfirmOverwrite from './components/ConfirmOverwrite.vue'
import OverLimitModal from './components/OverLimitModal.vue'
import EmptyState from './components/EmptyState.vue'
import { callExtension } from './bridge.js'
import { filterAndRank, isSearching } from './search.js'

/** 体积超限的错误前缀（规格 S17：唯一用 `ok:false` 承载"需要用户选择"的场景） */
const OVER_LIMIT_PREFIX = '[profile-over-limit]'

const rows = ref([])
const loading = ref(true)
const loadError = ref('')

// ---- profile 根（规格 §8.2：状态行 / 未受管警示行 / 覆盖确认框 / 浏览…+降级） ----
//
// ⚠️ 界面纪律：这些是本界面**仅有的三处**例外（除它们之外一切文案只进控制台，
// `docs/spec/amendments/05-remove-status-bar.md`）：
// ① 迁移状态行（用户必须看到并决策「继续 / 放弃」）；
// ② 未受管目录警示行（缺标记 ⇒ 删除与清理已被拒绝）；
// ③ 覆盖确认框（P1 = B 的唯一闸门，必须用户显式点按钮）。
/** `rootStatus` 的最近一次结果（挂载时调一次 + 迁移未完成时按按钮刷新，**绝不轮询**） */
const rootInfo = ref(null)
/** 手填路径（降级形态；「浏览…」不支持时露出来） */
const manualRoot = ref('')
/** 「浏览…」进行中 */
const browseBusy = ref(false)
/** 降级/失败提示（只在"支持不了"时出现，支持时不打扰用户） */
const browseNote = ref('')
/** 覆盖确认框（逐条列出将被覆盖的目录名；只能按钮关闭） */
const confirmOpen = ref(false)
const confirmNames = ref([])
const confirmBusy = ref(false)
/**
 * 覆盖确认框的来源（**这两条路径不能合并**）：
 * - `'start'`：由 `startRootMigration` 触发。此时**意图文件还没写**（闸门在写意图之前就返回了），
 *   所以确认后必须**带着 names 重新调 `startRootMigration`**；
 * - `'resolve'`：由续做路径（`resolveRootMigration` 回 `needsConfirm`）触发。此时意图文件已在，
 *   确认走 `resolveRootMigration` 的 `confirm-overwrite`。
 *
 * ⚠️ 走错就是"点了按钮什么都没发生"：start 路径去调 resolve 时找不到意图文件，
 * 扩展会回 `phase:'none'` 并静默结束。
 */
const confirmSource = ref('resolve')
/** 触发确认的候选根（仅 `confirmSource === 'start'` 时使用） */
const confirmRoot = ref('')

/** 迁移摘要（界面读它渲染「已搬 X/Y」；null = 没有未完成的迁移） */
const migration = computed(() => rootInfo.value?.migration ?? null)
/** 未受管的根 ⇒ 必须显示警示行（R3） */
const unmanaged = computed(() => rootInfo.value?.unmanaged === true)
/** 配置值非法 ⇒ 显示原因（运行时仍用生效根） */
const rootInvalid = computed(() => rootInfo.value?.invalid ?? null)
/** 自定义根（非默认）时的绝对路径，用于迁移完成提示 */
const effectiveRoot = computed(() => String(rootInfo.value?.effectiveRoot ?? ''))
const isDefaultRoot = computed(() => rootInfo.value?.isDefault !== false)

/** 迁移状态行文案（`已搬 X/Y`，有覆盖时追加 `覆盖 Z`） */
const migrationText = computed(() => {
  const data = migration.value
  if (!data) return ''
  const moved = Number(data.done ?? 0) + Number(data.overwritten ?? 0)
  const parts = [`正在迁移浏览器数据：已搬 ${moved}/${Number(data.total ?? 0)}`]
  if (Number(data.overwritten ?? 0) > 0) parts.push(`覆盖 ${Number(data.overwritten)}`)
  if (Number(data.skipped ?? 0) > 0) parts.push(`跳过 ${Number(data.skipped)}`)
  if (Number(data.failed ?? 0) > 0) parts.push(`失败 ${Number(data.failed)}`)
  return parts.join('，')
})

/** 迁移完成后的对照提示（规格 §7.5：外部根不在扩展内，卸载不会删它） */
const migratedNotice = computed(() => {
  if (migration.value) return ''
  if (isDefaultRoot.value || !effectiveRoot.value) return ''
  return `数据已迁到 ${effectiveRoot.value}；该目录不在扩展内，卸载扩展时不会删除它`
})

/** 逐条清单（跳过/覆盖/失败；超过 5 条折叠成"等 N 项"） */
const migrationItems = computed(() => {
  const items = Array.isArray(migration.value?.items) ? migration.value.items : []
  const listed = items.map((item) => {
    const status = String(item?.status ?? '')
    const label =
      status === 'overwritten'
        ? '覆盖'
        : status === 'skipped'
          ? '跳过'
          : status === 'failed'
            ? '失败'
            : status === 'missing'
              ? '缺失'
              : '完成'
    const reason = String(item?.reason ?? '')
    return `${label}：${String(item?.name ?? '')}${reason ? `（${reason}）` : ''}`
  })
  if (listed.length <= 5) return listed
  return [...listed.slice(0, 5), `等 ${listed.length - 5} 项`]
})

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

// ---- profile 根：状态查询 / 迁移 / 浏览（规格 §8.2） ----

/**
 * 读一次根状态（**只在挂载时调一次**，迁移未完成时用户按按钮再调；
 * 绝不常驻轮询——与既有"体积按需查询"的纪律一致）。
 */
async function refreshRootStatus() {
  try {
    const data = await callExtension('rootStatus', {})
    rootInfo.value = data ?? null
    if (rootInfo.value?.invalid) {
      setStatus(`根目录设置无效：${rootInfo.value.invalid.reason}`, 'error')
    }
  } catch (err) {
    // 根状态读不到不该挡住列表：只记控制台
    setStatus(`读取浏览器数据根状态失败：${messageOf(err)}`, 'error')
  }
}

/** 迁移的「继续」（含覆盖已确认的情形） */
async function continueMigration() {
  confirmBusy.value = true
  try {
    const result = await callExtension('resolveRootMigration', { action: 'continue' })
    if (result?.needsConfirm) {
      confirmNames.value = Array.isArray(result.conflicts) ? result.conflicts : []
      confirmSource.value = 'resolve'
      confirmOpen.value = true
      setStatus('迁移需要先确认覆盖目标目录里的同名数据', 'error')
      return
    }
    setStatus(`迁移已继续：已搬 ${Number(result?.done ?? 0)}/${Number(result?.total ?? 0)}`, 'ok')
    await refreshRootStatus()
    await load()
  } catch (err) {
    setStatus(`继续迁移失败：${messageOf(err)}`, 'error')
  } finally {
    confirmBusy.value = false
  }
}

/**
 * 迁移的「放弃」：只删意图并把设置值写回旧根，**已复制到目标根的数据保留**
 * （规格 D12；文案里必须说清，否则用户会以为"放弃 = 目标被清空"）。
 */
async function abandonMigration() {
  confirmBusy.value = true
  try {
    const result = await callExtension('resolveRootMigration', { action: 'abandon' })
    setStatus(
      `已放弃迁移（设置值已写回原目录）。已经复制到目标目录的数据保留在磁盘上，需你自行清理（已搬 ${Number(result?.done ?? 0)} 项）`,
      'error'
    )
    await refreshRootStatus()
    await load()
  } catch (err) {
    setStatus(`放弃迁移失败：${messageOf(err)}`, 'error')
  } finally {
    confirmBusy.value = false
  }
}

/**
 * 用户点「覆盖并继续」：把**用户看过的那份清单**（`confirmNames`）回传，扩展写进意图后才允许动手
 * —— 这是 P1 = B 的唯一闸门，**不得**由程序自行确认。
 *
 * 按来源分两条路（见 `confirmSource` 的注释）：
 * - `'start'`：意图文件还没写 ⇒ 带 `names` 重新调 `startRootMigration`（`confirmOverwrite: true`）；
 * - `'resolve'`：意图文件已在 ⇒ 调 `resolveRootMigration({ action: 'confirm-overwrite', names })`。
 */
async function confirmOverwrite() {
  confirmBusy.value = true
  try {
    const names = [...confirmNames.value]
    const result =
      confirmSource.value === 'start'
        ? await callExtension('startRootMigration', {
            root: confirmRoot.value,
            confirmOverwrite: true,
            names
          })
        : await callExtension('resolveRootMigration', { action: 'confirm-overwrite', names })
    confirmOpen.value = false
    const moved = Number(result?.done ?? 0) + Number(result?.overwritten ?? 0)
    setStatus(
      `已确认覆盖并继续迁移：已搬 ${moved}/${Number(result?.total ?? 0)}` +
        (result?.blocked ? `；${String(result.blocked)}` : ''),
      result?.blocked ? 'error' : 'ok'
    )
    await refreshRootStatus()
    await load()
  } catch (err) {
    setStatus(`覆盖迁移失败：${messageOf(err)}`, 'error')
  } finally {
    confirmBusy.value = false
  }
}

/** 取消覆盖 ⇒ 什么都不删（该条目留在"未确认覆盖"） */
function cancelOverwrite() {
  if (confirmBusy.value) return
  confirmOpen.value = false
  setStatus('已取消覆盖：目标目录里的数据一个字都没动', 'info')
}

/**
 * 「浏览…」：调扩展入口的 `browseRootDir`（子窗口没有 `api`）。
 *
 * 三种结果都**不报错**：
 * - `supported:true` + `candidate` ⇒ 填进手填输入框，由用户显式提交；
 * - `supported:false` ⇒ 露出降级入口（手填），并显示诚实的提示文案；
 * - `canceled:true` ⇒ 什么都不改。
 */
async function browseRoot() {
  browseBusy.value = true
  browseNote.value = ''
  try {
    const data = await callExtension('browseRootDir', {})
    if (data?.canceled) {
      setStatus('已取消选择目录，未改动任何值')
      return
    }
    if (data?.note) browseNote.value = String(data.note)
    if (data?.invalid?.reason) {
      browseNote.value = String(data.invalid.reason)
      setStatus(`所选目录不可用作根：${data.invalid.reason}`, 'error')
      return
    }
    if (data?.candidate) {
      manualRoot.value = String(data.candidate)
      setStatus(
        data.supported
          ? `已选择目录：${data.candidate}（请确认后提交）`
          : `宿主未支持目录选择，已把候选目录填入下方输入框（${data.candidate}）`,
        data.supported ? 'ok' : 'error'
      )
      return
    }
    // 没有候选：把降级入口露出来（提示语已经在上面的 `note` 里）
    setStatus('未能取得候选目录，请手工粘贴目录路径', 'error')
  } catch (err) {
    browseNote.value = `无法打开目录选择框（${messageOf(err)}）；请手工粘贴目录路径`
    setStatus(browseNote.value, 'error')
  } finally {
    browseBusy.value = false
  }
}

/** 手填路径的提交：走与设置页**同一个**入口（`startRootMigration`） */
async function submitManualRoot() {
  const value = String(manualRoot.value ?? '').trim()
  if (!value) {
    setStatus('请先填写或选择目录路径', 'error')
    return
  }
  confirmBusy.value = true
  try {
    const data = await callExtension('startRootMigration', { root: value })
    if (data?.needsConfirm) {
      // 意图文件**还没写**（闸门在写意图之前就返回了）⇒ 记下来源与候选根，
      // 用户点「覆盖并继续」时要带着 names 重新调 `startRootMigration`
      confirmSource.value = 'start'
      confirmRoot.value = value
      confirmNames.value = Array.isArray(data.conflicts) ? data.conflicts : []
      confirmOpen.value = true
      setStatus('目标目录里已有同名数据，需要你先确认覆盖', 'error')
      return
    }
    if (data?.started === false) {
      setStatus(`未开始迁移：${String(data.reason ?? '无需迁移')}（设置已更新）`, 'ok')
      manualRoot.value = ''
      await refreshRootStatus()
      await load()
      return
    }
    setStatus(
      `已开始迁移到 ${String(data?.to ?? '')}（共 ${Number(data?.total ?? 0)} 项）` +
        (data?.blocked ? `；${String(data.blocked)}` : ''),
      data?.blocked ? 'error' : 'ok'
    )
    await refreshRootStatus()
    await load()
  } catch (err) {
    setStatus(messageOf(err), 'error')
  } finally {
    confirmBusy.value = false
  }
}

onMounted(() => {
  void refreshRootStatus()
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
      <!-- ① 迁移状态行（规格 §8.2）：**唯一的"必须让用户看到并决策"的界面元素**。
           仅在确实有未完成的迁移时出现；`phase != done` 时给「继续」「放弃」。
           三处例外分别落在下面三个分支里（迁移状态行 / 未受管警示行 / 覆盖确认框）。 -->
      <div v-if="migration" class="rootbar rootbar--migrating">
        <p class="rootbar__text">{{ migrationText }}</p>
        <ul v-if="migrationItems.length" class="rootbar__items">
          <li v-for="(line, index) in migrationItems" :key="index">{{ line }}</li>
        </ul>
        <div class="rootbar__actions">
          <button type="button" class="btn" :disabled="confirmBusy" @click="continueMigration">
            继续
          </button>
          <button
            type="button"
            class="btn btn--danger"
            :disabled="confirmBusy"
            @click="abandonMigration"
          >
            放弃
          </button>
        </div>
        <p class="rootbar__hint">
          「放弃」只停止迁移并把设置写回原目录；已经复制到目标目录的数据会保留，需你自行清理。
        </p>
      </div>
      <div v-else-if="unmanaged" class="rootbar rootbar--warn">
        <p class="rootbar__text">该目录不是本扩展管理的目录：删除与清理已被拒绝</p>
        <p class="rootbar__hint">
          根目录 {{ effectiveRoot }} 缺少标记文件 .obox-webapp-root。打开与查体积仍可用。
        </p>
      </div>
      <p v-else-if="migratedNotice" class="rootbar rootbar--done">{{ migratedNotice }}</p>

      <!-- 配置值非法：说明它现在不生效（运行时仍用生效根） -->
      <p v-if="rootInvalid" class="rootbar rootbar--warn">
        设置里的根目录不合法，当前仍用 {{ effectiveRoot || '默认目录' }}：{{ rootInvalid.reason }}
      </p>

      <!-- 「浏览…」：目录选择依赖宿主能力；老宿主/失败时**不报错**，退回手填 + 诚实提示 -->
      <div class="rootbar rootbar--browse">
        <div class="rootbar__actions">
          <button type="button" class="btn" :disabled="browseBusy" @click="browseRoot">
            {{ browseBusy ? '正在打开…' : '浏览…' }}
          </button>
          <span class="rootbar__hint">
            当前数据目录：{{ effectiveRoot || '默认目录（扩展数据目录下的 chrome）' }}
          </span>
        </div>
        <!-- 手填入口：**任何情况下**都可用（「浏览…」不支持时它就是主入口） -->
        <div class="rootbar__field">
          <input
            v-model="manualRoot"
            type="text"
            class="input rootbar__input"
            placeholder="浏览器数据根目录（绝对路径，例如 D:\obox-webapp\profiles）"
            aria-label="浏览器数据根目录"
            @keydown.enter="submitManualRoot"
          />
          <button type="button" class="btn" :disabled="confirmBusy" @click="submitManualRoot">
            迁移到此目录
          </button>
        </div>
        <p v-if="browseNote" class="rootbar__hint rootbar__hint--warn">{{ browseNote }}</p>
      </div>

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
            :data-dir="row.dataDir || ''"
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

    <!-- 覆盖确认框（P1 = B 的唯一闸门）：逐条列出将被覆盖的目录名，
         只能按钮关闭；**没有**"备份目标"选项 -->
    <ConfirmOverwrite
      v-if="confirmOpen"
      :names="confirmNames"
      :submitting="confirmBusy"
      @close="cancelOverwrite"
      @confirm="confirmOverwrite"
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
