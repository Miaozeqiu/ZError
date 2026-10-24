import { siteGraphForUrl, siteGraphNodeForUrl, activeFrameOf } from '../browser/siteGraphCore'
import type { PageRef } from '../browser/engine'
import {
  CX_COURSE,
  CX_HOMEWORK_DO,
  CX_HOMEWORK_LIST,
  CX_HOST,
  CX_LOGIN,
  CX_PLAYER,
  CX_SPACE,
} from '../platform/chaoxing/fallback'
import { formatLessonsNudge } from './agentLessons'
import { coursePlanFor, coursePlanSummary } from '../browser/coursePlan'
import { formatTodoNudge, toolRoundsWithoutTodoOf } from './browserTodo'
import { lastFailBlockOf } from './failGate'
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
}

const isHomeUrl = (url: string) => (
  !url || /browser-home|localhost:1420\/browser-home|zerror:\/\/home|about:blank/i.test(url)
)

const kindFromNode = (url: string, nodeId: string): BrowserPageKind | null => {
  const href = String(url || '')
  const node = siteGraphNodeForUrl(href)
  const id = String(nodeId || node?.id || '')
  if (id === 'login') return 'login'
  if (id === 'study' || /player/i.test(id) || /\/plan\/detail/i.test(href)) return 'player'
  if (id === 'homework-do') return 'homework-do'
  if (id === 'homework-list') return 'homework-list'
  if (id === 'space') return 'space'
  if (id === 'course' || id === 'activity') {
    const frame = node ? activeFrameOf(node, href) : null
    if (frame?.id === 'homework' || frame?.tab === '作业') return 'homework-list'
    return 'course'
  }
  return id ? 'unknown' : null
}

export const classifyBrowserPage = (url: string, nodeId = ''): BrowserPageKind => {
  const href = String(url || '')
  if (isHomeUrl(href)) return 'home'
  const fromGraph = kindFromNode(href, nodeId)
  if (fromGraph) return fromGraph
  const site = siteGraphForUrl(href)
  if (site && site.id !== 'chaoxing') return 'unknown'
  if (site?.id === 'chaoxing' || CX_HOST.test(href)) {
    if (CX_LOGIN.test(href)) return 'login'
    if (CX_PLAYER.test(href)) return 'player'
    if (CX_HOMEWORK_DO.test(href)) return 'homework-do'
    if (CX_HOMEWORK_LIST.test(href) && !CX_PLAYER.test(href)) return 'homework-list'
    if (CX_COURSE.test(href)) return 'course'
    if (CX_SPACE.test(href)) return 'space'
  }
  return href ? 'unknown' : 'home'
}

export const evalPolicyForPage = (kind: BrowserPageKind): BrowserEvalPolicy => {
  if (kind === 'player') return 'read'
  return 'full'
}

const PAGE_KIND_ZH: Record<BrowserPageKind, string> = {
  home: '导航',
  login: '登录页',
  space: '空间',
  course: '课程壳',
  player: '播放页',
  'homework-list': '作业列表',
  'homework-do': '作答页',
  unknown: '',
}

const INTENT_ZH: Record<BrowserTaskIntent, string> = {
  play: '刷课',
  homework: '写作业',
  unknown: '',
}

const PANEL_EVENT_ZH: Record<string, string> = {
  video_paused: '视频暂停',
  quiz_left: '只剩测验',
  chapter_jobs_done: '本节完成',
  need_video: '还没播',
  empty: '面板空',
  captcha: '验证码',
  watching: '监控中',
  playing: '播放中',
  video_done: '这段播完',
}

const EXPLORE_RECIPE = '建议：看本次快照，用 ref 点。走通后把步骤写进站点 SKILL.md。'

const learnedSkillHint = (host?: string) => {
  const dir = String(host || '').replace(/^www\./i, '').trim()
  if (!dir) return '下一步：read_agent_skill(site-learn)，按返回的 files 写下本站步骤。'
  return `本站步骤：read_agent_skill_file(site-learn, sites/${dir}/SKILL.md)。`
}

/** Agent 看见的站名：按当前 URL 主机，不要把样例站名套过来。 */
export const displaySiteName = (
  _url: string,
  site?: { id?: string; name?: string; host?: string } | null,
) => String(site?.name || '').trim()

const homeworkRecipe = (kind: BrowserPageKind) => {
  if (kind === 'homework-do') {
    return '建议：已在作答页。用快照读取完整题干和选项，用 ref 作答；按用户目标保存或提交，以页面回执核对结果。'
  }
  if (kind === 'homework-list') return '建议：在作业列表。用快照 ref 打开用户点名的那一份。'
  if (kind === 'course') return '建议：课程壳。点侧栏「作业」进入作业列表。步骤见 chaoxing Skill。'
  if (kind === 'space') return '建议：已在空间。点课名后进入作业。步骤见 chaoxing Skill。'
  if (kind === 'login') return '建议：登录页。看快照里的输入框 ref 填写。步骤见 chaoxing Skill。'
  if (kind === 'home') return '建议：导航页。先打开课程空间。步骤见 chaoxing Skill。'
  if (kind === 'player') return '建议：这是播放页上的章节测验。用快照 ref 作答或打开下一条。'
  return EXPLORE_RECIPE
}

const playRecipe = (kind: BrowserPageKind, panel?: BrowserLoopPanel | null, focus = '', tab = '') => {
  const course = focus ? `课名是「${focus}」。` : ''
  if (kind === 'home') {
    return `建议：导航页。先打开课程空间。${course}步骤见 chaoxing Skill。`
  }
  if (kind === 'login') return '建议：登录页。看快照里的输入框 ref 填写。步骤见 chaoxing Skill。'
  if (kind === 'space') return `建议：已在空间。${course}看快照，用 ref 点课名。`
  if (kind === 'course') {
    if (tab === '章节') {
      return '建议：这是章节目录，不是播放页。用快照 ref 或 click_text 打开节名。'
    }
    return '建议：还在课程壳，不是播放页。点「章节」打开目录后再进播放页。'
  }
  if (kind === 'player') {
    if (panel?.event === 'quiz_left') {
      return '建议：本节视频已完成，还剩测验。用快照 ref 打开下一条。'
    }
    if (panel?.event === 'chapter_jobs_done') {
      return '建议：本节任务点都已完成。用快照 ref 打开下一节。'
    }
    if (panel?.event === 'video_paused') {
      const label = panel.thisSection?.next?.label || '当前视频'
      return `建议：${label}暂停了，没有在播。用快照 ref 点 ${label}，播起来后再 browser_watch。`
    }
    const next = panel?.thisSection?.next
    if (next?.label) {
      return `建议：播放页，下一未完成是${next.label}。用快照 ref 点 ${next.label}，播起来后再 browser_watch。`
    }
    return '建议：已在播放页。点播放，再 browser_watch。'
  }
  if (kind === 'homework-list' || kind === 'homework-do') {
    return '建议：当前在作业页。刷课先回到课程壳的章节目录。'
  }
  return EXPLORE_RECIPE
}

const cardRecipe = (site?: { id?: string; name?: string; host?: string }, kind?: BrowserPageKind) => {
  const who = String(site?.name || site?.id || '当前站').trim()
  const host = String(site?.host || '').replace(/^www\./i, '')
  const where = host ? `${who}（${host}）` : who
  const skill = learnedSkillHint(host)
  if (kind === 'player') {
    return `建议：当前是${where}播放页。同一节往往有好几条，快照按 iframe 分段。用指定那条的 ref 点，再点播放，然后 browser_watch。走通后写入 SKILL.md。${skill}`
  }
  return `建议：当前是${where}。看本次快照，用 ref 点。没有快照就 get_page。走通后把步骤写进 SKILL.md。${skill}`
}

export const parentOrchestrationHint = (input: {
  url?: string
  sessionId?: string
  cardOk?: boolean
  invokeFails?: number
  failBlocked?: boolean
  intent?: BrowserTaskIntent
}) => {
  if (input.failBlocked || (input.invokeFails != null && input.invokeFails >= 2)) {
    return '同一参数已经失败。用刚返回的快照 ref 再点一次。'
  }
  return '看本次快照，用 ref 点。'
}

export const recipeForPage = (input: {
  kind: BrowserPageKind
  intent?: BrowserTaskIntent
  panel?: BrowserLoopPanel | null
  focus?: string
  siteId?: string
  siteName?: string
  host?: string
  tab?: string
}) => {
  const intent = input.intent || 'unknown'
  const chaoxing = !input.siteId || input.siteId === 'chaoxing'
  if (!chaoxing) {
    return cardRecipe({ id: input.siteId, name: input.siteName, host: input.host }, input.kind)
  }
  if (intent === 'homework') return homeworkRecipe(input.kind)
  return playRecipe(input.kind, input.panel, input.focus, input.tab)
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
  const site = siteGraphForUrl(url)
  const nodeId = node?.id || ''
  const kind = classifyBrowserPage(url, nodeId)
  const intent = browserTaskIntent(input.sessionId)
  const focus = browserTaskFocus(input.sessionId)
  const tab = String(activeFrameOf(node, url)?.tab || '')
  const displayName = displaySiteName(url, site)
  const zjooc = Boolean(site?.id === 'zjooc' || /zjooc\.cn/i.test(url))
  const recipe = recipeForPage({
    kind,
    intent,
    panel: input.panel,
    focus,
    siteId: site?.id || (zjooc ? 'zjooc' : undefined),
    siteName: displayName || site?.name,
    host: site?.host || (zjooc ? 'zjooc.cn' : undefined),
    tab,
  })
  const page = (node?.id === 'course' && tab === '章节')
    ? '章节目录'
    : (node?.title || PAGE_KIND_ZH[kind] || '')
  const line = [
    `【网页状态】${displayName ? `${displayName} · ` : ''}${page || '当前页'}`,
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
  }
}

const SLIM_REF_ROLES = new Set([
  'textbox', 'searchbox', 'combobox', 'button', 'link', 'tab', 'checkbox', 'menuitem', 'treeitem', 'option',
])

/** 旁白用：只要可点/可填的，截短名字，别整页 dump。 */
export const formatSlimRefs = (refs: PageRef[] | undefined | null, limit = 20) => {
  const rows = (refs || [])
    .filter((item) => !item.disabled && SLIM_REF_ROLES.has(String(item.role || '').toLowerCase()))
    .slice(0, Math.max(1, limit))
  if (!rows.length) return ''
  return `【页面控件】${rows.map((item) => {
    const role = String(item.role || 'item')
    const name = String(item.name || '').replace(/\s+/g, ' ').trim().slice(0, 28)
    const value = item.value ? `=${String(item.value).slice(0, 12)}` : ''
    return `${item.id}:${role}${name ? `「${name}」` : ''}${value}`
  }).join(' · ')}。使用对应 ref 操作；更多内容用 browser_find，失效再 get_page。`
}

/** 有卡也带上缓存里的瘦 ref。卡是捷径，不把可点项藏起来。 */
export const shouldAttachLiveRefs = (_url = '', _cardOk = false) => true

export const formatBrowserLiveContext = (input: {
  url: string
  sessionId: string
  todos?: AgentTodoItem[]
  panel?: BrowserLoopPanel | null
  browserId?: string
  role?: 'parent' | 'explore' | 'execute'
  /** 当前页可点项（瘦）。登录/无卡时由调用方快照后传入。 */
  refs?: PageRef[] | null
}) => {
  const snap = readBrowserLoop({
    url: input.url,
    sessionId: input.sessionId,
    panel: input.panel,
  })
  const todos = input.todos || []
  const mustSet = Boolean(
    (snap.intent === 'play' || snap.intent === 'homework')
    && !todos.length
    && toolRoundsWithoutTodoOf(input.sessionId) >= 2,
  )
  const goal = [
    INTENT_ZH[snap.intent] || '',
    snap.focus ? `课=${snap.focus}` : '',
  ].filter(Boolean).join(' · ')
  const eventZh = input.panel?.event
    ? (PANEL_EVENT_ZH[input.panel.event] || input.panel.event)
    : ''
  const failBlocked = lastFailBlockOf(input.sessionId)
  const recipe = failBlocked
    ? parentOrchestrationHint({
      cardOk: false,
      invokeFails: 2,
      failBlocked,
      intent: snap.intent,
    })
    : snap.recipe
  const evidence = [
    input.panel?.current ? `节=${input.panel.current}` : '',
    input.panel?.jobLine ? `任务点=${input.panel.jobLine}` : '',
    eventZh && input.panel?.event !== 'empty' && input.panel?.event !== 'need_video'
      ? `事件=${eventZh}`
      : '',
    '经验=本站 SKILL.md',
  ].filter(Boolean).join(' · ')
  const refsLine = shouldAttachLiveRefs(input.url)
    ? formatSlimRefs(input.refs)
    : ''
  return [
    '【旁白】对用户说的话、过程旁白必须用中文，不要写英文句子。',
    snap.line,
    goal ? `【目标】${goal}` : '',
    evidence ? `【证据】${evidence}` : '',
    refsLine,
    `【建议】${recipe}`,
    `\n【任务清单】${formatTodoNudge(todos, { mustSet })}`,
    formatLessonsNudge(input.url),
    coursePlanSummary(coursePlanFor(input.browserId || '')),
  ].filter(Boolean).join('\n')
}
