import { pageRules } from './fixtures/courseHomeworkRules'
import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { beforeEach, expect, it, vi } from 'vitest'
import type { ImportTaskStep } from '../../src/services/app/importTasks'
import type { BrowserLocator } from '../../src/services/browser/engine'

const { invoke, evaluate, resolveScript, enabled } = vi.hoisted(() => ({
  invoke: vi.fn(), evaluate: vi.fn(), resolveScript: vi.fn(), enabled: vi.fn(),
}))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('../../src/services/browser/eval', () => ({ evalBrowserViewInFrame: evaluate }))
vi.mock('../../src/services/agent/websiteScripts', () => ({
  runWebsiteScript: resolveScript, hasWebsiteScriptManifest: enabled,
  runWebsiteWorkflow: async (_host: string, _site: string, _capability: string,
    input: { rows: Array<{ status: string }> }, dispatch: (command: unknown) => Promise<any>) => {
    for (const [index, row] of input.rows.entries()) {
      if (!(await dispatch({ op: row.status === 'ready' ? 'apply' : 'record', index })).ok) return { done: false }
    }
    return { done: true }
  },
}))

import { handleWebsiteHomeworkAnswerTools } from '../../src/services/agent/tools/websiteHomeworkAnswers'
import { pendingHomeworkReview, permitsChapterQuizAnswers, permitsHomeworkAnswers } from '../../src/services/agent/homeworkAnswerEvidence'
import { mergeHomeworkProgress, type HomeworkProgress, type HomeworkProgressUpdate } from '../../src/services/agent/homeworkProgress'
import { requestedHomeworkQuestionRange } from '../../src/services/agent/homeworkQuestionRange'
import * as chapters from '../../src/services/chaoxing/host/chapterTasks'

const url = 'https://mooc1.chaoxing.com/mooc-ans/mooc2/work/dowork?courseId=42&classId=7&workId=11'
const frame = { url, frameId: 'work', loaderId: 'doc-one' }
const fixture = readFileSync(new URL('../chaoxing/homework/do.html', import.meta.url), 'utf8')
const homework = async (name: 'answer' | 'review', ctx: ReturnType<typeof setup>, args = {}) =>
  JSON.parse(await handleWebsiteHomeworkAnswerTools({ ...ctx.context, name: 'browser_' + name + '_homework', args }))

function setup(mark = true) {
  const { window } = new JSDOM(fixture, { url, runScripts: 'outside-only' })
  Object.defineProperty(window.Element.prototype, 'getClientRects', { value: () => [{ width: 100, height: 20 }] })
  const doc = window.document
  const clickByLocator = vi.fn(async (_id: string, locator: BrowserLocator) => {
    expect(locator).toMatchObject({ frameId: 'work', loaderId: 'doc-one' })
    const control = doc.querySelector(locator.value)
    if (mark) control?.closest('.answerBg')?.querySelector('.num_option')?.classList.add('check_answer')
    return { ok: true }
  })
  const fillByLocator = vi.fn(async (_id: string, locator: BrowserLocator, value: string) => {
    expect(locator).toMatchObject({ frameId: 'work', loaderId: 'doc-one' })
    const control = doc.querySelector<HTMLInputElement>(locator.value)!
    control.value = value
    return { ok: true }
  })
  evaluate.mockImplementation(async (_id, script, _frame, identity) => {
    expect(identity).toMatchObject({ frameId: 'work', loaderId: 'doc-one' })
    return window.eval(script)
  })
  const context = {
    browserId: 'tab', liveHref: async () => url, wait: async () => {},
    readBrowserPage: vi.fn(async () => ({ url, frames: [frame] })),
    clickByLocator, fillByLocator, navigateBrowserView: vi.fn(),
    actOnceOnBrowser: (id: string, locator: BrowserLocator, op: string, text?: string) =>
      op === 'click' ? clickByLocator(id, locator) : fillByLocator(id, locator, text!),
    policy: { permissionMode: 'normal' },
    onHomeworkProgress: vi.fn<(update: HomeworkProgressUpdate) => void>(),
  }
  return { doc, context }
}

beforeEach(() => {
  vi.resetAllMocks()
  enabled.mockResolvedValue(true)
  invoke.mockResolvedValue([[{ id: 1, answer: '任意 ε 都存在 N' }], [], [{ id: 2, answer: 'false' }], [{ id: 3, answer: '极限' }]])
  resolveScript.mockImplementation(async (_site, _id, _capability, input, validate) => ({
    result: validate(input.operation === 'page_rules' ? pageRules : { decisions: input.questions.map((q: { id: string }, index: number) => ({ id: q.id, ...[
      { status: 'ready', choices: ['A'], bankId: 1 },
      { status: 'no_match' },
      { status: 'ready', choices: ['B'], bankId: 2 },
      { status: 'ready', blanks: ['极限'], bankId: 3 },
    ][index] })) }), revision: 'test-revision',
  }))
})

it('fills exact bank answers, preserves existing answers, and lets Agent target and review missed questions', async () => {
  const ctx = setup()
  ctx.doc.querySelector<HTMLInputElement>('input[type=text]')!.value = ''
  const result = await homework('answer', ctx)
  expect(result).toMatchObject({ ok: true, assignment_id: '42:7:11', total: 4, filled: 2, reviewNeeded: 1 })
  expect(result.questions.map((row: { number: number; status: string }) => [row.number, row.status])).toEqual([
    [3, 'already_matches'], [4, 'no_match'], [5, 'filled'], [6, 'filled'],
  ])
  expect(invoke.mock.calls[0][0]).toBe('lookup_homework_bank_answers')
  expect(invoke.mock.calls[0][1].questions[2]).toMatchObject({ title: '无穷小是零', type: 'judgement', options: 'A. 正确\nB. 错误' })
  const review = await homework('review', ctx, { assignment_id: result.assignment_id })
  expect(review.questions[1]).toMatchObject({ question_id: 'data:q-102', actual: { choices: ['B'] } })
  expect(review.questions[3]).toMatchObject({ actual: { blanks: ['极限'] } })
  expect((await homework('answer', ctx, {
    assignment_id: result.assignment_id, answers: [{ question_id: 'data:q-102', choices: ['A', 'B'] }],
  })).questions[0]).toMatchObject({ status: 'filled', source: 'agent', actual: { choices: ['A', 'B'] } })
  expect((await homework('answer', ctx, {
    assignment_id: result.assignment_id, answers: [{ question_id: 'data:q-102', choices: ['C'] }],
  })).questions[0]).toMatchObject({ status: 'existing_answer', actual: { choices: ['A', 'B'] } })
  expect(ctx.context.clickByLocator).toHaveBeenCalledTimes(2)
  expect(ctx.context.fillByLocator).toHaveBeenCalledOnce()
  expect(ctx.context.navigateBrowserView).not.toHaveBeenCalled()
})

it('applies the requested display-number range to reading, automatic fills and the final review', async () => {
  const ctx = setup()
  ctx.doc.querySelector<HTMLInputElement>('input[type=text]')!.value = ''
  invoke.mockResolvedValueOnce([[{ id: 1, answer: '任意 ε 都存在 N' }], [], [{ id: 2, answer: 'false' }]])
  const question_range = requestedHomeworkQuestionRange('你帮我完成下 3–5 题')
  expect(question_range).toEqual({ start: 3, end: 5 })
  const args = { question_range }
  const result = await homework('answer', ctx, args)
  expect(result).toMatchObject({ ok: true, question_range, scopeTotal: 3, total: 4, filled: 1 })
  expect(result.nextOffset).toBeUndefined()
  expect(result.questions.map((row: { number: number }) => row.number)).toEqual([3, 4, 5])
  expect(ctx.context.fillByLocator).not.toHaveBeenCalled()
  expect(ctx.context.clickByLocator).toHaveBeenCalledOnce()

  enabled.mockResolvedValue(false)
  const review = await homework('review', ctx, { ...args, assignment_id: result.assignment_id })
  expect(review.questions.map((row: { number: number }) => row.number)).toEqual([3, 4, 5])
  const step = (name: string, receipt: unknown): ImportTaskStep => ({
    id: name, kind: 'tool', name: `browser_${name}_homework`, label: name, status: 'done', startedAt: 0, result: JSON.stringify(receipt),
  })
  expect(pendingHomeworkReview([step('answer', result)])).toBe(true)
  expect(pendingHomeworkReview([step('answer', result), step('review', review)])).toBe(false)

  const outOfScope = await homework('answer', ctx, { ...args, assignment_id: result.assignment_id,
    answers: [{ question_id: 'data:q-104', blanks: ['极限'] }],
  })
  expect(outOfScope).toMatchObject({ ok: false, reason: 'invalid' })
  expect(ctx.context.fillByLocator).not.toHaveBeenCalled()
})

it('rejects missing or duplicate numbers before writing and recognises read-only requests', async () => {
  const ctx = setup()
  expect(await homework('answer', ctx, { question_range: { start: 1, end: 5 } })).toMatchObject({ ok: false, reason: 'ambiguous' })
  ctx.doc.querySelector('[data=q-104] .mark_name')!.textContent = '5. （填空题）导数的定义'
  expect(await homework('answer', ctx, { question_range: { start: 3, end: 5 } })).toMatchObject({ ok: false, reason: 'ambiguous' })
  expect(invoke).not.toHaveBeenCalled()
  expect(ctx.context.clickByLocator).not.toHaveBeenCalled()
  expect(requestedHomeworkQuestionRange('把前５题做一下')).toEqual({ start: 1, end: 5 })
  expect(requestedHomeworkQuestionRange('只看第 8 题')).toEqual({ start: 8, end: 8 })
  expect(requestedHomeworkQuestionRange('跳过第 1–5 题')).toBeUndefined()
  expect(permitsHomeworkAnswers('给我看前5题')).toBe(false)
  expect(permitsHomeworkAnswers('看看第1–5题的作答情况')).toBe(false)
  expect(permitsHomeworkAnswers('不用做前5题')).toBe(false)
  expect(permitsHomeworkAnswers('你帮我完成下1-5题')).toBe(true)
})

it('pages through the numbered scope with a cursor relative to the first requested question', async () => {
  const ctx = setup()
  const sample = ctx.doc.querySelector('[data=q-101]')!
  for (let number = 7; number <= 13; number++) {
    const row = sample.cloneNode(true) as HTMLElement
    row.setAttribute('data', `q-${number}`)
    row.querySelector('.mark_name')!.textContent = `${number}. （单选题）第 ${number} 题的题干`
    ctx.doc.body.appendChild(row)
  }
  const question_range = { start: 4, end: 12 }
  const first = await homework('review', ctx, { question_range })
  expect(first.questions.map((row: { number: number }) => row.number)).toEqual([4, 5, 6, 7, 8, 9, 10, 11])
  expect(first.nextOffset).toBe(8)
  const last = await homework('review', ctx, { question_range, assignment_id: first.assignment_id, offset: first.nextOffset })
  expect(last.questions.map((row: { number: number }) => row.number)).toEqual([12])
  expect(last.nextOffset).toBeUndefined()
})

it('stops when a click is received but not reflected in the page', async () => {
  const ctx = setup(false)
  ctx.doc.querySelector<HTMLInputElement>('input[type=text]')!.value = ''
  const result = await homework('answer', ctx)
  expect(result).toMatchObject({ ok: false, reason: 'verification_required', clickDispatched: true, assignment_id: '42:7:11' })
  expect(result.questions.at(-1)).toMatchObject({ number: 5, status: 'unverified', actual: { choices: [] } })
  expect(ctx.context.onHomeworkProgress).toHaveBeenLastCalledWith(expect.objectContaining({
    phase: 'result', questions: [expect.objectContaining({ number: 5, status: 'unverified', actual: { choices: [] } })],
  }))
  expect(ctx.context.clickByLocator).toHaveBeenCalledOnce()
  expect(ctx.context.fillByLocator).not.toHaveBeenCalled()
})

it('publishes homework rows before the script runs and merges actual answers and later review by assignment', async () => {
  const ctx = setup()
  for (let i = 7; i <= 11; i++) {
    const question = ctx.doc.createElement('div')
    question.className = 'questionLi'
    question.innerHTML = `<h3 class="mark_name">${i}. 简答题 ${i}</h3>`
    ctx.doc.body.appendChild(question)
  }
  let progress: HomeworkProgress | undefined
  let messageId = 'first-turn'
  ctx.context.onHomeworkProgress.mockImplementation(update => {
    progress = mergeHomeworkProgress(progress, messageId, update)
  })
  ctx.context.clickByLocator.mockImplementationOnce(async (_id, locator) => {
    expect(progress?.questions).toHaveLength(9)
    expect(progress?.questions[2]).toMatchObject({ status: 'unanswered', actual: { choices: [] } })
    ctx.doc.querySelector(locator.value)?.closest('.answerBg')?.querySelector('.num_option')?.classList.add('check_answer')
    return { ok: true }
  })
  const result = await homework('answer', ctx)
  expect(result).toMatchObject({ total: 9, nextOffset: 8, filled: 1 })
  expect(result.questions).toHaveLength(8)
  expect(progress?.questions[2]).toMatchObject({ status: 'filled', actual: { choices: ['B'] }, source: 'bank' })
  expect(progress?.questions[8]).toMatchObject({ status: 'needs_review', stem: '简答题 11' })

  messageId = 'review-turn'
  await homework('review', ctx)
  expect(progress).toMatchObject({ messageId: 'review-turn' })
  expect(progress?.questions[2].status).toBe('filled')
  ctx.doc.querySelector('[data=q-103] .check_answer')?.classList.remove('check_answer')
  await homework('review', ctx)
  expect(progress?.questions[2]).toMatchObject({ status: 'unanswered', actual: { choices: [] } })
  expect(progress?.questions[2].source).toBeUndefined()
})

it('rejects a forged script answer, stale assignment, strict mode, and ambiguous frames', async () => {
  const ctx = setup()
  resolveScript.mockImplementation(async (_site, _id, _capability, input, validate) => ({
    result: validate(input.operation === 'page_rules' ? pageRules : { decisions: input.questions.map((q: { id: string }, i: number) => i === 2
      ? { id: q.id, status: 'ready', choices: ['A'], bankId: 2 } : { id: q.id, status: 'no_match' }) }),
  }))
  expect((await homework('answer', ctx)).questions[2]).toMatchObject({ status: 'unmatched' })
  expect(await homework('answer', ctx, { assignment_id: 'another' })).toMatchObject({ ok: false, reason: 'stale' })
  ctx.context.policy.permissionMode = 'strict'
  expect(await homework('answer', ctx)).toMatchObject({ ok: false, reason: 'invalid' })
  expect(await homework('review', ctx)).toMatchObject({ ok: true })
  ctx.context.readBrowserPage.mockResolvedValue({ url, frames: [frame, { ...frame, frameId: 'another' }] })
  expect(await homework('review', ctx)).toMatchObject({ ok: false, reason: 'ambiguous' })
  expect(ctx.context.clickByLocator).not.toHaveBeenCalled()
})

it('keeps obfuscated questions out of the automatic answer list and permits verified visual fallback', async () => {
  const ctx = setup()
  ctx.doc.querySelector('[data=q-103] .mark_name')?.classList.add('font-cxsecret')
  resolveScript.mockImplementation(async (_site, _id, _capability, input, validate) => ({
    result: validate(input.operation === 'page_rules' ? pageRules : { decisions: input.questions.map((q: { id: string }) => ({ id: q.id, status: 'no_match' })) }),
  }))
  invoke.mockResolvedValue([[], [], []])
  const result = await homework('answer', ctx)
  expect(result.questions[2]).toMatchObject({ issue: 'visual_needed', status: 'needs_review' })
  expect(invoke.mock.calls[0][1].questions.map((q: { title: string }) => q.title)).not.toContain('无穷小是零')
  expect((await homework('answer', ctx, {
    assignment_id: result.assignment_id, answers: [{ question_id: 'data:q-103', choices: ['B'] }],
  })).questions[0]).toMatchObject({ status: 'filled' })
})

it('requires a fresh review of the assignment and reopens the review after a later targeted fill', () => {
  const step = (name: string, orders: number[], mode?: 'automatic' | 'targeted'): ImportTaskStep => ({
    id: name, kind: 'tool', name: 'browser_' + name + '_homework', label: name, status: 'done', startedAt: 0,
    result: JSON.stringify({ ok: true, assignment_id: '42:7:11', mode, total: 2, questions: orders.map(order => ({ order, status: 'filled' })) }),
  })
  const first = step('answer', [1], 'automatic')
  const partial = step('review', [1])
  const last = step('review', [2])
  expect(pendingHomeworkReview([first, partial])).toBe(true)
  expect(pendingHomeworkReview([first, partial, last])).toBe(false)
  expect(pendingHomeworkReview([first, partial, last, step('answer', [1], 'targeted')])).toBe(true)
  expect(permitsHomeworkAnswers('打开作业《写作业》，不要填写')).toBe(false)
  expect(permitsHomeworkAnswers('请做完这份作业，别提交')).toBe(true)
})

it('reads, fills, and reviews the live chapter quiz by task and frame identity', async () => {
  const chapterUrl = 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=5&courseId=42&clazzid=7'
  const cardsUrl = 'https://mooc1.chaoxing.com/knowledge/cards?knowledgeid=5&courseid=42&clazzid=7&num=0'
  const workUrl = 'https://mooc1.chaoxing.com/mooc-ans/work/doHomeWorkNew?courseid=42&classId=7&knowledgeid=5&jobid=work-current&workanswerid=91'
  const chapter_key = '42:7:5'
  const quiz_job_id = 'work-current'
  const args = { chapter_key, quiz_job_id }
  const cardFrame = { url: cardsUrl, frameId: 'cards', loaderId: 'cards-doc', framePath: '0' }
  const quizFrame = { url: workUrl, frameId: 'quiz', loaderId: 'quiz-doc', framePath: '0/0/0' }
  const task = { index: 0, kind: 'quiz' as const, name: '章节测验', done: false, quizJobId: quiz_job_id, mid: '', selector: '', focusRequired: false }
  const chapter = vi.spyOn(chapters, 'readStudentChapterCard').mockResolvedValue({
    identity: chapters.studentChapterUrl(chapterUrl)!, frameId: 'top',
    header: { title: '导数', number: '2.1', remaining: 1, tab: 1, cards: chapters.chapterCardsUrl(cardsUrl), tabs: [] },
    cards: { ...cardFrame, html: '<div/>', ok: true }, jobs: [task],
  })
  const { window } = new JSDOM(readFileSync(new URL('../chaoxing/homework/chapter-quiz.html', import.meta.url), 'utf8'), {
    url: workUrl, runScripts: 'outside-only',
  })
  Object.defineProperty(window.Element.prototype, 'getClientRects', { value: () => [{ width: 100, height: 20 }] })
  const doc = window.document
  const ctx = setup()
  const frames = [cardFrame, quizFrame, { ...quizFrame, frameId: 'unrelated', framePath: '1/0' }]
  ctx.context.readBrowserPage.mockResolvedValue({ url: chapterUrl, frames })
  evaluate.mockImplementation(async (_id, script, _name, identity) => {
    expect(identity).toEqual({ frameId: 'quiz', loaderId: 'quiz-doc' })
    return window.eval(script)
  })
  ctx.context.clickByLocator.mockImplementation(async (_id, locator) => {
    expect(locator).toMatchObject({ frameId: 'quiz', loaderId: 'quiz-doc' })
    doc.querySelector(locator.value)?.closest('.answerBg')?.querySelector('.num_option')?.classList.add('check_answer')
    return { ok: true }
  })
  invoke.mockResolvedValue([[{ id: 1, answer: '甲' }]])
  try {
    const before = await homework('review', ctx, args)
    expect(before).toMatchObject({ ok: true, ...args, assignment_id: 'chapter:42:7:5:work-current:91',
      questions: [{ number: 1, stem: '章节测验题干', status: 'unanswered' }] })
    expect(invoke).not.toHaveBeenCalled()
    const { prepareWebsiteChapterQuiz } = await import('../../src/services/agent/tools/websiteChapterQuiz')
    expect(await prepareWebsiteChapterQuiz({ ...ctx.context, name: 'browser_start_chapter_tasks', args: {} }, chapter_key, quiz_job_id))
      .toMatchObject({ quiz: { assignment_id: before.assignment_id, total: 1, filled: 1, reviewed: 1, reviewNeeded: 0 } })
    expect(await homework('review', ctx, { ...args, assignment_id: before.assignment_id }))
      .toMatchObject({ questions: [{ status: 'answered', actual: { choices: ['A'] } }] })
    expect(ctx.context.clickByLocator).toHaveBeenCalledTimes(1)
    expect(await homework('answer', ctx, { ...args, chapter_key: '42:7:6' })).toMatchObject({ ok: false, reason: 'stale' })
    expect(await homework('answer', ctx, { ...args, assignment_id: 'chapter:42:7:5:work-current:90' }))
      .toMatchObject({ ok: false, reason: 'stale' })
    ctx.context.readBrowserPage.mockResolvedValue({ url: chapterUrl, frames: [...frames, { ...quizFrame, frameId: 'duplicate', framePath: '0/1/0' }] })
    expect(await homework('review', ctx, args)).toMatchObject({ ok: false, reason: 'ambiguous' })
    expect(ctx.context.clickByLocator).toHaveBeenCalledTimes(1)
  } finally { chapter.mockRestore() }
})

it('keeps the visible quiz option labels for review of image questions', async () => {
  const { courseHomeworkReadScript } = await import('../../src/services/chaoxing/host/courseHomeworkAnswers')
  const { window } = new JSDOM(readFileSync(new URL('../chaoxing/homework/chapter-quiz-zy.html', import.meta.url), 'utf8'), { runScripts: 'outside-only' })
  Object.defineProperty(window.Element.prototype, 'getClientRects', { value: () => [{ width: 100, height: 20 }] })
  window.document.querySelector<HTMLInputElement>('input[id^="answer"][name^="answer"]')!.value = 'C'
  const result = window.eval(courseHomeworkReadScript(pageRules, 0, 8, undefined, { start: 1, end: 1 }, true))
  expect(result).toMatchObject({ total: 1, scopeTotal: 1, questions: [{ number: 1, type: 'single', issue: 'visual_needed' }] })
  expect(result.questions[0].options.map((item: { label: string; selected: boolean }) => [item.label, item.selected]))
    .toEqual([['A', false], ['B', false], ['C', true], ['D', false]])
  expect(permitsChapterQuizAnswers('完成章节任务，只播放视频')).toBe(false)
  expect(permitsChapterQuizAnswers('完成章节任务，别做测验')).toBe(false)
  expect(permitsChapterQuizAnswers('看看本章测验的作答情况')).toBe(false)
  expect(permitsChapterQuizAnswers('完成本章测验，别提交')).toBe(true)
})
