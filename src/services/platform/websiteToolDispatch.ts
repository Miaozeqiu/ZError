import type { SiteToolContext } from '../browser/siteCapabilities'
/** Compatibility orchestration for repository-defined tools; host checks remain in Agent dispatch. */
export async function dispatchWebsiteTool(ctx: SiteToolContext): Promise<string | null> {
  if (ctx.name === 'browser_login_chaoxing') {
    const { handleLoginTool } = await import('../agent/tools/websiteLogin')
    return handleLoginTool(ctx as Parameters<typeof handleLoginTool>[0])
  }
  if (ctx.name === 'browser_list_courses' || ctx.name === 'browser_open_course') {
    const { handleWebsiteCourseTools } = await import('../agent/tools/websiteCourses')
    return (await handleWebsiteCourseTools(ctx as Parameters<typeof handleWebsiteCourseTools>[0]))!
  }
  if (ctx.name === 'browser_list_homework' || ctx.name === 'browser_open_homework') {
    const { handleWebsiteHomeworkTools } = await import('../agent/tools/websiteHomework')
    return (await handleWebsiteHomeworkTools(ctx as Parameters<typeof handleWebsiteHomeworkTools>[0]))!
  }
  if (ctx.name === 'browser_answer_homework' || ctx.name === 'browser_review_homework') {
    const { handleWebsiteHomeworkAnswerTools } = await import('../agent/tools/websiteHomeworkAnswers')
    return handleWebsiteHomeworkAnswerTools(ctx as Parameters<typeof handleWebsiteHomeworkAnswerTools>[0])
  }
  if (ctx.name === 'browser_review_chapter_discussion' || ctx.name === 'browser_reply_chapter_discussion') {
    const { handleWebsiteChapterDiscussion } = await import('../agent/tools/websiteChapterDiscussion')
    return handleWebsiteChapterDiscussion(ctx as Parameters<typeof handleWebsiteChapterDiscussion>[0])
  }
  if (ctx.name === 'browser_start_chapter_tasks') {
    const { startWebsiteChapterTasks } = await import('../agent/tools/websiteChapterStart')
    const { prepareWebsiteChapterQuiz } = await import('../agent/tools/websiteChapterQuiz')
    const chapter = ctx as Parameters<typeof startWebsiteChapterTasks>[0]
    return startWebsiteChapterTasks({ ...chapter,
      processQuiz: ctx.chapterQuiz && ctx.policy?.permissionMode !== 'strict'
        ? (chapterKey, jobId) => prepareWebsiteChapterQuiz(ctx as Parameters<typeof prepareWebsiteChapterQuiz>[0], chapterKey, jobId, ctx.chapterQuiz.range)
        : undefined,
    })
  }
  if (ctx.name === 'browser_open_pending_chapter') {
    const { openNextWebsiteChapter } = await import('../agent/tools/websiteChapterDirectory')
    return openNextWebsiteChapter(ctx as Parameters<typeof openNextWebsiteChapter>[0])
  }
  if (ctx.name === 'browser_review_chapter' || ctx.name === 'browser_complete_chapter') {
    const { handleWebsiteChapterTools } = await import('../agent/tools/websiteChapters')
    return handleWebsiteChapterTools(ctx as Parameters<typeof handleWebsiteChapterTools>[0])
  }
  return null
}
