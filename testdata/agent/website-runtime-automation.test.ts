import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWebsiteAutomationScheduler } from '../../src/services/agent/websiteRuntime/automationScheduler'
import { validateWebsiteRuntime } from '../../src/services/agent/websiteRuntime/protocol'
import { runtimeFixture } from './fixtures/websiteRuntime'

const page = { browserId: 'tab', sessionId: 'chat', url: 'https://academy.example/review' }
afterEach(() => { vi.useRealTimers() })
describe('经验仓库页面自动任务', () => {
  it('合并重复页面事件，按仓库回执重试，完成后不因界面重绘重跑', async () => {
    vi.useFakeTimers()
    const run = vi.fn().mockResolvedValueOnce({ ok: true, result: { retryAfterMs: 100 } }).mockResolvedValue({ ok: true, result: { status: 'synced' } })
    const scheduler = createWebsiteAutomationScheduler({ resolve: async () => ['sync'], run })
    scheduler.schedule(page); scheduler.schedule(page)
    await vi.advanceTimersByTimeAsync(300)
    expect(run).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(100)
    expect(run).toHaveBeenCalledTimes(2)
    scheduler.reconcile([{ ...page }])
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(2)
    scheduler.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('页面跳转、关闭、来源更新和卸载会取消旧任务，晚到回执不能继续重试', async () => {
    vi.useFakeTimers()
    let reply!: (value: Record<string, unknown>) => void
    const signals: AbortSignal[] = []
    const run = vi.fn((_page, _name, signal: AbortSignal) => {
      signals.push(signal)
      return new Promise<Record<string, unknown>>(resolve => { reply = resolve })
    })
    const scheduler = createWebsiteAutomationScheduler({ resolve: async () => ['sync'], run })
    scheduler.schedule(page)
    await vi.advanceTimersByTimeAsync(300)
    scheduler.schedule({ ...page, url: page.url + '/other' })
    expect(signals[0].aborted).toBe(true)
    reply({ ok: true, result: { retryAfterMs: 100 } })
    await vi.advanceTimersByTimeAsync(300)
    expect(run).toHaveBeenCalledTimes(2)
    scheduler.schedule({ ...page, url: page.url + '/other' }, true)
    expect(signals[1].aborted).toBe(true)
    reply({ ok: true, result: { retryAfterMs: 100 } })
    await vi.advanceTimersByTimeAsync(300)
    scheduler.reconcile([])
    expect(signals[2].aborted).toBe(true)
    reply({ ok: true, result: { retryAfterMs: 100 } })
    scheduler.dispose()
    await vi.advanceTimersByTimeAsync(1000)
    expect(run).toHaveBeenCalledTimes(3)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('繁忙时稍后重试，持续失败和持续加载均有截止时间', async () => {
    vi.useFakeTimers()
    const run = vi.fn().mockResolvedValueOnce({ ok: false, reason: 'busy' }).mockRejectedValue(new Error('offline'))
    const scheduler = createWebsiteAutomationScheduler({ resolve: async () => ['sync'], run })
    scheduler.schedule(page)
    await vi.advanceTimersByTimeAsync(300)
    await vi.advanceTimersByTimeAsync(500)
    expect(run).toHaveBeenCalledTimes(2)
    await vi.runAllTimersAsync()
    expect(run).toHaveBeenCalledTimes(8)
    expect(vi.getTimerCount()).toBe(0)
    scheduler.dispose()
    const loading = vi.fn(async () => ({ ok: true, result: { retryAfterMs: 30000 } }))
    const bounded = createWebsiteAutomationScheduler({ resolve: async () => ['sync'], run: loading })
    bounded.schedule(page)
    await vi.advanceTimersByTimeAsync(11 * 60_000)
    expect(loading.mock.calls.length).toBeLessThanOrEqual(21)
    expect(vi.getTimerCount()).toBe(0)
    bounded.dispose()
  })
  it('自动任务只能引用存在的被动工具，不允许网页写入、凭据或模型能力', () => {
    const runtime = runtimeFixture()
    runtime.tools[0].commands = ['document.list', 'service.request', 'state.write']
    const candidate = { ...runtime, automations: [{ event: 'page', tool: runtime.tools[0].name }] }
    expect(validateWebsiteRuntime(candidate, 'academy').automations).toHaveLength(1)
    for (const command of ['document.click', 'credentials.request', 'model.generate']) {
      expect(() => validateWebsiteRuntime({ ...candidate, tools: [{ ...runtime.tools[0], commands: [command] }] }, 'academy')).toThrow('后台')
    }
    expect(() => validateWebsiteRuntime({ ...candidate, automations: [{ event: 'page', tool: 'missing' }] }, 'academy')).toThrow()
  })
})
