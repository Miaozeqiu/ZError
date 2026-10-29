/** 通用原生 `<video>` 监控。blob / 非学习通 CDN 没有 overlay 推送，只能 eval 轮询。 */
import { ref } from 'vue'
import { asObject } from './eval'
import { callProtocol } from './protocol'
import type { BrowserLocator } from './engine/types'

export type NativeVideoTick = {
  hasVideo: boolean
  current: number
  duration: number
  paused: boolean
  ended: boolean
  src: string
  frameId?: string
  loaderId?: string
  nth?: number
  value?: string
}

export type NativeWatchStatus = 'watching' | 'paused' | 'stalled' | 'done' | 'lost'

export type NativeWatchState = {
  browserId: string
  sessionId: string
  title: string
  src: string
  current: number
  duration: number
  percent: number
  paused: boolean
  ended: boolean
  status: NativeWatchStatus
  sampledAt: number
  sampledCurrent: number
  startedAt: number
  updatedAt: number
  locator?: BrowserLocator
}

export type NativeWatchKind = 'progress' | 'stalled' | 'lost' | 'done'

export type NativeWatchCheck = {
  browserId: string
  sessionId: string
  kind: NativeWatchKind
  percent: number
  status: NativeWatchState
}

export const NATIVE_STALL_MS = 12_000
export const NATIVE_LOST_MS = 16_000

const intervalOf = (fn: () => void, ms: number) => {
  const host = typeof window !== 'undefined' ? window : globalThis
  return host.setInterval(fn, ms) as unknown as number
}

const clearIntervalOf = (id: number) => {
  const host = typeof window !== 'undefined' ? window : globalThis
  host.clearInterval(id)
}
const LIVE_MS = 200
const POLL_MS = 1000
const INTERPOLATE_MS = 12_000

const nativeWatches = ref<Record<string, NativeWatchState>>({})
const timers = new Map<string, number[]>()
const inFlight = new Set<string>()
const generations = new Map<string, number>()
const lastProgressAt = new Map<string, number>()
const lastSeenAt = new Map<string, number>()
const pausedAt = new Map<string, number>()
const stallNotified = new Set<string>()
const doneFired = new Set<string>()

type CheckHandler = (check: NativeWatchCheck) => void
let checkHandler: CheckHandler | null = null

export const setNativeWatchHandler = (handler: CheckHandler | null) => {
  checkHandler = handler
}

const AGENT_WATCH_BUSY = new Set<NativeWatchStatus>(['watching', 'paused', 'stalled'])

export const nativeWatchFor = (browserId?: string) => {
  const id = String(browserId || '').trim()
  const live = id ? nativeWatches.value[id] || null : null
  return live && live.sessionId ? live : null
}

export const nativeWatchBusy = (browserId?: string) => {
  const watch = nativeWatchFor(browserId)
  return Boolean(watch && AGENT_WATCH_BUSY.has(watch.status))
}

export const formatNativeClock = (seconds: number) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

const livePercent = (current: number, duration: number, done: boolean) => {
  if (done) return 100
  if (!(duration > 0)) return 0
  return Math.max(0, Math.min(100, (current / duration) * 100))
}

export const parseNativeTick = (raw: unknown): NativeVideoTick | null => {
  if (raw == null) return null
  const row = asObject(raw)
  if (row.hasVideo === false) {
    return { hasVideo: false, current: 0, duration: 0, paused: true, ended: false, src: '' }
  }
  const current = Math.max(0, Number(row.current) || 0)
  const durationRaw = Number(row.duration)
  const duration = Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : 0
  const src = String(row.src || '')
  if (row.hasVideo !== true && !(current > 0) && !(duration > 0) && !src) return null
  return {
    hasVideo: true,
    current,
    duration,
    paused: row.paused !== false,
    ended: Boolean(row.ended),
    src,
    frameId: row.frameId ? String(row.frameId) : undefined,
    loaderId: row.loaderId ? String(row.loaderId) : undefined,
    nth: Number(row.nth) || undefined,
    value: row.value ? String(row.value) : undefined,
  }
}

/** 同址切小节/重播时，不能沿用上一段的 watching 或 done 回执。 */
export const nativeWatchMatchesTick = (watch: NativeWatchState | null, tick: NativeVideoTick | null) => Boolean(
  watch && tick?.hasVideo && watch.src && tick.src === watch.src
  && (!watch.locator?.frameId || watch.locator.frameId === tick.frameId)
  && (!watch.locator?.loaderId || watch.locator.loaderId === tick.loaderId)
  && (!watch.locator?.nth || watch.locator.nth === tick.nth)
  && !(watch.ended && !tick.ended)
  && tick.current >= watch.sampledCurrent - 1
)

const emit = (kind: NativeWatchKind, state: NativeWatchState) => {
  checkHandler?.({
    browserId: state.browserId,
    sessionId: state.sessionId,
    kind,
    percent: Math.round(state.percent),
    status: { ...state },
  })
}

const patchWatch = (browserId: string, patch: Partial<NativeWatchState>) => {
  const current = nativeWatches.value[browserId]
  if (!current) return null
  Object.assign(current, patch, { updatedAt: Date.now() })
  return current
}

const clearTimers = (browserId: string) => {
  generations.set(browserId, (generations.get(browserId) || 0) + 1)
  for (const timer of timers.get(browserId) || []) clearIntervalOf(timer)
  timers.delete(browserId)
  inFlight.delete(browserId)
}

export const stopNativeWatch = (browserId?: string, opts?: { keep?: boolean }) => {
  const id = String(browserId || '').trim()
  if (!id) return
  clearTimers(id)
  lastProgressAt.delete(id)
  lastSeenAt.delete(id)
  pausedAt.delete(id)
  stallNotified.delete(id)
  doneFired.delete(id)
  if (!opts?.keep && nativeWatches.value[id]) {
    const rest = { ...nativeWatches.value }
    delete rest[id]
    nativeWatches.value = rest
  }
}

export const resetNativeWatches = () => {
  for (const id of Object.keys(nativeWatches.value)) stopNativeWatch(id)
  nativeWatches.value = {}
}

const fireDone = (state: NativeWatchState) => {
  if (doneFired.has(state.browserId)) return
  doneFired.add(state.browserId)
  emit('done', state)
  stopNativeWatch(state.browserId, { keep: true })
}

/** 纯函数：把一次 tick 合进监测状态。测试走这里，不要打 CEF。 */
export const applyNativeTickState = (
  prev: NativeWatchState,
  tick: NativeVideoTick | null,
  now: number,
  clocks: { lastProgressAt: number; lastSeenAt: number; pausedAt: number },
): {
  state: NativeWatchState
  kind: NativeWatchKind | null
  clocks: { lastProgressAt: number; lastSeenAt: number; pausedAt: number }
} => {
  if (!tick || !tick.hasVideo) {
    if (now - clocks.lastSeenAt >= NATIVE_LOST_MS) {
      return {
        state: { ...prev, status: 'lost', updatedAt: now },
        kind: 'lost',
        clocks,
      }
    }
    return { state: prev, kind: null, clocks }
  }

  if (prev.src && tick.src && prev.src !== tick.src) {
    return { state: { ...prev, status: 'lost', ended: false, updatedAt: now }, kind: 'lost', clocks }
  }
  const duration = tick.duration > 0 ? tick.duration : prev.duration
  const current = Math.max(0, Number(tick.current) || 0)
  // 接近结尾、弹题暂停和本地插值都不是媒体 ended 事件。
  const done = Boolean(tick.ended)
  let nextProgress = current < prev.sampledCurrent - 1 ? now : clocks.lastProgressAt
  let nextPaused = clocks.pausedAt
  if (!tick.paused && (current >= prev.sampledCurrent + 0.35 || done)) {
    nextProgress = now
  }
  if (tick.paused && !done) {
    if (!nextPaused) nextPaused = now
  } else if (!tick.paused) {
    nextPaused = 0
  }
  const pausedLong = Boolean(tick.paused && !done && nextPaused && now - nextPaused >= NATIVE_STALL_MS)
  const stalled = !tick.paused && !done && now - nextProgress >= NATIVE_STALL_MS
  const status: NativeWatchStatus = done
    ? 'done'
    : pausedLong || stalled
      ? 'stalled'
      : tick.paused
        ? 'paused'
        : 'watching'
  const kind: NativeWatchKind | null = done
    ? 'done'
    : pausedLong || stalled
      ? 'stalled'
      : 'progress'
  return {
    state: {
      ...prev,
      src: tick.src || prev.src,
      current,
      duration,
      percent: livePercent(current, duration, done),
      paused: Boolean(tick.paused),
      ended: done || Boolean(tick.ended),
      status,
      sampledAt: now,
      sampledCurrent: current,
      updatedAt: now,
    },
    kind,
    clocks: {
      lastProgressAt: nextProgress,
      lastSeenAt: now,
      pausedAt: nextPaused,
    },
  }
}

const applyTick = (browserId: string, tick: NativeVideoTick | null) => {
  const watch = nativeWatches.value[browserId]
  if (!watch) return
  const now = Date.now()
  const applied = applyNativeTickState(watch, tick, now, {
    lastProgressAt: lastProgressAt.get(browserId) || watch.startedAt,
    lastSeenAt: lastSeenAt.get(browserId) || watch.startedAt,
    pausedAt: pausedAt.get(browserId) || 0,
  })
  lastProgressAt.set(browserId, applied.clocks.lastProgressAt)
  lastSeenAt.set(browserId, applied.clocks.lastSeenAt)
  if (applied.clocks.pausedAt) pausedAt.set(browserId, applied.clocks.pausedAt)
  else pausedAt.delete(browserId)
  const next = patchWatch(browserId, applied.state)
  if (!next) return
  if (applied.kind === 'done') {
    fireDone(next)
    return
  }
  if (applied.kind === 'lost') {
    if (!stallNotified.has(browserId)) {
      stallNotified.add(browserId)
      emit('lost', next)
    }
    stopNativeWatch(browserId, { keep: true })
    return
  }
  if (applied.kind === 'stalled' && !stallNotified.has(browserId)) {
    stallNotified.add(browserId)
    emit('stalled', next)
  }
}

export const interpolateNativeWatch = (watch: NativeWatchState, now: number): NativeWatchState => {
  if (watch.paused || watch.ended || watch.status !== 'watching') return watch
  if (!(watch.sampledAt > 0) || !(watch.duration > 1)) return watch
  if (now - watch.sampledAt > INTERPOLATE_MS) return watch
  const elapsed = (now - watch.sampledAt) / 1000
  if (elapsed < 0.05) return watch
  const current = Math.min(watch.duration, watch.sampledCurrent + elapsed)
  return {
    ...watch,
    current,
    percent: Math.min(99.9, livePercent(current, watch.duration, false)),
  }
}

const tickLive = (browserId: string) => {
  const watch = nativeWatches.value[browserId]
  if (watch) patchWatch(browserId, interpolateNativeWatch(watch, Date.now()))
}

export const readNativeVideoTick = async (browserId: string, locator?: BrowserLocator): Promise<NativeVideoTick | null> => {
  const id = String(browserId || '').trim()
  if (!id) return null
  const raw = await callProtocol(id, 'media_tick', { locator }).catch(() => null)
  return parseNativeTick(raw)
}

const syncTick = async (browserId: string) => {
  if (!nativeWatches.value[browserId] || inFlight.has(browserId)) return
  inFlight.add(browserId)
  const generation = generations.get(browserId)
  try {
    const tick = await readNativeVideoTick(browserId, nativeWatches.value[browserId]?.locator)
    if (generations.get(browserId) !== generation) return
    applyTick(browserId, tick)
  } catch {
    // 探测失败继续本地走表
  } finally {
    if (generations.get(browserId) === generation) inFlight.delete(browserId)
  }
}

export const startNativeWatch = (
  browserId: string,
  sessionId: string,
  seed?: Partial<NativeVideoTick> & { title?: string },
  opts?: { resume?: boolean; locator?: BrowserLocator },
) => {
  const id = String(browserId || '').trim()
  const sid = String(sessionId || '').trim()
  if (!id || !sid) return null
  const prev = nativeWatches.value[id]
  const resume = Boolean(opts?.resume && prev)
  clearTimers(id)
  if (!resume) {
    stallNotified.delete(id)
    doneFired.delete(id)
    pausedAt.delete(id)
  }
  const now = Date.now()
  lastProgressAt.set(id, now)
  lastSeenAt.set(id, now)
  const duration = Math.max(0, Number(seed?.duration) || 0)
  const current = Math.max(0, Number(seed?.current) || 0)
  const done = Boolean(seed?.ended)
  const state: NativeWatchState = {
    browserId: id,
    sessionId: sid,
    title: String(seed?.title || (resume ? prev?.title : '') || '').trim(),
    src: String(seed?.src || ''),
    current,
    duration,
    percent: livePercent(current, duration, done),
    paused: Boolean(seed?.paused),
    ended: done,
    status: done ? 'done' : seed?.paused ? 'paused' : 'watching',
    sampledAt: now,
    sampledCurrent: current,
    startedAt: now,
    updatedAt: now,
    locator: opts?.locator || (seed?.frameId ? {
      by: 'css', value: seed.value || 'video', nth: seed.nth || 1,
      frameId: seed.frameId, loaderId: seed.loaderId,
    } : resume ? prev?.locator : undefined),
  }
  nativeWatches.value = { ...nativeWatches.value, [id]: state }
  timers.set(id, [
    intervalOf(() => tickLive(id), LIVE_MS),
    intervalOf(() => { void syncTick(id) }, POLL_MS),
  ])
  void syncTick(id)
  return state
}
