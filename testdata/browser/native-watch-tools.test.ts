import { afterEach, describe, expect, it, vi } from 'vitest'
import { handlePageTools } from '../../src/services/agent/tools/page'
import * as native from '../../src/services/browser/videoWatch'

const oldWatch: native.NativeWatchState = {
  browserId: 'browser', sessionId: 'session', title: '上一节', src: 'blob:old',
  current: 100, duration: 100, percent: 100, paused: true, ended: true, status: 'done',
  sampledAt: 1, sampledCurrent: 100, startedAt: 1, updatedAt: 1,
}
const ctx = () => ({
  name: 'browser_watch', args: { title: '下一节' }, browserId: 'browser', sessionId: 'session',
  liveHref: async () => 'https://wisdom-mooc.zhihuishu.com/study/index?recruitAndCourseId=test',
  listCachedPageRefs: () => [],
})

afterEach(() => vi.restoreAllMocks())

describe('browser_watch 同址切小节', () => {
  it('读取新媒体后重新挂监控，不返回上一节已结束', async () => {
    vi.spyOn(native, 'nativeWatchFor').mockReturnValue(oldWatch)
    const read = vi.spyOn(native, 'readNativeVideoTick').mockResolvedValue({ hasVideo: true, src: 'blob:new', current: 1, duration: 120, paused: false, ended: false })
    const start = vi.spyOn(native, 'startNativeWatch').mockReturnValue(null)
    const result = JSON.parse(await handlePageTools(ctx()) || '{}')
    expect(read).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledWith('browser', 'session', expect.objectContaining({ src: 'blob:new', title: '下一节' }), { locator: undefined })
    expect(result.watching).toBe(true)
    expect(result.ended).toBeUndefined()
    expect(result.already).toBeUndefined()
  })

  it('弹题暂停时清除旧监控，恢复播放后才能重新挂载', async () => {
    vi.spyOn(native, 'nativeWatchFor').mockReturnValue({ ...oldWatch, current: 25, sampledCurrent: 25, ended: false, paused: false, status: 'watching' })
    vi.spyOn(native, 'readNativeVideoTick').mockResolvedValue({ hasVideo: true, src: 'blob:old', current: 25, duration: 100, paused: true, ended: false })
    const stop = vi.spyOn(native, 'stopNativeWatch').mockImplementation(() => {})
    const start = vi.spyOn(native, 'startNativeWatch').mockReturnValue(null)
    const result = JSON.parse(await handlePageTools(ctx()) || '{}')
    expect(result.paused).toBe(true)
    expect(result.watching).toBe(false)
    expect(stop).toHaveBeenCalledWith('browser')
    expect(start).not.toHaveBeenCalled()
  })

  it('当前媒体真正结束时仍提示核对平台完成标记', async () => {
    vi.spyOn(native, 'nativeWatchFor').mockReturnValue(null)
    vi.spyOn(native, 'readNativeVideoTick').mockResolvedValue({ hasVideo: true, src: 'blob:new', current: 120, duration: 120, paused: true, ended: true })
    vi.spyOn(native, 'stopNativeWatch').mockImplementation(() => {})
    const result = JSON.parse(await handlePageTools(ctx()) || '{}')
    expect(result.ended).toBe(true)
    expect(result.hint).toContain('平台保存')
  })
})
