<template>
  <div
    ref="wrapRef"
    class="study-mermaid"
    :class="{ 'is-empty': !viewGraph, 'is-streaming': streaming, 'is-panning': panning, 'is-dragging': dragging }"
    @pointerdown="onPointerDown"
    @pointermove="onPointerMove"
    @pointerup="onPointerUp"
    @pointercancel="onPointerUp"
    @wheel.prevent="onWheel"
  >
    <canvas v-show="viewGraph" ref="canvasRef" class="study-net" />
    <div v-if="!viewGraph" class="study-mermaid-empty">{{ emptyText }}</div>
    <div v-if="streaming && viewGraph" class="study-mermaid-live">正在绘制</div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  graphFromMermaid,
  mergeGraphDetails,
  type StudyGraphNode,
} from '../../utils/study/studyGraph'
import {
  fontForDepth,
  hitSlop,
  labelLimitForDepth,
  childrenByParent,
  nodeColor,
  POP_MS,
  SIZE_RATIO,
  stepForceGraph,
  syncForceGraph,
  type ForceGraph,
  type ForceNode,
} from '../../utils/study/studyGraphForce'

const props = defineProps<{
  source?: string
  graph?: StudyGraphNode | null
  streaming?: boolean
  selectedName?: string
  emptyText?: string
}>()

const emit = defineEmits<{
  select: [name: string, id?: string]
}>()

const wrapRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const panning = ref(false)
const dragging = ref(false)
const emptyText = computed(() => props.emptyText || '选择左侧科目查看知识图谱')

const viewGraph = computed(() => {
  const source = String(props.source || '').trim()
  if (source) {
    const parsed = graphFromMermaid(props.graph?.name || '知识图谱', source)
    if (parsed) return mergeGraphDetails(parsed, props.graph)
  }
  return props.graph || null
})

let clockTimer: number | null = null
let onDisplayChange: (() => void) | null = null

const camera = { x: 0, y: 0, scale: 1 }
const bodies = new Map<string, ForceNode>()
let sim: ForceGraph = { nodes: [], links: [] }
let alpha = 1
let hoverId = ''
let dragId = ''
let dragMoved = false
let pointerId: number | null = null
let lastX = 0
let lastY = 0
let layoutW = 0
let layoutH = 0
let resizeFrameTimer = 0
let raf = 0
let running = false
let resize: ResizeObserver | null = null
let camFrom = { x: 0, y: 0, scale: 1 }
let camTo = { x: 0, y: 0, scale: 1 }
let camStart = 0
let camT = 1
let camEase: 'cubic' | 'back' = 'cubic'
const CAM_DUR = 420
const SETTLE_DUR = 560

const graphChrome = {
  dark: false,
  label: '#334155',
  labelDim: 'rgba(51, 65, 85, 0.28)',
  nodeDim: 'rgba(241, 245, 249, 0.35)',
  strokeDim: 'rgba(148, 163, 184, 0.35)',
  link: 'rgba(148, 163, 184, 0.55)',
  linkExtra: 'rgba(148, 163, 184, 0.28)',
  linkDim: 'rgba(148, 163, 184, 0.08)',
}

const syncGraphChrome = () => {
  const dark = document.documentElement.getAttribute('data-theme') === 'dark'
  graphChrome.dark = dark
  if (dark) {
    graphChrome.label = '#e8eaed'
    graphChrome.labelDim = 'rgba(232, 234, 237, 0.34)'
    graphChrome.nodeDim = 'rgba(58, 58, 60, 0.62)'
    graphChrome.strokeDim = 'rgba(174, 184, 198, 0.28)'
    graphChrome.link = 'rgba(174, 184, 198, 0.42)'
    graphChrome.linkExtra = 'rgba(174, 184, 198, 0.22)'
    graphChrome.linkDim = 'rgba(174, 184, 198, 0.08)'
    return
  }
  graphChrome.label = '#334155'
  graphChrome.labelDim = 'rgba(51, 65, 85, 0.28)'
  graphChrome.nodeDim = 'rgba(241, 245, 249, 0.35)'
  graphChrome.strokeDim = 'rgba(148, 163, 184, 0.35)'
  graphChrome.link = 'rgba(148, 163, 184, 0.55)'
  graphChrome.linkExtra = 'rgba(148, 163, 184, 0.28)'
  graphChrome.linkDim = 'rgba(148, 163, 184, 0.08)'
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3

const easeOutBack = (t: number) => {
  const c1 = 1.70158
  const c3 = c1 + 1
  return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2
}

const appearOf = (node: ForceNode, now: number) => {
  if (!node.bornAt) return 1
  const raw = (now - node.bornAt) / POP_MS
  if (raw <= 0) return 0
  if (raw >= 1) return 1
  return raw
}

const stopCamera = () => {
  camT = 1
}

const animateCamera = (x: number, y: number, scale: number, ease: 'cubic' | 'back' = 'cubic', duration = CAM_DUR) => {
  camFrom = { x: camera.x, y: camera.y, scale: camera.scale }
  camTo = { x, y, scale }
  camStart = performance.now()
  camT = 0
  camEase = ease
  camDur = duration
  if (!raf) raf = requestAnimationFrame(tick)
}

let camDur = CAM_DUR

const stepCamera = (now: number) => {
  if (camT >= 1) return false
  camT = Math.min(1, (now - camStart) / camDur)
  const ease = camEase === 'back' ? easeOutBack(camT) : easeOutCubic(camT)
  camera.x = camFrom.x + (camTo.x - camFrom.x) * ease
  camera.y = camFrom.y + (camTo.y - camFrom.y) * ease
  camera.scale = camFrom.scale + (camTo.scale - camFrom.scale) * ease
  return camT < 1
}

const boundsOf = (nodes: ForceNode[], useHome = false) => {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const node of nodes) {
    const x = useHome ? node.tx : node.x
    const y = useHome ? node.ty : node.y
    const font = fontForDepth(node.depth)
    const labelW = labelLimitForDepth(node.depth) * font * 0.56
    const padX = Math.max(node.r + 10, labelW / 2 + 8)
    const padY = node.r + font + 14
    minX = Math.min(minX, x - padX)
    minY = Math.min(minY, y - padY)
    maxX = Math.max(maxX, x + padX)
    maxY = Math.max(maxY, y + padY)
  }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: Math.max(36, maxX - minX),
    h: Math.max(36, maxY - minY),
  }
}

const lookAt = (nodes: ForceNode[], fill = 0.76, useHome = false, instant = false) => {
  const wrap = wrapRef.value
  if (!wrap || !nodes.length) return
  const box = boundsOf(nodes, useHome)
  const width = wrap.clientWidth
  const height = wrap.clientHeight
  if (width < 40 || height < 40) return
  const scale = Math.min(4.2, Math.max(0.55, Math.min(width / box.w, height / box.h) * fill))
  const x = width / 2 - box.cx * scale
  const y = height * 0.48 - box.cy * scale
  if (instant) {
    stopCamera()
    camera.x = x
    camera.y = y
    camera.scale = scale
    draw()
    return
  }
  animateCamera(x, y, scale)
}

const cameraFor = (nodes: ForceNode[], fill: number, useHome = false) => {
  const wrap = wrapRef.value
  if (!wrap || !nodes.length) return null
  const box = boundsOf(nodes, useHome)
  const width = wrap.clientWidth
  const height = wrap.clientHeight
  if (width < 40 || height < 40) return null
  const scale = Math.min(4.2, Math.max(0.45, Math.min(width / box.w, height / box.h) * fill))
  return {
    x: width / 2 - box.cx * scale,
    y: height * 0.48 - box.cy * scale,
    scale,
  }
}

const childrenOf = (id: string) => {
  const kids: string[] = []
  for (const link of sim.links) {
    if (!link.extra && link.from === id) kids.push(link.to)
  }
  return kids
}

const subtreeOf = (id: string) => {
  const ids = new Set<string>()
  const walk = (current: string) => {
    if (ids.has(current)) return
    ids.add(current)
    for (const child of childrenOf(current)) walk(child)
  }
  walk(id)
  return sim.nodes.filter((item) => ids.has(item.id))
}

const focusNode = (node: ForceNode, instant = false) => {
  const group = subtreeOf(node.id)
  lookAt(group.length ? group : [node], node.depth === 0 ? 0.8 : 0.78, true, instant)
}

const focusByName = (name: string, instant = false) => {
  userPanned = false
  const query = String(name || '').trim()
  if (!query) {
    if (sim.nodes.length) lookAt(sim.nodes, 0.82, true, instant)
    return Boolean(sim.nodes.length)
  }
  const exact = sim.nodes.find((node) => node.name === query || node.id === query || node.id === `node:${query}`)
  const fuzzy = exact || sim.nodes.find((node) => node.name.includes(query) || query.includes(node.name))
  if (!fuzzy) return false
  focusNode(fuzzy, instant)
  return true
}

let userPanned = false
let framedGraphId = ''

const frameView = (instant = false) => {
  const wrap = wrapRef.value
  if (!wrap || wrap.clientWidth < 40 || wrap.clientHeight < 40 || !sim.nodes.length) return false
  const name = String(props.selectedName || '').trim()
  if (name) focusByName(name, instant)
  else lookAt(sim.nodes, 0.82, true, instant)
  framedGraphId = viewGraph.value?.id || ''
  return true
}

const settleView = () => {
  const wrap = wrapRef.value
  if (!wrap || wrap.clientWidth < 40 || wrap.clientHeight < 40 || !sim.nodes.length) return false
  const id = viewGraph.value?.id || ''
  const name = String(props.selectedName || '').trim()
  const hit = name
    ? sim.nodes.find((node) => node.name === name || node.id === name)
      || sim.nodes.find((node) => node.name.includes(name) || name.includes(node.name))
    : null
  const group = hit ? subtreeOf(hit.id) : sim.nodes
  const end = cameraFor(group, hit ? (hit.depth === 0 ? 0.8 : 0.78) : 0.82, true)
  if (!end) return false
  const start = cameraFor(group, 0.46, true)
  stopCamera()
  camera.x = start?.x ?? end.x
  camera.y = start?.y ?? end.y
  camera.scale = Math.max(0.28, (start?.scale ?? end.scale) * 0.62)
  framedGraphId = id
  draw()
  animateCamera(end.x, end.y, end.scale, 'back', SETTLE_DUR)
  return true
}

defineExpose({ focusByName, fitView: () => frameView(true) })

const worldPoint = (clientX: number, clientY: number) => {
  const wrap = wrapRef.value
  if (!wrap) return { x: 0, y: 0 }
  const rect = wrap.getBoundingClientRect()
  return {
    x: (clientX - rect.left - camera.x) / camera.scale,
    y: (clientY - rect.top - camera.y) / camera.scale,
  }
}

const hitNode = (x: number, y: number) => {
  for (let i = sim.nodes.length - 1; i >= 0; i--) {
    const node = sim.nodes[i]
    if (Math.hypot(node.x - x, node.y - y) <= hitSlop(node.r)) return node
  }
  return null
}

const neighborsOf = (id: string) => {
  const set = new Set<string>([id])
  for (const link of sim.links) {
    if (link.from === id) set.add(link.to)
    if (link.to === id) set.add(link.from)
  }
  return set
}

const canvasScale = () => Math.max(1, window.devicePixelRatio || 1)

const syncCanvasSize = (canvas: HTMLCanvasElement, wrap: HTMLElement) => {
  const dpr = canvasScale()
  const w = wrap.clientWidth
  const h = wrap.clientHeight
  const bw = Math.max(1, Math.round(w * dpr))
  const bh = Math.max(1, Math.round(h * dpr))
  if (canvas.width !== bw || canvas.height !== bh) {
    canvas.width = bw
    canvas.height = bh
  }
  canvas.style.width = `${w}px`
  canvas.style.height = `${h}px`
  return { w, h, sx: bw / w, sy: bh / h }
}

const draw = () => {
  const canvas = canvasRef.value
  const wrap = wrapRef.value
  if (!canvas || !wrap) return
  const { w, h, sx, sy } = syncCanvasSize(canvas, wrap)
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.setTransform(sx, 0, 0, sy, 0, 0)
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = 'high'
  ctx.clearRect(0, 0, w, h)
  ctx.save()
  ctx.translate(camera.x, camera.y)
  ctx.scale(camera.scale, camera.scale)

  const now = performance.now()
  const wallNow = Date.now()
  const focus = hoverId || (props.selectedName
    ? sim.nodes.find((node) => node.name === props.selectedName)?.id || ''
    : '')
  const near = focus ? neighborsOf(focus) : null
  const byId = new Map(sim.nodes.map((node) => [node.id, node]))
  const kids = childrenByParent(sim.nodes)
  const labels: Array<{
    x: number
    y: number
    size: number
    text: string
    dim: boolean
    alpha: number
  }> = []

  for (const link of sim.links) {
    const from = byId.get(link.from)
    const to = byId.get(link.to)
    if (!from || !to) continue
    const fade = Math.min(appearOf(from, now), appearOf(to, now))
    if (fade <= 0.02) continue
    const active = !near || near.has(link.from) && near.has(link.to)
    ctx.globalAlpha = fade
    ctx.beginPath()
    ctx.moveTo(from.x, from.y)
    ctx.lineTo(to.x, to.y)
    ctx.strokeStyle = active
      ? (link.extra ? graphChrome.linkExtra : graphChrome.link)
      : graphChrome.linkDim
    const depth = Math.min(from.depth, to.depth)
    ctx.lineWidth = (active ? 1.15 : 0.75) * (SIZE_RATIO ** Math.min(depth, 6)) / camera.scale
    if (link.extra) ctx.setLineDash([4 / camera.scale, 3 / camera.scale])
    else ctx.setLineDash([])
    ctx.stroke()
  }
  ctx.setLineDash([])
  ctx.globalAlpha = 1

  for (const node of sim.nodes) {
    const t = appearOf(node, now)
    if (t <= 0) continue
    const pop = t >= 1 ? 1 : easeOutBack(t)
    const fade = t >= 1 ? 1 : easeOutCubic(Math.min(1, t / 0.55))
    const active = !near || near.has(node.id)
    const selected = node.name === props.selectedName
    const color = nodeColor(node, wallNow, kids)
    const radius = node.r * pop
    ctx.globalAlpha = fade
    if (selected && active) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, radius + 3.6 / camera.scale, 0, Math.PI * 2)
      ctx.fillStyle = color.fill
      ctx.globalAlpha = fade * 0.28
      ctx.fill()
      ctx.globalAlpha = fade
    }
    ctx.beginPath()
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2)
    ctx.fillStyle = active ? color.fill : graphChrome.nodeDim
    ctx.fill()
    ctx.lineWidth = Math.max(0.75, 1.2 / camera.scale)
    ctx.strokeStyle = active ? color.stroke : graphChrome.strokeDim
    ctx.stroke()
    const font = fontForDepth(node.depth, camera.scale)
    const size = font * camera.scale
    if (size >= 4.2 && fade > 0.35) {
      const max = labelLimitForDepth(node.depth)
      labels.push({
        x: node.x * camera.scale + camera.x,
        y: (node.y + radius + Math.max(2, radius * 0.45)) * camera.scale + camera.y,
        size,
        text: node.name.length > max ? `${node.name.slice(0, max)}…` : node.name,
        dim: !active,
        alpha: fade,
      })
    }
  }
  ctx.globalAlpha = 1
  ctx.restore()

  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  for (const item of labels) {
    ctx.globalAlpha = item.alpha
    ctx.font = `${item.size}px ui-sans-serif, system-ui, -apple-system, "PingFang SC", sans-serif`
    ctx.fillStyle = item.dim ? graphChrome.labelDim : graphChrome.label
    ctx.fillText(item.text, item.x, item.y)
  }
  ctx.globalAlpha = 1
}

const tick = () => {
  raf = 0
  const now = performance.now()
  const moving = stepCamera(now)
  const popping = sim.nodes.some((node) => node.bornAt && now < node.bornAt + POP_MS)
  if (props.streaming || alpha > 0.02 || popping) {
    stepForceGraph(
      sim,
      wrapRef.value?.clientWidth || 800,
      wrapRef.value?.clientHeight || 560,
      props.streaming ? Math.max(alpha, 0.45) : alpha,
      props.streaming,
    )
    if (!props.streaming) alpha *= 0.96
    running = true
  } else {
    running = false
  }
  draw()
  if (running || dragging.value || panning.value || moving || popping) {
    raf = requestAnimationFrame(tick)
  }
}

const kick = (heat = 0.9) => {
  alpha = Math.max(alpha, heat)
  if (!raf) raf = requestAnimationFrame(tick)
}

const rebuild = () => {
  const wrap = wrapRef.value
  if (!viewGraph.value || !wrap || wrap.clientWidth < 40 || wrap.clientHeight < 40) {
    if (!viewGraph.value) {
      sim = { nodes: [], links: [] }
      bodies.clear()
      layoutW = 0
      layoutH = 0
      draw()
    }
    return false
  }
  const first = framedGraphId !== viewGraph.value.id
  const width = wrap.clientWidth
  const height = wrap.clientHeight
  sim = syncForceGraph(
    viewGraph.value,
    bodies,
    width,
    height,
    props.streaming,
    layoutW > 40 && layoutH > 40 ? { width: layoutW, height: layoutH } : undefined,
  )
  layoutW = width
  layoutH = height
  bodies.clear()
  for (const node of sim.nodes) bodies.set(node.id, node)
  if (first) {
    userPanned = false
    settleView()
  }
  if (props.streaming) kick(0.7)
  else if (!raf) raf = requestAnimationFrame(tick)
  else draw()
  return first
}

const onPointerDown = (event: PointerEvent) => {
  if (event.button !== 0) return
  pointerId = event.pointerId
  lastX = event.clientX
  lastY = event.clientY
  dragMoved = false
  const hit = hitNode(worldPoint(event.clientX, event.clientY).x, worldPoint(event.clientX, event.clientY).y)
  if (hit) {
    dragId = hit.id
    hit.pinned = true
    dragging.value = true
  }
  wrapRef.value?.setPointerCapture(event.pointerId)
}

const onPointerMove = (event: PointerEvent) => {
  if (pointerId !== event.pointerId) {
    const point = worldPoint(event.clientX, event.clientY)
    const hit = hitNode(point.x, point.y)
    const next = hit?.id || ''
    if (next !== hoverId) {
      hoverId = next
      draw()
    }
    return
  }
  const dx = event.clientX - lastX
  const dy = event.clientY - lastY
  if (!dragMoved && Math.hypot(dx, dy) < 3) return
  dragMoved = true
  lastX = event.clientX
  lastY = event.clientY
  if (dragId) {
    const node = bodies.get(dragId)
    const point = worldPoint(event.clientX, event.clientY)
    if (node) {
      node.x = point.x
      node.y = point.y
      node.vx = 0
      node.vy = 0
    }
    kick(0.55)
    return
  }
  panning.value = true
  userPanned = true
  stopCamera()
  camera.x += dx
  camera.y += dy
  if (!raf) raf = requestAnimationFrame(tick)
}

const onPointerUp = (event: PointerEvent) => {
  if (pointerId !== event.pointerId) return
  const node = dragId ? bodies.get(dragId) : null
  if (node) node.pinned = false
  if (!dragMoved) {
    if (node) {
      userPanned = false
      emit('select', node.name, node.id)
      focusNode(node)
    } else {
      userPanned = false
      emit('select', '')
      if (sim.nodes.length) lookAt(sim.nodes, 0.82, true)
    }
  }
  pointerId = null
  dragId = ''
  dragging.value = false
  panning.value = false
  kick(0.9)
}

const onWheel = (event: WheelEvent) => {
  const wrap = wrapRef.value
  if (!wrap) return
  const rect = wrap.getBoundingClientRect()
  const sx = event.clientX - rect.left
  const sy = event.clientY - rect.top
  const worldX = (sx - camera.x) / camera.scale
  const worldY = (sy - camera.y) / camera.scale
  userPanned = true
  stopCamera()
  const next = Math.min(4.2, Math.max(0.25, camera.scale * (event.deltaY > 0 ? 0.92 : 1.08)))
  camera.scale = next
  camera.x = sx - worldX * next
  camera.y = sy - worldY * next
  draw()
}

watch(viewGraph, rebuild, { deep: true })

watch(() => viewGraph.value?.id, (id, prev) => {
  userPanned = false
  framedGraphId = ''
  if (!id || id === prev) return
  void nextTick(() => {
    if (viewGraph.value?.id !== id) return
    if (sim.nodes.length) settleView()
    else rebuild()
  })
})

watch(
  () => props.selectedName,
  async (name, prev) => {
    if (name === prev) return
    if (prev == null && !String(name || '').trim()) return
    await nextTick()
    if (String(name || '').trim()) focusByName(name || '')
    else if (sim.nodes.length) lookAt(sim.nodes, 0.82, true)
  },
)

let themeObserver: MutationObserver | null = null

onMounted(() => {
  syncGraphChrome()
  themeObserver = new MutationObserver(() => {
    syncGraphChrome()
    draw()
  })
  themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
  clockTimer = window.setInterval(() => {
    draw()
  }, 30000)
  let lastW = 0
  let lastH = 0
  resize = new ResizeObserver(() => {
    const wrap = wrapRef.value
    const w = wrap?.clientWidth || 0
    const h = wrap?.clientHeight || 0
    if (w < 40 || h < 40) return
    if (Math.abs(w - lastW) > 2 || Math.abs(h - lastH) > 2) {
      lastW = w
      lastH = h
      const first = rebuild()
      if (first || userPanned || camT < 1) return
      if (resizeFrameTimer) window.clearTimeout(resizeFrameTimer)
      resizeFrameTimer = window.setTimeout(() => {
        resizeFrameTimer = 0
        if (!userPanned && camT >= 1) frameView(true)
      }, 140)
      return
    }
    draw()
  })
  if (wrapRef.value) resize.observe(wrapRef.value)
  onDisplayChange = () => draw()
  window.addEventListener('resize', onDisplayChange)
  window.visualViewport?.addEventListener('resize', onDisplayChange)
})

onBeforeUnmount(() => {
  themeObserver?.disconnect()
  themeObserver = null
  resize?.disconnect()
  if (onDisplayChange) {
    window.removeEventListener('resize', onDisplayChange)
    window.visualViewport?.removeEventListener('resize', onDisplayChange)
    onDisplayChange = null
  }
  if (clockTimer != null) window.clearInterval(clockTimer)
  if (resizeFrameTimer) window.clearTimeout(resizeFrameTimer)
  if (raf) cancelAnimationFrame(raf)
})
</script>

<style scoped>
.study-mermaid {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  cursor: grab;
  touch-action: none;
  background:
    radial-gradient(circle at 50% 46%, color-mix(in srgb, #2F6F78 14%, transparent), transparent 42%),
    var(--bg-secondary, #fff);
}

.study-mermaid.is-panning,
.study-mermaid.is-dragging {
  cursor: grabbing;
}

.study-net {
  position: relative;
  z-index: 0;
  width: 100%;
  height: 100%;
  display: block;
}

.study-mermaid-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #718096);
  font-size: 13px;
}

.study-mermaid-live {
  position: absolute;
  top: 12px;
  left: 16px;
  font-size: 11px;
  color: var(--color-primary, #2563eb);
  animation: study-mermaid-pulse 1.2s ease-in-out infinite;
}

@keyframes study-mermaid-pulse {
  50% { opacity: 0.45; }
}

[data-theme="dark"] .study-mermaid {
  background:
    radial-gradient(circle at 50% 46%, color-mix(in srgb, #5e9aa3 16%, transparent), transparent 46%),
    var(--bg-secondary, #2c2c2e);
}
</style>
