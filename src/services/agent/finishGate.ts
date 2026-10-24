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
}

export const isMultiStepIntent = (intent?: BrowserTaskIntent, extras?: {
  leftJobs?: string[]
  unfinished?: number
}) => {
  if (intent === 'homework') return true
  if (intent === 'play') return true
  return Boolean((extras?.leftJobs?.length || 0) > 1 || (extras?.unfinished || 0) > 1)
}

export const collectFinishEvidence = async (
  browserId: string,
  sessionId: string,
  extras?: { todos?: AgentTodoItem[]; role?: FinishRole },
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
    playing: videoIsPlaying(tick as never) || Boolean(tick && tick.paused === false),
    paused: tick ? (tick as { paused?: boolean }).paused !== false : undefined,
    hasVideo: Boolean(tick && ((tick as { hasVideo?: boolean }).hasVideo || (tick as { duration?: number }).duration)),
    mid: String((tick as { mid?: string } | null)?.mid || ''),
    watching: Boolean(watch && (watch.status === 'watching' || watch.status === 'paused' || watch.status === 'stalled')),
    watchStatus: String(watch?.status || ''),
    leftJobs,
    chapterJobsDone: panel?.event === 'chapter_jobs_done' || (Boolean(panel?.thisSection) && leftJobs.length === 0),
    pageSummary: Boolean(url),
    multiStep: isMultiStepIntent(intent, { leftJobs, unfinished }),
    planDone: progress?.done,
    planTotal: progress?.total,
    planComplete: progress?.complete,
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
      error: `清单还有未完成：${pending.map((item) => item.text).join('、')}。先 browser_todo check，不要口头收工。`,
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
  const loginUrl = /passport2|\/login/i.test(String(evidence.url || ''))

  if (kind === 'login' || loginUrl) {
    return { ok: false, error: '还在登录页。离开 passport 后再 finish(done)。' }
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
    if (evidence.hasVideo && evidence.paused !== false) {
      return { ok: false, error: '播放器在，但视频是暂停的。先点播放再 browser_watch。' }
    }
    if (evidence.chapterJobsDone && !evidence.leftJobs?.length) {
      return { ok: true, status: 'done', summary: text }
    }
    if (evidence.watching) {
      return { ok: false, error: '有监控或课程计划在跑。用 finish(watching)，不要标 done。' }
    }
    return { ok: false, error: '没有在播，也没有完成的课程计划。先点播放再 browser_watch，或提交 browser_course_plan。' }
  }

  return { ok: true, status: want, summary: text }
}
