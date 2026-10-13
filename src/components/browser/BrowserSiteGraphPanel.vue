<template>
  <div class="graph-panel" role="region" aria-label="网站图谱">
    <div v-if="!map.site" class="graph-empty">
      {{ emptyText }}
    </div>

    <div v-else class="graph-board">
      <header class="graph-head">
        <b>{{ map.site.name }}</b>
        <span>{{ headHint }}</span>
      </header>

      <div
        ref="scrollRef"
        class="graph-scroll"
        :class="{ 'is-panning': panning }"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @wheel.prevent="onWheel"
      >
        <div
          class="graph-map"
          :style="{
            width: `${map.width}px`,
            height: `${map.height}px`,
            transform: `translate(${cam.x}px, ${cam.y}px) scale(${cam.scale})`,
          }"
        >
          <svg class="graph-wires" :viewBox="`0 0 ${map.width} ${map.height}`">
            <defs>
              <marker :id="`${markerId}-arrow`" viewBox="0 0 12 12" refX="9" refY="6" markerWidth="8" markerHeight="8" orient="auto">
                <path class="graph-arrow" d="M2.2 2.2 L9.6 6 L2.2 9.8 Z" />
              </marker>
              <marker :id="`${markerId}-arrow-on`" viewBox="0 0 12 12" refX="9" refY="6" markerWidth="8" markerHeight="8" orient="auto">
                <path class="graph-arrow-on" d="M2.2 2.2 L9.6 6 L2.2 9.8 Z" />
              </marker>
            </defs>
            <path
              v-for="(wire, idx) in map.wires"
              :key="`${wire.from}-${wire.to}-${idx}`"
              :d="wire.d"
              :class="['graph-wire', `is-${wire.kind}`, { 'is-on': wire.active }]"
              :marker-end="wire.active ? `url(#${markerId}-arrow-on)` : `url(#${markerId}-arrow)`"
            />
          </svg>

          <span
            v-for="(wire, idx) in map.wires"
            :key="`lbl-${wire.from}-${wire.to}-${idx}`"
            class="graph-edge"
            :class="{ 'is-on': wire.active }"
            :style="{ left: `${wire.lx}px`, top: `${wire.ly}px` }"
          >
            {{ wire.label }}
          </span>

          <article
            v-for="node in map.nodes"
            :key="node.id"
            class="graph-node"
            :data-node-id="node.id"
            :class="{
              'is-current': node.current,
              'is-picked': picked?.id === node.id,
            }"
            :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.w}px`, height: `${node.h}px` }"
          >
            <SiteGraphPageSketch
              compact
              :title="node.title"
              :badge="node.current ? node.frames?.find((item) => item.on)?.tab : ''"
              :live="node.current"
              :sketch="sketchOf(node)"
              :on-tab="node.frames?.find((item) => item.on)?.tab"
              :frame-name="node.frame?.name"
              :pane="node.frames?.find((item) => item.on)?.name || node.frames?.[0]?.name"
              :doc-title="node.frames?.find((item) => item.on)?.title || node.frames?.find((item) => item.on)?.tab"
              :stay="(node.frames?.find((item) => item.on)?.open || node.frames?.[0]?.open) === 'stay'"
            />
          </article>
        </div>
      </div>

      <section v-if="picked" :key="picked.id" class="graph-detail">
        <header class="graph-detail-head">
          <button type="button" class="graph-detail-close" @click="selectedId = ''">收起</button>
        </header>
        <p v-if="picked.path" class="graph-detail-path">{{ picked.path }}</p>
        <SiteGraphPageSketch
          :title="picked.title"
          :badge="picked.frames?.find((item) => item.on)?.tab"
          :live="picked.current"
          :sketch="sketchOf(picked)"
          :on-tab="picked.frames?.find((item) => item.on)?.tab"
          :frame-name="picked.frame?.name"
          :pane="picked.frames?.find((item) => item.on)?.name || picked.frames?.[0]?.name"
          :doc-title="picked.frames?.find((item) => item.on)?.title || picked.frames?.find((item) => item.on)?.tab"
          :caption="picked.frames?.find((item) => item.on)?.tab
            ? `框里是「${picked.frames.find((item) => item.on)?.tab}」`
            : ''"
          :stay="(picked.frames?.find((item) => item.on)?.open || picked.frames?.[0]?.open) === 'stay'"
        />
        <p class="graph-structure">{{ picked.structure || picked.summary }}</p>
        <div v-if="picked.loops?.length" class="graph-loops">
          <span v-for="label in picked.loops" :key="label" class="graph-loop">本页{{ label }}</span>
        </div>
        <div v-if="picked.parsers.length" class="graph-parsers">
          <button
            v-for="parser in picked.parsers"
            :key="parser.id"
            type="button"
            class="graph-parser"
            :disabled="preview || !picked.current"
            :title="parserTitle(picked.current, parser.tool)"
            @click="openParser(picked.id)"
          >
            {{ parserLabel(parser.name) }}
          </button>
        </div>
        <p v-if="picked.jumps?.length" class="graph-detail-jumps">
          {{ picked.jumps.map((item) => `${item.label} → ${item.toTitle}`).join('；') }}
        </p>
      </section>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { abstractionMenuOpen } from '../../services/browser/abstractions'
import SiteGraphPageSketch from './SiteGraphPageSketch.vue'
import {
  applyMeasuredGraphHeights,
  siteGraphMenuOpen,
  siteGraphView,
  siteGraphViewFromData,
  sketchOf,
  type SiteGraphData,
} from '../../services/browser/siteGraph'

const MIN_SCALE = 0.22
const MAX_SCALE = 2.6
const CAM_DUR = 380

const props = defineProps<{
  url?: string
  data?: SiteGraphData | null
  preview?: boolean
}>()

const fromFile = computed(() => props.preview || props.data !== undefined)
const markerId = computed(() => fromFile.value ? 'sg-preview' : 'sg')
const sourceMap = computed(() => (
  fromFile.value ? siteGraphViewFromData(props.data ?? null) : siteGraphView(props.url || '')
))
const fitted = ref<ReturnType<typeof siteGraphView> | null>(null)

const overlayLiveGraph = (
  live: ReturnType<typeof siteGraphView>,
  layout: ReturnType<typeof siteGraphView> | null,
) => {
  if (!layout?.nodes.length) return live
  const fresh = new Map(live.nodes.map((node) => [node.id, node]))
  return {
    ...live,
    width: layout.width,
    height: layout.height,
    nodes: layout.nodes.map((box) => {
      const node = fresh.get(box.id)
      if (!node) return box
      return { ...node, x: box.x, y: box.y, w: box.w, h: box.h, cx: box.cx, cy: box.cy }
    }),
    wires: layout.wires.map((wire) => {
      const next = live.wires.find((item) => (
        item.from === wire.from && item.to === wire.to && item.label === wire.label
      ))
      return next ? { ...wire, active: next.active } : wire
    }),
  }
}

const map = computed(() => overlayLiveGraph(sourceMap.value, fitted.value))
const selectedId = ref('')
const picked = computed(() => (
  map.value.nodes.find((node) => node.id === selectedId.value) || null
))
const emptyText = computed(() => {
  if (props.preview) return '图谱为空或 JSON 无效'
  return map.value.unknown ? '当前站还没有图谱' : '打开网页后显示路由和解析器'
})
const headHint = computed(() => {
  const site = map.value.site
  if (!site) return ''
  if (props.preview) return `${site.host} · ${map.value.nodes.length} 个页面`
  const here = map.value.current
  const tab = here?.frames?.find((item) => item.on)?.tab
  const where = here ? `当前在「${here.title}${tab ? ` · ${tab}` : ''}」` : site.host
  return picked.value ? where : `${where} · 点卡片看结构`
})
const scrollRef = ref<HTMLElement | null>(null)
const cam = reactive({ x: 0, y: 0, scale: 1 })
const panning = ref(false)
const userMoved = ref(false)

let pointerId: number | null = null
let lastX = 0
let lastY = 0
let dragMoved = false
let downNodeId = ''
let camFrom = { x: 0, y: 0, scale: 1 }
let camTo = { x: 0, y: 0, scale: 1 }
let camStart = 0
let camT = 1
let camRaf = 0
let resize: ResizeObserver | null = null
let resizeTimer = 0

const prefersReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

const stopCamera = () => {
  camT = 1
  if (!camRaf) return
  cancelAnimationFrame(camRaf)
  camRaf = 0
}

const setCamera = (x: number, y: number, scale: number) => {
  cam.x = x
  cam.y = y
  cam.scale = scale
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

const stepCam = (now: number) => {
  camT = Math.min(1, (now - camStart) / CAM_DUR)
  const ease = easeOutCubic(camT)
  cam.x = camFrom.x + (camTo.x - camFrom.x) * ease
  cam.y = camFrom.y + (camTo.y - camFrom.y) * ease
  cam.scale = camFrom.scale + (camTo.scale - camFrom.scale) * ease
  if (camT < 1) {
    camRaf = requestAnimationFrame(stepCam)
    return
  }
  camRaf = 0
}

const animateCamera = (x: number, y: number, scale: number) => {
  if (prefersReduced()) {
    stopCamera()
    setCamera(x, y, scale)
    return
  }
  camFrom = { x: cam.x, y: cam.y, scale: cam.scale }
  camTo = { x, y, scale }
  camStart = performance.now()
  camT = 0
  if (!camRaf) camRaf = requestAnimationFrame(stepCam)
}

const viewSize = () => {
  const view = scrollRef.value
  return { w: view?.clientWidth || 0, h: view?.clientHeight || 0 }
}

const cameraForBox = (box: { x: number; y: number; w: number; h: number }, fill: number) => {
  const { w, h } = viewSize()
  if (w < 24 || h < 24) return null
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(w / box.w, h / box.h) * fill))
  return {
    x: w / 2 - (box.x + box.w / 2) * scale,
    y: h / 2 - (box.y + box.h / 2) * scale,
    scale,
  }
}

const fitMap = (instant = false) => {
  if (!map.value.site) return
  const next = cameraForBox({ x: 0, y: 0, w: map.value.width, h: map.value.height }, 0.92)
  if (!next) return
  if (instant) {
    stopCamera()
    setCamera(next.x, next.y, next.scale)
    return
  }
  animateCamera(next.x, next.y, next.scale)
}

const nodeVisible = (node: { x: number; y: number; w: number; h: number }) => {
  const { w, h } = viewSize()
  const pad = 12
  const left = node.x * cam.scale + cam.x
  const top = node.y * cam.scale + cam.y
  return left >= pad
    && top >= pad
    && left + node.w * cam.scale <= w - pad
    && top + node.h * cam.scale <= h - pad
}

const revealNode = (id: string) => {
  const node = map.value.nodes.find((item) => item.id === id)
  if (!node || nodeVisible(node)) return
  const { w, h } = viewSize()
  if (w < 24 || h < 24) return
  animateCamera(w / 2 - node.cx * cam.scale, h / 2 - node.cy * cam.scale, cam.scale)
}

const nodeIdFromEvent = (event: PointerEvent) => {
  const fromTarget = event.target instanceof Element
    ? event.target.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId
    : ''
  if (fromTarget) return fromTarget
  const hit = document.elementFromPoint(event.clientX, event.clientY)
  return hit instanceof Element ? hit.closest<HTMLElement>('[data-node-id]')?.dataset.nodeId || '' : ''
}

const pickNode = (id: string) => {
  if (!id) return
  selectedId.value = selectedId.value === id ? '' : id
}

const onPointerDown = (event: PointerEvent) => {
  if (event.button !== 0) return
  if (event.target instanceof Element && event.target.closest('button')) return
  stopCamera()
  pointerId = event.pointerId
  lastX = event.clientX
  lastY = event.clientY
  dragMoved = false
  downNodeId = nodeIdFromEvent(event)
  scrollRef.value?.setPointerCapture(event.pointerId)
}

const onPointerMove = (event: PointerEvent) => {
  if (pointerId !== event.pointerId) return
  const dx = event.clientX - lastX
  const dy = event.clientY - lastY
  if (!dragMoved && Math.hypot(dx, dy) < 3) return
  dragMoved = true
  panning.value = true
  userMoved.value = true
  lastX = event.clientX
  lastY = event.clientY
  cam.x += dx
  cam.y += dy
}

const onPointerUp = (event: PointerEvent) => {
  if (pointerId !== event.pointerId) return
  const id = downNodeId || nodeIdFromEvent(event)
  if (!dragMoved && id) {
    pickNode(id)
  } else if (!dragMoved && !id) {
    selectedId.value = ''
    userMoved.value = false
    fitMap()
  }
  pointerId = null
  panning.value = false
  downNodeId = ''
}

const onWheel = (event: WheelEvent) => {
  const view = scrollRef.value
  if (!view) return
  const rect = view.getBoundingClientRect()
  const sx = event.clientX - rect.left
  const sy = event.clientY - rect.top
  const worldX = (sx - cam.x) / cam.scale
  const worldY = (sy - cam.y) / cam.scale
  userMoved.value = true
  stopCamera()
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, cam.scale * (event.deltaY > 0 ? 0.92 : 1.08)))
  cam.scale = next
  cam.x = sx - worldX * next
  cam.y = sy - worldY * next
}

const parserLabel = (name: string) => name.replace(/^学习通/, '')
const parserTitle = (current: boolean, tool: string) => {
  if (props.preview) return tool || '解析器'
  return current ? tool : '打开对应页面后可挂这个解析器'
}

const openParser = (nodeId: string) => {
  const node = map.value.nodes.find((item) => item.id === nodeId)
  if (!node?.current) return
  siteGraphMenuOpen.value = false
  abstractionMenuOpen.value = true
}

const measureNodes = async () => {
  await nextTick()
  const root = scrollRef.value
  if (!root || !sourceMap.value.nodes.length) {
    fitted.value = null
    return
  }
  const heights: Record<string, number> = {}
  root.querySelectorAll<HTMLElement>('[data-node-id]').forEach((el) => {
    const id = el.dataset.nodeId
    if (id) heights[id] = Math.max(el.scrollHeight, el.offsetHeight)
  })
  fitted.value = applyMeasuredGraphHeights(sourceMap.value, heights)
}

watch(() => sourceMap.value.site?.id, async () => {
  userMoved.value = false
  selectedId.value = ''
  fitted.value = null
  await measureNodes()
  fitMap(true)
})

watch(() => sourceMap.value.nodes.map((node) => `${node.id}:${node.structure}:${JSON.stringify(node.sketch || '')}`).join('|'), async () => {
  fitted.value = null
  await measureNodes()
})

watch(() => [map.value.width, map.value.height], async () => {
  await nextTick()
  if (!userMoved.value) fitMap(true)
})

watch(() => map.value.current?.id, async (id) => {
  await nextTick()
  if (id) revealNode(id)
})

watch(picked, async (node) => {
  await nextTick()
  if (node) revealNode(node.id)
  else if (!userMoved.value) fitMap()
})

onMounted(() => {
  resize = new ResizeObserver(() => {
    if (resizeTimer) window.clearTimeout(resizeTimer)
    resizeTimer = window.setTimeout(() => {
      resizeTimer = 0
      if (!userMoved.value) fitMap(true)
    }, 80)
  })
  if (scrollRef.value) resize.observe(scrollRef.value)
  void measureNodes().then(() => fitMap(true))
})

onBeforeUnmount(() => {
  resize?.disconnect()
  if (resizeTimer) window.clearTimeout(resizeTimer)
  stopCamera()
})
</script>

<style scoped>
.graph-panel {
  box-sizing: border-box;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.graph-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px 12px;
  font-size: 13px;
  color: var(--text-secondary, #86868b);
  text-align: center;
}

.graph-board {
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.graph-head {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 14px 8px;
}

.graph-head b {
  font-size: 15px;
  font-weight: 650;
  letter-spacing: -0.02em;
  color: var(--text-primary, #1d1d1f);
}

.graph-head span {
  font-size: 12px;
  color: var(--text-secondary, #86868b);
}

.graph-scroll {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  user-select: none;
}

.graph-scroll.is-panning {
  cursor: grabbing;
}

.graph-map {
  position: relative;
  transform-origin: 0 0;
  will-change: transform;
}

.graph-wires {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
  pointer-events: none;
}

.graph-wire {
  fill: none;
  stroke: color-mix(in srgb, var(--text-primary, #1d1d1f) 18%, transparent);
  stroke-width: 1.35;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.graph-wire.is-back,
.graph-wire.is-loop {
  stroke: color-mix(in srgb, var(--text-primary, #1d1d1f) 14%, transparent);
  stroke-dasharray: 4 5;
}

.graph-wire.is-on {
  stroke: color-mix(in srgb, var(--color-primary, #667eea) 78%, transparent);
  stroke-width: 1.7;
}

.graph-arrow {
  fill: color-mix(in srgb, var(--text-primary, #1d1d1f) 24%, transparent);
}

.graph-arrow-on {
  fill: color-mix(in srgb, var(--color-primary, #667eea) 86%, transparent);
}

.graph-edge {
  position: absolute;
  z-index: 2;
  transform: translate(-50%, -50%);
  padding: 2px 7px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-secondary, #fff) 92%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--text-primary, #1d1d1f) 6%, transparent);
  font-size: 10px;
  font-weight: 560;
  letter-spacing: -0.01em;
  line-height: 1.2;
  color: var(--text-secondary, #86868b);
  white-space: nowrap;
  pointer-events: none;
}

.graph-edge.is-on {
  background: color-mix(in srgb, var(--color-primary, #667eea) 10%, var(--bg-secondary, #fff));
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--color-primary, #667eea) 22%, transparent);
  color: var(--color-primary, #667eea);
}

.graph-node {
  position: absolute;
  z-index: 3;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  padding: 0;
  overflow: visible;
  border: none;
  background: transparent;
  box-shadow: none;
  cursor: pointer;
}

.graph-node:active {
  transform: scale(0.97);
}

.graph-node.is-current :deep(.win) {
  box-shadow:
    0 1px 0 color-mix(in srgb, #fff 70%, transparent) inset,
    0 1px 2px color-mix(in srgb, var(--text-primary, #1d1d1f) 16%, transparent),
    0 6px 12px color-mix(in srgb, var(--color-primary, #667eea) 22%, transparent),
    0 16px 24px color-mix(in srgb, var(--color-primary, #667eea) 16%, transparent),
    0 0 0 1px color-mix(in srgb, var(--color-primary, #667eea) 40%, transparent);
}

.graph-node.is-picked :deep(.win) {
  box-shadow:
    0 1px 0 color-mix(in srgb, #fff 70%, transparent) inset,
    0 1px 2px color-mix(in srgb, var(--text-primary, #1d1d1f) 18%, transparent),
    0 8px 14px color-mix(in srgb, var(--color-primary, #667eea) 26%, transparent),
    0 18px 28px color-mix(in srgb, var(--color-primary, #667eea) 18%, transparent),
    0 0 0 1px color-mix(in srgb, var(--color-primary, #667eea) 52%, transparent);
}

.graph-detail {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 42%;
  overflow: auto;
  padding: 10px 14px 14px;
  border-top: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 55%, transparent);
  background: color-mix(in srgb, var(--bg-secondary, #fff) 88%, transparent);
  animation: graph-detail-in 220ms cubic-bezier(0.22, 1, 0.36, 1);
}

.graph-detail-head {
  display: flex;
  align-items: center;
  justify-content: flex-end;
}

.graph-detail-close {
  flex-shrink: 0;
  height: 24px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: color-mix(in srgb, var(--text-primary, #1d1d1f) 6%, transparent);
  color: var(--text-secondary, #86868b);
  font-size: 12px;
  cursor: pointer;
}

.graph-detail-close:hover {
  background: color-mix(in srgb, var(--text-primary, #1d1d1f) 10%, transparent);
}

.graph-detail-close:active {
  transform: scale(0.97);
}

.graph-detail-path,
.graph-detail-jumps {
  margin: 0;
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-secondary, #86868b);
}

.graph-structure {
  min-width: 0;
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-primary, #1d1d1f);
  white-space: normal;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.graph-frame {
  display: flex;
  flex-shrink: 0;
  flex-direction: column;
  min-width: 0;
  min-height: 36px;
  overflow: hidden;
  border-radius: 6px;
  background: color-mix(in srgb, var(--bg-secondary, #fff) 70%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--text-primary, #1d1d1f) 14%, transparent);
}

.graph-frame.is-stay {
  box-shadow: inset 0 0 0 1px color-mix(in srgb, #c47d12 42%, transparent);
  background: repeating-linear-gradient(
    -12deg,
    color-mix(in srgb, #c47d12 7%, transparent),
    color-mix(in srgb, #c47d12 7%, transparent) 4px,
    transparent 4px,
    transparent 8px
  );
}

.graph-frame-bar {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 4px;
  min-width: 0;
  padding: 3px 5px 0;
}

.graph-frame-bar i {
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: 3px;
  background: color-mix(in srgb, var(--text-primary, #1d1d1f) 10%, transparent);
  font-size: 8px;
  font-style: normal;
  font-weight: 700;
  letter-spacing: 0.04em;
  line-height: 14px;
  color: var(--text-primary, #1d1d1f);
}

.graph-frame.is-stay .graph-frame-bar i {
  background: color-mix(in srgb, #c47d12 22%, transparent);
  color: #8a5a10;
}

.graph-frame-bar small {
  overflow: hidden;
  font-size: 9px;
  line-height: 14px;
  color: var(--text-secondary, #86868b);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graph-frame-body {
  flex-shrink: 0;
  padding: 2px 5px 5px;
  overflow: hidden;
  font-size: 10px;
  font-weight: 560;
  line-height: 16px;
  color: var(--text-primary, #1d1d1f);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.graph-tabs {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 2px 4px 4px;
}

.graph-tab {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  min-width: 0;
  padding: 2px 6px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--text-primary, #1d1d1f) 5%, transparent);
  font-size: 10px;
  font-weight: 600;
  line-height: 16px;
  color: var(--text-primary, #1d1d1f);
}

.graph-tab small {
  font-size: 9px;
  font-weight: 500;
  color: var(--text-secondary, #86868b);
}

.graph-tab.is-on {
  background: color-mix(in srgb, var(--color-primary, #667eea) 16%, transparent);
  color: var(--color-primary, #667eea);
}

.graph-node.is-current .graph-tab.is-on small {
  color: var(--color-primary, #667eea);
}

.graph-loops {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 4px;
}

.graph-loop {
  height: 18px;
  padding: 0 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-primary, #1d1d1f) 7%, transparent);
  color: var(--text-secondary, #86868b);
  font-size: 10px;
  line-height: 18px;
}

.graph-parsers {
  display: flex;
  flex-shrink: 0;
  flex-wrap: wrap;
  gap: 4px;
}

.graph-parser {
  height: 18px;
  padding: 0 6px;
  border: none;
  border-radius: 999px;
  background: color-mix(in srgb, var(--color-primary, #667eea) 12%, transparent);
  color: var(--text-primary, #2d3748);
  font-size: 10px;
  cursor: pointer;
}

.graph-parser:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-primary, #667eea) 18%, transparent);
}

.graph-parser:disabled {
  cursor: default;
  opacity: 0.7;
}

[data-theme="dark"] .graph-edge {
  background: var(--bg-secondary, #2c2c2e);
}

@keyframes graph-detail-in {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@media (prefers-reduced-motion: reduce) {
  .graph-node:active,
  .graph-detail-close:active {
    transform: none;
  }

  .graph-detail {
    animation: none;
  }
}
</style>
