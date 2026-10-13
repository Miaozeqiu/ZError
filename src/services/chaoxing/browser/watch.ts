/** 播放监测。进度优先吃页内推送，8s 无推送才兜底 evaluate。 */
import { ref } from 'vue'
import { withIdleEval } from '../../browser/eval'
import { onBrowserTick, tickMatchesMid } from '../../browser/pushEvents'
import {
  installChaoxingVideoHook,
  readChaoxingCaptcha,
  readChaoxingVideoTick,
  videoTickHasPlayer,
  type ChaoxingVideoInfo,
  type ChaoxingVideoTick,
} from '../study'

export type VideoWatchKind = 'progress' | 'heartbeat' | 'stalled' | 'lost' | 'done' | 'quiz' | 'captcha'

export type VideoWatchState = {
  browserId: string
  sessionId: string
  title: string
  next: string
  step: string
  current: number
  duration: number
  percent: number
  paused: boolean
  ended: boolean
  jobDone: boolean | null
  quiz: boolean
  moreVideos: boolean
  videoCount: number
  videoIndex: number
  mid: string
  status: 'watching' | 'paused' | 'stalled' | 'done' | 'quiz' | 'lost' | 'captcha'
  sampledAt: number
  sampledCurrent: number
  startedAt: number
  updatedAt: number
}

export type VideoWatchCheck = {
  browserId: string
  sessionId: string
  kind: VideoWatchKind
  percent: number
  status: VideoWatchState
}

export const browserVideoWatches = ref<Record<string, VideoWatchState>>({})

const LIVE_MS = 200
const FALLBACK_MS = 8000
const INSPECT_MS = 8000
const INTERPOLATE_MS = 12000
const STALL_MS = 12000
const LOST_MS = 16000
const lastInspectAt = new Map<string, number>()

const timers = new Map<string, number[]>()
const tickUnsub = new Map<string, () => void>()
const lastPushAt = new Map<string, number>()
const fired = new Map<string, Set<number>>()
const stallNotified = new Set<string>()
const lastProgressAt = new Map<string, number>()
const lastSeenAt = new Map<string, number>()
const pausedAt = new Map<string, number>()
const inFlight = new Set<string>()

type CheckHandler = (check: VideoWatchCheck) => void
let checkHandler: CheckHandler | null = null

export const setChaoxingWatchHandler = (handler: CheckHandler) => {
  checkHandler = handler
}

export const formatVideoClock = (seconds: number) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

/** 面板常驻的进度条目（含没有 Agent 会话的空白监测）。 */
export const videoLiveFor = (browserId?: string) => {
  const id = String(browserId || '').trim()
  return id ? browserVideoWatches.value[id] || null : null
}

/**
 * Agent 正在 watch 的会话。空白监测（sessionId 为空）不算：
 * 它只是面板进度条的宿主，若也算 watch，目录轮询会停、watch 工具会说「已在监测」、
 * 接管判断会把「还没播」当成「暂停了」。
 */
export const videoWatchFor = (browserId?: string) => {
  const live = videoLiveFor(browserId)
  return live && live.sessionId ? live : null
}

const AGENT_WATCH_BUSY = new Set(['watching', 'paused', 'stalled', 'captcha', 'quiz'])

/**
 * 侧栏「停止」和禁止再发：只有 Agent 自己挂的监测算忙。
 * 播放页常驻的空白监测默认 `paused`，不能把它当成对话还在跑，否则停止钮一直亮、点了立刻被补回来。
 */
export const agentWatchBusy = (browserId?: string) => {
  const watch = videoWatchFor(browserId)
  return Boolean(watch && AGENT_WATCH_BUSY.has(watch.status))
}

const blankWatch = (id: string): VideoWatchState => {
  const now = Date.now()
  return {
    browserId: id,
    sessionId: '',
    title: '',
    next: '',
    step: '',
    current: 0,
    duration: 0,
    percent: 0,
    paused: true,
    ended: false,
    jobDone: null,
    quiz: false,
    moreVideos: false,
    videoCount: 0,
    videoIndex: 0,
    mid: '',
    status: 'paused',
    sampledAt: now,
    sampledCurrent: 0,
    startedAt: now,
    updatedAt: now,
  }
}

/** 面板/目录跟单一 store。没有 Agent watch 时也要把 tick 写进 browserVideoWatches。 */
export const attachVideoTick = (browserId: string) => {
  const id = String(browserId || '').trim()
  if (!id) return
  if (!browserVideoWatches.value[id]) {
    browserVideoWatches.value = { ...browserVideoWatches.value, [id]: blankWatch(id) }
  }
  if (!tickUnsub.has(id)) {
    lastPushAt.set(id, Date.now())
    tickUnsub.set(id, onBrowserTick(id, (tick) => {
      const watch = browserVideoWatches.value[id]
      if (!watch) return
      if (!tickMatchesMid(tick, watch.mid)) {
        // 空白监测跟着「正在播的那条」走：另一条视频开始播就换过去。
        // Agent 会话钉住 mid 不动（会话结束 done / lost 后也可以换）。
        const pinned = Boolean(watch.sessionId) && watch.status !== 'done' && watch.status !== 'lost'
        if (pinned || tick.paused || !tick.mid) return
        browserVideoWatches.value = { ...browserVideoWatches.value, [id]: { ...blankWatch(id), mid: tick.mid } }
        fired.delete(id)
        stallNotified.delete(id)
        lastProgressAt.delete(id)
        lastSeenAt.delete(id)
        pausedAt.delete(id)
      } else if (!watch.mid && tick.mid && !tick.visible && tick.paused) {
        return
      }
      lastPushAt.set(id, Date.now())
      applyTick(id, tick)
    }))
  }
  if (!timers.has(id)) {
    timers.set(id, [
      window.setInterval(() => {
        if (Date.now() - (lastPushAt.get(id) || 0) < FALLBACK_MS) return
        void syncTick(id)
      }, FALLBACK_MS),
    ])
  }
}

/** watch 工具先看本地监控状态，不要再打一轮重读播放器（会占死 eval，播完也送不进对话）。 */
export const watchSessionFastPath = (
  existing: Pick<VideoWatchState, 'status' | 'ended'> | null | undefined,
  panelEvent?: string | null,
): 'panel_clear' | 'ended' | 'already' | null => {
  if (panelEvent === 'quiz_left' || panelEvent === 'chapter_jobs_done') return 'panel_clear'
  if (!existing) return null
  if (existing.ended || existing.status === 'done') return 'ended'
  if (existing.status === 'watching' || existing.status === 'paused' || existing.status === 'stalled') return 'already'
  return null
}

const livePercent = (current: number, duration: number, done: boolean) => {
  if (done) return 100
  if (!(duration > 0)) return 0
  return Math.max(0, Math.min(100, (current / duration) * 100))
}

const emit = (kind: VideoWatchKind, state: VideoWatchState) => {
  checkHandler?.({
    browserId: state.browserId,
    sessionId: state.sessionId,
    kind,
    percent: Math.round(state.percent),
    status: { ...state },
  })
}

const patchWatch = (browserId: string, patch: Partial<VideoWatchState>) => {
  const current = browserVideoWatches.value[browserId]
  if (!current) return null
  Object.assign(current, patch, { updatedAt: Date.now() })
  return current
}

const clearTimers = (browserId: string) => {
  for (const timer of timers.get(browserId) || []) window.clearInterval(timer)
  timers.delete(browserId)
  tickUnsub.get(browserId)?.()
  tickUnsub.delete(browserId)
  inFlight.delete(browserId)
}

export const stopChaoxingWatch = (browserId?: string, opts?: { keep?: boolean }) => {
  const id = String(browserId || '').trim()
  if (!id) return
  clearTimers(id)
  fired.delete(id)
  stallNotified.delete(id)
  lastProgressAt.delete(id)
  lastSeenAt.delete(id)
  pausedAt.delete(id)
  lastInspectAt.delete(id)
  lastPushAt.delete(id)
  if (!opts?.keep && browserVideoWatches.value[id]) {
    const rest = { ...browserVideoWatches.value }
    delete rest[id]
    browserVideoWatches.value = rest
  }
}

/** 进度条本地实时更新；只在播完时叫醒后续逻辑，不再按 25/50/75 里程碑打扰 Agent。 */
const emitMarks = (state: VideoWatchState, done: boolean) => {
  const marks = fired.get(state.browserId) || new Set<number>()
  if (done && !marks.has(100)) {
    marks.add(100)
    fired.set(state.browserId, marks)
    emit('done', state)
    void import('../study/debug').then(({ noteStudyParser }) => {
      noteStudyParser({
        via: 'watch-done',
        tick: {
          current: state.current,
          duration: state.duration,
          paused: state.paused,
          ended: true,
          jobDone: state.jobDone,
        },
        playing: false,
        force: true,
      })
    }).catch(() => {})
    stopChaoxingWatch(state.browserId, { keep: true })
    return true
  }
  return false
}

const applyTick = (browserId: string, tick: ChaoxingVideoTick | null, meta?: Partial<VideoWatchState>) => {
  const watch = browserVideoWatches.value[browserId]
  if (!watch) return
  if (!tick) return
  if (!videoTickHasPlayer(tick)) {
    const last = lastSeenAt.get(browserId) || watch.startedAt
    if (Date.now() - last >= LOST_MS) {
      const next = patchWatch(browserId, { status: 'lost' })
      if (next && !stallNotified.has(browserId)) {
        stallNotified.add(browserId)
        emit('lost', next)
      }
      stopChaoxingWatch(browserId, { keep: true })
    }
    return
  }

  lastSeenAt.set(browserId, Date.now())
  const duration = tick.duration > 0 ? tick.duration : watch.duration
  const current = Math.max(0, Number(tick.current) || 0)
  const mid = String(tick.mid || watch.mid || '')
  if (watch.current > 3 && current < 1 && duration > 1 && !tick.ended && current < watch.current - 3) {
    return
  }
  const nearEnd = duration > 1 && current >= duration - 0.5
  const done = Boolean(tick.ended || nearEnd)
  const prev = watch.sampledCurrent
  if (!tick.paused && (current >= prev + 0.35 || done)) {
    lastProgressAt.set(browserId, Date.now())
    stallNotified.delete(browserId)
    pausedAt.delete(browserId)
  }
  if (tick.paused && !done) {
    if (!pausedAt.has(browserId)) pausedAt.set(browserId, Date.now())
  } else if (!tick.paused) {
    pausedAt.delete(browserId)
  }
  const pausedLong = Boolean(tick.paused && !done && Date.now() - (pausedAt.get(browserId) || Date.now()) >= STALL_MS)
  const stalled = !tick.paused && !done && Date.now() - (lastProgressAt.get(browserId) || watch.startedAt) >= STALL_MS
  const status = done
    ? 'done'
    : pausedLong || stalled
      ? 'stalled'
      : tick.paused
        ? 'paused'
        : 'watching'
  const next = patchWatch(browserId, {
    ...meta,
    current,
    duration,
    percent: livePercent(current, duration, done),
    paused: Boolean(tick.paused),
    ended: done || Boolean(tick.ended),
    status,
    sampledAt: Date.now(),
    sampledCurrent: current,
    mid,
  })
  if (!next) return
  if ((pausedLong || stalled) && !done && !stallNotified.has(browserId)) {
    stallNotified.add(browserId)
    emit('stalled', next)
  }
  emitMarks(next, done)
}

const applyInspect = (browserId: string, info: ChaoxingVideoInfo | null) => {
  const watch = browserVideoWatches.value[browserId]
  if (!watch) return
  if (info?.captcha) {
    const next = patchWatch(browserId, {
      title: '验证码',
      quiz: false,
      status: 'captcha',
    })
    if (next) emit('captcha', next)
    stopChaoxingWatch(browserId, { keep: true })
    return
  }
  if (info?.quiz) {
    const next = patchWatch(browserId, {
      title: info.current || watch.title,
      next: info.next || '',
      step: info.step || watch.step,
      quiz: true,
      status: 'quiz',
    })
    if (next) emit('quiz', next)
    stopChaoxingWatch(browserId, { keep: true })
    return
  }
  if (info?.video) {
    applyTick(browserId, info.video, {
      title: info.current || watch.title,
      next: info.next || watch.next,
      step: info.step || watch.step,
      jobDone: info.jobDone ?? watch.jobDone,
      moreVideos: Boolean(info.moreVideos),
      videoCount: Number(info.videoCount) || watch.videoCount,
      videoIndex: Number(info.videoIndex) || watch.videoIndex,
    })
    return
  }
  patchWatch(browserId, {
    title: info?.current || watch.title,
    next: info?.next || watch.next,
    step: info?.step || watch.step,
    jobDone: info?.jobDone ?? watch.jobDone,
    moreVideos: info?.moreVideos ?? watch.moreVideos,
    videoCount: Number(info?.videoCount) || watch.videoCount,
    videoIndex: Number(info?.videoIndex) || watch.videoIndex,
  })
}

const tickLive = (browserId: string) => {
  const watch = browserVideoWatches.value[browserId]
  if (!watch) return
  if (watch.paused || watch.ended || watch.status !== 'watching') return
  if (!(watch.sampledAt > 0) || !(watch.duration > 1)) return
  if (Date.now() - watch.sampledAt > INTERPOLATE_MS) return
  const elapsed = (Date.now() - watch.sampledAt) / 1000
  if (elapsed < 0.05) return
  const current = Math.min(watch.duration, watch.sampledCurrent + elapsed)
  const done = Boolean(watch.ended || (watch.duration > 0 && current >= watch.duration - 0.15))
  const next = patchWatch(browserId, {
    current,
    percent: livePercent(current, watch.duration, done),
    status: done ? 'done' : 'watching',
    ended: done || watch.ended,
  })
  if (next && done) emitMarks(next, true)
}

const inspectCaptcha = async (browserId: string) => {
  const watch = browserVideoWatches.value[browserId]
  if (!watch || watch.status !== 'watching' || watch.paused) return
  lastInspectAt.set(browserId, Date.now())
  if (await withIdleEval(() => readChaoxingCaptcha(browserId))) {
    applyInspect(browserId, {
      page: 'captcha',
      captcha: true,
      quiz: false,
      video: null,
      hint: '',
    })
  }
}

const syncTick = async (browserId: string) => {
  if (!browserVideoWatches.value[browserId] || inFlight.has(browserId)) return
  inFlight.add(browserId)
  try {
    const tick = await readChaoxingVideoTick(browserId)
    if (tick) applyTick(browserId, tick)
    const due = Date.now() - (lastInspectAt.get(browserId) || 0) >= INSPECT_MS
    if (due) await inspectCaptcha(browserId)
  } catch {
    // 探测失败继续本地走表，不要把进度打回 0
  } finally {
    inFlight.delete(browserId)
  }
}

export const startChaoxingWatch = (
  browserId: string,
  sessionId: string,
  seed?: {
    current?: number
    duration?: number
    paused?: boolean
    ended?: boolean
    title?: string
    next?: string
    step?: string
    moreVideos?: boolean
    videoCount?: number
    videoIndex?: number
    mid?: string
  },
  opts?: { resume?: boolean },
) => {
  const id = String(browserId || '').trim()
  const sid = String(sessionId || '').trim()
  if (!id || !sid) return null
  const prev = browserVideoWatches.value[id]
  const resume = Boolean(opts?.resume && prev)
  clearTimers(id)
  if (!resume) {
    fired.set(id, new Set())
    stallNotified.delete(id)
    pausedAt.delete(id)
  }
  lastProgressAt.set(id, Date.now())
  lastSeenAt.set(id, Date.now())
  const duration = Math.max(0, Number(seed?.duration) || 0)
  const current = Math.max(0, Number(seed?.current) || 0)
  const done = Boolean(seed?.ended)
  const now = Date.now()
  const state: VideoWatchState = {
    browserId: id,
    sessionId: sid,
    title: String(seed?.title || prev?.title || '').trim(),
    next: String(seed?.next || prev?.next || '').trim(),
    step: String(seed?.step || prev?.step || '').trim(),
    current,
    duration,
    percent: livePercent(current, duration, done),
    paused: Boolean(seed?.paused),
    ended: done,
    jobDone: prev?.jobDone ?? null,
    quiz: false,
    moreVideos: Boolean(seed?.moreVideos ?? prev?.moreVideos),
    videoCount: Number(seed?.videoCount) || prev?.videoCount || 0,
    videoIndex: Number(seed?.videoIndex) || prev?.videoIndex || 0,
    mid: String(seed?.mid || prev?.mid || ''),
    status: done ? 'done' : seed?.paused ? 'paused' : 'watching',
    sampledAt: now,
    sampledCurrent: current,
    startedAt: now,
    updatedAt: now,
  }
  browserVideoWatches.value = { ...browserVideoWatches.value, [id]: state }
  // 本地读进度条即可；不设 heartbeat，避免定时叫醒 Agent
  lastInspectAt.set(id, now)
  lastPushAt.set(id, now)
  tickUnsub.get(id)?.()
  tickUnsub.set(id, onBrowserTick(id, (tick) => {
    // 叠着的多视频页每条都会推；只认监测中的那条 mid，否则视频 1 的 pause 会把视频 2 标成暂停
    const watch = browserVideoWatches.value[id]
    if (!watch || !tickMatchesMid(tick, watch.mid)) return
    if (!watch.mid && tick.mid && !tick.visible && tick.paused) return
    lastPushAt.set(id, Date.now())
    applyTick(id, tick)
  }))
  timers.set(id, [
    window.setInterval(() => tickLive(id), LIVE_MS),
    window.setInterval(() => {
      if (Date.now() - (lastPushAt.get(id) || 0) < FALLBACK_MS) return
      void syncTick(id)
    }, FALLBACK_MS),
  ])
  void installChaoxingVideoHook(id).then((tick) => {
    if (tick && 'current' in tick) applyTick(id, tick as ChaoxingVideoTick)
  }).catch(() => {})
  void syncTick(id)
  return state
}
