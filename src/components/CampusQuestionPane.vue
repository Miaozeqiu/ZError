<template>
  <div class="question-pane">
    <div class="switcher">
      <button
        class="switcher-btn"
        type="button"
        :disabled="!canPrev"
        @click="$emit('prev')"
      >上一题</button>
      <div
        class="switcher-index"
        :class="{ 'is-editing': editing, 'is-dragging': dragging }"
        title="按住左右拖动切换，点击输入题号"
        @selectstart.prevent
        @pointerdown="onIndexPointerDown"
        @pointermove="onIndexPointerMove"
        @pointerup="onIndexPointerUp"
        @pointercancel="onIndexPointerCancel"
      >
        <template v-if="editing">
          <input
            ref="indexInput"
            class="switcher-input"
            :style="{ width: `${inputWidth}ch` }"
            :value="draft"
            inputmode="numeric"
            @pointerdown.stop
            @input="onDraftInput"
            @keydown.enter.prevent="commitEdit"
            @keydown.escape.prevent="cancelEdit"
            @blur="commitEdit"
          />
          <span class="switcher-total"> / {{ total }}</span>
        </template>
        <span v-else class="switcher-count">
          <svg class="switcher-blur-def" aria-hidden="true">
            <filter
              v-for="(col, i) in digitCols"
              :id="`campus-switcher-blur-${i}`"
              :key="i"
              x="-40%"
              y="-140%"
              width="180%"
              height="380%"
              color-interpolation-filters="sRGB"
            >
              <feGaussianBlur :stdDeviation="`0 ${col.blur}`" />
            </filter>
          </svg>
          <span class="switcher-num" :style="{ minWidth: `${inputWidth}ch` }">
            <span
              v-for="(col, i) in digitCols"
              :key="i"
              class="digit-col"
              :style="{ filter: col.blur > 0 ? `url(#campus-switcher-blur-${i})` : undefined }"
            >
              <span
                class="digit-reel"
                :style="{ transform: `translate3d(0, ${-col.visual * 1.2}em, 0)` }"
              >
                <span
                  v-for="slot in slotsFor(col)"
                  :key="slot.y"
                  class="switcher-reel-item"
                  :style="{ transform: `translateY(${slot.y * 1.2}em)` }"
                >{{ slot.ch }}</span>
              </span>
            </span>
          </span>
          <span class="switcher-total"> / {{ total }}</span>
        </span>
      </div>
      <button
        class="switcher-btn"
        type="button"
        :disabled="!canNext"
        @click="$emit('next')"
      >下一题</button>
    </div>

    <div v-if="!question" class="detail-empty">这套试卷还没有题目</div>
    <div v-else class="question-detail">
      <div class="detail-kicker">{{ campusQuestionTypeLabel(question.type) }}</div>
      <div class="detail-content">{{ question.content }}</div>
      <div v-if="options.length" class="detail-options">
        <div v-for="item in options" :key="`${question.id}-${item.key}`" class="detail-option">
          <span class="detail-option-key">{{ item.key }}</span>
          <span>{{ item.text }}</span>
        </div>
      </div>
      <button class="reveal-btn" type="button" @click="showAnswer = !showAnswer">
        {{ showAnswer ? '隐藏答案' : '显示答案' }}
      </button>
      <div v-if="showAnswer" class="detail-answer">
        {{ question.answer || '暂无答案（未认证时可能被隐藏）' }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, triggerRef, watch } from 'vue'
import { campusOptionRows, campusQuestionTypeLabel, type CampusQuestion } from '../services/campus'

const props = defineProps<{
  question: CampusQuestion | null
  index: number
  total: number
}>()

const emit = defineEmits<{
  prev: []
  next: []
  goto: [index: number]
}>()

const showAnswer = ref(true)
const editing = ref(false)
const dragging = ref(false)
const draft = ref('')
const indexInput = ref<HTMLInputElement | null>(null)
const options = computed(() => campusOptionRows(props.question?.options))
const canPrev = computed(() => props.index > 0)
const canNext = computed(() => props.total > 0 && props.index < props.total - 1)
const BLANK = -1
const SPRING_RESPONSE = 0.36

type DigitCol = {
  settled: number
  visual: number
  vel: number
  target: number
  blur: number
  allowBlank: boolean
}

const inputWidth = computed(() => Math.max(2, String(props.total || 0).length))
const digitCols = ref<DigitCol[]>([])
let lastAnimatedIndex = props.index
let springRaf = 0
let springZeta = 1
let springLastTs = 0

const displayNumber = (index: number) => (props.total ? index + 1 : 0)

const digitsOf = (value: number, width: number) => {
  const padded = String(Math.max(0, value)).padStart(width, '0')
  let seen = false
  return [...padded].map((ch, i) => {
    const digit = Number(ch)
    if (i === width - 1) return digit
    if (!seen && digit === 0) return BLANK
    seen = true
    return digit
  })
}

const glyphAt = (y: number, allowBlank: boolean) => {
  if (allowBlank && y < 1) return ''
  return String(((Math.round(y) % 10) + 10) % 10)
}

const parkedPos = (digit: number) => (digit === BLANK ? 0 : digit)

const digitFromTarget = (target: number, allowBlank: boolean) => {
  if (allowBlank && target < 0.5) return BLANK
  return ((Math.round(target) % 10) + 10) % 10
}

const isSettled = (col: DigitCol) => (
  Math.abs(col.visual - col.target) < 0.02
  && Math.abs(col.vel) < 0.08
)

const slotsFor = (col: DigitCol) => {
  if (isSettled(col) && col.visual >= -0.02 && col.visual <= 9.02) {
    const y = parkedPos(col.settled)
    return [{ y, ch: glyphAt(y, col.allowBlank) }]
  }
  const start = Math.floor(col.visual) - 1
  const end = Math.ceil(col.visual) + 1
  const slots: { y: number; ch: string }[] = []
  for (let y = start; y <= end; y += 1) {
    slots.push({ y, ch: glyphAt(y, col.allowBlank) })
  }
  return slots
}

const blurFromVelocity = (velocity: number) => {
  const next = Math.min(4.2, Math.abs(velocity) * 0.4)
  return next < 0.14 ? 0 : next
}

const destFromSettled = (from: number, to: number, dir: 1 | -1, allowBlank: boolean) => {
  if (from === to) return parkedPos(to)
  if (allowBlank) return parkedPos(to)
  const fromPos = parkedPos(from)
  if (dir >= 0) {
    const steps = (to - fromPos + 10) % 10
    return fromPos + (steps === 0 ? 10 : steps)
  }
  const steps = (fromPos - to + 10) % 10
  return fromPos - (steps === 0 ? 10 : steps)
}

const parkCol = (col: DigitCol, digit: number) => {
  const parked = parkedPos(digit)
  col.settled = digit
  col.visual = parked
  col.target = parked
  col.vel = 0
  col.blur = 0
  col.allowBlank = digit === BLANK
}

const makeCol = (digit: number): DigitCol => ({
  settled: digit,
  visual: parkedPos(digit),
  vel: 0,
  target: parkedPos(digit),
  blur: 0,
  allowBlank: digit === BLANK,
})

const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

const clampIndex = (index: number) => {
  if (!props.total) return 0
  return Math.max(0, Math.min(props.total - 1, index))
}

const jumpTo = (index: number) => {
  if (!props.total) return
  const next = Math.round(clampIndex(index))
  if (next === props.index) return
  emit('goto', next)
}

const project = (velocity: number, decelerationRate = 0.992) =>
  (velocity / 1000) * decelerationRate / (1 - decelerationRate)

const DRAG_STEP = 22
const DRAG_THRESHOLD = 6
let armed = false
let startX = 0
let startIndex = 0
let lastDragIndex = 0
let pointerId = 0
let programmedTarget: number | null = null
const pointerSamples: { t: number; x: number }[] = []

const stopSpring = () => {
  if (springRaf) cancelAnimationFrame(springRaf)
  springRaf = 0
  springLastTs = 0
}

const snapToIndex = (index: number) => {
  stopSpring()
  lastAnimatedIndex = index
  digitCols.value = digitsOf(displayNumber(index), inputWidth.value).map(makeCol)
}

const stepDigits = (ts: number) => {
  if (!springLastTs) springLastTs = ts
  const dt = Math.min(0.032, (ts - springLastTs) / 1000)
  springLastTs = ts
  const omega = (2 * Math.PI) / SPRING_RESPONSE
  let alive = false
  for (const col of digitCols.value) {
    if (isSettled(col)) {
      parkCol(col, digitFromTarget(col.target, col.allowBlank))
      continue
    }
    alive = true
    const acc = -omega * omega * (col.visual - col.target) - 2 * springZeta * omega * col.vel
    col.vel += acc * dt
    col.visual += col.vel * dt
    col.blur = blurFromVelocity(col.vel)
  }
  triggerRef(digitCols)
  if (alive) springRaf = requestAnimationFrame(stepDigits)
  else springRaf = 0
}

const animateDigits = (targetIndex: number, velocity: number, bounce: boolean) => {
  programmedTarget = targetIndex
  if (prefersReducedMotion()) {
    snapToIndex(targetIndex)
    return
  }
  const width = inputWidth.value
  const nextDigits = digitsOf(displayNumber(targetIndex), width)
  if (digitCols.value.length !== width) snapToIndex(lastAnimatedIndex)
  const dir: 1 | -1 = targetIndex >= lastAnimatedIndex ? 1 : -1
  lastAnimatedIndex = targetIndex
  springZeta = bounce ? 0.84 : 1
  nextDigits.forEach((digit, i) => {
    const col = digitCols.value[i] ?? makeCol(digit)
    if (!digitCols.value[i]) digitCols.value[i] = col
    const from = col.settled
    const allowBlank = digit === BLANK || from === BLANK
    if (from === digit) {
      col.target = parkedPos(digit)
      col.allowBlank = digit === BLANK
      if (isSettled(col)) parkCol(col, digit)
      return
    }
    col.allowBlank = allowBlank
    col.target = destFromSettled(from, digit, dir, allowBlank)
    col.vel = i === width - 1 ? velocity : 0
  })
  triggerRef(digitCols)
  if (!springRaf) {
    springLastTs = 0
    springRaf = requestAnimationFrame(stepDigits)
  }
}

snapToIndex(props.index)

watch(() => [props.index, props.total] as const, ([next]) => {
  if (digitCols.value.length !== inputWidth.value) {
    snapToIndex(next)
    return
  }
  if (dragging.value) return
  if (programmedTarget === next) {
    programmedTarget = null
    return
  }
  animateDigits(next, 0, false)
})

const recordPointer = (x: number) => {
  const t = performance.now()
  pointerSamples.push({ t, x })
  while (pointerSamples.length > 6) pointerSamples.shift()
}

const pointerVelocity = () => {
  const now = performance.now()
  const recent = pointerSamples.filter((sample) => now - sample.t < 90)
  if (recent.length < 2) return 0
  const first = recent[0]
  const last = recent[recent.length - 1]
  const dt = last.t - first.t
  if (dt <= 0) return 0
  return ((last.x - first.x) / dt) * 1000
}

const applyDragStep = (dx: number) => {
  const next = Math.round(clampIndex(startIndex + dx / DRAG_STEP))
  if (next === lastDragIndex) return
  lastDragIndex = next
  jumpTo(next)
  animateDigits(next, 0, false)
}

const onIndexPointerDown = (event: PointerEvent) => {
  if (editing.value || event.button !== 0 || props.total <= 0) return
  event.preventDefault()
  snapToIndex(props.index)
  programmedTarget = null
  armed = true
  dragging.value = false
  startX = event.clientX
  startIndex = props.index
  lastDragIndex = props.index
  pointerId = event.pointerId
  pointerSamples.length = 0
  recordPointer(event.clientX)
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}

const onIndexPointerMove = (event: PointerEvent) => {
  if (!armed || event.pointerId !== pointerId || editing.value) return
  const dx = event.clientX - startX
  if (!dragging.value && Math.abs(dx) < DRAG_THRESHOLD) return
  dragging.value = true
  recordPointer(event.clientX)
  applyDragStep(dx)
}

const endIndexGesture = () => {
  armed = false
  dragging.value = false
  pointerSamples.length = 0
}

const settleFromGesture = () => {
  const velocity = pointerVelocity() / DRAG_STEP
  const projected = props.index + project(velocity)
  const target = Math.round(clampIndex(projected))
  jumpTo(target)
  animateDigits(target, velocity, Math.abs(velocity) > 1.8)
}

const beginEdit = async () => {
  if (!props.total) return
  editing.value = true
  draft.value = String(props.index + 1)
  await nextTick()
  indexInput.value?.focus()
  indexInput.value?.select()
}

const onIndexPointerUp = (event: PointerEvent) => {
  if (!armed || event.pointerId !== pointerId) return
  const wasDrag = dragging.value
  if (wasDrag) settleFromGesture()
  endIndexGesture()
  if (!wasDrag) void beginEdit()
}

const onIndexPointerCancel = (event: PointerEvent) => {
  if (!armed || event.pointerId !== pointerId) return
  if (dragging.value) settleFromGesture()
  endIndexGesture()
}

onUnmounted(stopSpring)

const onDraftInput = (event: Event) => {
  draft.value = (event.target as HTMLInputElement).value.replace(/\D/g, '')
}

const commitEdit = () => {
  if (!editing.value) return
  const raw = draft.value.trim()
  editing.value = false
  if (!raw) return
  const next = Number(raw)
  if (!Number.isFinite(next)) return
  jumpTo(next - 1)
}

const cancelEdit = () => {
  editing.value = false
}
</script>

<style scoped>
.question-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.switcher {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 16px 0;
  flex-shrink: 0;
  user-select: none;
  -webkit-user-select: none;
}

.switcher-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}

.switcher-btn:hover:not(:disabled) {
  color: var(--text-primary, #2d3748);
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.switcher-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.switcher-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.switcher-index {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 64px;
  min-height: 22px;
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #718096);
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
  cursor: ew-resize;
}

.switcher-index::selection,
.switcher-index *::selection {
  background: transparent;
}

.switcher-index:hover {
  color: var(--text-primary, #2d3748);
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.switcher-index.is-dragging {
  color: var(--text-primary, #2d3748);
  background: var(--hover-bg, rgba(0, 0, 0, 0.06));
  cursor: ew-resize;
}

.switcher-index.is-editing {
  cursor: text;
  background: var(--form-input-bg, #F7F7F7);
}

.switcher-input {
  box-sizing: content-box;
  min-width: 1.2em;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  font-variant-numeric: tabular-nums;
  text-align: right;
  outline: none;
}

.switcher-count {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.switcher-blur-def {
  position: absolute;
  width: 0;
  height: 0;
  overflow: hidden;
}

.switcher-num {
  display: inline-flex;
  justify-content: flex-end;
  overflow: hidden;
  height: 1.2em;
}

.digit-col {
  position: relative;
  width: 1ch;
  height: 1.2em;
  overflow: hidden;
}

.digit-reel {
  position: absolute;
  inset: 0;
  will-change: transform;
}

.switcher-reel-item {
  position: absolute;
  left: 0;
  right: 0;
  height: 1.2em;
  line-height: 1.2;
  text-align: right;
}

.switcher-total {
  flex-shrink: 0;
}

.question-detail,
.detail-empty {
  flex: 1;
  min-width: 0;
  padding: 12px 20px 20px;
  overflow: auto;
}

.detail-empty {
  color: var(--text-secondary, #718096);
  font-size: 13px;
}

.detail-kicker {
  font-size: 12px;
  color: var(--text-secondary, #718096);
  margin-bottom: 8px;
}

.detail-content,
.detail-option,
.detail-answer {
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
}

.detail-options {
  margin: 14px 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 5%, transparent);
}

.detail-option-key {
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: #2563eb;
  background: #edf4ff;
}

.reveal-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 0;
}

.reveal-btn:hover {
  color: var(--text-primary, #2d3748);
}

.reveal-btn:active {
  transform: scale(0.97);
}

.detail-answer {
  margin-top: 10px;
  color: #2F6F78;
}
</style>
