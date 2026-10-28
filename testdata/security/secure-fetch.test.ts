import { beforeEach, describe, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ enabled: true, invoke: vi.fn() }))
vi.mock('../../src/services/security/secureStore', () => ({ isNativeSecureStore: () => native.enabled }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke, Channel: class { onmessage = (_event: unknown) => {} } }))
import { secureFetch } from '../../src/services/security/secureFetch'
const chunk = (text: string) => ({ type: 'chunk', data: Buffer.from(text).toString('base64') })
beforeEach(() => { native.enabled = true; native.invoke.mockReset() })
describe('native streaming HTTP transport', () => {
  it('preserves UTF-8 streams and forwards body references without resolving them', async () => {
    native.invoke.mockImplementation(async (name, args) => {
      expect(name).toBe('secure_http_request')
      expect(args.headers.authorization).toBe('Bearer {{secret:model/demo/apiKey}}')
      expect(args.body).toContain('{{secret:site/example.test/password}}')
      args.events.onmessage({ type: 'headers', status: 200, headers: { 'content-type': 'text/event-stream' } })
      args.events.onmessage(chunk('data: 你好'))
      args.events.onmessage(chunk('，世界\n\n'))
      args.events.onmessage({ type: 'done' })
    })
    const response = await secureFetch('https://api.example.test/v1/chat', { method: 'POST', headers: { Authorization: 'Bearer {{secret:model/demo/apiKey}}' }, body: JSON.stringify({ content: '{{secret:site/example.test/password}}' }) })
    expect(response.headers.get('content-type')).toBe('text/event-stream')
    expect(await response.text()).toBe('data: 你好，世界\n\n')
  })
  it('cancels both pending responses and active streams without hanging', async () => {
    native.invoke.mockImplementation(async () => new Promise(() => {}))
    const pending = new AbortController()
    const waiting = secureFetch('https://api.example.test/', { signal: pending.signal })
    pending.abort()
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    expect(native.invoke).toHaveBeenCalledWith('secure_http_cancel', expect.objectContaining({ requestId: expect.any(String) }))
    native.invoke.mockImplementation(async (name, args) => {
      if (name === 'secure_http_request') args.events.onmessage({ type: 'headers', status: 200, headers: {} })
    })
    const active = new AbortController()
    const response = await secureFetch('https://api.example.test/', { signal: active.signal })
    active.abort()
    await expect(response.text()).rejects.toMatchObject({ name: 'AbortError' })
  })
  it('reports native connection failures and rejects reference headers in browser previews', async () => {
    native.invoke.mockRejectedValueOnce(new Error('service unavailable'))
    await expect(secureFetch('https://api.example.test/')).rejects.toThrow('service unavailable')
    native.enabled = false
    await expect(secureFetch('https://api.example.test/', { headers: new Headers({ Authorization: 'Bearer {{secret:key}}' }) })).rejects.toThrow('安全请求通道')
  })
})
