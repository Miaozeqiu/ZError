// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createThreadScroll } from '../../src/utils/ui/threadScroll'

describe('chat viewport ownership', () => {
  let pane: HTMLElement
  let height: number
  let top: number
  let following: boolean
  let scroll: ReturnType<typeof createThreadScroll>
  let now: number
  let frames: Map<number, FrameRequestCallback>
  let sequence: number
  let writes: number[]
  const advance = (count = 1) => {
    for (let i = 0; i < count; i++) {
      now += 16
      const callbacks = [...frames.values()]
      frames.clear()
      callbacks.forEach(callback => callback(now))
    }
  }
  beforeEach(() => {
    now = 0; sequence = 0; frames = new Map(); writes = []
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      frames.set(++sequence, callback); return sequence
    })
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id))
    vi.stubGlobal('matchMedia', () => ({ matches: false }))
    height = 2000; top = 1600; following = true
    pane = document.createElement('div')
    Object.defineProperties(pane, {
      scrollHeight: { get: () => height }, clientHeight: { value: 400 },
      scrollTop: { get: () => top, set: (value: number) => { top = Math.max(0, Math.min(height - 400, value)); writes.push(top) } },
    })
    scroll = createThreadScroll(() => pane, value => { following = value })
    scroll.observe()
  })
  afterEach(() => { scroll.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

  it('detects native upward movement before wheel/scroll delivery, even during content growth', () => {
    scroll.changed() // A follow frame is already pending.
    top -= 0.5 // compositor moved, JS wheel/scroll events have not arrived
    height += 50
    scroll.changed() // ResizeObserver arrives first
    advance(100)
    expect(top).toBe(1599.5)
    expect(writes).toEqual([])
    expect(following).toBe(false)
  })
  it('releases before the first native frame and does not reattach on a stale bottom position', () => {
    scroll.input(-1)
    scroll.input(0.1) // tiny opposite event while native scroll still reports bottom
    scroll.observe()
    height += 80
    scroll.changed(); advance(80)
    expect(top).toBe(1600)
    expect(following).toBe(false)
    expect(writes).toEqual([])
  })
  it('stays released near bottom and resumes only after actual downward return', () => {
    scroll.input(-20); top = 1580; scroll.observe()
    scroll.input(1); top = 1581; scroll.observe()
    height += 20; scroll.changed(); advance()
    expect(top).toBe(1581)
    expect(following).toBe(false)
    scroll.input(60); top = 1620; scroll.observe()
    expect(following).toBe(true)
    height += 30; scroll.changed(); advance()
    expect(top).toBe(1650)
  })
  it('follows streaming and delayed images without a polling settle animation', () => {
    height += 40; scroll.changed(); scroll.changed(); advance()
    expect(writes).toEqual([1640])
    advance(300)
    height += 120; scroll.changed(); advance()
    expect(top).toBe(1760)
    expect(frames.size).toBe(0)
  })
  it('interrupts return-to-bottom animation on upward input and rejects already queued callbacks', () => {
    top = 800; scroll.observe(); scroll.jump()
    advance(3)
    const queued = [...frames.values()]
    scroll.input(-20); top -= 20
    const reading = top
    queued.forEach(callback => callback(now + 100))
    height += 100; scroll.changed(); advance(50)
    expect(top).toBe(reading)
    expect(following).toBe(false)
  })
  it('does not mistake a content-shrink clamp or elastic bottom overscroll for user navigation', () => {
    height -= 100; top = height - 400
    scroll.changed(); advance()
    expect(following).toBe(true)
    top += 20; scroll.observe(); top -= 20; scroll.observe()
    expect(following).toBe(true)
  })
  it('allows scrollbar drag back to bottom and explicit jumps, but touch hold blocks growth', () => {
    scroll.hold(); height += 100; scroll.changed(); advance()
    expect(writes).toEqual([])
    scroll.drag(); top = 1000; scroll.observe(); top = 1700; scroll.observe()
    expect(following).toBe(true)
    scroll.hold(); top = 800; scroll.observe(); scroll.jump(false)
    expect(top).toBe(1700)
    expect(following).toBe(true)
  })
  it('reset follows a new conversation and disposed work cannot change its position', () => {
    scroll.input(-20); top = 1580; scroll.observe()
    scroll.reset(); scroll.changed(); advance()
    expect(top).toBe(1600)
    height += 100; scroll.changed(); scroll.dispose(); advance()
    expect(top).toBe(1600)
  })
})
