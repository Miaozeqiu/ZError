export type HomeworkAnswer = { choices: string[] } | { blanks: string[] }

export type HomeworkQuestionProgress = {
  question_id: string | null
  number: number
  order: number
  type: 'single' | 'multiple' | 'judgement' | 'completion' | 'unsupported'
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
