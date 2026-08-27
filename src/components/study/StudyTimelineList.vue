<template>
  <div v-if="!groups.length" class="study-timeline-empty">
    {{ emptyText }}
  </div>
  <div v-else ref="timelineList" class="study-timeline-list">
    <div
      v-for="group in groups"
      :key="group.key"
      class="study-timeline-day"
      :class="{ 'is-selected': selectedDay === group.key }"
      :data-day="group.key"
    >
      <div class="study-timeline-day-label">{{ group.label }}</div>
      <button
        v-for="item in group.items"
        :key="item.key"
        type="button"
        class="study-timeline-item"
        :class="`is-${item.kind}`"
        @click="$emit('select', item)"
      >
        <span
          class="study-timeline-rail"
          :class="{ 'is-instant': item.startTime === item.endTime }"
          aria-hidden="true"
        >
          <span class="study-timeline-rail-node">
            <span class="study-timeline-dot" />
            <span class="study-timeline-time">{{ item.startTime }}</span>
          </span>
          <span v-if="item.startTime !== item.endTime" class="study-timeline-rail-line" />
          <span v-if="item.startTime !== item.endTime" class="study-timeline-rail-node">
            <span class="study-timeline-dot is-end" />
            <span class="study-timeline-time">{{ item.endTime }}</span>
          </span>
        </span>
        <span class="study-timeline-copy">
          <span class="study-timeline-action" :class="`is-${item.kind}`">{{ item.action }}</span>
          <span v-if="item.detail">{{ item.detail }}</span>
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onUnmounted, ref, watch } from 'vue'

export type StudyTimelineItem = {
  key: string
  kind: string
  startTime: string
  endTime: string
  stamp: number
  startStamp?: number
  endStamp?: number
  minutes?: number
  action: string
  detail: string
  names: string[]
  question_count: number
  correct_count: number
}

export type StudyTimelineGroup = {
  key: string
  label: string
  items: StudyTimelineItem[]
}

defineProps<{
  groups: StudyTimelineGroup[]
  emptyText: string
  selectedDay: string
}>()

defineEmits<{
  select: [item: StudyTimelineItem]
}>()

const timelineList = ref<HTMLElement | null>(null)

const dayScrollTop = (key: string) => {
  const list = timelineList.value
  const el = list?.querySelector<HTMLElement>(`[data-day="${key}"]`)
  if (!list || !el) return null
  return list.scrollTop + el.getBoundingClientRect().top - list.getBoundingClientRect().top
}

const dayOffset = new Map<string, number>()

const measureDay = (key: string) => {
  const top = dayScrollTop(key)
  if (top != null) dayOffset.set(key, top)
}

const easeOutCubic = (t: number) => 1 - (1 - t) ** 3
const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

let scrollAnim = 0
let scrolling = false

const cancelScrollAnim = () => {
  if (scrollAnim) cancelAnimationFrame(scrollAnim)
  scrollAnim = 0
  scrolling = false
}

const jumpToDay = (key: string) => {
  const list = timelineList.value
  if (!list) return
  const raw = dayOffset.get(key) ?? dayScrollTop(key)
  if (raw == null) return
  const clamp = (value: number) => Math.max(0, Math.min(value, Math.max(0, list.scrollHeight - list.clientHeight)))
  const target = clamp(raw)
  if (reduceMotion() || Math.abs(target - list.scrollTop) < 2) {
    cancelScrollAnim()
    list.scrollTop = target
    return
  }
  const from = list.scrollTop
  const duration = Math.min(560, Math.max(220, Math.abs(target - from) * 0.32))
  cancelScrollAnim()
  scrolling = true
  const startedAt = performance.now()
  const step = (now: number) => {
    const live = clamp(dayOffset.get(key) ?? dayScrollTop(key) ?? target)
    const t = Math.min(1, (now - startedAt) / duration)
    list.scrollTop = from + (live - from) * easeOutCubic(t)
    if (t < 1) {
      scrollAnim = requestAnimationFrame(step)
      return
    }
    scrollAnim = 0
    scrolling = false
  }
  scrollAnim = requestAnimationFrame(step)
}

const onListUserScroll = () => {
  if (scrolling) cancelScrollAnim()
}

watch(timelineList, (el, prev) => {
  prev?.removeEventListener('wheel', onListUserScroll)
  prev?.removeEventListener('pointerdown', onListUserScroll)
  el?.addEventListener('wheel', onListUserScroll, { passive: true })
  el?.addEventListener('pointerdown', onListUserScroll)
})

onUnmounted(() => {
  cancelScrollAnim()
  timelineList.value?.removeEventListener('wheel', onListUserScroll)
  timelineList.value?.removeEventListener('pointerdown', onListUserScroll)
})

const clearOffsets = () => {
  dayOffset.clear()
}

defineExpose({
  jumpToDay,
  measureDay,
  clearOffsets,
})
</script>

<style scoped>
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

.study-timeline-day {
  border-radius: 8px;
  background: transparent;
  transition: background-color 280ms ease-out;
}

.study-timeline-day + .study-timeline-day {
  margin-top: 8px;
}

.study-timeline-day.is-selected {
  background: color-mix(in srgb, #2F6F78 7%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .study-timeline-day {
    transition: none;
  }
}

.study-timeline-day-label {
  padding: 0 4px 4px;
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
}

.study-timeline-item {
  display: flex;
  align-items: stretch;
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

.study-timeline-rail {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex: 0 0 auto;
  min-width: 44px;
}

.study-timeline-rail.is-instant {
  justify-content: flex-start;
  padding-top: 3px;
}

.study-timeline-rail-node {
  display: flex;
  align-items: center;
  gap: 5px;
}

.study-timeline-rail-line {
  flex: 1 1 auto;
  width: 1.5px;
  min-height: 8px;
  margin: 2px 0 2px 2.75px;
  border-radius: 1px;
  background: color-mix(in srgb, #64748b 38%, transparent);
}

.study-timeline-dot {
  flex: 0 0 7px;
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #94a3b8;
}

.study-timeline-dot.is-end {
  background: #64748b;
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

.study-timeline-item.is-summary .study-timeline-dot {
  background: #64748b;
}

.study-timeline-action.is-summary {
  color: #64748b;
}

.study-timeline-item.is-summary .study-timeline-copy {
  padding-top: 1px;
  white-space: normal;
  line-height: 1.45;
}

.study-timeline-time {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
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
