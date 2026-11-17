/** 目录快照写入与进度轮询。开章/点播放在 chapterPlay.ts。 */
import { ref, watch as vueWatch } from 'vue'
import { listenBrowserLoad } from '../../browser/appBrowser'
import { waitMs, withIdleEval } from '../../browser/eval'
import { onBrowserFrame } from '../../browser/pushEvents'
import { kickParserClock, kickParserClockSoon, PARSER_CLOCK_MS, unwatchParserClock, watchParserClock } from '../../browser/pageClock'
import { attachVideoTick, browserVideoWatches, stopChaoxingWatch, videoLiveFor, videoWatchFor } from './watch'
import { isStudyUrl } from '../../browser/abstractions'
import {
  CHAPTER_PARSER_ENABLED,
  clearChaoxingPlayMid,
  installChaoxingVideoHook,
  parseChaoxingChapters,
  readChaoxingChapterJobTick,
  readChaoxingChapterTick,
  videoTickHasPlayer,
  type ChaoxingChapterSnap,
} from '../study'
import type { ChapterItem, ChapterJobItem, ChapterParseState, ChapterVideoProgress } from './chapterTypes'
import {
  catalogIndex,
  isCatalogSectionTitle,
  liveJobsBelongHere,
  stickyJobDone,
  studyNeedsFullJobRead,
  titlesMatch,
} from './chapterMatch'

export const browserChapterStates = (
  import.meta.hot?.data.browserChapterStates as ReturnType<typeof ref<Record<string, ChapterParseState>>> | undefined
) || ref<Record<string, ChapterParseState>>({})

export const CATALOG_MS = PARSER_CLOCK_MS
export const VIDEO_FALLBACK_MS = 8_000
export const LIVE_MS = 250
const VIDEO_STALE_MS = 12_000
const chapterParserOn = new Set<string>()
const storeUnsub = new Map<string, () => void>()
const frameUnsub = new Map<string, () => void>()
const loadUnsub = new Map<string, () => void>()
export const inFlight = new Set<string>()
export const videoInFlight = new Set<string>()
export const videoForceAgain = new Set<string>()
export const preferVideoUntil = new Map<string, number>()

if (import.meta.hot) {
  import.meta.hot.dispose((data) => {
    data.browserChapterStates = browserChapterStates
    data.parserIds = [...new Set([
      ...chapterParserOn,
      ...Object.keys(browserChapterStates.value || {}),
    ])]
    for (const id of chapterParserOn) unwatchParserClock(id, 'study')
    chapterParserOn.clear()
    for (const off of storeUnsub.values()) off()
    storeUnsub.clear()
    for (const off of frameUnsub.values()) off()
    frameUnsub.clear()
    for (const off of loadUnsub.values()) off()
    loadUnsub.clear()
    inFlight.clear()
    videoInFlight.clear()
  })
}

export const isChaoxingCourseUrl = (url: string) => isStudyUrl(url)

export const chapterKind = (page: string, url: string): 'course' | 'player' => {
  if (page === 'player' || /studentstudy/i.test(url)) return 'player'
  return 'course'
}

export const hrefChapterIdOf = (href: string) => (
  ((String(href || '').match(/[?&](?:chapterId|chapterid|knowledgeid)=(\d+)/i) || [])[1] || '').replace(/\D/g, '')
)

const pinChapterView = (
  chapters: ChapterItem[],
  prev: ChapterParseState | null | undefined,
  snapCurrent: string,
  overrideTitle?: string,
) => {
  const expect = String(prev?.expectChapterTitle || '').trim()
  const wantTitle = String(overrideTitle || expect || prev?.currentTitle || '').trim()
  const pinnedId = String(prev?.jobChapterId || '').replace(/\D/g, '')
  const byTitle = chapters.find((item) => Boolean(wantTitle && titlesMatch(item.title, wantTitle)))
  const byId = chapters.find((item) => pinnedId && item.chapterId && item.chapterId === pinnedId)
  const pinned = (byTitle && byId && !titlesMatch(byTitle.title, byId.title)) ? byTitle : (byTitle || byId)
  const current = String(overrideTitle || expect || pinned?.title || snapCurrent || prev?.currentTitle || '')
  const pinnedChapterId = String(pinned?.chapterId || '').replace(/\D/g, '')
  const sameChapter = Boolean(
    pinnedChapterId
    && prev?.jobChapterId
    && pinnedChapterId === prev.jobChapterId,
  )
  const keepJobs = Boolean(
    prev?.jobs?.length
    && liveJobsBelongHere(
      { title: current, chapterId: pinnedChapterId },
      { title: prev.currentTitle, chapterId: prev.jobChapterId },
    )
    && (sameChapter || (!expect && !pinnedChapterId))
    && !(pinnedChapterId && prev.jobChapterId && pinnedChapterId !== prev.jobChapterId),
  )
  return {
    pinned,
    current,
    jobs: keepJobs ? prev!.jobs : [],
    jobChapterId: keepJobs
      ? (pinnedChapterId || pinnedId || prev?.jobChapterId || '')
      : pinnedChapterId,
    expectChapterTitle: expect,
  }
}

const titleHit = (left: string, right: string) => titlesMatch(left, right)

const chapterDepthOf = (item: { kind?: string; depth?: number; index?: string; title?: string }) => {
  if (item.kind === 'chapter') return 0
  if (Number(item.depth) > 0) return Number(item.depth)
  const index = String(item.index || '').trim() || catalogIndex(item.title)
  return index ? index.split('.').length : 1
}

const keepCatalogTitle = isCatalogSectionTitle

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

export const findChapterInPanel = (
  browserId: string,
  want?: { title?: string; index?: string; chapterId?: string },
) => {
  const chapters = chapterStateFor(browserId)?.chapters || []
  const title = String(want?.title || '').trim()
  const index = String(want?.index || '').trim()
  const chapterId = String(want?.chapterId || '').replace(/\D/g, '')
  if (!title && !index && !chapterId) {
    const state = chapterStateFor(browserId)
    const current = String(state?.currentTitle || state?.current || '').trim()
    return chapters.find((item) => item.active && item.kind !== 'chapter')
      || chapters.find((item) => current && item.kind !== 'chapter' && titlesMatch(item.title, current))
      || chapters.find((item) => item.active)
      || null
  }
  return chapters.find((item) => (
    Boolean(chapterId && item.chapterId && item.chapterId === chapterId)
    || Boolean(index && item.index && item.index === index)
    || Boolean(title && titlesMatch(item.title, title))
  )) || null
}

/** 把 study_chapters / 目录解析结果写入题卡状态，供 play 取未完成第一节。 */
export const ingestChapterSnap = (browserId: string, snap: ChaoxingChapterSnap | null | undefined) => (
  applySnap(String(browserId || '').trim(), snap || null)
)

export { parseChaoxingChapters }

export const applySnap = (browserId: string, snap: ChaoxingChapterSnap | null) => {
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
  const view = pinChapterView(chapters, prev, String(snap.current || ''))
  const { pinned, current } = view
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
      active: pinned
        ? Boolean(
          (pinned.chapterId && item.chapterId && item.chapterId === pinned.chapterId)
          || titlesMatch(item.title, pinned.title),
        )
        : Boolean(item.active || (current && titlesMatch(item.title, current))),
    })),
    progress: mergedProgress,
    video: view.jobs.length ? (prev?.video || null) : null,
    jobs: view.jobs,
    jobChapterId: view.jobChapterId,
    expectChapterTitle: view.expectChapterTitle,
    status: chapters.length || unfinished.length || mergedProgress ? 'ready' : 'empty',
    updatedAt: Date.now(),
  }
  browserChapterStates.value = { ...browserChapterStates.value, [browserId]: next }
  traceStore(browserId, 'snap', next)
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
  const view = pinChapterView(prev.chapters, prev, String(snap.current || ''), currentTitle)
  const { pinned, current } = view
  const next: ChapterParseState = {
    ...prev,
    url: String(snap.url || prev.url),
    page: String(snap.page || prev.page),
    kind: chapterKind(String(snap.page || prev.page), String(snap.url || prev.url)),
    current,
    currentTitle: current,
    unfinished: (snap.unfinished?.length ? snap.unfinished : prev.unfinished).filter((title) => keepCatalogTitle(title)),
    unfinishedCount: left || prev.unfinishedCount,
    jobChapterId: view.jobChapterId,
    expectChapterTitle: view.expectChapterTitle,
    chapters: prev.chapters.map((item) => ({
      ...item,
      unfinished: unfinishedTitles.size
        ? (unfinishedTitles.has(item.title)
          || [...unfinishedTitles].some((title) => titlesMatch(item.title, title) || titlesMatch(item.index, title)))
        : item.unfinished,
      active: pinned
        ? Boolean(
          (pinned.chapterId && item.chapterId && item.chapterId === pinned.chapterId)
          || titlesMatch(item.title, pinned.title),
        )
        : Boolean(current && (titlesMatch(item.title, current) || item.title === current)),
    })),
    progress: pickCourseProgress(progress, prev.progress),
    video: view.jobs.length ? prev.video : null,
    jobs: view.jobs,
    status: 'ready',
    updatedAt: Date.now(),
  }
  browserChapterStates.value = { ...browserChapterStates.value, [browserId]: next }
  traceStore(browserId, 'merged', next)
  return next
}

export const snapHasData = (snap: ChaoxingChapterSnap | null | undefined) => Boolean(
  snap && ((snap.chapters || []).length || (snap.unfinished || []).length || snap.progress)
)

const videoPercent = (current: number, duration: number, ended: boolean) => {
  if (ended) return 100
  if (!(duration > 0)) return 0
  return Math.max(0, Math.min(100, (current / duration) * 100))
}

const tickFromWatch = (browserId: string) => {
  const watch = videoLiveFor(browserId)
  if (!watch) return null
  return {
    current: watch.current,
    duration: watch.duration,
    paused: watch.paused,
    ended: watch.ended,
    mid: watch.mid,
    src: '',
    hasVideo: watch.ended || watch.duration > 1 || watch.current > 0.2,
  }
}

/** 开发模式：谁改了章节状态的 jobs / video，写到 cx-study-live.md「监测（store）」。 */
const traceStore = (id: string, via: string, state: ChapterParseState | null | undefined) => {
  if (!import.meta.env.DEV) return
  const watch = browserVideoWatches.value[id]
  void import('../study/debug').then(({ noteStudyStore }) => {
    const jobs = (state?.jobs || []).filter((item) => item.kind === 'video')
      .map((item) => `${item.label}${item.active ? '·当前' : ''}${item.current != null ? ` ${Math.round(item.current)}s` : ''}`)
    noteStudyStore(
      `${via}  watch=${watch ? `${watch.sessionId ? 'agent' : 'panel'} ${watch.status} mid=…${String(watch.mid || '').slice(-6)} ${Math.round(watch.current)}/${Math.round(watch.duration)}` : '无'}`
      + `  state=${state ? `${state.kind} ch=${state.jobChapterId || '-'} video=${state.video ? Math.round(state.video.current) : '-'}` : '无'}`
      + `  jobs=[${jobs.join(' | ')}]`,
    )
  }).catch(() => null)
}

const lastStoreWrite = new Map<string, string>()

const writeVideoFromStore = (id: string) => {
  const watch = browserVideoWatches.value[id]
  const prev = chapterStateFor(id)
  if (!prev || !watch || prev.kind !== 'player') return
  // 同一个 tick 只写一次（deep watch 偶尔连发两次）；jobs 被别的写入者抹平时 stamp 不同，仍会补回。
  const stamp = `${watch.updatedAt}:${watch.current}:${watch.mid}:${prev.jobs.filter((item) => item.active).map((item) => item.mid).join(',')}`
  if (lastStoreWrite.get(id) === stamp) return
  lastStoreWrite.set(id, stamp)
  const current = Number(watch.current) || 0
  const duration = Number(watch.duration) || 0
  const ended = Boolean(watch.ended)
  const paused = Boolean(watch.paused)
  const percent = videoPercent(current, duration, ended)
  const mid = String(watch.mid || '')
  const hasPlayer = ended || duration > 1 || current > 0.2
  // 进度跟 mid 走：tick 属于哪条任务点，就只写那条，并把它标成 active。
  const midKnown = Boolean(mid && prev.jobs.some((item) => item.kind === 'video' && item.mid === mid))
  browserChapterStates.value = {
    ...browserChapterStates.value,
    [id]: {
      ...prev,
      video: {
        current,
        duration,
        percent,
        paused,
        ended,
        title: prev.currentTitle || prev.current || prev.video?.title || '',
        updatedAt: Date.now(),
      },
      jobs: prev.jobs.map((item) => {
        if (item.kind !== 'video') return item
        const mine = midKnown ? item.mid === mid : (!mid || !item.mid || item.active)
        if (!mine) return midKnown && hasPlayer && item.active ? { ...item, active: false } : item
        return {
          ...item,
          current,
          duration,
          percent,
          paused,
          jobDone: ended || item.jobDone,
          active: hasPlayer ? true : item.active,
        }
      }),
      updatedAt: Date.now(),
    },
  }
  traceStore(id, 'store', browserChapterStates.value[id])
}

const asJobKind = (raw: unknown): ChapterJobItem['kind'] => {
  const text = String(raw || '')
  if (text === 'video' || text === 'quiz' || text === 'doc') return text
  return 'other'
}

const withTimeout = async <T,>(fn: () => Promise<T>, ms: number): Promise<T | null> => {
  let timer = 0
  try {
    return await Promise.race([
      fn().catch(() => null),
      new Promise<null>((resolve) => {
        timer = window.setTimeout(() => resolve(null), ms)
      }),
    ])
  } finally {
    window.clearTimeout(timer)
  }
}

const seedVideoJobs = (prev: ChapterParseState, tick: { current?: number; duration?: number; paused?: boolean; ended?: boolean; mid?: string } | null) => {
  const current = Number(tick?.current) || 0
  const duration = Number(tick?.duration) || 0
  const ended = Boolean(tick?.ended)
  const percent = videoPercent(current, duration, ended)
  return {
    ...prev,
    video: {
      current,
      duration,
      percent,
      paused: Boolean(tick?.paused),
      ended,
      title: prev.currentTitle || prev.current || prev.video?.title || '',
      updatedAt: Date.now(),
    },
    jobs: prev.jobs.some((job) => job.kind === 'video')
      ? prev.jobs
      : [{
          mid: String(tick?.mid || ''),
          jobid: '',
          label: '视频',
          kind: 'video' as const,
          jobDone: ended,
          unfinished: !ended,
          active: true,
          current,
          duration,
          percent,
          paused: Boolean(tick?.paused),
        }],
    updatedAt: Date.now(),
  }
}

/** 播放页任务点直接写入面板，不做节名/id 对账。对账失败时 applyVideo 会把视频行清掉。 */
export const publishPlayerJobs = async (browserId: string) => {
  const id = String(browserId || '').trim()
  const prev = chapterStateFor(id)
  if (!prev || prev.kind !== 'player') return prev
  const cheap = tickFromWatch(id)
  const jobSnap = await withTimeout(() => readChaoxingChapterJobTick(id, { full: true }), 2200)
  const raw = Array.isArray(jobSnap?.jobs) ? jobSnap!.jobs : []
  const current = Number(cheap?.current) || 0
  const duration = Number(cheap?.duration) || 0
  const ended = Boolean(cheap?.ended)
  const paused = Boolean(cheap?.paused)
  const percent = videoPercent(current, duration, ended)
  const jobs: ChapterJobItem[] = raw.length
    ? raw.map((item) => {
      const kind = asJobKind(item.kind || (item.video ? 'video' : item.quiz ? 'quiz' : item.doc ? 'doc' : 'other'))
      const jobDone = item.jobDone === true || item.passed === true
      return {
        mid: String(item.mid || ''),
        jobid: String(item.jobid || ''),
        label: String(item.label || kind),
        kind,
        jobDone,
        unfinished: !jobDone,
        active: Boolean(item.active),
      }
    })
    : (videoTickHasPlayer(cheap)
      ? [{
          mid: String((cheap as { mid?: string } | null)?.mid || ''),
          jobid: '',
          label: '视频',
          kind: 'video' as const,
          jobDone: ended,
          unfinished: !ended,
          active: true,
          current,
          duration,
          percent,
          paused,
        }]
      : prev.jobs)
  if (!jobs.length) return chapterStateFor(id)
  const next = {
    ...prev,
    jobs,
    video: videoTickHasPlayer(cheap)
      ? {
          current,
          duration,
          percent,
          paused,
          ended,
          title: prev.currentTitle || prev.current || '',
          updatedAt: Date.now(),
        }
      : prev.video,
    expectChapterTitle: '',
    jobChapterId: String(jobSnap?.chapterId || prev.jobChapterId || '').replace(/\D/g, ''),
    updatedAt: Date.now(),
  }
  browserChapterStates.value = { ...browserChapterStates.value, [id]: next }
  traceStore(id, 'publish', next)
  // 页面重读回来的 jobs 没有 active / 进度；立刻用 store 里钉住的 mid 补回去，别让「当前」标记闪没。
  writeVideoFromStore(id)
  return chapterStateFor(id)
}

export const applyVideo = async (browserId: string, opts?: { force?: boolean }) => {
  if (videoInFlight.has(browserId)) {
    if (opts?.force) videoForceAgain.add(browserId)
    return
  }
  if (!chapterStateFor(browserId)) return
  videoInFlight.add(browserId)
  const run = async () => {
    const prev0 = chapterStateFor(browserId)
    if (!prev0) return
    const cheap = tickFromWatch(browserId)
    const needJobs = studyNeedsFullJobRead(prev0)
    if (cheap && videoTickHasPlayer(cheap) && !prev0.jobs.some((job) => job.kind === 'video')) {
      browserChapterStates.value = {
        ...browserChapterStates.value,
        [browserId]: seedVideoJobs(prev0, cheap),
      }
    }
    const jobSnap = needJobs
      ? await withTimeout(() => readChaoxingChapterJobTick(browserId, { full: true }), 2200)
      : null
    const snap = {
      video: cheap || jobSnap?.video,
      jobs: (jobSnap?.jobs?.length ? jobSnap.jobs : prev0.jobs) || [],
      chapterId: jobSnap?.chapterId || prev0.jobChapterId || '',
      current: jobSnap?.current || prev0.currentTitle || prev0.current || '',
      videoMid: String(cheap?.mid || jobSnap?.videoMid || ''),
      videoIndex: jobSnap?.videoIndex || 0,
      live: true,
    }
    const prev = chapterStateFor(browserId)
    if (!prev) return
    const tick = snap?.video || null
    const current = Number(tick?.current) || 0
    const liveMid = String(snap?.videoMid || tick?.mid || '')
    const sameMid = Boolean(liveMid && prev.jobs.some((item) => item.active && item.mid && item.mid === liveMid))
    const duration = Number(tick?.duration) || (sameMid ? Number(prev.video?.duration) || 0 : 0)
    const hasVideo = Boolean(tick && (duration > 1 || current > 0.2 || String(tick.src || '').trim() || videoTickHasPlayer(tick)))
    const ended = Boolean(tick?.ended)
    const paused = Boolean(tick?.paused)
    const percent = videoPercent(current, duration, ended)
    const title = prev.currentTitle || prev.current || prev.video?.title || ''

    const rawJobs = Array.isArray(snap?.jobs) ? snap.jobs : []
    const liveChapterId = String(snap?.chapterId || '').replace(/\D/g, '')
    const liveTitle = String((snap as { current?: string } | null)?.current || '').trim()
    const expect = String(prev.expectChapterTitle || '').trim()
    const hereTitle = expect || prev.currentTitle || prev.current
    const hereId = String(
      prev.jobChapterId
      || prev.chapters.find((item) => item.active && item.kind !== 'chapter')?.chapterId
      || '',
    ).replace(/\D/g, '')
    let belong = liveJobsBelongHere(
      { title: hereTitle, chapterId: hereId },
      { title: liveTitle, chapterId: liveChapterId },
    )
    if (expect && liveTitle) belong = titlesMatch(expect, liveTitle) && belong
    if (!belong && (hasVideo || rawJobs.length) && !liveTitle) belong = true
    const chapterChanged = Boolean(
      liveChapterId
      && prev.jobChapterId
      && liveChapterId !== prev.jobChapterId
      && !titlesMatch(hereTitle, liveTitle),
    )
    if (!belong) {
      if (hasVideo || rawJobs.length) belong = true
      else return
    }
    const sameChapter = Boolean(
      liveChapterId
      && prev.jobChapterId
      && liveChapterId === prev.jobChapterId,
    )
    let jobs: ChapterJobItem[] = rawJobs.length
      ? rawJobs.map((item) => {
        const kind = asJobKind(item.kind || (item.video ? 'video' : item.quiz ? 'quiz' : item.doc ? 'doc' : 'other'))
        const rawDone = item.jobDone === true || item.passed === true
        const jobDone = stickyJobDone(prev.jobs, {
          mid: String(item.mid || ''),
          jobid: String(item.jobid || ''),
          label: String(item.label || kind),
          kind,
          jobDone: rawDone,
        }, sameChapter)
        return {
          mid: String(item.mid || ''),
          jobid: String(item.jobid || ''),
          label: String(item.label || kind),
          kind,
          jobDone,
          unfinished: !jobDone,
          active: Boolean(item.active),
          current: Number(item.current) || undefined,
          duration: Number(item.duration) || undefined,
          percent: Number(item.percent) || undefined,
          paused: item.paused,
        }
      })
      : ((snap as { live?: boolean } | null)?.live && prev.jobs.length
        ? prev.jobs.map((item) => ({ ...item }))
        : [])

    const videos = jobs.filter((item) => item.kind === 'video')
    const liveIndex = Number(snap?.videoIndex) || 0
    const prevActive = (prev.jobs || []).find((item) => item.active && item.kind === 'video')
    const liveVideo = (liveMid && jobs.find((item) => item.kind === 'video' && item.mid && item.mid === liveMid))
      || (prevActive?.mid && jobs.find((item) => item.kind === 'video' && item.mid && item.mid === prevActive.mid))
      || jobs.find((item) => item.active && item.kind === 'video')
      || (!prevActive && liveIndex > 0 ? videos[liveIndex - 1] : null)
    const holdVideo = Date.now() < (preferVideoUntil.get(browserId) || 0)
    if (liveVideo) {
      jobs = jobs.map((item) => ({ ...item, active: item === liveVideo }))
    } else if (holdVideo && jobs.some((item) => item.active && item.kind === 'quiz') && videos.length) {
      jobs = jobs.map((item) => ({ ...item, active: item === videos[0] }))
    }

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

    const nextJobs = jobs.length
      ? jobs
      : (chapterChanged
        ? []
        : (hasVideo ? prev.jobs : (
          prev.jobs.length && Date.now() - (prev.video?.updatedAt || prev.updatedAt) > VIDEO_STALE_MS
            ? []
            : prev.jobs
        )))

    browserChapterStates.value = {
      ...browserChapterStates.value,
      [browserId]: {
        ...prev,
        video,
        jobs: nextJobs,
        jobChapterId: liveChapterId || prev.jobChapterId,
        expectChapterTitle: '',
        updatedAt: Date.now(),
      },
    }
    traceStore(browserId, `applyVideo${needJobs ? '+jobs' : ''}${hasVideo ? '' : ' noVideo'}`, browserChapterStates.value[browserId])
  }
  try {
    if (opts?.force) await run()
    else await withIdleEval(run)
  } finally {
    videoInFlight.delete(browserId)
    if (videoForceAgain.delete(browserId)) void applyVideo(browserId, { force: true })
  }
}

export const refreshChapterJobsSoon = async (browserId: string) => {
  await applyVideo(browserId, { force: true })
  if ((chapterStateFor(browserId)?.jobs || []).some((job) => job.kind === 'video')) return
  await waitMs(350)
  await applyVideo(browserId, { force: true })
}

/** 进度只跟 browserVideoWatches，不再本地插值。 */
export const tickChapterLive = (browserId: string) => {
  writeVideoFromStore(browserId)
}

export const poll = async (browserId: string, attempt = 0) => {
  if (!CHAPTER_PARSER_ENABLED) return
  // watch 结束（done / lost）会退订 tick；幂等地把订阅接回来。
  if (chapterParserOn.has(browserId)) attachVideoTick(browserId)
  const watching = Boolean(videoWatchFor(browserId))
  const state = chapterStateFor(browserId)
  if (watching && !state?.expectChapterTitle && state?.chapters.length) return
  if (inFlight.has(browserId)) return
  inFlight.add(browserId)
  try {
    await withIdleEval(async () => {
      const tick = await readChaoxingChapterTick(browserId)
      if (snapHasData(tick)) {
        applySnap(browserId, tick)
        return
      }
      const prev = chapterStateFor(browserId)
      if (prev && !prev.chapters.length && attempt < 4) {
        window.setTimeout(() => { void poll(browserId, attempt + 1) }, 180)
        return
      }
      if (prev && !prev.chapters.length && (prev.status === 'reading' || prev.status === 'empty')) {
        browserChapterStates.value = {
          ...browserChapterStates.value,
          [browserId]: { ...prev, status: 'empty', updatedAt: Date.now() },
        }
      }
    })
  } catch (error) {
    const prev = chapterStateFor(browserId)
    if (prev && !prev.chapters.length) {
      browserChapterStates.value = {
        ...browserChapterStates.value,
        [browserId]: { ...prev, status: 'empty', updatedAt: Date.now() },
      }
    }
    void import('../study/debug').then(({ noteStudyParser }) => {
      noteStudyParser({
        via: 'catalog-error',
        error: error instanceof Error ? error.message : String(error || '章节轮询失败'),
        force: true,
      })
    }).catch(() => null)
  } finally {
    inFlight.delete(browserId)
  }
  if (chapterStateFor(browserId)?.kind === 'player') void applyVideo(browserId)
}

/** 帧事件成串来（frameNavigated + frameStoppedLoading × 二十多个 iframe），合并成一次尾沿 kick。 */
export const pollSoon = (browserId: string) => {
  kickParserClockSoon(browserId)
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

export const stopChaoxingChapterParser = (browserId?: string) => {
  const id = String(browserId || '').trim()
  if (!id) return
  chapterParserOn.delete(id)
  unwatchParserClock(id, 'study')
  storeUnsub.get(id)?.()
  storeUnsub.delete(id)
  frameUnsub.get(id)?.()
  frameUnsub.delete(id)
  loadUnsub.get(id)?.()
  loadUnsub.delete(id)
  inFlight.delete(id)
  videoInFlight.delete(id)
}

export const startChaoxingChapterParser = (browserId: string) => {
  const id = String(browserId || '').trim()
  void import('../../browser/appBrowser').then((mod) => mod.trackBrowserLoads()).catch(() => null)
  if (!id || !CHAPTER_PARSER_ENABLED) return chapterStateFor(id)
  watchParserClock(id, 'study', () => poll(id))
  if (!chapterParserOn.has(id)) {
    if (!chapterStateFor(id)?.chapters.length) {
      browserChapterStates.value = {
        ...browserChapterStates.value,
        [id]: blankState(id),
      }
    }
    chapterParserOn.add(id)
    attachVideoTick(id)
    storeUnsub.get(id)?.()
    storeUnsub.set(id, vueWatch(
      () => browserVideoWatches.value[id],
      (entry) => {
        // 切章 / Agent 停 watch 会把条目删掉；解析器还在跑就立刻补一个空白监测（mid 清空），
        // 否则切章后的 tick 没人接，面板进度永远 0/0。
        if (!entry) {
          if (chapterParserOn.has(id)) attachVideoTick(id)
          return
        }
        writeVideoFromStore(id)
      },
      { deep: true },
    ))
    frameUnsub.get(id)?.()
    frameUnsub.set(id, onBrowserFrame(id, (url) => {
      if (/cards|coursetree|studentstudy/i.test(url)) pollSoon(id)
    }))
    loadUnsub.get(id)?.()
    void listenBrowserLoad((state) => {
      if (state.id !== id) return
      if (state.phase === 'finished') pollSoon(id)
    }).then((off) => loadUnsub.set(id, off)).catch(() => null)
    void installChaoxingVideoHook(id).catch(() => null)
    void kickParserClock(id)
    window.setTimeout(() => {
      const prev = chapterStateFor(id)
      if (prev?.status === 'reading' && !prev.chapters.length) {
        browserChapterStates.value = {
          ...browserChapterStates.value,
          [id]: { ...prev, status: 'empty', updatedAt: Date.now() },
        }
      }
    }, 4000)
    return chapterStateFor(id)
  }
  attachVideoTick(id)
  if (!chapterStateFor(id)?.chapters.length) void kickParserClock(id)
  else if (chapterStateFor(id)?.kind === 'player') void applyVideo(id, { force: true })
  return chapterStateFor(id)
}

const hotParserIds = (import.meta.hot?.data?.parserIds || []) as string[]
if (hotParserIds.length) {
  queueMicrotask(() => {
    for (const id of hotParserIds) startChaoxingChapterParser(id)
  })
}

export const syncChaoxingChapterUrl = (browserId: string, url: string) => {
  const id = String(browserId || '').trim()
  if (!id) return
  const prev = chapterStateFor(id)
  const urlId = hrefChapterIdOf(url)
  const chapterChanged = Boolean(urlId && prev?.jobChapterId && urlId !== prev.jobChapterId)
  if (chapterChanged) {
    stopChaoxingWatch(id)
    clearChaoxingPlayMid(id)
    if (prev) {
      browserChapterStates.value = {
        ...browserChapterStates.value,
        [id]: {
          ...prev,
          url,
          kind: chapterKind('', url),
          jobs: [],
          video: null,
          jobChapterId: urlId,
          expectChapterTitle: prev.expectChapterTitle || prev.currentTitle || prev.current,
          updatedAt: Date.now(),
        },
      }
    }
  }
  startChaoxingChapterParser(id)
  const next = chapterStateFor(id)
  const kind = chapterKind('', url)
  if (next && (next.url !== url || next.kind !== kind) && !chapterChanged) {
    browserChapterStates.value = {
      ...browserChapterStates.value,
      [id]: { ...next, url, kind, updatedAt: Date.now() },
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

export const resyncChaoxingStudy = (browserId: string, url = '') => {
  const id = String(browserId || '').trim()
  if (!id) return
  stopChaoxingWatch(id)
  const prev = chapterStateFor(id)
  const href = String(url || prev?.url || '')
  const urlId = hrefChapterIdOf(href)
  if (prev) {
    browserChapterStates.value = {
      ...browserChapterStates.value,
      [id]: {
        ...prev,
        url: href || prev.url,
        kind: href ? chapterKind('', href) : prev.kind,
        jobs: [],
        video: null,
        jobChapterId: urlId || prev.jobChapterId,
        expectChapterTitle: prev.expectChapterTitle || prev.currentTitle || prev.current,
        status: prev.chapters.length ? prev.status : 'reading',
        updatedAt: Date.now(),
      },
    }
  }
  startChaoxingChapterParser(id)
  void (async () => {
    const snap = await parseChaoxingChapters(id).catch(() => null)
    if (snap) applySnap(id, snap)
    await applyVideo(id, { force: true }).catch(() => null)
  })()
}
