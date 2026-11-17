import type { PageHomeworkQuestion } from '../chaoxing/host/courseHomeworkAnswers'

export type HomeworkAnswer = { choices: string[] } | { blanks: string[] }

export type HomeworkQuestionProgress = {
  question_id: string | null
  number: number
  order: number
  type: PageHomeworkQuestion['type']
  stem: string
  options: Array<{ label: string; text: string }>
  actual: HomeworkAnswer
  issue?: string
  expected?: HomeworkAnswer
  source?: 'bank' | 'agent'
  bankId?: number
  status: 'answered' | 'unanswered' | 'partial' | 'needs_review' | 'no_match' | 'conflict' | 'unmatched'
    | 'filled' | 'already_matches' | 'existing_answer' | 'page_changed' | 'controls_need_review' | 'unverified'
}

export type HomeworkProgressUpdate = {
  assignmentId: string
  title?: string
  total: number
  questions: HomeworkQuestionProgress[]
  phase: 'read' | 'result'
}

export type HomeworkProgress = Omit<HomeworkProgressUpdate, 'phase'> & { messageId?: string }

export const readHomeworkAnswer = (q: PageHomeworkQuestion): HomeworkAnswer => q.type === 'completion'
  ? { blanks: q.blanks.map(item => item.text) }
  : { choices: q.options.filter(option => option.selected).map(option => option.label).sort() }

export const publicHomeworkQuestion = (q: PageHomeworkQuestion) => ({
  question_id: q.id, number: q.number, order: q.order, type: q.type, stem: q.stem,
  options: q.options.map(({ label, text }) => ({ label, text })), actual: readHomeworkAnswer(q),
  ...(q.issue ? { issue: q.issue } : {}),
})

export const observeHomeworkQuestion = (q: PageHomeworkQuestion): HomeworkQuestionProgress => {
  const row = publicHomeworkQuestion(q)
  const answers = 'blanks' in row.actual ? row.actual.blanks : row.actual.choices
  const answered = answers.filter(value => value.trim()).length
  return { ...row, status: q.issue ? 'needs_review' : answered === 0 ? 'unanswered'
    : q.type === 'completion' && answered < answers.length ? 'partial' : 'answered' }
}

const answerStates = new Set<HomeworkQuestionProgress['status']>([
  'filled', 'already_matches', 'existing_answer', 'no_match', 'conflict', 'unmatched',
])

export function mergeHomeworkProgress(
  previous: HomeworkProgress | undefined, messageId: string | undefined, update: HomeworkProgressUpdate,
): HomeworkProgress {
  const rows = new Map(previous?.questions.filter(row => row.order <= update.total).map(row => [row.order, row]))
  const orders = new Map(previous?.questions.flatMap(row => row.question_id ? [[row.question_id, row.order] as const] : []))
  for (const row of update.questions) {
    const formerOrder = row.question_id ? orders.get(row.question_id) : undefined
    if (formerOrder !== undefined && formerOrder !== row.order && rows.get(formerOrder)?.question_id === row.question_id) {
      rows.delete(formerOrder)
    }
    const last = rows.get(row.order)
    const unchanged = last && row.question_id && last.question_id === row.question_id && last.stem === row.stem
      && last.type === row.type && last.issue === row.issue && JSON.stringify(last.options) === JSON.stringify(row.options)
      && JSON.stringify(last.actual) === JSON.stringify(row.actual)
    if (update.phase === 'read' && unchanged && answerStates.has(last.status)) continue
    rows.set(row.order, row)
  }
  return {
    assignmentId: update.assignmentId,
    title: update.title || previous?.title,
    total: update.total,
    questions: [...rows.values()].sort((a, b) => a.order - b.order),
    messageId: messageId ?? previous?.messageId,
  }
}

export const hasHomeworkAnswer = ({ actual }: HomeworkQuestionProgress) => 'choices' in actual
  ? actual.choices.length > 0
  : actual.blanks.length > 0 && actual.blanks.every(value => value.trim())
