import { parseHtml, readFrameHtml } from '../../browser/domRead'
import { studentChapterUrl } from '../../chaoxing/host/chapterTasks'
import { studentCourseUrl } from '../../platform/chaoxing/studentCourses'
import { openNextWebsiteChapter } from './websiteChapterDirectory'
import { handleWebsiteChapterTools } from './websiteChapters'
import { handleWebsiteCourseTools } from './websiteCourses'

type Context = Parameters<typeof handleWebsiteCourseTools>[0] & { sessionId: string }
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
  let opened: Record<string, unknown> = {}
  if (currentOnly) {
    const chapter = studentChapterUrl(initial.url)
    if (!chapter) return fail('请先打开要处理的目标小节。')
    chapterKey = chapter.key
    ctx.onNavigation?.()
  } else {
    const currentCourse = studentCourseUrl(initial.url)
    const matchingCourse = currentCourse && !args.teacher && initial.ok
      && nameKey(parseHtml(initial.html)?.title || '') === nameKey(courseName)
    if (courseName && !matchingCourse) {
      const entry = JSON.parse(await handleWebsiteCourseTools({ ...ctx, name: 'browser_open_course' }) || '{}')
      const { snapshot: _snapshot, ...receipt } = entry
      if (entry.opened !== true) return report(receipt)
    }
    ctx.onNavigation?.()
    opened = JSON.parse(await openNextWebsiteChapter({ ...ctx, openDirectory: true }))
    if (opened.opened !== true || typeof opened.chapterKey !== 'string') return report(opened)
    chapterKey = opened.chapterKey
  }

  let result: Record<string, unknown> = {}
  for (let attempt = 0; attempt < 12; attempt++) {
    await wait(0)
    result = JSON.parse(await handleWebsiteChapterTools({
      name: 'browser_complete_chapter', browserId, sessionId, role, wait,
      args: { chapter_key: chapterKey, video_only: args.video_only === true },
    }))
    // Retry only page/player readiness reads and confirmed transitions.
    // Ambiguous clicks are returned to the Agent for verification.
    if (['tab_changed', 'job_completed'].includes(String(result.status))) continue
    if (result.status !== 'loading' && result.retryable !== true) break
    await wait(250)
  }
  return report({ ...opened, ...result, chapterKey })
}
