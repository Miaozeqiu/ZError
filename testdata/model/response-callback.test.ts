import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ finalModelResponseState: new Map(), requestLogs: { value: [] }, clearRequestHeartbeat: vi.fn(), applyLocalRequestCompletion: vi.fn() }))
vi.mock('../../src/services/questionServer/runtime', () => state)
vi.mock('../../src/services/questionServer/serverRefs', () => ({ serverUrl: { value: 'http://localhost:3000' } }))
import { sendModelResponseToBackend } from '../../src/services/questionServer/backend'
beforeEach(() => {
  state.finalModelResponseState.clear(); vi.clearAllMocks()
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true }))))
})
it('explicit failure stays failure even if the content looks like a valid answer', async () => {
  await sendModelResponseToBackend('failed', '{"answer":"42"}', false)
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).is_success).toBe(false)
  expect(state.finalModelResponseState.get('failed')).toBe('error')
  expect(state.applyLocalRequestCompletion.mock.calls[0][1]).toBe(500)
})
it('does not report an error envelope as success', async () => {
  await sendModelResponseToBackend('bad-payload', '{"error":{"message":"bad key"}}', true)
  expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]!.body as string).is_success).toBe(false)
})
it('uses the backend model verdict rather than HTTP acknowledgement success', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ success: true, is_success: false }))))
  await sendModelResponseToBackend('rejected', '{"answer":"42"}', true)
  expect(state.finalModelResponseState.get('rejected')).toBe('error')
  expect(state.applyLocalRequestCompletion.mock.calls[0][1]).toBe(500)
})
it('keeps normal valid answers successful', async () => {
  await sendModelResponseToBackend('valid', '{"answer":"42"}', true)
  expect(state.finalModelResponseState.get('valid')).toBe('success')
})
