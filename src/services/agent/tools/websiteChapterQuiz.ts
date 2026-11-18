import { handleWebsiteHomeworkAnswerTools } from './websiteHomeworkAnswers'
import type { HomeworkQuestionRange } from '../homeworkQuestionRange'

type Context = Parameters<typeof handleWebsiteHomeworkAnswerTools>[0]
type Question = { number: number; status: string }
type Batch = { ok?: boolean; assignment_id?: string; total?: number; nextOffset?: number; filled?: number
  clickDispatched?: boolean; error?: string; questions?: Question[] }

/** Run the existing fill/review tools in the host, with only a summary returned to the model. */
export async function prepareWebsiteChapterQuiz(ctx: Context, chapter_key: string, quiz_job_id: string, range?: HomeworkQuestionRange) {
  const args = { chapter_key, quiz_job_id, ...(range ? { question_range: range } : {}) }
  let offset = 0
  let assignment_id: string | undefined
  let total = 0
  let filled = 0
  let reviewed = 0
  let reviewNeeded = 0
  const reviewNumbers: number[] = []
  const call = async (name: string): Promise<Batch> => JSON.parse(await handleWebsiteHomeworkAnswerTools({
    ...ctx, name, args: { ...args, offset, assignment_id },
  }))
  const summary = () => ({ assignment_id, total, filled, reviewed, reviewNeeded, reviewNumbers })
  for (let batch = 0; batch < 125; batch++) {
    await ctx.wait(0)
    const answer = await call('browser_answer_homework')
    assignment_id = answer.assignment_id ?? assignment_id
    total = answer.total ?? total
    filled += answer.filled ?? 0
    if (!answer.ok && !answer.clickDispatched) {
      return { quiz: summary(), hint: answer.error || '测验自动填写需要核对。请用 browser_review_homework 读题。' }
    }
    const review = await call('browser_review_homework')
    if (!review.ok || !review.questions?.length || !assignment_id || review.assignment_id !== assignment_id) {
      return { ok: false, error: '测验填写后未能复核当前批次。请先核对当前作答。', clickDispatched: filled > 0 || !!answer.clickDispatched, quiz: summary() }
    }
    reviewed += review.questions.length
    for (const row of review.questions) {
      const check = answer.questions?.find(item => item.number === row.number)
      if (row.status === 'answered' && check && ['filled', 'already_matches'].includes(check.status)) continue
      reviewNeeded++
      if (reviewNumbers.length < 12) reviewNumbers.push(row.number)
    }
    if (answer.ok !== true || review.nextOffset === undefined) {
      return { quiz: summary(), hint: reviewNeeded
        ? '已自动填答并复核。用 browser_review_homework 核对标出的题号，按授权保存或提交后继续当前工作流。'
        : '已自动填答并复核。按用户授权处理保存或提交，平台登记完成后继续当前工作流。' }
    }
    if (review.nextOffset <= offset) break
    offset = review.nextOffset
  }
  return { quiz: summary(), hint: '当前测验尚有批次待复核，请继续同一测验和题号范围。' }
}
