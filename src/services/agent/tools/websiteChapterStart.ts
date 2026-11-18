import { parseHtml, readFrameHtml } from '../../browser/domRead'
import { readStudentChapterCard, studentChapterUrl } from '../../chaoxing/host/chapterTasks'
import { studentCourseUrl } from '../../platform/chaoxing/studentCourses'
import { openNextWebsiteChapter } from './websiteChapterDirectory'
import { handleWebsiteChapterTools } from './websiteChapters'
import { handleWebsiteCourseTools } from './websiteCourses'

export type ChapterWorkflowResume = { chapterKey: string; videoMid: string }
type Context = Parameters<typeof handleWebsiteCourseTools>[0] & {
  sessionId: string
  chapterResume?: ChapterWorkflowResume
  processQuiz?: (chapterKey: string, quizJobId: string) => Promise<Record<string, unknown>>
}
const nameKey = (value: string) => value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase()

/** Opening the course, mounting the cards frame and starting the player share one host turn. */
export async function startWebsiteChapterTasks(ctx: Context): Promise<string> {
  const { args, browserId, sessionId, role, wait } = ctx
  const courseName = typeof args.course_name === 'string' ? args.course_name.trim() : ''
  const currentOnly = args.current_only === true
  const scope = currentOnly ? 'chapter' : 'course'
  const report = (result: Record<string, unknown>) => JSON.stringify({ ...result, scope })
  const fail = (error: string) => report({ ok: false, reason: 'invalid', error })
  if (role === 'explore') return fail('当前权限只能查看章节。')
  if (currentOnly && courseName) return fail('仅处理当前小节时直接在目标小节调用。')
  if (args.video_only !== undefined && typeof args.video_only !== 'boolean') return fail('video_only 必须为布尔值。')

  const initial = await readFrameHtml(browserId)
  let chapterKey: string
  let courseKey: string | undefined
  let opened: Record<string, unknown> = {}
  const openNext = async () => {
    const result = JSON.parse(await openNextWebsiteChapter({ ...ctx, openDirectory: true, courseKey }))
    if (result.ok === true && result.opened === false && result.pending === 0 && result.unknown === 0 && result.completed > 0) {
      return { ...result, status: 'course_complete', courseComplete: true, hint: '学生目录已确认全部小节完成。' }
    }
    return result
  }
  if (ctx.chapterResume) {
    const { chapterKey: expected, videoMid } = ctx.chapterResume
    const identity = studentChapterUrl(initial.url)
    if (identity?.key !== expected) return fail('视频结束后章节已经切换，请重新核对当前任务。')
    chapterKey = identity.key
    courseKey = identity.courseKey
    let recorded = false
    for (let attempt = 0; attempt < 12; attempt++) {
      await wait(attempt ? 300 : 0)
      const chapter = await readStudentChapterCard(browserId)
      if (chapter && chapter.identity.key !== expected) return fail('视频结束后章节已经切换。')
      const jobs = chapter?.jobs?.filter(job => job.kind === 'video' && job.mid === videoMid)
      if (chapter?.header.remaining === 0 || (jobs?.length === 1 && jobs[0]?.done)) { recorded = true; break }
    }
    if (!recorded) return report({ ok: true, status: 'awaiting_video_receipt', chapterKey,
      hint: '视频已结束，平台尚未确认原任务点完成。请核对当前章节状态后再继续。' })
  } else if (currentOnly) {
    const chapter = studentChapterUrl(initial.url)
    if (!chapter) return fail('请先打开要处理的目标小节。')
    chapterKey = chapter.key
    courseKey = chapter.courseKey
    ctx.onNavigation?.()
  } else {
    const currentCourse = studentCourseUrl(initial.url)
    const matchingCourse = currentCourse && !args.teacher && initial.ok
      && nameKey(parseHtml(initial.html)?.title || '') === nameKey(courseName)
    if (courseName && !matchingCourse) {
      const entry = JSON.parse(await handleWebsiteCourseTools({ ...ctx, name: 'browser_open_course', includeLandingSnapshot: false }) || '{}')
      const { snapshot: _snapshot, ...receipt } = entry
      if (entry.opened !== true) return report(receipt)
    }
    ctx.onNavigation?.()
    opened = await openNext()
    if (opened.opened !== true || typeof opened.chapterKey !== 'string') return report(opened)
    chapterKey = opened.chapterKey
    courseKey = typeof opened.courseKey === 'string' ? opened.courseKey : undefined
  }

  let result: Record<string, unknown> = {}
  let readinessChecks = 0
  const completed = new Set<string>()
  const transitions = new Set<string>()
  while (true) {
    await wait(0)
    result = JSON.parse(await handleWebsiteChapterTools({
      name: 'browser_complete_chapter', browserId, sessionId, role, wait,
      args: { chapter_key: chapterKey, video_only: args.video_only === true },
    }))
    if (result.ok === true && result.status === 'complete' && !currentOnly) {
      completed.add(chapterKey)
      const next = await openNext()
      if (next.opened !== true || typeof next.chapterKey !== 'string') return report(next)
      if (completed.has(next.chapterKey)) return fail('目录仍将已处理的小节标为待完成，请核对平台状态。')
      opened = next
      chapterKey = next.chapterKey
      readinessChecks = 0
      continue
    }
    if (result.ok === true && result.status === 'needs_quiz' && typeof result.quiz_job_id === 'string' && ctx.processQuiz) {
      return report({ ...opened, ...result, ...await ctx.processQuiz(chapterKey, result.quiz_job_id), chapterKey })
    }
    // Retry only page/player readiness reads and confirmed transitions.
    // Ambiguous clicks are returned to the Agent for verification.
    if (result.ok === true && ['tab_changed', 'job_completed', 'discussion_completed'].includes(String(result.status))) {
      const transition = JSON.stringify([chapterKey, result.status, result.tab, result.job, result.remaining])
      if (transitions.has(transition)) return fail('章节任务点没有继续推进，请核对当前页面。')
      transitions.add(transition)
      readinessChecks = 0
      continue
    }
    if (result.status !== 'loading' && result.retryable !== true) break
    if (++readinessChecks >= 12) break
    await wait(250)
  }
  return report({ ...opened, ...result, chapterKey })
}
