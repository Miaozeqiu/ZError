import { invoke } from '@tauri-apps/api/core'
import { asObject, isCefEngine } from './eval'

export type NativeVideoState = {
  found: boolean
  active: boolean
  url: string
  current: number
  duration: number
  playing: boolean
  ended: boolean
}

const asState = (value: unknown): NativeVideoState => {
  const raw = asObject(value)
  return {
    found: Boolean(raw.found),
    active: Boolean(raw.active),
    url: String(raw.url || ''),
    current: Number(raw.current) || 0,
    duration: Number(raw.duration) || 0,
    playing: Boolean(raw.playing),
    ended: Boolean(raw.ended),
  }
}

const empty = (): NativeVideoState => ({
  found: false,
  active: false,
  url: '',
  current: 0,
  duration: 0,
  playing: false,
  ended: false,
})

export const tickNativeVideo = async (id: string) => {
  if (!(await isCefEngine())) return empty()
  return asState(await invoke('browser_video_overlay_tick', { id }).catch(() => null))
}

export const readNativeVideo = async (id: string) => {
  if (!(await isCefEngine())) return empty()
  return asState(await invoke('browser_video_overlay_state', { id }).catch(() => null))
}

export const playNativeVideo = async (id: string) => {
  if (!(await isCefEngine())) return empty()
  return asState(await invoke('browser_video_overlay_play', { id }).catch(() => null))
}

export const hideNativeVideo = async (id: string) => {
  await invoke('browser_video_overlay_hide', { id }).catch(() => undefined)
}

const loops = new Map<string, number>()

export const startNativeVideoLoop = (id: string) => {
  if (!id || loops.has(id)) return
  const tick = () => {
    void tickNativeVideo(id).catch(() => null)
  }
  tick()
  loops.set(id, window.setInterval(tick, 900))
}

export const stopNativeVideoLoop = (id?: string) => {
  if (id) {
    const timer = loops.get(id)
    if (timer) window.clearInterval(timer)
    loops.delete(id)
    void hideNativeVideo(id)
    return
  }
  for (const [key, timer] of loops) {
    window.clearInterval(timer)
    void hideNativeVideo(key)
  }
  loops.clear()
}
