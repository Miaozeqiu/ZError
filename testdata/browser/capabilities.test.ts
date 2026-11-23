import { beforeEach, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

beforeEach(() => {
  vi.resetModules()
  invoke.mockReset()
})

it('uses and caches backend capabilities independently of the engine label', async () => {
  invoke.mockResolvedValue({ secureFill: true, audioMute: true })
  const { browserCapabilities } = await import('../../src/services/browser/capabilities')
  expect(await browserCapabilities()).toEqual({ secureFill: true, secureFillInFrames: false, audioMute: true, snapshotViaScript: false, pageScriptActions: false })
  expect(await browserCapabilities()).toEqual({ secureFill: true, secureFillInFrames: false, audioMute: true, snapshotViaScript: false, pageScriptActions: false })
  expect(invoke).toHaveBeenCalledExactlyOnceWith('browser_capabilities')
})

it('keeps operations disabled on query failure and retries when the backend recovers', async () => {
  invoke.mockRejectedValueOnce(new Error('IPC unavailable')).mockResolvedValueOnce({ secureFill: true })
  const { browserCapabilities } = await import('../../src/services/browser/capabilities')
  expect(await browserCapabilities()).toMatchObject({ secureFill: false, audioMute: false })
  expect(await browserCapabilities()).toMatchObject({ secureFill: true, audioMute: false })
})
