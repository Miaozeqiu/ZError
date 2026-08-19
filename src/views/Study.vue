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
          <span><i class="dot is-weak" />未掌握</span>
          <span><i class="dot is-fair" />一般</span>
          <span><i class="dot is-ok" />已掌握</span>
        </div>
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
        <div v-if="activeNode" class="node-card">
          <div class="node-card-title">{{ activeNode.name }}</div>
          <div class="node-card-progress">{{ nodeMasteryText(activeNode.mastery) }} · {{ Math.round(activeNode.stats.progress * 100) }}%</div>
          <div v-if="activeNode.summary" class="node-card-summary">{{ activeNode.summary }}</div>
        </div>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import StudyMermaidGraph from '../components/StudyMermaidGraph.vue'
import { databaseService, type StudySubject } from '../services/database'
import { startStudyGraphChat } from '../services/agentChat'
import { studyGraphStream } from '../services/studyGraphStream'
import {
  flattenGraph,
  graphFromPayload,
  nodeMasteryText,
  progressColor,
  type StudyGraphNode,
} from '../utils/studyGraph'

const STORAGE_KEY = 'zerror-study-subject'

const loading = ref(true)
const creating = ref(false)
const createName = ref('')
const createInputRef = ref<HTMLInputElement | null>(null)
const subjects = ref<StudySubject[]>([])
const selectedId = ref<number | null>(null)
const graph = ref<StudyGraphNode | null>(null)
const activeNode = ref<StudyGraphNode | null>(null)

const selected = computed(() => subjects.value.find((item) => item.id === selectedId.value) || null)
const streaming = computed(() => {
  const stream = studyGraphStream.value
  return Boolean(stream?.streaming && (stream.subjectId == null || stream.subjectId === selectedId.value))
})
const streamSource = computed(() => '')
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
  if (!name) {
    activeNode.value = null
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
}

const askAgent = () => {
  const subject = selected.value
  void startStudyGraphChat(subject ? { subjectId: subject.id, subjectName: subject.name } : undefined)
}

watch(selectedId, (id) => {
  if (id != null) localStorage.setItem(STORAGE_KEY, String(id))
  void loadGraph(id)
})

const onGraphUpdated = () => {
  void load()
}

const onOpenStudyGraph = (event: Event) => {
  const id = Number((event as CustomEvent<{ subjectId?: number }>).detail?.subjectId)
  if (!Number.isFinite(id) || id <= 0) return
  selectedId.value = id
}

onMounted(() => {
  void load()
  window.addEventListener('study-graph-updated', onGraphUpdated)
  window.addEventListener('open-study-graph', onOpenStudyGraph)
})

onUnmounted(() => {
  window.removeEventListener('study-graph-updated', onGraphUpdated)
  window.removeEventListener('open-study-graph', onOpenStudyGraph)
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

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.dot.is-weak { background: #94a3b8; }
.dot.is-fair { background: #f59e0b; }
.dot.is-ok { background: #16a34a; }

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

.node-card {
  position: absolute;
  left: 16px;
  bottom: 16px;
  width: 240px;
  padding: 12px;
  border-radius: 10px;
  background: color-mix(in srgb, var(--bg-secondary, #fff) 88%, transparent);
  box-shadow: 0 8px 24px color-mix(in srgb, #000 10%, transparent);
  backdrop-filter: blur(12px);
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
