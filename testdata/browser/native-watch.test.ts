import { afterEach, describe, expect, it } from 'vitest'
import { judgeFinish } from '../../src/services/agent/finishGate'
import {
  applyNativeTickState,
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
      { hasVideo: true, current: 99.8, duration: 100, paused: false, ended: false, src: 'blob:x' },
      2_000,
      { lastProgressAt: 1_000, lastSeenAt: 1_000, pausedAt: 0 },
    )
    expect(applied.state.status).toBe('done')
    expect(applied.state.ended).toBe(true)
    expect(applied.kind).toBe('done')
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
