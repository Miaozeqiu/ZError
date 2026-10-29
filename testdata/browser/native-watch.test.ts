import { afterEach, describe, expect, it } from 'vitest'
import { judgeFinish } from '../../src/services/agent/finishGate'
import {
  applyNativeTickState,
  interpolateNativeWatch,
  nativeWatchMatchesTick,
  nativeWatchBusy,
  nativeWatchFor,
  parseNativeTick,
  resetNativeWatches,
  startNativeWatch,
  stopNativeWatch,
  type NativeWatchState,
} from '../../src/services/browser/videoWatch'

const base = (over: Partial<NativeWatchState> = {}): NativeWatchState => ({
  browserId: 'b1',
  sessionId: 's1',
  title: '概述：成衣的概念',
  src: 'blob:x',
  current: 10,
  duration: 100,
  percent: 10,
  paused: false,
  ended: false,
  status: 'watching',
  sampledAt: 1_000,
  sampledCurrent: 10,
  startedAt: 1_000,
  updatedAt: 1_000,
  ...over,
})

afterEach(() => {
  resetNativeWatches()
})

describe('parseNativeTick', () => {
  it('NaN duration 仍留下 current / src', () => {
    const tick = parseNativeTick({
      hasVideo: true,
      current: 12.5,
      duration: Number.NaN,
      paused: false,
      ended: false,
      src: 'blob:https://www.zjooc.cn/abc',
    })
    expect(tick).toMatchObject({
      hasVideo: true,
      current: 12.5,
      duration: 0,
      paused: false,
      src: 'blob:https://www.zjooc.cn/abc',
    })
  })

  it('没有播放器', () => {
    expect(parseNativeTick({ hasVideo: false })?.hasVideo).toBe(false)
    expect(parseNativeTick(null)).toBeNull()
  })
})

describe('applyNativeTickState', () => {
  it('播到结尾标 done', () => {
    const applied = applyNativeTickState(
      base(),
      { hasVideo: true, current: 100, duration: 100, paused: true, ended: true, src: 'blob:x' },
      2_000,
      { lastProgressAt: 1_000, lastSeenAt: 1_000, pausedAt: 0 },
    )
    expect(applied.state.status).toBe('done')
    expect(applied.state.ended).toBe(true)
    expect(applied.kind).toBe('done')
  })

  it.each([false, true])('接近结尾但未 ended 时不提前完成（paused=%s）', (paused) => {
    const applied = applyNativeTickState(base(), {
      hasVideo: true, current: 99.8, duration: 100, paused, ended: false, src: 'blob:x',
    }, 2_000, { lastProgressAt: 1_000, lastSeenAt: 1_000, pausedAt: 0 })
    expect(applied.state.ended).toBe(false)
    expect(applied.state.status).toBe(paused ? 'paused' : 'watching')
  })

  it('同址换视频使旧监控失效，不能挂着上一节的标题继续计时', () => {
    const applied = applyNativeTickState(base(), {
      hasVideo: true, current: 0.2, duration: 200, paused: false, ended: false, src: 'blob:next',
    }, 2_000, { lastProgressAt: 1_000, lastSeenAt: 1_000, pausedAt: 0 })
    expect(applied.kind).toBe('lost')
    expect(applied.state.ended).toBe(false)
  })

  it('实际重播不再被低于 1 秒的防回退条件吞掉', () => {
    const applied = applyNativeTickState(base(), {
      hasVideo: true, current: 0.2, duration: 100, paused: false, ended: false, src: 'blob:x',
    }, 20_000, { lastProgressAt: 1_000, lastSeenAt: 1_000, pausedAt: 0 })
    expect(applied.state.current).toBe(0.2)
    expect(applied.state.status).toBe('watching')
  })

  it('进度停住超过 12s 标 stalled', () => {
    const applied = applyNativeTickState(
      base({ sampledCurrent: 10 }),
      { hasVideo: true, current: 10.1, duration: 100, paused: false, ended: false, src: 'blob:x' },
      1_000 + 12_000,
      { lastProgressAt: 1_000, lastSeenAt: 1_000, pausedAt: 0 },
    )
    expect(applied.state.status).toBe('stalled')
    expect(applied.kind).toBe('stalled')
  })

  it('找不到 video 超过 16s 标 lost', () => {
    const applied = applyNativeTickState(
      base(),
      { hasVideo: false, current: 0, duration: 0, paused: true, ended: false, src: '' },
      1_000 + 16_000,
      { lastProgressAt: 1_000, lastSeenAt: 1_000, pausedAt: 0 },
    )
    expect(applied.state.status).toBe('lost')
    expect(applied.kind).toBe('lost')
  })
})

describe('原生视频回执必须对应当前媒体', () => {
  const tick = { hasVideo: true, current: 10, duration: 100, paused: false, ended: false, src: 'blob:x' }
  it('同一段可以沿用监控，换源或重播不能沿用', () => {
    expect(nativeWatchMatchesTick(base(), tick)).toBe(true)
    expect(nativeWatchMatchesTick(base(), { ...tick, src: 'blob:next' })).toBe(false)
    expect(nativeWatchMatchesTick(base({ ended: true, status: 'done' }), tick)).toBe(false)
    expect(nativeWatchMatchesTick(base(), { ...tick, current: 0 })).toBe(false)
    expect(nativeWatchMatchesTick(base({ src: '' }), tick)).toBe(false)
    expect(nativeWatchMatchesTick(base(), null)).toBe(false)
  })

  it('相同媒体地址在不同 iframe 或旧文档中不能复用监控', () => {
    const watch = base({ locator: { by: 'css', value: 'video', frameId: 'f1', loaderId: 'l1', nth: 1 } })
    expect(nativeWatchMatchesTick(watch, { ...tick, frameId: 'f1', loaderId: 'l1', nth: 1 })).toBe(true)
    expect(nativeWatchMatchesTick(watch, { ...tick, frameId: 'f2', loaderId: 'l1', nth: 1 })).toBe(false)
    expect(nativeWatchMatchesTick(watch, { ...tick, frameId: 'f1', loaderId: 'l2', nth: 1 })).toBe(false)
    expect(nativeWatchMatchesTick(watch, tick)).toBe(false)
  })

  it('本地插值即使走到时长也不能生成 done', () => {
    const state = interpolateNativeWatch(base({ current: 99, sampledCurrent: 99 }), 5_000)
    expect(state.current).toBe(100)
    expect(state.status).toBe('watching')
    expect(state.ended).toBe(false)
    expect(state.percent).toBeLessThan(100)
  })
})

describe('nativeWatchBusy', () => {
  it('Agent 挂上的监测算忙，停掉后不算', () => {
    startNativeWatch('b1', 's1', { current: 1, duration: 10, paused: false })
    expect(nativeWatchBusy('b1')).toBe(true)
    expect(nativeWatchFor('b1')?.sessionId).toBe('s1')
    stopNativeWatch('b1')
    expect(nativeWatchBusy('b1')).toBe(false)
  })
})

describe('finishGate 认原生监控', () => {
  it('watching 无监控拒绝时指向 browser_watch', () => {
    const judged = judgeFinish('watching', '交给监控了', {
      intent: 'play',
      watching: false,
      watchStatus: '',
    })
    expect(judged.ok).toBe(false)
    if (!judged.ok) expect(judged.error).toMatch(/browser_watch/)
  })

  it('已挂原生监控可以通过 watching', () => {
    const judged = judgeFinish('watching', '已交给监控', {
      intent: 'play',
      watching: true,
      watchStatus: 'watching',
    })
    expect(judged.ok).toBe(true)
  })
})
