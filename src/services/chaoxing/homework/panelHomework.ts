import { lastHomeworkCard } from '../../browser/abstractions'
import { waitMs } from '../../browser/eval'
import {
  chapterStateFor,
  findChapterInPanel,
  playChapterJobFromCard,
} from '../browser/chapters'
import { questionHasContent } from './parse'
import { inspectChaoxingHomework, openChaoxingHomeworkItem, openChaoxingHomeworkList } from './inspect'
import { fillChaoxingHomework, guessChaoxingHomework, saveChaoxingHomework, submitChaoxingHomework } from './fill'
import { pickHomeworkOption } from './pick'
import { startHomeworkLiveSync } from './live'
import type { HomeworkQuestion } from './types'

const cardQuestions = () => lastHomeworkCard.value?.questions || []

const cardUseful = (card = lastHomeworkCard.value) => {
  const questions = card?.questions || []
  if (!questions.length) return false
  const withImages = questions.some((item) => (
    Boolean(item.images?.length)
    || (item.options || []).some((opt) => opt.image || opt.images?.length)
  ))
  if (withImages) return true
  return questions.every(questionHasContent)
}

const slimQuestion = (item: HomeworkQuestion) => ({
  index: item.index,
  type: item.type,
  typeName: item.typeName,
  stem: String(item.stem || '').slice(0, 400),
  filled: Boolean(item.filled),
  options: (item.options || []).map((opt) => ({
    letter: opt.letter,
    text: String(opt.text || '').slice(0, 80),
    selected: Boolean(opt.selected),
    image: opt.image || opt.images?.length ? '［图］' : '',
  })),
  images: item.images?.length ? item.images.map(() => '［图］') : [],
})

export const readPanelHomework = () => {
  const card = lastHomeworkCard.value
  if (!card) return null
  const questions = card.questions || []
  return {
    via: 'panel' as const,
    page: card.page,
    title: card.title,
    questionCount: card.questionCount || questions.length,
    filledCount: card.filledCount || questions.filter((item) => item.filled).length,
    questions: questions.map(slimQuestion),
    works: card.works,
    pending: card.pending,
    pendingCount: card.pendingCount,
    canSave: Boolean(card.canSave || questions.length),
    canSubmit: Boolean(card.canSubmit || questions.length),
    hint: card.hint,
  }
}

const withCard = async (id: string, extra: Record<string, unknown> = {}) => {
  await startHomeworkLiveSync(id).catch(() => null)
  return {
    ...extra,
    via: 'panel',
    panel: readPanelHomework(),
  }
}

const openChapterQuizIfNeeded = async (id: string) => {
  if (cardUseful()) return false
  const jobs = chapterStateFor(id)?.jobs || []
  const quiz = jobs.find((job) => job.kind === 'quiz')
  const chapter = findChapterInPanel(id, {})
  if (!quiz || !chapter) return false
  if (!quiz.active) await playChapterJobFromCard(id, chapter, quiz)
  for (let i = 0; i < 8; i += 1) {
    await waitMs(250)
    if (cardUseful()) return true
  }
  return true
}

export const inspectPanelHomework = async (id: string) => {
  await openChapterQuizIfNeeded(id)
  if (!cardUseful()) {
    await inspectChaoxingHomework(id, { vision: true }).catch(() => null)
  }
  const panel = readPanelHomework()
  return withCard(id, {
    ok: Boolean(panel?.questions?.length || panel?.works?.length),
    hint: panel?.questions?.length
      ? '这是解析面板题卡。fill 用 index + answer（单选 A，多选 AC）。题卡页不要自己点网页选项。'
      : '解析面板还没读到题。确认已打开作业或本节测验，再 inspect。',
  })
}

export const fillPanelHomework = async (id: string, answers: unknown) => {
  const list = Array.isArray(answers) ? answers : []
  if (!list.length) {
    return { ok: false, via: 'panel', error: '缺少 answers', panel: readPanelHomework() }
  }
  if (!cardUseful()) await inspectChaoxingHomework(id, { vision: false }).catch(() => null)
  const filled: string[] = []
  const missed: string[] = []
  const blanks: unknown[] = []
  for (const raw of list) {
    const row = raw as { index?: number; id?: string; type?: string; typeName?: string; answer?: string; value?: string }
    const index = Number(row.index) || Number(row.id) || 0
    const ans = String(row.answer || row.value || '').trim()
    const type = String(row.type || row.typeName || '')
    const question = cardQuestions().find((item) => item.index === index)
    const qType = type || String(question?.typeName || question?.type || '')
    let want = ans.toUpperCase().replace(/[^A-H]/g, '')
    if (!want) {
      if (/正确|对/.test(ans)) want = 'A'
      else if (/错误|错/.test(ans)) want = 'B'
    }
    const isBlank = /填空|简答|论述|计算|blank|text/i.test(qType) || (!want && ans.length > 2)
    if (!index) {
      missed.push(String(row.id || row.index || '?'))
      continue
    }
    if (isBlank) {
      blanks.push({ ...row, index, answer: ans, type: qType })
      continue
    }
    if (!want) {
      missed.push(String(index))
      continue
    }
    const current = (question?.options || [])
      .filter((opt) => opt.selected)
      .map((opt) => String(opt.letter || '').toUpperCase())
      .filter(Boolean)
    const desired = want.split('')
    const toToggle = [
      ...current.filter((letter) => !desired.includes(letter)),
      ...desired.filter((letter) => !current.includes(letter)),
    ]
    let ok = true
    if (!toToggle.length) {
      filled.push(String(index))
      continue
    }
    for (const letter of toToggle) {
      const picked = await pickHomeworkOption(id, index, letter)
      if (!picked.ok) ok = false
    }
    if (ok) filled.push(String(index))
    else missed.push(String(index))
  }
  let blankResult: Record<string, unknown> = {}
  if (blanks.length) {
    blankResult = await fillChaoxingHomework(id, blanks) as Record<string, unknown>
    const blankFilled = Array.isArray(blankResult.filled) ? blankResult.filled.map(String) : []
    const blankMissed = Array.isArray(blankResult.missed) ? blankResult.missed.map(String) : []
    filled.push(...blankFilled)
    missed.push(...blankMissed)
  }
  const panel = readPanelHomework()
  const left = (panel?.questions || []).filter((item) => !item.filled).map((item) => item.index)
  return withCard(id, {
    ...blankResult,
    ok: filled.length > 0,
    filled,
    missed,
    leftIndexes: left,
    next: left.length ? 'fill' : 'save',
    hint: missed.length
      ? `面板点选没点上：${missed.join('、')}。再 fill 这道题。`
      : left.length
        ? `已点到题卡。还剩第 ${left.join('、')} 题。继续 fill。`
        : '题卡都填完了。save 暂存，用户要交再 submit。',
  })
}

export const guessPanelHomework = async (id: string) => {
  if (!cardUseful()) await inspectPanelHomework(id)
  const guessed = await guessChaoxingHomework(id)
  return withCard(id, { ...guessed, via: 'panel' })
}

export const runPanelHomework = async (
  id: string,
  args: { action: string; title?: string; answers?: unknown },
) => {
  const action = String(args.action || '').trim()
  if (action === 'list') return openChaoxingHomeworkList(id)
  if (action === 'open') {
    const title = String(args.title || '').trim()
    if (!title) return { error: 'open 需要 title', via: 'panel' }
    const opened = await openChaoxingHomeworkItem(id, title)
    await startHomeworkLiveSync(id).catch(() => null)
    return { ...opened, via: 'panel', panel: readPanelHomework() }
  }
  if (action === 'inspect') return inspectPanelHomework(id)
  if (action === 'fill') return fillPanelHomework(id, args.answers)
  if (action === 'guess') return guessPanelHomework(id)
  if (action === 'save') {
    const saved = await saveChaoxingHomework(id)
    return withCard(id, { ...saved })
  }
  if (action === 'submit') {
    const submitted = await submitChaoxingHomework(id)
    return withCard(id, { ...submitted })
  }
  return { error: 'action 必须是 list / open / inspect / fill / guess / save / submit', via: 'panel' }
}
