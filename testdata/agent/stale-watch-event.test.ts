// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ handler: undefined as any, current: null as any, waiting: false, wake: vi.fn() }))
vi.mock('../../src/services/agent/core/waitEvents', () => ({ hasAgentWait: () => state.waiting, wakeAgentWait: state.wake }))
vi.mock('../../src/services/chaoxing/study/video', () => ({ readChaoxingVideo: vi.fn(), videoIsPlaying: vi.fn() }))
vi.mock('../../src/services/chaoxing/browser/panelStudy', () => ({ packAgentPanel: vi.fn(), playPanelStudy: vi.fn() }))
vi.mock('../../src/services/chaoxing/browser/captcha', () => ({ solveChaoxingCaptcha: vi.fn() }))
vi.mock('../../src/services/chaoxing/browser/watch', () => ({
  formatVideoClock: String, setChaoxingWatchHandler: (handler: any) => { state.handler = handler },
  startChaoxingWatch: vi.fn(), videoWatchFor: () => state.current,
}))
import { bindChaoxingWatchAgent, dropWatchQueue, flushWatchIntoWait, flushWatchAfterTurn } from '../../src/services/chaoxing/browser/watchAgent'

import { readChaoxingVideo } from '../../src/services/chaoxing/study/video'
import { playPanelStudy } from '../../src/services/chaoxing/browser/panelStudy'

describe('视频事件排队', () => {
  beforeEach(() => {
    state.waiting = false; state.current = null; state.wake.mockReset()
    dropWatchQueue('session')
    bindChaoxingWatchAgent({ notify: vi.fn(), gate: () => 'busy' })
  })
  afterEach(() => vi.useRealTimers())
  const event = () => ({ browserId: 'browser', sessionId: 'session', kind: 'stalled', percent: 40,
    status: { browserId: 'browser', sessionId: 'session', startedAt: 10, updatedAt: 20, current: 100,
      sampledCurrent: 100, status: 'stalled', paused: true, ended: false, duration: 250 } })
  it('恢复播放后不再把旧的停滞事件发送给 Agent', () => {
    const check = event(); state.handler(check)
    state.current = { ...check.status, status: 'watching', paused: false, current: 108, sampledCurrent: 108, updatedAt: 30 }
    state.waiting = true
    flushWatchIntoWait('session')
    expect(state.wake).not.toHaveBeenCalled()
  })
  it('仍然停滞时保留事件，唤醒 Agent 处理', () => {
    const check = event(); state.handler(check); state.current = check.status; state.waiting = true
    flushWatchIntoWait('session')
    expect(state.wake).toHaveBeenCalledOnce()
  })
  it('新一轮监控已启动时，不投递上一轮的停滞事件', () => {
    const check = event(); state.handler(check)
    state.current = { ...check.status, startedAt: 30, updatedAt: 30, status: 'paused' }
    state.waiting = true
    flushWatchIntoWait('session')
    expect(state.wake).not.toHaveBeenCalled()
  })
  it('仍未前进时不能把暂停事件当成已恢复', () => {
    const check = event(); state.handler(check)
    state.current = { ...check.status, status: 'watching', paused: false, current: 100, sampledCurrent: 100, updatedAt: 30 }
    state.waiting = true
    flushWatchIntoWait('session')
    expect(state.wake).toHaveBeenCalledOnce()
  })
  it('does not deliver a deferred event into a newly started runtime', () => {
    vi.useFakeTimers()
    const notify = vi.fn()
    const oldStop = bindChaoxingWatchAgent({ notify, gate: () => 'busy' })
    state.handler({ ...event(), kind: 'done' })
    flushWatchAfterTurn('session')
    oldStop()
    const stop = bindChaoxingWatchAgent({ notify, gate: () => 'ready' })
    oldStop()
    vi.runAllTimers()
    expect(notify).not.toHaveBeenCalled()
    expect(state.handler).toBeTypeOf('function')
    stop()
    expect(state.handler).toBeNull()
  })
  it('stops background playback recovery before its next action after teardown', async () => {
    let resolve!: (value: unknown) => void
    vi.mocked(readChaoxingVideo).mockImplementationOnce(() => new Promise(done => { resolve = done }) as any)
    vi.mocked(playPanelStudy).mockClear()
    const stop = bindChaoxingWatchAgent({ notify: vi.fn(), gate: () => 'ready' })
    state.handler(event())
    stop()
    resolve({ captcha: false, quiz: false })
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve()
    expect(playPanelStudy).not.toHaveBeenCalled()
  })

})
