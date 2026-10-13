/** 开发机 → 应用内浏览器。只在 Tauri 窗口接命令，不进正式包。 */

import { runBridgeAction, type BridgeCmd } from './bridgeApi'

const VITE = 'http://localhost:1420'
const BRIDGES = ['http://127.0.0.1:1429', `${VITE}/__agent-bridge`]

const postJson = (path: string, payload: Record<string, unknown>) => {
  for (const base of BRIDGES) {
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => {})
  }
}

const postDebugFile = (file: string, ext: 'json' | 'md' | 'txt', text: string) => {
  fetch(`${VITE}/__agent-debug-log`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ file, replace: true, ext, text }),
  }).catch(() => {})
}

const postResult = (payload: Record<string, unknown>) => {
  postJson('/result', payload)
  postDebugFile('bridge-result', 'txt', JSON.stringify(payload))
}

let lastInboxId = ''

/** 拉命令的 fetch 必须带超时：一条挂死的连接会让 busy 永远是 true，桥从此不再收命令。 */
const fetchWithin = (url: string, ms = 4_000) => {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), ms)
  return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(timer))
}

const pullCmd = async (): Promise<BridgeCmd | null> => {
  for (const base of BRIDGES) {
    try {
      const res = await fetchWithin(`${base}/cmd`)
      if (res.status === 204) continue
      const type = res.headers.get('content-type') || ''
      if (!type.includes('json')) continue
      const cmd = await res.json()
      if (cmd?.id) return cmd as BridgeCmd
    } catch {
      // 这条桥没起来就试下一条
    }
  }
  try {
    const res = await fetchWithin(`${VITE}/__agent-inbox.json?t=${Date.now()}`)
    if (!res.ok) return null
    const cmd = await res.json()
    if (cmd?.id && cmd.id !== lastInboxId) {
      lastInboxId = String(cmd.id)
      return cmd as BridgeCmd
    }
  } catch {
    // 同源 inbox 还没写
  }
  return null
}

const resolveBrowserId = async (want?: string) => {
  const { listAppBrowsers, getSelectedBrowserId } = await import('../browser/appBrowser')
  const list = listAppBrowsers()
  const asked = String(want || '').trim()
  if (asked) return asked
  const selected = getSelectedBrowserId()
  if (selected && list.some((item) => item.id === selected)) return selected
  return list[0]?.id || ''
}

const snapshotOf = async (browserId: string, withImage: boolean) => {
  const { getBrowserState, listAppBrowsers, screenshotBrowserView } = await import('../browser/appBrowser')
  const { siteGraphAgentSnap } = await import('../browser/siteGraph')
  const state = await getBrowserState(browserId).catch(() => null)
  const item = listAppBrowsers().find((browser) => browser.id === browserId)
  let image = ''
  if (withImage) {
    const shot = await screenshotBrowserView(browserId).catch(() => null)
    image = shot?.image || ''
  }
  return {
    ok: true,
    browserId,
    url: state?.url || item?.url || '',
    title: state?.title || item?.title || item?.name || '',
    siteGraph: siteGraphAgentSnap(state?.url || item?.url || ''),
    image,
  }
}

let pollTimer = 0
let busy = false
let liveTick = 0

const pushLive = () => {
  void (async () => {
    const browserId = await resolveBrowserId().catch(() => '')
    const { listAppBrowsers } = await import('../browser/appBrowser')
    const item = listAppBrowsers().find((browser) => browser.id === browserId)
    const { readCdpStats } = await import('../browser/cdpStats')
    const cdp = await readCdpStats().catch(() => null)
    postJson('/live', {
      browserId,
      url: item?.url || '',
      title: item?.title || item?.name || '',
      lastText: cdp?.line || '',
      cdp: cdp?.line || '',
    })
  })()
}

const waitMs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

let busySince = 0

const tick = async () => {
  // busy 超过 90s 一定是某个 await 没回来（fetch 挂死 / 动作卡住）；放开让下一轮继续拉命令。
  if (busy && Date.now() - busySince < 90_000) return
  busy = true
  busySince = Date.now()
  try {
    const cmd = await pullCmd()
    if (cmd?.id) {
      // 切章 + 等播放器 + 点播放常超过 10s；调用方带 timeoutMs 就按它来，上限 60s。
      const cap = Math.min(60_000, Math.max(3_000, Number((cmd as { timeoutMs?: unknown }).timeoutMs) || 10_000))
      const result = await Promise.race([
        runBridgeAction(cmd).catch((error) => ({
          ok: false,
          id: cmd.id,
          action: cmd.action,
          error: error instanceof Error ? error.message : String(error),
        })),
        waitMs(cap).then(() => ({
          ok: false,
          id: cmd.id,
          action: cmd.action,
          error: '动作超时',
        })),
      ])
      postResult(result as Record<string, unknown>)
    }
    liveTick += 1
    if (liveTick % 5 === 0) pushLive()
  } catch (error) {
    postDebugFile(
      'bridge-boot',
      'txt',
      `tick-error ${error instanceof Error ? error.message : String(error)}\n`,
    )
  } finally {
    busy = false
  }
}

export const dumpCursorSnapshot = async (browserId?: string) => {
  const id = await resolveBrowserId(browserId)
  if (!id) return
  postResult(await snapshotOf(id, true))
}

const isTauriHost = () => Boolean(
  (window as Window & { __TAURI_INTERNALS__?: unknown; __TAURI__?: unknown }).__TAURI_INTERNALS__
  || (window as Window & { __TAURI__?: unknown }).__TAURI__
)

export const startCursorBridge = () => {
  if (pollTimer) return
  if (!isTauriHost()) {
    postDebugFile('bridge-boot', 'txt', `skip-non-tauri ${new Date().toISOString()} ${window.location.href}\n`)
    return
  }
  postJson('/live', { browserId: '', url: '', title: 'bridge-started', lastText: 'cursorBridge 已启动' })
  postDebugFile('bridge-boot', 'txt', `started ${new Date().toISOString()} ${window.location.href}\n`)
  void tick()
  pollTimer = window.setInterval(() => { void tick() }, 400)
}

export const stopCursorBridge = () => {
  if (pollTimer) window.clearInterval(pollTimer)
  pollTimer = 0
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => stopCursorBridge())
}

if (import.meta.env.DEV && isTauriHost()) startCursorBridge()
