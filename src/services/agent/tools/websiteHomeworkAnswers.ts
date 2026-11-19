import { invoke } from '@tauri-apps/api/core'
import type { BrowserLocator } from '../../browser/engine'
import { evalBrowserViewInFrame } from '../../browser/eval'
import { courseHomeworkReadScript, loadCourseHomeworkRules, type PageHomework, type PageHomeworkQuestion } from '../../chaoxing/host/courseHomeworkAnswers'
import { locateChapterQuiz } from '../../chaoxing/host/chapterQuizFrames'
import { studentChapterUrl } from '../../chaoxing/host/chapterTasks'
import { chaoxingUrl } from '../../platform/chaoxing/studentCourses'
import { studentHomeworkUrl } from '../../platform/chaoxing/studentHomework'
import {
  observeHomeworkQuestion, publicHomeworkQuestion as publicQuestion, readHomeworkAnswer as current,
  type HomeworkAnswer, type HomeworkProgressUpdate, type HomeworkQuestionProgress,
} from '../homeworkProgress'
import { isHomeworkQuestionRange, type HomeworkQuestionRange } from '../homeworkQuestionRange'
import { runWebsiteScript, runWebsiteWorkflow, hasWebsiteScriptManifest } from '../websiteScripts'
import type { handleWebsiteHomeworkTools } from './websiteHomework'

type Context = Parameters<typeof handleWebsiteHomeworkTools>[0] & {
  policy?: { permissionMode?: string }
  onHomeworkProgress?: (update: HomeworkProgressUpdate) => void
  actOnceOnBrowser: (id: string, locator: BrowserLocator, op: 'click' | 'fill', text?: string) => Promise<{ ok: boolean; dispatched?: boolean }>
}

type Plan = HomeworkAnswer
type BankAnswer = { id: number; answer: string }
type Decision = { status: 'no_match' | 'conflict' | 'unmatched' } | { status: 'ready'; plan: Plan; bankId: number }

const batch = 8
const site = 'chaoxing.com'
const values = (plan: Plan) => 'choices' in plan ? plan.choices : plan.blanks
const same = (a: Plan, b: Plan) => JSON.stringify(a) === JSON.stringify(b)
const fingerprint = (q: PageHomeworkQuestion) => JSON.stringify([
  q.id, q.number, q.order, q.type, q.stem, q.options.map(({ label, text }) => [label, text]), q.blanks.length,
])

const key = (text: string) => text.normalize('NFKC').trim().replace(/\s+/gu, ' ')
const polarity = (text: string) => {
  const value = key(text).toLowerCase()
  if (/^(?:正确|对|是|true|√|✓)$/u.test(value)) return true
  if (/^(?:错误|错|否|false|×|✗)$/u.test(value)) return false
}
const equivalence = (q: PageHomeworkQuestion, label: string, text: string) => {
  const meaning = q.type === 'judgement' ? polarity(text) : undefined
  const options = q.options.filter(option => meaning === undefined ? key(option.text) === key(text) : polarity(option.text) === meaning)
  return options.length === 1 && options[0].label === label
}

function buildPlan(q: PageHomeworkQuestion, input: Record<string, unknown>): Plan | null {
  if (q.type === 'completion') {
    const blanks = input.blanks
    if ('choices' in input || !Array.isArray(blanks) || blanks.length !== q.blanks.length || !blanks.length ||
      blanks.some((value, index) => typeof value !== 'string' || !value.trim() || value.length > 500 ||
        value.length > (q.blanks[index].maxLength >= 0 ? q.blanks[index].maxLength : 500))) return null
    return { blanks }
  }
  const choices = input.choices
  if ('blanks' in input || !Array.isArray(choices) || !choices.length || new Set(choices).size !== choices.length ||
    (q.type !== 'multiple' && choices.length !== 1) || choices.some(value => !q.options.some(option => option.label === value))) return null
  return { choices: [...choices].sort() }
}

// A downloaded script can choose a plan, but cannot make the application fill
// text or click an option that is unsupported by the independently read bank rows.
function backedBy(q: PageHomeworkQuestion, plan: Plan, matches: BankAnswer[]) {
  return matches.length > 0 && matches.every(({ answer }) => {
    const parts = answer.split('###').map(part => part.trim())
    if (parts.some(part => !part) || parts.length !== values(plan).length) return false
    if ('blanks' in plan) return parts.every((part, index) => part === plan.blanks[index])
    const bound = parts.map(part => plan.choices.find(label => equivalence(q, label, part)))
    return bound.every(Boolean) && new Set(bound).size === plan.choices.length
  })
}

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export async function handleWebsiteHomeworkAnswerTools(ctx: Context): Promise<string> {
  const answering = ctx.name === 'browser_answer_homework'
  const id = ctx.browserId
  const items: HomeworkQuestionProgress[] = []
  let dispatched = false
  let receipt: Record<string, unknown> = {}
  const fail = (reason: string, error: string, extra = {}) => JSON.stringify({
    ok: false, reason, error, ...(items.length ? { questions: items } : {}), ...(dispatched ? { clickDispatched: true } : {}), ...extra,
  })
  if (answering && (ctx.role === 'explore' || ctx.policy?.permissionMode === 'strict')) {
    return fail('invalid', '当前权限只能查看课程作业。')
  }
  const manual = ctx.args.answers
  if (manual !== undefined && (!answering || !Array.isArray(manual) || !manual.length || manual.length > batch
    || !ctx.args.assignment_id || manual.some(value => !record(value) || typeof value.question_id !== 'string'))) {
    return fail('invalid', '补填最多 8 题；请提供作业复核返回的 assignment_id、question_id 和已核实的答案。')
  }
  if (ctx.args.offset !== undefined && (!Number.isInteger(ctx.args.offset) || Number(ctx.args.offset) < 0)) {
    return fail('invalid', 'offset 须为非负整数。')
  }
  const requestedRange = ctx.args.question_range
  const range = isHomeworkQuestionRange(requestedRange) ? requestedRange : undefined
  if (requestedRange !== undefined && !range) {
    return fail('invalid', 'question_range 须提供有效的起止题号（start、end）。')
  }
  try {
    if (answering && !manual && !await hasWebsiteScriptManifest(site)) {
      return fail('invalid', '当前学习通经验来源未提供脚本清单。可先核对作业页面。')
    }
    const page = await ctx.readBrowserPage(id, { maxFrames: 12 })
    if (page.error) return fail('stale', '作业页面读取失败，请重新读取当前页。')
    if (!page.url || !chaoxingUrl(page.url)) return fail('not_found', '请先打开学习通课程作业或章节测验的作答页。')
    const chapter = studentChapterUrl(page.url)
    if (!chapter && (ctx.args.chapter_key !== undefined || ctx.args.quiz_job_id !== undefined)) {
      return fail('stale', '当前已离开目标章节测验，请重新定位。')
    }
    if (chapter && answering && ctx.args.chapter_key !== chapter.key) {
      return fail('stale', '填写章节测验时须传刚核对的 chapter_key。')
    }
    let quiz = chapter && await locateChapterQuiz(id, page.url, page.frames ?? [], ctx.args.chapter_key, ctx.args.quiz_job_id)
    for (let attempt = 0; attempt < 3 && quiz?.ok === false && quiz.reason === 'not_found'; attempt++) {
      await ctx.wait(250)
      const live = await ctx.readBrowserPage(id, { maxFrames: 12 })
      if (live.error || live.url !== page.url) return fail('stale', '打开测验时章节页面已变化，请重新核对。')
      quiz = await locateChapterQuiz(id, live.url, live.frames ?? [], ctx.args.chapter_key, ctx.args.quiz_job_id)
    }
    if (quiz?.ok === false) return fail(quiz.reason, quiz.error)
    if (quiz?.done && answering) return fail('invalid', '学习通已标记这份章节测验完成。')
    const top = studentHomeworkUrl(page.url)
    const frames = quiz ? [quiz.frame] : (page.frames ?? []).filter(frame => frame.frameId && frame.loaderId && studentHomeworkUrl(frame.url)?.kind === 'dowork'
      && (!top || (top.kind === 'dowork' && frame.url === page.url)))
    const distinct = [...new Map(frames.map(frame => [frame.frameId, frame])).values()]
    if (distinct.length !== 1) {
      return fail(distinct.length ? 'ambiguous' : 'not_found', '需要唯一的学习通课程作答页。若在作业介绍页，先点击「开始作答／继续作答」。')
    }
    const frame = distinct[0]
    const homework = studentHomeworkUrl(frame.url)
    const assignmentId = quiz?.assignmentId ?? [homework!.course, homework!.clazz, homework!.work].join(':')
    if (ctx.args.assignment_id !== undefined && ctx.args.assignment_id !== assignmentId) {
      return fail('stale', '当前作业和前次核对的作业不同，未写入任何答案。')
    }
    const locator = (selector: string): BrowserLocator => ({
      by: 'css', value: selector, frameId: frame.frameId, loaderId: frame.loaderId,
    })
    const rules = await loadCourseHomeworkRules()
    const read = async (offset: number, limit: number, questionId?: string, scope?: HomeworkQuestionRange): Promise<PageHomework> => {
      await ctx.wait(0)
      const state = await evalBrowserViewInFrame(id, courseHomeworkReadScript(rules, offset, limit, questionId, scope, Boolean(quiz)), '', { frameId: frame.frameId!, loaderId: frame.loaderId })
      if (state?.url !== frame.url || !Number.isInteger(state?.total) || !Array.isArray(state.questions)) {
        throw new Error('作业页面已变化，请重新读取。')
      }
      return state
    }
    const offset = Number(ctx.args.offset ?? 0)
    const state = await read(offset, batch, undefined, range)
    if (!state.total) return fail('not_found', '还未读到课程作业题目，请检查作答页是否加载完成。')
    if (range && (state.scopeAmbiguous || state.scopeTotal !== range.end - range.start + 1)) {
      return fail('ambiguous', '指定范围内有缺失或重复的题号，未处理。请先核对网页题号。')
    }
    const total = state.scopeTotal ?? state.total
    if (!manual && offset >= total) return fail('invalid', 'offset 已超出本次要处理的范围。')
    const nextOffset = offset + batch < total ? offset + batch : undefined
    const meta = receipt = { assignment_id: assignmentId, total: state.total, nextOffset: manual ? undefined : nextOffset,
      ...(quiz ? { chapter_key: quiz.chapterKey, quiz_job_id: quiz.quizJobId } : {}),
      ...(range ? { question_range: range, scopeTotal: total } : {}), ...(answering ? { mode: manual ? 'targeted' : 'automatic' } : {}) }
    const title = state.title?.trim() || quiz?.title || (top?.kind === 'dowork' ? page.title?.trim() : undefined)
    const publish = (phase: HomeworkProgressUpdate['phase'], questions: HomeworkQuestionProgress[]) => {
      if (questions.length) ctx.onHomeworkProgress?.({ assignmentId, title, total: state.total, phase, questions })
    }
    const observed = state.questions.map(observeHomeworkQuestion)
    publish('read', observed)
    if (!quiz && ctx.onHomeworkProgress && offset === 0 && !manual && !range) {
      const previewSize = 32
      for (let start = batch; start < state.total; start += previewSize) {
        try {
          const preview = await read(start, previewSize)
          if (preview.total !== state.total || !preview.questions.length) break
          publish('read', preview.questions.map(observeHomeworkQuestion))
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') throw error
          break
        }
      }
    }
    if (!answering) {
      return JSON.stringify({ ok: true, ...meta, questions: observed })
    }

    let questions = state.questions
    let revision: string | undefined
    const plans = new Map<string, Decision>()
    if (Array.isArray(manual)) {
      const seen = new Set<string>()
      questions = []
      for (const row of manual) {
        const questionId = row.question_id as string
        if (seen.has(questionId)) return fail('invalid', '同一道题不能重复补填。')
        seen.add(questionId)
        const [q] = (await read(0, 1, questionId, range)).questions
        const plan = q && buildPlan(q, row)
        // Visual/font questions can use explicitly checked labels; the trusted
        // DOM must still be able to identify and verify their live controls.
        if (!q || (q.issue && q.issue !== 'visual_needed') || !plan) {
          return fail('invalid', '有补填目标超出指定范围、不存在、控件不可核对或答案格式不正确，未写入。')
        }
        questions.push(q)
        plans.set(questionId, { status: 'ready', bankId: 0, plan })
      }
    } else {
      const eligible = questions.filter(q => q.id && !q.issue)
      if (eligible.length) {
        try {
          const matches = await invoke<BankAnswer[][]>('lookup_homework_bank_answers', {
            questions: eligible.map(q => ({ title: q.stem, type: q.type,
              options: q.options.length ? q.options.map(option => option.label + '. ' + option.text).join('\n') : null })),
          })
          if (!Array.isArray(matches) || matches.length !== eligible.length || matches.some(list => !Array.isArray(list))) {
            throw new Error('本地题库返回了无效的作业答案。')
          }
          const script = await runWebsiteScript(site, 'chaoxing', 'homework', {
            operation: 'resolve_answers',
            questions: eligible.map((q, i) => ({ id: q.id, type: q.type, options: publicQuestion(q).options, blankCount: q.blanks.length, matches: matches[i] })),
          }, output => {
            if (!record(output) || !Array.isArray(output.decisions) || output.decisions.length !== eligible.length) {
              throw new Error('作业答题脚本尚未支持批量答题，请更新网站脚本。')
            }
            return output.decisions.map((decision, i): Decision => {
              const q = eligible[i]
              if (!record(decision) || decision.id !== q.id) throw new Error('作业脚本返回了错误的题目身份。')
              if (decision.status === 'ready') {
                const plan = buildPlan(q, decision)
                if (!plan || typeof decision.bankId !== 'number' || !matches[i].some(match => match.id === decision.bankId) ||
                    !backedBy(q, plan, matches[i])) return { status: 'unmatched' }
                return { status: 'ready', plan, bankId: decision.bankId }
              }
              if (decision.status === 'no_match' || decision.status === 'conflict' || decision.status === 'unmatched') return { status: decision.status }
              throw new Error('作业脚本返回了未知的答题状态。')
            })
          })
          revision = script.revision
          eligible.forEach((q, i) => plans.set(q.id!, script.result[i]))
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') throw error
          return fail('invalid', error instanceof Error ? error.message : String(error), { ...meta, questions: questions.map(publicQuestion) })
        }
      }
    }

    const execute = async (original: PageHomeworkQuestion, plan: Decision | undefined) => {
      const row: HomeworkQuestionProgress = { ...publicQuestion(original), status: 'needs_review' }
      items.push(row)
      try {
        if (!plan) return
        if (plan.status !== 'ready') { row.status = plan.status; return }
        row.source = manual ? 'agent' : 'bank'
        if (!manual) row.bankId = plan.bankId
        row.expected = plan.plan
        const refresh = async () => (await read(0, 1, original.id!)).questions[0]
        const valid = (q: PageHomeworkQuestion | undefined): q is PageHomeworkQuestion => !!q &&
          fingerprint(q) === fingerprint(original) && (!q.issue || Boolean(manual && q.issue === 'visual_needed'))
        let live = await refresh()
        if (!valid(live)) { row.status = 'page_changed'; return }
        row.actual = current(live)
        const intended = values(plan.plan)
        if (same(row.actual, plan.plan)) { row.status = 'already_matches'; return }
        const compatible = (actual: Plan) => 'blanks' in actual
          ? actual.blanks.every((value, index) => !value.trim() || value === intended[index])
          : actual.choices.every(value => intended.includes(value))
        // Existing contradictory values may belong to the user; surface them for review.
        if (!compatible(row.actual)) { row.status = 'existing_answer'; return }
        let pending = false
        for (let index = 0; index < intended.length; index++) {
          const value = intended[index]
          const blank = 'blanks' in plan.plan
          const before = current(live)
          if (blank ? values(before)[index] === value : values(before).includes(value)) continue
          const selector = blank ? live.blanks[index]?.selector : live.options.find(item => item.label === value)?.selector
          if (!selector) { row.status = 'controls_need_review'; break }
          const expected = blank ? { blanks: values(before).map((item, i) => i === index ? value : item) }
            : { choices: [...values(before), value].sort() }
          await ctx.wait(0)
          const previousDispatch = dispatched
          dispatched = true
          row.status = 'unverified'
          const action = await ctx.actOnceOnBrowser(id, locator(selector), blank ? 'fill' : 'click', blank ? value : undefined)
          if (action.dispatched === false) {
            dispatched = previousDispatch
            row.status = 'controls_need_review'
            break
          }
          pending = true
          // A native click response alone isn't evidence: poll the question's live controls.
          let verified = false
          for (const wait of [0, 120, 260, 420]) {
            await ctx.wait(wait)
            live = await refresh()
            if (!valid(live)) break
            row.actual = current(live)
            if (same(row.actual, expected)) { verified = true; break }
            if (!same(row.actual, before)) break
          }
          if (!verified) {
            return fail('verification_required', action.ok ? '已发送填答操作，但未核对到预期状态。请先复核该题。' : '填写结果未确认，请复核页面后再处理。',
              { ...meta, checkedThroughOrder: original.order - 1 })
          }
        }
        if (same(row.actual, plan.plan)) row.status = pending ? 'filled' : 'already_matches'
      } finally {
        publish('result', [row])
      }
    }
    const actions = questions.map(question => question.id ? plans.get(question.id) : undefined)
    let failure: string | undefined
    const outcome = await runWebsiteWorkflow(site, 'chaoxing', 'homework', {
      rows: actions.map(plan => ({ status: plan?.status ?? 'needs_review' })),
    }, async raw => {
      await ctx.wait(0)
      const command = raw as { op?: unknown; index?: unknown } | null
      const index = items.length
      const plan = actions[index]
      const expected = plan?.status === 'ready' ? 'apply' : 'record'
      if (failure || index >= questions.length || command?.index !== index || command.op !== expected) {
        throw new Error('网站作答流程请求的操作与当前题目或授权答案不一致。')
      }
      failure = await execute(questions[index], plan)
      return { ok: !failure }
    }) as { done?: unknown } | null
    if (failure) return failure
    if (outcome?.done !== true || items.length !== questions.length) return fail('stale', '网站作答流程未完成。', meta)

    return JSON.stringify({ ok: true, ...meta, scriptRevision: revision, questions: items,
      filled: items.filter(item => item.status === 'filled').length,
      reviewNeeded: items.filter(item => !['filled', 'already_matches'].includes(item.status)).length,
      hint: '填写状态只证明控件值与预期一致。调用 browser_review_homework 复核题目和未答项；没有保存或提交。' })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return fail(dispatched ? 'verification_required' : 'stale', error instanceof Error ? error.message : String(error), receipt)
  }
}
