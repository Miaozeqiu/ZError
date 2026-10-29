import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { read } = vi.hoisted(() => ({ read: vi.fn() }))
vi.mock('../../src/services/browser/eval', () => ({
  asObject: (value: unknown) => value,
}))

vi.mock('../../src/services/browser/protocol', () => ({ callProtocol: read }))

import { nativeWatchFor, resetNativeWatches, setNativeWatchHandler, startNativeWatch } from '../../src/services/browser/videoWatch'

describe('原生监控换小节时的迟到回执', () => {
  beforeEach(() => { vi.useFakeTimers(); read.mockReset() })
  afterEach(() => { resetNativeWatches(); setNativeWatchHandler(null); vi.useRealTimers() })

  it('上一节的 ended 回执不污染新监控，也不清除新一轮的读取锁', async () => {
    let finishOld!: (value: unknown) => void
    let finishNew!: (value: unknown) => void
    read.mockReturnValueOnce(new Promise((resolve) => { finishOld = resolve }))
      .mockReturnValueOnce(new Promise((resolve) => { finishNew = resolve }))
    const events = vi.fn()
    setNativeWatchHandler(events)
    startNativeWatch('tab', 'session', { title: '上一节', src: 'blob:old', current: 99, duration: 100, paused: false })
    startNativeWatch('tab', 'session', { title: '下一节', src: 'blob:new', current: 1, duration: 120, paused: false })
    finishOld({ hasVideo: true, src: 'blob:old', current: 100, duration: 100, paused: true, ended: true })
    await vi.advanceTimersByTimeAsync(1000)
    expect(nativeWatchFor('tab')).toMatchObject({ title: '下一节', src: 'blob:new', status: 'watching', ended: false })
    expect(read).toHaveBeenCalledTimes(2)
    expect(events).not.toHaveBeenCalled()
    finishNew({ hasVideo: true, src: 'blob:new', current: 2, duration: 120, paused: false, ended: false })
    await vi.advanceTimersByTimeAsync(0)
    expect(nativeWatchFor('tab')?.sampledCurrent).toBe(2)
  })
})
