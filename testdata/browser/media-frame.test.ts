import { afterEach, describe, expect, it, vi } from 'vitest'
const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
import { nativeWatchFor, readNativeVideoTick, resetNativeWatches, startNativeWatch } from '../../src/services/browser/videoWatch'

afterEach(() => { resetNativeWatches(); invoke.mockReset() })

describe('媒体监控 frame 绑定', () => {
  it('跨域 probe 保留实际媒体的 frame 和文档身份', async () => {
    invoke.mockResolvedValue({ hasVideo: true, current: 3, duration: 60, paused: false, ended: false,
      src: 'blob:video', frameId: 'cross-video', loaderId: 'doc-2', nth: 2, value: 'video' })
    const tick = await readNativeVideoTick('b1', { by: 'css', value: 'video', frameId: 'cross-video', loaderId: 'doc-2', nth: 2 })
    expect(tick).toMatchObject({ frameId: 'cross-video', loaderId: 'doc-2', nth: 2 })
    startNativeWatch('b1', 's1', tick!)
    expect(nativeWatchFor('b1')?.locator).toEqual({ by: 'css', value: 'video', nth: 2, frameId: 'cross-video', loaderId: 'doc-2' })
    await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('browser_protocol', {
      id: 'b1', op: 'media_tick', args: { locator: expect.objectContaining({ frameId: 'cross-video', loaderId: 'doc-2', nth: 2 }) },
    }))
  })

  it('文档重建后 probe 失败，不退回无 frame 的全局媒体扫描', async () => {
    invoke.mockRejectedValue(new Error('文档已更换'))
    expect(await readNativeVideoTick('b1', { by: 'css', value: 'video', frameId: 'old-frame', loaderId: 'old-doc' })).toBeNull()
    expect(invoke).toHaveBeenCalledTimes(1)
    expect(invoke.mock.calls[0][1].args.locator.frameId).toBe('old-frame')
  })

  it('切换视频后忽略上一轮迟到的 probe，不污染新监控', async () => {
    let resolveOld!: (tick: unknown) => void
    invoke.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
      .mockResolvedValue({ hasVideo: true, current: 5, duration: 60, paused: false, ended: false, src: 'new' })
    startNativeWatch('b1', 's1', { current: 10, duration: 100, paused: false, frameId: 'old', loaderId: 'old-doc' })
    startNativeWatch('b1', 's1', { current: 5, duration: 60, paused: false, frameId: 'new', loaderId: 'new-doc' })
    await vi.waitFor(() => expect(nativeWatchFor('b1')?.current).toBe(5))
    resolveOld({ hasVideo: true, current: 99, duration: 100, paused: false, ended: true, src: 'old' })
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(nativeWatchFor('b1')).toMatchObject({ current: 5, ended: false, locator: { frameId: 'new' } })
  })
})
