import { ref } from 'vue'
import { isStudyUrl } from '../../browser/abstractions'
import {
  CHAPTER_PARSER_ENABLED,
  openChaoxingChapter,
  parseChaoxingChapters,
  readChaoxingChapterTick,
  type ChaoxingChapterSnap,
  type OpenChapterHint,
} from '../study'

export type ChapterItem = {
  title: string
  index?: string
  depth?: number
  parent?: string
  kind?: 'chapter' | 'section'
  jobs: number
  unfinished: boolean
  active?: boolean
  href?: string
  studyHref?: string
  chapterId?: string
}

export type ChapterParseState = {
  browserId: string
  url: string
  page: string
  kind: 'course' | 'player'
  current: string
  currentTitle: string
  unfinished: string[]
  unfinishedCount: number
  chapters: ChapterItem[]
  progress: { done: number; total: number } | null
  status: 'reading' | 'ready' | 'empty'
  updatedAt: number
}

export const browserChapterStates = ref<Record<string, ChapterParseState>>({})

const POLL_MS = 4000
const HOOK_MS = 20000
const timers = new Map<string, number[]>()
const inFlight = new Set<string>()

export const isChaoxingCourseUrl = (url: string) => isStudyUrl(url)

const chapterKind = (page: string, url: string): 'course' | 'player' => {
  if (page === 'player' || /studentstudy/i.test(url)) return 'player'
  return 'course'
}

const catalogIndex = (value: unknown) => {
  const hit = String(value || '').trim().match(/^(\d+(?:\.\d+)+)\b/)
  return hit?.[1] || ''
}

const titlesMatch = (a: unknown, b: unknown) => {
  const ia = catalogIndex(a)
  const ib = catalogIndex(b)
  if (ia && ib && ia !== ib) return false
  const left = String(a || '').replace(/^\d+(?:\.\d+)+\s*/, '').trim() || ia
  const right = String(b || '').replace(/^\d+(?:\.\d+)+\s*/, '').trim() || ib
  if (!left || !right) return ia && ib && ia === ib
  if (ia && ib) return left === right
  return left === right || left.includes(right) || right.includes(left)
}

const titleHit = (left: string, right: string) => titlesMatch(left, right)

const chapterDepthOf = (item: { kind?: string; depth?: number; index?: string; title?: string }) => {
  if (item.kind === 'chapter') return 0
  if (Number(item.depth) > 0) return Number(item.depth)
  const index = String(item.index || '').trim() || catalogIndex(item.title)
  return index ? index.split('.').length : 1
}

const asChapters = (snap: ChaoxingChapterSnap): ChapterItem[] => {
  const current = String(snap.current || '').trim()
  const fromItems = (snap.chapters || [])
    .map((item) => {
      const title = String(item.title || '').trim()
      const index = String(item.index || '').trim() || catalogIndex(title)
      const kind = item.kind === 'chapter' ? 'chapter' as const : 'section' as const
      return {
        title,
        index,
        depth: chapterDepthOf({ ...item, index, title, kind }),
        parent: String(item.parent || ''),
        kind,
        jobs: Number(item.jobs) || 0,
        unfinished: Boolean(item.unfinished),
        active: Boolean(item.active || titleHit(title, current)),
        href: String(item.href || ''),
        studyHref: String(item.studyHref || ''),
        chapterId: String(item.chapterId || ''),
      }
    })
    .filter((item) => item.title)
  if (fromItems.length) return fromItems
  return (snap.unfinished || []).filter(Boolean).map((title) => ({
    title,
    jobs: 1,
    unfinished: true,
    active: Boolean(snap.current && title.includes(String(snap.current))),
  }))
}

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
  const chapters = asChapters(snap)
  const empty = !chapters.length && !unfinished.length && !(progress && progress.total)
  const prev = chapterStateFor(browserId)
  if (
    empty
    && prev
    && (prev.chapters.length || prev.unfinished.length || prev.progress)
    && (snap.page === 'student' || snap.page === 'other')
    && Date.now() - prev.updatedAt < 90_000
  ) {
    return prev
  }
  if (prev?.chapters.length && chapters.length && chapters.length < prev.chapters.length) {
    const titles = new Set(unfinished)
    return applyMerged(browserId, snap, prev, titles, progress, left)
  }
  const next: ChapterParseState = {
    browserId,
    url: String(snap.url || prev?.url || ''),
    page: String(snap.page || prev?.page || 'other'),
    kind: chapterKind(String(snap.page || ''), String(snap.url || prev?.url || '')),
    current: String(snap.current || ''),
    currentTitle: String(snap.current || ''),
    unfinished,
    unfinishedCount: left,
    chapters,
    progress,
    status: chapters.length || unfinished.length || progress ? 'ready' : 'empty',
    updatedAt: Date.now(),
  }
  browserChapterStates.value = { ...browserChapterStates.value, [browserId]: next }
  return next
}

const applyMerged = (
  browserId: string,
  snap: ChaoxingChapterSnap,
  prev: ChapterParseState,
  unfinishedTitles: Set<string>,
  progress: ChapterParseState['progress'],
  left: number,
) => {
  const current = String(snap.current || prev.currentTitle || '')
  const next: ChapterParseState = {
    ...prev,
    url: String(snap.url || prev.url),
    page: String(snap.page || prev.page),
    kind: chapterKind(String(snap.page || prev.page), String(snap.url || prev.url)),
    current,
    currentTitle: current,
    unfinished: (snap.unfinished || prev.unfinished).filter(Boolean),
    unfinishedCount: left,
    chapters: prev.chapters.map((item) => ({
      ...item,
      unfinished: unfinishedTitles.has(item.title)
        || [...unfinishedTitles].some((title) => titlesMatch(item.title, title) || titlesMatch(item.index, title)),
      active: Boolean(current && (titlesMatch(item.title, current) || item.title === current)),
    })),
    progress: progress || prev.progress,
    status: 'ready',
    updatedAt: Date.now(),
  }
  browserChapterStates.value = { ...browserChapterStates.value, [browserId]: next }
  return next
}

const snapHasData = (snap: ChaoxingChapterSnap | null | undefined) => Boolean(
  snap && ((snap.chapters || []).length || (snap.unfinished || []).length || snap.progress)
)

const poll = async (browserId: string, deep = false) => {
  if (!CHAPTER_PARSER_ENABLED) return
  if (inFlight.has(browserId)) return
  const prev = chapterStateFor(browserId)
  inFlight.add(browserId)
  try {
    const tick = await readChaoxingChapterTick(browserId).catch(() => null)
    if (snapHasData(tick)) {
      applySnap(browserId, tick)
      return
    }
    if (!deep && prev?.chapters.length) return
    const snap = await parseChaoxingChapters(browserId)
    if (snap) applySnap(browserId, snap)
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

const blankState = (id: string): ChapterParseState => ({
  browserId: id,
  url: '',
  page: 'other',
  kind: 'course',
  current: '',
  currentTitle: '',
  unfinished: [],
  unfinishedCount: 0,
  chapters: [],
  progress: null,
  status: 'reading',
  updatedAt: Date.now(),
})

export const startChaoxingChapterParser = (browserId: string) => {
  const id = String(browserId || '').trim()
  if (!id || !CHAPTER_PARSER_ENABLED) return chapterStateFor(id)
  if (!timers.has(id)) {
    if (!chapterStateFor(id)?.chapters.length) {
      browserChapterStates.value = {
        ...browserChapterStates.value,
        [id]: blankState(id),
      }
    }
    timers.set(id, [
      window.setInterval(() => { void poll(id, false) }, POLL_MS),
      window.setInterval(() => { void poll(id, true) }, HOOK_MS),
    ])
    void poll(id, true)
    return chapterStateFor(id)
  }
  if (!chapterStateFor(id)?.chapters.length) void poll(id, true)
  return chapterStateFor(id)
}

export const openChapterFromCard = async (
  browserId: string,
  target: Pick<ChapterItem, 'title' | 'index' | 'chapterId' | 'href' | 'studyHref'>,
) => {
  const id = String(browserId || '').trim()
  const title = String(target.title || '').trim()
  if (!id || (!title && !target.chapterId && !target.index)) return { ok: false, error: '缺少节名' }
  const prev = chapterStateFor(id)
  if (prev) {
    const next: ChapterParseState = {
      ...prev,
      current: title || prev.current,
      currentTitle: title || prev.currentTitle,
      chapters: prev.chapters.map((item) => ({
        ...item,
        active: Boolean(
          (target.chapterId && item.chapterId && item.chapterId === target.chapterId)
          || (target.index && item.index && item.index === target.index)
          || titlesMatch(item.title, title),
        ),
      })),
      updatedAt: Date.now(),
    }
    browserChapterStates.value = { ...browserChapterStates.value, [id]: next }
  }
  const hint: OpenChapterHint = {
    chapterId: target.chapterId,
    href: target.href,
    studyHref: target.studyHref,
    index: target.index,
  }
  const opened = await openChaoxingChapter(id, title || String(target.index || ''), hint)
  if (!CHAPTER_PARSER_ENABLED) return opened
  const tick = await readChaoxingChapterTick(id).catch(() => null)
  if (tick) applySnap(id, tick)
  else await refreshChapterCard(id).catch(() => null)
  return opened
}

export const refreshChapterCard = async (browserId: string) => {
  const id = String(browserId || '').trim()
  if (!id || !CHAPTER_PARSER_ENABLED) return chapterStateFor(id)
  startChaoxingChapterParser(id)
  const cached = await readChaoxingChapterTick(id).catch(() => null)
  const snap = snapHasData(cached) ? cached : await parseChaoxingChapters(id).catch(() => null)
  if (snap) applySnap(id, snap)
  return chapterStateFor(id)
}

export const waitForChapterState = async (browserId: string, maxMs = 2500) => {
  if (!CHAPTER_PARSER_ENABLED) return chapterStateFor(browserId)
  const ready = await refreshChapterCard(browserId)
  if (ready?.status === 'ready') return ready
  const started = Date.now()
  while (Date.now() - started < maxMs) {
    const state = chapterStateFor(browserId)
    if (state && state.status === 'ready') return state
    await new Promise((resolve) => window.setTimeout(resolve, 120))
  }
  return chapterStateFor(browserId)
}
