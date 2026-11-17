<template>
  <div
    ref="rootRef"
    class="agent-d2"
    :class="{ 'is-panning': panning }"
    :style="{
      '--d2-zoom': String(zoom),
      '--d2-x': `${x}px`,
      '--d2-y': `${y}px`,
      '--d2-fit-width': fitWidth ? `${fitWidth}px` : '100%',
      '--d2-canvas-height': canvasHeight ? `${canvasHeight}px` : 'auto',
    }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
  >
    <D2BlockNode
      v-bind="$attrs"
      :node="d2Node"
      :loading="Boolean(loading)"
      :is-dark="isDark"
      :progressive-render="true"
    />
    <div class="agent-d2-zoom">
      <div class="agent-d2-zoom-bar">
        <button class="agent-d2-zoom-btn" type="button" title="放大" @click="zoomIn">
          <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35M11 8v6m-3-3h6" />
          </svg>
        </button>
        <button class="agent-d2-zoom-btn" type="button" title="缩小" @click="zoomOut">
          <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35M8 11h6" />
          </svg>
        </button>
        <button class="agent-d2-zoom-btn is-label" type="button" title="重置比例" @click="resetView">
          {{ Math.round(zoom * 100) }}%
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { D2BlockNode } from 'markstream-vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  node: Record<string, unknown>
  loading?: boolean
  isDark?: boolean
}>()

const d2Node = computed(() => {
  const node = props.node
  const code = String(node.code ?? node.content ?? '')
  return {
    ...node,
    type: 'code_block' as const,
    language: String(node.language || 'd2'),
    raw: String(node.raw ?? code),
    code,
  }
})

const rootRef = ref<HTMLElement | null>(null)
const zoom = ref(1)
const x = ref(0)
const y = ref(0)
const panning = ref(false)
const fitWidth = ref(0)
const canvasHeight = ref(0)

let pointerId: number | null = null
let startX = 0
let startY = 0
let originX = 0
let originY = 0
let layoutRaf = 0
let observedRender: HTMLElement | null = null
let mutationObserver: MutationObserver | null = null
let resizeObserver: ResizeObserver | null = null

const MIN_CANVAS = 160
const MAX_CANVAS = 500

const isCanvasTarget = (target: EventTarget | null) => {
  const el = target instanceof Element ? target : null
  if (!el) return false
  if (el.closest('.agent-d2-zoom, .d2-block-header, button, a')) return false
  return Boolean(el.closest('.d2-render, .d2-svg'))
}

const onPointerDown = (event: PointerEvent) => {
  if (event.button !== 0 || !isCanvasTarget(event.target)) return
  const host = rootRef.value
  if (!host) return
  panning.value = true
  pointerId = event.pointerId
  startX = event.clientX
  startY = event.clientY
  originX = x.value
  originY = y.value
  host.setPointerCapture(event.pointerId)
  event.preventDefault()
}

const onPointerMove = (event: PointerEvent) => {
  if (!panning.value || event.pointerId !== pointerId) return
  x.value = originX + (event.clientX - startX)
  y.value = originY + (event.clientY - startY)
}

const onPointerUp = (event: PointerEvent) => {
  if (event.pointerId !== pointerId) return
  panning.value = false
  pointerId = null
}

const zoomIn = () => {
  if (zoom.value < 3) zoom.value = Math.round((zoom.value + 0.1) * 10) / 10
}

const zoomOut = () => {
  if (zoom.value > 0.5) zoom.value = Math.round((zoom.value - 0.1) * 10) / 10
}

const resetView = () => {
  zoom.value = 1
  x.value = 0
  y.value = 0
}

const getRender = () => rootRef.value?.querySelector<HTMLElement>('.d2-render') ?? null
const getSvg = () => rootRef.value?.querySelector<SVGSVGElement>('.d2-svg svg') ?? null

const readAspect = (svg: SVGSVGElement) => {
  const viewBox = svg.viewBox?.baseVal
  if (viewBox && viewBox.width > 0 && viewBox.height > 0) return viewBox.height / viewBox.width
  const width = Number.parseFloat(svg.getAttribute('width') || '')
  const height = Number.parseFloat(svg.getAttribute('height') || '')
  if (width > 0 && height > 0) return height / width
  try {
    const box = svg.getBBox()
    if (box.width > 0 && box.height > 0) return box.height / box.width
  } catch {
    return 0
  }
  return 0
}

const normalizeSvg = (svg: SVGSVGElement) => {
  if (svg.dataset.agentD2Ready === '1') return
  if (!svg.getAttribute('viewBox')) {
    const width = Number.parseFloat(svg.getAttribute('width') || '')
    const height = Number.parseFloat(svg.getAttribute('height') || '')
    if (width > 0 && height > 0) {
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`)
    } else {
      try {
        const box = svg.getBBox()
        if (box.width > 0 && box.height > 0) {
          svg.setAttribute('viewBox', `${box.x} ${box.y} ${box.width} ${box.height}`)
        }
      } catch {
        return
      }
    }
  }
  svg.removeAttribute('width')
  svg.removeAttribute('height')
  svg.setAttribute('preserveAspectRatio', 'xMidYMid meet')
  svg.dataset.agentD2Ready = '1'
}

const layout = () => {
  const render = getRender()
  const svg = getSvg()
  if (!render || !svg) return
  normalizeSvg(svg)
  const aspect = readAspect(svg)
  const width = render.clientWidth
  if (aspect <= 0 || width <= 0) return
  const maxHeight = Math.min(MAX_CANVAS, Math.max(MIN_CANVAS, Math.round(window.innerHeight * 0.4)))
  let nextWidth = width
  let nextHeight = width * aspect
  if (nextHeight > maxHeight) {
    nextHeight = maxHeight
    nextWidth = nextHeight / aspect
  }
  fitWidth.value = Math.round(nextWidth)
  canvasHeight.value = Math.round(nextHeight)
}

const scheduleLayout = () => {
  if (layoutRaf) return
  layoutRaf = window.requestAnimationFrame(() => {
    layoutRaf = 0
    const render = getRender()
    if (render && resizeObserver && render !== observedRender) {
      if (observedRender) resizeObserver.unobserve(observedRender)
      observedRender = render
      resizeObserver.observe(render)
    }
    layout()
  })
}

onMounted(() => {
  const root = rootRef.value
  if (!root) return
  resizeObserver = new ResizeObserver(scheduleLayout)
  mutationObserver = new MutationObserver(scheduleLayout)
  mutationObserver.observe(root, { childList: true, subtree: true })
  window.addEventListener('resize', scheduleLayout)
  scheduleLayout()
})

onBeforeUnmount(() => {
  mutationObserver?.disconnect()
  resizeObserver?.disconnect()
  window.removeEventListener('resize', scheduleLayout)
  if (layoutRaf) window.cancelAnimationFrame(layoutRaf)
})
</script>

<style scoped>
.agent-d2 {
  position: relative;
}

.agent-d2 :deep(.d2-block-container),
.agent-d2 :deep(.d2-block-body),
.agent-d2 :deep(.d2-render) {
  overflow: hidden !important;
  background: var(--diagram-bg, transparent);
}

.agent-d2 :deep(.d2-render) {
  position: relative;
  height: var(--d2-canvas-height, auto);
  max-height: none;
  touch-action: none;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
}

.agent-d2.is-panning :deep(.d2-render) {
  cursor: grabbing;
}

.agent-d2 :deep(.d2-svg) {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--diagram-bg, transparent);
  transform: translate(var(--d2-x, 0px), var(--d2-y, 0px));
}

.agent-d2 :deep(.d2-svg svg.markstream-d2-root-svg),
.agent-d2 :deep(.d2-svg svg) {
  display: block;
  width: calc(var(--d2-fit-width, 100%) * var(--d2-zoom, 1));
  max-width: none !important;
  height: auto !important;
  max-height: none !important;
  background: transparent !important;
  text-rendering: geometricPrecision;
  shape-rendering: geometricPrecision;
}

.agent-d2 :deep(.markstream-d2-root-svg > rect:first-child),
.agent-d2 :deep(.d2-svg svg > rect:first-child) {
  fill: transparent !important;
}

.agent-d2:has(.d2-source) .agent-d2-zoom {
  display: none;
}

.agent-d2-zoom {
  position: absolute;
  top: 40px;
  right: 8px;
  z-index: 2;
  pointer-events: none;
}

.agent-d2-zoom-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 2px 4px;
  border-radius: 8px;
  backdrop-filter: blur(10px);
  background: color-mix(in srgb, var(--diagram-bg, #fff) 72%, transparent);
  pointer-events: auto;
}

.agent-d2-zoom-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 22px;
  padding: var(--ms-action-btn-padding, 4px);
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--code-action-fg, var(--text-secondary, #718096));
  font-family: inherit;
  font-size: var(--ms-text-label, 11px);
  line-height: 1;
  cursor: pointer;
}

.agent-d2-zoom-btn.is-label {
  min-width: 36px;
}

.agent-d2-zoom-btn:hover {
  background: var(--code-action-hover-bg, color-mix(in srgb, currentColor 10%, transparent));
  color: var(--code-action-hover-fg, var(--text-primary, #2d3748));
}

.agent-d2-zoom-btn:active {
  transform: scale(0.97);
}
</style>
