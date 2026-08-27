<template>
  <section class="study-data">
    <div class="study-data-body">
      <div class="study-data-head">
        <div class="study-data-meter">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <circle class="study-data-track" cx="32" cy="32" r="22" />
            <circle
              class="study-data-arc"
              cx="32"
              cy="32"
              r="22"
              :stroke="ringColor"
              :stroke-dasharray="arcDash"
            />
          </svg>
          <div class="study-data-readout">
            <strong>{{ masteryPct }}%</strong>
          </div>
        </div>
        <div class="study-data-head-copy">
          <div class="study-data-scope" :title="scopeName">{{ scopeName }}</div>
          <div class="study-data-time">
            <template v-for="(part, index) in durationParts" :key="part.unit">
              <strong>{{ part.value }}</strong>
              <em>{{ part.unit }}</em>
              <span v-if="index < durationParts.length - 1" class="study-data-time-gap" />
            </template>
          </div>
        </div>
      </div>
      <div class="study-data-legend" aria-hidden="true">
        <span v-for="item in masteryLegend" :key="item.label" class="study-data-swatch">
          <i :style="{ background: item.color }" />
          {{ item.label }}
        </span>
      </div>

      <div class="study-data-block">
        <div class="study-data-block-head">
          <span>做过</span>
          <strong>{{ questionStats.practiced }}</strong>
          <em v-if="accuracyLabel">{{ accuracyLabel }}</em>
        </div>
        <div class="study-data-bar" aria-hidden="true">
          <i
            v-for="item in questionCards"
            :key="item.key"
            :class="[`is-${item.tone}`, { 'is-empty': !item.value }]"
            :style="{ width: item.width }"
          />
        </div>
        <div class="study-data-stat-grid">
          <div v-for="item in questionCards" :key="item.key" class="study-data-stat" :class="`is-${item.tone}`">
            <strong>{{ item.value }}</strong>
            <span>{{ item.label }}</span>
          </div>
        </div>
      </div>

      <div class="study-data-block">
        <StudyForgettingCurve v-if="node" :node="node" :graph="graph" />
        <div v-else class="study-data-empty">点图谱中的知识点查看遗忘曲线</div>
      </div>

      <div v-if="questions.length" class="study-data-block">
        <div class="study-data-block-head">
          <span>相关题</span>
          <strong>{{ questions.length }}</strong>
        </div>
        <button
          v-for="item in questions.slice(0, 4)"
          :key="item.id"
          class="study-data-question"
          type="button"
          :title="item.question"
          @click="emit('open-question', item.id)"
        >{{ item.question }}</button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import StudyForgettingCurve from './StudyForgettingCurve.vue'
import { databaseService, type StudyActivity } from '../services/database'
import { MASTERY_COLORS, retentionColor } from '../utils/studyGraphForce'
import {
  classifyQuestionStats,
  emptyQuestionCounts,
  leafStudyMinutes,
  rolledStudyMinutes,
  studyDurationParts,
} from '../utils/studyDataStats'
import { resolveCurveNode, rolledRetention } from '../utils/studyForgetting'
import type { StudyGraphNode } from '../utils/studyGraph'

const props = defineProps<{
  graph?: StudyGraphNode | null
  node?: StudyGraphNode | null
  subjectId?: number | null
  activities?: StudyActivity[]
  questions?: { id: number; question: string }[]
}>()

const emit = defineEmits<{
  'open-question': [id: number]
}>()

const nowTick = ref(Date.now())
const questionStats = ref(emptyQuestionCounts())
let clockTimer: number | null = null
let loadSeq = 0
const ARC = 2 * Math.PI * 22

const questions = computed(() => props.questions || [])
const subjectId = computed(() => {
  const passed = Number(props.subjectId)
  if (Number.isFinite(passed) && passed > 0) return passed
  const fromGraph = Number(String(props.graph?.id || '').replace(/^subject:/, ''))
  return Number.isFinite(fromGraph) && fromGraph > 0 ? fromGraph : null
})

const statsNode = computed(() => {
  if (props.node && props.graph) return resolveCurveNode(props.node, props.graph)
  return props.node || props.graph || null
})

const scopeName = computed(() => String(statsNode.value?.name || '').trim() || '本科目')

const masteryScore = computed(() => {
  const target = statsNode.value
  if (!target) return null
  return rolledRetention(target, nowTick.value)
})

const masteryPct = computed(() => Math.round((masteryScore.value ?? 0) * 100))
const ringColor = computed(() => retentionColor(masteryScore.value).stroke)
const arcDash = computed(() => {
  const value = Math.max(0, Math.min(1, masteryScore.value ?? 0)) * ARC
  return `${value} ${ARC}`
})

const leafMinutes = computed(() => (
  props.graph ? leafStudyMinutes(props.graph, props.activities || []) : new Map<string, number>()
))

const durationMinutes = computed(() => {
  const target = statsNode.value
  if (!target) return 0
  return rolledStudyMinutes(target, leafMinutes.value)
})

const durationParts = computed(() => studyDurationParts(durationMinutes.value))

const accuracyLabel = computed(() => {
  const { practiced, correct, corrected } = questionStats.value
  if (!practiced) return ''
  return `正确率 ${Math.round(((correct + corrected) / practiced) * 100)}%`
})

const questionCards = computed(() => {
  const { practiced, correct, wrong, corrected } = questionStats.value
  const share = (value: number) => (practiced ? `${(value / practiced) * 100}%` : '0%')
  return [
    { key: 'correct', label: '正确', value: correct, tone: 'ok', width: share(correct) },
    { key: 'wrong', label: '错误', value: wrong, tone: 'bad', width: share(wrong) },
    { key: 'corrected', label: '已改正', value: corrected, tone: 'fix', width: share(corrected) },
  ]
})

const masteryLegend = [
  { label: '未评估', color: MASTERY_COLORS[0].fill },
  { label: '遗忘中', color: retentionColor(0.2).fill },
  { label: '记忆中', color: retentionColor(0.6).fill },
  { label: '牢固', color: retentionColor(1).fill },
]

const loadQuestionStats = async () => {
  const seq = ++loadSeq
  const nodeId = Number(statsNode.value?.nodeId)
  const subject = subjectId.value
  try {
    const ids = Number.isFinite(nodeId) && nodeId > 0
      ? await databaseService.listNodeQuestions(nodeId)
      : subject
        ? await databaseService.listSubjectQuestions(subject)
        : []
    const items = ids.length ? await databaseService.getQuestionPracticeStats(ids) : []
    if (seq !== loadSeq) return
    questionStats.value = classifyQuestionStats(items)
  } catch {
    if (seq !== loadSeq) return
    questionStats.value = emptyQuestionCounts()
  }
}

watch(
  () => [statsNode.value?.nodeId, statsNode.value?.id, subjectId.value],
  () => {
    void loadQuestionStats()
  },
  { immediate: true },
)

const onStatsRefresh = () => {
  void loadQuestionStats()
}

onMounted(() => {
  clockTimer = window.setInterval(() => {
    nowTick.value = Date.now()
  }, 30000)
  window.addEventListener('study-activity-updated', onStatsRefresh)
  window.addEventListener('question-knowledge-updated', onStatsRefresh)
})

onUnmounted(() => {
  if (clockTimer != null) window.clearInterval(clockTimer)
  window.removeEventListener('study-activity-updated', onStatsRefresh)
  window.removeEventListener('question-knowledge-updated', onStatsRefresh)
})
</script>

<style scoped>
.study-data {
  flex: 1;
  width: 260px;
  min-width: 260px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  border-left: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 42%, transparent);
}

.study-data-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 12px 12px 16px;
}

.study-data-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.study-data-meter {
  position: relative;
  flex-shrink: 0;
  width: 56px;
  height: 56px;
}

.study-data-meter svg {
  width: 56px;
  height: 56px;
  transform: rotate(-90deg);
}

.study-data-track,
.study-data-arc {
  fill: none;
  stroke-width: 6;
  stroke-linecap: round;
}

.study-data-track {
  stroke: color-mix(in srgb, var(--text-secondary, #718096) 16%, transparent);
}

.study-data-readout {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.study-data-readout strong {
  font-size: 13px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary, #2d3748);
  line-height: 1;
}

.study-data-head-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.study-data-scope {
  overflow: hidden;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
  line-height: 1.25;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.study-data-time {
  display: flex;
  align-items: baseline;
  min-width: 0;
  color: var(--text-primary, #2d3748);
}

.study-data-time strong {
  font-size: 20px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  line-height: 1;
}

.study-data-time em {
  margin-left: 3px;
  font-size: 11px;
  font-style: normal;
  color: var(--text-secondary, #718096);
  line-height: 1;
}

.study-data-time-gap {
  width: 6px;
}

.study-data-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 10px;
  margin-top: 10px;
}

.study-data-swatch {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 10px;
  color: var(--text-secondary, #718096);
  line-height: 1;
  white-space: nowrap;
}

.study-data-swatch i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
}

.study-data-block {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 42%, transparent);
}

.study-data-block-head {
  display: flex;
  align-items: baseline;
  gap: 6px;
  margin-bottom: 8px;
  min-width: 0;
}

.study-data-block-head span {
  font-size: 11px;
  color: var(--text-secondary, #718096);
  line-height: 1;
}

.study-data-block-head strong {
  font-size: 15px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary, #2d3748);
  line-height: 1;
}

.study-data-block-head em {
  margin-left: auto;
  font-size: 11px;
  font-style: normal;
  color: var(--text-secondary, #94a3b8);
  line-height: 1;
}

.study-data-bar {
  display: flex;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-secondary, #718096) 12%, transparent);
}

.study-data-bar i {
  display: block;
  height: 100%;
  min-width: 0;
  transition: width 200ms ease-out;
}

.study-data-bar i.is-ok {
  background: #3d9a6a;
}

.study-data-bar i.is-bad {
  background: #d15a5a;
}

.study-data-bar i.is-fix {
  background: #2F6F78;
}

.study-data-bar i.is-empty {
  width: 0;
}

.study-data-stat-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.study-data-stat {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.study-data-stat strong {
  font-size: 16px;
  font-weight: 650;
  font-variant-numeric: tabular-nums;
  color: var(--text-primary, #2d3748);
  line-height: 1;
}

.study-data-stat span {
  font-size: 11px;
  color: var(--text-secondary, #718096);
  line-height: 1;
  white-space: nowrap;
}

.study-data-stat.is-ok strong {
  color: #3d9a6a;
}

.study-data-stat.is-bad strong {
  color: #d15a5a;
}

.study-data-stat.is-fix strong {
  color: #2F6F78;
}

.study-data-empty {
  padding: 2px 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary, #94a3b8);
}

.study-data-question {
  display: block;
  width: 100%;
  margin-top: 2px;
  padding: 5px 0;
  overflow: hidden;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-primary, #2d3748);
  font-size: 12px;
  line-height: 1.4;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
  transition: color 140ms ease-out, background-color 140ms ease-out, transform 140ms ease-out;
}

.study-data-question:hover {
  color: #2F6F78;
}

.study-data-question:active {
  transform: scale(0.98);
}

[data-theme="dark"] .study-data-stat.is-ok strong {
  color: #6fbf8d;
}

[data-theme="dark"] .study-data-bar i.is-ok {
  background: #6fbf8d;
}

[data-theme="dark"] .study-data-stat.is-bad strong {
  color: #e08989;
}

[data-theme="dark"] .study-data-bar i.is-bad {
  background: #e08989;
}

[data-theme="dark"] .study-data-stat.is-fix strong,
[data-theme="dark"] .study-data-question:hover {
  color: #7ab8c0;
}

[data-theme="dark"] .study-data-bar i.is-fix {
  background: #7ab8c0;
}
</style>
