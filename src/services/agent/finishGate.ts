/** finish 必须带证据。模型口头 done 不算完成。 */
import { isBrowserHome, peekAppBrowserUrl } from '../browser/appBrowser'
import { pendingTodos } from './browserTodo'
import { classifyBrowserPage, type BrowserPageKind } from './browserLoop'
import { browserTaskIntent, browserTaskTargets, isWholeCourseScope, specifiedChapterTargets, type BrowserTaskIntent } from './browserTask'
import { scopedCompletionEvidence, type ScopedCompletionProof, type ScopedCompletionEvidence } from './scopedCompletionEvidence'
import type { AgentSubagentKind } from './chatTypes'
import type { AgentTodoItem } from './chatTypes'
import { packAgentPanel, videoWatchFor } from '../platform/panelAccess'
import { isChaoxingPlayerUrl } from '../platform/chaoxing/nav'
import { readChaoxingVideoTick, videoIsPlaying } from '../chaoxing/study'
import { coursePlanFor, courseProgress } from '../browser/coursePlan'
import { courseCompletionEvidence, type CourseCompletionEvidence } from './courseCompletionEvidence'
import type { ImportTaskStep } from '../app/importTasks'
import { isReadOnlyReviewGoal, reviewObservationId } from './observationReview'
import { readStudentChapter, studentChapterUrl } from '../chaoxing/host/chapterTasks'
import { pendingHomeworkReview } from './homeworkAnswerEvidence'
import { studentCourseUrl } from '../platform/chaoxing/studentCourses'
import { isDiscussionReplyGoal } from './chapterDiscussionIntent'

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
  scopedCompletion?: ScopedCompletionEvidence
  reviewObservationId?: string
  reviewRequested?: boolean
  homeworkNavigation?: boolean
  chapterNavigation?: boolean
  chapterWorkflowDone?: boolean
  homeworkReviewPending?: boolean
  homeShortcutsDone?: boolean
  discussionRequested?: boolean
  discussionDone?: boolean
}

export const isMultiStepIntent = (intent?: BrowserTaskIntent, extras?: {
  leftJobs?: string[]
  unfinished?: number
}) => {
  if (intent === 'homework') return true
  if (intent === 'play') return true
  return Boolean((extras?.leftJobs?.length || 0) > 1 || (extras?.unfinished || 0) > 1)
}

const homeworkNavigationSucceeded = (goal = '', steps: ImportTaskStep[] = [], browserId: string) => {
  const active = goal.replace(/《[^》]*》|「[^」]*」|“[^”]*”/g, '')
    .replace(/(?:不要|不要再|不用|无需|别)(?:答题|作答|填写|提交|保存|做题)/g, '')
  if (!/作业/.test(goal) || /完成|写作业|做(?:完|题|作业|一下|下)|答题|作答|填写|提交|保存|解答|播放|视频|测验/.test(active)) return false
  const listing = /作业(?:列表|清单)|(?:有哪些|有什么)作业/.test(active)
  const opening = !listing && /打开|进入|点开/.test(active)
  if (!opening && !listing && !/列出|读取|查看|看看|看下|有哪些|有什么/.test(active)) return false
  const tool = opening ? 'browser_open_homework' : 'browser_list_homework'
  const step = steps.filter(item => item.name === tool && item.status === 'done').at(-1)
  if (!step) return false
  try {
    const result = JSON.parse(step.result || '{}')
    return result.ok === true && (opening
      ? result.opened === true && result.observed_browser_id === browserId && result.observation_id === step.id
      : result.partial === false && Array.isArray(result.assignments))
  } catch { return false }
}

export const collectFinishEvidence = async (
  browserId: string,
  sessionId: string,
  extras?: { todos?: AgentTodoItem[]; role?: FinishRole; steps?: ImportTaskStep[]; completion?: ScopedCompletionProof; goalText?: string },
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
  const targets = extras?.goalText != null ? specifiedChapterTargets(extras.goalText) : browserTaskTargets(sessionId)
  const chapterIdentity = studentChapterUrl(url)
  const chapterToolUsed = chapterIdentity && extras?.steps?.some(step =>
    step.status === 'done' && ['browser_review_chapter', 'browser_complete_chapter', 'browser_start_chapter_tasks'].includes(step.name || ''))
  const courseChapterFlow = extras?.steps?.some(step => {
    if (step.status !== 'done') return false
    if (step.name === 'browser_open_pending_chapter') return true
    if (step.name !== 'browser_start_chapter_tasks') return false
    try { return JSON.parse(step.result || '{}').scope === 'course' } catch { return false }
  })
  const chapter = chapterToolUsed && !courseChapterFlow && await readStudentChapter(id).catch(() => null)
  const chapterVerified = chapter && chapter.identity.key === chapterIdentity?.key && chapter.header.remaining === 0
  const chapterReview = extras?.steps?.filter(step => step.name === 'browser_review_chapter' && step.status === 'done').at(-1)
  const goal = extras?.goalText || ''
  const homeStep = extras?.steps?.filter(step => step.name === 'browser_home_shortcuts').at(-1)
  let homeShortcutsDone = false
  if (url && isBrowserHome(url) && homeStep?.status === 'done' && /导航|快捷入口/.test(goal)) {
    try { homeShortcutsDone = JSON.parse(homeStep.result || '{}').ok === true } catch { /* No valid receipt. */ }
  }
  const discussionRequested = Boolean(chapterIdentity && isDiscussionReplyGoal(goal))
  const discussionDone = discussionRequested && (extras?.steps || []).some(step => {
    if (!['browser_reply_chapter_discussion', 'browser_review_chapter_discussion'].includes(step.name || '') || step.status !== 'done') return false
    try {
      const result = JSON.parse(step.result || '{}')
      if (result.ok !== true || result.chapterKey !== chapterIdentity?.key || result.observed_browser_id !== id
        || result.observation_id !== step.id || !result.discussion_id) return false
      return /完成|做完|做下/.test(goal) ? result.jobDone === true : result.posted === true
    } catch { return false }
  })
  const chapterOpenGoal = goal.replace(/《[^》]*》|「[^」]*」|“[^”]*”/g, '')
    .replace(/(?:不要|不用|无需|别)(?:播放|刷课|做题|答题|作答)/g, '')
  let chapterNavigation = false
  if (chapter && chapterReview && chapter.identity.key === chapterIdentity?.key
    && /打开|进入|点开|跳到/.test(chapterOpenGoal) && !/完成|播放|刷课|看完|播完|做题|答题|作答|提交/.test(chapterOpenGoal)
    && !isWholeCourseScope(goal)
    && (targets.length ? targets.length === 1 && targets[0] === chapter.header.number
      : Boolean(chapter.header.title && goal.includes(chapter.header.title)))) {
    try {
      const result = JSON.parse(chapterReview.result || '{}')
      chapterNavigation = result.ok === true && result.chapterKey === chapter.identity.key
        && result.observed_browser_id === id && result.observation_id === chapterReview.id
    } catch { /* Invalid receipts cannot establish navigation. */ }
  }
  const chapterJobsDone = chapterToolUsed || courseChapterFlow
    ? Boolean(chapterVerified && !isWholeCourseScope(extras?.goalText || '')
      && (!targets.length || (targets.length === 1 && targets[0] === chapter.header.number)))
    : panel?.event === 'chapter_jobs_done' || (Boolean(panel?.thisSection) && !panel?.leftJobs?.length)
  const workflow = extras?.steps?.filter(step => step.name === 'browser_start_chapter_tasks' && step.status === 'done').at(-1)
  let chapterWorkflowDone = false
  if (workflow) {
    try {
      const result = JSON.parse(workflow.result || '{}')
      const course = studentCourseUrl(url)
      const liveCourse = chapterIdentity?.courseKey || (course?.clazz ? `${course.id}:${course.clazz}` : '')
      chapterWorkflowDone = result.ok === true && result.observed_browser_id === id && result.observation_id === workflow.id
        && (result.scope === 'chapter' ? chapterJobsDone && result.chapterComplete === true && chapterIdentity?.key === result.chapterKey
          : result.scope === 'course' && !targets.length && !!liveCourse && liveCourse === result.courseKey
            && result.courseComplete === true && result.pending === 0 && result.unknown === 0 && result.completed > 0)
    } catch { /* A malformed workflow receipt is not completion evidence. */ }
  }
  const leftJobs = !chapterVerified && Array.isArray(panel?.leftJobs) ? panel.leftJobs.map(String) : []
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
    chapterJobsDone,
    pageSummary: Boolean(url),
    multiStep: isMultiStepIntent(intent, { leftJobs, unfinished }),
    planDone: progress?.done,
    planTotal: progress?.total,
    planComplete: progress?.complete,
    courseCompletion: kind === 'course' ? courseCompletionEvidence(extras?.steps || [], url) : undefined,
    scopedCompletion: scopedCompletionEvidence(extras?.steps || [], id, url || '', targets, extras?.completion),
    reviewObservationId: reviewObservationId(extras?.goalText, extras?.steps || [], id, url || ''),
    reviewRequested: Boolean(extras?.goalText && isReadOnlyReviewGoal(extras.goalText)),
    homeworkNavigation: homeworkNavigationSucceeded(extras?.goalText, extras?.steps, id),
    chapterNavigation,
    chapterWorkflowDone,
    homeworkReviewPending: pendingHomeworkReview(extras?.steps || []),
    homeShortcutsDone,
    discussionRequested,
    discussionDone,
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

  if (want === 'done' && evidence.homeworkReviewPending) {
    return { ok: false, error: '作业或章节测验还没有复核完。用 browser_review_homework 逐批核对实际填写和漏题，补填后重新复核；确实无法核对时说明阻塞。' }
  }
  const role = evidence.role || 'parent'
  const pending = pendingTodos(evidence.todos)
  if (want === 'done' && role !== 'explore' && pending.length) {
    return {
      ok: false,
      error: `清单还有未完成：${pending.map((item) => item.text).join('、')}。先实际完成并核对结果，再 browser_todo check；确实无法继续时说明 blocked 原因，不能只勾选清单收尾。`,
    }
  }
  if (want === 'done' && evidence.reviewObservationId && !evidence.playing && !evidence.watching
    && (!(evidence.planTotal || 0) || evidence.planComplete)) {
    return { ok: true, status: want, summary: text }
  }
  if (want === 'done' && (evidence.homeworkNavigation || evidence.chapterNavigation || evidence.homeShortcutsDone) && !evidence.playing && !evidence.watching
    && (!(evidence.planTotal || 0) || evidence.planComplete)) {
    return { ok: true, status: want, summary: text }
  }
  if (want === 'done' && evidence.reviewRequested) {
    return { ok: false, error: '本次是只读复核，不要求完成整门课程。先在当前标签 browser_get_page / browser_screenshot 获取最新页面证据；滚动后重新读取。若本轮已执行填写、勾选、导航或写入，或仍有播放、监控、课程计划未完成，请说明具体阻塞，不要反复查询整课完成统计。' }
  }
  if (want === 'done' && evidence.chapterWorkflowDone && !evidence.playing && !evidence.watching
    && (!(evidence.planTotal || 0) || evidence.planComplete)) {
    return { ok: true, status: want, summary: text }
  }
  if (want === 'done' && evidence.discussionRequested) {
    return evidence.discussionDone
      ? { ok: true, status: want, summary: text }
      : { ok: false, error: '还没有核对讨论回复或任务点回执。请复核当前讨论后再收尾。' }
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
    if (evidence.scopedCompletion && !evidence.watching) return { ok: true, status: 'done', summary: text }
    if (kind === 'course' && !evidence.watching && evidence.courseCompletion
      && evidence.courseCompletion.completed === evidence.courseCompletion.total) {
      return { ok: true, status: 'done', summary: text }
    }
    if (evidence.chapterJobsDone && !evidence.leftJobs?.length && !evidence.watching) {
      return { ok: true, status: 'done', summary: text }
    }
    if (evidence.hasVideo && evidence.paused !== false) {
      return { ok: false, error: '播放器在，但视频是暂停的。先点播放再 browser_watch。' }
    }
    if (evidence.watching) {
      return { ok: false, error: '有监控或课程计划在跑。用 finish(watching)，不要标 done。' }
    }
    return { ok: false, error: '尚无任务已完成的页面证据。若用户只指定了编号章节，先 get_page / screenshot 核对全部目标的完成标记，再填写 completion（最新 observation_id、全部 targets 和具体 evidence）；整门课仍需完整统计。不要重复成功操作或把隐藏提示当作未完成证据。' }
  }

  return { ok: true, status: want, summary: text }
}
