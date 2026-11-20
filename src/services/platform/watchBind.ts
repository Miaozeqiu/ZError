import type { WatchBindings } from '../agent/core/watchEvents'
/** 对话循环绑视频进度监控。原生 video 与学习通 tick 都直接挂，不经站点适配器。 */
import {
  bindNativeWatchAgent,
  dropNativeWatchQueue,
  flushNativeWatchAfterTurn,
} from '../browser/videoWatchAgent'
import {
  bindChaoxingWatchAgent,
  dropWatchQueue,
  flushWatchAfterTurn,
} from '../chaoxing/browser/watchAgent'


export const bindAllWatchAgents = (input: WatchBindings) => {
  const stopNative = bindNativeWatchAgent(input)
  const stopWebsite = bindChaoxingWatchAgent(input)
  return () => { stopNative(); stopWebsite() }
}

export const flushAllWatchAfterTurn = (sessionId: string) => {
  flushNativeWatchAfterTurn(sessionId)
  flushWatchAfterTurn(sessionId)
}

export const dropAllWatchQueues = (sessionId: string) => {
  dropNativeWatchQueue(sessionId)
  dropWatchQueue(sessionId)
}
