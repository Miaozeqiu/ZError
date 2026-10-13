import { siteGraphUrlFromFrames } from '../browser/siteGraphCore'
import { CX_COURSE } from '../platform/chaoxing/fallback'

type HomeworkUrls = {
  isCourseUrl: (url: string) => boolean
  isHomeworkDoUrl: (url: string) => boolean
}

/** 顶层是课程壳、名单在 iframe 时，用内容框地址认当前页。 */
export const homeworkPageUrl = (topUrl: string, frameSrcs: string[] = []) =>
  siteGraphUrlFromFrames(topUrl, frameSrcs) || topUrl

/** 课程壳 / 进课中间页：名单可能还没出来，list/open 应能点「作业」。 */
export const isHomeworkCourseShell = (adapter: HomeworkUrls, url: string) =>
  !adapter.isHomeworkDoUrl(url)
  && (adapter.isCourseUrl(url) || CX_COURSE.test(url))

export const homeworkEnteringList = (
  adapter: HomeworkUrls,
  action: string,
  topUrl: string,
  pageUrl: string,
) =>
  ['list', 'open'].includes(action)
  && (isHomeworkCourseShell(adapter, topUrl) || isHomeworkCourseShell(adapter, pageUrl))
