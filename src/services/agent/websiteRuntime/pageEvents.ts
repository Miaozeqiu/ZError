import { listen } from '@tauri-apps/api/event'

/** A subscription belongs to one invocation and is disposed on every exit path. */
export function waitForWebsitePage(browserId: string, signal: AbortSignal, timeoutMs: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted()
    let unlisten: (() => void) | undefined
    let settled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const dispose = () => {
      signal.removeEventListener('abort', abort)
      if (timer) clearTimeout(timer)
      unlisten?.()
    }
    const finish = (error?: unknown, value?: Record<string, unknown>) => {
      if (settled) return
      settled = true
      dispose()
      if (error) reject(error)
      else resolve(value!)
    }
    const abort = () => finish(new DOMException('已停止', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    timer = setTimeout(() => finish(undefined, { ok: false, reason: 'timeout' }), timeoutMs)
    void listen<{ id: string; phase: string; url: string }>('app-browser-load', event => {
      if (event.payload.id === browserId && event.payload.phase === 'finished') {
        finish(undefined, { ok: true, event: 'page.loaded' })
      }
    }).then(stop => {
      unlisten = stop
      if (settled) stop()
    }).catch(error => finish(error))
  })
}
