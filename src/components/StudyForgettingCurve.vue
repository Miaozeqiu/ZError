<template>
  <div class="curve-panel">
    <canvas ref="canvasRef" class="curve-canvas" />
    <div class="curve-axis">
      <span
        v-for="item in stages"
        :key="item.stage"
        class="curve-tick"
        :class="{ 'is-now': view.retention != null && item.stage === view.stage }"
        :style="{ left: `${(item.stage / stages.length) * 100}%` }"
      >{{ item.short }}</span>
    </div>
    <div class="curve-caption">
      <strong>{{ view.bandLabel }}</strong>
      <span>{{ caption }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  FORGETTING_STAGES,
  forgettingCurveView,
  formatForgettingDays,
  type RetentionTreeNode,
} from '../utils/studyForgetting'

const props = defineProps<{
  node: RetentionTreeNode
}>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const view = computed(() => forgettingCurveView(props.node))
const stages = FORGETTING_STAGES

const progress = computed(() => {
  const strength = Math.max(0.25, view.value.strengthDays)
  return Math.max(0, view.value.days) / strength
})

const caption = computed(() => {
  const item = view.value
  if (item.retention == null) {
    return item.fromChildren ? '子节点都还没复习' : '从刚学开始，每次复习后曲线会再抬起、下降变慢'
  }
  const where = `${item.stageLabel} · ${Math.round(item.retention * 100)}% · ${formatForgettingDays(item.days)}`
  if (item.fromChildren) return `由 ${item.leafCount} 个子节点汇总 · ${where}`
  return `当前在第 ${item.stage + 1} 段 · ${where}`
})

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
  const colW = innerW / stages.length
  const xAt = (stage: number, u: number) => pad.l + (stage + Math.max(0, Math.min(1, u))) * colW
  const yOf = (retention: number) => pad.t + (1 - Math.max(0, Math.min(1, retention))) * innerH

  ctx.fillStyle = 'rgba(47, 111, 120, 0.12)'
  ctx.fillRect(pad.l, yOf(1), innerW, yOf(0.8) - yOf(1))
  ctx.fillStyle = 'rgba(94, 154, 163, 0.10)'
  ctx.fillRect(pad.l, yOf(0.8), innerW, yOf(0.4) - yOf(0.8))
  ctx.fillStyle = 'rgba(183, 212, 216, 0.16)'
  ctx.fillRect(pad.l, yOf(0.4), innerW, yOf(0) - yOf(0.4))

  const current = view.value
  ctx.strokeStyle = 'rgba(47, 111, 120, 0.18)'
  ctx.lineWidth = 1
  ctx.setLineDash([])
  for (let stage = 0; stage < stages.length; stage++) {
    const x = xAt(stage, 0)
    ctx.beginPath()
    ctx.moveTo(x, yOf(0))
    ctx.lineTo(x, yOf(0) + 4)
    ctx.stroke()
  }

  const trace = (toStage: number, toU: number) => {
    const endStage = Math.max(0, Math.min(stages.length - 1, toStage))
    const endU = Math.max(0.02, Math.min(1, toU))
    ctx.beginPath()
    let started = false
    const move = (x: number, y: number) => {
      if (!started) {
        ctx.moveTo(x, y)
        started = true
      } else {
        ctx.lineTo(x, y)
      }
    }
    for (let stage = 0; stage <= endStage; stage++) {
      const last = stage === endStage
      const stop = last ? endU : 1
      const steps = Math.max(8, Math.round(stop * 12))
      for (let i = 0; i <= steps; i++) {
        const u = (stop * i) / steps
        move(xAt(stage, u), yOf(Math.exp(-u)))
      }
      if (!last) move(xAt(stage + 1, 0), yOf(1))
    }
  }

  ctx.lineJoin = 'round'
  ctx.lineCap = 'round'
  ctx.strokeStyle = 'rgba(47, 111, 120, 0.35)'
  ctx.lineWidth = 1.4
  ctx.setLineDash([3, 3])
  trace(stages.length - 1, 1)
  ctx.stroke()

  if (current.retention != null) {
    ctx.setLineDash([])
    ctx.strokeStyle = '#2F6F78'
    ctx.lineWidth = 2
    trace(current.stage, progress.value)
    ctx.stroke()

    const mx = xAt(current.stage, Math.min(1, progress.value))
    const my = yOf(current.retention)
    ctx.beginPath()
    ctx.arc(mx, my, 4, 0, Math.PI * 2)
    ctx.fillStyle = '#fff'
    ctx.fill()
    ctx.beginPath()
    ctx.arc(mx, my, 3.1, 0, Math.PI * 2)
    ctx.fillStyle = '#2F6F78'
    ctx.fill()
  }
}

watch(() => [props.node, view.value.retention, view.value.stage, view.value.days], draw, { deep: true })

let resize: ResizeObserver | null = null
onMounted(() => {
  draw()
  resize = new ResizeObserver(() => draw())
  if (canvasRef.value) resize.observe(canvasRef.value)
})
onUnmounted(() => resize?.disconnect())
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

.curve-caption {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-top: 8px;
}

.curve-caption strong {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
}

.curve-caption span {
  font-size: 11px;
  line-height: 1.4;
  color: var(--text-secondary, #718096);
}
</style>
