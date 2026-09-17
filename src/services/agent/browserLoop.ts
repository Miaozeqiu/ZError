import { lastHomeworkCard } from '../browser/abstractions'
import { siteGraphNodeForUrl } from '../browser/siteGraphCore'
import { formatTodoNudge } from './browserTodo'
import {
  browserTaskFocus,
  browserTaskIntent,
  type BrowserTaskIntent,
} from './browserTask'
import type { BrowserEvalPolicy } from './browserEvalGuard'
import type { AgentTodoItem } from './chatTypes'

export type BrowserPageKind =
  | 'home'
  | 'login'
  | 'space'
  | 'course'
  | 'player'
  | 'homework-list'
  | 'homework-do'
  | 'unknown'

export type BrowserLoopPanel = {
  event?: string
  current?: string
  jobLine?: string
  leftJobs?: string[]
  hint?: string
  thisSection?: {
    next?: { label?: string; kind?: string } | null
  } | null
}

export type BrowserLoopSnap = {
  url: string
  nodeId: string
  page: string
  kind: BrowserPageKind
  intent: BrowserTaskIntent
  focus: string
  recipe: string
  line: string
  evalPolicy: BrowserEvalPolicy
  allowStudyPlay: boolean
  skipChapterQuiz: boolean
}

const isHomeUrl = (url: string) => (
  !url || /browser-home|localhost:1420\/browser-home|zerror:\/\/home|about:blank/i.test(url)
)

export const classifyBrowserPage = (url: string, nodeId = ''): BrowserPageKind => {
  const href = String(url || '')
  const id = String(nodeId || siteGraphNodeForUrl(href)?.id || '')
  if (id === 'login' || /passport2/i.test(href)) return 'login'
  if (id === 'study' || /studentstudy/i.test(href)) return 'player'
  if (id === 'homework-do' || /dowork|doHomeWork|\/work\/do/i.test(href)) return 'homework-do'
  if (/pageHeader=8|(?:^|[/?])work\/(?:list|index|view)/i.test(href) && !/studentstudy/i.test(href)) {
    return 'homework-list'
  }
  if (id === 'course' || /mycourse\/stu|stucoursemiddle|studentcourse/i.test(href)) return 'course'
  if (id === 'space' || /i\.chaoxing\.com|i\.mooc\.chaoxing\.com/i.test(href)) return 'space'
  if (isHomeUrl(href)) return 'home'
  return id ? 'unknown' : (href ? 'unknown' : 'home')
}

export const evalPolicyForPage = (kind: BrowserPageKind): BrowserEvalPolicy => {
  if (kind === 'player') return 'deny'
  if (kind === 'space' || kind === 'course' || kind === 'login') return 'read'
  return 'full'
}

const homeworkRecipe = (kind: BrowserPageKind, card = lastHomeworkCard.value) => {
  if (kind === 'homework-do') {
    const count = Number(card?.questionCount || card?.questions?.length || 0)
    const filled = Number(card?.filledCount || 0)
    const next = String(card?.next || '')
    const saved = /已暂时保存|已暂存答案|已提交/.test(String(card?.hint || ''))
    if (count && filled >= count && saved) return '题已填并暂存，可以停。'
    if (count && (filled >= count || next === 'save' || next === 'done')) {
      return '题已填完。立刻 browser_homework action=save，不要 inspect。'
    }
    if (count > 0 || next === 'fill') return '作答页已有题卡。browser_homework fill，一题一次。'
    return '已在作答页。立刻 browser_homework inspect。'
  }
  if (kind === 'homework-list') return '已在作业列表。open 用户点名的那一份，不要 inspect。'
  if (kind === 'course') return '已经在课程页。立刻 click_text「作业」，不要点「任务」。'
  if (kind === 'space') return '点「我学的课」→ 课名 → 侧栏「作业」。不要登录，不要 study_play。'
  if (kind === 'login') return '用 selector=#phone / #pwd / #loginBtn 登录。不要点「我学的课」。'
  if (kind === 'home') return '先打开 https://i.chaoxing.com 。已登录会进空间；被踢到登录页再填表。不要先读完 Skill。'
  if (kind === 'player') return '这是播放页上的章节测验，不是课程作业。用户要写作业就 inspect；刷课则 next 跳过。'
  return '按图谱走：我学的课 → 课名 → 作业。'
}

const playRecipe = (kind: BrowserPageKind, panel?: BrowserLoopPanel | null, focus = '') => {
  const course = focus ? `课名用「${focus}」。` : '点用户要的课名。'
  if (kind === 'home') {
    return `先打开 https://i.chaoxing.com 。已登录进空间再${course}不要先走登录页，不要先读 login.md。`
  }
  if (kind === 'login') return '用 #phone / #pwd / #loginBtn 登录。成功进空间后再点课，不要在登录页点课表。'
  if (kind === 'space') return `已登录。click_text「我学的课」→ ${course}不要再登录，不要 study_play。`
  if (kind === 'course') {
    return '点侧栏「章节」（不是「任务」），再 browser_study_chapters；有未完成节就 open=节名 或 study_play。不要 eval。'
  }
  if (kind === 'player') {
    if (panel?.event === 'quiz_left') {
      return '本节视频已完成，还剩测验。刷课默认跳过测验，立刻 browser_study_next，不要 homework / eval。'
    }
    if (panel?.event === 'chapter_jobs_done') {
      return '本节任务点都已完成。立刻 browser_study_next，不要再 play / watch。'
    }
    if (panel?.event === 'video_paused') {
      const label = panel.thisSection?.next?.label || '当前视频'
      return `${label}暂停了，没有在播。立刻 browser_study_play 指定 ${label}，禁止 watch，禁止说正在播放。禁止 eval。`
    }
    const next = panel?.thisSection?.next
    if (next?.label) {
      return `下一未完成任务点是${next.label}。browser_study_play 用 label / videoIndex 指定，再 watch + wait。禁止 eval、禁止点播放器。`
    }
    return '已在播放页。browser_study_play → watch → wait。禁止 eval / click_text「下一节」。'
  }
  if (kind === 'homework-list' || kind === 'homework-do') {
    return '当前在作业页。用户要刷课就回到课程壳点「章节」；不要把作业当章节。'
  }
  return '先看当前页，再 chapters / play。不要假装已经进课。'
}

export const recipeForPage = (input: {
  kind: BrowserPageKind
  intent?: BrowserTaskIntent
  panel?: BrowserLoopPanel | null
  focus?: string
}) => {
  const intent = input.intent || 'unknown'
  if (intent === 'homework') return homeworkRecipe(input.kind)
  return playRecipe(input.kind, input.panel, input.focus)
}

export const compactStudyPanel = (panel?: BrowserLoopPanel | null) => {
  if (!panel) return undefined
  return {
    event: panel.event,
    current: panel.current,
    jobs: panel.jobLine,
    left: panel.leftJobs,
    next: panel.thisSection?.next || null,
  }
}

export const readBrowserLoop = (input: {
  url: string
  sessionId?: string
  panel?: BrowserLoopPanel | null
}): BrowserLoopSnap => {
  const url = String(input.url || '')
  const node = siteGraphNodeForUrl(url)
  const nodeId = node?.id || ''
  const kind = classifyBrowserPage(url, nodeId)
  const intent = browserTaskIntent(input.sessionId)
  const focus = browserTaskFocus(input.sessionId)
  const recipe = recipeForPage({ kind, intent, panel: input.panel, focus })
  const page = node?.title || (
    kind === 'home' ? '导航' : kind === 'unknown' ? '' : kind
  )
  const line = [
    `【网页状态】${page || '当前页'} · ${kind}`,
    intent !== 'unknown' ? `任务=${intent}` : '',
    focus ? `课=${focus}` : '',
    input.panel?.current ? `节=${input.panel.current}` : '',
    input.panel?.jobLine ? `jobs=${input.panel.jobLine}` : '',
    input.panel?.event && input.panel.event !== 'empty' && input.panel.event !== 'need_video'
      ? `event=${input.panel.event}`
      : '',
    url ? `网址 ${url}` : '',
  ].filter(Boolean).join(' · ')
  return {
    url,
    nodeId,
    page,
    kind,
    intent,
    focus,
    recipe,
    line,
    evalPolicy: evalPolicyForPage(kind),
    allowStudyPlay: kind === 'course' || kind === 'player',
    skipChapterQuiz: intent !== 'homework' && (kind === 'player' || Boolean(input.panel?.event === 'quiz_left')),
  }
}

export const formatBrowserLiveContext = (input: {
  url: string
  sessionId: string
  todos?: AgentTodoItem[]
  panel?: BrowserLoopPanel | null
}) => {
  const snap = readBrowserLoop({
    url: input.url,
    sessionId: input.sessionId,
    panel: input.panel,
  })
  return [
    snap.line,
    `【当前步骤】${snap.recipe}`,
    `\n【任务清单】${formatTodoNudge(input.todos || [])}`,
  ].join('\n')
}
