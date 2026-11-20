import { beforeEach, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))

beforeEach(() => {
  vi.resetModules()
  invoke.mockReset()
})

it.each([false, true])('uses backend capabilities with native overlay = %s', async overlay => {
  invoke.mockImplementation(async command => command === 'browser_capabilities'
    ? { secureFill: true, audioMute: true, scriptCat: true, scriptCatPermissions: overlay, nativeVideoOverlay: overlay }
    : { found: true, active: true })
  const { browserCapabilities } = await import('../../src/services/browser/capabilities')
  const { readNativeVideo } = await import('../../src/services/browser/nativeVideo')
  expect(await browserCapabilities()).toMatchObject({ secureFill: true, audioMute: true })
  expect(await readNativeVideo('tab')).toMatchObject({ found: overlay })
  expect(invoke.mock.calls.filter(([command]) => command === 'browser_capabilities')).toHaveLength(1)
  expect(invoke.mock.calls.some(([command]) => command === 'browser_video_overlay_state')).toBe(overlay)
})

it('keeps operations disabled on query failure and retries when the backend recovers', async () => {
  invoke.mockRejectedValueOnce(new Error('IPC unavailable')).mockResolvedValueOnce({ secureFill: true })
  const { browserCapabilities } = await import('../../src/services/browser/capabilities')
  expect(await browserCapabilities()).toMatchObject({ secureFill: false, audioMute: false, nativeVideoOverlay: false })
  expect(await browserCapabilities()).toMatchObject({ secureFill: true, audioMute: false })
})
