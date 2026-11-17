import { afterEach, describe, expect, it, vi } from 'vitest'
import { createDebounce, createTickHub, normalizeTick, tickMatchesMid } from '../../src/services/browser/pushEvents'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }))

describe('tick 归一化', () => {
  it('video.duration 无效时用 window / videojs 兜底', () => {
    const fromWindow = normalizeTick({
      kind: 'video',
      current: 3,
      duration: Number.NaN,
      windowDuration: 90,
      src: 'blob:x',
      mid: 'm1',
    })
    expect(fromWindow?.kind).toBe('video')
    if (fromWindow?.kind !== 'video') return
    expect(fromWindow.tick.duration).toBe(90)
    expect(fromWindow.tick.mid).toBe('m1')
    expect(fromWindow.tick.hasVideo).toBe(true)

    const fromVjs = normalizeTick({
      current: 1,
      duration: 0,
      videojsDuration: 40,
      paused: false,
    })
    expect(fromVjs?.kind).toBe('video')
    if (fromVjs?.kind !== 'video') return
    expect(fromVjs.tick.duration).toBe(40)
    expect(fromVjs.tick.paused).toBe(false)
  })

  it('钉住 mid 后只认那条，没 mid 的 tick 放行', () => {
    expect(tickMatchesMid({ mid: 'm2' }, 'm2')).toBe(true)
    expect(tickMatchesMid({ mid: 'm1' }, 'm2')).toBe(false)
    expect(tickMatchesMid({ mid: '' }, 'm2')).toBe(true)
    expect(tickMatchesMid({ mid: 'm1' }, '')).toBe(true)
  })

  it('作业推 states，没 states 也算 changed', () => {
    expect(normalizeTick({ kind: 'hw', changed: true })).toEqual({ kind: 'hw', changed: true, states: [] })
    expect(normalizeTick({ kind: 'hw', states: [{ index: 1, selected: 'A', filled: true }] })).toEqual({
      kind: 'hw',
      changed: true,
      states: [{ index: 1, selected: 'A', filled: true }],
    })
  })
})

describe('按 id 分发', () => {
  it('video 只打到对应 browser', () => {
    const hub = createTickHub()
    const seen: string[] = []
    hub.onBrowserTick('a', (tick) => seen.push(`a:${tick.mid}`))
    hub.onBrowserTick('b', (tick) => seen.push(`b:${tick.mid}`))
    hub.dispatch({ id: 'a', kind: 'video', tick: { current: 2, duration: 10, mid: 'm1' } })
    hub.dispatch({ id: 'b', kind: 'video', tick: { current: 4, duration: 10, mid: 'm2' } })
    expect(seen).toEqual(['a:m1', 'b:m2'])
  })

  it('作业事件不进 video 订阅', () => {
    const hub = createTickHub()
    const videos: string[] = []
    const hw: string[] = []
    hub.onBrowserTick('a', (tick) => videos.push(tick.mid))
    hub.onHomeworkChanged('a', (id) => hw.push(id))
    hub.dispatch({ id: 'a', kind: 'hw', tick: { kind: 'hw', changed: true } })
    expect(videos).toEqual([])
    expect(hw).toEqual(['a'])
  })
})

describe('作业防抖', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('300ms 内多次只跑一次', async () => {
    vi.useFakeTimers()
    const debounce = createDebounce(300)
    let n = 0
    debounce(() => { n += 1 })
    debounce(() => { n += 1 })
    debounce(() => { n += 1 })
    expect(n).toBe(0)
    await vi.advanceTimersByTimeAsync(299)
    expect(n).toBe(0)
    await vi.advanceTimersByTimeAsync(1)
    expect(n).toBe(1)
  })
})
