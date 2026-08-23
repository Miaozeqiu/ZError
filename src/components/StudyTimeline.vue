<template>
  <section class="study-timeline">
    <div class="study-chart">
      <div class="study-chart-tools">
        <div class="study-chart-years">
          <button
            v-for="year in chartYears"
            :key="year"
            type="button"
            class="study-chart-year"
            :class="{ 'is-on': chartYear === year }"
            @click="chartYear = year"
          >{{ year }}</button>
        </div>
        <div v-if="chartMode === 'heat'" class="study-heatmap-legend" aria-hidden="true">
          <span
            v-for="color in heatmapColors"
            :key="color"
            class="study-heatmap-swatch"
            :style="{ background: color }"
          />
        </div>
        <div class="study-chart-switch" role="tablist" aria-label="图表类型">
          <button
            type="button"
            role="tab"
            class="study-chart-switch-btn"
            :class="{ 'is-on': chartMode === 'line' }"
            :aria-selected="chartMode === 'line'"
            title="折线图"
            @click="setChartMode('line')"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <polyline points="2,12.2 5.4,7.6 8.6,9.6 14,3.4" />
            </svg>
          </button>
          <button
            type="button"
            role="tab"
            class="study-chart-switch-btn"
            :class="{ 'is-on': chartMode === 'heat' }"
            :aria-selected="chartMode === 'heat'"
            title="网格图"
            @click="setChartMode('heat')"
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <rect x="2" y="2" width="5" height="5" rx="1" />
              <rect x="9" y="2" width="5" height="5" rx="1" />
              <rect x="2" y="9" width="5" height="5" rx="1" />
              <rect x="9" y="9" width="5" height="5" rx="1" />
            </svg>
          </button>
        </div>
      </div>
      <div v-if="chartMode === 'line'" class="study-leaf-chart">
        <div
          v-if="leafChart.line"
          class="study-leaf-stage"
          @mousemove="onLineMove"
          @mouseleave="lineHover = null"
          @click="onLineClick"
        >
          <svg class="study-leaf-svg" :viewBox="`0 0 ${leafChart.width} ${leafChart.height}`" preserveAspectRatio="none">
            <path v-if="leafChart.area" class="study-leaf-area" :d="leafChart.area" />
            <path class="study-leaf-line" :d="leafChart.line" />
          </svg>
          <div
            v-if="lineHover"
            class="study-leaf-hover"
            :style="{ left: `${lineHover.left}%` }"
          >
            <span class="study-leaf-guide" />
            <span class="study-leaf-cursor" :style="{ top: `${lineHover.top}%` }" />
            <span class="study-leaf-tip">{{ lineHover.label }}</span>
          </div>
        </div>
        <div v-if="leafChart.line" class="study-leaf-axis">
          <span>{{ leafChart.startLabel }}</span>
          <span>{{ leafChart.endLabel }}</span>
        </div>
        <div v-else class="study-leaf-empty">还没有足够的学习记录</div>
      </div>
      <div v-else class="study-heatmap">
      <div ref="heatmapScroll" class="study-heatmap-scroll">
        <div class="study-heatmap-board" :style="heatmapBoardStyle">
          <span
            v-for="marker in heatmapMonths"
            :key="marker.key"
            class="study-heatmap-month"
            :style="marker.style"
          >{{ marker.label }}</span>
          <span
            v-for="day in heatmapDayLabels"
            :key="day.key"
            class="study-heatmap-weekday"
            :style="{ gridColumn: '1', gridRow: `${day.row}` }"
          >{{ day.label }}</span>
          <button
            v-for="cell in heatmapCells"
            :key="cell.key"
            type="button"
            class="study-heatmap-cell"
            :class="{
              'is-placeholder': cell.placeholder,
              'is-empty': !cell.placeholder && cell.count === 0,
              'is-active': activeCell?.key === cell.key,
              'is-selected': selectedDay === cell.key,
            }"
            :style="cell.style"
            :title="cell.title"
            :tabindex="cell.placeholder ? -1 : 0"
            @mouseenter="onCellEnter(cell)"
            @mouseleave="activeCell = activeCell?.key === cell.key ? null : activeCell"
            @click="selectDay(cell)"
          />
        </div>
      </div>
      </div>
    </div>
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
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { databaseService, type StudyActivity } from '../services/database'
import type { StudyGraphNode } from '../utils/studyGraph'

const props = defineProps<{
  subjectId?: number | null
  items: StudyActivity[]
  graph?: StudyGraphNode | null
  emptyText?: string
}>()

const emit = defineEmits<{
  select: [name: string]
}>()

const emptyText = computed(() => props.emptyText || '讲课、练习或复习后，会出现在这里')

const pad2 = (value: number) => String(value).padStart(2, '0')
const dateKey = (date: Date) => `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
const parseKey = (key: string) => {
  const [year, month, day] = key.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1)
}
const weekdayIndex = (date: Date) => {
  const day = date.getDay()
  return day === 0 ? 6 : day - 1
}

const leafIndex = computed(() => {
  const leavesOf = new Map<string, string[]>()
  const allLeaves: string[] = []
  const walk = (node: StudyGraphNode, isRoot = false) => {
    const name = node.name.trim()
    const kids = node.children.filter((child) => child.name.trim())
    if (!kids.length) {
      if (!isRoot && name) {
        leavesOf.set(name, [name])
        if (!allLeaves.includes(name)) allLeaves.push(name)
      }
      return
    }
    kids.forEach((child) => walk(child))
    if (!isRoot && name) {
      const leaves = kids.flatMap((child) => leavesOf.get(child.name.trim()) || [])
      leavesOf.set(name, [...new Set(leaves)])
    }
  }
  if (props.graph) walk(props.graph, true)
  return { leavesOf, allLeaves }
})

const resolveLeaves = (names: string[]) => {
  const { leavesOf } = leafIndex.value
  const resolved: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    if (!name) continue
    const leaves = leavesOf.get(name)
    if (leaves?.length) leaves.forEach((leaf) => resolved.push(leaf))
    else resolved.push(name)
  }
  return [...new Set(resolved)]
}

const HEATMAP_LABEL_W = 12
const HEATMAP_HEAD_H = 18
const HEATMAP_GAP = 3
const HEATMAP_CELL = 10
const heatmapDayLabels = [
  { key: 'mon', label: '一', row: 2 },
  { key: 'wed', label: '三', row: 4 },
  { key: 'fri', label: '五', row: 6 },
]
const heatmapColors = [
  'color-mix(in srgb, var(--text-primary, #2d3748) 8%, var(--bg-secondary, #fff))',
  'color-mix(in srgb, #2F6F78 28%, transparent)',
  'color-mix(in srgb, #2F6F78 48%, transparent)',
  'color-mix(in srgb, #2F6F78 70%, transparent)',
  '#2F6F78',
]

const CHART_MODE_KEY = 'zerror-study-chart-mode'
const readChartMode = (): 'line' | 'heat' => {
  try {
    return localStorage.getItem(CHART_MODE_KEY) === 'line' ? 'line' : 'heat'
  } catch {
    return 'heat'
  }
}

const heatmapScroll = ref<HTMLElement | null>(null)
const timelineList = ref<HTMLElement | null>(null)
const activeCell = ref<{ key: string; count: number; label: string } | null>(null)
const selectedDay = ref('')
const lineHover = ref<{
  x: number
  y: number
  left: number
  top: number
  label: string
  dayKey: string
  nearKey: string
} | null>(null)
const chartMode = ref<'line' | 'heat'>(readChartMode())
const chartYear = ref(new Date().getFullYear())
const extraItems = ref<StudyActivity[]>([])
const heatmapPoints = ref<Array<{ names: string[]; create_time: string }>>([])
const loadedDays = new Set<string>()
const inflightDays = new Map<string, Promise<void>>()
const dayOffset = new Map<string, number>()

const mergedItems = computed(() => {
  const map = new Map<number, StudyActivity>()
  for (const item of props.items) map.set(item.id, item)
  for (const item of extraItems.value) map.set(item.id, item)
  return [...map.values()]
})

const dailyLeaves = computed(() => {
  const byDay = new Map<string, Set<string>>()
  const rows = heatmapPoints.value.length
    ? heatmapPoints.value
    : mergedItems.value.filter((item) => item.kind === 'learn' || item.kind === 'review')
  for (const item of rows) {
    const stamp = parseStamp(item.create_time)
    if (!stamp) continue
    const key = dateKey(new Date(stamp))
    const set = byDay.get(key) || new Set<string>()
    resolveLeaves(item.names).forEach((leaf) => set.add(leaf))
    byDay.set(key, set)
  }
  return { byDay }
})

const heatmapRange = computed(() => {
  const year = chartYear.value
  const start = new Date(year, 0, 1)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const end = year === today.getFullYear() ? today : new Date(year, 11, 31)
  const data: Array<[string, number]> = []
  const cursor = new Date(start)
  while (cursor <= end) {
    const key = dateKey(cursor)
    data.push([key, dailyLeaves.value.byDay.get(key)?.size || 0])
    cursor.setDate(cursor.getDate() + 1)
  }
  const offset = weekdayIndex(start)
  const weeks = Math.max(1, Math.ceil((offset + data.length) / 7))
  return { start: dateKey(start), data, weeks, offset }
})

const heatmapMax = computed(() => Math.max(1, ...heatmapRange.value.data.map(([, count]) => count)))

const heatmapLevel = (count: number) => {
  if (count <= 0) return 0
  if (heatmapMax.value <= 1) return heatmapColors.length - 1
  return Math.min(heatmapColors.length - 1, Math.max(1, Math.ceil((count / heatmapMax.value) * (heatmapColors.length - 1))))
}

const heatmapBoardStyle = computed(() => ({
  gridTemplateColumns: `${HEATMAP_LABEL_W}px repeat(${heatmapRange.value.weeks}, ${HEATMAP_CELL}px)`,
  gridTemplateRows: `${HEATMAP_HEAD_H}px repeat(7, ${HEATMAP_CELL}px)`,
  columnGap: `${HEATMAP_GAP}px`,
  rowGap: `${HEATMAP_GAP}px`,
}))

const heatmapOffset = computed(() => heatmapRange.value.offset)

const heatmapCells = computed(() => {
  const offset = heatmapOffset.value
  const slots = heatmapRange.value.weeks * 7
  const cells: Array<{
    key: string
    count: number
    placeholder: boolean
    title: string
    label: string
    style: Record<string, string>
  }> = []
  for (let slot = 0; slot < slots; slot += 1) {
    const column = Math.floor(slot / 7) + 2
    const row = (slot % 7) + 2
    const index = slot - offset
    if (index < 0 || index >= heatmapRange.value.data.length) {
      cells.push({
        key: `pad-${slot}`,
        count: 0,
        placeholder: true,
        title: '',
        label: '',
        style: { gridColumn: `${column}`, gridRow: `${row}` },
      })
      continue
    }
    const [key, count] = heatmapRange.value.data[index]
    const date = parseKey(key)
    const label = `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
    const color = heatmapColors[heatmapLevel(count)]
    cells.push({
      key,
      count,
      placeholder: false,
      title: count > 0 ? `${label}，${count} 个最小知识点` : `${label} 还没学`,
      label,
      style: {
        gridColumn: `${column}`,
        gridRow: `${row}`,
        background: color,
        '--cell-accent': color,
      },
    })
  }
  return cells
})

const heatmapMonths = computed(() => {
  const offset = heatmapOffset.value
  const markers: Array<{ key: string; label: string; style: Record<string, string> }> = []
  let lastWeek = -4
  heatmapRange.value.data.forEach(([key], index) => {
    const date = parseKey(key)
    if (date.getDate() !== 1) return
    const week = Math.floor((offset + index) / 7) + 2
    if (week - lastWeek < 3) return
    lastWeek = week
    markers.push({
      key,
      label: `${date.getMonth() + 1}月`,
      style: {
        gridColumn: `${week} / span 3`,
        gridRow: '1',
      },
    })
  })
  return markers
})

const scrollHeatmapEnd = async () => {
  await nextTick()
  const el = heatmapScroll.value
  if (!el) return
  el.scrollLeft = chartYear.value === new Date().getFullYear() ? el.scrollWidth : 0
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

onMounted(() => {
  void scrollHeatmapEnd()
})

onUnmounted(() => {
  cancelScrollAnim()
  timelineList.value?.removeEventListener('wheel', onListUserScroll)
  timelineList.value?.removeEventListener('pointerdown', onListUserScroll)
})

watch(() => props.items.length, () => {
  void scrollHeatmapEnd()
})

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

const LEARN_CLUSTER_MS = 30 * 60 * 1000

const parentFamilies = computed(() => {
  const families: { parent: string; children: string[] }[] = []
  const walk = (node: StudyGraphNode, isRoot = false) => {
    const kids = node.children.filter((child) => child.name.trim())
    if (!isRoot && node.name.trim() && kids.length) {
      families.push({
        parent: node.name.trim(),
        children: kids.map((child) => child.name.trim()),
      })
    }
    kids.forEach((child) => walk(child))
  }
  if (props.graph) walk(props.graph, true)
  return families
})

const collapseNames = (names: string[]) => {
  const families = parentFamilies.value
  if (!families.length) return [...new Set(names.map((item) => item.trim()).filter(Boolean))]
  let current = [...new Set(names.map((item) => item.trim()).filter(Boolean))]
  let changed = true
  while (changed) {
    changed = false
    for (const family of families) {
      if (!family.children.length || family.children.includes(family.parent)) continue
      if (!family.children.every((child) => current.includes(child))) continue
      current = current.filter((name) => !family.children.includes(name))
      if (!current.includes(family.parent)) current.push(family.parent)
      changed = true
    }
  }
  return current
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
  const rows = [...mergedItems.value]
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
    const names = row.item.kind === 'learn' ? collapseNames(row.item.names) : [...row.item.names]
    const parts = itemParts({ ...row.item, names })
    merged.push({
      key: String(row.item.id),
      kind: row.item.kind,
      time: clock(row.stamp),
      stamp: row.stamp,
      action: parts.action,
      detail: parts.detail,
      names,
      question_count: row.item.question_count || 0,
      correct_count: row.item.correct_count || 0,
    })
  }
  return collapseLearnClusters(merged)
})

const collapseLearnClusters = (items: TimelineItem[]) => {
  const learns = items
    .filter((item) => item.kind === 'learn')
    .sort((a, b) => b.stamp - a.stamp)
  if (learns.length < 2) return items
  const clusters: TimelineItem[][] = []
  for (const item of learns) {
    const prev = clusters[clusters.length - 1]
    if (prev && Math.abs(prev[prev.length - 1].stamp - item.stamp) <= LEARN_CLUSTER_MS) {
      prev.push(item)
    } else {
      clusters.push([item])
    }
  }
  const replace = new Map<string, TimelineItem>()
  const drop = new Set<string>()
  for (const cluster of clusters) {
    if (cluster.length < 2) continue
    const names = collapseNames(cluster.flatMap((item) => item.names))
    const original = [...new Set(cluster.flatMap((item) => item.names))]
    if (names.length >= original.length && names.every((name) => original.includes(name))) continue
    const latest = cluster.reduce((best, item) => (item.stamp > best.stamp ? item : best), cluster[0])
    const parts = itemParts({
      id: 0,
      subject_id: 0,
      kind: 'learn',
      names,
      question_count: 0,
      correct_count: 0,
      create_time: '',
    })
    replace.set(latest.key, {
      ...latest,
      key: cluster.map((item) => item.key).join('+'),
      names,
      action: parts.action,
      detail: parts.detail,
    })
    cluster.forEach((item) => {
      if (item.key !== latest.key) drop.add(item.key)
    })
  }
  if (!replace.size) return items
  return items
    .filter((item) => !drop.has(item.key))
    .map((item) => replace.get(item.key) || item)
}

const dayStart = (stamp: number) => {
  const date = new Date(stamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

const monthLabel = (stamp: number) => {
  if (dayStart(stamp) === dayStart(Date.now())) return '今天'
  return `${new Date(stamp).getMonth() + 1}月`
}

const smoothPath = (points: Array<{ x: number; y: number }>) => {
  if (!points.length) return ''
  if (points.length === 1) return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1]
    const curr = points[i]
    const mid = ((prev.x + curr.x) / 2).toFixed(1)
    d += ` C ${mid} ${prev.y.toFixed(1)}, ${mid} ${curr.y.toFixed(1)}, ${curr.x.toFixed(1)} ${curr.y.toFixed(1)}`
  }
  return d
}

const chartEventRows = computed(() => {
  const rows = heatmapPoints.value.length
    ? heatmapPoints.value
    : mergedItems.value.filter((item) => item.kind === 'learn' || item.kind === 'review')
  return rows
    .map((item) => ({ stamp: parseStamp(item.create_time), leaves: resolveLeaves(item.names) }))
    .filter((item) => item.stamp && item.leaves.length)
    .sort((a, b) => a.stamp - b.stamp)
})

const chartYears = computed(() => {
  const years = new Set<number>([new Date().getFullYear()])
  for (const item of chartEventRows.value) {
    years.add(new Date(item.stamp).getFullYear())
  }
  return [...years].sort((a, b) => a - b)
})

const leafChart = computed(() => {
  const width = 232
  const height = 68
  const pad = { l: 2, r: 2, t: 8, b: 4 }
  const empty = {
    line: '',
    area: '',
    width,
    height,
    padL: pad.l,
    padR: pad.r,
    points: [] as Array<{ x: number; y: number; day: number; dayKey: string; value: number; recorded: boolean }>,
    startLabel: '',
    endLabel: '',
  }
  const events = chartEventRows.value
  const year = chartYear.value
  const yearStart = new Date(year, 0, 1).getTime()
  const yearLimit = Math.min(new Date(year, 11, 31).getTime(), dayStart(Date.now()))
  const firstInYear = events.find((item) => {
    const date = new Date(item.stamp)
    return date.getFullYear() === year
  })
  if (!firstInYear || yearLimit < yearStart) return empty
  const start = new Date(year, new Date(firstInYear.stamp).getMonth(), 1).getTime()
  const days: number[] = []
  const cursorDate = new Date(start)
  const lastDay = new Date(yearLimit)
  while (cursorDate <= lastDay) {
    days.push(cursorDate.getTime())
    cursorDate.setDate(cursorDate.getDate() + 1)
  }
  if (!days.length) return empty
  const seen = new Set<string>()
  let cursor = 0
  while (cursor < events.length && events[cursor].stamp < start) {
    events[cursor].leaves.forEach((leaf) => seen.add(leaf))
    cursor += 1
  }
  const series = days.map((day) => {
    const next = new Date(day)
    next.setDate(next.getDate() + 1)
    const limit = next.getTime()
    while (cursor < events.length && events[cursor].stamp < limit) {
      events[cursor].leaves.forEach((leaf) => seen.add(leaf))
      cursor += 1
    }
    return { day, value: seen.size }
  })
  const recorded = new Set<string>()
  for (const item of events) {
    if (item.stamp < start || item.stamp >= yearLimit + 86400000) continue
    recorded.add(dateKey(new Date(item.stamp)))
  }
  const max = Math.max(leafIndex.value.allLeaves.length, seen.size, 1)
  const innerW = width - pad.l - pad.r
  const innerH = height - pad.t - pad.b
  const xAt = (index: number) => pad.l + (series.length === 1 ? innerW / 2 : (index / (series.length - 1)) * innerW)
  const yAt = (value: number) => pad.t + (1 - value / max) * innerH
  const points = series.map((point, index) => {
    const dayKey = dateKey(new Date(point.day))
    return {
      x: xAt(index),
      y: yAt(point.value),
      day: point.day,
      dayKey,
      value: point.value,
      recorded: recorded.has(dayKey),
    }
  })
  const step = Math.max(1, Math.ceil(points.length / 64))
  const sampled = points.filter((_, index) => index === 0 || index === points.length - 1 || index % step === 0)
  const line = smoothPath(sampled)
  const lastDot = sampled[sampled.length - 1]
  const floor = (pad.t + innerH).toFixed(1)
  const area = lastDot
    ? `${line} L ${lastDot.x.toFixed(1)} ${floor} L ${sampled[0].x.toFixed(1)} ${floor} Z`
    : ''
  return {
    line,
    area,
    width,
    height,
    padL: pad.l,
    padR: pad.r,
    points,
    startLabel: monthLabel(days[0]),
    endLabel: monthLabel(days[days.length - 1]),
  }
})

const dayPointLabel = (stamp: number) => {
  const date = new Date(stamp)
  if (dayStart(stamp) === dayStart(Date.now())) return '今天'
  if (date.getFullYear() === new Date().getFullYear()) return `${date.getMonth() + 1}月${date.getDate()}日`
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

const nearestRecordedKey = (dayKey: string) => {
  const recorded = leafChart.value.points.filter((point) => point.recorded)
  if (!recorded.length) return ''
  const target = parseKey(dayKey).getTime()
  return recorded.reduce((best, point) => {
    const dist = Math.abs(point.day - target)
    const bestDist = Math.abs(best.day - target)
    return dist < bestDist ? point : best
  }).dayKey
}

const pointFromClientX = (clientX: number, el: HTMLElement) => {
  const chart = leafChart.value
  if (!chart.points.length) return null
  const rect = el.getBoundingClientRect()
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width))
  const x = chart.padL + ratio * (chart.width - chart.padL - chart.padR)
  let best = chart.points[0]
  let bestDist = Infinity
  for (const point of chart.points) {
    const dist = Math.abs(point.x - x)
    if (dist < bestDist) {
      best = point
      bestDist = dist
    }
  }
  const nearKey = nearestRecordedKey(best.dayKey)
  return {
    x: best.x,
    y: best.y,
    left: (best.x / chart.width) * 100,
    top: (best.y / chart.height) * 100,
    label: dayPointLabel(best.day),
    dayKey: best.dayKey,
    nearKey,
  }
}

const onLineMove = (event: MouseEvent) => {
  const next = pointFromClientX(event.clientX, event.currentTarget as HTMLElement)
  lineHover.value = next
  if (next?.nearKey) void warmupDay(next.nearKey)
}

const onLineClick = async (event: MouseEvent) => {
  const hit = lineHover.value || pointFromClientX(event.clientX, event.currentTarget as HTMLElement)
  const key = hit?.nearKey
  if (!key) return
  await selectDay({ key, placeholder: false })
}

const setChartMode = (mode: 'line' | 'heat') => {
  chartMode.value = mode
  try {
    localStorage.setItem(CHART_MODE_KEY, mode)
  } catch {
    // ignore
  }
  if (mode === 'heat') void scrollHeatmapEnd()
}

const groups = computed(() => {
  const map = new Map<string, TimelineItem[]>()
  for (const item of groupedItems.value) {
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

const oldestLoadedKey = computed(() => {
  let oldest = ''
  for (const item of mergedItems.value) {
    const stamp = parseStamp(item.create_time)
    if (!stamp) continue
    const key = dateKey(new Date(stamp))
    if (!oldest || key < oldest) oldest = key
  }
  return oldest
})

const dayBounds = (key: string) => {
  const start = parseKey(key).getTime()
  return { start, end: start + 86400000 }
}

const shiftDay = (key: string, days: number) => {
  const date = parseKey(key)
  date.setDate(date.getDate() + days)
  return dateKey(date)
}

const dayScrollTop = (key: string) => {
  const list = timelineList.value
  const el = list?.querySelector<HTMLElement>(`[data-day="${key}"]`)
  if (!list || !el) return null
  return list.scrollTop + el.getBoundingClientRect().top - list.getBoundingClientRect().top
}

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

const dayNeedsFetch = (key: string) => {
  if (loadedDays.has(key)) return false
  if (!oldestLoadedKey.value) return true
  return oldestLoadedKey.value >= key
}

const fetchDay = async (key: string) => {
  const id = Number(props.subjectId)
  if (!Number.isFinite(id) || id <= 0) {
    loadedDays.add(key)
    return
  }
  const pending = inflightDays.get(key)
  if (pending) {
    await pending
    return
  }
  const task = (async () => {
    const { start, end } = dayBounds(key)
    try {
      const rows = await databaseService.listStudyActivityBetween(id, start, end)
      if (rows.length) {
        const seen = new Set(extraItems.value.map((item) => item.id))
        const next = rows.filter((item) => !seen.has(item.id) && !props.items.some((row) => row.id === item.id))
        if (next.length) extraItems.value = [...extraItems.value, ...next]
      }
    } catch {
      // keep the already-loaded timeline if one day fails
    }
    loadedDays.add(key)
    inflightDays.delete(key)
  })()
  inflightDays.set(key, task)
  await task
}

const warmupDay = async (key: string) => {
  if (dayNeedsFetch(key)) await fetchDay(key)
  else loadedDays.add(key)
  await nextTick()
  measureDay(key)
}

const onCellEnter = (cell: { key: string; placeholder: boolean; count: number; label: string }) => {
  if (cell.placeholder) {
    activeCell.value = null
    return
  }
  activeCell.value = cell
  void warmupDay(cell.key)
  void warmupDay(shiftDay(cell.key, -1))
  void warmupDay(shiftDay(cell.key, 1))
}

const selectDay = async (cell: { key: string; placeholder: boolean }) => {
  if (cell.placeholder) return
  selectedDay.value = cell.key
  await warmupDay(cell.key)
  jumpToDay(cell.key)
}

const loadHeatmap = async () => {
  const id = Number(props.subjectId)
  if (!Number.isFinite(id) || id <= 0) {
    heatmapPoints.value = []
    return
  }
  try {
    heatmapPoints.value = await databaseService.listStudyHeatmap(id)
  } catch {
    heatmapPoints.value = []
  }
}

watch(
  () => props.subjectId,
  () => {
    extraItems.value = []
    loadedDays.clear()
    inflightDays.clear()
    dayOffset.clear()
    selectedDay.value = ''
    chartYear.value = new Date().getFullYear()
    void loadHeatmap()
  },
  { immediate: true },
)

watch(
  () => [props.items[0]?.id, props.items.length] as const,
  () => {
    dayOffset.clear()
    void loadHeatmap()
  },
)

watch(
  () => extraItems.value.length,
  () => {
    dayOffset.clear()
  },
)

watch(chartYears, (years) => {
  if (!years.includes(chartYear.value)) chartYear.value = years[years.length - 1]
})

watch(chartYear, () => {
  if (chartMode.value === 'heat') void scrollHeatmapEnd()
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

.study-chart {
  position: relative;
  flex-shrink: 0;
  padding: 8px 10px 10px;
}

.study-chart-tools {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 22px;
  margin-bottom: 6px;
}

.study-heatmap-legend {
  flex: 1;
  display: flex;
  justify-content: flex-end;
  gap: 3px;
}

.study-chart-years {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}

.study-chart-year {
  flex-shrink: 0;
  padding: 2px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  font-size: 12px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #94a3b8);
  cursor: pointer;
}

.study-chart-year.is-on {
  color: #2F6F78;
  background: color-mix(in srgb, #2F6F78 10%, transparent);
}

.study-chart-switch {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
}

.study-chart-switch-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #94a3b8);
  cursor: pointer;
}

.study-chart-switch-btn svg {
  width: 13px;
  height: 13px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.6;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.study-chart-switch-btn svg rect {
  fill: currentColor;
  fill-opacity: 0.22;
}

.study-chart-switch-btn.is-on {
  color: #2F6F78;
  background: color-mix(in srgb, var(--bg-secondary, #fff) 88%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, #2F6F78 14%, transparent);
}

[data-theme="dark"] .study-chart-switch-btn.is-on {
  color: #7ab8c0;
  background: color-mix(in srgb, var(--bg-tertiary, #3a3a3c) 88%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, #5e9aa3 28%, transparent);
}

.study-leaf-chart {
  min-height: 80px;
}

.study-leaf-stage {
  position: relative;
  padding-top: 16px;
  cursor: crosshair;
}

.study-leaf-hover {
  position: absolute;
  top: 16px;
  bottom: 0;
  width: 0;
  transform: translateX(-50%);
  pointer-events: none;
}

.study-leaf-guide {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 0;
  width: 1px;
  background: color-mix(in srgb, #2F6F78 32%, transparent);
}

.study-leaf-cursor {
  position: absolute;
  left: 0;
  width: 7px;
  height: 7px;
  border: 1.5px solid #2F6F78;
  border-radius: 50%;
  background: var(--bg-secondary, #fff);
  transform: translate(-50%, -50%);
}

.study-leaf-tip {
  position: absolute;
  top: -2px;
  left: 0;
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--bg-secondary, #fff) 88%, transparent);
  color: #2F6F78;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 1.4;
  white-space: nowrap;
  transform: translate(-50%, -100%);
}

.study-leaf-svg {
  display: block;
  width: 100%;
  height: 68px;
  overflow: visible;
}

.study-leaf-area {
  fill: color-mix(in srgb, #2F6F78 12%, transparent);
}

.study-leaf-line {
  fill: none;
  stroke: #2F6F78;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.study-leaf-axis {
  display: flex;
  justify-content: space-between;
  margin-top: 2px;
  font-size: 10px;
  color: var(--text-secondary, #94a3b8);
}

.study-leaf-empty {
  padding: 18px 0 8px;
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
}

.study-heatmap {
  position: relative;
}

.study-heatmap-swatch {
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.study-heatmap-scroll {
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: thin;
}

.study-heatmap-board {
  display: grid;
  width: max-content;
  padding: 2px 22px 0 0;
}

.study-heatmap-month,
.study-heatmap-weekday {
  font-size: 10px;
  line-height: 1;
  color: var(--text-secondary, #94a3b8);
  pointer-events: none;
}

.study-heatmap-month {
  z-index: 1;
  align-self: end;
  overflow: visible;
  white-space: nowrap;
}

.study-heatmap-weekday {
  display: flex;
  align-items: center;
}

.study-heatmap-cell {
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: none;
  border-radius: 2px;
  appearance: none;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 8%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--cell-accent, #2d3748) 16%, transparent);
  cursor: pointer;
}

.study-heatmap-cell.is-placeholder {
  visibility: hidden;
  pointer-events: none;
}

.study-heatmap-cell.is-active,
.study-heatmap-cell.is-selected {
  transform: translateY(-1px);
  filter: saturate(1.08);
}

.study-heatmap-cell.is-selected {
  box-shadow:
    inset 0 0 0 1.5px #2F6F78,
    0 0 0 1px color-mix(in srgb, #2F6F78 35%, transparent);
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
