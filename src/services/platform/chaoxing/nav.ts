/** 学习通导航辅助。Agent 工具只从这里认播放页 / 空间壳，不要再写 studentstudy 正则。 */
import { siteGraphForUrl, siteGraphNodeForUrl, activeFrameOf, pageRoleOfNode } from '../../browser/siteGraphCore'
import { waitMs } from '../../browser/eval'
import {
  CX_COURSE,
  CX_COURSES_TAB,
  CX_HOMEWORK_DO,
  CX_HOMEWORK_LIST,
  CX_HOST,
  CX_IFRAME_PAGE,
  CX_LOGIN,
  CX_NOT_HOMEWORK_DO,
  CX_PLAYER,
  CX_SPACE,
  CX_TAUGHT_TAB,
} from './fallback'

export const SPACE_HINT = '当前节点是空间壳。课表在 #frame_content。get_state.spaceTab 是当前页签。'
export const COURSE_HW_HINT = '当前在课程壳。侧栏「作业」是作业名单；「任务」不是作业。'
export const IFRAME_NAV_HINT = '不要把 iframe 地址当顶层网页打开。作业名单、章节目录、播放器都在页内框里。留在课程壳，用 click_text / 看快照。'

export const isChaoxingHost = (url: string) => {
  const site = siteGraphForUrl(url)
  if (site) return site.id === 'chaoxing'
  return CX_HOST.test(url)
}

export const chaoxingNodeId = (url: string) => (
  isChaoxingHost(url) ? siteGraphNodeForUrl(url)?.id || '' : ''
)

export const chaoxingCourseTab = (url: string) => {
  const node = siteGraphNodeForUrl(url)
  if (node?.id !== 'course') return ''
  return String(activeFrameOf(node, url)?.id || activeFrameOf(node, url)?.tab || '')
}

export const isChaoxingPlayerUrl = (url: string) => {
  const id = chaoxingNodeId(url)
  if (id) return id === 'study'
  return isChaoxingHost(url) && CX_PLAYER.test(url)
}

export const isChaoxingCourseUrl = (url: string) => {
  const id = chaoxingNodeId(url)
  if (id) return id === 'course' || id === 'activity'
  return isChaoxingHost(url) && CX_COURSE.test(url) && !isChaoxingPlayerUrl(url)
}

export const isChaoxingHomeworkDoUrl = (url: string) => {
  const id = chaoxingNodeId(url)
  if (id) return id === 'homework-do'
  if (!isChaoxingHost(url) || CX_NOT_HOMEWORK_DO.test(url)) return false
  return CX_HOMEWORK_DO.test(url)
}

export const isChaoxingHomeworkListUrl = (url: string) => {
  if (!isChaoxingHost(url) || isChaoxingHomeworkDoUrl(url) || isChaoxingPlayerUrl(url)) return false
  const id = chaoxingNodeId(url)
  if (id === 'homework-list') return true
  if (id === 'course') {
    const tab = chaoxingCourseTab(url)
    if (tab === 'homework' || tab === '作业') return true
  }
  if (id) return false
  return CX_HOMEWORK_LIST.test(url)
}

export const isChaoxingHomeworkUrl = (url: string) => {
  if (!isChaoxingHost(url)) return false
  if (isChaoxingHomeworkDoUrl(url) || isChaoxingHomeworkListUrl(url)) return true
  const node = siteGraphNodeForUrl(url)
  if (node) return node.parserIds.includes('homework') && node.id !== 'study'
  return false
}

export const isChaoxingCourseChapterTab = (url: string) => {
  if (isChaoxingPlayerUrl(url) || !isChaoxingCourseUrl(url)) return false
  const tab = chaoxingCourseTab(url)
  if (tab === 'chapters' || tab === '章节') return true
  if (chaoxingNodeId(url)) return false
  return /(?:^|[?&])pageHeader=1(?:&|$)|studentcourse/i.test(url)
}

export const isChaoxingStudyUrl = (url: string) => {
  if (!isChaoxingHost(url)) return false
  if (isChaoxingPlayerUrl(url) || isChaoxingCourseChapterTab(url)) return true
  const node = siteGraphNodeForUrl(url)
  if (node) return node.id !== 'course' && node.parserIds.includes('study')
  return isChaoxingHost(url) && /knowledge/i.test(url) && !isChaoxingHomeworkUrl(url)
}

/**
 * 学习通页面身份。课程壳看侧栏页签；其它节点看 id，不看 parserIds 抢位。
 * 播放页 parserIds 含 homework 只表示本节测验可用，主角色仍是 study。
 */
export const chaoxingPageRole = (url: string): string | null => {
  const node = siteGraphNodeForUrl(url)
  if (!node) return null
  if (node.id === 'course') {
    if (isChaoxingHomeworkListUrl(url)) return 'homework'
    return node.parserIds.includes('course') ? 'course' : null
  }
  return pageRoleOfNode(node)
}

/** 页面身份。先问网站地图，图谱未命中再用学习通兜底。 */
export const pageRoleForUrl = (url: string): string | null => {
  const fromGraph = chaoxingPageRole(url)
  if (fromGraph) return fromGraph
  const node = siteGraphNodeForUrl(url)
  if (node) return pageRoleOfNode(node)
  if (isChaoxingLoginUrl(url)) return 'login'
  if (isChaoxingHomeworkUrl(url)) return 'homework'
  if (isChaoxingStudyUrl(url)) return 'study'
  if (isChaoxingCourseUrl(url)) return 'course'
  return null
}

export const isChaoxingLoginUrl = (url: string) => {
  const node = siteGraphNodeForUrl(url)
  if (node) return node.id === 'login' || node.parserIds.includes('login')
  return CX_LOGIN.test(url)
}

export const isChaoxingPlayableUrl = (url: string) => (
  isChaoxingPlayerUrl(url) || isChaoxingCourseUrl(url)
)

export const isChaoxingIframeNavUrl = (url: string) => CX_IFRAME_PAGE.test(url)

export const isChaoxingSpaceShell = (nodeId: string, url = '') => (
  nodeId === 'space' && !CX_COURSES_TAB.test(url)
)

export const isChaoxingStudentCourseList = (url: string) => (
  CX_COURSES_TAB.test(url) && !CX_TAUGHT_TAB.test(url)
)

export const chaoxingCoursePageHeader = (url: string) => {
  const hit = String(url || '').match(/[?&]pageHeader=(\d+)/i)
  return hit?.[1] || ''
}

export const waitForChaoxingPlayer = async (
  liveHref: () => Promise<string>,
  maxMs = 10_000,
) => {
  const started = Date.now()
  let url = await liveHref()
  while (Date.now() - started < maxMs) {
    if (isChaoxingPlayerUrl(url)) return url
    await waitMs(400)
    url = await liveHref()
  }
  return url
}

export const readChaoxingSpaceContext = async (browserId: string, url: string) => {
  if (chaoxingNodeId(url) !== 'space' && !CX_SPACE.test(url)) return null
  return import('./spaceTab').then((mod) => mod.readSpaceList(browserId)).catch(() => null)
}
