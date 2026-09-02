import { ref } from 'vue'
import { withIdleEval } from '../../browser/eval'
import { isStudyUrl } from '../../browser/abstractions'
import {
  CHAPTER_PARSER_ENABLED,
  openChaoxingChapter,
  parseChaoxingChapters,
  readChaoxingChapterJobTick,
  readChaoxingChapterTick,
  playChaoxingVideo,
  clickChaoxingStep,
  installChaoxingVideoHook,
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

export type ChapterVideoProgress = {
  current: number
  duration: number
  percent: number
  paused: boolean
  ended: boolean
  title: string
  updatedAt: number
}

export type ChapterJobItem = {
  mid: string
  jobid: string
  label: string
  kind: 'video' | 'quiz' | 'doc' | 'other'
  jobDone: boolean
  unfinished: boolean
  active: boolean
  /** 仅当前播放中的视频任务带进度 */
  current?: number
  duration?: number
  percent?: number
  paused?: boolean
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
  video: ChapterVideoProgress | null
  jobs: ChapterJobItem[]
  status: 'reading' | 'ready' | 'empty'
  updatedAt: number
}

export const browserChapterStates = ref<Record<string, ChapterParseState>>({})

const CATALOG_MS = 10_000
const DEEP_MS = 20_000
const VIDEO_SYNC_MS = 8_000
const LIVE_MS = 250
const VIDEO_STALE_MS = 12_000
const timers = new Map<string, number[]>()
const inFlight = new Set<string>()
const videoInFlight = new Set<string>()

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

const keepCatalogTitle = (title: string) => {
  const text = String(title || '').trim()
  if (!text) return false
  if (/^[一二三四五六七八九十]+[、.]/.test(text)) return false
  if (/单选题|多选题|判断题|填空题|共\s*\d+\s*题/.test(text)) return false
  return true
}

const isStubCatalog = (chapters: ChapterItem[]) => (
  chapters.length > 0
  && chapters.every((item) => !item.chapterId && (item.jobs === 1 || !item.jobs))
)

const pickCourseProgress = (
  next: ChapterParseState['progress'],
  prev: ChapterParseState['progress'],
): ChapterParseState['progress'] => {
  if (!next) return prev
  if (!prev) return next
  // 播放页常把「本节 0/1」当成整课进度；课级「已完成任务点 2/120」优先
  if (prev.total >= 8 && next.total > 0 && next.total < 8 && next.total < prev.total) return prev
  return next
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
    .filter((item) => keepCatalogTitle(item.title))
  if (fromItems.length) return fromItems
  return (snap.unfinished || []).filter((title) => keepCatalogTitle(title)).map((title) => ({
    title,
    jobs: 1,
    unfinished: true,
    active: Boolean(current && titlesMatch(title, current)),
  }))
}

export const chapterStateFor = (browserId?: string) => {
  const id = String(browserId || '').trim()
  return id ? browserChapterStates.value[id] || null : null
}

const applySnap = (browserId: string, snap: ChaoxingChapterSnap | null) => {
  if (!snap) return chapterStateFor(browserId)
  const unfinished = (snap.unfinished || []).filter((title) => keepCatalogTitle(title))
  const progress = snap.progress || null
  const left = Number(snap.unfinishedCount) || (
    progress && progress.total > progress.done ? progress.total - progress.done : unfinished.length
  )
  const chapters = asChapters(snap)
  const empty = !chapters.length && !unfinished.length && !(progress && progress.total)
  const prev = chapterStateFor(browserId)
  const mergedProgress = pickCourseProgress(progress, prev?.progress || null)
  if (
    empty
    && prev
    && (prev.chapters.length || prev.unfinished.length || prev.progress)
    && (snap.page === 'student' || snap.page === 'other')
    && Date.now() - prev.updatedAt < 90_000
  ) {
    return prev
  }
  const keepPrevTree = Boolean(
    prev?.chapters.length
    && (
      (chapters.length && chapters.length < prev.chapters.length)
      || (prev.chapters.length >= 8 && chapters.length > 0 && isStubCatalog(chapters) && !isStubCatalog(prev.chapters))
    ),
  )
  if (keepPrevTree && prev) {
    const titles = new Set(unfinished)
    return applyMerged(browserId, snap, prev, titles, mergedProgress, left)
  }
  const current = String(snap.current || prev?.currentTitle || '')
  const next: ChapterParseState = {
    browserId,
    url: String(snap.url || prev?.url || ''),
    page: String(snap.page || prev?.page || 'other'),
    kind: chapterKind(String(snap.page || ''), String(snap.url || prev?.url || '')),
    current,
    currentTitle: current,
    unfinished,
    unfinishedCount: left,
    chapters: chapters.map((item) => ({
      ...item,
      active: Boolean(item.active || (current && titlesMatch(item.title, current))),
    })),
    progress: mergedProgress,
    video: prev?.video || null,
    jobs: prev?.jobs || [],
    status: chapters.length || unfinished.length || mergedProgress ? 'ready' : 'empty',
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
  currentTitle?: string,
) => {
  const current = String(currentTitle || snap.current || prev.currentTitle || '')
  const next: ChapterParseState = {
    ...prev,
    url: String(snap.url || prev.url),
    page: String(snap.page || prev.page),
    kind: chapterKind(String(snap.page || prev.page), String(snap.url || prev.url)),
    current,
    currentTitle: current,
    unfinished: (snap.unfinished?.length ? snap.unfinished : prev.unfinished).filter(Boolean),
    unfinishedCount: left || prev.unfinishedCount,
    chapters: prev.chapters.map((item) => ({
      ...item,
      unfinished: unfinishedTitles.size
        ? (unfinishedTitles.has(item.title)
          || [...unfinishedTitles].some((title) => titlesMatch(item.title, title) || titlesMatch(item.index, title)))
        : item.unfinished,
      active: Boolean(current && (titlesMatch(item.title, current) || item.title === current)),
    })),
    progress: pickCourseProgress(progress, prev.progress),
    video: prev.video,
    jobs: prev.jobs || [],
    status: 'ready',
    updatedAt: Date.now(),
  }
  browserChapterStates.value = { ...browserChapterStates.value, [browserId]: next }
  return next
}

const snapHasData = (snap: ChaoxingChapterSnap | null | undefined) => Boolean(
  snap && ((snap.chapters || []).length || (snap.unfinished || []).length || snap.progress)
)

const videoPercent = (current: number, duration: number, ended: boolean) => {
  if (ended) return 100
  if (!(duration > 0)) return 0
  return Math.max(0, Math.min(100, (current / duration) * 100))
}

const asJobKind = (raw: unknown): ChapterJobItem['kind'] => {
  const text = String(raw || '')
  if (text === 'video' || text === 'quiz' || text === 'doc') return text
  return 'other'
}

const applyVideo = async (browserId: string, opts?: { force?: boolean }) => {
  if (videoInFlight.has(browserId)) return
  if (!chapterStateFor(browserId)) return
  videoInFlight.add(browserId)
  const run = async () => {
    const snap = await readChaoxingChapterJobTick(browserId).catch(() => null)
    const prev = chapterStateFor(browserId)
    if (!prev) return
    const tick = snap?.video || null
    const duration = Number(tick?.duration) || 0
    const current = Number(tick?.current) || 0
    const hasVideo = Boolean(tick && duration > 1)
    const ended = Boolean(tick?.ended)
    const paused = Boolean(tick?.paused)
    const percent = videoPercent(current, duration, ended)
    const title = prev.currentTitle || prev.current || prev.video?.title || ''

    const rawJobs = Array.isArray(snap?.jobs) ? snap.jobs : []
    let jobs: ChapterJobItem[] = rawJobs.map((item) => {
      const kind = asJobKind(item.kind || (item.video ? 'video' : item.quiz ? 'quiz' : item.doc ? 'doc' : 'other'))
      const jobDone = item.jobDone === true || item.passed === true
      return {
        mid: String(item.mid || ''),
        jobid: String(item.jobid || ''),
        label: String(item.label || kind),
        kind,
        jobDone,
        unfinished: item.unfinished === true || (!jobDone && item.unfinished !== false),
        active: Boolean(item.active),
      }
    })

    if (hasVideo) {
      const hasMarked = jobs.some((item) => item.active)
      const activeVideo = jobs.find((item) => item.active && item.kind === 'video')
        || (!hasMarked
          ? (
            jobs.find((item) => item.kind === 'video' && item.unfinished)
            || jobs.find((item) => item.kind === 'video')
          )
          : null)
      if (activeVideo) {
        jobs = jobs.map((item) => (
          item === activeVideo
            ? {
                ...item,
                active: true,
                current,
                duration,
                percent,
                paused,
                jobDone: ended || item.jobDone,
                unfinished: ended ? false : item.unfinished,
              }
            : { ...item, active: item.kind === 'video' ? false : item.active }
        ))
      } else if (!jobs.length) {
        jobs = [{
          mid: '',
          jobid: '',
          label: '视频',
          kind: 'video',
          jobDone: ended,
          unfinished: !ended,
          active: true,
          current,
          duration,
          percent,
          paused,
        }]
      }
    }

    const video: ChapterVideoProgress | null = hasVideo
      ? {
          current,
          duration,
          percent,
          paused,
          ended,
          title,
          updatedAt: Date.now(),
        }
      : (prev.video && Date.now() - prev.video.updatedAt > VIDEO_STALE_MS ? null : prev.video)

    const nextJobs = jobs.length ? jobs : (hasVideo ? prev.jobs : (
      prev.jobs.length && Date.now() - (prev.video?.updatedAt || prev.updatedAt) > VIDEO_STALE_MS
        ? []
        : prev.jobs
    ))

    browserChapterStates.value = {
      ...browserChapterStates.value,
      [browserId]: {
        ...prev,
        video,
        jobs: nextJobs,
        updatedAt: Date.now(),
      },
    }
  }
  try {
    if (opts?.force) return await run()
    return await withIdleEval(run)
  } finally {
    videoInFlight.delete(browserId)
  }
}

/** 进度条在页面钩子里自己走；宿主只做本地插值，不每秒 eval。 */
const tickChapterLive = (browserId: string) => {
  const prev = chapterStateFor(browserId)
  const video = prev?.video
  if (!prev || !video || video.paused || video.ended || !(video.duration > 1)) return
  if (Date.now() - video.updatedAt > 1500) return
  const elapsed = (Date.now() - video.updatedAt) / 1000
  if (elapsed < 0.08) return
  const current = Math.min(video.duration, video.current + elapsed)
  const ended = current >= video.duration - 0.2
  const percent = videoPercent(current, video.duration, ended)
  browserChapterStates.value = {
    ...browserChapterStates.value,
    [browserId]: {
      ...prev,
      video: { ...video, current, percent, ended, updatedAt: Date.now() },
      jobs: prev.jobs.map((item) => (
        item.active && item.kind === 'video'
          ? { ...item, current, duration: video.duration, percent, paused: false, jobDone: ended || item.jobDone }
          : item
      )),
      updatedAt: Date.now(),
    },
  }
}

const poll = async (browserId: string, deep = false) => {
  if (!CHAPTER_PARSER_ENABLED) return
  if (inFlight.has(browserId)) return
  const prev = chapterStateFor(browserId)
  inFlight.add(browserId)
  try {
    await withIdleEval(async () => {
      const tick = await readChaoxingChapterTick(browserId).catch(() => null)
      if (snapHasData(tick)) {
        applySnap(browserId, tick)
      } else if (deep || !prev?.chapters.length) {
        const snap = await parseChaoxingChapters(browserId)
        if (snap) applySnap(browserId, snap)
      }
    })
    if (chapterStateFor(browserId)?.kind === 'player') await applyVideo(browserId)
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
  videoInFlight.delete(id)
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
  video: null,
  jobs: [],
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
      window.setInterval(() => { void poll(id, false) }, CATALOG_MS),
      window.setInterval(() => { void poll(id, true) }, DEEP_MS),
      window.setInterval(() => tickChapterLive(id), LIVE_MS),
      window.setInterval(() => {
        if (chapterStateFor(id)?.kind === 'player') void applyVideo(id)
      }, VIDEO_SYNC_MS),
    ])
    void installChaoxingVideoHook(id).catch(() => null)
    void poll(id, true)
    return chapterStateFor(id)
  }
  if (!chapterStateFor(id)?.chapters.length) void poll(id, true)
  else if (chapterStateFor(id)?.kind === 'player') void applyVideo(id)
  return chapterStateFor(id)
}

/** 网址变了立刻重读，不要等 10 秒轮询。 */
export const syncChaoxingChapterUrl = (browserId: string, url: string) => {
  const id = String(browserId || '').trim()
  if (!id) return
  startChaoxingChapterParser(id)
  const prev = chapterStateFor(id)
  const kind = chapterKind('', url)
  if (prev && (prev.url !== url || prev.kind !== kind)) {
    browserChapterStates.value = {
      ...browserChapterStates.value,
      [id]: { ...prev, url, kind, updatedAt: Date.now() },
    }
  }
  void (async () => {
    if (inFlight.has(id)) {
      if (kind === 'player') void applyVideo(id, { force: true })
      return
    }
    inFlight.add(id)
    try {
      const snap = await parseChaoxingChapters(id).catch(() => null)
      if (snap) applySnap(id, snap)
      if (chapterStateFor(id)?.kind === 'player') await applyVideo(id, { force: true })
    } finally {
      inFlight.delete(id)
    }
  })()
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
  const after = chapterStateFor(id)
  if (after && title && !after.chapters.some((item) => item.active)) {
    browserChapterStates.value = {
      ...browserChapterStates.value,
      [id]: {
        ...after,
        current: title,
        currentTitle: title,
        chapters: after.chapters.map((item) => ({
          ...item,
          active: Boolean(
            (target.chapterId && item.chapterId && item.chapterId === target.chapterId)
            || (target.index && item.index && item.index === target.index)
            || titlesMatch(item.title, title),
          ),
        })),
      },
    }
  }
  await applyVideo(id, { force: true }).catch(() => null)
  return opened
}

/** 面板点小节：打开该节并尝试播放第一个视频 */
export const playChapterFromCard = async (
  browserId: string,
  target: Pick<ChapterItem, 'title' | 'index' | 'chapterId' | 'href' | 'studyHref'>,
) => {
  const id = String(browserId || '').trim()
  const opened = await openChapterFromCard(id, target)
  await new Promise((resolve) => window.setTimeout(resolve, 700))
  const played = await playChaoxingVideo(id).catch(() => null)
  await applyVideo(id, { force: true }).catch(() => null)
  return { opened, played }
}

/** 面板点本节任务点：必要时先切章，再按序号/mid 切标签；视频则播放 */
export const playChapterJobFromCard = async (
  browserId: string,
  chapter: Pick<ChapterItem, 'title' | 'index' | 'chapterId' | 'href' | 'studyHref' | 'active'>,
  job: Pick<ChapterJobItem, 'label' | 'kind' | 'active' | 'mid' | 'jobid'>,
  opts?: { videoIndex?: number; stepIndex?: number },
) => {
  const id = String(browserId || '').trim()
  if (!id) return { ok: false, error: '缺少浏览器' }
  if (!chapter.active) {
    await openChapterFromCard(id, chapter)
    await new Promise((resolve) => window.setTimeout(resolve, 700))
  }
  const label = String(job.label || '').trim()
  const videoIndex = Number(opts?.videoIndex) || 0
  const stepIndex = Number(opts?.stepIndex) || 0
  const mid = String(job.mid || '').trim()
  const jobid = String(job.jobid || '').trim()
  let stepped: Record<string, unknown> | null = null
  if (label || mid || jobid || videoIndex || stepIndex) {
    stepped = await clickChaoxingStep(id, {
      label,
      mid,
      jobid,
      videoIndex,
      index: stepIndex,
    }) as Record<string, unknown>
  }
  if (job.kind === 'quiz' || stepped?.quiz) {
    await applyVideo(id, { force: true }).catch(() => null)
    return { ok: true, quiz: true, stepped, hint: '已打开测验任务点' }
  }
  if (job.kind === 'doc' || stepped?.doc) {
    await applyVideo(id, { force: true }).catch(() => null)
    return { ok: true, doc: true, stepped }
  }
  // 已点过任务点标签，不要再自动点「第一个未完成视频」把切换冲掉
  const played = await playChaoxingVideo(id, {
    skipTabClick: Boolean(label || mid || jobid || videoIndex || stepIndex),
  }).catch(() => null)
  await applyVideo(id, { force: true }).catch(() => null)
  return { ok: Boolean(played?.playing || played?.hasVideo), stepped, played }
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
