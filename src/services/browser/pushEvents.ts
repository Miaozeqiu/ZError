/** CEF 页内 `__zeTick` → Rust `app-browser-tick` → 前端按 browser id 分发。 */
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { asObject } from './eval'

export type VideoTickPayload = {
  current: number
  duration: number
  paused: boolean
  ended: boolean
  ready: number
  src: string
  mid: string
  visible: boolean
  hasVideo: boolean
}

export type HwFillState = { index: number; selected: string; filled: boolean }

export type NormalizedTick =
  | { kind: 'video'; tick: VideoTickPayload }
  | { kind: 'hw'; changed: true; states: HwFillState[] }

export type BrowserTickEvent = {
  id: string
  kind?: string
  tick?: unknown
}

export type LastTick = {
  ok: boolean
  ageMs: number
  kind?: string
  tick: VideoTickPayload | null
  states?: HwFillState[]
}

type VideoHandler = (tick: VideoTickPayload) => void
type HomeworkHandler = (id: string, states: HwFillState[]) => void
type FrameHandler = (url: string) => void

const finiteDur = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 1 ? n : 0
}

export const normalizeTick = (raw: unknown): NormalizedTick | null => {
  if (!raw || typeof raw !== 'object') return null
  const rec = raw as Record<string, unknown>
  const nested = rec.tick && typeof rec.tick === 'object' ? rec.tick as Record<string, unknown> : rec
  const kind = String(rec.kind || nested.kind || (nested.changed ? 'hw' : 'video'))
  if (kind === 'hw') {
    const rawStates = Array.isArray(nested.states) ? nested.states : Array.isArray(rec.states) ? rec.states : []
    const states = rawStates.map((item, i) => {
      const row = asObject(item)
      return {
        index: Number(row.index) || i + 1,
        selected: String(row.selected || ''),
        filled: Boolean(row.filled),
      }
    })
    return { kind: 'hw', changed: true, states }
  }
  const duration = finiteDur(nested.duration) || finiteDur(nested.windowDuration) || finiteDur(nested.videojsDuration)
  const current = Number(nested.current) || 0
  const src = String(nested.src || '')
  const ended = Boolean(nested.ended)
  const tick: VideoTickPayload = {
    current,
    duration,
    paused: nested.paused !== false,
    ended,
    ready: Number(nested.ready) || 0,
    src,
    mid: String(nested.mid || ''),
    visible: nested.visible !== false,
    hasVideo: nested.hasVideo === true || ended || duration > 1 || current > 0.2 || Boolean(src),
  }
  return { kind: 'video', tick }
}

/** 叠着的多视频页：钉住了 mid 就只收那条；没钉住时任何一条都收，由调用方自己钉。 */
export const tickMatchesMid = (tick: { mid?: string } | null | undefined, wantMid?: string) => {
  const want = String(wantMid || '').trim()
  if (!want) return true
  const got = String(tick?.mid || '').trim()
  return !got || got === want
}

export const createDebounce = (ms: number) => {
  let timer: ReturnType<typeof setTimeout> | 0 = 0
  return (fn: () => void) => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = 0
      fn()
    }, ms)
  }
}

export const createTickHub = () => {
  const video = new Map<string, Set<VideoHandler>>()
  const homework = new Map<string, Set<HomeworkHandler>>()
  const frames = new Map<string, Set<FrameHandler>>()
  const onBrowserTick = (id: string, handler: VideoHandler) => {
    const key = String(id || '').trim()
    if (!key) return () => {}
    const set = video.get(key) || new Set<VideoHandler>()
    set.add(handler)
    video.set(key, set)
    return () => {
      set.delete(handler)
      if (!set.size) video.delete(key)
    }
  }
  const onHomeworkChanged = (id: string, handler: HomeworkHandler) => {
    const key = String(id || '').trim()
    if (!key) return () => {}
    const set = homework.get(key) || new Set<HomeworkHandler>()
    set.add(handler)
    homework.set(key, set)
    return () => {
      set.delete(handler)
      if (!set.size) homework.delete(key)
    }
  }
  const dispatch = (payload: BrowserTickEvent) => {
    const id = String(payload?.id || '').trim()
    if (!id) return
    const normalized = normalizeTick(payload.tick ?? payload)
    if (!normalized) return
    if (normalized.kind === 'hw') {
      homework.get(id)?.forEach((fn) => fn(id, normalized.states))
      return
    }
    video.get(id)?.forEach((fn) => fn(normalized.tick))
  }
  const onBrowserFrame = (id: string, handler: FrameHandler) => {
    const key = String(id || '').trim()
    if (!key) return () => {}
    const set = frames.get(key) || new Set<FrameHandler>()
    set.add(handler)
    frames.set(key, set)
    return () => {
      set.delete(handler)
      if (!set.size) frames.delete(key)
    }
  }
  const dispatchFrame = (payload: { id?: string; url?: string }) => {
    const id = String(payload?.id || '').trim()
    if (!id) return
    frames.get(id)?.forEach((fn) => fn(String(payload.url || '')))
  }
  return { onBrowserTick, onHomeworkChanged, onBrowserFrame, dispatch, dispatchFrame }
}

const hub = createTickHub()
let listening: Promise<UnlistenFn | void> | null = null

const ensureListen = () => {
  if (listening) return listening
  listening = Promise.all([
    listen<BrowserTickEvent>('app-browser-tick', (event) => {
      hub.dispatch(event.payload)
    }),
    listen<{ id?: string; url?: string }>('app-browser-frame', (event) => {
      hub.dispatchFrame(event.payload)
    }),
  ]).then(() => undefined).catch(() => {
    listening = null
  })
  return listening
}

export const onBrowserTick = (id: string, handler: VideoHandler) => {
  void ensureListen()
  return hub.onBrowserTick(id, handler)
}

export const onHomeworkChanged = (id: string, handler: HomeworkHandler) => {
  void ensureListen()
  return hub.onHomeworkChanged(id, handler)
}

export const onBrowserFrame = (id: string, handler: FrameHandler) => {
  void ensureListen()
  return hub.onBrowserFrame(id, handler)
}

/** 测试用：模拟 Rust 推过来的事件。 */
export const dispatchTickEvent = hub.dispatch

export const readLastTick = async (id: string, mid?: string, kind?: 'video' | 'hw'): Promise<LastTick> => {
  const key = String(id || '').trim()
  if (!key) return { ok: false, ageMs: Number.POSITIVE_INFINITY, tick: null }
  try {
    const want = String(mid || '').trim()
    const { callProtocol } = await import('./protocol')
    const raw = asObject(await callProtocol(key, 'push_last', {
      ...(want ? { mid: want } : {}),
      ...(kind ? { kind } : {}),
    }))
    if (!raw.ok) return { ok: false, ageMs: Number.POSITIVE_INFINITY, tick: null }
    const normalized = normalizeTick(raw.tick ?? raw)
    return {
      ok: true,
      ageMs: Number(raw.ageMs) || 0,
      kind: raw.kind ? String(raw.kind) : normalized?.kind,
      tick: normalized?.kind === 'video' ? normalized.tick : null,
      states: normalized?.kind === 'hw' ? normalized.states : undefined,
    }
  } catch {
    return { ok: false, ageMs: Number.POSITIVE_INFINITY, tick: null }
  }
}
