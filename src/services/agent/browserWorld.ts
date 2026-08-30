import { lastHomeworkCard } from '../browser/abstractions'
import { siteGraphAgentSnap } from '../browser/siteGraph'
import { browserTaskIntent } from '../agent/browserTask'

export type BrowserWorldNext =
  | 'login'
  | 'space'
  | 'course'
  | 'list'
  | 'open'
  | 'inspect'
  | 'fill'
  | 'save'
  | 'done'

export type BrowserWorldStep = {
  name?: string
  status?: string
  label?: string
  detail?: string
}

export type BrowserWorldSnap = {
  url: string
  page: string
  next: BrowserWorldNext
  questionCount: number
  filledCount: number
  cardNext: string
  hint: string
  title: string
  inspected: boolean
  saved: boolean
  line: string
}

const stepText = (step: BrowserWorldStep) => `${step.label || ''}${step.detail || ''}`

const homeworkFlags = (steps: BrowserWorldStep[] = []) => {
  const done = steps.filter((step) => step.name === 'browser_chaoxing_homework' && step.status === 'done')
  const text = done.map(stepText).join('\n')
  return {
    used: steps.some((step) => step.name === 'browser_chaoxing_homework'),
    inspectedDo: /读到 \d+ 道题/.test(text),
    saved: /提交|已提交|已暂时保存|已暂存/.test(text),
  }
}

const graphPageOf = (url: string) => String(siteGraphAgentSnap(url)?.page || '')

export const readBrowserWorld = (input: {
  url: string
  steps?: BrowserWorldStep[]
}): BrowserWorldSnap => {
  const url = String(input.url || '')
  const page = graphPageOf(url)
  const card = lastHomeworkCard.value
  const questionCount = Number(card?.questionCount || card?.questions?.length || 0)
  const filledCount = Number(card?.filledCount || 0)
  const cardNext = String(card?.next || '')
  const onDo = page === '作业作答' || /dowork|doHomeWork|do-work/i.test(url)
  const onList = !onDo && (page === '作业列表' || /pageHeader=8|\/work\/list/i.test(url))
  const flags = homeworkFlags(input.steps)
  const inspected = flags.inspectedDo || Boolean(onDo && questionCount > 0)
  const allFilled = onDo && questionCount > 0 && filledCount >= questionCount
  const cardSaysSave = onDo && (cardNext === 'save' || cardNext === 'done')
  const cardSaved = /已暂时保存|已暂存答案|已提交/.test(String(card?.hint || ''))
  const saved = flags.saved || cardSaved

  let next: BrowserWorldNext = 'space'
  if (onDo) {
    if ((allFilled || cardSaysSave) && saved) next = 'done'
    else if (allFilled || cardSaysSave) next = 'save'
    else if (inspected) next = 'fill'
    else next = 'inspect'
  } else if (onList) {
    next = 'open'
  } else if (page === '课程' || /mycourse\/stu|studentcourse/i.test(url)) {
    next = 'course'
  } else if (page === '登录' || /passport2/i.test(url)) {
    next = 'login'
  } else if (page === '空间' || page === '课程列表') {
    next = 'space'
  }

  const counts = onDo && questionCount
    ? `${filledCount}/${questionCount} 已填`
    : onList
      ? '作业列表'
      : page || '未匹配'
  const banInspect = next === 'save' || next === 'done' || next === 'fill'
  const notLogin = next !== 'login' && page !== '登录'
  const line = [
    `任务 next=${next}`,
    `${page || '当前页'} ${counts}`,
    notLogin && (page === '空间' || page === '课程列表' || /i\.chaoxing\.com/i.test(url))
      ? '不是登录页，不要填账号'
      : '',
    banInspect ? '不要 inspect' : '',
    next === 'done' ? '可以停' : '',
  ].filter(Boolean).join(' · ')

  return {
    url,
    page,
    next,
    questionCount,
    filledCount,
    cardNext,
    hint: String(card?.hint || ''),
    title: String(card?.title || ''),
    inspected,
    saved,
    line,
  }
}

export const homeworkWorldNudge = (snap: BrowserWorldSnap) => {
  const neverHome = '禁止回导航或 zerror://home，不要重走登录。不要当刚进页。口语里的旧阶段作废，以【网页状态】的 next 为准。'
  if (snap.next === 'done') return ''
  if (snap.next === 'save') {
    return `任务 next=save。已经在作答页，题都填过了（${snap.filledCount}/${snap.questionCount}）。立刻 browser_chaoxing_homework action=save，不要 inspect。${neverHome}`
  }
  if (snap.next === 'fill') {
    return `任务 next=fill。已经在作答页，优先 fill。题干或选项读不全就 screenshot 或自己点，不要猜，不要当解析器坏了就停。${neverHome}`
  }
  if (snap.next === 'inspect') {
    return `任务 next=inspect。已经在作答页且还没有题卡。立刻 browser_chaoxing_homework inspect 一次。${neverHome}`
  }
  if (snap.next === 'open') {
    return `任务 next=open。已经在作业列表。open 用户点名的那一份，不要 inspect 当刚进页。${neverHome}`
  }
  if (snap.next === 'course') {
    if (browserTaskIntent() === 'homework') {
      return `任务 next=course。已经在课程页。点「作业」。不要点「我学的课」，不要调用作业解析。${neverHome}`
    }
    return `任务 next=course。已经在课程页。点「章节」后 click_text 小节（1.1、2.1，带橙色数字），不要点「第N章」标题——那会把子节点收起，不是进播放页。不要点「作业」，不要停。${neverHome}`
  }
  if (snap.next === 'login') {
    return `任务 next=login。用【已记账号】登录，不要问用户要密码，不要回导航。${neverHome}`
  }
  return browserTaskIntent() === 'homework'
    ? `任务 next=${snap.next}。按图谱边走：点「我学的课」→ 课名 →「作业」。不要调用作业解析。${neverHome}`
    : `任务 next=${snap.next}。按图谱边走：点「我学的课」→ 课名 →「章节」。播放任务不要点「作业」。${neverHome}`
}

export const attachWorld = <T extends Record<string, unknown>>(payload: T, url = '') => {
  const snap = readBrowserWorld({ url: String(url || payload.url || '') })
  const onSpace = snap.page === '空间' || snap.page === '课程列表' || /i\.chaoxing\.com\/base/i.test(snap.url)
  const notLogin = snap.next !== 'login' && snap.page !== '登录'
  return {
    ...payload,
    page: snap.page || payload.page,
    next: snap.next,
    world: snap.line,
    ...(notLogin && onSpace && !payload.hint
      ? { hint: '不是登录页，不要填账号。已经登录，点「我学的课」。口语里的登录页作废。' }
      : {}),
  }
}

export const isLoginWorld = (snap: { next: string; page: string; url: string }) => (
  snap.next === 'login' || snap.page === '登录' || /passport2/i.test(snap.url)
)
