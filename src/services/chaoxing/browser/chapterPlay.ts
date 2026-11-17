/** 面板开章 / 点任务点。状态写入 chapterSync.ts。 */
import { waitMs } from '../../browser/eval'
import { kickParserClock, kickParserClockSoon } from '../../browser/pageClock'
import { stopChaoxingWatch } from './watch'
import { clearAbstractionDrill } from '../../browser/abstractions'
import {
  CHAPTER_PARSER_ENABLED,
  openChaoxingChapter,
  parseChaoxingChapters,
  tapChaoxingPlay,
  pauseChaoxingVideo,
  clickChaoxingStep,
  readChaoxingChapterTick,
  readChaoxingVideoTick,
  videoIsPlaying,
  videoTickHasPlayer,
  installChaoxingVideoHook,
  liveStudyHref,
  waitForStudentStudyPage,
  waitForStudyPlayerReady,
  type OpenChapterHint,
} from '../study'
import { titlesMatch } from './chapterMatch'
import type { ChapterItem, ChapterJobItem, ChapterParseState } from './chapterTypes'
import {
  applySnap,
  applyVideo,
  publishPlayerJobs,
  browserChapterStates,
  chapterStateFor,
  preferVideoUntil,
  refreshChapterJobsSoon,
  snapHasData,
  startChaoxingChapterParser,
} from './chapterSync'

export const openChapterFromCard = async (
  browserId: string,
  target: Pick<ChapterItem, 'title' | 'index' | 'chapterId' | 'href' | 'studyHref'>,
) => {
  const id = String(browserId || '').trim()
  const title = String(target.title || '').trim()
  if (!id || (!title && !target.chapterId && !target.index)) return { ok: false, error: '缺少节名' }
  clearAbstractionDrill(id)
  stopChaoxingWatch(id)
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
  kickParserClockSoon(id)
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
  void kickParserClock(id)
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
  void kickParserClock(id)
  const after = liveActive()
  const playedMid = String((played as { mid?: string } | null)?.mid || '')
  if (job.kind === 'video' && mid && playedMid && playedMid === mid) {
    return {
      ok: Boolean(played?.playing),
      stepped,
      played,
      hint: played?.playing ? undefined : '播放器在，但视频没有播起来。再点一次。',
    }
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
  return {
    ok: Boolean(played?.playing || (job.kind !== 'video' && (played?.hasVideo || played?.ok))),
    stepped,
    played,
    hint: job.kind === 'video' && !played?.playing
      ? '播放器在，但视频没有播起来。再点一次。'
      : undefined,
  }
}

export const refreshChapterCard = async (browserId: string) => {
  const id = String(browserId || '').trim()
  if (!id || !CHAPTER_PARSER_ENABLED) return chapterStateFor(id)
  startChaoxingChapterParser(id)
  const cached = await readChaoxingChapterTick(id).catch(() => null)
  const snap = snapHasData(cached) ? cached : await parseChaoxingChapters(id).catch(() => null)
  if (snap) applySnap(id, snap)
  if (chapterStateFor(id)?.kind === 'player') {
    await publishPlayerJobs(id).catch(() => null)
    await applyVideo(id, { force: true }).catch(() => null)
  }
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
