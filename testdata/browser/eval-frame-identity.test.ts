import { afterEach, describe, expect, it, vi } from 'vitest'
const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
import { evaluate } from '../../src/services/browser/protocol'

afterEach(() => invoke.mockReset())
describe('script frame identity transport', () => {
  it('passes exact frame and loader IDs through the native protocol, including without a legacy frame hint', async () => {
    invoke.mockResolvedValue({ ok: true, result: { currentTime: 25 } })
    expect(await evaluate('b1', 'document.title', { frameId: 'frame-2', loaderId: 'doc-2' })).toEqual({ currentTime: 25 })
    expect(invoke).toHaveBeenCalledWith('browser_protocol', expect.objectContaining({ id: 'b1', op: 'frame_eval',
      args: expect.objectContaining({ locator: { frameId: 'frame-2', loaderId: 'doc-2' } }),
    }))
  })
  it('rejects stale-document results without retrying in the top frame', async () => {
    invoke.mockResolvedValue({ ok: false, error: '目标 frame 文档已更换，请重新读取页面快照' })
    await expect(evaluate('b1', 'document.title', { frameId: 'frame-2', loaderId: 'old-doc' })).rejects.toThrow('文档已更换')
    expect(invoke).toHaveBeenCalledOnce()
  })
})
