/** One owner for chat scroll writes. Native wheel/gesture movement is never animated here. */
export const createThreadScroll = (
  element: () => HTMLElement | null,
  onFollowing: (following: boolean) => void,
) => {
  let following = true
  let direction = 0
  let lastTop: number | null = null
  let frame = 0
  let generation = 0
  let disposed = false
  const maximum = (pane: HTMLElement) => Math.max(0, pane.scrollHeight - pane.clientHeight)
  const position = (pane: HTMLElement) => Math.max(0, Math.min(maximum(pane), pane.scrollTop))
  const publish = (value: boolean) => { following = value; onFollowing(value) }
  const cancel = () => {
    generation++
    cancelAnimationFrame(frame)
    frame = 0
  }
  const hold = () => { cancel(); direction = 0; publish(false) }

  // WebKit can move the viewport before delivering wheel/scroll to JavaScript.
  // Check geometry before EVERY automatic write, including ResizeObserver work.
  const observe = () => {
    const pane = element()
    if (!pane || disposed) return
    const top = position(pane)
    const previous = lastTop == null ? top : Math.min(lastTop, maximum(pane))
    const moved = top - previous
    if (moved < -0.1) {
      cancel()
      publish(false)
    } else if (!following && direction > 0 && moved > 0.1 && maximum(pane) - top <= 1) {
      publish(true)
    }
    lastTop = top
  }
  const write = (top: number) => {
    const pane = element()
    if (!pane || disposed) return
    pane.scrollTop = top
    lastTop = position(pane)
  }
  const input = (delta: number) => {
    if (!Number.isFinite(delta) || !delta) return
    cancel()
    direction = Math.sign(delta)
    if (delta < 0) publish(false)
    // A downward input at the old bottom is not proof of returning to bottom.
    // Only subsequent, actual downward movement may re-enable following.
    observe()
  }
  const changed = () => {
    observe()
    if (disposed || !following || frame) return
    const revision = generation
    frame = requestAnimationFrame(() => {
      frame = 0
      observe()
      const pane = element()
      if (revision === generation && following && pane) write(maximum(pane))
    })
  }
  const jump = (animate = true) => {
    cancel()
    const pane = element()
    if (!pane || disposed) return
    direction = 0
    publish(true)
    lastTop = position(pane)
    const start = lastTop
    if (!animate || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      write(maximum(pane))
      return
    }
    const revision = generation
    const started = performance.now()
    const tick = (now: number) => {
      frame = 0
      observe()
      const current = element()
      if (disposed || revision !== generation || !following || !current) return
      const progress = Math.min(1, (now - started) / 240)
      write(start + (maximum(current) - start) * (1 - (1 - progress) ** 3))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
  }
  const reset = () => {
    cancel()
    direction = 0
    lastTop = null
    publish(true)
    // The caller schedules changed() after the new conversation's DOM commits.
  }
  return {
    input, observe, changed, jump, reset, hold,
    drag: () => { hold(); direction = 1 },
    dispose: () => { disposed = true; cancel() },
  }
}
