/** 监控属于当前任务；模型生成一段文字不代表任务已经结束。 */
import { watch } from 'vue'
import { videoWatchFor } from '../platform/panelAccess'
import { flushAllWatchAfterTurn } from '../platform/watchBind'
import { waitForAgentWatchEvent, wakeAgentWait } from './agentWait'

export const createWatchContinuation = (input: {
  sessionId: string; signal: AbortSignal; browserId: () => string
  waiting: (value: boolean) => void
  expectedWatch?: () => string | undefined
  canFinish?: () => boolean
}) => {
  const handled = new Set<string>()
  const completedWatches = new Set<string>()
  return async (): Promise<string | undefined> => {
    if (input.signal.aborted) throw new DOMException('已停止', 'AbortError')
    if (input.canFinish?.()) return
    const browserId = input.browserId()
    const current = videoWatchFor(browserId)
    const expected = input.expectedWatch?.()
    if (!current || current.sessionId !== input.sessionId) {
      if (expected && !completedWatches.has(expected)) return '【任务未完成】此前声明的监控已无有效登记。先读取当前页面，确认视频状态并重新挂监控，或明确报告阻塞；不能以“之后会继续”作为最终结果。'
      if (expected && completedWatches.has(expected)) return '【待核对】视频事件已到，但任务尚未最终核对。读取当前页面，处理剩余任务后使用 browser_finish(done|blocked)，不能直接结束对话。'
      return
    }
    const key = `${browserId}:${current.startedAt}:${'mid' in current ? current.mid : ''}`
    const terminal = ['done', 'lost', 'stalled', 'captcha', 'quiz'].includes(current.status)
    if (terminal && handled.has(key)) {
      if (current.status !== 'done') return `【任务未完成】视频监控仍处于 ${current.status}，请先处理或明确报告阻塞，不能声明任务已完成。`
      return '【待核对】视频已结束。先读取当前页面核对任务点和剩余任务，再使用 browser_finish(done|blocked) 最终收尾。'
    }
    input.waiting(true)
    let off: (() => void) | undefined
    try {
      const event = await waitForAgentWatchEvent({
        ...input, browserId,
        onStart: () => {
          flushAllWatchAfterTurn(input.sessionId)
          const inspect = () => {
            const live = videoWatchFor(browserId)
            if (!live || live.sessionId !== input.sessionId) {
              wakeAgentWait(input.sessionId, { reason: 'watch', event: 'monitor_lost', hint: '视频监控登记已丢失。任务尚未完成，先读取当前页确认状态并重新挂监控，不能宣称会自动继续。' })
            } else if (['done', 'lost', 'stalled', 'captcha', 'quiz'].includes(live.status)) {
              wakeAgentWait(input.sessionId, { reason: 'watch', event: live.status === 'done' ? 'video_done' : live.status,
                hint: live.status === 'done' ? '这段视频已经结束。读取最新页面，核对任务点和剩余任务后继续。' : `视频监控事件：${live.status}。先读取最新页面处理，任务尚未完成。` })
            }
          }
          off = watch(() => {
            const live = videoWatchFor(browserId)
            return [live?.sessionId, live?.status, live?.startedAt]
          }, inspect, { flush: 'post' })
          inspect()
        },
      })
      handled.add(key)
      if (expected && (event.event === 'video_done' || current.status === 'done' || current.ended)) completedWatches.add(expected)
      if (input.signal.aborted) throw new DOMException('已停止', 'AbortError')
      return `【任务继续】宿主已收到视频事件 ${event.event || event.reason}。${event.hint || event.display || ''} 当前任务仍在进行，请基于最新页面继续执行；核对所有任务实际完成后才能最终收尾。`
    } finally {
      off?.()
      input.waiting(false)
    }
  }
}
