import { Channel, invoke } from '@tauri-apps/api/core'
import { isNativeSecureStore } from './secureStore'

/** Native streaming transport: JS and custom model scripts see references only. */
export const secureFetch: typeof fetch = async (input, init: RequestInit = {}) => {
  if (!isNativeSecureStore()) {
    const headers = new Headers(init.headers || (input instanceof Request ? input.headers : undefined))
    if ([...headers.values()].some(value => value.includes('{{secret:'))) throw new Error('凭据只能由桌面应用的安全请求通道使用')
    return fetch(input, init)
  }
  const request = new Request(input, init)
  const requestId = crypto.randomUUID()
  let controller: ReadableStreamDefaultController<Uint8Array>
  let resolveResponse!: (response: Response) => void
  let rejectResponse!: (reason: unknown) => void
  let received = false, ended = false
  const body = new ReadableStream<Uint8Array>({ start(value) { controller = value }, cancel() { void cancel() } })
  const response = new Promise<Response>((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject })
  // Serialization may still be pending when cancellation rejects the response.
  void response.catch(() => undefined)
  const cancel = async () => { await invoke('secure_http_cancel', { requestId }).catch(() => undefined) }
  const fail = (reason: unknown) => {
    if (ended) return
    ended = true
    if (received) controller.error(reason)
    else rejectResponse(reason)
    request.signal.removeEventListener('abort', abort)
  }
  const abort = () => { fail(request.signal.reason || new DOMException('请求已取消', 'AbortError')); void cancel() }
  if (request.signal.aborted) { abort(); return response }
  request.signal.addEventListener('abort', abort, { once: true })
  const events = new Channel<any>()
  events.onmessage = event => {
    if (ended) return
    if (event.type === 'headers') {
      received = true
      resolveResponse(new Response([204,205,304].includes(event.status) ? null : body, { status: event.status, headers: event.headers }))
    } else if (event.type === 'chunk') {
      const data = atob(event.data); controller.enqueue(Uint8Array.from(data, char => char.charCodeAt(0)))
    } else if (event.type === 'done') {
      ended = true; controller.close(); request.signal.removeEventListener('abort', abort)
    }
  }
  // Body serialization finishes before dispatch. Do not send a request cancelled during it.
  let text: string | undefined
  try { text = ['GET','HEAD'].includes(request.method) ? undefined : await request.text() }
  catch (error) { fail(error); return response }
  if (request.signal.aborted) { abort(); return response }
  void invoke('secure_http_request', { requestId, url: request.url, method: request.method,
    headers: Object.fromEntries(request.headers.entries()), body: text, events }).catch(fail)
  return response
}
