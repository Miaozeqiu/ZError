import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  kickParserClock,
  kickParserClockSoon,
  PARSER_CLOCK_MS,
  parserClockBusy,
  parserClockWatching,
  resetParserClocks,
  unwatchParserClock,
  watchParserClock,
} from '../../src/services/browser/pageClock'

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
}

afterEach(() => {
  resetParserClocks()
  vi.useRealTimers()
})

describe('parserClock', () => {
  it('kick 跑登记过的 runner，没登记是空操作', async () => {
    const hits: string[] = []
    await kickParserClock('missing')
    watchParserClock('b1', 'study', () => { hits.push('study') })
    await kickParserClock('b1')
    expect(hits).toEqual(['study'])
    expect(parserClockWatching('b1', 'study')).toBe(true)
    expect(parserClockWatching('b1', 'homework')).toBe(false)
  })

  it('busy 时多次 kick 只再补一轮', async () => {
    const finishes: Array<() => void> = []
    let n = 0
    watchParserClock('b1', 'study', () => {
      n += 1
      return new Promise<void>((resolve) => { finishes.push(resolve) })
    })
    const first = kickParserClock('b1')
    void kickParserClock('b1')
    void kickParserClock('b1')
    await flush()
    expect(n).toBe(1)
    expect(parserClockBusy('b1')).toBe(true)
    finishes.shift()?.()
    await flush()
    expect(n).toBe(2)
    finishes.shift()?.()
    await first
    expect(n).toBe(2)
    expect(parserClockBusy('b1')).toBe(false)
  })

  it('间隔到了才跑，动作 kick 会取消 soon', async () => {
    vi.useFakeTimers()
    const hits: string[] = []
    watchParserClock('b1', 'study', (id, reason) => { hits.push(reason) }, { intervalMs: PARSER_CLOCK_MS })
    kickParserClockSoon('b1', 700)
    await kickParserClock('b1')
    expect(hits).toEqual(['action'])
    await vi.advanceTimersByTimeAsync(700)
    expect(hits).toEqual(['action'])
    await vi.advanceTimersByTimeAsync(PARSER_CLOCK_MS)
    expect(hits).toEqual(['action', 'interval'])
  })

  it('同一轮按登记顺序跑多只 runner', async () => {
    const hits: string[] = []
    watchParserClock('b1', 'study', async () => { hits.push('study') })
    watchParserClock('b1', 'homework', async () => { hits.push('homework') })
    await kickParserClock('b1')
    expect(hits).toEqual(['study', 'homework'])
    unwatchParserClock('b1', 'homework')
    await kickParserClock('b1')
    expect(hits).toEqual(['study', 'homework', 'study'])
  })
})
