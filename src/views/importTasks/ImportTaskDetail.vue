<template>
  <section class="task-detail">
    <template v-if="selectedTask">
      <div class="pane-header">
        <div class="detail-heading">
          <div class="header-title" :title="selectedTask.fileName">{{ selectedTask.fileName }}</div>
          <div class="detail-meta">
            保存到 {{ selectedTask.folderName || '未命名文件夹' }}
            <template v-if="selectedTask.importedCount > 0">
              · 已写入 {{ selectedTask.importedCount }} 道
            </template>
          </div>
        </div>
        <button
          v-if="selectedTask.status === 'done'"
          class="header-action"
          type="button"
          @click="emit('open-folder', selectedTask.folderId)"
        >
          打开文件夹
        </button>
      </div>

      <div class="activity-stage">
      <div ref="activityRef" class="activity-list">
        <TransitionGroup name="activity" tag="div" class="activity-items">
          <div
            v-for="step in visibleSteps"
            :key="step.id"
            class="activity-entry"
            :class="[`is-${step.status}`]"
          >
            <div class="activity-line" :class="[`is-${step.status}`]">
              <span class="activity-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path v-for="(d, index) in iconPaths(step.name)" :key="index" :d="d" />
                </svg>
              </span>
              <span class="activity-text" :class="{ 'is-live': step.status === 'running' }">{{ step.label }}</span>
            </div>

            <div
              v-if="step.name === 'save_questions' && step.preview?.length"
              class="write-block"
              :class="{ 'is-running': step.status === 'running', 'is-open': openedWriteStepId === step.id }"
            >
              <button class="write-head" type="button" @click="openWrite(step.id)">
                <span class="write-file">
                  <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                  </svg>
                  {{ selectedTask.folderName || '题库' }}
                </span>
                <span class="write-stat">+{{ step.preview.length }}</span>
              </button>
              <div class="write-body">
                <div
                  v-for="(item, index) in visiblePreview(step)"
                  :key="`${step.id}-${index}`"
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
                        :key="`${step.id}-${index}-${option.key}-${option.text}`"
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
                <div class="write-fade">
                  <button class="write-more" type="button" @click="openWrite(step.id)">
                    查看所有 {{ step.preview.length }} 道
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div v-if="liveLine" :key="`live-${selectedTask.id}`" class="activity-line is-running">
            <span class="activity-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path v-for="(d, index) in iconPaths('thinking')" :key="index" :d="d" />
              </svg>
            </span>
            <span class="activity-text is-live">{{ liveLine }}</span>
          </div>

          <div v-if="selectedTask.summary" :key="`summary-${selectedTask.id}`" class="activity-summary">
            <span class="activity-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path v-for="(d, index) in iconPaths('summary')" :key="index" :d="d" />
              </svg>
            </span>
            <span class="activity-text">{{ selectedTask.summary }}</span>
          </div>

          <div v-if="selectedTask.error" :key="`error-${selectedTask.id}`" class="activity-error">
            <span class="activity-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path v-for="(d, index) in iconPaths('error')" :key="index" :d="d" />
              </svg>
            </span>
            <span>{{ selectedTask.error }}</span>
          </div>
        </TransitionGroup>

        <div
          v-if="!visibleSteps.length && !liveLine && !selectedTask.summary && !selectedTask.error"
          class="activity-empty"
        >
          还没有开始查看
        </div>
      </div>

      <Transition name="write-pane">
        <aside v-if="openedWriteStep" class="write-pane">
          <div class="write-pane-inner">
            <div class="write-pane-head">
              <div class="write-file">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
                {{ selectedTask.folderName || '题库' }}
              </div>
              <span class="write-stat">+{{ openedWriteStep.preview?.length || 0 }}</span>
              <button class="header-action" type="button" @click="openedWriteStepId = null">关闭</button>
            </div>
            <div class="write-pane-body">
              <div
                v-for="(item, index) in openedWriteStep.preview || []"
                :key="`${openedWriteStep.id}-full-${index}`"
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
                      :key="`${openedWriteStep.id}-full-${index}-${option.key}-${option.text}`"
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
          </div>
        </aside>
      </Transition>
      </div>
    </template>

    <div v-else class="detail-empty">选择左侧任务查看过程</div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { ImportStepPreview, ImportTask, ImportTaskStep } from '../../services/app/importTasks'

const props = defineProps<{
  selectedTask: ImportTask | null
  visibleSteps: ImportTaskStep[]
}>()

const emit = defineEmits<{
  'open-folder': [folderId: number]
}>()

const activityRef = ref<HTMLElement | null>(null)
const openedWriteStepId = ref<string | null>(null)
const WRITE_PREVIEW_COUNT = 3

const parseOptions = (raw?: string) => {
  if (!raw?.trim()) return [] as { key: string; text: string }[]
  return raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([A-Ha-h])[\.、.\)\s]\s*(.*)$/)
      if (match) return { key: match[1].toUpperCase(), text: match[2] || '' }
      return { key: '', text: line }
    })
}

const typeTagKind = (type?: string) => {
  const text = String(type || '').replace(/\s/g, '')
  if (/多选|多项|不定项/.test(text)) return 'multiple'
  if (/判断/.test(text)) return 'judgement'
  if (/填空|简答|解答/.test(text)) return 'fill'
  if (/单选|单项/.test(text)) return 'single'
  return 'other'
}

const visiblePreview = (step: ImportTaskStep): ImportStepPreview[] => {
  const items = step.preview || []
  if (items.length <= WRITE_PREVIEW_COUNT) return items
  return items.slice(0, WRITE_PREVIEW_COUNT)
}

const openWrite = (stepId: string) => {
  openedWriteStepId.value = openedWriteStepId.value === stepId ? null : stepId
}

const isActive = (task: ImportTask) => task.status !== 'done' && task.status !== 'failed'

const openedWriteStep = computed(() =>
  props.visibleSteps.find((step) => step.id === openedWriteStepId.value) || null
)

const liveLine = computed(() => {
  const task = props.selectedTask
  if (!task || !isActive(task)) return ''
  if (props.visibleSteps.some((step) => step.status === 'running')) return ''
  if (task.status === 'queued') return '等待查看文件'
  if (task.status === 'reading') return '正在打开文件'
  if (task.status === 'saving') return '正在写入题目'
  return '正在整理题目'
})

const iconPaths = (name: string) => {
  switch (name) {
    case 'get_file_info':
      return ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8', 'M8 17h5']
    case 'read_range':
      return ['M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z']
    case 'save_questions':
      return ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z']
    case 'thinking':
      return [
        'M9 18h6',
        'M10 22h4',
        'M12 2a6 6 0 0 0-6 6c0 2.2.9 3.5 2.2 4.8S10 15.2 10 17h4c0-1.8.5-2.9 1.8-4.2S18 10.2 18 8a6 6 0 0 0-6-6z',
      ]
    case 'summary':
      return ['M20 6L9 17l-5-5']
    case 'error':
      return ['M12 9v4', 'M12 17h.01', 'M10.3 3.3 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.3a2 2 0 0 0-3.4 0z']
    default:
      return ['M12 3v3', 'M12 18v3', 'M3 12h3', 'M18 12h3']
  }
}

watch(
  () => props.selectedTask?.id,
  () => {
    openedWriteStepId.value = null
  }
)

watch(
  () => [props.selectedTask?.id, props.visibleSteps.length, liveLine.value, props.selectedTask?.summary],
  async () => {
    await nextTick()
    const pane = activityRef.value
    if (pane) pane.scrollTop = pane.scrollHeight
  }
)
</script>

<style scoped>
.task-detail {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary, #fff);
}

.task-detail .pane-header {
  height: auto;
  min-height: 36px;
  padding-top: 8px;
  padding-bottom: 8px;
}

.pane-header {
  position: relative;
  height: 36px;
  min-height: 36px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  flex-shrink: 0;
}

.pane-header::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 0;
  height: 1px;
  background: color-mix(in srgb, var(--border-primary, #e2e8f0) 42%, transparent);
  transform: scaleY(0.5);
}

.header-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-action {
  border: none;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
  flex-shrink: 0;
}

.header-action:hover {
  color: var(--text-primary, #2d3748);
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.header-action:active {
  transform: scale(0.97);
}

.detail-heading {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.detail-meta {
  font-size: 11px;
  color: var(--text-secondary, #718096);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-stage {
  flex: 1;
  min-height: 0;
  display: flex;
}

.activity-list {
  flex: 1;
  min-width: 0;
  overflow: auto;
  padding: 16px 20px 24px;
}

.write-pane {
  width: 380px;
  flex-shrink: 0;
  overflow: hidden;
  min-height: 0;
  display: flex;
}

.write-pane-inner {
  width: 380px;
  min-width: 380px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-primary, #fff);
  box-shadow: inset 1px 0 0 color-mix(in srgb, var(--border-primary, #e2e8f0) 42%, transparent);
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

.write-pane-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
}

.write-pane-enter-active,
.write-pane-leave-active {
  transition: width 220ms cubic-bezier(0.23, 1, 0.32, 1);
}

.write-pane-enter-from,
.write-pane-leave-to {
  width: 0;
}

.activity-items {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.activity-entry {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.write-block {
  margin-left: 24px;
  border: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 80%, transparent);
  border-radius: 8px;
  overflow: hidden;
  background: color-mix(in srgb, var(--bg-primary, #fff) 92%, #f3f4f6);
}

.write-block.is-open {
  border-color: color-mix(in srgb, #16a34a 35%, var(--border-primary, #e2e8f0));
}

.write-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  border: none;
  background: color-mix(in srgb, var(--bg-primary, #fff) 70%, #eef0f3);
  cursor: pointer;
}

.write-head:hover {
  background: color-mix(in srgb, var(--bg-primary, #fff) 40%, #e8eaed);
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

.write-stat {
  flex-shrink: 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #16a34a;
}

.write-body {
  position: relative;
  max-height: 280px;
  overflow: hidden;
}

.write-fade {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 36px 10px 8px;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    color-mix(in srgb, var(--bg-primary, #fff) 55%, #f3f4f6) 42%,
    color-mix(in srgb, var(--bg-primary, #fff) 92%, #f3f4f6) 100%
  );
  pointer-events: none;
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
  color: #16a34a;
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
  color: #2563eb;
  background: #edf4ff;
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
  color: #15803d;
  background: rgba(22, 163, 74, 0.14);
}

.write-answer-text {
  color: #166534;
}

.write-more {
  pointer-events: auto;
  width: 100%;
  border: none;
  background: transparent;
  padding: 4px 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-primary, #2d3748);
  cursor: pointer;
}

.write-more:hover {
  color: #166534;
}

.activity-line,
.activity-summary,
.activity-error {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.activity-icon {
  flex-shrink: 0;
  width: 16px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: color-mix(in srgb, var(--text-secondary, #718096) 88%, transparent);
}

.activity-text {
  font-size: 13px;
  line-height: 1.7;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 78%, transparent);
}

.activity-line.is-running .activity-icon,
.activity-line.is-running .activity-text {
  color: var(--text-primary, #2d3748);
}

.activity-line.is-failed .activity-icon,
.activity-line.is-failed .activity-text,
.activity-error {
  color: #dc2626;
}

.activity-summary {
  margin-top: 8px;
  padding-top: 12px;
  border-top: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 50%, transparent);
}

.activity-summary .activity-icon {
  color: #16a34a;
}

.activity-summary .activity-text {
  color: var(--text-primary, #2d3748);
}

.activity-text.is-live {
  background-image: linear-gradient(
    90deg,
    color-mix(in srgb, var(--text-primary, #2d3748) 42%, transparent) 0%,
    var(--text-primary, #2d3748) 46%,
    color-mix(in srgb, var(--text-primary, #2d3748) 42%, transparent) 92%
  );
  background-size: 180% 100%;
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  animation: activity-shimmer 1.4s linear infinite;
}

.activity-enter-active {
  transition:
    opacity 180ms cubic-bezier(0.23, 1, 0.32, 1),
    transform 180ms cubic-bezier(0.23, 1, 0.32, 1);
}

.activity-enter-from {
  opacity: 0;
  transform: translateY(6px);
}

.activity-move {
  transition: transform 180ms cubic-bezier(0.23, 1, 0.32, 1);
}

@keyframes activity-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: -80% 0;
  }
}

.activity-empty,
.detail-empty {
  color: var(--text-secondary, #718096);
  font-size: 13px;
}

.activity-empty {
  padding-top: 8px;
}

.detail-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 24px;
}

@media (prefers-reduced-motion: reduce) {
  .header-action:active {
    transform: none;
  }

  .activity-enter-active,
  .activity-move,
  .write-pane-enter-active,
  .write-pane-leave-active {
    transition: none;
  }

  .activity-text.is-live {
    animation: none;
    background: none;
    color: var(--text-primary, #2d3748);
    -webkit-background-clip: unset;
    background-clip: unset;
  }
}
</style>
