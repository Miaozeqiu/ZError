import { computed, ref } from 'vue'
import {
  runClosedStudySessionSummaries,
  runStudySessionSummary,
} from './studyTimelineAgent'

const inFlight = ref<number[]>([])

export const timelineSummaryRunning = computed(() => inFlight.value.length > 0)

const markStart = (subjectId: number) => {
  if (!inFlight.value.includes(subjectId)) {
    inFlight.value = [...inFlight.value, subjectId]
  }
}

const markEnd = (subjectId: number) => {
  inFlight.value = inFlight.value.filter((id) => id !== subjectId)
}

export type TimelineSummaryTrigger = 'session_end' | 'timeline_open'

/** 一次学习结束：撤下科目、本轮最后一题等 */
export const finalizeStudySessionSummary = (input: {
  subjectId: number
  subjectName?: string
}) => {
  const subjectId = Number(input.subjectId)
  if (!Number.isFinite(subjectId) || subjectId <= 0) return
  if (inFlight.value.includes(subjectId)) return

  markStart(subjectId)
  void runStudySessionSummary({
    subjectId,
    subjectName: input.subjectName,
  }).catch((error) => {
    console.warn('[study] 学习时间线概括失败', error)
  }).finally(() => {
    markEnd(subjectId)
  })
}

/** 打开时间线时，把历史上已结束、尚未归档的学习时段补上摘要 */
export const backfillClosedStudySessions = (input: {
  subjectId: number
  subjectName?: string
}) => {
  const subjectId = Number(input.subjectId)
  if (!Number.isFinite(subjectId) || subjectId <= 0) return
  if (inFlight.value.includes(subjectId)) return

  markStart(subjectId)
  void runClosedStudySessionSummaries({
    subjectId,
    subjectName: input.subjectName,
  }).catch((error) => {
    console.warn('[study] 补归档学习时段失败', error)
  }).finally(() => {
    markEnd(subjectId)
  })
}
