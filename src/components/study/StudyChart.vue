<template>
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
      <div v-else class="study-leaf-empty">还没有学习时长记录</div>
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
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue'

export type StudyChartSession = {
  start: number
  end: number
}

const props = defineProps<{
  sessions: StudyChartSession[]
  subjectId?: number | null
  selectedDay: string
  itemCount?: number
}>()

const emit = defineEmits<{
  'select-day': [key: string]
  'preview-day': [key: string]
}>()

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

const formatDuration = (minutes: number) => {
  const total = Math.max(1, Math.round(minutes))
  if (total < 60) return `${total} 分钟`
  const hours = Math.floor(total / 60)
  const rest = total % 60
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`
}

const dayStart = (stamp: number) => {
  const date = new Date(stamp)
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
}

const addSessionMinutesToDays = (
  startMs: number,
  endMs: number,
  byDay: Map<string, number>,
) => {
  let cursor = startMs
  while (cursor < endMs) {
    const next = dayStart(cursor) + 86400000
    const sliceEnd = Math.min(endMs, next)
    const minutes = (sliceEnd - cursor) / 60000
    const key = dateKey(new Date(cursor))
    byDay.set(key, (byDay.get(key) || 0) + minutes)
    cursor = sliceEnd
  }
}

const dailyStudyMinutes = computed(() => {
  const byDay = new Map<string, number>()
  for (const session of props.sessions) {
    addSessionMinutesToDays(session.start, session.end, byDay)
  }
  return byDay
})

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
const activeCell = ref<{ key: string; count: number; label: string } | null>(null)
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
    data.push([key, Math.round(dailyStudyMinutes.value.get(key) || 0)])
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
      title: count > 0 ? `${label}，学习 ${formatDuration(count)}` : `${label} 未学习`,
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

onMounted(() => {
  void scrollHeatmapEnd()
})

watch(() => props.itemCount, () => {
  void scrollHeatmapEnd()
})

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

const chartYears = computed(() => {
  const years = new Set<number>([new Date().getFullYear()])
  for (const session of props.sessions) {
    years.add(new Date(session.start).getFullYear())
    years.add(new Date(session.end).getFullYear())
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
  const year = chartYear.value
  const yearStart = new Date(year, 0, 1).getTime()
  const yearLimit = Math.min(new Date(year, 11, 31).getTime(), dayStart(Date.now()))
  const sessions = props.sessions.filter((item) => (
    new Date(item.start).getFullYear() === year || new Date(item.end).getFullYear() === year
  ))
  if (!sessions.length || yearLimit < yearStart) return empty

  const days: number[] = []
  const cursorDate = new Date(yearStart)
  const lastDay = new Date(yearLimit)
  while (cursorDate <= lastDay) {
    days.push(cursorDate.getTime())
    cursorDate.setDate(cursorDate.getDate() + 1)
  }
  if (!days.length) return empty

  const daily = dailyStudyMinutes.value
  let cumulative = 0
  const series = days.map((day) => {
    const key = dateKey(new Date(day))
    cumulative += daily.get(key) || 0
    return { day, value: cumulative }
  })
  const recorded = new Set<string>()
  for (const session of sessions) {
    let cursor = Math.max(session.start, yearStart)
    const end = Math.min(session.end, yearLimit + 86400000)
    while (cursor < end) {
      recorded.add(dateKey(new Date(cursor)))
      cursor = dayStart(cursor) + 86400000
    }
  }
  const max = Math.max(...series.map((item) => item.value), 1)
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
    label: `${dayPointLabel(best.day)} · 累计 ${formatDuration(best.value)}`,
    dayKey: best.dayKey,
    nearKey,
  }
}

const onLineMove = (event: MouseEvent) => {
  const next = pointFromClientX(event.clientX, event.currentTarget as HTMLElement)
  lineHover.value = next
  if (next?.nearKey) emit('preview-day', next.nearKey)
}

const onLineClick = async (event: MouseEvent) => {
  const hit = lineHover.value || pointFromClientX(event.clientX, event.currentTarget as HTMLElement)
  const key = hit?.nearKey
  if (!key) return
  emit('select-day', key)
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

const shiftDay = (key: string, days: number) => {
  const date = parseKey(key)
  date.setDate(date.getDate() + days)
  return dateKey(date)
}

const onCellEnter = (cell: { key: string; placeholder: boolean; count: number; label: string }) => {
  if (cell.placeholder) {
    activeCell.value = null
    return
  }
  activeCell.value = cell
  emit('preview-day', cell.key)
  emit('preview-day', shiftDay(cell.key, -1))
  emit('preview-day', shiftDay(cell.key, 1))
}

const selectDay = (cell: { key: string; placeholder: boolean }) => {
  if (cell.placeholder) return
  emit('select-day', cell.key)
}

watch(
  () => props.subjectId,
  () => {
    chartYear.value = new Date().getFullYear()
  },
)

watch(chartYears, (years) => {
  if (!years.includes(chartYear.value)) chartYear.value = years[years.length - 1]
})

watch(chartYear, () => {
  if (chartMode.value === 'heat') void scrollHeatmapEnd()
})
</script>

<style scoped>
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
</style>
