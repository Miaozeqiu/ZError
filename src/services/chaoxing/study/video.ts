import {
  CHAOXING_CHAPTER_JOB_TICK,
  CHAOXING_CLICK_STEP,
  CHAOXING_CLICK_VIDEO_TAB,
  CHAOXING_PLAY_SCRIPT,
  CHAOXING_STUDY_INSPECT,
  CHAOXING_VIDEO_HOOK,
  CHAOXING_VIDEO_TICK,
} from '../../browser/skills/chaoxingStudy'
import { asObject, evalBrowserView, waitMs } from '../../browser/eval'
import { CAPTCHA_HINT, readChaoxingCaptcha } from './captcha'
import type { ChaoxingVideoInfo, ChaoxingVideoTick } from './types'

const asVideoTick = (value: ChaoxingVideoTick | Record<string, unknown> | null | undefined): ChaoxingVideoTick | null => {
  if (!value) return null
  const duration = Number(value.duration) || 0
  const current = Number(value.current) || 0
  return {
    current,
    duration,
    paused: Boolean(value.paused),
    ended: Boolean(value.ended),
    ready: Number(value.ready) || 0,
    src: String(value.src || ''),
  }
}

const tickLooksLikeVideo = (tick: ChaoxingVideoTick | null | undefined) => {
  if (!tick) return false
  const duration = Number(tick.duration) || 0
  const current = Number(tick.current) || 0
  if (duration <= 1) return false
  if (tick.ended) return false
  if (current >= duration - 1.5) return false
  return true
}

export const videoIsPlaying = (tick: ChaoxingVideoTick | Record<string, unknown> | null | undefined) => {
  const snap = asVideoTick(tick)
  return Boolean(tickLooksLikeVideo(snap) && snap && snap.paused === false)
}

/** 点开本节某个任务点（优先 videoIndex / mid，标签常重名） */
export const clickChaoxingStep = async (
  id: string,
  want: string | {
    label?: string
    mid?: string
    jobid?: string
    videoIndex?: number
    index?: number
  },
) => {
  const payload = typeof want === 'string' || typeof want === 'number'
    ? { label: String(want || '').trim() }
    : {
        label: String(want?.label || '').trim(),
        mid: String(want?.mid || '').trim(),
        jobid: String(want?.jobid || '').trim(),
        videoIndex: Number(want?.videoIndex) || 0,
        index: Number(want?.index) || 0,
      }
  if (!payload.label && !payload.mid && !payload.jobid && !payload.videoIndex && !payload.index) {
    return { ok: false, error: '缺少任务点' }
  }
  const moved = asObject(await evalBrowserView(id, `${CHAOXING_CLICK_STEP()}(${JSON.stringify(payload)})`).catch(() => null))
  if (moved.ok && !moved.already) await waitMs(700)
  return moved
}

/** 对齐 ocs：已点到任务点后只播当前 attachment，不要再点「第一个未完成视频」 */
export const playChaoxingVideo = async (
  id: string,
  opts?: { skipTabClick?: boolean; videoIndex?: number; mid?: string; jobid?: string; label?: string },
) => {
  if (await readChaoxingCaptcha(id)) {
    return { captcha: true, hasVideo: false, playing: false, hint: CAPTCHA_HINT }
  }
  for (let i = 0; i < 5; i += 1) {
    const ready = asVideoTick(await readChaoxingVideoTick(id).catch(() => null))
    if (tickLooksLikeVideo(ready)) break
    await waitMs(600)
  }
  const videoIndex = Number(opts?.videoIndex) || 0
  const mid = String(opts?.mid || '').trim()
  const jobid = String(opts?.jobid || '').trim()
  const label = String(opts?.label || '').trim()
  if (videoIndex > 0 || mid || jobid || label) {
    const stepped = await clickChaoxingStep(id, { videoIndex, mid, jobid, label })
    if (stepped.quiz) {
      return { quiz: true, step: String(stepped.step || ''), hasVideo: false, playing: false, hint: '当前是章节测验。系统会按 ocs 流程自动搜题/随机/暂存' }
    }
    if (!stepped.ok) {
      return { hasVideo: false, playing: false, error: String(stepped.error || '切换任务点失败'), stepped }
    }
    if (!stepped.already) await waitMs(500)
  } else if (!opts?.skipTabClick) {
    const tab = await evalBrowserView(id, CHAOXING_CLICK_VIDEO_TAB()).catch(() => null) as {
      quiz?: boolean
      step?: string
      ok?: boolean
      already?: boolean
    } | null
    if (tab?.quiz) {
      return { quiz: true, step: tab.step || '', hasVideo: false, playing: false, hint: '当前是章节测验。系统会按 ocs 流程自动搜题/随机/暂存' }
    }
    if ((tab as { done?: boolean } | null)?.done) {
      return {
        hasVideo: false,
        playing: false,
        jobDone: true,
        chapterVideosDone: true,
        hint: '本节视频任务点已完成（ans-job-icon-clear）。用 browser_study_next 进下一节或测验。',
      }
    }
    if (tab?.ok && !tab.already) {
      await waitMs(800)
    }
  }
  const evalPlay = async () => {
    try {
      return asObject(await evalBrowserView(id, CHAOXING_PLAY_SCRIPT()))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/超时|timeout/i.test(message)) return {}
      throw error
    }
  }
  await installChaoxingVideoHook(id).catch(() => null)
  let last: Record<string, unknown> = {}
  let baseline = -1
  let sawPlayer = false
  for (let i = 0; i < 6; i += 1) {
    last = await evalPlay()
    const tick = asVideoTick(await readChaoxingVideoTick(id).catch(() => null)) || asVideoTick(last)
    if (tickLooksLikeVideo(tick)) {
      sawPlayer = true
      if (tick && tick.paused === false) {
        if (baseline < 0) {
          baseline = tick.current
        } else if (tick.current >= baseline + 0.2) {
          const info = await readChaoxingVideo(id).catch(() => null)
          return {
            page: last.page || 'player',
            hasVideo: true,
            playing: true,
            paused: false,
            ended: false,
            current: tick.current,
            duration: tick.duration,
            title: info?.current || '',
            next: info?.next || '',
            jobDone: info?.jobDone ?? null,
            moreVideos: Boolean(info?.moreVideos),
            videoCount: Number(info?.videoCount) || 0,
            videoIndex: Number(info?.videoIndex) || 0,
            step: info?.step || '',
          }
        }
      }
    }
    await waitMs(800)
  }
  const tick = asVideoTick(await readChaoxingVideoTick(id).catch(() => null)) || asVideoTick(last)
  const info = await readChaoxingVideo(id).catch(() => null)
  if (sawPlayer || tickLooksLikeVideo(tick)) {
    return {
      page: last.page || 'player',
      hasVideo: true,
      playing: false,
      paused: tick?.paused !== false,
      ended: Boolean(tick?.ended),
      current: tick?.current || 0,
      duration: tick?.duration || 0,
      title: info?.current || '',
      next: info?.next || '',
      jobDone: info?.jobDone ?? null,
      moreVideos: Boolean(info?.moreVideos),
      videoCount: Number(info?.videoCount) || 0,
      videoIndex: Number(info?.videoIndex) || 0,
      step: info?.step || '',
      hint: '播放器在，但视频没有真正播起来。再 browser_study_play，不要说正在播放。',
    }
  }
  const hasVideoStep = Array.isArray(info?.steps) && info.steps.some((step) => step.video)
  if (hasVideoStep || last.page === 'player' || last.hasVideo || last.clickedPlay) {
    return {
      page: last.page || 'player',
      hasVideo: true,
      playing: false,
      paused: true,
      title: info?.current || '',
      next: info?.next || '',
      step: info?.step || '',
      hint: '已在播放页，播放器还没挂稳。再 browser_study_play，禁止 next / get_page。这不是资料。',
    }
  }
  return {
    hasVideo: false,
    playing: false,
    retry: true,
    title: info?.current || '',
    hint: '还没读到播放器。再 browser_study_play，禁止 next。只有 inspect 确认是资料才 next。',
  }
}

export const readChaoxingVideo = (id: string) =>
  evalBrowserView(id, CHAOXING_STUDY_INSPECT()) as Promise<ChaoxingVideoInfo | null>

export const installChaoxingVideoHook = (id: string) =>
  evalBrowserView(id, CHAOXING_VIDEO_HOOK()) as Promise<ChaoxingVideoTick | { hooked?: boolean; hasVideo?: boolean } | null>

export const readChaoxingVideoTick = (id: string) =>
  evalBrowserView(id, CHAOXING_VIDEO_TICK()) as Promise<ChaoxingVideoTick | null>

export const readChaoxingChapterJobTick = (id: string) =>
  evalBrowserView(id, CHAOXING_CHAPTER_JOB_TICK()) as Promise<{
    jobs?: Array<{
      mid?: string
      jobid?: string
      label: string
      kind?: string
      video?: boolean
      quiz?: boolean
      doc?: boolean
      jobDone?: boolean | null
      passed?: boolean
      unfinished?: boolean
      active?: boolean
    }>
    video?: ChaoxingVideoTick | null
    ts?: number
  } | null>