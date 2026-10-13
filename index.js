/**
 * 网页应用扩展入口（用户扩展，纯 ESM，经 .oix 安装到 `userData/extensions/webapp_chenzhi/`）。
 *
 * 组成（规格 §9.3 / §22）：
 * - `api.app.register` 注册 **一张 App 卡片** → 子窗口加载 `ui/index.html`（Vite 构建产物）
 * - `api.app.onMessage` 提供方法集，一律返回 `{ ok, data | error }`，**不抛错**
 * - `api.sqlite.open('webapp.db')` 存条目（扁平列，字段名与界面 `src/fields.js` 一一对应）
 * - `api.ipc` 通道 `webapp.helper`（manifest 静态声明，stdio + ndjson）拉起 `helper.cjs`：
 *   它负责探测 Chrome、按白名单参数 spawn、以及全部 profile 目录操作
 *
 * 消息契约（与 `src/bridge.js` 对齐）：
 *   页面 → 宿主：`{ source:'obox-app', action:'obox-extension', appId:'webapp.main', channel:'webapp',
 *                  requestId, payload:{ method, payload } }`
 *   宿主 → 页面：`{ source:'obox-app', action:'obox-extension-reply', requestId,
 *                  result:{ ok:true, data } | { ok:false, error } }`
 *   本入口 handler 的返回值就是那个 `result`。
 *
 * ⚠️ **有意的信封例外（R17 / 规格 S17）**：`open` 在"体积超限、需要用户选择"时返回
 * `ok: false` + `error` 以 `[profile-over-limit]` 开头，界面据此弹拦截模态框。
 * 这是本扩展**唯一**用 `ok:false` 承载"需要用户选择"的场景（其余失败都是真错误）。
 */
import {
  LANG_VALUES,
  SCALE_VALUES,
  fromDbRow,
  normalizeWebapp,
  toDbRow,
  validateWebapp
} from './lib/webapp.mjs'
import { ChromeArgsError, buildChromeArgs, describeLaunch } from './lib/chromeArgs.mjs'
import { sanitizeName } from './lib/nameSanitize.mjs'
import {
  DEFAULT_DISK_CACHE_MB,
  DEFAULT_PROFILE_LIMIT_MB,
  SETTING_KEYS,
  checkProfileLimit,
  formatBytes,
  normalizeDiskCacheMb,
  normalizeProfileLimitMb
} from './lib/profileLimit.mjs'
import {
  EXT_ID,
  ROOT_INTENT,
  advanceMigrationState,
  applyItemResult as applyItemResultPure,
  canonicalRoot,
  checkNotDataDir,
  conflictsConfirmed,
  createMarker,
  createRootIntent,
  decideMigrationItem,
  formatCardDataDir,
  isMigrationComplete,
  isMigratableIntent,
  normalizeRoot,
  pendingConflicts,
  progressText,
  resolveEffectiveRoot,
  samePath,
  summarize
} from './lib/profileRoot.mjs'

/** App 卡片 id（宿主按它把子窗口消息路由到本扩展） */
const APP_ID = 'webapp.main'
/** 条目库（`<扩展>/data/webapp.db`，默认表名 `webapp`） */
const DB_NAME = 'webapp.db'
/** manifest 里静态声明的 IPC 通道 id */
const CHANNEL_ID = 'webapp.helper'
/** 体积超限的错误前缀（界面据此区分"要用户选"与"真错误"，规格 S17） */
const OVER_LIMIT = '[profile-over-limit]'
/** 缺标记的根：删除/清理/改名被拒（界面据此切换到"未受管"文案，规格 §9.9） */
const ROOT_UNMARKED = '[profile-root-unmarked]'
/** 迁移意图文件的相对路径（**写在扩展 data 目录**，不随根移动；规格 D4 / U-5） */
const ROOT_INTENT_REL = ROOT_INTENT
/** 扩展版本（五处一致：manifest / package / package-lock ×2 / 卡片注册） */
const EXT_VERSION = '1.0.3'
/**
 * 「浏览…」的**降级文案**（规格 §7.4 的表；老宿主/能力探测失败时回给界面）。
 * 必须诚实：不承诺"一定能选目录"，并明确告诉用户下一步怎么做。
 */
const DEGRADED_NOTE =
  '当前 obox 版本不支持「选择目录」；请在下方粘贴目录路径（例如 D:\\obox-webapp\\profiles），或升级 obox 后重试'
/**
 * 「选到的是文件」时的降级文案（宿主契约：老宿主原样透传 `properties` 但**不读它**，
 * 于是弹的是文件框、返回的是文件路径 ⇒ 唯一的可信凭据就是"拿到的路径是不是目录"）。
 * ⚠️ 从文件取父目录**只是省一次输入的便利**，绝不等于用户确认了这个根：
 * 候选值仍要经 V1–V7 校验、仍要用户在界面上显式提交。
 */
const FILE_SELECTED_NOTE =
  '当前 obox 版本不支持「选择目录」，弹出的是文件选择框；已把所选文件所在的文件夹当作候选目录，请确认后再提交，或升级 obox 后重试'

/**
 * helper 调用的超时口径（规格 §11.2 的"超时口径"表逐条对应 + §9.2 R-16）。
 * ⚠️ **必须显式给**：宿主默认 30s，而 `launch`（Chrome 冷启动）与
 * `removeProfile` / `cleanCaches`（GB 级目录）都可能超过它——不显式放宽的话宿主会先报
 * `[timeout]`，而助手仍在继续干活（`extensions/rdp/index.js:154-156` 的教训）。
 * 迁移的单位是**单个目录**（5 分钟足够），整体迁移由扩展侧循环、不受单次超时限制。
 */
const TIMEOUTS = Object.freeze({
  probe: 60_000,
  launch: 60_000,
  profileStatus: 30_000,
  profileSize: 120_000,
  cleanCaches: 300_000,
  moveProfile: 300_000,
  removeProfile: 300_000,
  profileRootStatus: 30_000,
  prepareRoot: 60_000,
  checkRootCandidate: 30_000,
  migrateRootDir: 600_000
})

/**
 * 卡片图标（内联 SVG；单色、随主题 —— `currentColor` 由宿主着色）。
 * 形状取"应用窗口 + 地球"：与「App 模式打开一条网址」的语义一致。
 */
const CARD_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="4" width="19" height="15" rx="1.8"/><path d="M2.5 8.2h19"/><circle cx="12" cy="14.2" r="3.4"/><path d="M8.7 14.2h6.6M12 10.8c1.1 1 1.6 2.1 1.6 3.4s-.5 2.4-1.6 3.4M12 10.8c-1.1 1-1.6 2.1-1.6 3.4s.5 2.4 1.6 3.4"/></svg>'

/** 错误归一：任何抛出物 → 可读单行文本 */
function messageOf(err) {
  if (err instanceof Error) return err.message || err.name || '未知错误'
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err) ?? String(err)
  } catch {
    return String(err)
  }
}

/** 成功应答 */
function ok(data) {
  return { ok: true, data: data === undefined ? null : data }
}

/** 失败应答（handler 不抛错——桥的 reply 信封越简单越好排查） */
function fail(error) {
  return { ok: false, error: messageOf(error) }
}

/** id 归一：正整数才算有效（界面的临时 id 不会被送到这里） */
function toId(value) {
  const n = Number(value)
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * 请求解析：`channel` 即方法名，`payload` 即参数。
 * 同时兼容"方法写在 payload 里"的字面写法（`{ method, payload }`）。
 */
function resolveRequest(channel, payload) {
  if (payload && typeof payload === 'object' && typeof payload.method === 'string') {
    return { method: payload.method, params: payload.payload === undefined ? {} : payload.payload }
  }
  return {
    method: typeof channel === 'string' ? channel : '',
    params: payload === undefined ? {} : payload
  }
}

/** `save` 的入参既可直接是条目对象，也可包一层 `{ entry }` */
function entryInput(params) {
  if (params && typeof params === 'object' && params.entry && typeof params.entry === 'object') {
    return params.entry
  }
  return params
}

/** 按 `createdAt` 升序（同刻按 id 升序）；ISO 字符串可直接字典序比较 */
function sortByCreatedAt(rows) {
  return [...rows].sort((a, b) => {
    const ca = String(a?.createdAt ?? '')
    const cb = String(b?.createdAt ?? '')
    if (ca !== cb) return ca < cb ? -1 : 1
    return Number(a?.id ?? 0) - Number(b?.id ?? 0)
  })
}

/**
 * 扩展入口。
 * @param {import('../../../src/api').ExtensionActivationApi} api 宿主注入的能力面
 * @returns {() => void} cleanup（注销卡片与消息处理器、断开 helper 通道）
 */
export default function webapp(api) {
  // ---- 数据库（懒开库 + 建表建唯一索引） ----
  let dbPromise = null
  let schemaReady = null

  function openDb() {
    if (!dbPromise) {
      dbPromise = Promise.resolve(api.sqlite.open(DB_NAME)).catch((err) => {
        dbPromise = null
        throw err
      })
    }
    return dbPromise
  }

  /**
   * 建表 + 建**大小写不敏感的唯一索引**（规格 §13.3）。
   *
   * - 库层唯一索引是**兜底**：应用层仍做大小写不敏感查重，以便给出**中文文案**；
   * - `CREATE UNIQUE INDEX … (name COLLATE NOCASE)` 已在开发机验证可行（`node:sqlite`），
   *   `assertSafeSql` 也只禁 `attach/detach/vacuum/pragma/load_extension`；
   * - `desc` 是 SQL 关键字，宿主的 `ident()` 会加双引号（所以这里也能安全写）。
   */
  function ensureSchema() {
    if (!schemaReady) {
      schemaReady = (async () => {
        const db = await openDb()
        await db.exec(
          'CREATE TABLE IF NOT EXISTS webapp (' +
            'id INTEGER PRIMARY KEY AUTOINCREMENT, ' +
            'name TEXT NOT NULL, ' +
            'url TEXT NOT NULL, ' +
            '"desc" TEXT, ' +
            'ignoreCert INTEGER, ' +
            'extraOrigins TEXT, ' +
            'windowSize TEXT, ' +
            'windowPos TEXT, ' +
            'startMaximized INTEGER, ' +
            'lang TEXT, ' +
            'scaleFactor TEXT, ' +
            'disableGpu INTEGER, ' +
            'profileDir TEXT, ' +
            'createdAt TEXT, ' +
            'updatedAt TEXT)'
        )
        await db.exec(
          'CREATE UNIQUE INDEX IF NOT EXISTS webapp_name_nocase ON webapp (name COLLATE NOCASE)'
        )
        return db
      })().catch((err) => {
        schemaReady = null
        throw err
      })
    }
    return schemaReady
  }

  // ---- helper 通道（懒连接：激活扩展不该顺手拉起子进程，规格 §17） ----
  let connecting = null
  let connected = false

  function ensureHelper() {
    if (!connecting) {
      connecting = Promise.resolve(api.ipc.connect(CHANNEL_ID))
        .then(() => {
          connected = true
        })
        .catch((err) => {
          connecting = null
          throw err
        })
    }
    return connecting
  }

  async function callHelper(method, params) {
    await ensureHelper()
    return api.ipc.request(CHANNEL_ID, method, params, { timeoutMs: TIMEOUTS[method] ?? 30_000 })
  }

  // 通道异常关闭（助手崩溃/被杀）后允许下次调用重连
  const offClose =
    typeof api.ipc.onClose === 'function'
      ? api.ipc.onClose(CHANNEL_ID, () => {
          connecting = null
          connected = false
        })
      : null

  // ---- 设置（R17 的两个 select + R-17 的 profileRoot） ----

  /**
   * 读设置并归一（规格 §10.4 / §9.1）。
   * 两个 select：归一失败（非有限数 / 负数 / **不在档位内**）→ 回落默认值，并 `console.warn` 一次。
   * `profileRoot`：归一失败（V2–V5）→ **回落**（不抛错），并保留原始串供界面显示原因。
   *
   * @returns {{ profileLimitMb: number, diskCacheMb: number, profileRoot: string,
   *   rootVerdict: ReturnType<typeof normalizeRoot> }}
   */
  function readSettings() {
    const limitRaw = api.settings?.get
      ? api.settings.get(SETTING_KEYS.profileLimitMb, String(DEFAULT_PROFILE_LIMIT_MB))
      : String(DEFAULT_PROFILE_LIMIT_MB)
    const cacheRaw = api.settings?.get
      ? api.settings.get(SETTING_KEYS.diskCacheMb, String(DEFAULT_DISK_CACHE_MB))
      : String(DEFAULT_DISK_CACHE_MB)
    const rootRaw = api.settings?.get ? api.settings.get(SETTING_KEYS.profileRoot, '') : ''
    const limit = normalizeProfileLimitMb(limitRaw)
    const cache = normalizeDiskCacheMb(cacheRaw)
    if (limit.fellBack) {
      console.warn(
        `[webapp] 设置 ${SETTING_KEYS.profileLimitMb}=${String(limitRaw)} 不在档位内，已回落 ${limit.mb}`
      )
    }
    if (cache.fellBack) {
      console.warn(
        `[webapp] 设置 ${SETTING_KEYS.diskCacheMb}=${String(cacheRaw)} 不在档位内，已回落 ${cache.mb}`
      )
    }
    // ⚠️ `api.settings.get` 返回的可能是任意类型（设置项类型是 text，但存储层不保证）⇒ String()
    const profileRoot = rootRaw === undefined || rootRaw === null ? '' : String(rootRaw)
    const rootVerdict = normalizeRoot(profileRoot)
    if (rootVerdict.kind === 'invalid') {
      console.warn(
        `[webapp] 设置 ${SETTING_KEYS.profileRoot} 不合法，已忽略：${rootVerdict.reason}`
      )
    }
    return { profileLimitMb: limit.mb, diskCacheMb: cache.mb, profileRoot, rootVerdict }
  }

  // ---- profile 根：生效根、意图文件、迁移状态机（规格 §9.1 / §9.4） ----

  /** 归一成功的自定义根缓存（归一失败时"保持上一次成功的值"，规格 §9.1） */
  let lastGoodRoot = ''
  /** 迁移意图：`undefined` = 尚未读；`null` = 无意图 */
  let rootIntent = undefined
  /** `list` 的"懒对账只跑一次"开关（规格 §9.4 触发点） */
  let rootIntentChecked = false
  /** 串行化迁移对账（同一时刻只跑一次） */
  let reconcileChain = null
  /**
   * 「浏览…」的能力探测结论（**只缓存本会话内存**：不落库、不写设置；
   * 扩展重新激活后重新探一次 —— 规格 §7.4 第 4 条）。
   */
  let browseSupported = null

  /** 迁移意图文件的相对路径（`api.fs` 的沙箱只到 data 目录；U-5 已核实点文件可写） */
  function intentPath() {
    return ROOT_INTENT_REL
  }

  /** 读迁移意图（读不到 / 不合法 ⇒ null，与既有 `readPendingMove` 的容错口径一致） */
  async function readRootIntent() {
    try {
      const text = await api.fs.readFile(intentPath())
      if (!text) return null
      const parsed = JSON.parse(text)
      return isMigratableIntent(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  /**
   * 写迁移意图（**临时文件 + rename** 不可用：`api.fs` 没有 rename）
   * ⇒ 用"先写 `.tmp` 再写正式文件"的两步写，并让读侧对不完整 JSON 容错（`JSON.parse` 失败 ⇒ null）。
   * 这是规格 §9.4「写入方式」在 `api.fs` 能力下的等价实现（U-5 结论，见 amendment 08 的 U-5 小节）。
   */
  async function writeRootIntent(intent) {
    const payload = JSON.stringify({ ...intent, summary: summarize(intent) }, null, 2)
    await api.fs.writeFile(`${intentPath()}.tmp`, payload)
    await api.fs.writeFile(intentPath(), payload)
    rootIntent = intent
    return intent
  }

  /** 删迁移意图（`phase='done'` / `abandoned` 的收尾） */
  async function clearRootIntent() {
    rootIntent = null
    for (const rel of [`${intentPath()}.tmp`, intentPath()]) {
      try {
        await api.fs.remove(rel)
      } catch {
        // 删不掉不致命：读侧对残留文件容错（`isMigratableIntent` 会判掉 phase=done/abandoned）
      }
    }
  }

  /** 当前是否有一个"未完成"的迁移（`pending`/`running`） */
  function activeIntent() {
    if (!rootIntent || typeof rootIntent !== 'object') return null
    if (rootIntent.phase !== 'pending' && rootIntent.phase !== 'running') return null
    return rootIntent
  }

  /**
   * **生效根**（规格 §9.1 最关键的数据安全点）：
   * 迁移未完成（`phase ∈ {pending,running}`）时**恒为意图里的 `from`（旧根）**——
   * 无论宿主里的设置值是不是已经变成新根。这样"数据还在旧根、设置说新根"的中间态
   * 永远不会被当成最终态。
   */
  function effectiveRootNow() {
    const settings = readSettings()
    if (settings.rootVerdict.kind !== 'invalid') {
      lastGoodRoot = settings.rootVerdict.kind === 'default' ? '' : settings.rootVerdict.root
    }
    const resolved = resolveEffectiveRoot({
      configured: settings.profileRoot,
      fallbackRoot: lastGoodRoot,
      intent: activeIntent()
    })
    return { settings, ...resolved }
  }

  /** 传给助手方法的 `root` 参数：默认根 ⇒ **不传**（助手用自己的 `<cwd>/chrome`，行为与 1.0.2 一致） */
  function rootParam(info) {
    return info.isDefault ? {} : { root: info.root }
  }

  /** 日志用：只记摘要，不打印完整命令行（规格 §16） */
  function logRoot(info) {
    return `root=${info.root} default=${info.isDefault} source=${info.source}`
  }

  /** 归一后的目标根（V1–V6 + obox 程序目录）；失败返回 `{ error }` 供界面直接展示 */
  function targetRootFor(value) {
    const verdict = normalizeRoot(value)
    if (verdict.kind === 'invalid') return { error: verdict.reason }
    if (verdict.kind === 'default') {
      return { error: '根目录必须是绝对路径（例如 D:\\obox-webapp\\profiles）' }
    }
    return { root: verdict.root, warning: verdict.warning, kind: verdict.kind }
  }

  /** 条目在某个根下的落点（只用于**只读**探测与日志；真正的删/移一律由助手执行） */
  function entryNameOf(entry) {
    return String(entry?.profileDir || sanitizeName(entry?.name) || '')
  }

  /** 该根下有哪些**目录**（助手实测；不可达/不存在 ⇒ 空数组） */
  async function listRootEntries(root) {
    try {
      const status = await callHelper('profileRootStatus', { root })
      return Array.isArray(status?.entries) ? status.entries : []
    } catch (err) {
      console.warn(`[webapp] 读取根目录清单失败（${root}）：${messageOf(err)}`)
      return []
    }
  }

  /** 逐条目探测（`migrateRootDir action='probe'`）：**只读**，不动任何数据 */
  async function probeItem(intent, name) {
    return callHelper('migrateRootDir', {
      from: intent.from,
      to: intent.to,
      name,
      action: 'probe'
    })
  }

  /**
   * 把一条结果写进意图并**立即落盘**（纯函数 `applyItemResult` 只算不写，落盘在这里）。
   * 迁移是**串行**的：每完成一个条目就刷新进度，断电后能精确续做（规格 §9.5.2 的取舍）。
   */
  async function applyAndPersist(intent, result, options = {}) {
    const next = applyItemResultPure(intent, result, { phase: 'running', ...options })
    await writeRootIntent(next)
    return next
  }

  /**
   * **迁移对账主循环**（规格 §9.4「状态流转」/「续做」/「互斥」的落点）。
   *
   * 关键不变量（每一条都有对应的门禁或验收）：
   * 1. **设置值只在全部搬完后写一次**（`api.settings.set` 在整个扩展里的**唯一**调用点就在这里）；
   * 2. **有失败项 ⇒ 不写设置、不删源、不删意图**，整体停在 `running`（D11）；
   * 3. **未确认的覆盖 ⇒ 停下来把冲突清单回给界面**（续做时**重新确认**，D16）；
   * 4. 终态 `done` ⇒ 写设置 → 删意图文件 → 生效根才切到新根。
   *
   * @param {{ to?: string, userDeclined?: boolean }} [options]
   */
  async function reconcileIntent(options = {}) {
    if (reconcileChain) return reconcileChain
    reconcileChain = (async () => {
      if (rootIntent === undefined) rootIntent = await readRootIntent()
      const intent = activeIntent()
      if (!intent) return null
      if (options.to && !samePath(options.to, intent.to)) {
        // 意图里的 to 与本次请求的根不一致 ⇒ 当前迁移仍是权威（不允许半路改目标）
        console.warn(`[webapp] 迁移意图的目标是 ${intent.to}，忽略本次请求的 ${options.to}`)
      }

      let current = intent
      // ① 重扫两个根（**不信上次的扫描结果**，规格 §7.3 ②）
      const sourceEntries = new Set(await listRootEntries(current.from))
      const targetEntries = new Set(await listRootEntries(current.to))

      // ② 逐项判定 + 执行
      for (const item of [...current.items]) {
        const name = String(item.name)
        const sourceExists = sourceEntries.has(name) || item.status === 'failed'
        const targetExists = targetEntries.has(name)
        if (item.status === 'done' || item.status === 'overwritten' || item.status === 'missing') {
          continue
        }
        const confirmed = conflictsConfirmed(current.conflicts, [name])
        const decided = decideMigrationItem(
          { exists: sourceExists },
          { exists: targetExists },
          { overwrite: item.overwrite === true, confirmed }
        )
        if (decided.action === 'missing') {
          current = await applyAndPersist(current, {
            name,
            status: 'missing',
            reason: decided.reason
          })
          continue
        }
        if (decided.action === 'done') {
          current = await applyAndPersist(current, {
            name,
            status: 'done',
            reason: decided.reason
          })
          sourceEntries.delete(name)
          targetEntries.add(name)
          continue
        }
        if (decided.action === 'skipped') {
          current = await applyAndPersist(current, {
            name,
            status: 'skipped',
            reason: decided.reason
          })
          continue
        }
        // overwrite / move：真正动手（失败**不抛错**，助手回 status:'failed'）
        const overwriting = decided.action === 'overwritten'
        const result = await callHelper('migrateRootDir', {
          from: current.from,
          to: current.to,
          name,
          action: 'move',
          overwrite: overwriting
        })
        const status = String(result?.status ?? 'failed')
        current = await applyAndPersist(current, {
          name,
          status,
          reason: String(result?.reason ?? ''),
          overwrite: overwriting,
          files: Number(result?.files ?? 0),
          bytes: Number(result?.bytes ?? 0),
          copiedFiles: Number(result?.copiedFiles ?? 0),
          copiedBytes: Number(result?.copiedBytes ?? 0)
        })
        if (status === 'failed' || status === 'skipped') {
          const item = current.items.find((candidate) => candidate.name === name)
          console.warn(`[webapp] 迁移条目 ${name}：${status}（${item?.reason ?? ''}）`)
        }
        if (status === 'done' || status === 'overwritten') {
          sourceEntries.delete(name)
          targetEntries.add(name)
        }
      }

      // ③ 收尾判定（D11：failed 阻塞写设置；未确认的覆盖也阻塞）
      const unresolved = pendingConflicts(current)
      if (unresolved.length) {
        return { intent: current, needsConfirm: true, conflicts: unresolved }
      }
      const state = advanceMigrationState(current)
      if (!state.writable) {
        return { intent: current, needsConfirm: false, conflicts: [], blocked: state.reason }
      }

      // ④ **唯一写点**：全部搬完后才把新根写进设置
      current = { ...current, phase: 'done', updatedAt: new Date().toISOString() }
      try {
        await api.settings.set(SETTING_KEYS.profileRoot, current.to)
        console.info(`[webapp] 迁移完成：设置 ${SETTING_KEYS.profileRoot} = ${current.to}`)
      } catch (err) {
        // 写设置失败 ⇒ 不删意图文件（下次启动仍在 `running`，可继续）
        console.warn(`[webapp] 写入 ${SETTING_KEYS.profileRoot} 失败：${messageOf(err)}`)
        return { intent: current, needsConfirm: false, conflicts: [], blocked: '写入设置失败' }
      }
      lastGoodRoot = current.to
      await clearRootIntent()
      // 迁移完成后**清空整个体积缓存**（所有条目的 dir 都变了，规格 §9.8）：
      // 复用 `cleanCaches` 的失效条件 ③（它成功后会 `sizeCache.clear()`），
      // 不新增"仅清缓存 Map"的通道方法。这次调用在刚搬完的条目上通常什么都不删。
      try {
        await callHelper('cleanCaches', { root: current.to })
      } catch (err) {
        console.warn(`[webapp] 迁移后清空体积缓存失败（不影响迁移结论）：${messageOf(err)}`)
      }
      settingsChanged = true
      return { intent: current, needsConfirm: false, conflicts: [], wroteSetting: true }
    })().finally(() => {
      reconcileChain = null
    })
    return reconcileChain
  }

  /** 启动/继续迁移时用的对账入口（带串行化） */
  async function reconcileNow(options = {}) {
    return reconcileIntent(options)
  }

  /** `rootStatus` 的返回体（界面据此渲染状态行/警示行/覆盖确认框） */
  async function rootStatusPayload() {
    const info = effectiveRootNow()
    const intent = activeIntent()
    const settings = info.settings
    const invalid =
      settings.rootVerdict.kind === 'invalid'
        ? { value: settings.profileRoot, reason: settings.rootVerdict.reason }
        : null
    let unmanaged = false
    try {
      const status = await callHelper('profileRootStatus', rootParam(info))
      unmanaged = Boolean(status?.unmanaged)
    } catch (err) {
      console.warn(`[webapp] 读取根状态失败：${messageOf(err)}`)
    }
    let migration = null
    if (intent) {
      migration = {
        phase: intent.phase,
        from: intent.from,
        to: intent.to,
        total: intent.summary?.total ?? intent.items.length,
        done: intent.summary?.done ?? 0,
        overwritten: intent.summary?.overwritten ?? 0,
        skipped: intent.summary?.skipped ?? 0,
        failed: intent.summary?.failed ?? 0,
        missing: intent.summary?.missing ?? 0,
        conflicts: {
          confirmed: conflictsConfirmed(
            intent.conflicts,
            intent.items.filter((item) => item.overwrite === true).map((item) => item.name)
          ),
          names: Array.isArray(intent.conflicts?.names) ? intent.conflicts.names : []
        },
        items: intent.items.map((item) => ({
          name: item.name,
          status: item.status,
          reason: item.reason,
          overwrite: item.overwrite === true
        }))
      }
    }
    return {
      effectiveRoot: info.root,
      isDefault: info.isDefault,
      configuredValue: settings.profileRoot,
      invalid,
      unmanaged,
      migration
    }
  }

  /** 迁移意图是否阻塞"改名"（规格 §9.4 互斥表 / D14） */
  function migrationBlocksRename() {
    return activeIntent() !== null
  }

  /**
   * 设置变更时**作废体积缓存**（规格 §14.6 的失效条件 ⑥）。
   * 实现口径：不新增通道方法，改为把"下一次 `profileSize` 必须带 `force: true`"记在这里。
   * ⚠️ 声明必须在 `effectiveRootNow()` / `reconcileIntent()` **之前**：
   * 两者都会读它（迁移完成时要作废体积缓存），而 `let` 有暂时性死区。
   */
  let settingsChanged = false
  const offSettings =
    typeof api.settings?.onChanged === 'function'
      ? api.settings.onChanged((key) => {
          if (typeof key === 'string' && key.startsWith('webapp.')) settingsChanged = true
        })
      : null

  // ---- 方法实现 ----

  /**
   * `list`：全部条目（按 createdAt 升序）。
   *
   * **懒对账一次**（规格 §9.4「触发点」）：首次 `list` 时先处理**根迁移意图**，
   * 再让既有改名 intent 对账跑（顺序不可颠倒，D14：先改根、后改名）。
   * 对账失败**不能让列表打不开** ⇒ 全部包在 try/catch 里，只 warn。
   */
  async function list() {
    const db = await ensureSchema()
    if (!rootIntentChecked) {
      rootIntentChecked = true
      try {
        rootIntent = await readRootIntent()
        const outcome = await reconcileNow()
        if (outcome?.needsConfirm) {
          console.info(
            `[webapp] 根迁移需要确认覆盖：${outcome.conflicts.join('、')}（请在界面确认）`
          )
        } else if (outcome?.intent) {
          console.info(`[webapp] 根迁移对账：${progressText(outcome.intent.summary)}`)
        }
      } catch (err) {
        console.warn(`[webapp] 根迁移对账失败（列表照常加载）：${messageOf(err)}`)
      }
    }
    const rows = await db.get_all()
    // 卡片的"数据目录"提示按**生效根**动态渲染（规格 §15.2 第 5 条的修订）：
    // 路径文案由这里算好（`lib/profileRoot.mjs` 是唯一实现），界面**不自己拼路径**
    // ——子窗口是浏览器环境，不能 import `lib/*.mjs`。
    const info = effectiveRootNow()
    return ok(
      sortByCreatedAt(Array.isArray(rows) ? rows : []).map((row) => {
        const entry = fromDbRow(row)
        return {
          ...entry,
          dataDir: formatCardDataDir({
            root: info.isDefault ? '' : info.root,
            isDefault: info.isDefault,
            profileName: entryNameOf(entry)
          })
        }
      })
    )
  }

  /**
   * 目录是否存在（`profileStatus` 的薄封装；通道不可用时当作"不存在"，让删除只删库行）。
   * @param {string} name 条目目录名
   * @param {{ isDefault?: boolean, root?: string }} [scope] 生效根（缺省 = 默认根，行为与 1.0.2 一致）
   */
  async function profileExists(name, scope) {
    const params = scope && scope.isDefault === false ? { name, root: scope.root } : { name }
    try {
      const status = await callHelper('profileStatus', params)
      return { exists: Boolean(status?.exists), locked: Boolean(status?.locked), dir: status?.dir }
    } catch {
      return { exists: false, locked: false, dir: '' }
    }
  }

  /** `profileInfo { id }`：磁盘状态（**不返回体积**——体积走 `profileSize`），按**生效根**解析 */
  async function profileInfo(params) {
    const id = toId((params ?? {}).id)
    if (id === null) return fail('profileInfo 需要合法的 id')
    const db = await ensureSchema()
    const row = await db.get(id)
    if (!row) return fail('网页应用不存在（可能已被删除），请刷新列表')
    const info = effectiveRootNow()
    const entry = fromDbRow(row)
    const name = entryNameOf(entry)
    const status = await profileExists(name, info)
    return ok({
      id,
      profileDir: name,
      root: info.root,
      isDefaultRoot: info.isDefault,
      dir: status.dir,
      exists: status.exists,
      locked: status.locked
    })
  }

  /** 内部用：把 id 解析成条目（找不到时返回 null） */
  async function loadEntry(id) {
    const db = await ensureSchema()
    const row = await db.get(id)
    return row ? fromDbRow(row) : null
  }

  /**
   * `save`：归一 → 校验 → （改名时先搬目录）→ 落库。
   *
   * 改名顺序严格照规格 §14.2（"移动失败则报错且不改数据"）：
   * 1. 校验（含目标目录是否已被占用）；
   * 2. `moveProfile({ from, to })` —— 源不存在视为成功；失败则**不落库**并给专门文案；
   * 3. 落库；若落库抛错 → 尝试回滚 move（回滚失败只 warn，并把真实目录名写进库）。
   */
  async function save(params) {
    const db = await ensureSchema()
    const rows = await db.get_all()
    const existingRows = Array.isArray(rows) ? rows : []
    const input = entryInput(params)
    const entry = normalizeWebapp(input)

    const target =
      entry.id === undefined
        ? null
        : (existingRows.find((row) => String(row?.id) === String(entry.id)) ?? null)
    if (entry.id !== undefined && !target) {
      return fail('网页应用不存在（可能已被删除），请刷新列表')
    }

    const checked = validateWebapp(entry, existingRows, { raw: input })
    if (!checked.ok) return fail(checked.errors.map((item) => item.message).join('；'))

    const newDir = sanitizeName(entry.name)
    const oldDir = target ? String(target.profileDir || sanitizeName(target.name)) : ''
    const renaming = Boolean(target) && oldDir !== newDir
    const now = new Date().toISOString()
    // 生效根（改名会**移动数据**，因此必须按生效根解析）
    const info = effectiveRootNow()
    const scope = rootParam(info)

    if (renaming) {
      // 迁移未完成 ⇒ 不接受新的改名（两个 intent 指向不同根时无法对账，规格 §9.4 互斥 / D14）
      if (migrationBlocksRename()) {
        return fail('浏览器数据正在迁移，请先完成或放弃迁移后再改名')
      }
      // 目标目录已存在 → 直接拒绝（避免把两个站点的数据混在一起）
      const status = await profileExists(newDir, info)
      if (status.exists) {
        return fail(`目标浏览器数据目录已存在（${newDir}），请换一个名称`)
      }
      try {
        const moved = await callHelper('moveProfile', { from: oldDir, to: newDir, ...scope })
        // 源不存在 = 无需移动，按成功处理（只改库）
        if (moved && moved.missing === true) {
          console.info(`[webapp] 改名：${oldDir} 不存在，只更新库里的目录名`)
        }
      } catch (err) {
        const text = messageOf(err)
        // 缺标记的根：改名也会动数据 ⇒ 与删除同等级拒绝（规格 §9.3 矩阵）
        if (text.includes(ROOT_UNMARKED)) {
          return fail('该目录不是本扩展管理的目录：删除与清理已被拒绝')
        }
        return fail(`无法把浏览器数据目录从 ${oldDir} 改名为 ${newDir}（${text}），条目名称未修改`)
      }
    }

    try {
      let row
      if (entry.id !== undefined) {
        const patch = toDbRow({ ...entry, profileDir: newDir }, { updatedAt: now })
        delete patch.id
        await db.update({ id: entry.id }, patch)
        row = await db.get(entry.id)
      } else {
        row = await db.insert(
          toDbRow({ ...entry, profileDir: newDir }, { createdAt: now, updatedAt: now })
        )
      }
      return ok(fromDbRow(row))
    } catch (err) {
      // 库层写失败：尝试把目录搬回去（回滚失败只 warn，并把真实目录名写进库）
      if (renaming) {
        try {
          await callHelper('moveProfile', { from: newDir, to: oldDir, ...scope })
        } catch (rollbackError) {
          console.warn(`[webapp] 改名回滚失败（目录现在叫 ${newDir}）：${messageOf(rollbackError)}`)
          try {
            await db.update({ id: entry.id }, { profileDir: newDir })
          } catch (patchError) {
            console.warn(`[webapp] 回写 profileDir 失败：${messageOf(patchError)}`)
          }
        }
      }
      const text = messageOf(err)
      // 库层唯一索引冲突（理论不可达：应用层已查重）归一为可读文案
      if (/UNIQUE|constraint/i.test(text)) return fail('名称已存在，请换一个')
      return fail(text)
    }
  }

  /**
   * `remove { id }`：预检 → 删 profile（进 .trash 后清理）→ 删库行。
   *
   * ⚠️ **缺标记的根（自定义根且无 `.obox-webapp-root`）⇒ 删除被拒**，且**库行也不删**
   * （删库行会让用户以为"数据没了"，而目录其实原封不动；规格 §9.7 / A34）。
   */
  async function remove(params) {
    const id = toId((params ?? {}).id)
    if (id === null) return fail('remove 需要合法的 id')
    const db = await ensureSchema()
    const row = await db.get(id)
    if (!row) return fail('网页应用不存在（可能已被删除），请刷新列表')
    const entry = fromDbRow(row)
    const info = effectiveRootNow()
    const name = entryNameOf(entry)
    const warnings = []

    // 目录不存在 → 只删库行（与 rdp 的 deleteCredential"缺条目不算失败"同口径）
    const status = await profileExists(name, info)
    if (status.exists) {
      try {
        const result = await callHelper('removeProfile', { name, ...rootParam(info) })
        if (result && result.warning) warnings.push(result.warning)
      } catch (err) {
        const text = messageOf(err)
        if (text.includes(ROOT_UNMARKED)) {
          return fail('该目录不是本扩展管理的目录：删除与清理已被拒绝')
        }
        if (text.includes('[profile-busy]')) {
          return fail(
            `无法删除 ${entry.name} 的浏览器数据（可能窗口正开着），请先关闭该站点的浏览器窗口后重试`
          )
        }
        return fail(`无法删除 ${entry.name} 的浏览器数据：${text}`)
      }
    }
    await db.del(id)
    return ok({ id, warnings })
  }

  /**
   * `open { id, force? }`：**体积预检（R17）** → 构造参数 → helper 启动。
   *
   * 预检规则（规格 §14.6，确定性顺序）：
   * 1. `limitMb === 0` → 跳过预检；
   * 2. `profileSize({ name })`：目录不存在（`bytes === null`）→ 跳过；
   * 3. 量体积失败 → **降级放行**（warnings 里带 `[profile-size-failed]`，绝不因此挡住打开）；
   * 4. `bytes > limitBytes` → 拦截，返回 `ok:false` + `[profile-over-limit]` 前缀（S17）；
   * 5. `force: true`（界面的「仍然打开」）→ 跳过拦截，**不持久化**。
   */
  async function open(params) {
    const id = toId((params ?? {}).id)
    if (id === null) return fail('open 需要合法的 id')
    const entry = await loadEntry(id)
    if (!entry) return fail('网页应用不存在（可能已被删除），请刷新列表')
    const info = effectiveRootNow()
    const settings = info.settings
    const name = entryNameOf(entry)
    const warnings = []
    const force = params?.force === true

    if (!force) {
      const blocked = await precheckSize(id, entry, name, settings, warnings, info)
      if (blocked) return blocked
    }

    // 形态由**根的类别**决定（规格 §9.2 末 / D2）：默认根 = 相对形态，自定义根 = 绝对形态。
    // ⚠️ 打开是"写"不是"删" ⇒ 缺标记也**放行**（拒绝会造成"根被手工动过就再也打不开"的死局）。
    const args = buildChromeArgs(entry, {
      profileName: name,
      diskCacheMb: settings.diskCacheMb,
      rootMode: info.isDefault ? 'relative' : 'absolute',
      root: info.root
    })
    // 只记摘要（**不打印完整命令行**），且 URL 里的 userinfo 会被脱敏
    console.info(`[webapp] launch ${describeLaunch({ args })}（${logRoot(info)}）`)
    const result = await callHelper('launch', { args, ...rootParam(info) })
    const pid = result && typeof result === 'object' ? result.pid : null
    if (!pid) {
      let raw
      try {
        raw = JSON.stringify(result)
      } catch {
        raw = String(result)
      }
      console.warn('[webapp] launch 未返回 pid，helper 原始回复：', raw)
      return fail(`未能拉起 Chrome（helper 回复：${raw ?? '空'}）`)
    }
    if (result.warning) warnings.push(result.warning)
    return ok({ pid, warnings })
  }

  /**
   * 体积预检：返回"拦截应答"或 `null`（= 放行）。
   * 抽成函数是为了让 `open` 的主流程读起来仍是"预检 → 启动"两步。
   */
  async function precheckSize(id, entry, name, settings, warnings, info) {
    if (settings.profileLimitMb === 0) {
      console.info('[webapp] 体积上限设为 0（不限制），跳过预检')
      return null
    }
    let size = null
    try {
      size = await callHelper('profileSize', {
        name,
        // 设置刚变更过 → 本次必须重算（失效条件 ⑥ 的实现口径：不新增通道方法）
        force: settingsChanged,
        ...rootParam(info)
      })
      settingsChanged = false
    } catch (err) {
      warnings.push(`[profile-size-failed] ${messageOf(err)}`)
      console.warn(`[webapp] 量体积失败，降级放行：${messageOf(err)}`)
      return null
    }

    const bytes = size?.bytes === null || size?.bytes === undefined ? null : Number(size.bytes)
    const verdict = checkProfileLimit(bytes, settings.profileLimitMb)
    if (verdict.skip || !verdict.overLimit) return null

    const text =
      `${OVER_LIMIT} 「${entry.name}」的浏览器数据已用 ${formatBytes(bytes)}，` +
      `超过上限 ${formatBytes(verdict.limitBytes)}（其中可清理的缓存约 ${formatBytes(
        size?.cacheBytes
      )}）；` +
      '可先清理缓存（保留登录状态与 Cookie）后重试，或选择「仍然打开」'
    return {
      ok: false,
      error: text,
      data: {
        overLimit: true,
        id,
        bytes,
        limitBytes: verdict.limitBytes,
        cacheBytes: Number(size?.cacheBytes ?? 0)
      }
    }
  }

  /** `probe`：把助手的环境与 Chrome 探测结果透给界面（「环境检查」用），按生效根解析 */
  async function probe() {
    const info = effectiveRootNow()
    return ok(await callHelper('probe', rootParam(info)))
  }

  /**
   * `profileSize { id, force? }`：条目的体积（连带当前上限与是否超限），供卡片"按需"展示。
   * 助手侧有 60s TTL 缓存，因此连续点击不会反复全量扫盘。
   */
  async function profileSize(params) {
    const id = toId((params ?? {}).id)
    if (id === null) return fail('profileSize 需要合法的 id')
    const entry = await loadEntry(id)
    if (!entry) return fail('网页应用不存在（可能已被删除），请刷新列表')
    const info = effectiveRootNow()
    const settings = info.settings
    const name = entryNameOf(entry)
    const force = params?.force === true || settingsChanged
    const size = await callHelper('profileSize', { name, force, ...rootParam(info) })
    if (force) settingsChanged = false
    const bytes = size?.bytes === null || size?.bytes === undefined ? null : Number(size.bytes)
    const verdict = checkProfileLimit(bytes, settings.profileLimitMb)
    return ok({
      id,
      name,
      root: info.root,
      isDefaultRoot: info.isDefault,
      exists: Boolean(size?.exists),
      bytes,
      entries: Number(size?.entries ?? 0),
      cacheBytes: size?.cacheBytes === null ? null : Number(size?.cacheBytes ?? 0),
      cached: Boolean(size?.cached),
      scannedAt: size?.scannedAt ?? null,
      limitBytes: verdict.limitBytes,
      overLimit: verdict.overLimit
    })
  }

  /**
   * `cleanCaches { id? }`：**只清缓存**（保留登录态）。
   * 省略 `id` = 全局清理（助手侧遍历**生效根**下的全部条目）。
   *
   * ⚠️ 这是本扩展会删数据的动作之一，**必须**由用户显式点出来（不做自动清理）。
   * 返回 `{ cleaned, totalFreedBytes, skipped }`，缺标记时**多一个** `refused`（整体拒绝、不抛错）。
   */
  async function cleanCaches(params) {
    const rawId = (params ?? {}).id
    const info = effectiveRootNow()
    /** @type {{ name?: string, root?: string }} */
    const helperParams = { ...rootParam(info) }
    if (rawId !== undefined && rawId !== null && rawId !== '') {
      const id = toId(rawId)
      if (id === null) return fail('cleanCaches 的 id 不合法')
      const entry = await loadEntry(id)
      if (!entry) return fail('网页应用不存在（可能已被删除），请刷新列表')
      helperParams.name = entryNameOf(entry)
    }
    const result = await callHelper('cleanCaches', helperParams)
    // 清理成功后体积缓存已在助手侧清空；设置变更标记也一并复位
    settingsChanged = false
    if (result && result.refused) {
      console.warn(`[webapp] 清理被拒绝：${result.refused}`)
    }
    return ok(result)
  }

  /**
   * `rootStatus { }`（规格 §9.5.3）：生效根 / 配置值 / 非法原因 / 是否未受管 / 迁移进度。
   *
   * 界面**只在挂载时调一次**（+ 迁移未完成时用户点按钮），**禁止**常驻轮询（§9.8）。
   */
  async function rootStatus() {
    // 显式调用时也触发一次对账（"界面也可显式调 rootStatus 触发一次对账"，§9.4 触发点）
    try {
      rootIntent = await readRootIntent()
      await reconcileNow()
    } catch (err) {
      console.warn(`[webapp] rootStatus 对账失败：${messageOf(err)}`)
    }
    return ok(await rootStatusPayload())
  }

  /**
   * `startRootMigration { root, confirmOverwrite?, dataDir? }`（规格 §9.5.3）。
   *
   * 三种返回：
   * - `{ started: false, needsConfirm: true, conflicts: [名…] }`：**有冲突且未确认 ⇒ 不动手**，
   *   把冲突清单回给界面弹覆盖确认框；
   * - `{ started: false, reason }`：无存量条目可迁 ⇒ `reason = '无需迁移'`，且**已写设置**；
   * - `{ started: true, to, total, needsConfirm: false }`：已开始（或在续做路径上完成）。
   */
  async function startRootMigration(params) {
    const requested = params?.root
    const confirmOverwrite = params?.confirmOverwrite === true
    const target = targetRootFor(requested)
    if (target.error) return fail(target.error)
    if (target.warning) console.warn(`[webapp] ${target.warning}`)

    // 迁移未完成时**禁止发起新的根变更**（规格 §9.4 互斥 / D14）：
    // 唯一例外是"同一个目标根的续做"（继续 / 确认覆盖）。
    rootIntent = rootIntent === undefined ? await readRootIntent() : rootIntent
    const active = activeIntent()
    if (active && !samePath(active.to, target.root)) {
      return fail('已有一次未完成的浏览器数据迁移，请先完成或放弃后再改根')
    }

    const info = effectiveRootNow()
    if (samePath(target.root, info.root)) {
      // 生效根已经是它（例如重复提交未变化的设置值）⇒ 无迁移
      return ok({ started: false, reason: '无需迁移' })
    }
    if (active && active.from && !samePath(active.from, info.root)) {
      return fail('迁移意图里的源根与当前生效根不一致，请先放弃这次迁移')
    }

    // 目标根**必须有标记**（硬前提）：建目录 + 写标记（幂等）；失败 ⇒ 不开始
    try {
      await callHelper('prepareRoot', { root: target.root, dataDir: params?.dataDir ?? '' })
    } catch (err) {
      return fail(`无法准备目标根目录：${messageOf(err)}`)
    }

    let intent = active
    if (!intent) {
      // 新迁移：只有**库里存在且源根下确实有目录**的条目才进 items（宁可不搬，也不搬错）
      const db = await ensureSchema()
      const rows = await db.get_all()
      const sourceEntries = new Set(await listRootEntries(info.root))
      const names = []
      for (const row of Array.isArray(rows) ? rows : []) {
        const entry = fromDbRow(row)
        const name = entryNameOf(entry)
        if (name && sourceEntries.has(name)) names.push(name)
      }
      names.sort()
      if (!names.length) {
        // 无存量条目可迁 ⇒ **仍写设置**（"根已就绪且无迁移"是终态，规格 §7.2）
        try {
          await api.settings.set(SETTING_KEYS.profileRoot, target.root)
        } catch (err) {
          return fail(`无法写入设置：${messageOf(err)}`)
        }
        lastGoodRoot = target.root
        await clearRootIntent()
        return ok({ started: false, reason: '无需迁移' })
      }
      intent = createRootIntent({
        from: info.root,
        to: target.root,
        version: EXT_VERSION,
        items: names.map((name) => ({ name }))
      })
    }

    // **冲突预检**（规格 §9.4「覆盖语义的确认步骤」第 1 步）：逐条探测，任何删除之前
    const conflicts = []
    for (const item of intent.items) {
      try {
        const probed = await probeItem(intent, item.name)
        if (probed?.conflict === true) conflicts.push(item.name)
      } catch (err) {
        console.warn(`[webapp] 冲突预检失败（${item.name}）：${messageOf(err)}`)
      }
    }

    if (conflicts.length && !confirmOverwrite && !conflictsConfirmed(intent.conflicts, conflicts)) {
      // 回给界面弹确认框；**一个字都没删**（意图文件也先不写：用户可能直接取消）
      return ok({
        started: false,
        needsConfirm: true,
        conflicts,
        to: intent.to,
        total: intent.items.length
      })
    }

    if (confirmOverwrite) {
      // 用户已看过清单并点「覆盖并继续」⇒ 把确认写进意图，并把对应条目标 overwrite。
      //
      // ⚠️ **数据安全（P1 = B 的闸门）**：确认的**唯一来源**是调用方传进来的 `names`
      // （= 用户在确认框里**逐条看到**的那份清单），**不得**用"服务端当前扫到的 conflicts"顶上——
      // 否则调用方只要多传一个 `confirmOverwrite: true`，就等于替用户确认了他没看过的冲突。
      // 只有当调用方明确声明"我看到的清单 == 服务端此刻的冲突集"时才落确认。
      const confirmedNames = Array.isArray(params?.names)
        ? [...new Set(params.names.map((name) => String(name)))]
        : []
      const covered = conflictsConfirmed(
        { confirmedAt: 'declared', names: confirmedNames },
        conflicts
      )
      if (!covered) {
        return fail('覆盖确认的清单与当前冲突不一致，已拒绝执行（请在界面上重新确认）')
      }
      const now = new Date().toISOString()
      intent = {
        ...intent,
        conflicts: { confirmedAt: now, confirmedBy: 'user', names: confirmedNames },
        items: intent.items.map((item) =>
          confirmedNames.includes(item.name) ? { ...item, overwrite: true } : item
        ),
        updatedAt: now
      }
    }

    await writeRootIntent(intent)
    const outcome = await reconcileNow()
    if (outcome?.needsConfirm) {
      return ok({
        started: false,
        needsConfirm: true,
        conflicts: outcome.conflicts,
        to: intent.to,
        total: intent.items.length
      })
    }
    return ok({
      started: true,
      to: intent.to,
      total: intent.items.length,
      needsConfirm: false,
      blocked: outcome?.blocked ?? '',
      summary: summarize(outcome?.intent ?? intent)
    })
  }

  /**
   * `resolveRootMigration { action }`（规格 §9.5.3）：
   * `continue` / `abandon` / `confirm-overwrite`。
   *
   * ⚠️ **`abandon` 不删已经搬过去的数据**（D12）：只删意图文件并把设置值写回 `from`；
   * 已经复制到 `to` 的目录**保留**（它们可能是用户想要的），由用户自行删除。
   */
  async function resolveRootMigration(params) {
    const action = String(params?.action ?? '').trim()
    if (!['continue', 'abandon', 'confirm-overwrite'].includes(action)) {
      return fail(`resolveRootMigration 的 action 不合法：${action}`)
    }
    rootIntent = rootIntent === undefined ? await readRootIntent() : rootIntent
    const intent = activeIntent()
    if (!intent) {
      // 没有未完成的迁移：把结果如实回给界面（不报错，界面可能只是慢了一拍）
      return ok({
        action,
        phase: 'none',
        total: 0,
        done: 0,
        overwritten: 0,
        skipped: 0,
        failed: 0,
        missing: 0,
        wroteSetting: false
      })
    }

    if (action === 'abandon') {
      const from = intent.from
      rootIntent = { ...intent, phase: 'abandoned', updatedAt: new Date().toISOString() }
      let wroteSetting = false
      try {
        // 放弃 ⇒ 设置值写回旧根（若宿主已把新值写进去，这一步把它纠正回来）
        await api.settings.set(SETTING_KEYS.profileRoot, from)
        wroteSetting = true
        lastGoodRoot = ''
      } catch (err) {
        console.warn(`[webapp] 放弃迁移时写回旧根失败：${messageOf(err)}`)
      }
      await clearRootIntent()
      console.info('[webapp] 已放弃根迁移；已复制到目标根的数据**保留**，需你自行清理')
      const summary = summarize(intent)
      return ok({ action, phase: 'abandoned', ...summary, wroteSetting })
    }

    if (action === 'confirm-overwrite') {
      // 逐条列出并确认后才允许动手：把确认记录写进意图（续做路径的**强制复确认**）
      const names =
        Array.isArray(params?.names) && params.names.length
          ? params.names.map((name) => String(name))
          : pendingConflicts(intent)
      if (!names.length) {
        // 没有待确认项：当成"继续"
        const outcome = await reconcileNow()
        const summary = summarize(outcome?.intent ?? intent)
        return ok({
          action,
          phase: outcome?.intent?.phase ?? intent.phase,
          ...summary,
          wroteSetting: outcome?.wroteSetting === true
        })
      }
      const now = new Date().toISOString()
      const next = {
        ...intent,
        conflicts: { confirmedAt: now, confirmedBy: 'user', names },
        items: intent.items.map((item) =>
          names.includes(item.name) ? { ...item, overwrite: true } : item
        ),
        updatedAt: now
      }
      await writeRootIntent(next)
      const outcome = await reconcileNow()
      const summary = summarize(outcome?.intent ?? next)
      return ok({
        action,
        phase: outcome?.intent?.phase ?? next.phase,
        ...summary,
        needsConfirm: outcome?.needsConfirm === true,
        conflicts: outcome?.conflicts ?? [],
        wroteSetting: outcome?.wroteSetting === true
      })
    }

    // continue
    const outcome = await reconcileNow()
    const summary = summarize(outcome?.intent ?? intent)
    return ok({
      action,
      phase: outcome?.intent?.phase ?? intent.phase,
      ...summary,
      needsConfirm: outcome?.needsConfirm === true,
      conflicts: outcome?.conflicts ?? [],
      wroteSetting: outcome?.wroteSetting === true
    })
  }

  /**
   * `browseRootDir { dataDir? }`（规格 §9.5.3 / §7.4）。
   *
   * **只能在这里调 `api.dialog`**：子窗口没有 `api`（`test/ipcSurface.test.js`），
   * 界面走 `callExtension('browseRootDir')` 回到扩展入口。
   *
   * 能力探测（**行为探测，不看版本号**，D18）：
   * - 用户取消 ⇒ `supported` 记为 `true`（对话框确实开了），不改动任何值；
   * - 选到**目录**（经**助手** `checkRootCandidate` 判定）⇒ `supported: true`，候选根 = 该目录；
   * - 选到**文件** ⇒ 老宿主忽略了 `properties` ⇒ `supported: false`，候选根 = 其**父目录** + 降级提示；
   * - 宿主回 `{ ok: false }` ⇒ `supported: false` + 失败提示。
   * 结论**只缓存在本会话内存**（不落库、不写设置；扩展重新激活后重新探一次）。
   */
  async function browseRootDir(params) {
    if (!api.dialog || typeof api.dialog.showOpenDialog !== 'function') {
      // 连对话框能力都没有（更老的宿主/精简环境）⇒ 直接给降级结论，**不报错**
      browseSupported = false
      return ok({
        supported: false,
        candidate: null,
        canceled: false,
        degraded: true,
        note: DEGRADED_NOTE,
        invalid: null
      })
    }
    let replied
    try {
      replied = await api.dialog.showOpenDialog({
        title: '选择浏览器数据根目录',
        properties: ['openDirectory']
      })
    } catch (err) {
      browseSupported = false
      return ok({
        supported: false,
        candidate: null,
        canceled: false,
        degraded: true,
        note: `无法打开目录选择框（${messageOf(err)}）；请手工粘贴目录路径`,
        invalid: null
      })
    }

    const filePaths = Array.isArray(replied?.filePaths) ? replied.filePaths : []
    const first = filePaths.length ? String(filePaths[0]) : ''
    if (replied?.ok === false) {
      browseSupported = false
      return ok({
        supported: false,
        candidate: null,
        canceled: false,
        degraded: true,
        note: `无法打开目录选择框（${String(replied?.error ?? '未知原因')}）；请手工粘贴目录路径`,
        invalid: null
      })
    }
    if (replied?.canceled === true) {
      // 用户取消 ⇒ **不改动任何值**，只记一条 info（`supported` 记 true：对话框确实开了）
      console.info('[webapp] 「浏览…」被取消，未改动任何值')
      return ok({
        supported: true,
        candidate: null,
        canceled: true,
        degraded: false,
        note: '',
        invalid: null
      })
    }
    if (!first) {
      // `ok:true` 又没有路径、也没报 canceled：**不作"取消"处理**（不替用户下结论），
      // 一律走降级路径并把话说明白（宿主契约：取消一定会带 `canceled:true`）
      browseSupported = false
      return ok({
        supported: false,
        candidate: null,
        canceled: false,
        degraded: true,
        note: DEGRADED_NOTE,
        invalid: null
      })
    }

    // **判定必须落到助手侧**：候选根在扩展目录之外，扩展入口没有 `node:fs`（规格 §7.4 的注）
    let verdict
    try {
      verdict = await callHelper('checkRootCandidate', {
        candidate: first,
        dataDir: params?.dataDir ?? ''
      })
    } catch (err) {
      return ok({
        supported: false,
        candidate: null,
        canceled: false,
        degraded: true,
        note: `无法校验所选路径（${messageOf(err)}）；请手工粘贴目录路径`,
        invalid: null
      })
    }

    if (verdict?.isDirectory === true) {
      // 宿主确实支持选目录（拿到的是目录）⇒ 探测结论 = supported
      browseSupported = true
      if (verdict.invalid) {
        // 目录选对了、但**没过 V1–V7** ⇒ 不改动任何值，把原因回给界面
        return ok({
          supported: true,
          candidate: null,
          canceled: false,
          degraded: false,
          note: '',
          invalid: { reason: verdict.invalid.reason },
          warning: verdict.warning ?? null
        })
      }
      return ok({
        supported: true,
        candidate: verdict.candidate,
        canceled: false,
        degraded: false,
        note: verdict.warning ?? '',
        invalid: null,
        warning: verdict.warning ?? null
      })
    }

    // 选到的是**文件** ⇒ 老宿主没读 `properties` ⇒ 降级路径（候选根 = 其父目录）
    browseSupported = false
    const parent = verdict?.parent ?? null
    if (parent) {
      // 父目录也要过一遍校验（它是"从文件推出来的"，不能免检）；失败就只给提示、不给候选
      let parentVerdict = null
      try {
        parentVerdict = await callHelper('checkRootCandidate', {
          candidate: parent,
          dataDir: params?.dataDir ?? ''
        })
      } catch {
        parentVerdict = null
      }
      if (parentVerdict?.isDirectory !== true) {
        return ok({
          supported: false,
          candidate: null,
          canceled: false,
          degraded: true,
          note: `${FILE_SELECTED_NOTE}（该文件所在的文件夹不存在或不可访问）`,
          invalid: null
        })
      }
      if (parentVerdict.invalid) {
        return ok({
          supported: false,
          candidate: null,
          canceled: false,
          degraded: true,
          note: `${FILE_SELECTED_NOTE}（${parentVerdict.invalid.reason}）`,
          invalid: { reason: parentVerdict.invalid.reason }
        })
      }
    }
    return ok({
      supported: false,
      candidate: parent,
      canceled: false,
      degraded: true,
      note: parent ? FILE_SELECTED_NOTE : DEGRADED_NOTE,
      invalid: null
    })
  }

  // ---- 注册 ----

  const card = api.app.register({
    id: APP_ID,
    name: '网页应用',
    version: EXT_VERSION,
    author: 'chenzhi',
    description: '网页应用：以 Chrome 应用模式打开内部站点，按条目独立 profile',
    icon: CARD_ICON,
    // ⚠️ 必须用 import.meta.url 推导：安装目录名是 `webapp_chenzhi`，
    // 硬编码 `app://extensions/webapp/` 会 404
    url: new URL('./ui/index.html', new URL('.', import.meta.url)).href,
    multiOpen: false, // 重复点击聚焦已有窗口（不新建）
    width: 1024,
    height: 720
  })

  const offMessage = api.app.onMessage(async (channel, payload) => {
    const { method, params } = resolveRequest(channel, payload)
    try {
      switch (method) {
        case 'list':
          return await list()
        case 'save':
          return await save(params)
        case 'remove':
          return await remove(params)
        case 'open':
          return await open(params)
        case 'probe':
          return await probe()
        case 'profileInfo':
          return await profileInfo(params)
        case 'profileSize':
          return await profileSize(params)
        case 'cleanCaches':
          return await cleanCaches(params)
        case 'rootStatus':
          return await rootStatus()
        case 'startRootMigration':
          return await startRootMigration(params)
        case 'resolveRootMigration':
          return await resolveRootMigration(params)
        case 'browseRootDir':
          return await browseRootDir(params)
        default:
          return fail(`未知方法: ${String(method)}`)
      }
    } catch (err) {
      console.error(`[webapp] ${method} 失败`, err)
      // 参数构造类错误带字段级详情，给界面更可读的文案
      if (err instanceof ChromeArgsError) return fail(err.message)
      return fail(err)
    }
  })

  return () => {
    offClose?.dispose()
    offSettings?.dispose()
    offMessage.dispose()
    card.dispose()
    if (connected) {
      connected = false
      void Promise.resolve(api.ipc.close(CHANNEL_ID)).catch(() => {})
    }
  }
}

/**
 * 安装 / 升级钩子（规格 §14.4(g-1)）：**只允许幂等动作，绝不触碰 profile**。
 *
 * ⚠️ 覆盖安装会**重跑**本钩子（`ctx.upgraded === true`），而那时 `data/chrome/**` 里是用户的
 * 登录态。任何"顺手整理"（重命名目录以对齐 name、删孤儿目录、清 `.trash` 以外的内容）
 * 都会造成**不可恢复**的登录态丢失 —— 因此这里只打一条日志、什么都不动。
 *
 * 建库建表与唯一索引放在**首次使用时**（懒 `ensureSchema()`），不放在钩子里：
 * 钩子是"安装完成后的附加动作"，不该成为"数据库结构"的隐式前提，也不该在钩子预算里干活。
 *
 * @param {{ api?: object, upgraded?: boolean, version?: string }} [ctx]
 */
export async function install(ctx) {
  const upgraded = ctx?.upgraded === true
  console.log(
    `[webapp] 安装${upgraded ? '（覆盖升级）' : ''}：浏览器数据目录保持原样（data/chrome 由宿主在升级时保留）`
  )
}

/**
 * 卸载钩子（规格 §14.4(d) / §9.7 的卸载禁令）：**不得**搬运 / 备份 / 删除 profile，
 * 也**不得**删除外部根下的任何东西，也不得做任何耗时操作。
 *
 * 为什么什么都不做（写进代码，避免后来者"顺手加回来"）：
 * 1. 钩子预算只有 **10s**（`src/main/hookBridge.ts:16`），而单个 profile 可能 GB 级；
 * 2. 钩子超时/失败后宿主**照样**递归删除整个扩展目录（`src/main/capabilities.ts:118`），
 *    于是"搬了一半"只会给用户"以为备份了"的错觉——**比不备份更危险**；
 * 3. 钩子跑在渲染进程，扩展没有 `node:fs`，`api.fs` 又限定在 data 目录内且没有 rename。
 *
 * **卸载语义（对照式，必须与 README / 设置项 description 同一份口径，P4 = A）**：
 * - **默认根**（`<扩展 data>/chrome`）下的 profile 与登录态**随卸载永久删除**
 *   （宿主递归删除整个扩展目录，含 `data/**`）；
 * - **外部根**（`webapp.profileRoot` 指向的绝对路径）下的 profile **保留在磁盘上**，
 *   **需你自行清理**——宿主只删 `<userData>/extensions/webapp_chenzhi/`，够不到外部根。
 *
 * 本钩子**允许的唯一动作**是删掉迁移意图文件（避免重装后被误判成"还有一次未完成的迁移"）
 * 与记日志；它**不读也不写**任何 profile 目录。
 *
 * @param {{ api?: { fs?: { remove?: (rel: string) => Promise<void> } } }} [ctx]
 */
export async function uninstall(ctx) {
  console.log(
    '[webapp] 卸载：默认根（data/chrome）下的浏览器数据将随扩展目录一并**永久删除**（含登录态）'
  )
  console.log(
    '[webapp] 卸载：指向外部目录的 profile **保留在磁盘上**（该目录不在扩展内，卸载扩展时不会删除它），**需你自行清理**'
  )
  try {
    await ctx?.api?.fs?.remove?.(ROOT_INTENT_REL)
    console.log(`[webapp] 卸载：已清理迁移意图文件 ${ROOT_INTENT_REL}`)
  } catch {
    // 没有意图文件、或 api.fs 不可用：都不是错误（钩子里绝不抛错）
  }
}

/**
 * 供维护与测试复用的常量（也让打包器把这些导出视为被引用）。
 * 注意：`LANG_VALUES` / `SCALE_VALUES` 的**定义**在 `lib/entryFields.mjs`，这里只是转出。
 */
export const WEBAPP_CONSTANTS = Object.freeze({
  APP_ID,
  DB_NAME,
  CHANNEL_ID,
  OVER_LIMIT,
  TIMEOUTS,
  LANG_VALUES,
  SCALE_VALUES
})
