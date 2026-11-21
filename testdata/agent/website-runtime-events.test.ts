import { afterEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ listen: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: api.listen }))
import { waitForWebsitePage } from '../../src/services/agent/websiteRuntime/pageEvents'
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks() })
describe('网站任务事件资源', () => {
  it('只接收当前标签的完成事件并取消订阅', async () => {
    let handler!: (event: any) => void
    const stop = vi.fn()
    api.listen.mockImplementation(async (_event, next) => { handler = next; return stop })
    const pending = waitForWebsitePage('owned-tab', new AbortController().signal, 1000)
    await Promise.resolve()
    handler({ payload: { id: 'other-tab', phase: 'finished' } })
    expect(stop).not.toHaveBeenCalled()
    handler({ payload: { id: 'owned-tab', phase: 'finished' } })
    await expect(pending).resolves.toMatchObject({ ok: true, event: 'page.loaded' })
    expect(stop).toHaveBeenCalledOnce()
  })
  it('取消早于异步订阅完成时，晚到的订阅同样被释放', async () => {
    let ready!: (stop: () => void) => void
    api.listen.mockImplementation(() => new Promise(resolve => { ready = resolve }))
    const abort = new AbortController()
    const pending = waitForWebsitePage('tab', abort.signal, 1000)
    const rejected = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    abort.abort()
    const stop = vi.fn(); ready(stop)
    await rejected; await Promise.resolve()
    expect(stop).toHaveBeenCalledOnce()
  })
  it('超时释放监听和定时器', async () => {
    vi.useFakeTimers()
    const stop = vi.fn(); api.listen.mockResolvedValue(stop)
    const pending = waitForWebsitePage('tab', new AbortController().signal, 50)
    await vi.advanceTimersByTimeAsync(50)
    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'timeout' })
    expect(stop).toHaveBeenCalledOnce()
    expect(vi.getTimerCount()).toBe(0)
  })
})
