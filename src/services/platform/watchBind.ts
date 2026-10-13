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

type WatchBind = Parameters<typeof bindChaoxingWatchAgent>[0]

export const bindAllWatchAgents = (input: WatchBind) => {
  bindNativeWatchAgent(input)
  bindChaoxingWatchAgent(input)
}

export const flushAllWatchAfterTurn = (sessionId: string) => {
  flushNativeWatchAfterTurn(sessionId)
  flushWatchAfterTurn(sessionId)
}

export const dropAllWatchQueues = (sessionId: string) => {
  dropNativeWatchQueue(sessionId)
  dropWatchQueue(sessionId)
}
