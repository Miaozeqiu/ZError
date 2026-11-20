/** Canvas decoration has its own lifecycle, independent of model configuration. */
export function useEffortMatrix() {
  type EffortMatrixPulse = {
    c: number
    r: number
    peak: number
    steps: number
    fadeRate: number
    maxSteps: number
    skipChance: number
    stepEvery: number
    stepAcc: number
  }

  let effortMatrixRaf = 0
  let effortMatrixStop: (() => void) | null = null
  let effortMatrixIo: IntersectionObserver | null = null
  let effortMatrixRo: ResizeObserver | null = null

  const stopEffortMatrixFx = () => {
    effortMatrixStop?.()
    effortMatrixStop = null
    if (effortMatrixRaf) {
      cancelAnimationFrame(effortMatrixRaf)
      effortMatrixRaf = 0
    }
    effortMatrixIo?.disconnect()
    effortMatrixRo?.disconnect()
    effortMatrixIo = null
    effortMatrixRo = null
  }

  const startEffortMatrixFx = (canvas: HTMLCanvasElement) => {
    stopEffortMatrixFx()
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const CELL = 4
    const GAP = 1
    const STEP = CELL + GAP
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches

    let width = 0
    let height = 0
    let cols = 0
    let rows = 0
    let offsetX = 0
    let offsetY = 0
    let visible = true
    let running = true
    let last = performance.now()
    let bright = new Float32Array(0)
    const pulses: EffortMatrixPulse[] = []
    let spawnWait = 0

    const idx = (c: number, r: number) => r * cols + c

    const rebuild = () => {
      const cssW = canvas.clientWidth || canvas.parentElement?.clientWidth || 0
      const cssH = canvas.clientHeight || canvas.parentElement?.clientHeight || 0
      if (cssW < 2 || cssH < 2) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = cssW
      height = cssH
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      cols = Math.max(1, Math.floor((width + GAP) / STEP))
      rows = Math.max(1, Math.floor((height + GAP) / STEP))
      offsetX = (width - (cols * STEP - GAP)) / 2
      offsetY = (height - (rows * STEP - GAP)) / 2
      bright = new Float32Array(cols * rows)
      pulses.length = 0
    }

    const draw = (now: number) => {
      if (!running) return
      effortMatrixRaf = requestAnimationFrame(draw)
      if (!visible || document.hidden) {
        last = now
        return
      }
      if (width < 2) rebuild()
      if (width < 2) return

      const dt = Math.min(0.05, (now - last) / 1000)
      last = now

      if (!reduceMotion) {
        spawnWait -= dt
        while (spawnWait <= 0) {
          const r = (Math.random() * rows) | 0
          pulses.push({
            c: cols - 1,
            r,
            peak: 0.95 + Math.random() * 0.4,
            steps: 0,
            fadeRate: 0.7 + Math.random() * 0.9,
            maxSteps: Math.floor(cols * (0.45 + Math.random() * 0.6)),
            skipChance: Math.random() * 0.18,
            stepEvery: 0.05 + Math.random() * 0.05,
            stepAcc: 0
          })
          const bi = idx(cols - 1, r)
          bright[bi] = Math.max(bright[bi], 1.2)
          spawnWait += 0.012 + Math.random() * 0.02
        }

        for (let p = pulses.length - 1; p >= 0; p--) {
          const pulse = pulses[p]
          pulse.stepAcc += dt
          while (pulse.stepAcc >= pulse.stepEvery) {
            pulse.stepAcc -= pulse.stepEvery
            if (Math.random() < pulse.skipChance) {
              pulse.c -= 1
              pulse.steps += 1
            }
            pulse.c -= 1
            pulse.steps += 1
            if (pulse.c < 0 || pulse.steps >= pulse.maxSteps) {
              pulses.splice(p, 1)
              break
            }
            const fade = Math.max(0, 1 - (pulse.steps / pulse.maxSteps) * pulse.fadeRate)
            const endJitter = pulse.steps > pulse.maxSteps * 0.55
              ? 0.5 + Math.random() * 0.5
              : 0.85 + Math.random() * 0.2
            const g = pulse.peak * fade * endJitter
            if (g < 0.08 && Math.random() < 0.45) {
              pulses.splice(p, 1)
              break
            }
            const bi = idx(pulse.c, pulse.r)
            bright[bi] = Math.max(bright[bi], g)
          }
        }
      }

      for (let i = 0; i < bright.length; i++) {
        const decay = 0.1 + (i % 7) * 0.012 + Math.random() * 0.08
        bright[i] *= Math.pow(decay, dt)
        if (bright[i] < 0.01) bright[i] = 0
      }

      ctx.clearRect(0, 0, width, height)
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const g = bright[idx(c, r)]
          if (g < 0.04) continue
          const x = offsetX + c * STEP
          const y = offsetY + r * STEP
          if (g > 0.35) {
            ctx.globalAlpha = Math.min(0.9, (g - 0.25) * 0.85)
            ctx.fillStyle = '#ffd56a'
            ctx.fillRect(x - 0.5, y - 0.5, CELL + 1, CELL + 1)
          }
          ctx.globalAlpha = Math.min(1, g)
          ctx.fillStyle = g > 0.75 ? '#ffffff' : '#fff3cc'
          ctx.fillRect(x, y, CELL, CELL)
        }
      }
      ctx.globalAlpha = 1
    }

    const io = new IntersectionObserver(([entry]) => {
      visible = !!entry?.isIntersecting
      if (visible) last = performance.now()
    }, { threshold: 0 })
    io.observe(canvas)
    const ro = new ResizeObserver(() => rebuild())
    ro.observe(canvas.parentElement || canvas)

    rebuild()
    effortMatrixIo = io
    effortMatrixRo = ro
    effortMatrixStop = () => { running = false }
    effortMatrixRaf = requestAnimationFrame(draw)
  }

  const bindEffortMatrix = (el: Element | null) => {
    if (el instanceof HTMLCanvasElement) startEffortMatrixFx(el)
    else stopEffortMatrixFx()
  }


  return { bindEffortMatrix, stopEffortMatrixFx }
}
