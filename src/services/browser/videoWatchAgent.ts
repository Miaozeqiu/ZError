/** 原生 video 监测叫醒同一会话。不要走学习通配方。 */
import { hasAgentWait, wakeAgentWait } from '../agent/agentWait'
import {
  formatNativeClock,
  setNativeWatchHandler,
  type NativeWatchCheck,
  type NativeWatchKind,
} from './videoWatch'

type WatchNotify = (
  sessionId: string,
  display: string,
  modelText: string,
) => void
type WatchGate = (sessionId: string) => 'missing' | 'busy' | 'ready'

let notifyWatchImpl: WatchNotify | null = null
let sessionGateImpl: WatchGate | null = null
const queuedWatchChecks = new Map<string, NativeWatchCheck>()

const watchCheckRank: Record<NativeWatchKind, number> = {
  progress: 1,
  stalled: 2,
  lost: 3,
  done: 4,
}

const shouldDeferWatchNotify = (
  gate: 'missing' | 'busy' | 'ready',
  waiting: boolean,
) => {
  if (gate === 'missing') return 'drop' as const
  if (gate === 'busy' && !waiting) return 'queue' as const
  return 'now' as const
}

const formatWatchDisplay = (check: NativeWatchCheck) => {
  const title = check.status.title || '当前视频'
  if (check.kind === 'done') return `进度检查 · ${title} 已完成`
  if (check.kind === 'lost') return `进度检查 · ${title} 找不到播放器`
  if (check.kind === 'stalled') return `进度检查 · ${title} 进度卡住`
  const clock = `${formatNativeClock(check.status.current)} / ${formatNativeClock(check.status.duration)}`
  return `进度检查 · ${title} ${check.percent}%（${clock}）`
}

const formatWatchPrompt = (check: NativeWatchCheck) => {
  const state = check.status
  const clock = `${formatNativeClock(state.current)} / ${formatNativeClock(state.duration)}`
  const base = `【播放监控】${state.title || '当前视频'} ${clock}（${state.percent}%）paused=${state.paused} ended=${state.ended}`
  if (check.kind === 'done') return `${base}\n这段视频已经结束。`
  if (check.kind === 'lost') return `${base}\n播放器丢了。`
  if (check.kind === 'stalled') return `${base}\n进度卡住或暂停了。paused=${state.paused}。`
  return `${base}\n视频还在播。`
}

const notifyWatch = (sessionId: string, display: string, modelText: string) => {
  notifyWatchImpl?.(sessionId, display, modelText)
}

export const notifyCourseIncident = (sessionId: string, text: string) => {
  const display = '课程计划需要处理'
  if (hasAgentWait(sessionId)) {
    wakeAgentWait(sessionId, {
      reason: 'watch',
      display,
      hint: text,
      event: 'video_paused',
    })
    return
  }
  notifyWatch(sessionId, display, text)
}

let consumeCourseWatch: ((sessionId: string, kind: NativeWatchKind) => boolean) | null = null

export const setCourseWatchConsumer = (
  consumer: ((sessionId: string, kind: NativeWatchKind) => boolean) | null,
) => {
  consumeCourseWatch = consumer
}

const enqueueWatchCheck = (check: NativeWatchCheck) => {
  if (!check.sessionId) return
  const gate = sessionGateImpl?.(check.sessionId) || 'missing'
  const defer = shouldDeferWatchNotify(gate, hasAgentWait(check.sessionId))
  if (defer === 'drop') return
  if (consumeCourseWatch?.(check.sessionId, check.kind)) return
  if (defer === 'queue') {
    const prev = queuedWatchChecks.get(check.sessionId)
    if (!prev || watchCheckRank[check.kind] >= watchCheckRank[prev.kind]) {
      queuedWatchChecks.set(check.sessionId, check)
    }
    return
  }
  if (check.kind === 'progress') return
  if (hasAgentWait(check.sessionId)) {
    wakeAgentWait(check.sessionId, {
      reason: 'watch',
      display: formatWatchDisplay(check),
      hint: formatWatchPrompt(check),
      event: check.kind === 'done' ? 'video_done' : 'video_paused',
    })
    return
  }
  notifyWatch(check.sessionId, formatWatchDisplay(check), formatWatchPrompt(check))
}

export const dropNativeWatchQueue = (sessionId: string) => {
  queuedWatchChecks.delete(sessionId)
}

export const flushNativeWatchAfterTurn = (sessionId: string) => {
  const queued = queuedWatchChecks.get(sessionId)
  if (!queued) return
  queuedWatchChecks.delete(sessionId)
  if (hasAgentWait(sessionId)) {
    wakeAgentWait(sessionId, {
      reason: 'watch',
      display: formatWatchDisplay(queued),
      hint: formatWatchPrompt(queued),
      event: queued.kind === 'done' ? 'video_done' : 'video_paused',
    })
    return
  }
  window.setTimeout(() => enqueueWatchCheck(queued), 0)
}

export const bindNativeWatchAgent = (input: {
  notify: WatchNotify
  gate: WatchGate
}) => {
  notifyWatchImpl = input.notify
  sessionGateImpl = input.gate
  setNativeWatchHandler(enqueueWatchCheck)
}
