import type { ImportTaskStep } from '../app/importTasks'
import { isHomeworkQuestionRange, requestedHomeworkQuestionRange, type HomeworkQuestionRange } from './homeworkQuestionRange'
import { isReadOnlyReviewGoal } from './observationReview'

export function permitsHomeworkAnswers(goal: string) {
  const active = goal.replace(/《[^》]*》|「[^」]*」|“[^”]*”/g, '')
  if (!active.trim() || isReadOnlyReviewGoal(active)) return false
  if (/(?:不要|不用|无需|禁止|不能|不必|别|先别|不)(?:再|去|进行|自动)?\s*(?:作答|答题|做题|写作业|做作业|填写|修改答案|补填|(?:做|答|写|完成)(?=\s*(?:第|前|\d)))/.test(active)) return false
  // Explicit read/open requests don't grant permission to fill answers.
  const requestedAction = active.replace(/(?:不要|不用|无需|别|不)(?:再)?\s*(?:提交|保存)/g, '')
    .replace(/(?:作答|答题|填写)(?:情况|状态|记录|结果|进度|详情)/g, '')
  if (/看|读取|列出|打开|检查|复核|有哪些|有什么/.test(active)
    && !/完成|做完|作答|答题|做题|写作业|做作业|填写|补填|回答|解答|提交/.test(requestedAction)
    && !(requestedHomeworkQuestionRange(active) && /(?:做|答|写)(?:下|一下|一遍)?\s*(?:第|前|\d)/.test(requestedAction))) return false
  return true
}

type Receipt = {
  ok?: boolean
  assignment_id?: string
  mode?: 'automatic' | 'targeted'
  total?: number
  question_range?: HomeworkQuestionRange
  questions?: Array<{ order: number; number?: number; status: string }>
}

export function pendingHomeworkReview(steps: ImportTaskStep[]): boolean {
  const assignments = new Map<string, Set<string>>()
  const automatic = new Set<string>()
  for (const step of steps) {
    if (step.name !== 'browser_answer_homework' && step.name !== 'browser_review_homework') continue
    let result: Receipt
    try { result = JSON.parse(step.result || '{}') } catch { continue }
    if (!result?.assignment_id || !Array.isArray(result.questions)) continue
    if (step.name === 'browser_answer_homework' && (result.ok || result.questions.some(row =>
      row.status === 'filled' || row.status === 'unverified'))) {
      const pending = assignments.get(result.assignment_id) ?? new Set<string>()
      if (!assignments.has(result.assignment_id)) {
        assignments.set(result.assignment_id, pending)
      }
      const range = isHomeworkQuestionRange(result.question_range) ? result.question_range : undefined
      const autoKey = range ? `${result.assignment_id}|${range.start}-${range.end}` : result.assignment_id
      if (result.mode === 'automatic' && !automatic.has(autoKey)) {
        automatic.add(autoKey)
        if (range && range.end - range.start < 1000) {
          for (let number = range.start; number <= range.end; number++) pending.add(`number:${number}`)
        } else if (!range && Number.isSafeInteger(result.total) && result.total! <= 1000) {
          for (let order = 1; order <= result.total!; order++) pending.add(`order:${order}`)
        }
      }
      for (const row of result.questions) pending.add(`order:${row.order}`)
    } else if (step.name === 'browser_review_homework' && result.ok) {
      const pending = assignments.get(result.assignment_id)
      for (const row of result.questions) {
        pending?.delete(`order:${row.order}`)
        pending?.delete(`number:${row.number}`)
      }
    }
  }
  return [...assignments.values()].some(pending => pending.size > 0)
}
