import { describe, expect, it, afterEach } from 'vitest'
import { watchEndedTakeover, watchNeedsTakeover, runAgentWait } from '../../../src/services/agent/agentWait'
import { browserVideoWatches, watchSessionFastPath, type VideoWatchState } from '../../../src/services/chaoxing/browser/watch'
import { shouldDeferWatchNotify } from '../../../src/services/chaoxing/browser/watchAgent'
import { lastStudyParser, noteStudyParser } from '../../../src/services/chaoxing/study/debug'
import { asVideoTick, videoTickHasPlayer } from '../../../src/services/chaoxing/study/video'

const watch = (over: Partial<VideoWatchState>): VideoWatchState => ({
  browserId: 'b1',
  sessionId: 's1',
  title: '1.6 两个重要极限',
  next: '',
  step: '视频1',
  current: 670,
  duration: 670,
  percent: 100,
  paused: false,
  ended: false,
  jobDone: true,
  quiz: false,
  moreVideos: true,
  videoCount: 3,
  videoIndex: 1,
  status: 'watching',
  sampledAt: Date.now(),
  sampledCurrent: 670,
  startedAt: Date.now(),
  updatedAt: Date.now(),
  ...over,
})

afterEach(() => {
  browserVideoWatches.value = {}
})

describe('watchSessionFastPath', () => {
  it('已在监控时不再去重读播放器', () => {
    expect(watchSessionFastPath(watch({ status: 'watching' }), 'need_video')).toBe('already')
  })

  it('这段已经结束时直接告诉 Agent，不要再挂 readVideo', () => {
    expect(watchSessionFastPath(watch({ status: 'done', ended: true }), 'need_video')).toBe('ended')
  })

  it('本节只剩测验时让出 watch', () => {
    expect(watchSessionFastPath(watch({ status: 'watching' }), 'quiz_left')).toBe('panel_clear')
  })
})

describe('shouldDeferWatchNotify', () => {
  it('回合占着且没有 wait 时只能排队，否则播完消息会被丢掉', () => {
    expect(shouldDeferWatchNotify('busy', false)).toBe('queue')
    expect(shouldDeferWatchNotify('busy', true)).toBe('now')
    expect(shouldDeferWatchNotify('ready', false)).toBe('now')
    expect(shouldDeferWatchNotify('missing', false)).toBe('drop')
  })
})

describe('刷课解析器快照', () => {
  it('noteStudyParser 记下 locate / tick / 任务点', () => {
    noteStudyParser({
      via: 'play',
      handle: { kind: 'control', name: 'play' },
      locate: { found: true, x: 10, y: 20, via: 'pinned' },
      tick: { current: 12, duration: 100, paused: false, hasVideo: true },
      steps: [{ label: '视频1', video: true, jobDone: false, active: true }],
      playing: true,
      force: true,
    })
    const snap = lastStudyParser()
    expect(snap.via).toBe('play')
    expect(snap.locate?.found).toBe(true)
    expect(snap.tick?.current).toBe(12)
    expect(snap.steps?.[0]?.label).toBe('视频1')
  })
})

describe('video tick 探测失败不能当进度归零', () => {
  it('空对象不是播放器采样', () => {
    expect(asVideoTick({})).toBeNull()
    expect(asVideoTick(null)).toBeNull()
    expect(videoTickHasPlayer(asVideoTick({ current: 0, duration: 0, paused: true }))).toBe(false)
  })

  it('真实进度才算采样', () => {
    const tick = asVideoTick({ current: 249.1, duration: 609.4, paused: false, ended: false })
    expect(tick?.current).toBeCloseTo(249.1)
    expect(videoTickHasPlayer(tick)).toBe(true)
  })
})

describe('wait 在视频结束时要叫醒', () => {
  it('ended / done 都算该接管', () => {
    browserVideoWatches.value = { b1: watch({ ended: true, status: 'done' }) }
    expect(watchEndedTakeover('b1')).toBe(true)
    expect(watchNeedsTakeover('b1')).toBe(true)
  })

  it('还在播不要叫醒', () => {
    browserVideoWatches.value = { b1: watch({ ended: false, status: 'watching', current: 20, duration: 609 }) }
    expect(watchEndedTakeover('b1')).toBe(false)
    expect(watchNeedsTakeover('b1')).toBe(false)
  })

  it('走表到片尾也算结束，不必等 ended 标志', () => {
    browserVideoWatches.value = { b1: watch({ ended: false, status: 'watching', current: 609, duration: 609 }) }
    expect(watchEndedTakeover('b1')).toBe(true)
  })

  it('browser_wait 没命中时按拍子睡，不能微任务空转', async () => {
    browserVideoWatches.value = { b1: watch({ ended: false, status: 'watching', current: 20, duration: 609 }) }
    let sleeps = 0
    const result = await runAgentWait({
      sessionId: 's1',
      browserId: 'b1',
      seconds: 1,
      until: 'panel',
      wait: (ms) => new Promise((resolve) => {
        sleeps += 1
        setTimeout(resolve, Math.min(ms, 40))
      }),
    })
    expect(result.reason).toBe('timeout')
    // 1 秒里 1200ms 一拍，最多几十次；空转会是上万次
    expect(sleeps).toBeLessThan(60)
    expect(sleeps).toBeGreaterThan(0)
  })

  it('browser_wait 遇到已结束的监控立刻返回 video_done', async () => {
    browserVideoWatches.value = { b1: watch({ ended: true, status: 'done' }) }
    const result = await runAgentWait({
      sessionId: 's1',
      browserId: 'b1',
      seconds: 30,
      until: 'panel',
      wait: (ms) => new Promise((resolve) => { setTimeout(resolve, Math.min(ms, 10)) }),
    })
    expect(result.reason).toBe('watch')
    expect(result.event).toBe('video_done')
    expect(result.waited).toBe(0)
    expect(result.hint).toMatch(/已经结束/)
  })
})
