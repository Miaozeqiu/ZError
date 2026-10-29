/** finish 必须带证据。模型口头 done 不算完成。 */
import { peekAppBrowserUrl } from '../browser/appBrowser'
import { pendingTodos } from './browserTodo'
import { classifyBrowserPage, type BrowserPageKind } from './browserLoop'
import { browserTaskIntent, type BrowserTaskIntent } from './browserTask'
import type { AgentSubagentKind } from './chatTypes'
import type { AgentTodoItem } from './chatTypes'
import { packAgentPanel, videoWatchFor } from '../platform/panelAccess'
import { isChaoxingPlayerUrl } from '../platform/chaoxing/nav'
import { readChaoxingVideoTick, videoIsPlaying } from '../chaoxing/study'
import { coursePlanFor, courseProgress } from '../browser/coursePlan'
import { courseCompletionEvidence, type CourseCompletionEvidence } from './courseCompletionEvidence'
import type { ImportTaskStep } from '../app/importTasks'

export type FinishStatus = 'done' | 'blocked' | 'watching'

export type FinishRole = 'parent' | AgentSubagentKind

export type FinishEvidence = {
  url?: string
  intent?: BrowserTaskIntent
  kind?: BrowserPageKind
  todos?: AgentTodoItem[]
  role?: FinishRole
  playing?: boolean
  paused?: boolean
  hasVideo?: boolean
  mid?: string
  watching?: boolean
  watchStatus?: string
  leftJobs?: string[]
  chapterJobsDone?: boolean
  pageSummary?: boolean
  multiStep?: boolean
  planDone?: number
  planTotal?: number
  planComplete?: boolean
  courseCompletion?: CourseCompletionEvidence
}

export const isMultiStepIntent = (intent?: BrowserTaskIntent, extras?: {
  leftJobs?: string[]
  unfinished?: number
}) => {
  if (intent === 'discussion') return false
  if (intent === 'homework') return true
  if (intent === 'play') return true
  return Boolean((extras?.leftJobs?.length || 0) > 1 || (extras?.unfinished || 0) > 1)
}

export const collectFinishEvidence = async (
  browserId: string,
  sessionId: string,
  extras?: { todos?: AgentTodoItem[]; role?: FinishRole; steps?: ImportTaskStep[] },
): Promise<FinishEvidence> => {
  const id = String(browserId || '').trim()
  const url = id ? peekAppBrowserUrl(id) : ''
  const intent = browserTaskIntent(sessionId)
  const kind = classifyBrowserPage(url)
  const tick = id && isChaoxingPlayerUrl(url)
    ? await readChaoxingVideoTick(id).catch(() => null)
    : null
  const watch = videoWatchFor(id)
  const panel = packAgentPanel(id)
  const plan = coursePlanFor(id)
  const progress = plan ? courseProgress(plan.items) : null
  const leftJobs = Array.isArray(panel?.leftJobs) ? panel.leftJobs.map(String) : []
  const unfinished = Array.isArray(panel?.unfinishedSections) ? panel.unfinishedSections.length : 0
  return {
    url,
    intent,
    kind,
    todos: extras?.todos || [],
    role: extras?.role || 'parent',
    // 空播放器回执会被规范化成 paused=false，不能因此认定有视频在播。
    playing: videoIsPlaying(tick as never),
    paused: tick ? (tick as { paused?: boolean }).paused !== false : undefined,
    hasVideo: Boolean(tick && ((tick as { hasVideo?: boolean }).hasVideo || (tick as { duration?: number }).duration)),
    mid: String((tick as { mid?: string } | null)?.mid || ''),
    watching: Boolean(watch?.sessionId === sessionId && (watch.status === 'watching' || watch.status === 'paused' || watch.status === 'stalled')),
    watchStatus: watch?.sessionId === sessionId ? String(watch.status) : '',
    leftJobs,
    chapterJobsDone: panel?.event === 'chapter_jobs_done' || (Boolean(panel?.thisSection) && leftJobs.length === 0),
    pageSummary: Boolean(url),
    multiStep: isMultiStepIntent(intent, { leftJobs, unfinished }),
    planDone: progress?.done,
    planTotal: progress?.total,
    planComplete: progress?.complete,
    courseCompletion: kind === 'course' ? courseCompletionEvidence(extras?.steps || [], url) : undefined,
  }
}

export const judgeFinish = (
  status: string,
  summary: string,
  evidence: FinishEvidence = {},
): { ok: true; status: FinishStatus; summary: string } | { ok: false; error: string } => {
  const want = String(status || '').trim() as FinishStatus
  const text = String(summary || '').trim()
  if (!/^(done|blocked|watching)$/.test(want)) {
    return { ok: false, error: 'status 必须是 done / blocked / watching' }
  }
  if (!text) return { ok: false, error: '缺少 summary' }

  if (want === 'blocked') {
    if (text.length < 4) return { ok: false, error: 'blocked 要写清用户需要做什么' }
    return { ok: true, status: want, summary: text }
  }

  const role = evidence.role || 'parent'
  const pending = pendingTodos(evidence.todos)
  if (want === 'done' && role !== 'explore' && pending.length) {
    return {
      ok: false,
      error: `清单还有未完成：${pending.map((item) => item.text).join('、')}。先实际完成并核对结果，再 browser_todo check；确实无法继续时说明 blocked 原因，不能只勾选清单收尾。`,
    }
  }
  if (
    want === 'done'
    && role === 'parent'
    && evidence.multiStep
    && !(evidence.todos || []).length
  ) {
    return { ok: false, error: '多步任务要先 browser_todo set 再收工。' }
  }

  if (want === 'watching') {
    if (evidence.watching || evidence.watchStatus === 'watching') {
      return { ok: true, status: want, summary: text }
    }
    return { ok: false, error: '还没有监控。先 browser_watch，再 finish(watching)。' }
  }

  if (role === 'explore') {
    if (evidence.pageSummary) {
      return { ok: true, status: 'done', summary: text }
    }
    return { ok: false, error: '探路还没有页摘要。先 get_state / get_page。' }
  }

  const intent = evidence.intent || 'unknown'
  const kind = evidence.kind || 'unknown'
  let loginUrl = false
  try {
    const url = new URL(String(evidence.url || ''))
    loginUrl = url.hostname.toLowerCase() === 'passport2.chaoxing.com' || /(?:^|\/)login(?:\/|$)/i.test(url.pathname)
  } catch { /* 没有可靠网址时不根据字符串片段猜测登录页。 */ }

  if (kind === 'login' || loginUrl) {
    return { ok: false, error: '当前仍在登录页，尚无进入目标页面的证据。先按用户目标核对登录结果；无法继续则说明具体阻塞。' }
  }

  if (intent === 'play' || kind === 'player') {
    if (evidence.planComplete) return { ok: true, status: 'done', summary: text }
    if ((evidence.planTotal || 0) > 0) {
      return {
        ok: false,
        error: `课程计划还剩 ${(evidence.planTotal || 0) - (evidence.planDone || 0)} 条。一条视频在播时用 finish(watching)。`,
      }
    }
    if (evidence.playing) {
      return { ok: false, error: '有视频在播。用 finish(watching)，不要当成整门课做完。' }
    }
    if (kind === 'course' && !evidence.watching && evidence.courseCompletion
      && evidence.courseCompletion.completed === evidence.courseCompletion.total) {
      return { ok: true, status: 'done', summary: text }
    }
    if (evidence.chapterJobsDone && !evidence.leftJobs?.length) {
      return { ok: true, status: 'done', summary: text }
    }
    if (evidence.hasVideo && evidence.paused !== false) {
      return { ok: false, error: '播放器在，但视频是暂停的。先点播放再 browser_watch。' }
    }
    if (evidence.watching) {
      return { ok: false, error: '有监控或课程计划在跑。用 finish(watching)，不要标 done。' }
    }
    return { ok: false, error: '尚无任务已完成的页面证据。先核对当前目录或任务点统计；确有未完成任务才继续执行，全部完成则读取明确统计后收尾，无法核对则说明 blocked 原因。' }
  }

  return { ok: true, status: want, summary: text }
}
