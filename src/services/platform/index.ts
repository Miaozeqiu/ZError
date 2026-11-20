/** 站点入口。页面身份在网站地图；视频进度监控直接挂载。 */
import { bindChaoxingPageHooks } from './chaoxing/pageHooks'

export {
  bindAllWatchAgents,
  dropAllWatchQueues,
  flushAllWatchAfterTurn,
} from './watchBind'

import { registerSiteBrowserAdapter } from '../browser/siteCapabilities'
import { chaoxingBrowserAdapter } from './chaoxing/browserAdapter'
import { websiteToolNames, websiteToolHost } from '../agent/websiteToolDefinitions'
import { dispatchWebsiteTool } from './websiteToolDispatch'

let stopHooks: (() => void) | null = null
/** Only the application composition root installs compatibility adapters. */
export const ensureSiteHooks = () => {
  if (stopHooks) return stopHooks
  const stopPages = bindChaoxingPageHooks()
  const stopSite = registerSiteBrowserAdapter(chaoxingBrowserAdapter)
  const stopOther = registerSiteBrowserAdapter({
    id: 'zjooc', matches: url => { try { const host = new URL(url).hostname; return host === 'zjooc.cn' || host.endsWith('.zjooc.cn') } catch { return false } },
    navigation: { shellHint: '', homeworkHint: '', frameHint: '', isShell: () => false,
      sameCourse: () => false, isFrameUrl: () => false, isCourseListUrl: () => false,
      isNavigationTab: () => false, isHomeworkDetour: () => false },
    capabilities: {}, tools: websiteToolNames.filter(name => websiteToolHost(name) === 'zjooc.cn'),
    dispatch: dispatchWebsiteTool,
  })
  const dispose = () => {
    if (stopHooks !== dispose) return
    stopPages(); stopSite(); stopOther(); stopHooks = null
  }
  stopHooks = dispose
  return dispose
}
