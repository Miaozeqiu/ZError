<template>
  <div class="curve-panel">
    <canvas ref="canvasRef" class="curve-canvas" />
    <div class="curve-axis">
      <span
        v-for="item in axisTicks"
        :key="item.key"
        class="curve-tick"
        :class="{ 'is-now': item.current }"
        :style="{ left: item.left }"
      >{{ item.label }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  isLeafNode,
  leafCurveView,
  parentCurveView,
  resolveCurveNode,
  type RetentionTreeNode,
} from '../../utils/study/studyForgetting'

const props = defineProps<{
  node: RetentionTreeNode
  graph?: RetentionTreeNode | null
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const resolved = computed(() => resolveCurveNode(props.node, props.graph))
const parent = computed(() => !isLeafNode(resolved.value))
const leafView = computed(() => leafCurveView(resolved.value))
const parentView = computed(() => parentCurveView(resolved.value))
const series = computed(() => (parent.value ? parentView.value : leafView.value))

const axisTicks = computed(() =>
  series.value.ticks.map((item) => ({
    key: item.at,
    label: item.label,
    left: `${item.left}%`,
    current: item.label === '今天',
  })),
)

const curveChrome = () => {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
  const surface = getComputedStyle(document.documentElement).getPropertyValue('--bg-secondary').trim()
    || (dark ? '#2c2c2e' : '#fff')
  return {
    dark,
    surface,
    line: '#2F6F78',
    tick: dark ? 'rgba(122, 184, 192, 0.28)' : 'rgba(47, 111, 120, 0.18)',
    future: dark ? 'rgba(122, 184, 192, 0.42)' : 'rgba(47, 111, 120, 0.35)',
    bandHi: dark ? 'rgba(94, 154, 163, 0.18)' : 'rgba(47, 111, 120, 0.12)',
    bandMid: dark ? 'rgba(94, 154, 163, 0.12)' : 'rgba(94, 154, 163, 0.10)',
    bandLo: dark ? 'rgba(94, 154, 163, 0.07)' : 'rgba(183, 212, 216, 0.16)',
  }
}

const drawBands = (
  ctx: CanvasRenderingContext2D,
  pad: { l: number; r: number; t: number; b: number },
  innerW: number,
  yOf: (retention: number) => number,
) => {
  const chrome = curveChrome()
  ctx.fillStyle = chrome.bandHi
  ctx.fillRect(pad.l, yOf(1), innerW, yOf(0.8) - yOf(1))
  ctx.fillStyle = chrome.bandMid
  ctx.fillRect(pad.l, yOf(0.8), innerW, yOf(0.4) - yOf(0.8))
  ctx.fillStyle = chrome.bandLo
  ctx.fillRect(pad.l, yOf(0.4), innerW, yOf(0) - yOf(0.4))
}

const strokeSeries = (
  ctx: CanvasRenderingContext2D,
  points: { at: number; retention: number }[],
  xAt: (at: number) => number,
  yOf: (retention: number) => number,
) => {
  if (points.length < 2) return
  ctx.beginPath()
  points.forEach((sample, i) => {
    const x = xAt(sample.at)
    const y = yOf(sample.retention)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.stroke()
}

const drawLeaf = (
  ctx: CanvasRenderingContext2D,
  pad: { l: number; r: number; t: number; b: number },
  innerW: number,
  yOf: (retention: number) => number,
) => {
  const view = leafView.value
  const span = Math.max(1, view.end - view.from)
  const xAt = (at: number) => pad.l + ((at - view.from) / span) * innerW
  const chrome = curveChrome()
  ctx.strokeStyle = chrome.tick
  ctx.lineWidth = 1
  ctx.setLineDash([])
  for (const tick of view.ticks) {
    const x = xAt(tick.at)
    ctx.beginPath()
    ctx.moveTo(x, yOf(0))
    ctx.lineTo(x, yOf(0) + 4)
    ctx.stroke()
  }

  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = chrome.future
  ctx.lineWidth = 1.4
  ctx.setLineDash([3, 3])
  strokeSeries(ctx, view.future, xAt, yOf)

  ctx.setLineDash([])
  ctx.strokeStyle = chrome.line
  ctx.lineWidth = 2
  strokeSeries(ctx, view.samples, xAt, yOf)

  if (view.retention == null) return
  const mx = xAt(view.now)
  const my = yOf(view.retention)
  ctx.beginPath()
  ctx.arc(mx, my, 4, 0, Math.PI * 2)
  ctx.fillStyle = chrome.surface
  ctx.fill()
  ctx.beginPath()
  ctx.arc(mx, my, 3.1, 0, Math.PI * 2)
  ctx.fillStyle = chrome.line
  ctx.fill()
}

const drawParent = (
  ctx: CanvasRenderingContext2D,
  pad: { l: number; r: number; t: number; b: number },
  innerW: number,
  yOf: (retention: number) => number,
) => {
  const series = parentView.value
  const span = Math.max(1, series.end - series.from)
  const xAt = (at: number) => pad.l + ((at - series.from) / span) * innerW
  const chrome = curveChrome()
  ctx.strokeStyle = chrome.tick
  ctx.lineWidth = 1
  ctx.setLineDash([])
  for (const tick of series.ticks) {
    const x = xAt(tick.at)
    ctx.beginPath()
    ctx.moveTo(x, yOf(0))
    ctx.lineTo(x, yOf(0) + 4)
    ctx.stroke()
  }

  if (series.samples.length < 2) return
  ctx.beginPath()
  series.samples.forEach((sample, i) => {
    const x = xAt(sample.at)
    const y = yOf(sample.retention)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  })
  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.setLineDash([])
  ctx.strokeStyle = chrome.line
  ctx.lineWidth = 2
  ctx.stroke()

  if (series.retention == null) return
  const last = series.samples[series.samples.length - 1]
  const mx = xAt(last.at)
  const my = yOf(series.retention)
  ctx.beginPath()
  ctx.arc(mx, my, 4, 0, Math.PI * 2)
  ctx.fillStyle = chrome.surface
  ctx.fill()
  ctx.beginPath()
  ctx.arc(mx, my, 3.1, 0, Math.PI * 2)
  ctx.fillStyle = chrome.line
  ctx.fill()
}

const draw = () => {
  const canvas = canvasRef.value
  if (!canvas) return
  const cssW = canvas.clientWidth || 244
  const cssH = canvas.clientHeight || 98
  const dpr = Math.max(1, window.devicePixelRatio || 1)
  canvas.width = Math.round(cssW * dpr)
  canvas.height = Math.round(cssH * dpr)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, cssW, cssH)

  const pad = { l: 14, r: 14, t: 10, b: 10 }
  const innerW = cssW - pad.l - pad.r
  const innerH = cssH - pad.t - pad.b
  const yOf = (retention: number) => pad.t + (1 - Math.max(0, Math.min(1, retention))) * innerH
  drawBands(ctx, pad, innerW, yOf)
  if (parent.value) drawParent(ctx, pad, innerW, yOf)
  else drawLeaf(ctx, pad, innerW, yOf)
}

watch(
  () => [
    resolved.value,
    parent.value,
    leafView.value.retention,
    leafView.value.from,
    leafView.value.end,
    leafView.value.now,
    parentView.value.retention,
    parentView.value.from,
    parentView.value.end,
  ],
  draw,
  { deep: true },
)

let resize: ResizeObserver | null = null
let themeObserver: MutationObserver | null = null
onMounted(() => {
  draw()
  resize = new ResizeObserver(() => draw())
  if (canvasRef.value) resize.observe(canvasRef.value)
  themeObserver = new MutationObserver(() => draw())
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
})
onUnmounted(() => {
  resize?.disconnect()
  themeObserver?.disconnect()
})
</script>

<style scoped>
.curve-panel {
  padding: 2px 0 2px;
}

.curve-canvas {
  display: block;
  width: 100%;
  height: 98px;
}

.curve-axis {
  position: relative;
  height: 16px;
  margin: 2px 14px 0;
}

.curve-tick {
  position: absolute;
  top: 0;
  transform: translateX(-50%);
  white-space: nowrap;
  font-size: 9px;
  color: var(--text-secondary, #718096);
}

.curve-tick.is-now {
  color: #2F6F78;
  font-weight: 650;
}

[data-theme="dark"] .curve-tick.is-now {
  color: #7ab8c0;
}
</style>
