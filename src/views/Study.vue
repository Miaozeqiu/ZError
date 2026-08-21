<template>
  <div class="study-page">
    <aside class="study-sidebar">
      <div class="pane-header">
        <div class="header-title">科目</div>
        <button class="header-action" type="button" @click="startCreate">新建</button>
      </div>
      <form v-if="creating" class="create-row" @submit.prevent="confirmCreate">
        <input
          ref="createInputRef"
          v-model="createName"
          class="create-input"
          placeholder="科目名称"
          @keydown.escape="creating = false"
        />
        <button class="header-action" type="submit" :disabled="!createName.trim()">添加</button>
      </form>
      <div class="subject-list">
        <button
          v-for="subject in subjects"
          :key="subject.id"
          class="subject-item"
          type="button"
          :class="{ 'is-selected': subject.id === selectedId }"
          @click="selectedId = subject.id"
        >
          <div class="subject-top">
            <div class="subject-name">{{ subject.name }}</div>
            <button class="subject-delete" type="button" title="删除科目" @click.stop="removeSubject(subject.id)">×</button>
          </div>
          <div class="subject-meta">
            <span>{{ Math.round((subject.progress || 0) * 100) }}%</span>
            <span>{{ subject.node_count || 0 }} 个知识点</span>
          </div>
          <div class="subject-bar">
            <span :style="{ width: `${Math.round((subject.progress || 0) * 100)}%`, background: barColor(subject.progress) }" />
          </div>
        </button>
        <div v-if="!loading && !subjects.length" class="list-empty">还没有学习科目，点新建或让 Agent 创建</div>
        <div v-if="loading" class="list-empty">加载中...</div>
      </div>
    </aside>

    <section class="study-main">
      <div class="pane-header">
        <div class="header-title">{{ selected?.name || '知识图谱' }}</div>
        <div v-if="selected" class="header-stat">掌握 {{ Math.round((selected.progress || 0) * 100) }}%</div>
        <div class="legend">
          <span>颜色越深记忆越牢</span>
          <span>随遗忘曲线逐渐变淡</span>
        </div>
        <button
          v-if="selected && subjects.length > 1"
          class="header-action"
          type="button"
          :class="{ 'is-on': mergeOpen }"
          @click="toggleMerge"
        >并入</button>
        <button
          v-if="activeNode?.nodeId"
          class="header-action"
          type="button"
          :class="{ 'is-on': splitOpen }"
          @click="toggleSplit"
        >拆出</button>
        <button
          v-if="selected"
          class="header-action"
          type="button"
          :class="{ 'is-on': timelineOpen }"
          @click="timelineOpen = !timelineOpen"
        >时间线</button>
        <button class="header-action" type="button" :disabled="!selected" @click="askAgent">让 Agent 绘制</button>
      </div>
      <div class="graph-body">
        <StudyMermaidGraph
          :source="streamSource"
          :graph="graph"
          :streaming="streaming"
          :selected-name="activeNode?.name"
          :empty-text="emptyText"
          @select="selectByName"
        />
        <div v-if="mergeOpen && selected" class="study-panel">
          <div class="study-panel-title">把其他科目并入「{{ selected.name }}」</div>
          <label v-for="subject in mergeCandidates" :key="subject.id" class="study-check">
            <input
              type="checkbox"
              :checked="mergeSourceIds.includes(subject.id)"
              @change="toggleMergeSource(subject.id)"
            />
            <span>{{ subject.name }}</span>
          </label>
          <button class="study-panel-btn" type="button" :disabled="!mergeSourceIds.length || merging" @click="confirmMerge">
            {{ merging ? '合并中…' : '确认合并' }}
          </button>
        </div>
        <div v-else-if="splitOpen && activeNode?.nodeId" class="study-panel">
          <div class="study-panel-title">把「{{ activeNode.name }}」及其下级拆成新科目</div>
          <input v-model="splitName" class="study-panel-input" placeholder="新科目名称" @keydown.enter="confirmSplit" />
          <button class="study-panel-btn" type="button" :disabled="!splitName.trim() || splitting" @click="confirmSplit">
            {{ splitting ? '拆出中…' : '确认拆出' }}
          </button>
        </div>
        <div v-if="activeNode" class="node-card">
          <div class="node-curve-wrap" :class="{ 'is-open': curveOpen }">
            <div class="node-curve-inner">
              <StudyForgettingCurve :node="activeNode" />
            </div>
          </div>
          <div class="node-card-top">
            <div class="node-card-copy">
              <div class="node-card-title">{{ activeNode.name }}</div>
              <div class="node-card-progress">
                {{ nodeMasteryText(activeMastery) }} · {{ Math.round((activeRetention ?? 0) * 100) }}%
              </div>
            </div>
            <button
              class="node-curve-btn"
              type="button"
              :class="{ 'is-on': curveOpen }"
              title="遗忘曲线"
              @click.stop="curveOpen = !curveOpen"
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M2.2 4.2c3.2.1 5 4.6 11.6 8.6" />
                <circle cx="8.4" cy="8.2" r="1.35" />
              </svg>
            </button>
          </div>
          <div v-if="activeNode.summary" class="node-card-summary">{{ activeNode.summary }}</div>
          <div v-if="relatedQuestions.length" class="node-card-questions">
            <div class="node-card-questions-title">{{ relatedQuestions.length }} 道相关题</div>
            <button
              v-for="item in relatedQuestions.slice(0, 4)"
              :key="item.id"
              class="node-question"
              type="button"
              :title="item.question"
            >{{ item.question }}</button>
          </div>
        </div>
        <Transition name="study-timeline">
          <aside v-if="selected && timelineOpen" class="study-timeline-pane">
            <StudyTimeline
              :items="timeline"
              :empty-text="timelineEmpty"
              @select="selectByName"
            />
          </aside>
        </Transition>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import StudyForgettingCurve from '../components/StudyForgettingCurve.vue'
import StudyMermaidGraph from '../components/StudyMermaidGraph.vue'
import StudyTimeline from '../components/StudyTimeline.vue'
import { databaseService, type StudyActivity, type StudySubject } from '../services/database'
import { isChatBusy, startStudyGraphChat } from '../services/agentChat'
import { studyGraphStream } from '../services/studyGraphStream'
import {
  flattenGraph,
  graphFromPayload,
  nodeMasteryText,
  progressColor,
  type StudyGraphNode,
} from '../utils/studyGraph'
import { rolledRetention } from '../utils/studyForgetting'

const STORAGE_KEY = 'zerror-study-subject'

const loading = ref(true)
const creating = ref(false)
const createName = ref('')
const createInputRef = ref<HTMLInputElement | null>(null)
const subjects = ref<StudySubject[]>([])
const selectedId = ref<number | null>(null)
const graph = ref<StudyGraphNode | null>(null)
const activeNode = ref<StudyGraphNode | null>(null)
const curveOpen = ref(false)
const timelineOpen = ref(true)
const mergeOpen = ref(false)
const splitOpen = ref(false)
const merging = ref(false)
const splitting = ref(false)
const mergeSourceIds = ref<number[]>([])
const splitName = ref('')
const relatedQuestions = ref<{ id: number; question: string }[]>([])
const timeline = ref<StudyActivity[]>([])
const lastFocusBySubject = new Map<number, string>()
const mergeCandidates = computed(() => subjects.value.filter((item) => item.id !== selectedId.value))

const selected = computed(() => subjects.value.find((item) => item.id === selectedId.value) || null)
const activeRetention = computed(() => activeNode.value ? rolledRetention(activeNode.value) : null)
const activeMastery = computed(() => {
  const retention = activeRetention.value
  if (retention == null) return 0
  if (retention < 0.4) return 1
  if (retention < 0.8) return 2
  return 3
})
const streaming = computed(() => {
  const stream = studyGraphStream.value
  return Boolean(
    stream?.streaming
    && isChatBusy.value
    && (stream.subjectId == null || stream.subjectId === selectedId.value),
  )
})
const streamSource = computed(() => '')
const timelineEmpty = computed(() => {
  if (!selected.value) return '选择科目后查看学习记录'
  return '讲课、练习或复习后，会出现在这里'
})

const loadTimeline = async (id: number | null) => {
  if (id == null) {
    timeline.value = []
    return
  }
  try {
    timeline.value = await databaseService.listStudyActivity(id)
  } catch {
    timeline.value = []
  }
}

const emptyText = computed(() => {
  if (streaming.value) return 'Agent 正在绘制知识图谱'
  if (!selected.value) return '新建一个科目，或让 Agent 创建知识图谱'
  if (!graph.value?.children.length) return '这个科目还没有图谱，点右上角让 Agent 绘制'
  return '选择左侧科目查看知识图谱'
})

const barColor = (progress: number) => progressColor(progress)

const loadGraph = async (id: number | null) => {
  if (id == null) {
    graph.value = null
    return
  }
  try {
    const payload = await databaseService.getStudyGraph(id)
    graph.value = payload.nodes.length ? graphFromPayload(payload) : null
  } catch {
    graph.value = null
  }
}

const load = async () => {
  loading.value = true
  try {
    subjects.value = await databaseService.listStudySubjects()
    const stored = Number(localStorage.getItem(STORAGE_KEY))
    const nextId = subjects.value.some((item) => item.id === stored)
      ? stored
      : subjects.value[0]?.id ?? null
    selectedId.value = nextId
    await loadGraph(nextId)
    await loadTimeline(nextId)
  } finally {
    loading.value = false
  }
}

const startCreate = async () => {
  creating.value = true
  createName.value = ''
  await nextTick()
  createInputRef.value?.focus()
}

const confirmCreate = async () => {
  const name = createName.value.trim()
  if (!name) return
  const subject = await databaseService.createStudySubject(name)
  creating.value = false
  createName.value = ''
  await load()
  selectedId.value = subject.id
}

const removeSubject = async (id: number) => {
  if (!confirm('删除这个学习科目和它的知识图谱？')) return
  await databaseService.deleteStudySubject(id)
  if (selectedId.value === id) selectedId.value = null
  await load()
}

const selectByName = (name: string) => {
  const id = selectedId.value
  if (!name) {
    activeNode.value = null
    curveOpen.value = false
    if (id != null) lastFocusBySubject.delete(id)
    return
  }
  const found = graph.value
    ? flattenGraph(graph.value).nodes.find((item) => item.name === name)
    : null
  activeNode.value = found || {
    id: `tmp:${name}`,
    name,
    stats: { count: 1, mastered: 0, fair: 0, weak: 0, unset: 1, progress: 0 },
    children: [],
  }
  if (id != null) lastFocusBySubject.set(id, name)
}

const askAgent = () => {
  const subject = selected.value
  void startStudyGraphChat(subject ? { subjectId: subject.id, subjectName: subject.name } : undefined)
}

const toggleMerge = () => {
  mergeOpen.value = !mergeOpen.value
  splitOpen.value = false
  if (mergeOpen.value) mergeSourceIds.value = []
}

const toggleSplit = () => {
  splitOpen.value = !splitOpen.value
  mergeOpen.value = false
  if (splitOpen.value) splitName.value = activeNode.value?.name || ''
}

const toggleMergeSource = (id: number) => {
  mergeSourceIds.value = mergeSourceIds.value.includes(id)
    ? mergeSourceIds.value.filter((item) => item !== id)
    : [...mergeSourceIds.value, id]
}

const confirmMerge = async () => {
  const targetId = selectedId.value
  if (!targetId || !mergeSourceIds.value.length) return
  merging.value = true
  try {
    await databaseService.mergeStudySubjects(targetId, mergeSourceIds.value)
    mergeOpen.value = false
    mergeSourceIds.value = []
    localStorage.setItem(STORAGE_KEY, String(targetId))
    window.dispatchEvent(new CustomEvent('study-graph-updated', { detail: { subjectId: targetId } }))
    await load()
    selectedId.value = targetId
  } finally {
    merging.value = false
  }
}

const confirmSplit = async () => {
  const subjectId = selectedId.value
  const nodeId = activeNode.value?.nodeId
  const name = splitName.value.trim()
  if (!subjectId || !nodeId || !name) return
  splitting.value = true
  try {
    const result = await databaseService.splitStudySubject(subjectId, [{ name, node_ids: [nodeId] }])
    splitOpen.value = false
    const created = result.created[0]
    if (created) localStorage.setItem(STORAGE_KEY, String(created.id))
    window.dispatchEvent(new CustomEvent('study-graph-updated', { detail: { subjectId } }))
    await load()
    if (created) selectedId.value = created.id
  } finally {
    splitting.value = false
  }
}

const loadRelatedQuestions = async (nodeId?: number) => {
  if (!nodeId) {
    relatedQuestions.value = []
    return
  }
  try {
    const ids = await databaseService.listNodeQuestions(nodeId)
    if (!ids.length) {
      relatedQuestions.value = []
      return
    }
    const items = await databaseService.getQuestionsByIds(ids.slice(0, 8))
    relatedQuestions.value = items.map((item) => ({ id: item.id, question: item.question }))
  } catch {
    relatedQuestions.value = []
  }
}

watch(() => activeNode.value?.nodeId, (id) => {
  void loadRelatedQuestions(id)
})

watch(selectedId, (id) => {
  curveOpen.value = false
  mergeOpen.value = false
  splitOpen.value = false
  if (id != null) localStorage.setItem(STORAGE_KEY, String(id))
  const last = id == null ? '' : lastFocusBySubject.get(id) || ''
  if (last) {
    activeNode.value = {
      id: `tmp:${last}`,
      name: last,
      stats: { count: 1, mastered: 0, fair: 0, weak: 0, unset: 1, progress: 0 },
      children: [],
    }
  } else {
    activeNode.value = null
  }
  void loadGraph(id).then(() => {
    if (last) selectByName(last)
  })
  void loadTimeline(id)
})

const onGraphUpdated = () => {
  void load()
}

const onOpenStudyGraph = async (event: Event) => {
  const detail = (event as CustomEvent<{ subjectId?: number; nodeName?: string }>).detail
  const id = Number(detail?.subjectId)
  if (!Number.isFinite(id) || id <= 0) return
  const nodeName = String(detail?.nodeName || '').trim()
  if (nodeName) lastFocusBySubject.set(id, nodeName)
  selectedId.value = id
}

const onActivityUpdated = (event: Event) => {
  const id = Number((event as CustomEvent<{ subjectId?: number }>).detail?.subjectId)
  if (Number.isFinite(id) && id > 0 && id !== selectedId.value) return
  void loadTimeline(selectedId.value)
}

onMounted(() => {
  void load()
  window.addEventListener('study-graph-updated', onGraphUpdated)
  window.addEventListener('open-study-graph', onOpenStudyGraph)
  window.addEventListener('study-activity-updated', onActivityUpdated)
})

onUnmounted(() => {
  window.removeEventListener('study-graph-updated', onGraphUpdated)
  window.removeEventListener('open-study-graph', onOpenStudyGraph)
  window.removeEventListener('study-activity-updated', onActivityUpdated)
})
</script>

<style scoped>
.study-page {
  height: 100%;
  display: flex;
  gap: 4px;
  background: var(--bg-primary, #f5f5f7);
}

.study-sidebar {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: var(--bg-secondary, #fff);
  border-radius: 4px;
  margin-bottom: 5px;
}

.study-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-secondary, #fff);
  border-radius: 4px;
  margin-bottom: 5px;
  margin-right: 5px;
}

.pane-header {
  position: relative;
  height: 36px;
  min-height: 36px;
  padding: 0 12px;
  display: flex;
  align-items: center;
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
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-stat {
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #16a34a;
}

.legend {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  color: var(--text-secondary, #718096);
}

.legend span {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.header-action {
  border: none;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}

.header-action:hover:not(:disabled) {
  color: var(--text-primary, #2d3748);
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.header-action:disabled {
  opacity: 0.4;
  cursor: default;
}

.header-action.is-on {
  color: #2F6F78;
  background: color-mix(in srgb, #2F6F78 10%, transparent);
}

.study-panel {
  position: absolute;
  top: 12px;
  right: 12px;
  z-index: 3;
  width: 240px;
  padding: 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-secondary, #fff) 92%, transparent);
  box-shadow: 0 8px 24px color-mix(in srgb, #000 10%, transparent);
  backdrop-filter: blur(12px);
}

.study-panel-title {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
}

.study-check {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
  font-size: 12px;
  color: var(--text-primary, #2d3748);
  cursor: pointer;
}

.study-panel-input {
  width: 100%;
  margin: 4px 0 8px;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
  color: inherit;
  font-size: 12px;
}

.study-panel-btn {
  width: 100%;
  margin-top: 8px;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: color-mix(in srgb, #2F6F78 14%, transparent);
  color: #2F6F78;
  font-size: 12px;
  cursor: pointer;
}

.study-panel-btn:disabled {
  opacity: 0.45;
  cursor: default;
}

.node-card-questions {
  margin-top: 10px;
}

.node-card-questions-title {
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--text-secondary, #718096);
}

.node-question {
  display: block;
  width: 100%;
  margin-top: 4px;
  padding: 0;
  overflow: hidden;
  border: none;
  background: transparent;
  color: var(--text-primary, #2d3748);
  font-size: 12px;
  line-height: 1.4;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: default;
}

.create-row {
  display: flex;
  gap: 6px;
  padding: 8px 10px 0;
}

.create-input {
  flex: 1;
  min-width: 0;
  height: 28px;
  border: 1px solid color-mix(in srgb, var(--text-primary, #2d3748) 10%, transparent);
  border-radius: 8px;
  padding: 0 8px;
  font: inherit;
  font-size: 12px;
  color: var(--text-primary, #2d3748);
}

.subject-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
  scrollbar-width: none;
}

.subject-list::-webkit-scrollbar {
  display: none;
}

.subject-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 10px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  text-align: left;
  cursor: pointer;
  color: var(--text-primary, #2d3748);
}

.subject-item:hover {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 5%, transparent);
}

.subject-item.is-selected {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 7%, transparent);
}

.subject-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.subject-name {
  flex: 1;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subject-delete {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #718096);
  cursor: pointer;
  opacity: 0;
}

.subject-item:hover .subject-delete,
.subject-item.is-selected .subject-delete {
  opacity: 1;
}

.subject-meta {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  color: var(--text-secondary, #718096);
  font-variant-numeric: tabular-nums;
}

.subject-bar {
  height: 3px;
  border-radius: 99px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 8%, transparent);
  overflow: hidden;
}

.subject-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
}

.list-empty {
  padding: 24px 8px;
  text-align: center;
  font-size: 12px;
  color: var(--text-secondary, #718096);
}

.graph-body {
  position: relative;
  flex: 1;
  min-height: 0;
  display: flex;
}

.study-timeline-pane {
  flex: 0 0 260px;
  width: 260px;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
}

.study-timeline-enter-active,
.study-timeline-leave-active {
  transition: width 320ms cubic-bezier(0.32, 0.72, 0, 1), flex-basis 320ms cubic-bezier(0.32, 0.72, 0, 1);
}

.study-timeline-enter-active :deep(.study-timeline),
.study-timeline-leave-active :deep(.study-timeline) {
  transition:
    opacity 200ms ease,
    transform 320ms cubic-bezier(0.32, 0.72, 0, 1);
}

.study-timeline-enter-from,
.study-timeline-leave-to {
  width: 0;
  flex-basis: 0;
}

.study-timeline-enter-from :deep(.study-timeline),
.study-timeline-leave-to :deep(.study-timeline) {
  opacity: 0;
  transform: translateX(18px);
}

@media (prefers-reduced-motion: reduce) {
  .study-timeline-enter-active,
  .study-timeline-leave-active,
  .study-timeline-enter-active :deep(.study-timeline),
  .study-timeline-leave-active :deep(.study-timeline) {
    transition: none;
  }
}

.node-card {
  position: absolute;
  left: 16px;
  bottom: 16px;
  width: 260px;
  padding: 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-secondary, #fff) 88%, transparent);
  box-shadow: 0 8px 24px color-mix(in srgb, #000 10%, transparent);
  backdrop-filter: blur(12px);
}

.node-curve-wrap {
  display: grid;
  grid-template-rows: 0fr;
  transition: grid-template-rows 260ms cubic-bezier(0.22, 1, 0.36, 1);
}

.node-curve-wrap.is-open {
  grid-template-rows: 1fr;
  margin-bottom: 10px;
}

.node-curve-inner {
  overflow: hidden;
  min-height: 0;
}

.node-curve-wrap.is-open .node-curve-inner {
  overflow: visible;
}

.node-card-top {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.node-card-copy {
  flex: 1;
  min-width: 0;
}

.node-curve-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  margin-top: -2px;
  padding: 0;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-secondary, #718096);
  cursor: pointer;
}

.node-curve-btn:hover,
.node-curve-btn.is-on {
  color: #2F6F78;
  background: color-mix(in srgb, #2F6F78 10%, transparent);
}

.node-curve-btn:active {
  transform: scale(0.96);
}

.node-curve-btn svg {
  display: block;
  width: 16px;
  height: 16px;
}

.node-curve-btn path {
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
}

.node-curve-btn circle {
  fill: currentColor;
}

.node-card-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
}

.node-card-progress {
  margin-top: 4px;
  font-size: 12px;
  color: var(--text-secondary, #718096);
}

.node-card-summary {
  margin-top: 8px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary, #4a5568);
  white-space: pre-wrap;
}
</style>
