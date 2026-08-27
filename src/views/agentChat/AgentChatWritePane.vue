<template>
  <Transition name="write-pane">
    <aside v-if="quiz" class="write-pane is-quiz" :class="{ 'is-resizing': paneResizing }" :style="writePaneStyle">
      <div class="write-pane-resizer" title="拖动调节宽度" @pointerdown.stop="startPaneResize" />
      <div class="write-pane-inner">
        <div class="write-pane-head">
          <div class="write-file">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="9" />
              <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.25c-.7.4-1.1.9-1.1 1.75" />
              <path d="M12 17h.01" />
            </svg>
            <span class="write-file-name">{{ quiz.title }}</span>
          </div>
          <span class="write-stat">{{ quiz.stat }}</span>
          <button class="header-action" type="button" @click="emit('close-quiz')">关闭</button>
        </div>
        <div class="write-pane-body-wrap">
          <div ref="writePaneBodyRef" class="write-pane-body is-quiz-page">
            <AgentQuizBlock
              layout="pane"
              :mode="quiz.mode"
              :step-id="quiz.stepId"
              :cards="quiz.cards"
              @attempt="emit('quiz-attempt', quiz.messageId, $event)"
            />
          </div>
          <div
            class="custom-scrollbar"
            :class="{ 'is-visible': writeScroll.visible }"
            ref="writeBarRef"
            @mousedown="writeScroll.onMousedown"
          >
            <div class="custom-scrollbar-thumb" ref="writeThumbRef"></div>
          </div>
        </div>
      </div>
    </aside>
  </Transition>
  <Transition name="write-pane">
    <aside v-if="graph && !quiz && !writeStep" class="write-pane is-graph" :class="{ 'is-resizing': paneResizing }" :style="writePaneStyle">
      <div class="write-pane-resizer" title="拖动调节宽度" @pointerdown.stop="startPaneResize" />
      <div class="write-pane-inner">
        <div class="write-pane-head">
          <div class="write-file">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="6" cy="7" r="2.2" />
              <circle cx="18" cy="8" r="2.2" />
              <circle cx="8" cy="17" r="2.2" />
              <circle cx="16" cy="16" r="2.2" />
              <path d="M8 8.6 16.2 9.6M7.6 9.2 8.8 14.8M16.2 10.2 15.2 14M9.8 16.2h4" />
            </svg>
            {{ graph.name || '知识图谱' }}
          </div>
          <span class="write-stat">{{ graph.stat }}</span>
          <button class="header-action" type="button" @click="emit('close-graph')">关闭</button>
        </div>
        <div class="write-pane-body-wrap">
          <div class="write-pane-body is-graph-page">
            <StudyMermaidGraph
              :graph="graph.graph"
              :streaming="graph.streaming"
              :selected-name="graph.selectedName"
              :empty-text="graph.emptyText"
              @select="emit('graph-select', $event)"
            />
          </div>
        </div>
      </div>
    </aside>
  </Transition>
  <Transition name="write-pane">
    <aside v-if="writeStep && !quiz && !graph" class="write-pane" :class="{ 'is-resizing': paneResizing }" :style="writePaneStyle">
      <div class="write-pane-resizer" title="拖动调节宽度" @pointerdown.stop="startPaneResize" />
      <div class="write-pane-inner">
        <div class="write-pane-head">
          <div class="write-file">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
            {{ folderName }}
          </div>
          <span class="write-stat">+{{ writeStep.previewCount || writeStep.preview?.length || 0 }}</span>
          <button class="header-action" type="button" @click="emit('close-write')">关闭</button>
        </div>
        <div class="write-pane-body-wrap">
          <div ref="writePaneBodyRef" class="write-pane-body">
            <div
              v-for="(item, index) in writeStep.preview || []"
              :key="`${writeStep.id}-full-${index}`"
              class="write-item"
            >
              <span class="write-gutter">+</span>
              <div class="write-question">
                <div class="write-q-top">
                  <span class="write-index">{{ index + 1 }}</span>
                  <span
                    v-if="item.question_type"
                    class="write-type"
                    :class="`is-${typeTagKind(item.question_type)}`"
                  >
                    {{ item.question_type }}
                  </span>
                </div>
                <div class="write-stem">{{ item.question }}</div>
                <div v-if="parseOptions(item.options).length" class="write-options">
                  <div
                    v-for="option in parseOptions(item.options)"
                    :key="`${writeStep.id}-full-${index}-${option.key}-${option.text}`"
                    class="write-option"
                  >
                    <span v-if="option.key" class="write-opt-key">{{ option.key }}</span>
                    <span class="write-opt-text">{{ option.text }}</span>
                  </div>
                </div>
                <div v-if="item.answer" class="write-answer">
                  <span class="write-answer-label">答案</span>
                  <span class="write-answer-text">{{ item.answer }}</span>
                </div>
              </div>
            </div>
          </div>
          <div
            class="custom-scrollbar"
            :class="{ 'is-visible': writeScroll.visible }"
            ref="writeBarRef"
            @mousedown="writeScroll.onMousedown"
          >
            <div class="custom-scrollbar-thumb" ref="writeThumbRef"></div>
          </div>
        </div>
      </div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import AgentQuizBlock from '../../components/AgentQuizBlock.vue'
import StudyMermaidGraph from '../../components/StudyMermaidGraph.vue'
import { useCustomScrollbar } from '../../composables/useCustomScrollbar'
import type { AgentQuizAttempt } from '../../services/agent/chat'
import type { ImportTaskStep } from '../../services/app/importTasks'
import { parseOptions, type QuizCard } from '../../utils/quizPractice'
import type { StudyGraphNode } from '../../utils/studyGraph'

export type AgentChatPaneQuiz = {
  messageId: string
  stepId: string
  cards: QuizCard[]
  title: string
  mode: 'browse' | 'practice'
  stat: string
}

export type AgentChatPaneGraph = {
  name: string
  stat: string
  graph: StudyGraphNode | null
  streaming: boolean
  selectedName: string
  emptyText: string
}

const props = defineProps<{
  quiz?: AgentChatPaneQuiz | null
  writeStep?: ImportTaskStep | null
  graph?: AgentChatPaneGraph | null
  folderName: string
}>()

const emit = defineEmits<{
  'close-quiz': []
  'close-write': []
  'close-graph': []
  'quiz-attempt': [messageId: string, attempt: AgentQuizAttempt]
  'graph-select': [name: string]
  'width-change': []
}>()

const writeScroll = useCustomScrollbar()
const writePaneBodyRef = writeScroll.contentRef
const writeBarRef = writeScroll.barRef
const writeThumbRef = writeScroll.thumbRef

const typeTagKind = (type?: string) => {
  const text = String(type || '').replace(/\s/g, '')
  if (/多选|多项|不定项/.test(text)) return 'multiple'
  if (/判断/.test(text)) return 'judgement'
  if (/填空|简答|解答/.test(text)) return 'fill'
  if (/单选|单项/.test(text)) return 'single'
  return 'other'
}

const PANE_WIDTH_KEY = 'zerror-agent-pane-width'
const PANE_WIDTH_MIN = 280
const readStoredPaneWidth = () => {
  const n = Number(localStorage.getItem(PANE_WIDTH_KEY))
  return Number.isFinite(n) && n >= PANE_WIDTH_MIN ? Math.round(n) : null
}
const paneWidth = ref<number | null>(readStoredPaneWidth())
const paneResizing = ref(false)
let stopPaneResize: (() => void) | null = null

const writePaneStyle = computed(() =>
  paneWidth.value == null
    ? undefined
    : {
        width: `${paneWidth.value}px`,
        '--write-pane-width': `${paneWidth.value}px`,
      },
)

const clampPaneWidth = (width: number) => {
  const workspace = document.querySelector('.chat-workspace') as HTMLElement | null
  const max = Math.max(PANE_WIDTH_MIN, Math.round((workspace?.clientWidth || window.innerWidth) * 0.72))
  return Math.max(PANE_WIDTH_MIN, Math.min(max, Math.round(width)))
}

const startPaneResize = (event: PointerEvent) => {
  if (event.button !== 0) return
  event.preventDefault()
  const pane = (event.currentTarget as HTMLElement).closest('.write-pane') as HTMLElement | null
  const startX = event.clientX
  const startW = pane?.getBoundingClientRect().width || paneWidth.value || 420
  paneResizing.value = true
  const prevCursor = document.body.style.cursor
  const prevSelect = document.body.style.userSelect
  document.body.style.cursor = 'ew-resize'
  document.body.style.userSelect = 'none'
  const onMove = (next: PointerEvent) => {
    paneWidth.value = clampPaneWidth(startW + (startX - next.clientX))
  }
  const onUp = () => {
    stopPaneResize?.()
  }
  stopPaneResize = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onUp)
    document.body.style.cursor = prevCursor
    document.body.style.userSelect = prevSelect
    paneResizing.value = false
    stopPaneResize = null
    if (paneWidth.value != null) localStorage.setItem(PANE_WIDTH_KEY, String(paneWidth.value))
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

watch([() => props.writeStep, () => props.quiz], async ([write, quiz]) => {
  await nextTick()
  if (write || quiz) writeScroll.bind()
})

watch(paneWidth, () => emit('width-change'))

onUnmounted(() => {
  stopPaneResize?.()
})
</script>

<style scoped>
.header-action {
  border: none;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}

.header-action:hover {
  color: var(--text-primary, #2d3748);
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.write-pane-body-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.write-pane-body {
  position: absolute;
  inset: 0;
  overflow: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
  min-height: 0;
}

.write-pane-body::-webkit-scrollbar,
.write-pane-body::-webkit-scrollbar-button {
  display: none;
}

.custom-scrollbar {
  position: absolute;
  right: 3px;
  top: 4px;
  bottom: 4px;
  width: 4px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.2s;
  cursor: pointer;
  pointer-events: none;
  z-index: 2;
}

.custom-scrollbar.is-visible {
  opacity: 1;
  pointer-events: auto;
}

.custom-scrollbar-thumb {
  width: 4px;
  border-radius: 4px;
  background: var(--custom-scrollbar-thumb);
  transition: background 0.15s;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}

.custom-scrollbar-thumb:hover,
.custom-scrollbar:hover .custom-scrollbar-thumb {
  background: var(--custom-scrollbar-thumb-hover);
}

.write-pane {
  --write-pane-width: 380px;
  position: relative;
  width: var(--write-pane-width);
  flex-shrink: 0;
  overflow: hidden;
  min-height: 0;
  display: flex;
}

.write-pane-resizer {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 8px;
  z-index: 4;
  cursor: ew-resize;
  touch-action: none;
}

.write-pane-resizer::after {
  content: '';
  position: absolute;
  left: 0;
  top: 0;
  bottom: 0;
  width: 1px;
  background: transparent;
  transition: background 140ms ease, width 140ms ease;
}

.write-pane-resizer:hover::after,
.write-pane.is-resizing .write-pane-resizer::after {
  width: 2px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 28%, transparent);
}

.write-pane.is-quiz {
  --write-pane-width: 420px;
}

.write-pane.is-graph {
  --write-pane-width: min(560px, 46vw);
}

.write-pane.is-graph .write-stat {
  color: var(--color-primary, #2563eb);
}

.write-pane.is-quiz .write-stat {
  color: var(--color-primary, #2563eb);
}

.write-pane-inner {
  width: var(--write-pane-width, 100%);
  min-width: var(--write-pane-width, 100%);
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary, #fff);
  border-left: 1px solid var(--border-color, var(--border-primary, #e2e8f0));
}

.write-pane-head {
  height: 36px;
  min-height: 36px;
  padding: 0 10px 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--border-primary, #e2e8f0) 42%, transparent);
}

.write-pane-head .write-file {
  flex: 1;
}

.write-pane-body.is-quiz-page {
  display: flex;
  overflow: hidden;
}

.write-pane-body.is-graph-page {
  display: flex;
  overflow: hidden;
  padding: 0;
}

.write-pane-enter-active,
.write-pane-leave-active {
  transition: width 280ms cubic-bezier(0.32, 0.72, 0, 1);
}

.write-pane-enter-active .write-pane-inner,
.write-pane-leave-active .write-pane-inner {
  transition:
    opacity 200ms ease,
    transform 280ms cubic-bezier(0.32, 0.72, 0, 1);
}

.write-pane-enter-from,
.write-pane-leave-to {
  width: 0 !important;
}

.write-pane-enter-from .write-pane-inner,
.write-pane-leave-to .write-pane-inner {
  opacity: 0;
  transform: translateX(18px);
}

.write-file {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-primary, #2d3748);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.write-file svg {
  flex-shrink: 0;
}

.write-file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.write-stat {
  flex-shrink: 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--color-success, #16a34a);
}

.write-item {
  display: flex;
  align-items: flex-start;
  padding: 8px 10px 8px 0;
  background: rgba(22, 163, 74, 0.06);
  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--border-primary, #e2e8f0) 45%, transparent);
}

.write-item:last-of-type {
  box-shadow: none;
}

.write-gutter {
  flex-shrink: 0;
  width: 22px;
  padding-top: 2px;
  text-align: center;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-success, #16a34a);
}

.write-question {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.write-q-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.write-index {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #718096);
}

.write-type {
  font-size: 10px;
  font-weight: 600;
  line-height: 1.2;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--ql-type-tag-bg, #eef2f7);
  color: var(--ql-type-tag-text, #64748b);
}

.write-type.is-single {
  background: var(--ql-type-tag-single-bg, #edf4ff);
  color: var(--ql-type-tag-single-text, #2563eb);
}

.write-type.is-multiple {
  background: var(--ql-type-tag-multiple-bg, #f3e8ff);
  color: var(--ql-type-tag-multiple-text, #7c3aed);
}

.write-type.is-judgement {
  background: var(--ql-type-tag-judgement-bg, #fff7ed);
  color: var(--ql-type-tag-judgement-text, #c2410c);
}

.write-type.is-fill {
  background: var(--ql-type-tag-fill-bg, #ecfdf5);
  color: var(--ql-type-tag-fill-text, #047857);
}

.write-stem {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary, #2d3748);
}

.write-options {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.write-option {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  line-height: 1.45;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 82%, transparent);
}

.write-opt-key {
  flex-shrink: 0;
  min-width: 16px;
  height: 16px;
  margin-top: 1px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: var(--ql-type-tag-single-text, #2563eb);
  background: var(--ql-type-tag-single-bg, #edf4ff);
}

.write-opt-text {
  min-width: 0;
}

.write-answer {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  line-height: 1.45;
}

.write-answer-label {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  color: var(--color-success, #15803d);
  background: color-mix(in srgb, var(--color-success, #16a34a) 16%, transparent);
}

.write-answer-text {
  color: var(--color-success, #166534);
}

@media (prefers-reduced-motion: reduce) {
  .write-pane-enter-active,
  .write-pane-leave-active,
  .write-pane-enter-active .write-pane-inner,
  .write-pane-leave-active .write-pane-inner {
    transition: none;
  }
}
</style>
