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

/** App 卡片 id（宿主按它把子窗口消息路由到本扩展） */
const APP_ID = 'webapp.main'
/** 条目库（`<扩展>/data/webapp.db`，默认表名 `webapp`） */
const DB_NAME = 'webapp.db'
/** manifest 里静态声明的 IPC 通道 id */
const CHANNEL_ID = 'webapp.helper'
/** 体积超限的错误前缀（界面据此区分"要用户选"与"真错误"，规格 S17） */
const OVER_LIMIT = '[profile-over-limit]'

/**
 * helper 调用的超时口径（规格 §11.2 的"超时口径"表逐条对应）。
 * ⚠️ **必须显式给**：宿主默认 30s，而 `launch`（Chrome 冷启动）与
 * `removeProfile` / `cleanCaches`（GB 级目录）都可能超过它——不显式放宽的话宿主会先报
 * `[timeout]`，而助手仍在继续干活（`extensions/rdp/index.js:154-156` 的教训）。
 */
const TIMEOUTS = Object.freeze({
  probe: 60_000,
  launch: 60_000,
  profileStatus: 30_000,
  profileSize: 120_000,
  cleanCaches: 300_000,
  moveProfile: 300_000,
  removeProfile: 300_000
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

  // ---- 设置（R17）：两个 select 的字符串档位 ----

  /**
   * 读设置并归一（规格 §10.4）。
   * 归一失败（非有限数 / 负数 / **不在档位内**）→ 回落默认值，并 `console.warn` 一次。
   * @returns {{ profileLimitMb: number, diskCacheMb: number }}
   */
  function readSettings() {
    const limitRaw = api.settings?.get
      ? api.settings.get(SETTING_KEYS.profileLimitMb, String(DEFAULT_PROFILE_LIMIT_MB))
      : String(DEFAULT_PROFILE_LIMIT_MB)
    const cacheRaw = api.settings?.get
      ? api.settings.get(SETTING_KEYS.diskCacheMb, String(DEFAULT_DISK_CACHE_MB))
      : String(DEFAULT_DISK_CACHE_MB)
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
    return { profileLimitMb: limit.mb, diskCacheMb: cache.mb }
  }

  /**
   * 设置变更时**作废体积缓存**（规格 §14.6 的失效条件 ⑥）。
   * 实现口径：不新增通道方法，改为把"下一次 `profileSize` 必须带 `force: true`"记在这里。
   */
  let settingsChanged = false
  const offSettings =
    typeof api.settings?.onChanged === 'function'
      ? api.settings.onChanged((key) => {
          if (typeof key === 'string' && key.startsWith('webapp.')) settingsChanged = true
        })
      : null

  // ---- 方法实现 ----

  /** `list`：全部条目（按 createdAt 升序） */
  async function list() {
    const db = await ensureSchema()
    const rows = await db.get_all()
    return ok(sortByCreatedAt(Array.isArray(rows) ? rows : []).map(fromDbRow))
  }

  /** 目录是否存在（`profileStatus` 的薄封装；通道不可用时当作"不存在"，让删除只删库行） */
  async function profileExists(name) {
    try {
      const status = await callHelper('profileStatus', { name })
      return { exists: Boolean(status?.exists), locked: Boolean(status?.locked), dir: status?.dir }
    } catch {
      return { exists: false, locked: false, dir: '' }
    }
  }

  /** `profileInfo { id }`：磁盘状态（**不返回体积**——体积走 `profileSize`） */
  async function profileInfo(params) {
    const id = toId((params ?? {}).id)
    if (id === null) return fail('profileInfo 需要合法的 id')
    const db = await ensureSchema()
    const row = await db.get(id)
    if (!row) return fail('网页应用不存在（可能已被删除），请刷新列表')
    const entry = fromDbRow(row)
    const name = entry.profileDir || sanitizeName(entry.name)
    const status = await profileExists(name)
    return ok({
      id,
      profileDir: name,
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

    if (renaming) {
      // 目标目录已存在 → 直接拒绝（避免把两个站点的数据混在一起）
      const status = await profileExists(newDir)
      if (status.exists) {
        return fail(`目标浏览器数据目录已存在（${newDir}），请换一个名称`)
      }
      try {
        const moved = await callHelper('moveProfile', { from: oldDir, to: newDir })
        // 源不存在 = 无需移动，按成功处理（只改库）
        if (moved && moved.missing === true) {
          console.info(`[webapp] 改名：${oldDir} 不存在，只更新库里的目录名`)
        }
      } catch (err) {
        return fail(
          `无法把浏览器数据目录从 ${oldDir} 改名为 ${newDir}（${messageOf(err)}），条目名称未修改`
        )
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
          await callHelper('moveProfile', { from: newDir, to: oldDir })
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

  /** `remove { id }`：预检 → 删 profile（进 .trash 后清理）→ 删库行 */
  async function remove(params) {
    const id = toId((params ?? {}).id)
    if (id === null) return fail('remove 需要合法的 id')
    const db = await ensureSchema()
    const row = await db.get(id)
    if (!row) return fail('网页应用不存在（可能已被删除），请刷新列表')
    const entry = fromDbRow(row)
    const name = entry.profileDir || sanitizeName(entry.name)
    const warnings = []

    // 目录不存在 → 只删库行（与 rdp 的 deleteCredential"缺条目不算失败"同口径）
    const status = await profileExists(name)
    if (status.exists) {
      try {
        const result = await callHelper('removeProfile', { name })
        if (result && result.warning) warnings.push(result.warning)
      } catch (err) {
        const text = messageOf(err)
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
    const settings = readSettings()
    const name = entry.profileDir || sanitizeName(entry.name)
    const warnings = []
    const force = params?.force === true

    if (!force) {
      const blocked = await precheckSize(id, entry, name, settings, warnings)
      if (blocked) return blocked
    }

    const args = buildChromeArgs(entry, {
      profileName: name,
      diskCacheMb: settings.diskCacheMb
    })
    // 只记摘要（**不打印完整命令行**），且 URL 里的 userinfo 会被脱敏
    console.info(`[webapp] launch ${describeLaunch({ args })}`)
    const result = await callHelper('launch', { args })
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
  async function precheckSize(id, entry, name, settings, warnings) {
    if (settings.profileLimitMb === 0) {
      console.info('[webapp] 体积上限设为 0（不限制），跳过预检')
      return null
    }
    let size = null
    try {
      size = await callHelper('profileSize', {
        name,
        // 设置刚变更过 → 本次必须重算（失效条件 ⑥ 的实现口径：不新增通道方法）
        force: settingsChanged
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

  /** `probe`：把助手的环境与 Chrome 探测结果透给界面（「环境检查」用） */
  async function probe() {
    return ok(await callHelper('probe', {}))
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
    const settings = readSettings()
    const name = entry.profileDir || sanitizeName(entry.name)
    const force = params?.force === true || settingsChanged
    const size = await callHelper('profileSize', { name, force })
    if (force) settingsChanged = false
    const bytes = size?.bytes === null || size?.bytes === undefined ? null : Number(size.bytes)
    const verdict = checkProfileLimit(bytes, settings.profileLimitMb)
    return ok({
      id,
      name,
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
   * 省略 `id` = 全局清理（助手侧遍历 profile 根下全部条目）。
   *
   * ⚠️ 这是本扩展会删数据的动作之一，**必须**由用户显式点出来（不做自动清理）。
   * 返回 `{ cleaned, totalFreedBytes, skipped }`，界面据此如实报告"释放了多少、跳过了几项"。
   */
  async function cleanCaches(params) {
    const rawId = (params ?? {}).id
    /** @type {{ name?: string }} */
    const helperParams = {}
    if (rawId !== undefined && rawId !== null && rawId !== '') {
      const id = toId(rawId)
      if (id === null) return fail('cleanCaches 的 id 不合法')
      const entry = await loadEntry(id)
      if (!entry) return fail('网页应用不存在（可能已被删除），请刷新列表')
      helperParams.name = entry.profileDir || sanitizeName(entry.name)
    }
    const result = await callHelper('cleanCaches', helperParams)
    // 清理成功后体积缓存已在助手侧清空；设置变更标记也一并复位
    settingsChanged = false
    return ok(result)
  }

  // ---- 注册 ----

  const card = api.app.register({
    id: APP_ID,
    name: '网页应用',
    version: '1.0.0',
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
 * 卸载钩子（规格 §14.4(d)）：**不得**搬运 / 备份 / 删除 profile，也不得做任何耗时操作。
 *
 * 为什么什么都不做（写进代码，避免后来者"顺手加回来"）：
 * 1. 钩子预算只有 **10s**（`src/main/hookBridge.ts:16`），而单个 profile 可能 GB 级；
 * 2. 钩子超时/失败后宿主**照样**递归删除整个扩展目录（`src/main/capabilities.ts:118`），
 *    于是"搬了一半"只会给用户"以为备份了"的错觉——**比不备份更危险**；
 * 3. 钩子跑在渲染进程，扩展没有 `node:fs`，`api.fs` 又限定在 data 目录内且没有 rename。
 *
 * 因此：卸载 = 所有站点浏览器数据永久消失，这一点由 README 的醒目段落 + 卸载前备份命令承担
 * （D-1 选项 A）。
 *
 * @param {{ api?: object }} [ctx]
 */
export async function uninstall(ctx) {
  console.log('[webapp] 卸载：浏览器数据目录将随扩展目录一并删除（data/chrome）')
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
