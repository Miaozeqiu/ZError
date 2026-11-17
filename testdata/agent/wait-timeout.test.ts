import { afterEach, describe, expect, it, vi } from 'vitest'
const { evaluate } = vi.hoisted(() => ({ evaluate: vi.fn() }))
vi.mock('../../src/services/browser/eval', () => ({ evalBrowserViewMainIdle: evaluate, evalBrowserViewInFrame: evaluate, withSameFrames: (s: string) => s }))
vi.mock('../../src/services/browser/appBrowser', () => ({ peekAppBrowserUrl: () => 'https://example.com' }))
vi.mock('../../src/services/browser/engine', () => ({ isWaitTruthy: Boolean, waitForResponse: vi.fn() }))
vi.mock('../../src/services/platform/panelAccess', () => ({ chapterStateFor: () => null, packAgentPanel: () => null, videoWatchFor: () => null }))
import { hasAgentWait, runAgentWait } from '../../src/services/agent/agentWait'
afterEach(() => vi.restoreAllMocks())

describe('等待条件的真实结果', () => {
  it('到达超时不再回报成功，且清理等待记录', async () => {
    let now = 0
    vi.spyOn(Date, 'now').mockImplementation(() => now)
    evaluate.mockResolvedValue(false)
    const result = await runAgentWait({ sessionId: 'timeout', browserId: 'tab', seconds: 1, until: 'idle', wait: async ms => { now += ms } })
    expect(result).toMatchObject({ ok: false, reason: 'timeout' })
    expect(hasAgentWait('timeout')).toBe(false)
  })
  it('已满足条件仍正常返回成功', async () => {
    evaluate.mockResolvedValue(true)
    const result = await runAgentWait({ sessionId: 'ready', browserId: 'tab', seconds: 1, until: 'fn', fn: 'true', wait: async () => {} })
    expect(result).toMatchObject({ ok: true, reason: 'fn' })
  })
})
