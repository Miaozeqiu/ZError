import { chaoxingUrl } from '../../platform/chaoxing/studentCourses'
import { readStudentChapterCard, studentChapterUrl } from './chapterTasks'

type Frame = { url: string; frameId?: string; loaderId?: string; framePath?: string }

export async function locateChapterQuiz(
  browserId: string, pageUrl: string, frames: Frame[], chapterKey: unknown, quizJobId: unknown,
) {
  const chapter = await readStudentChapterCard(browserId)
  if (!chapter || studentChapterUrl(pageUrl)?.href !== chapter.identity.href
    || (chapterKey !== undefined && chapterKey !== chapter.identity.key)) {
    return { ok: false as const, reason: 'stale', error: '当前章节已变化，请重新复核章节。' }
  }
  const jobs = chapter.jobs?.filter(job => job.kind === 'quiz' && job.quizJobId && (quizJobId === undefined || quizJobId === job.quizJobId)) || []
  const job = jobs[0]
  if (jobs.length !== 1 || !job?.quizJobId) {
    return { ok: false as const, reason: jobs.length > 1 ? 'ambiguous' : 'not_found',
      error: '未定位到唯一的章节测验任务点。请用 browser_review_chapter 核对当前页签和 quiz_job_id。' }
  }
  const cards = frames.find(frame => frame.frameId && frame.frameId === chapter.cards?.frameId && frame.url === chapter.cards.url)
  const [course, clazz] = chapter.identity.courseKey.split(':')
  const candidates = cards?.framePath ? frames.flatMap(frame => {
    if (!frame.frameId || !frame.loaderId || !frame.framePath?.startsWith(cards.framePath + '/')) return []
    const url = chaoxingUrl(frame.url)
    if (!url || !/^\/(?:(?:mooc2?-ans)\/)?work\/dohomework(?:new)?\/?$/i.test(url.pathname)) return []
    const params = new Map([...url.searchParams].map(([key, value]) => [key.toLowerCase(), value]))
    if (params.get('courseid') !== course || (params.get('classid') ?? params.get('clazzid')) !== clazz
      || params.get('knowledgeid') !== chapter.identity.chapterId
      || (params.get('originjobid') || params.get('jobid')) !== job.quizJobId) return []
    const answerId = params.get('workanswerid')
    return [{ frame, answerId: answerId && /^\d+$/.test(answerId) ? answerId : '' }]
  }) : []
  if (candidates.length !== 1) {
    return { ok: false as const, reason: candidates.length > 1 ? 'ambiguous' : 'not_found',
      error: '未核对到唯一的章节测验作答框。请确认测验已加载，再读取当前页。' }
  }
  const { frame, answerId } = candidates[0]
  return { ok: true as const, frame, done: job.done, title: job.name || `${chapter.header.title} · 章节测验`,
    chapterKey: chapter.identity.key, quizJobId: job.quizJobId,
    assignmentId: ['chapter', chapter.identity.key, job.quizJobId, answerId].filter(Boolean).join(':') }
}
