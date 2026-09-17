import { ref } from 'vue'
import { evalBrowserViewMain, evalBrowserViewMainIdle, waitMs, withIdleEval } from '../../browser/eval'
import { stopChaoxingWatch, videoWatchFor } from './watch'
import { clearAbstractionDrill, isStudyUrl } from '../../browser/abstractions'
import {
  CHAPTER_PARSER_ENABLED,
  openChaoxingChapter,
  parseChaoxingChapters,
  readChaoxingChapterJobTick,
  readChaoxingChapterTick,
  tapChaoxingPlay,
  pauseChaoxingVideo,
  clickChaoxingStep,
  readChaoxingVideoTick,
  videoIsPlaying,
  videoTickHasPlayer,
  installChaoxingVideoHook,
  liveStudyHref,
  waitForStudentStudyPage,
  waitForStudyPlayerReady,
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
  jobChapterId?: string
  /** 刚切章：直播页任务点对上这个节名之前，不要沿用上一节 jobs */
  expectChapterTitle?: string
  status: 'reading' | 'ready' | 'empty'
  updatedAt: number
}

export const browserChapterStates = (
  import.meta.hot?.data.browserChapterStates as ReturnType<typeof ref<Record<string, ChapterParseState>>> | undefined
) || ref<Record<string, ChapterParseState>>({})

const CATALOG_MS = 10_000
const VIDEO_SYNC_MS = 2_000
const LIVE_MS = 250
const VIDEO_STALE_MS = 12_000
const timers = new Map<string, number[]>()
const inFlight = new Set<string>()
const videoInFlight = new Set<string>()
const videoForceAgain = new Set<string>()
const preferVideoUntil = new Map<string, number>()

if (import.meta.hot) {
  import.meta.hot.accept()
  import.meta.hot.dispose((data) => {
    data.browserChapterStates = browserChapterStates
    for (const list of timers.values()) {
      for (const timer of list) window.clearInterval(timer)
    }
    timers.clear()
    inFlight.clear()
    videoInFlight.clear()
  })
}

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

export const sameChapterJob = (
  left: { mid?: string; jobid?: string; label?: string; kind?: string },
  right: { mid?: string; jobid?: string; label?: string; kind?: string },
) => {
  const leftMid = String(left.mid || '').trim()
  const rightMid = String(right.mid || '').trim()
  if (leftMid && rightMid && leftMid === rightMid) return true
  const leftJob = String(left.jobid || '').trim()
  const rightJob = String(right.jobid || '').trim()
  if (leftJob && rightJob && leftJob === rightJob) return true
  return Boolean(
    left.kind
    && left.kind === right.kind
    && String(left.label || '').trim()
    && String(left.label || '').trim() === String(right.label || '').trim(),
  )
}

/** 同一节里任务点一旦完成，页面图标回闪未完成也不能再当未做。跨节同名「视频1」不继承。 */
export const stickyJobDone = (
  prev: Array<{ mid?: string; jobid?: string; label?: string; kind?: string; jobDone?: boolean }>,
  item: { mid?: string; jobid?: string; label?: string; kind?: string; jobDone?: boolean },
  sameChapter: boolean,
) => {
  if (item.jobDone) return true
  if (!sameChapter) return false
  return prev.some((row) => row.jobDone && sameChapterJob(row, item))
}

/** 直播页任务点是否属于面板上的当前节。切章后上一节的 jobs 不能跟过来。 */
export const liveJobsBelongHere = (
  here: { title?: string; chapterId?: string },
  live: { title?: string; chapterId?: string },
) => {
  const hereTitle = String(here.title || '').trim()
  const liveTitle = String(live.title || '').trim()
  if (hereTitle && liveTitle && !titlesMatch(hereTitle, liveTitle)) return false
  const hereId = String(here.chapterId || '').replace(/\D/g, '')
  const liveId = String(live.chapterId || '').replace(/\D/g, '')
  if (hereId && liveId && hereId !== liveId) return false
  return true
}

/** 刚切章或还没任务点时必须整页重读，不能因为上一节还在 watch 就只打 live。 */
export const studyNeedsFullJobRead = (
  state: { expectChapterTitle?: string; jobs?: Array<{ kind?: string }> } | null | undefined,
) => (
  Boolean(state?.expectChapterTitle)
  || !(state?.jobs || []).some((job) => job.kind === 'video' || job.kind === 'quiz')
)

const hrefChapterIdOf = (href: string) => (
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
  const keepJobs = Boolean(
    !expect
    && prev?.jobs?.length
    && liveJobsBelongHere(
      { title: current, chapterId: pinnedChapterId },
      { title: prev.currentTitle, chapterId: prev.jobChapterId },
    )
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

export const isCatalogSectionTitle = (title: string) => {
  const text = String(title || '').trim()
  if (!text) return false
  if (/^[一二三四五六七八九十]+[、.]/.test(text)) return false
  if (/单选题|多选题|判断题|填空题|共\s*\d+\s*题/.test(text)) return false
  if (/待完成任务点|已完成任务点|个任务点/.test(text)) return false
  return true
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
  if (videoInFlight.has(browserId)) {
    if (opts?.force) videoForceAgain.add(browserId)
    return
  }
  if (!chapterStateFor(browserId)) return
  videoInFlight.add(browserId)
  const run = async () => {
    const prev0 = chapterStateFor(browserId)
    if (!prev0) return
    const cheap = await readChaoxingVideoTick(browserId).catch(() => null)
    const needJobs = studyNeedsFullJobRead(prev0)
    const jobSnap = needJobs
      ? await readChaoxingChapterJobTick(browserId, { full: true }).catch(() => null)
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
    if (expect) {
      belong = liveTitle
        ? titlesMatch(expect, liveTitle) && belong
        : Boolean(hereId && liveChapterId && hereId === liveChapterId)
    }
    const chapterChanged = Boolean(
      liveChapterId
      && prev.jobChapterId
      && liveChapterId !== prev.jobChapterId,
    )
    if (!belong) {
      browserChapterStates.value = {
        ...browserChapterStates.value,
        [browserId]: {
          ...prev,
          jobs: [],
          video: null,
          jobChapterId: hereId,
          expectChapterTitle: expect,
          updatedAt: Date.now(),
        },
      }
      return
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
  }
  try {
    if (opts?.force) return await run()
    return await withIdleEval(run)
  } finally {
    videoInFlight.delete(browserId)
    if (videoForceAgain.delete(browserId)) void applyVideo(browserId, { force: true })
  }
}

const refreshChapterJobsSoon = async (browserId: string) => {
  await applyVideo(browserId, { force: true })
  if ((chapterStateFor(browserId)?.jobs || []).some((job) => job.kind === 'video')) return
  await waitMs(350)
  await applyVideo(browserId, { force: true })
}

/** 进度条在页面钩子里自己走；宿主只做本地插值，不每秒 eval。 */
const tickChapterLive = (browserId: string) => {
  if (videoWatchFor(browserId)) return
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

const poll = async (browserId: string, attempt = 0) => {
  if (!CHAPTER_PARSER_ENABLED) return
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
  void import('../../browser/appBrowser').then((mod) => mod.trackBrowserLoads()).catch(() => null)
  if (!id || !CHAPTER_PARSER_ENABLED) return chapterStateFor(id)
  if (!timers.has(id)) {
    if (!chapterStateFor(id)?.chapters.length) {
      browserChapterStates.value = {
        ...browserChapterStates.value,
        [id]: blankState(id),
      }
    }
    timers.set(id, [
      window.setInterval(() => { void poll(id) }, CATALOG_MS),
      window.setInterval(() => tickChapterLive(id), LIVE_MS),
      window.setInterval(() => {
        if (chapterStateFor(id)?.kind === 'player') void applyVideo(id)
      }, VIDEO_SYNC_MS),
    ])
    void installChaoxingVideoHook(id).catch(() => null)
    void poll(id)
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
  if (!chapterStateFor(id)?.chapters.length) void poll(id)
  else if (chapterStateFor(id)?.kind === 'player') void applyVideo(id)
  return chapterStateFor(id)
}

/** 网址变了立刻重读，不要等 10 秒轮询。 */
export const syncChaoxingChapterUrl = (browserId: string, url: string) => {
  const id = String(browserId || '').trim()
  if (!id) return
  const prev = chapterStateFor(id)
  const urlId = hrefChapterIdOf(url)
  const chapterChanged = Boolean(urlId && prev?.jobChapterId && urlId !== prev.jobChapterId)
  if (chapterChanged) {
    stopChaoxingWatch(id)
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

/** 主框刷新或切章落地：停掉旧监控，目录和任务点重新读。页内 helpers 下次 eval 会自动再注入。 */
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

export const openChapterFromCard = async (
  browserId: string,
  target: Pick<ChapterItem, 'title' | 'index' | 'chapterId' | 'href' | 'studyHref'>,
) => {
  const id = String(browserId || '').trim()
  const title = String(target.title || '').trim()
  if (!id || (!title && !target.chapterId && !target.index)) return { ok: false, error: '缺少节名' }
  clearAbstractionDrill(id)
  stopChaoxingWatch(id)
  void evalBrowserViewMainIdle(id, `(function(){
    try { window.__zePinnedVideo = null; } catch (e0) {}
    try { if (window.top) window.top.__zePinnedVideo = null; } catch (e1) {}
    try { window.__zePinnedMid = ''; } catch (e2) {}
    try { if (window.top) window.top.__zePinnedMid = ''; } catch (e3) {}
    try { window.__zeStudyReady = 0; } catch (e4) {}
    try { if (window.top) window.top.__zeStudyReady = 0; } catch (e5) {}
  })()`).catch(() => null)
  preferVideoUntil.set(id, Date.now() + 8000)
  void import('../homework/background').then(({ holdChapterQuizAutoDrill }) => {
    holdChapterQuizAutoDrill(8000)
  }).catch(() => null)
  const prev = chapterStateFor(id)
  if (prev) {
    const next: ChapterParseState = {
      ...prev,
      current: title || prev.current,
      currentTitle: title || prev.currentTitle,
      jobs: [],
      video: null,
      jobChapterId: String(target.chapterId || '').replace(/\D/g, ''),
      expectChapterTitle: title,
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
  void readChaoxingChapterTick(id).then((tick) => {
    if (!tick) return
    applySnap(id, tick)
    const after = chapterStateFor(id)
    if (!after || !title || after.chapters.some((item) => item.active)) return
    browserChapterStates.value = {
      ...browserChapterStates.value,
      [id]: {
        ...after,
        current: title,
        currentTitle: title,
        jobChapterId: String(target.chapterId || after.jobChapterId || '').replace(/\D/g, ''),
        expectChapterTitle: after.jobs.length ? '' : (after.expectChapterTitle || title),
        jobs: after.jobs,
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
  }).catch(() => null)
  window.setTimeout(() => { void refreshChapterJobsSoon(id).catch(() => null) }, 800)
  return opened
}

const chapterAlreadyOpen = (
  id: string,
  target: Pick<ChapterItem, 'title' | 'index' | 'chapterId'>,
  href: string,
) => {
  if (!/studentstudy/i.test(href)) return false
  const prev = chapterStateFor(id)
  if (!prev) return false
  const title = String(target.title || '').trim()
  return prev.chapters.some((item) => item.active && (
    Boolean(target.chapterId && item.chapterId && item.chapterId === target.chapterId)
    || Boolean(target.index && item.index && item.index === target.index)
    || Boolean(title && titlesMatch(item.title, title))
  ))
}

/** 面板点小节：必要时切章，进播放页后再播。不在这里死等视频进度。 */
export const playChapterFromCard = async (
  browserId: string,
  target: Pick<ChapterItem, 'title' | 'index' | 'chapterId' | 'href' | 'studyHref'>,
) => {
  const id = String(browserId || '').trim()
  clearAbstractionDrill(id)
  const href = await liveStudyHref(id)
  const urlId = ((href.match(/[?&](?:chapterId|chapterid|knowledgeid)=(\d+)/i) || [])[1] || '').replace(/\D/g, '')
  const wantId = String(target.chapterId || '').replace(/\D/g, '')
  const already = Boolean(/studentstudy/i.test(href) && wantId && urlId && wantId === urlId)
    || chapterAlreadyOpen(id, target, href)
  const opened = already ? { ok: true, already: true } : await openChapterFromCard(id, target)
  let url = already ? href : await liveStudyHref(id)
  if (!/studentstudy/i.test(url)) {
    url = await waitForStudentStudyPage(id, 8_000)
  }
  if (!/studentstudy/i.test(url)) {
    await applyVideo(id, { force: true }).catch(() => null)
    return { opened, played: { ok: false, error: '目录点击后没有进入播放页（studentstudy）', url } }
  }
  preferVideoUntil.set(id, Date.now() + 8000)
  void import('../homework/background').then(({ holdChapterQuizAutoDrill }) => {
    holdChapterQuizAutoDrill(8000)
  }).catch(() => null)
  const playerHere = videoTickHasPlayer(await readChaoxingVideoTick(id).catch(() => null))
  if (!already || !playerHere) {
    await waitForStudyPlayerReady(id).catch(() => null)
  }
  const played = await tapChaoxingPlay(id).catch(() => null)
  void applyVideo(id, { force: true }).catch(() => null)
  return { opened, played }
}

/** 面板点本节任务点：必要时先切章，再按序号/mid 切标签；视频则播放 */
export const playChapterJobFromCard = async (
  browserId: string,
  chapter: Pick<ChapterItem, 'title' | 'index' | 'chapterId' | 'href' | 'studyHref' | 'active'>,
  job: Pick<ChapterJobItem, 'label' | 'kind' | 'active' | 'mid' | 'jobid' | 'paused'>,
  opts?: { videoIndex?: number; stepIndex?: number },
) => {
  const id = String(browserId || '').trim()
  if (!id) return { ok: false, error: '缺少浏览器' }
  if (job.kind === 'video' || job.kind === 'quiz') preferVideoUntil.delete(id)
  let url = await liveStudyHref(id)
  const urlId = ((url.match(/[?&](?:chapterId|chapterid|knowledgeid)=(\d+)/i) || [])[1] || '').replace(/\D/g, '')
  const wantId = String(chapter.chapterId || '').replace(/\D/g, '')
  const alreadyHere = Boolean(/studentstudy/i.test(url) && wantId && urlId && wantId === urlId)
  if (!alreadyHere) {
    await openChapterFromCard(id, chapter)
    url = await liveStudyHref(id)
    if (!/studentstudy/i.test(url)) url = await waitForStudentStudyPage(id, 8_000)
    if (!/studentstudy/i.test(url)) return { ok: false, error: '目录点击后没有进入播放页（studentstudy）', url }
    const nowId = ((url.match(/[?&](?:chapterId|chapterid|knowledgeid)=(\d+)/i) || [])[1] || '').replace(/\D/g, '')
    if (wantId && nowId && nowId !== wantId) {
      return { ok: false, error: `目录还停在 ${nowId}，没有进到 ${wantId}`, url }
    }
    await waitForStudyPlayerReady(id).catch(() => null)
  } else if (!videoTickHasPlayer(await readChaoxingVideoTick(id).catch(() => null))) {
    await waitForStudyPlayerReady(id).catch(() => null)
  }
  const label = String(job.label || '').trim()
  const videoIndex = Number(opts?.videoIndex) || 0
  const stepIndex = Number(opts?.stepIndex) || 0
  const mid = String(job.mid || '').trim()
  const jobid = String(job.jobid || '').trim()
  const jobOrd = (list: ChapterJobItem[], item?: ChapterJobItem | null) => {
    if (!item) return 0
    let n = 0
    for (const row of list) {
      if (row.kind !== 'video') continue
      n += 1
      if (row === item || (item.mid && row.mid && row.mid === item.mid) || row.label === item.label) return n
    }
    return n
  }
  const liveJobs = () => chapterStateFor(id)?.jobs || []
  const liveActive = () => liveJobs().find((item) => item.active && item.kind === 'video') || null
  const onRequested = () => {
    const active = liveActive()
    if (!active) return false
    if (mid && active.mid && active.mid === mid) return true
    if (videoIndex > 0) return jobOrd(liveJobs(), active) === videoIndex
    if (label && (active.label === label || active.label.includes(label) || label.includes(active.label))) return true
    return false
  }
  const liveNow = liveActive()
  const sameJob = liveNow ? onRequested() : Boolean(job.active)
  const liveTick = await readChaoxingVideoTick(id).catch(() => null)
  // 只信页内 tick。刷新后面板还可能停在 paused=false，再点 play 会误走暂停。
  if (job.kind === 'video' && sameJob && videoIsPlaying(liveTick)) {
    const { stopChaoxingWatch } = await import('./watch')
    stopChaoxingWatch(id, { keep: true })
    const paused = await pauseChaoxingVideo(id).catch(() => null)
    await applyVideo(id, { force: true }).catch(() => null)
    return { ok: Boolean(paused?.hasVideo), paused: true, played: paused }
  }
  let stepped: Record<string, unknown> | null = null
  // 刚切章时任务点还没挂稳，locate step 会把 CDP 卡死。本节默认已在第一个视频。
  if (!alreadyHere && job.kind === 'video' && (!videoIndex || videoIndex === 1)) {
    stepped = { ok: true, already: true, step: label || '视频1' }
  } else if (label || mid || jobid || videoIndex || stepIndex) {
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
  const needSwitch = Boolean(
    job.kind === 'video' && (mid || videoIndex > 1 || (label && !/^视频1$/.test(label))),
  )
  if (needSwitch && !stepped?.ok && !onRequested()) {
    await applyVideo(id, { force: true }).catch(() => null)
    return {
      ok: false,
      error: String(stepped?.error || '切换任务点失败'),
      stepped,
      hint: `没切到${label || `视频${videoIndex}`}。不要播当前条冒充成功。`,
    }
  }
  if (needSwitch && stepped?.ok && !stepped.already) {
    await waitMs(900)
    await waitForStudyPlayerReady(id).catch(() => null)
  }
  const played = await tapChaoxingPlay(id, { mid }).catch(() => null)
  void applyVideo(id, { force: true }).catch(() => null)
  const after = liveActive()
  const playedMid = String((played as { mid?: string } | null)?.mid || '')
  if (job.kind === 'video' && mid && playedMid && playedMid === mid) {
    return { ok: Boolean(played?.playing || played?.hasVideo || played?.ok), stepped, played }
  }
  if (job.kind === 'video' && mid && playedMid && playedMid !== mid) {
    return {
      ok: false,
      mismatched: true,
      hasVideo: Boolean(played?.hasVideo),
      playing: Boolean(played?.playing),
      wanted: label || `视频${videoIndex}`,
      actual: after?.label || playedMid,
      stepped,
      played,
      hint: `要点${label || `视频${videoIndex}`}，播起来的是另一条。不要 watch。`,
    }
  }
  if (job.kind === 'video' && (label || videoIndex) && after && !onRequested()) {
    return {
      ok: false,
      mismatched: true,
      hasVideo: true,
      playing: Boolean(played?.playing),
      wanted: label || `视频${videoIndex}`,
      actual: after.label,
      stepped,
      played,
      hint: `要点${label || `视频${videoIndex}`}，播起来的是${after.label}${after.jobDone ? '（已完成）' : ''}。不要 watch。`,
    }
  }
  return { ok: Boolean(played?.playing || played?.hasVideo || played?.ok), stepped, played }
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
