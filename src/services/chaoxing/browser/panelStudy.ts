/** 面板点播放 / 下一节。Agent 经 adapter 进来，不要从 chat.ts 直调。 */
import { startChaoxingChapterParser } from './chapters'
import {
  applyVideo,
  chapterStateFor,
  findChapterInPanel,
  ingestChapterSnap,
  isCatalogSectionTitle,
  openChapterFromCard,
  playChapterFromCard,
  playChapterJobFromCard,
  refreshChapterCard,
  waitForChapterState,
  type ChapterItem,
  type ChapterJobItem,
} from './chapters'
import { liveStudyHref, parseChaoxingChapters, waitForStudyPlayerReady } from '../study'
import { pauseChaoxingVideo, readChaoxingVideoTick, tapChaoxingPlay, videoTickHasPlayer } from '../study/video'
import { waitMs } from '../../browser/eval'
import { kickParserClock } from '../../browser/pageClock'

const hrefChapterId = (href: string) => (
  ((String(href || '').match(/[?&](?:chapterId|chapterid|knowledgeid)=(\d+)/i) || [])[1] || '').replace(/\D/g, '')
)

const SKIP_CHAPTER = /资料|讨论|问卷/

/** 当前节后面的下一节。当前节只剩测验时仍算「当前」，不能再当成下一节打开。 */
export const pickNextStudyChapter = (
  sections: Array<{ title: string; unfinished?: boolean; active?: boolean; chapterId?: string; kind?: string }>,
  here: { chapterId?: string; title?: string },
) => {
  const list = sections.filter((item) => item.kind !== 'chapter')
  const urlId = String(here.chapterId || '').replace(/\D/g, '')
  const title = String(here.title || '').trim()
  const idx = list.findIndex((item) => (
    Boolean(item.active)
    || Boolean(urlId && String(item.chapterId || '').replace(/\D/g, '') === urlId)
    || Boolean(title && (item.title === title || item.title.includes(title) || title.includes(item.title)))
  ))
  const later = idx >= 0
    ? list.slice(idx + 1)
    : list.filter((item) => !(urlId && String(item.chapterId || '').replace(/\D/g, '') === urlId))
  return later.find((item) => (
    item.unfinished && !SKIP_CHAPTER.test(item.title) && isCatalogSectionTitle(item.title)
  )) || later.find((item) => (
    !SKIP_CHAPTER.test(item.title) && isCatalogSectionTitle(item.title)
  )) || null
}

const asSection = (item: ChapterItem | null | undefined) => (
  item && item.kind !== 'chapter' ? item : null
)

const panelJobs = (id: string) => chapterStateFor(id)?.jobs || []

export type AgentPanelEvent = 'quiz_left' | 'chapter_jobs_done' | 'need_video' | 'video_paused' | 'empty'

export const decidePanelEvent = (
  jobs: Array<{ kind: string; jobDone: boolean; paused?: boolean; active?: boolean }>,
): AgentPanelEvent => {
  if (!jobs.length) return 'empty'
  const left = jobs.filter((job) => !job.jobDone)
  const leftVideos = left.filter((job) => job.kind === 'video')
  if (!left.length) return 'chapter_jobs_done'
  if (!leftVideos.length && left.some((job) => job.kind === 'quiz')) return 'quiz_left'
  if (jobs.some((job) => job.kind === 'video' && job.active && !job.jobDone && job.paused === true)) {
    return 'video_paused'
  }
  return 'need_video'
}

/** 先动当前激活的未完成任务点，不要在视频2暂停时回头播视频1。 */
export const pickPanelActionJob = <T extends { kind: string; jobDone: boolean; active?: boolean }>(
  jobs: T[],
): T | null => {
  const left = jobs.filter((job) => !job.jobDone)
  return left.find((job) => job.active) || left[0] || null
}

const jobMark = (job: { label: string; jobDone: boolean; active?: boolean; paused?: boolean; kind?: string }) => (
  `${job.label}${job.jobDone ? '已完成' : '未完成'}${job.active ? '·当前' : ''}${job.kind === 'video' && job.paused ? '·暂停' : ''}`
)

export const packAgentPanel = (browserId: string) => {
  const raw = readPanelStudy(browserId)
  if (!raw) return null
  const jobs = raw.jobs || []
  const event = decidePanelEvent(jobs)
  const left = jobs.filter((job) => !job.jobDone)
  const done = jobs.filter((job) => job.jobDone)
  const nextJob = pickPanelActionJob(jobs)
  const unfinishedSections = (raw.unfinished || []).filter((title) => isCatalogSectionTitle(title))
    const hint = event === 'quiz_left'
    ? `本节视频都已完成，还剩${left.map((job) => job.label).join('、')}。读取页面并完成剩余任务；用户明确要求跳过时遵守用户的范围。`
    : event === 'chapter_jobs_done'
      ? '本节任务点都已完成'
      : event === 'video_paused'
        ? `视频暂停，当前任务点 ${nextJob?.label || '视频'}`
        : event === 'need_video'
          ? `下一未完成任务点 ${nextJob?.label || '视频'}`
          : (raw.chapters?.length
            ? '已读到目录'
            : '解析面板还没读到目录')
  return {
    via: 'panel' as const,
    event,
    thisSection: {
      title: raw.current || raw.currentTitle || '',
      jobs: jobs.map((job) => ({
        label: job.label,
        kind: job.kind,
        done: Boolean(job.jobDone),
        active: Boolean(job.active),
        percent: job.percent,
        current: job.current,
        duration: job.duration,
        paused: job.paused,
      })),
      next: nextJob ? { label: nextJob.label, kind: nextJob.kind } : null,
    },
    jobLine: jobs.length ? jobs.map(jobMark).join(' · ') : '',
    doneJobs: done.map((job) => job.label),
    leftJobs: left.map((job) => job.label),
    unfinishedSections: unfinishedSections.slice(0, 24),
    unfinishedCount: raw.unfinishedCount,
    progress: raw.progress,
    current: raw.current || raw.currentTitle || '',
    chapters: (raw.chapters || [])
      .filter((item) => item.kind !== 'chapter' && (item.unfinished || item.active))
      .slice(0, 40)
      .map((item) => ({
        title: item.title,
        unfinished: item.unfinished,
        active: Boolean(item.active),
      })),
    hint,
  }
}

/** 每轮对话塞给 Agent 的面板数据，不含下一步命令。 */
export const formatStudyPanelNudge = (browserId: string) => {
  const panel = packAgentPanel(browserId)
  if (!panel?.jobLine && !panel?.current) return ''
  return `【面板】${JSON.stringify({
    current: panel.current || panel.thisSection.title || '',
    event: panel.event,
    jobs: panel.jobLine,
    left: panel.leftJobs,
    done: panel.doneJobs,
  })}`
}

const resolveChapter = (id: string, chapterId?: string) => {
  const state = chapterStateFor(id)
  const current = String(state?.currentTitle || state?.current || '').trim()
  const byId = chapterId ? asSection(findChapterInPanel(id, { chapterId })) : null
  return byId
    || asSection(findChapterInPanel(id, {}))
    || (current ? asSection(findChapterInPanel(id, { title: current })) : null)
    || (current ? { title: current, jobs: 0, unfinished: true, active: true, chapterId } : null)
}

const agentPanel = (id: string) => packAgentPanel(id)

const videoOrd = (jobs: ChapterJobItem[], job: ChapterJobItem) => {
  let n = 0
  for (const item of jobs) {
    if (item.kind !== 'video') continue
    n += 1
    if (item === job) return n
  }
  return 0
}

export const readPanelStudy = (browserId: string) => {
  const state = chapterStateFor(browserId)
  if (!state) return null
  const active = state.chapters.find((item) => item.active && item.kind !== 'chapter')
    || state.chapters.find((item) => item.active)
  return {
    via: 'panel' as const,
    kind: state.kind,
    page: state.page,
    current: state.currentTitle || state.current,
    currentTitle: state.currentTitle || state.current,
    progress: state.progress,
    unfinished: state.unfinished,
    unfinishedCount: state.unfinishedCount,
    jobs: state.jobs.map((job) => ({
      label: job.label,
      kind: job.kind,
      jobDone: job.jobDone,
      unfinished: job.unfinished,
      active: job.active,
      paused: job.paused,
      mid: job.mid,
      percent: job.percent,
      current: job.current,
      duration: job.duration,
    })),
    chapters: state.chapters.map((item) => ({
      title: item.title,
      index: item.index,
      chapterId: item.chapterId,
      unfinished: item.unfinished,
      active: item.active,
      kind: item.kind,
      jobs: item.jobs,
    })),
    activeChapter: active ? {
      title: active.title,
      index: active.index,
      chapterId: active.chapterId,
    } : null,
    video: state.video,
    status: state.status,
  }
}

export const ensurePanelStudy = async (browserId: string) => {
  const id = String(browserId || '').trim()
  startChaoxingChapterParser(id)
  const refreshed = await refreshChapterCard(id).catch(() => chapterStateFor(id))
  if (refreshed?.chapters.length) return refreshed
  const ready = await waitForChapterState(id, 800)
  if (ready?.chapters.length) return ready
  return chapterStateFor(id)
}

export const openPanelChapter = async (
  browserId: string,
  want: { title?: string; index?: string; chapterId?: string },
) => {
  const id = String(browserId || '').trim()
  const chapter = findChapterInPanel(id, want)
  if (chapter) {
    const opened = await openChapterFromCard(id, chapter)
    return {
      ok: Boolean(opened?.ok),
      opened,
      chapter: { title: chapter.title, index: chapter.index, chapterId: chapter.chapterId },
      panel: agentPanel(id),
      via: 'panel',
    }
  }
  const { openChaoxingChapter } = await import('../study/chapters')
  const opened = await openChaoxingChapter(
    id,
    String(want.title || want.index || ''),
    { chapterId: String(want.chapterId || '') },
  )
  return {
    ok: Boolean(opened?.ok),
    opened,
    chapter: {
      title: want.title || '',
      index: want.index || '',
      chapterId: want.chapterId || '',
    },
    panel: agentPanel(id),
    via: 'catalog',
  }
}

const pickJob = (
  jobs: ChapterJobItem[],
  opts: { videoIndex?: number; label?: string; skipIfDone?: boolean },
) => {
  const label = String(opts.label || '').trim()
  const videoIndex = Number(opts.videoIndex) || 0
  if (label) {
    const hit = jobs.find((job) => job.label === label)
      || jobs.find((job) => job.label.includes(label) || label.includes(job.label))
    if (hit) return hit
  }
  if (videoIndex > 0) {
    let n = 0
    for (const job of jobs) {
      if (job.kind !== 'video') continue
      n += 1
      if (n === videoIndex) return job
    }
  }
  if (opts.skipIfDone) {
    return jobs.find((job) => job.kind === 'video' && !job.jobDone)
      || jobs.find((job) => job.kind === 'quiz' && !job.jobDone)
      || null
  }
  return jobs.find((job) => job.active)
    || jobs.find((job) => job.kind === 'video')
    || null
}

/** 刷课只播还没完成的视频。指定已完成的「视频1」时改播下一条未完成，没有就交给 next。 */
export const pickPlayableJob = (
  jobs: ChapterJobItem[],
  opts?: { videoIndex?: number; label?: string; skipIfDone?: boolean },
) => {
  const leftVideo = () => (
    jobs.find((job) => job.kind === 'video' && !job.jobDone && job.active)
    || jobs.find((job) => job.kind === 'video' && !job.jobDone)
    || null
  )
  const picked = pickJob(jobs, { videoIndex: opts?.videoIndex, label: opts?.label })
  if (opts?.videoIndex || opts?.label) {
    if (picked?.kind === 'video' && (!picked.jobDone || opts.skipIfDone === false)) return picked
    if (picked?.kind === 'quiz' && /测验|作业/.test(String(opts.label || ''))) return picked
    // 点名的已完成：本节还有没看完的就改播它；本节都完了回 null，由调用方报 alreadyDone，不许偷跳下一节
    return leftVideo()
  }
  return leftVideo()
}

const packPlayed = (result: Record<string, unknown> | null | undefined) => {
  const played = (result?.played && typeof result.played === 'object')
    ? result.played as Record<string, unknown>
    : result || {}
  const packed: Record<string, unknown> = {
    ok: result?.ok !== false,
    via: 'panel',
    quiz: Boolean(result?.quiz || played.quiz),
    doc: Boolean(result?.doc),
    hasVideo: Boolean(played.hasVideo ?? played.ok ?? result?.ok),
    playing: Boolean(played.playing),
    paused: played.paused,
    current: played.current,
    duration: played.duration,
    opened: result?.opened,
    stepped: result?.stepped,
    hint: result?.hint,
    ...played,
  }
  if (result?.ok === false) packed.ok = false
  if (result?.mismatched) packed.mismatched = true
  if (result?.error) packed.error = result.error
  return packed
}

export const playPanelStudy = async (
  browserId: string,
  opts?: {
    action?: 'play' | 'pause'
    title?: string
    index?: string
    chapterId?: string
    videoIndex?: number
    label?: string
    skipIfDone?: boolean
    resume?: boolean
  },
) => {
  const id = String(browserId || '').trim()
  if (opts?.action === 'pause') {
    const paused = await pauseChaoxingVideo(id)
    return { ...paused, via: 'panel', playing: false }
  }
  await ensurePanelStudy(id)
  if (!opts?.videoIndex && !opts?.label && !opts?.title && !opts?.chapterId) {
    if (!videoTickHasPlayer(await readChaoxingVideoTick(id).catch(() => null))) {
      await waitForStudyPlayerReady(id).catch(() => null)
    }
    const played = await tapChaoxingPlay(id)
    void kickParserClock(id)
    return { ...packPlayed(played), via: 'visible', panel: agentPanel(id) }
  }
  const href = await liveStudyHref(id)
  const urlId = hrefChapterId(href)
  const want = {
    title: opts?.title,
    index: opts?.index,
    chapterId: String(opts?.chapterId || '').replace(/\D/g, '') || urlId,
  }
  let chapter = asSection(findChapterInPanel(id, want))
    || resolveChapter(id, urlId)
  if (!chapter && /studentstudy/i.test(href)) {
    chapter = {
      title: String(chapterStateFor(id)?.currentTitle || chapterStateFor(id)?.current || ''),
      jobs: 0,
      unfinished: true,
      active: true,
      chapterId: urlId,
    }
  }
  if (!chapter) {
    const first = (chapterStateFor(id)?.unfinished || []).find((title) => isCatalogSectionTitle(title))
    if (first) chapter = asSection(findChapterInPanel(id, { title: first }))
  }
  if (!chapter) {
    return { ok: false, error: '解析面板还没有可播的小节', panel: agentPanel(id), via: 'panel' }
  }

  const jobs = panelJobs(id)
  const justSwitched = Boolean(chapterStateFor(id)?.expectChapterTitle) || !jobs.some((item) => item.kind === 'video')
  if (justSwitched && !opts?.videoIndex && !opts?.label) {
    if (!videoTickHasPlayer(await readChaoxingVideoTick(id).catch(() => null))) {
      await waitForStudyPlayerReady(id).catch(() => null)
    }
    const played = await tapChaoxingPlay(id)
    void kickParserClock(id)
    return { ...packPlayed(played), via: 'visible', panel: agentPanel(id) }
  }
  const playJob = async (job: ChapterJobItem) => {
    const played = await playChapterJobFromCard(id, chapter, job, {
      videoIndex: job.kind === 'video' ? (videoOrd(jobs, job) || undefined) : undefined,
    }) as Record<string, unknown>
    return { ...packPlayed(played), panel: agentPanel(id) }
  }
  const job = pickPlayableJob(jobs, {
    videoIndex: opts?.videoIndex,
    label: opts?.label,
    skipIfDone: opts?.skipIfDone ?? true,
  })
  if (!job && (opts?.videoIndex || opts?.label)) {
    const named = pickJob(jobs, { videoIndex: opts?.videoIndex, label: opts?.label })
    if (named?.kind === 'video' && named.jobDone) {
      return {
        ok: false,
        alreadyDone: true,
        error: `${named.label || `视频${opts?.videoIndex || ''}`} 已完成，没有播放；要重播请带 skipIfDone=false`,
        job: named.label,
        mid: named.mid,
        via: 'panel',
        panel: agentPanel(id),
      }
    }
  }
  if (job?.kind === 'video') return playJob(job)
  if (jobs.some((item) => item.kind === 'video')) return nextPanelStudy(id)
  if (job) return playJob(job)
  const played = await playChapterFromCard(id, chapter) as Record<string, unknown>
  return { ...packPlayed(played), panel: agentPanel(id) }
}

export const nextPanelStudy = async (browserId: string, opts?: { skipQuiz?: boolean }) => {
  const id = String(browserId || '').trim()
  await ensurePanelStudy(id)
  const state = chapterStateFor(id)
  const chapter = resolveChapter(id)
  const jobs = panelJobs(id)
  const activeAt = jobs.findIndex((job) => job.active)
  const after = activeAt >= 0 ? jobs.slice(activeAt + 1) : jobs
  const nextVideo = after.find((job) => job.kind === 'video' && !job.jobDone)
    || jobs.find((job) => job.kind === 'video' && !job.jobDone && !job.active)
  if (nextVideo && chapter) {
    const played = await playChapterJobFromCard(id, chapter, nextVideo, {
      videoIndex: videoOrd(jobs, nextVideo) || undefined,
    }) as Record<string, unknown>
    return {
      ...packPlayed(played),
      sameChapter: true,
      moreVideos: jobs.some((job) => job.kind === 'video' && !job.jobDone && job !== nextVideo),
      panel: agentPanel(id),
    }
  }

  if (!opts?.skipQuiz && jobs.some((job) => job.kind === 'quiz' && !job.jobDone)) {
    return { ok: false, sameChapter: true, hasVideo: false, via: 'panel',
      hint: '本节还有未完成的测验，请先读取页面并处理；用户明确要求跳过时可直接选择下一节。', panel: agentPanel(id) }
  }
  const href = await liveStudyHref(id)
  const nextChapter = pickNextStudyChapter(state?.chapters || [], {
    chapterId: hrefChapterId(href) || chapter?.chapterId,
    title: String(state?.currentTitle || state?.current || chapter?.title || ''),
  })
  if (!nextChapter) {
    return {
      ok: false,
      chapterDone: true,
      hasVideo: false,
      via: 'panel',
      hint: '解析面板里没有下一个未完成任务点',
      panel: agentPanel(id),
    }
  }
  const opened = await openChapterFromCard(id, nextChapter)
  const started = Date.now()
  while (Date.now() - started < 1800) {
    if (panelJobs(id).some((job) => job.kind === 'video' || job.kind === 'quiz')) break
    await waitMs(160)
  }
  const afterJobs = panelJobs(id)
  return {
    ok: Boolean(opened?.ok),
    sameChapter: false,
    opened: nextChapter.title,
    hasVideo: afterJobs.some((job) => job.kind === 'video'),
    via: 'panel',
    hint: afterJobs.length
      ? `已打开「${nextChapter.title}」，没有自动播。看 thisSection.jobs，用 看快照 指定 videoIndex / label。`
      : `已打开「${nextChapter.title}」，任务点还没出来。再看 thisSection.jobs；仍空再 next。`,
    panel: agentPanel(id),
  }
}
