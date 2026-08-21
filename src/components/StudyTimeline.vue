<template>
  <section class="study-timeline">
    <div class="study-timeline-head">时间线</div>
    <div v-if="!groups.length" class="study-timeline-empty">
      {{ emptyText }}
    </div>
    <div v-else class="study-timeline-list">
      <div v-for="group in groups" :key="group.label" class="study-timeline-day">
        <div class="study-timeline-day-label">{{ group.label }}</div>
        <button
          v-for="item in group.items"
          :key="item.key"
          type="button"
          class="study-timeline-item"
          :class="`is-${item.kind}`"
          @click="onSelect(item)"
        >
          <span class="study-timeline-dot" aria-hidden="true" />
          <span class="study-timeline-time">{{ item.time }}</span>
          <span class="study-timeline-copy">
            <span class="study-timeline-action" :class="`is-${item.kind}`">{{ item.action }}</span>
            <span v-if="item.detail">{{ item.detail }}</span>
          </span>
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { StudyActivity } from '../services/database'

const props = defineProps<{
  items: StudyActivity[]
  emptyText?: string
}>()

const emit = defineEmits<{
  select: [name: string]
}>()

const emptyText = computed(() => props.emptyText || '讲课、练习或复习后，会出现在这里')

type TimelineItem = {
  key: string
  kind: string
  time: string
  stamp: number
  action: string
  detail: string
  names: string[]
  question_count: number
  correct_count: number
}

const parseStamp = (value: string) => {
  const raw = String(value || '').trim()
  if (!raw) return 0
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const ms = Date.parse(normalized)
  return Number.isFinite(ms) ? ms : Date.parse(`${normalized}Z`) || 0
}

const joinNames = (names: string[]) => {
  const unique = [...new Set(names.map((item) => item.trim()).filter(Boolean))]
  if (!unique.length) return ''
  if (unique.length <= 3) return unique.join('、')
  return `${unique.slice(0, 3).join('、')} 等 ${unique.length} 个`
}

const itemParts = (item: StudyActivity) => {
  const names = joinNames(item.names)
  if (item.kind === 'practice') {
    const total = Math.max(1, Number(item.question_count) || 0)
    const correct = Math.max(0, Number(item.correct_count) || 0)
    const rate = Math.round((correct / total) * 100)
    return {
      action: '练习',
      detail: names ? ` ${total} 道，正确率 ${rate}% · ${names}` : ` ${total} 道，正确率 ${rate}%`,
    }
  }
  if (item.kind === 'review') return { action: '复习', detail: names ? ` ${names}` : ' 知识点' }
  return { action: '学习', detail: names ? ` ${names}` : ' 知识点' }
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

const clock = (stamp: number) => {
  const date = new Date(stamp)
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

const groupedItems = computed(() => {
  const rows = [...props.items]
    .map((item) => ({ item, stamp: parseStamp(item.create_time) }))
    .sort((a, b) => b.stamp - a.stamp || b.item.id - a.item.id)
  const merged: TimelineItem[] = []
  for (const row of rows) {
    const prev = merged[merged.length - 1]
    if (
      row.item.kind === 'practice'
      && prev?.kind === 'practice'
      && Math.abs(prev.stamp - row.stamp) <= 20 * 60 * 1000
    ) {
      prev.question_count += row.item.question_count || 1
      prev.correct_count += row.item.correct_count || 0
      prev.names = [...new Set([...prev.names, ...row.item.names])]
      prev.stamp = Math.max(prev.stamp, row.stamp)
      prev.time = clock(prev.stamp)
      prev.key = `${prev.key}+${row.item.id}`
      const parts = itemParts({
        ...row.item,
        names: prev.names,
        question_count: prev.question_count,
        correct_count: prev.correct_count,
      })
      prev.action = parts.action
      prev.detail = parts.detail
      continue
    }
    const parts = itemParts(row.item)
    merged.push({
      key: String(row.item.id),
      kind: row.item.kind,
      time: clock(row.stamp),
      stamp: row.stamp,
      action: parts.action,
      detail: parts.detail,
      names: [...row.item.names],
      question_count: row.item.question_count || 0,
      correct_count: row.item.correct_count || 0,
    })
  }
  return merged
})

const groups = computed(() => {
  const map = new Map<string, TimelineItem[]>()
  for (const item of groupedItems.value) {
    const label = dayLabel(item.stamp)
    const list = map.get(label)
    if (list) list.push(item)
    else map.set(label, [item])
  }
  return [...map.entries()].map(([label, items]) => ({ label, items }))
})

const onSelect = (item: TimelineItem) => {
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

.study-timeline-head {
  flex-shrink: 0;
  height: 28px;
  padding: 0 14px;
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #718096);
}

.study-timeline-empty {
  flex: 1;
  padding: 4px 14px 12px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary, #94a3b8);
}

.study-timeline-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 10px 10px;
}

.study-timeline-day + .study-timeline-day {
  margin-top: 8px;
}

.study-timeline-day-label {
  padding: 0 4px 4px;
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
}

.study-timeline-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 5px 4px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.study-timeline-item:hover {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 5%, transparent);
}

.study-timeline-item:active {
  transform: scale(0.99);
}

.study-timeline-dot {
  flex: 0 0 7px;
  width: 7px;
  height: 7px;
  margin-top: 5px;
  border-radius: 50%;
  background: #94a3b8;
}

.study-timeline-item.is-learn .study-timeline-dot {
  background: #2F6F78;
}

.study-timeline-item.is-review .study-timeline-dot {
  background: #5E9AA3;
}

.study-timeline-item.is-practice .study-timeline-dot {
  background: #d97706;
}

.study-timeline-time {
  flex: 0 0 36px;
  margin-top: 1px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #94a3b8);
}

.study-timeline-copy {
  min-width: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-primary, #2d3748);
}

.study-timeline-action {
  display: inline-block;
  margin-right: 4px;
  padding: 0 5px;
  border-radius: 4px;
  font-weight: 600;
  line-height: 1.5;
}

.study-timeline-action.is-learn {
  background: color-mix(in srgb, #2F6F78 14%, transparent);
  color: #1F4F56;
}

.study-timeline-action.is-review {
  background: color-mix(in srgb, #5E9AA3 16%, transparent);
  color: #2F5C64;
}

.study-timeline-action.is-practice {
  background: color-mix(in srgb, #d97706 14%, transparent);
  color: #9a4d07;
}
</style>
