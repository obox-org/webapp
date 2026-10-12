/**
 * 子窗口消息桥封装（照搬 `extensions/rdp/src/bridge.js` 的协议外壳）。
 *
 * 子窗口是跨源静态页，页面里**没有 api 对象**，一切能力都靠 parent.postMessage：
 *   页面 → 宿主：{ source:'obox-app', action:'obox-extension', appId:'webapp.main', channel:'webapp',
 *                  requestId, payload:{ method, payload } }
 *   宿主 → 页面：{ source:'obox-app', action:'obox-extension-reply', requestId, result }
 *   result = { ok:true, data } | { ok:false, error }
 *
 * 宿主侧单次请求 60s 超时（`src/main/appWindow.ts:163-167`）；本地也设 60s，兜住宿主异常不回包。
 */

/** 卡片 id（宿主按它找卡片、再找所属扩展的 onMessage handler） */
const APP_ID = 'webapp.main'
/** 本扩展注册的消息通道 */
const CHANNEL = 'webapp'
const TIMEOUT_MS = 60_000

let seq = 0
/** requestId → { resolve, timer } */
const pending = new Map()

window.addEventListener('message', (event) => {
  const data = event.data
  if (!data || typeof data !== 'object') return
  if (data.source !== 'obox-app' || data.action !== 'obox-extension-reply') return
  const entry = pending.get(data.requestId)
  if (!entry) return
  pending.delete(data.requestId)
  clearTimeout(entry.timer)
  entry.resolve(data.result)
})

function send(method, payload) {
  return new Promise((resolve) => {
    const requestId = `webapp-${Date.now()}-${++seq}`
    const timer = setTimeout(() => {
      pending.delete(requestId)
      resolve({ ok: false, error: '扩展未响应（超时 60 秒），请重试' })
    }, TIMEOUT_MS)
    pending.set(requestId, { resolve, timer })
    parent.postMessage(
      {
        source: 'obox-app',
        action: 'obox-extension',
        appId: APP_ID,
        channel: CHANNEL,
        requestId,
        payload: { method, payload }
      },
      '*'
    )
  })
}

/**
 * 拆信封。两层来源：
 * 1. 宿主把扩展 handler 的返回值原样塞进 reply 的 `data`：`{ ok:true, data:<handler 返回值> }`；
 * 2. 扩展 handler 自己按 `{ ok:true, data } | { ok:false, error }` 返回。
 * 于是正常路径下 `result.data` 里还有一层同形信封——这里统一拆到最内层，
 * 同时兼容 handler 抛错时宿主直接给的 `{ ok:false, error }`。
 */
function unwrap(result) {
  if (!result || typeof result !== 'object') throw new Error('扩展未返回结果')
  let envelope = result
  const inner = envelope.data
  if (envelope.ok === true && inner && typeof inner === 'object' && typeof inner.ok === 'boolean') {
    envelope = inner
  }
  if (envelope.ok) return envelope.data
  throw new Error(String(envelope.error || '扩展返回了未知错误'))
}

/**
 * 调用扩展方法。失败时抛出带可读文案的 Error，调用方直接展示 `err.message`。
 *
 * ⚠️ 体积超限是"需要用户选择"而不是错误：`open` 会用
 * `error: '[profile-over-limit] …'` 表达它（规格 S17）。这里**不特殊处理**，
 * 由调用方按 `err.message.startsWith('[profile-over-limit]')` 分流。
 *
 * @param {'list'|'save'|'remove'|'open'|'probe'|'profileSize'|'cleanCaches'|'profileInfo'} method
 * @param {unknown} payload
 */
export async function callExtension(method, payload) {
  return unwrap(await send(method, payload))
}
