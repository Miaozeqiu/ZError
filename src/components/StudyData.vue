<template>
  <section class="study-data">
    <div class="study-data-head">
      <span>{{ title }}</span>
    </div>
    <div class="study-data-body">
      <div class="study-data-head-row">
        <div class="study-data-meter">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <circle class="study-data-track" cx="32" cy="32" r="22" />
            <circle
              class="study-data-arc"
              cx="32"
              cy="32"
              r="22"
              :stroke-dasharray="arcDash"
            />
          </svg>
          <div class="study-data-readout">
            <strong>{{ masteryPct }}%</strong>
          </div>
        </div>
        <div class="study-data-legend" aria-hidden="true">
          <span v-for="item in masteryLegend" :key="item.label" class="study-data-swatch">
            <i :style="{ background: item.color }" />
            {{ item.label }}
          </span>
        </div>
      </div>
      <StudyForgettingCurve v-if="node" :node="node" :graph="graph" />
      <div v-else class="study-data-empty">点图谱中的知识点查看遗忘曲线</div>
      <div v-if="questions.length" class="study-data-questions">
        <div class="study-data-questions-title">{{ questions.length }} 道相关题</div>
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
import { computed, onMounted, onUnmounted, ref } from 'vue'
import StudyForgettingCurve from './StudyForgettingCurve.vue'
import { MASTERY_COLORS, retentionColor } from '../utils/studyGraphForce'
import { resolveCurveNode, rolledRetention } from '../utils/studyForgetting'
import type { StudyGraphNode } from '../utils/studyGraph'

const props = defineProps<{
  graph?: StudyGraphNode | null
  node?: StudyGraphNode | null
  subjectName?: string
  questions?: { id: number; question: string }[]
}>()

const emit = defineEmits<{
  'open-question': [id: number]
}>()

const nowTick = ref(Date.now())
let clockTimer: number | null = null
const ARC = 2 * Math.PI * 22

const title = computed(() => props.node?.name || props.subjectName || '数据')
const questions = computed(() => props.questions || [])

const mastery = computed(() => {
  const target = props.node
    ? resolveCurveNode(props.node, props.graph)
    : props.graph
  if (!target) return 0
  return rolledRetention(target, nowTick.value) ?? 0
})

const masteryPct = computed(() => Math.round(mastery.value * 100))
const arcDash = computed(() => {
  const value = Math.max(0, Math.min(1, mastery.value)) * ARC
  return `${value} ${ARC}`
})

const masteryLegend = [
  { label: '未评估', color: MASTERY_COLORS[0].fill },
  { label: '遗忘中', color: retentionColor(0.2).fill },
  { label: '记忆中', color: retentionColor(0.6).fill },
  { label: '牢固', color: retentionColor(1).fill },
]

onMounted(() => {
  clockTimer = window.setInterval(() => {
    nowTick.value = Date.now()
  }, 30000)
})

onUnmounted(() => {
  if (clockTimer != null) window.clearInterval(clockTimer)
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

.study-data-head {
  flex-shrink: 0;
  height: 28px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #718096);
}

.study-data-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 12px 14px;
}

.study-data-head-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
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

.study-data-arc {
  stroke: #2F6F78;
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

.study-data-legend {
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.study-data-swatch {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--text-secondary, #718096);
  line-height: 1;
  white-space: nowrap;
}

.study-data-swatch i {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.study-data-empty {
  padding: 8px 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary, #94a3b8);
}

.study-data-questions {
  margin-top: 10px;
}

.study-data-questions-title {
  margin-bottom: 6px;
  font-size: 11px;
  color: var(--text-secondary, #718096);
}

.study-data-question {
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
  cursor: pointer;
}
</style>
