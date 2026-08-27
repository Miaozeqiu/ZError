<template>
  <section class="study-timeline">
    <StudyChart
      :sessions="sessionSpans"
      :subject-id="subjectId"
      :selected-day="selectedDay"
      :item-count="items.length"
      @select-day="selectDay"
      @preview-day="warmupDay"
    />
    <StudyTimelineList
      ref="timelineList"
      :groups="groups"
      :empty-text="emptyText"
      :selected-day="selectedDay"
      @select="onSelect"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { StudyActivity, StudyTimelineSummary } from '../services/app/database'
import type { StudyGraphNode } from '../utils/studyGraph'
import StudyChart from './study/StudyChart.vue'
import StudyTimelineList, { type StudyTimelineItem } from './study/StudyTimelineList.vue'

const props = defineProps<{
  subjectId?: number | null
  items: StudyActivity[]
  summaries?: StudyTimelineSummary[]
  graph?: StudyGraphNode | null
  emptyText?: string
}>()

const emit = defineEmits<{
  select: [name: string]
}>()

const emptyText = computed(() => props.emptyText || '讲课、练习或复习后，会出现在这里')

const pad2 = (value: number) => String(value).padStart(2, '0')
const dateKey = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`

const parseStamp = (value: string) => {
  const raw = String(value || '').trim()
  if (!raw) return 0
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const ms = Date.parse(normalized)
  return Number.isFinite(ms) ? ms : Date.parse(`${normalized}Z`) || 0
}

const formatClock = (stamp: number) => {
  const date = new Date(stamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const dayLabel = (stamp: number) => {
  const date = new Date(stamp)
  const today = new Date()
  const start = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const diff = Math.round((start(today) - start(date)) / 86400000)
  if (diff === 0) return '今天'
  if (diff === 1) return '昨天'
  if (date.getFullYear() === today.getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

const sessionSpans = computed(() => (
  (props.summaries || [])
    .map((summary) => {
      const start = parseStamp(summary.start_time)
      const end = parseStamp(summary.end_time)
      const minutes = Math.max(1, Math.round((end - start) / 60000))
      return { ...summary, start, end, minutes }
    })
    .filter((item) => item.start > 0 && item.end > 0)
    .sort((a, b) => a.start - b.start)
))

const selectedDay = ref('')
const loadedDays = new Set<string>()
const timelineList = ref<{
  jumpToDay: (key: string) => void
  measureDay: (key: string) => void
  clearOffsets: () => void
} | null>(null)

const summaryTimelineItems = computed<StudyTimelineItem[]>(() => (
  sessionSpans.value.map((summary) => ({
    key: `summary-${summary.id}`,
    kind: 'summary',
    startTime: formatClock(summary.start),
    endTime: formatClock(summary.end),
    stamp: summary.end,
    startStamp: summary.start,
    endStamp: summary.end,
    action: '学习',
    detail: ` ${summary.text}`,
    names: [],
    question_count: 0,
    correct_count: 0,
    minutes: summary.minutes,
  }))
))

const displayItems = computed(() => (
  [...summaryTimelineItems.value].sort((a, b) => b.stamp - a.stamp || b.key.localeCompare(a.key))
))

const groups = computed(() => {
  const map = new Map<string, StudyTimelineItem[]>()
  for (const item of displayItems.value) {
    const key = dateKey(new Date(item.stamp))
    const list = map.get(key)
    if (list) list.push(item)
    else map.set(key, [item])
  }
  return [...map.entries()].map(([key, items]) => ({
    key,
    label: dayLabel(items[0].stamp),
    items,
  }))
})

const warmupDay = async (key: string) => {
  loadedDays.add(key)
  await nextTick()
  timelineList.value?.measureDay(key)
}

const selectDay = async (key: string) => {
  selectedDay.value = key
  await warmupDay(key)
  timelineList.value?.jumpToDay(key)
}

watch(
  () => props.subjectId,
  () => {
    loadedDays.clear()
    timelineList.value?.clearOffsets()
    selectedDay.value = ''
  },
  { immediate: true },
)

watch(
  () => props.summaries?.length,
  () => {
    timelineList.value?.clearOffsets()
  },
)

const onSelect = (item: StudyTimelineItem) => {
  if (item.kind === 'summary') return
  const name = item.names[0]
  if (name) emit('select', name)
}
</script>

<style scoped>
.study-timeline {
  flex: 1;
  width: 260px;
  min-width: 260px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 42%, transparent);
}
</style>
