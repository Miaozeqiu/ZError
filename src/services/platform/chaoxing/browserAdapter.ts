import type { SiteBrowserAdapter } from '../../browser/siteCapabilities'
import { websiteToolNames, websiteToolHost } from '../../agent/websiteToolDefinitions'
import { dispatchWebsiteTool } from '../websiteToolDispatch'
import { handleSitePageTools } from './agentPageTools'
import { isCourseChromeTab, sameChaoxingCourse } from './courseTab'
import { isSpaceListTopUrl } from './spaceTab'
import { readChaoxingCourseItems, startChaoxingCourseWatch } from './courseHost'
import { COURSE_HW_HINT, IFRAME_NAV_HINT, SPACE_HINT, isChaoxingIframeNavUrl, isChaoxingPlayerUrl, isChaoxingSpaceShell } from './nav'

export const chaoxingBrowserAdapter: SiteBrowserAdapter = {
  id: 'chaoxing', matches: url => { try { const parsed = new URL(url); return /^https?:$/.test(parsed.protocol) && (parsed.hostname === 'chaoxing.com' || parsed.hostname.endsWith('.chaoxing.com')) } catch { return false } },
  navigation: {
    shellHint: SPACE_HINT, homeworkHint: COURSE_HW_HINT, frameHint: IFRAME_NAV_HINT,
    isShell: isChaoxingSpaceShell, sameCourse: sameChaoxingCourse,
    isFrameUrl: isChaoxingIframeNavUrl, isCourseListUrl: isSpaceListTopUrl,
    isNavigationTab: isCourseChromeTab,
    isHomeworkDetour: (url, text) => text === '任务' && /stucoursemiddle|\/mycourse\/stu/i.test(url),
  },
  capabilities: { catalog: true, panel: true, capture: true, captcha: true },
  tools: websiteToolNames.filter(name => websiteToolHost(name) === 'chaoxing.com'),
  dispatch: ctx => ctx.name === 'browser_decode_chaoxing_font' ? handleSitePageTools(ctx) : dispatchWebsiteTool(ctx), pageTool: handleSitePageTools,
  readCatalog: readChaoxingCourseItems,
  watchCourse: async (browserId, sessionId, url, seed) => {
    if (!isChaoxingPlayerUrl(url)) return false
    await startChaoxingCourseWatch(browserId, sessionId, seed)
    return true
  },
}
