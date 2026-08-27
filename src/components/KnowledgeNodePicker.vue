<template>
  <div class="kn-picker">
    <select
      v-if="subjects.length > 1"
      v-model.number="subjectId"
      class="kn-select"
    >
      <option v-for="item in subjects" :key="item.id" :value="item.id">{{ item.name }}</option>
    </select>
    <input
      v-model="query"
      class="kn-search"
      type="search"
      placeholder="搜索知识点"
    />
    <div class="kn-list">
      <button
        v-for="node in filtered"
        :key="node.id"
        type="button"
        class="kn-item"
        @click="pick(node)"
      >{{ node.name }}</button>
      <div v-if="!filtered.length" class="kn-empty">{{ emptyText }}</div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { databaseService, type StudySubject } from '../services/app/database'
import { flattenGraph, graphFromPayload, type StudyGraphNode } from '../utils/studyGraph'

export type KnowledgePick = {
  id: number
  name: string
  subjectId: number
}

const props = defineProps<{
  preferSubjectId?: number | null
}>()

const emit = defineEmits<{
  pick: [node: KnowledgePick]
}>()

const subjects = ref<StudySubject[]>([])
const subjectId = ref(0)
const query = ref('')
const nodes = ref<StudyGraphNode[]>([])

const emptyText = computed(() => {
  if (!subjectId.value) return '先选择一个科目'
  if (!nodes.value.length) return '这个科目还没有知识点'
  return '没有匹配的知识点'
})

const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase()
  const rows = nodes.value.filter((item) => item.nodeId)
  if (!needle) return rows.slice(0, 40)
  return rows.filter((item) => item.name.toLowerCase().includes(needle)).slice(0, 40)
})

const loadSubjects = async () => {
  try {
    subjects.value = await databaseService.listStudySubjects()
  } catch {
    subjects.value = []
  }
  const preferred = Number(props.preferSubjectId)
  const stored = Number(localStorage.getItem('zerror-study-subject') || 0)
  const next = subjects.value.find((item) => item.id === preferred)?.id
    || subjects.value.find((item) => item.id === stored)?.id
    || subjects.value[0]?.id
    || 0
  subjectId.value = next
}

const loadNodes = async () => {
  const id = subjectId.value
  if (!id) {
    nodes.value = []
    return
  }
  try {
    const payload = await databaseService.getStudyGraph(id)
    nodes.value = flattenGraph(graphFromPayload(payload)).nodes.filter((item) => item.nodeId)
  } catch {
    nodes.value = []
  }
}

const pick = (node: StudyGraphNode) => {
  if (!node.nodeId) return
  emit('pick', { id: node.nodeId, name: node.name, subjectId: subjectId.value })
}

watch(subjectId, () => {
  void loadNodes()
})

watch(() => props.preferSubjectId, (id) => {
  const next = Number(id)
  if (next > 0 && subjects.value.some((item) => item.id === next)) subjectId.value = next
})

onMounted(() => {
  void loadSubjects()
})

defineExpose({
  subjectId,
})
</script>

<style scoped>
.kn-picker {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.kn-select,
.kn-search {
  width: 100%;
  padding: 5px 8px;
  border: none;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
  color: inherit;
  font-size: 12px;
}

.kn-list {
  max-height: 180px;
  overflow: auto;
}

.kn-item {
  display: block;
  width: 100%;
  padding: 6px 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary, #2d3748);
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.kn-item:hover {
  background: color-mix(in srgb, #2F6F78 10%, transparent);
}

.kn-empty {
  padding: 10px 8px;
  font-size: 12px;
  color: var(--text-secondary, #94a3b8);
}
</style>
