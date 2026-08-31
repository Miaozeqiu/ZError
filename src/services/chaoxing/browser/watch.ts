import { ref } from 'vue'
import {
  installChaoxingVideoHook,
  readChaoxingVideo,
  readChaoxingVideoTick,
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
const SYNC_MS = 1000
const INSPECT_MS = 8000
const STALL_MS = 12000
const LOST_MS = 16000

const timers = new Map<string, number[]>()
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

export const videoWatchFor = (browserId?: string) => {
  const id = String(browserId || '').trim()
  return id ? browserVideoWatches.value[id] || null : null
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
  const next = { ...current, ...patch, updatedAt: Date.now() }
  browserVideoWatches.value = { ...browserVideoWatches.value, [browserId]: next }
  return next
}

const clearTimers = (browserId: string) => {
  for (const timer of timers.get(browserId) || []) window.clearInterval(timer)
  timers.delete(browserId)
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
    stopChaoxingWatch(state.browserId, { keep: true })
    return true
  }
  return false
}

const applyTick = (browserId: string, tick: ChaoxingVideoTick | null, meta?: Partial<VideoWatchState>) => {
  const watch = browserVideoWatches.value[browserId]
  if (!watch) return
  if (!tick || (!tick.duration && !tick.current && tick.paused == null)) {
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
    ended: Boolean(tick.ended),
    status,
    sampledAt: Date.now(),
    sampledCurrent: current,
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
  if (Date.now() - watch.sampledAt > 1500) return
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

const syncTick = async (browserId: string) => {
  if (!browserVideoWatches.value[browserId] || inFlight.has(browserId)) return
  inFlight.add(browserId)
  try {
    const tick = await readChaoxingVideoTick(browserId)
    applyTick(browserId, tick)
  } catch {
    applyTick(browserId, null)
  } finally {
    inFlight.delete(browserId)
  }
}

const inspectTick = async (browserId: string) => {
  if (!browserVideoWatches.value[browserId]) return
  try {
    const info = await readChaoxingVideo(browserId)
    applyInspect(browserId, info)
  } catch {
    // keep live clock
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
    status: done ? 'done' : seed?.paused ? 'paused' : 'watching',
    sampledAt: now,
    sampledCurrent: current,
    startedAt: now,
    updatedAt: now,
  }
  browserVideoWatches.value = { ...browserVideoWatches.value, [id]: state }
  // 本地读进度条即可；不设 heartbeat，避免定时叫醒 Agent
  timers.set(id, [
    window.setInterval(() => tickLive(id), LIVE_MS),
    window.setInterval(() => { void syncTick(id) }, SYNC_MS),
    window.setInterval(() => { void inspectTick(id) }, INSPECT_MS),
  ])
  void installChaoxingVideoHook(id).then((tick) => {
    if (tick && 'current' in tick) applyTick(id, tick as ChaoxingVideoTick)
  }).catch(() => {})
  void syncTick(id)
  void inspectTick(id)
  window.setTimeout(() => { void inspectTick(id) }, 800)
  window.setTimeout(() => { void inspectTick(id) }, 2400)
  return state
}
