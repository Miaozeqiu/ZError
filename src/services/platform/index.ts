/** 站点入口。页面身份在网站地图；视频进度监控直接挂载。 */
import { bindChaoxingPageHooks } from './chaoxing/pageHooks'

export {
  bindAllWatchAgents,
  dropAllWatchQueues,
  flushAllWatchAfterTurn,
} from './watchBind'

let hooksBound = false

/** 登记学习通开页 / 点文案钩子（幂等）。 */
export const ensureSiteHooks = () => {
  if (hooksBound) return
  bindChaoxingPageHooks()
  hooksBound = true
}

ensureSiteHooks()
