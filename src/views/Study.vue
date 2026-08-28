<template>
  <div class="study-page">
    <aside class="study-sidebar">
      <div class="pane-header">
        <div class="header-title">科目</div>
        <button class="header-action" type="button" @click="startCreate">新建</button>
      </div>
      <div class="subject-list">
        <button
          v-for="subject in subjects"
          :key="subject.id"
          class="subject-item"
          type="button"
          :class="{ 'is-selected': subject.id === selectedId }"
          @click="selectedId = subject.id"
          @contextmenu.prevent.stop="openSubjectMenu($event, subject)"
        >
          <div class="subject-meter" aria-hidden="true">
            <svg viewBox="0 0 32 32">
              <circle class="subject-track" cx="16" cy="16" r="11" />
              <circle
                class="subject-arc"
                cx="16"
                cy="16"
                r="11"
                :stroke="barColor(subject.progress)"
                :stroke-dasharray="ringDash(subject.progress)"
              />
            </svg>
            <span>{{ Math.round((subject.progress || 0) * 100) }}</span>
          </div>
          <div class="subject-copy">
            <div class="subject-name">{{ subject.name }}</div>
            <div class="subject-meta">{{ subject.node_count || 0 }} 个知识点</div>
          </div>
        </button>
        <div v-if="!loading && !subjects.length" class="list-empty">还没有学习科目，点新建或让 Agent 创建</div>
        <div v-if="loading" class="list-empty">加载中...</div>
      </div>
    </aside>

    <section class="study-main">
      <div class="pane-header">
        <button
          v-if="selected"
          class="header-action"
          type="button"
          :class="{ 'is-on': paneOpen && rightPane === 'timeline' }"
          @click="togglePane('timeline')"
        >时间线</button>
        <button
          v-if="selected"
          class="header-action"
          type="button"
          :class="{ 'is-on': paneOpen && rightPane === 'bank' }"
          @click="togglePane('bank')"
        >题库</button>
        <button
          v-if="selected"
          class="header-action"
          type="button"
          :class="{ 'is-on': paneOpen && rightPane === 'data' }"
          @click="togglePane('data')"
        >数据</button>
        <button class="header-action" type="button" :disabled="!selected" @click="askAgent">让 Agent 绘制</button>
      </div>
      <div class="graph-body">
        <StudyMermaidGraph
          ref="graphView"
          :source="streamSource"
          :graph="graph"
          :streaming="streaming"
          :selected-name="activeNode?.name"
          :empty-text="emptyText"
          @select="selectByName"
        />
        <Transition name="study-timeline">
          <aside v-if="selected && paneOpen" class="study-timeline-pane">
            <StudyTimeline
              v-if="rightPane === 'timeline'"
              :subject-id="selectedId"
              :items="timeline"
              :summaries="timelineSummaries"
              :graph="graph"
              :empty-text="timelineEmpty"
              @select="selectByName"
            />
            <StudyQuestionBank
              v-else-if="rightPane === 'bank'"
              :subject-id="selectedId"
              :node="activeNode"
              :open-question-id="openQuestionId"
              @select-knowledge="onSelectKnowledge"
            />
            <StudyData
              v-else
              :graph="graph"
              :node="activeNode"
              :subject-id="selectedId"
              :activities="timeline"
              :questions="relatedQuestions"
              @open-question="openBankQuestion"
            />
          </aside>
        </Transition>
      </div>
    </section>
  </div>
  <UnifiedContextMenu
    :visible="subjectMenu.visible"
    :x="subjectMenu.x"
    :y="subjectMenu.y"
    :menu-items="subjectMenuItems"
    exclusive-key="study-subject-menu"
    @item-click="onSubjectMenuClick"
    @close="closeSubjectMenu"
  />
  <CreateFormDialog
    :visible="creating"
    title="新建科目"
    :fields="createFields"
    @close="creating = false"
    @submit="confirmCreate"
  />
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import StudyData from '../components/study/StudyData.vue'
import StudyMermaidGraph from '../components/study/StudyMermaidGraph.vue'
import StudyQuestionBank from '../components/study/StudyQuestionBank.vue'
import StudyTimeline from '../components/study/StudyTimeline.vue'
import CreateFormDialog, { type CreateFormField } from '../components/ui/CreateFormDialog.vue'
import UnifiedContextMenu, { type MenuItem } from '../components/ui/UnifiedContextMenu.vue'
import { databaseService, type QuestionKnowledgeLink, type StudyActivity, type StudySubject, type StudyTimelineSummary } from '../services/app/database'
import { isChatBusy, startStudyGraphChat, startStudySubjectChat } from '../services/agent/chat'
import { backfillClosedStudySessions } from '../services/study/timelineSummary'
import { studyGraphStream } from '../services/study/graphStream'
import {
  flattenGraph,
  graphFromPayload,
  progressColor,
  type StudyGraphNode,
} from '../utils/study/studyGraph'

const STORAGE_KEY = 'zerror-study-subject'

const loading = ref(true)
const creating = ref(false)
const createFields: CreateFormField[] = [
  { key: 'name', label: '科目名称', placeholder: '例如 劳动经济学', required: true },
]
const subjects = ref<StudySubject[]>([])
const selectedId = ref<number | null>(null)
const graph = ref<StudyGraphNode | null>(null)
const activeNode = ref<StudyGraphNode | null>(null)
const paneOpen = ref(true)
const rightPane = ref<'timeline' | 'bank' | 'data'>('timeline')
const openQuestionId = ref<number | null>(null)
const relatedQuestions = ref<{ id: number; question: string }[]>([])
const timeline = ref<StudyActivity[]>([])
const timelineSummaries = ref<StudyTimelineSummary[]>([])
const lastFocusBySubject = new Map<number, string>()
const graphView = ref<{ focusByName: (name: string, instant?: boolean) => boolean } | null>(null)
const RING = 2 * Math.PI * 11
const subjectMenu = ref({ visible: false, x: 0, y: 0, subject: null as StudySubject | null })
const subjectMenuItems: MenuItem[] = [
  { id: 'start', label: '开始学习', action: 'start' },
  { id: 'divider', type: 'divider' },
  { id: 'delete', label: '删除科目', action: 'delete', danger: true },
]

const selected = computed(() => subjects.value.find((item) => item.id === selectedId.value) || null)
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
    timelineSummaries.value = []
    return
  }
  try {
    const [items, summaries] = await Promise.all([
      databaseService.listStudyActivity(id, 2000),
      databaseService.listStudyTimelineSummaries(id, 120),
    ])
    timeline.value = items
    timelineSummaries.value = summaries
    backfillClosedStudySessions({
      subjectId: id,
      subjectName: selected.value?.name,
    })
  } catch {
    timeline.value = []
    timelineSummaries.value = []
  }
}

const emptyText = computed(() => {
  if (streaming.value) return 'Agent 正在绘制知识图谱'
  if (!selected.value) return '新建一个科目，或让 Agent 创建知识图谱'
  if (!graph.value?.children.length) return '这个科目还没有图谱，点右上角让 Agent 绘制'
  return '选择左侧科目查看知识图谱'
})

const barColor = (progress: number) => progressColor(progress)
const ringDash = (progress: number) => {
  const value = Math.max(0, Math.min(1, Number(progress) || 0)) * RING
  return `${value} ${RING}`
}

const openSubjectMenu = (event: MouseEvent, subject: StudySubject) => {
  subjectMenu.value = { visible: true, x: event.clientX, y: event.clientY, subject }
}

const closeSubjectMenu = () => {
  subjectMenu.value = { ...subjectMenu.value, visible: false, subject: null }
}

const onSubjectMenuClick = async (item: MenuItem) => {
  const subject = subjectMenu.value.subject
  closeSubjectMenu()
  if (!subject) return
  if (item.action === 'start') {
    void startStudySubjectChat({ subjectId: subject.id, subjectName: subject.name })
    return
  }
  if (item.action === 'delete') await removeSubject(subject.id)
}

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

const startCreate = () => {
  creating.value = true
}

const confirmCreate = async (values: Record<string, string>) => {
  const name = String(values.name || '').trim()
  if (!name) return
  const subject = await databaseService.createStudySubject(name)
  creating.value = false
  await load()
  selectedId.value = subject.id
}

const removeSubject = async (id: number) => {
  if (!confirm('删除这个学习科目和它的知识图谱？')) return
  await databaseService.deleteStudySubject(id)
  if (selectedId.value === id) selectedId.value = null
  await load()
}

const focusGraph = (name: string) => {
  void nextTick(() => {
    graphView.value?.focusByName(name)
  })
}

const selectByName = (name: string, graphId?: string) => {
  const id = selectedId.value
  if (!name) {
    activeNode.value = null
    if (id != null) lastFocusBySubject.delete(id)
    return
  }
  const nodeId = Number(String(graphId || '').replace(/^node:/, ''))
  const nodes = graph.value ? flattenGraph(graph.value).nodes : []
  const found = (nodeId > 0 ? nodes.find((item) => item.nodeId === nodeId) : null)
    || nodes.find((item) => item.name === name)
    || null
  activeNode.value = found || {
    id: `tmp:${name}`,
    name,
    stats: { count: 1, mastered: 0, fair: 0, weak: 0, unset: 1, progress: 0 },
    children: [],
  }
  if (id != null) lastFocusBySubject.set(id, found?.name || name)
  focusGraph(found?.name || name)
}

const onSelectKnowledge = (link: QuestionKnowledgeLink) => {
  const subjectId = Number(link.subject_id)
  const nodeName = String(link.node_name || '').trim()
  if (subjectId > 0 && subjectId !== selectedId.value) {
    if (nodeName) lastFocusBySubject.set(subjectId, nodeName)
    selectedId.value = subjectId
    return
  }
  selectByName(nodeName, link.node_id ? `node:${link.node_id}` : undefined)
}

const togglePane = (pane: 'timeline' | 'bank' | 'data') => {
  if (paneOpen.value && rightPane.value === pane) {
    paneOpen.value = false
    return
  }
  rightPane.value = pane
  paneOpen.value = true
}

const openBank = () => {
  rightPane.value = 'bank'
  paneOpen.value = true
}

const openBankQuestion = (id: number) => {
  openBank()
  openQuestionId.value = null
  void nextTick(() => {
    openQuestionId.value = id
  })
}

const askAgent = () => {
  const subject = selected.value
  void startStudyGraphChat(subject ? { subjectId: subject.id, subjectName: subject.name } : undefined)
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
  const detail = (event as CustomEvent<{ subjectId?: number; nodeName?: string; nodeId?: number }>).detail
  const id = Number(detail?.subjectId)
  if (!Number.isFinite(id) || id <= 0) return
  const nodeName = String(detail?.nodeName || '').trim()
  if (nodeName) lastFocusBySubject.set(id, nodeName)
  if (id === selectedId.value) {
    selectByName(nodeName, detail?.nodeId ? `node:${detail.nodeId}` : undefined)
    return
  }
  selectedId.value = id
}

const onKnowledgeUpdated = () => {
  void loadRelatedQuestions(activeNode.value?.nodeId)
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
  window.addEventListener('question-knowledge-updated', onKnowledgeUpdated)
})

onUnmounted(() => {
  window.removeEventListener('study-graph-updated', onGraphUpdated)
  window.removeEventListener('open-study-graph', onOpenStudyGraph)
  window.removeEventListener('study-activity-updated', onActivityUpdated)
  window.removeEventListener('question-knowledge-updated', onKnowledgeUpdated)
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

.study-main .header-action:first-of-type {
  margin-left: auto;
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

[data-theme="dark"] .header-action.is-on {
  color: #7ab8c0;
  background: color-mix(in srgb, #5e9aa3 16%, transparent);
}

.subject-list {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
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
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
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

.subject-meter {
  position: relative;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  color: var(--text-secondary, #718096);
}

.subject-meter svg {
  width: 32px;
  height: 32px;
  transform: rotate(-90deg);
}

.subject-track,
.subject-arc {
  fill: none;
  stroke-width: 3.2;
  stroke-linecap: round;
}

.subject-track {
  stroke: color-mix(in srgb, var(--text-primary, #2d3748) 10%, transparent);
}

.subject-arc {
  stroke: currentColor;
}

.subject-meter span {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 8px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary, #2d3748);
}

.subject-copy {
  min-width: 0;
  flex: 1;
}

.subject-name {
  font-size: 13px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.subject-meta {
  margin-top: 2px;
  font-size: 11px;
  color: var(--text-secondary, #718096);
  font-variant-numeric: tabular-nums;
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
.study-timeline-leave-active :deep(.study-timeline),
.study-timeline-enter-active :deep(.study-qbank),
.study-timeline-leave-active :deep(.study-qbank),
.study-timeline-enter-active :deep(.study-data),
.study-timeline-leave-active :deep(.study-data) {
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
.study-timeline-leave-to :deep(.study-timeline),
.study-timeline-enter-from :deep(.study-qbank),
.study-timeline-leave-to :deep(.study-qbank),
.study-timeline-enter-from :deep(.study-data),
.study-timeline-leave-to :deep(.study-data) {
  opacity: 0;
  transform: translateX(18px);
}

@media (prefers-reduced-motion: reduce) {
  .study-timeline-enter-active,
  .study-timeline-leave-active,
  .study-timeline-enter-active :deep(.study-timeline),
  .study-timeline-leave-active :deep(.study-timeline),
  .study-timeline-enter-active :deep(.study-qbank),
  .study-timeline-leave-active :deep(.study-qbank),
  .study-timeline-enter-active :deep(.study-data),
  .study-timeline-leave-active :deep(.study-data) {
    transition: none;
  }
}

</style>
