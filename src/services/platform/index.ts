/** 站点入口。页面身份在网站地图；视频进度监控直接挂载。 */
import { bindChaoxingPageHooks } from './chaoxing/pageHooks'

export {
  bindAllWatchAgents,
  dropAllWatchQueues,
  flushAllWatchAfterTurn,
} from './watchBind'

import { registerSiteBrowserAdapter } from '../browser/siteCapabilities'
import { chaoxingBrowserAdapter } from './chaoxing/browserAdapter'

let stopHooks: (() => void) | null = null
/** Only the application composition root installs compatibility adapters. */
export const ensureSiteHooks = () => {
  if (stopHooks) return stopHooks
  const stopPages = bindChaoxingPageHooks()
  const stopSite = registerSiteBrowserAdapter(chaoxingBrowserAdapter)
  const dispose = () => {
    if (stopHooks !== dispose) return
    stopPages(); stopSite(); stopHooks = null
  }
  stopHooks = dispose
  return dispose
}
