/** 练习记录。SQL 在 src-tauri/src/database/practice.rs。 */
import { invoke } from '@tauri-apps/api/core'
import { isTauri } from './env'
import {
  emitStudyActivityUpdated,
  mockQuestionKnowledge,
  mockStudyGraphs,
  mockStudySubjects,
  pushMockActivity,
} from './mock'
import type {
  PracticeMarks,
  PracticeRecord,
  PracticeSummary,
  QuestionPracticeStats,
  RecentWrongQuestion,
} from './types'

export async function addPracticeRecord(input: {
  questionId: number
  userAnswer: string
  isCorrect: boolean
  note?: string
  source?: string
}): Promise<PracticeRecord> {
  if (!isTauri()) {
    const record: PracticeRecord = {
      id: Date.now(),
      question_id: input.questionId,
      user_answer: input.userAnswer,
      is_correct: input.isCorrect,
      note: input.note || '',
      source: input.source || 'agent',
      create_time: new Date().toISOString(),
    }
    const bySubject = new Map<number, string[]>()
    for (const link of mockQuestionKnowledge.filter((item) => item.question_id === input.questionId)) {
      for (const [subjectId, graph] of mockStudyGraphs) {
        const node = graph.nodes.find((item) => item.id === link.node_id)
        if (!node) continue
        const names = bySubject.get(subjectId) || []
        if (node.name) names.push(node.name)
        bySubject.set(subjectId, names)
      }
    }
    for (const [subjectId, names] of bySubject) {
      pushMockActivity({
        subject_id: subjectId,
        kind: 'practice',
        names,
        question_count: 1,
        correct_count: input.isCorrect ? 1 : 0,
        create_time: record.create_time || new Date().toISOString(),
      })
      emitStudyActivityUpdated(subjectId)
    }
    return record
  }
  const record = await invoke<PracticeRecord>('add_practice_record', {
    questionId: input.questionId,
    userAnswer: input.userAnswer,
    isCorrect: input.isCorrect,
    note: input.note || '',
    source: input.source || 'agent',
  })
  emitStudyActivityUpdated()
  return record
}

export async function updatePracticeNote(id: number, note: string): Promise<void> {
  if (!isTauri()) return
  await invoke('update_practice_note', { id, note })
}

export async function getPracticeHistory(questionId: number, limit = 20): Promise<PracticeRecord[]> {
  if (!isTauri()) return []
  return invoke<PracticeRecord[]>('get_practice_history', { questionId, limit })
}

export async function listRecentWrongQuestions(input: {
  subjectId?: number
  nodeId?: number
  folderId?: number
  days?: number
  limit?: number
  unresolvedOnly?: boolean
} = {}): Promise<RecentWrongQuestion[]> {
  if (!isTauri()) return []
  return invoke<RecentWrongQuestion[]>('list_recent_wrong_questions', {
    subjectId: input.subjectId,
    nodeId: input.nodeId,
    folderId: input.folderId,
    days: input.days,
    limit: input.limit,
    unresolvedOnly: input.unresolvedOnly,
  })
}

export async function getRecentPracticeMarks(ids: number[], limit = 5): Promise<PracticeMarks[]> {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  if (!unique.length) return []
  if (!isTauri()) return unique.map((id) => ({ question_id: id, results: [] }))
  return invoke<PracticeMarks[]>('get_recent_practice_marks', { ids: unique, limit })
}

export async function getQuestionPracticeStats(ids: number[]): Promise<QuestionPracticeStats[]> {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  if (!unique.length) return []
  if (!isTauri()) return []
  return invoke<QuestionPracticeStats[]>('get_question_practice_stats', { ids: unique })
}

export async function getPracticeSummaries(ids: number[]): Promise<PracticeSummary[]> {
  const unique = [...new Set(ids.filter((id) => Number.isFinite(id) && id > 0))]
  if (!unique.length) return []
  if (!isTauri()) {
    return unique.map((id) => ({
      question_id: id,
      count: 0,
      last_answer: '',
      last_correct: false,
      last_note: '',
    }))
  }
  return invoke<PracticeSummary[]>('get_practice_summaries', { ids: unique })
}

