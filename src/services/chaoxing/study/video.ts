import {
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

export const playChaoxingVideo = async (id: string) => {
  if (await readChaoxingCaptcha(id)) {
    return { captcha: true, hasVideo: false, playing: false, hint: CAPTCHA_HINT }
  }
  const tab = await evalBrowserView(id, CHAOXING_CLICK_VIDEO_TAB).catch(() => null) as {
    quiz?: boolean
    step?: string
    ok?: boolean
    already?: boolean
  } | null
  if (tab?.quiz) {
    return { quiz: true, step: tab.step || '', hasVideo: false, playing: false, hint: '当前是测验/作业，停下让用户自己做' }
  }
  if (tab?.ok && !tab.already) {
    await waitMs(800)
  }
  let last: Record<string, unknown> = {}
  let baseline = -1
  let sawPlayer = false
  for (let i = 0; i < 8; i += 1) {
    last = asObject(await evalBrowserView(id, CHAOXING_PLAY_SCRIPT))
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
      hint: '播放器在，但视频没有真正播起来。再 browser_chaoxing_play，不要说正在播放。',
    }
  }
  return {
    hasVideo: false,
    playing: false,
    title: info?.current || '',
    hint: '当前节没有视频（可能是资料/PDF）。用 browser_chaoxing_next 跳到下一节视频，不要停。',
  }
}

export const readChaoxingVideo = (id: string) =>
  evalBrowserView(id, CHAOXING_STUDY_INSPECT) as Promise<ChaoxingVideoInfo | null>

export const installChaoxingVideoHook = (id: string) =>
  evalBrowserView(id, CHAOXING_VIDEO_HOOK) as Promise<ChaoxingVideoTick | { hooked?: boolean; hasVideo?: boolean } | null>

export const readChaoxingVideoTick = (id: string) =>
  evalBrowserView(id, CHAOXING_VIDEO_TICK) as Promise<ChaoxingVideoTick | null>