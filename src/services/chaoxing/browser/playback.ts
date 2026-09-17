import { chapterStateFor } from './chapters'
import { formatVideoClock, startChaoxingWatch, videoWatchFor } from './watch'

export type LiveStudyPlayback = {
  playing: boolean
  watching: boolean
  paused: boolean
  ended: boolean
  title: string
  current: number
  duration: number
}

const VIDEO_FRESH_MS = 12_000

export const liveStudyPlayback = (browserId?: string): LiveStudyPlayback => {
  const id = String(browserId || '').trim()
  const empty: LiveStudyPlayback = {
    playing: false,
    watching: false,
    paused: false,
    ended: false,
    title: '',
    current: 0,
    duration: 0,
  }
  if (!id) return empty

  const watch = videoWatchFor(id)
  if (watch && (watch.status === 'watching' || watch.status === 'paused' || watch.status === 'stalled')) {
    return {
      playing: watch.status === 'watching' && !watch.paused,
      watching: true,
      paused: Boolean(watch.paused),
      ended: Boolean(watch.ended),
      title: watch.title || '',
      current: watch.current,
      duration: watch.duration,
    }
  }

  const chapters = chapterStateFor(id)
  const video = chapters?.video
  const job = (chapters?.jobs || []).find((item) => (
    item.kind === 'video' && (item.active || Number(item.current) > 0 || Number(item.duration) > 1)
  ))
  const current = Number(video?.current ?? job?.current) || 0
  const duration = Number(video?.duration ?? job?.duration) || 0
  const ended = Boolean(video?.ended || (duration > 1 && current >= duration - 1))
  const paused = video ? Boolean(video.paused) : job?.paused !== false
  const fresh = !video || Date.now() - video.updatedAt < VIDEO_FRESH_MS
  const playing = Boolean(fresh && duration > 1 && !ended && !paused)

  return {
    playing,
    watching: false,
    paused,
    ended,
    title: video?.title || chapters?.currentTitle || job?.label || '',
    current,
    duration,
  }
}

export const ensureStudyWatch = (browserId: string, sessionId: string, seed?: LiveStudyPlayback) => {
  const live = seed || liveStudyPlayback(browserId)
  if (!live.playing) return { ...live, watching: false }
  if (videoWatchFor(browserId)) return { ...live, watching: true }
  const jobs = chapterStateFor(browserId)?.jobs || []
  const active = jobs.find((item) => item.kind === 'video' && item.active)
    || jobs.find((item) => item.kind === 'video' && Number(item.current) > 0)
  startChaoxingWatch(browserId, sessionId, {
    current: live.current,
    duration: live.duration,
    paused: false,
    ended: live.ended,
    title: live.title,
    mid: String(active?.mid || ''),
    videoIndex: active ? jobs.filter((item) => item.kind === 'video').indexOf(active) + 1 : 0,
    videoCount: jobs.filter((item) => item.kind === 'video').length,
  })
  return { ...live, watching: true }
}

export const playbackContextLine = (live: LiveStudyPlayback) => {
  if (!(live.duration > 1) && !live.watching && !live.playing) return ''
  const title = live.title || '当前节'
  const clock = live.duration > 0
    ? ` ${formatVideoClock(live.current)} / ${formatVideoClock(live.duration)}`
    : ''
  if (live.playing) {
    return `【播放】「${title}」确认在播${clock}。已交给监控。不要 reload，不要 get_page 空转，不要再 play。接着 browser_wait 等面板事件。`
  }
  if (live.watching && live.paused) {
    return `【播放】监控中「${title}」已暂停${clock}。立刻 browser_study_play。`
  }
  if (live.ended) {
    return `【播放】「${title}」刚播完${clock}。等系统切下一个，不要 reload。`
  }
  return ''
}
