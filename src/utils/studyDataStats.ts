import type { QuestionPracticeStats, StudyActivity } from '../services/app/database'
import { groupActivitiesIntoSessions, sessionTimeRange } from '../services/study/timelineAgent'
import type { StudyGraphNode } from './studyGraph'

export type StudyQuestionCounts = {
  practiced: number
  correct: number
  wrong: number
  corrected: number
}

export const emptyQuestionCounts = (): StudyQuestionCounts => ({
  practiced: 0,
  correct: 0,
  wrong: 0,
  corrected: 0,
})

export const classifyQuestionStats = (items: QuestionPracticeStats[]): StudyQuestionCounts => {
  const stats = emptyQuestionCounts()
  for (const item of items) {
    if ((item.attempted || 0) <= 0) continue
    stats.practiced += 1
    if (!item.last_correct) stats.wrong += 1
    else if (item.ever_wrong) stats.corrected += 1
    else stats.correct += 1
  }
  return stats
}

export type StudyDurationPart = {
  value: string
  unit: string
}

export const studyDurationParts = (minutes: number): StudyDurationPart[] => {
  const total = Math.max(0, Math.round(minutes))
  if (total < 60) return [{ value: String(total), unit: '分钟' }]
  const hours = Math.floor(total / 60)
  const rest = total % 60
  const parts: StudyDurationPart[] = [{ value: String(hours), unit: '小时' }]
  if (rest) parts.push({ value: String(rest), unit: '分钟' })
  return parts
}

const indexNodesByName = (root: StudyGraphNode) => {
  const byName = new Map<string, StudyGraphNode[]>()
  const walk = (node: StudyGraphNode) => {
    const name = String(node.name || '').trim()
    if (name) {
      const list = byName.get(name) || []
      list.push(node)
      byName.set(name, list)
    }
    node.children.forEach(walk)
  }
  walk(root)
  return byName
}

const collectLeaves = (node: StudyGraphNode): StudyGraphNode[] => (
  node.children.length ? node.children.flatMap(collectLeaves) : [node]
)

export const leafStudyMinutes = (
  root: StudyGraphNode,
  activities: StudyActivity[],
): Map<string, number> => {
  const minutes = new Map<string, number>()
  if (!activities.length) return minutes
  const byName = indexNodesByName(root)
  for (const session of groupActivitiesIntoSessions(activities)) {
    const range = sessionTimeRange(session)
    if (!Number.isFinite(range.minutes) || range.minutes <= 0) continue
    const leafIds = new Set<string>()
    for (const item of session) {
      for (const raw of item.names) {
        const name = String(raw || '').trim()
        if (!name) continue
        for (const node of byName.get(name) || []) {
          for (const leaf of collectLeaves(node)) leafIds.add(leaf.id)
        }
      }
    }
    if (!leafIds.size) continue
    const share = range.minutes / leafIds.size
    for (const id of leafIds) minutes.set(id, (minutes.get(id) || 0) + share)
  }
  return minutes
}

export const rolledStudyMinutes = (node: StudyGraphNode, leafMinutes: Map<string, number>): number => {
  if (node.children.length) {
    return node.children.reduce((sum, child) => sum + rolledStudyMinutes(child, leafMinutes), 0)
  }
  return leafMinutes.get(node.id) || 0
}
