import { ref } from 'vue'
import {
  installChaoxingChapterHook,
  readChaoxingChapterTick,
  type ChaoxingChapterSnap,
} from './study'

export type ChapterParseState = {
  browserId: string
  url: string
  page: string
  current: string
  currentTitle: string
  unfinished: string[]
  unfinishedCount: number
  progress: { done: number; total: number } | null
  status: 'reading' | 'ready' | 'empty'
  updatedAt: number
}

export const browserChapterStates = ref<Record<string, ChapterParseState>>({})

const POLL_MS = 2000
const HOOK_MS = 8000
const timers = new Map<string, number[]>()
const inFlight = new Set<string>()

export const isChaoxingCourseUrl = (url: string) => (
  /chaoxing\.com/i.test(url) && /mycourse|studentstudy|studentcourse/.test(url)
)

export const chapterStateFor = (browserId?: string) => {
  const id = String(browserId || '').trim()
  return id ? browserChapterStates.value[id] || null : null
}

const applySnap = (browserId: string, snap: ChaoxingChapterSnap | null) => {
  if (!snap) return chapterStateFor(browserId)
  const unfinished = (snap.unfinished || []).filter(Boolean)
  const progress = snap.progress || null
  const left = Number(snap.unfinishedCount) || (
    progress && progress.total > progress.done ? progress.total - progress.done : unfinished.length
  )
  const empty = !unfinished.length && !(progress && progress.total > progress.done)
  const prev = chapterStateFor(browserId)
  if (
    empty
    && prev
    && (prev.unfinished.length || (prev.progress && prev.progress.total > prev.progress.done))
    && (snap.page === 'student' || snap.page === 'other')
    && Date.now() - prev.updatedAt < 90_000
  ) {
    return prev
  }
  const next: ChapterParseState = {
    browserId,
    url: String(snap.url || ''),
    page: String(snap.page || 'other'),
    current: String(snap.current || ''),
    currentTitle: String(snap.current || ''),
    unfinished,
    unfinishedCount: left,
    progress,
    status: unfinished.length || (progress && progress.total > progress.done) ? 'ready' : 'empty',
    updatedAt: Date.now(),
  }
  browserChapterStates.value = { ...browserChapterStates.value, [browserId]: next }
  return next
}

const poll = async (browserId: string, hook = false) => {
  if (inFlight.has(browserId)) return
  inFlight.add(browserId)
  try {
    const snap = hook
      ? await installChaoxingChapterHook(browserId)
      : (await readChaoxingChapterTick(browserId)) || await installChaoxingChapterHook(browserId)
    applySnap(browserId, snap)
  } catch {
    // keep last
  } finally {
    inFlight.delete(browserId)
  }
}

export const stopChaoxingChapterParser = (browserId?: string) => {
  const id = String(browserId || '').trim()
  if (!id) return
  for (const timer of timers.get(id) || []) window.clearInterval(timer)
  timers.delete(id)
  inFlight.delete(id)
}

export const startChaoxingChapterParser = (browserId: string) => {
  const id = String(browserId || '').trim()
  if (!id) return
  if (timers.has(id)) {
    void poll(id, true)
    return chapterStateFor(id)
  }
  browserChapterStates.value = {
    ...browserChapterStates.value,
    [id]: {
      browserId: id,
      url: '',
      page: 'other',
      current: '',
      currentTitle: '',
      unfinished: [],
      unfinishedCount: 0,
      progress: null,
      status: 'reading',
      updatedAt: Date.now(),
    },
  }
  timers.set(id, [
    window.setInterval(() => { void poll(id, false) }, POLL_MS),
    window.setInterval(() => { void poll(id, true) }, HOOK_MS),
  ])
  void poll(id, true)
  window.setTimeout(() => { void poll(id, false) }, 1500)
  return chapterStateFor(id)
}

export const waitForChapterState = async (browserId: string, maxMs = 4000) => {
  startChaoxingChapterParser(browserId)
  const started = Date.now()
  while (Date.now() - started < maxMs) {
    const state = chapterStateFor(browserId)
    if (state && state.status !== 'reading' && (state.unfinished.length || state.progress)) return state
    await new Promise((resolve) => window.setTimeout(resolve, 400))
  }
  return chapterStateFor(browserId)
}
