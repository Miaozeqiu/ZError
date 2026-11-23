// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ handler: undefined as any, current: null as any, waiting: false, wake: vi.fn() }))
vi.mock('../../src/services/agent/core/waitEvents', () => ({ hasAgentWait: () => state.waiting, wakeAgentWait: state.wake }))
vi.mock('../../src/services/browser/videoWatch', () => ({
  formatNativeClock: String, setNativeWatchHandler: (handler: any) => { state.handler = handler },
  nativeWatchFor: () => state.current,
}))
import { bindNativeWatchAgent, dropNativeWatchQueue, flushNativeWatchAfterTurn } from '../../src/services/browser/videoWatchAgent'

describe('视频事件排队', () => {
  beforeEach(() => {
    state.waiting = false; state.current = null; state.wake.mockReset()
    dropNativeWatchQueue('session')
    bindNativeWatchAgent({ notify: vi.fn(), gate: () => 'busy' })
  })
  afterEach(() => vi.useRealTimers())
  const event = () => ({ browserId: 'browser', sessionId: 'session', kind: 'stalled', percent: 40,
    status: { browserId: 'browser', sessionId: 'session', startedAt: 10, updatedAt: 20, current: 100,
      sampledCurrent: 100, status: 'stalled', paused: true, ended: false, duration: 250 } })
  it('恢复播放后不再把旧的停滞事件发送给 Agent', () => {
    const check = event(); state.current = check.status; state.handler(check)
    state.current = { ...check.status, status: 'watching', paused: false, current: 108, sampledCurrent: 108, updatedAt: 30 }
    state.waiting = true
    flushNativeWatchAfterTurn('session')
    expect(state.wake).not.toHaveBeenCalled()
  })
  it('仍然停滞时保留事件，唤醒 Agent 处理', () => {
    const check = event(); state.current = check.status; state.handler(check); state.current = check.status; state.waiting = true
    flushNativeWatchAfterTurn('session')
    expect(state.wake).toHaveBeenCalledOnce()
  })
  it('新一轮监控已启动时，不投递上一轮的停滞事件', () => {
    const check = event(); state.current = check.status; state.handler(check)
    state.current = { ...check.status, startedAt: 30, updatedAt: 30, status: 'paused' }
    state.waiting = true
    flushNativeWatchAfterTurn('session')
    expect(state.wake).not.toHaveBeenCalled()
  })
  it('仍未前进时不能把暂停事件当成已恢复', () => {
    const check = event(); state.current = check.status; state.handler(check)
    state.current = { ...check.status, status: 'watching', paused: false, current: 100, sampledCurrent: 100, updatedAt: 30 }
    state.waiting = true
    flushNativeWatchAfterTurn('session')
    expect(state.wake).toHaveBeenCalledOnce()
  })
  it('does not deliver a deferred event into a newly started runtime', () => {
    vi.useFakeTimers()
    const notify = vi.fn()
    const oldStop = bindNativeWatchAgent({ notify, gate: () => 'busy' })
    const check = { ...event(), kind: 'done', status: { ...event().status, ended: true, status: 'done' } }; state.current = check.status; state.handler(check)
    flushNativeWatchAfterTurn('session')
    oldStop()
    const stop = bindNativeWatchAgent({ notify, gate: () => 'ready' })
    oldStop()
    vi.runAllTimers()
    expect(notify).not.toHaveBeenCalled()
    expect(state.handler).toBeTypeOf('function')
    stop()
    expect(state.handler).toBeNull()
  })


})
