import { getCurrentWindow } from '@tauri-apps/api/window'
import { browserAutomationEpoch, userControlsBrowser, withBrowserAutomation } from '../../browser/control'
import { actOnceOnBrowser } from '../../browser/engine'
import { evalBrowserViewInFrame, waitMs } from '../../browser/eval'
import { callProtocol } from '../../browser/protocol'
import { startChaoxingWatch } from '../../chaoxing/browser/watch'
import { readStudentChapter, readStudentChapterCard, sameStudentChapterPage } from '../../chaoxing/host/chapterTasks'
import { asVideoTick, pinChaoxingPlayMid, videoIsPlaying } from '../../chaoxing/study/video'
import type { WebsiteMediaControls } from '../../browser/websiteChapterRules'
import type { ChaoxingVideoTick } from '../../chaoxing/study/types'

const foreground = `(function(){return { visible: document.visibilityState === 'visible', focused: document.hasFocus() }})()`
const focusHint = '学习通要求观看时保持页面在前台。回到当前小节后继续播放。'

// Use the player's own button when resuming, so the read-only preview
// doesn't need to move the mouse or make the control bar visible first.
const resumeControl = (rules: WebsiteMediaControls) => `(function(rules){
  const players = document.querySelectorAll(rules.media)
  if (players.length !== 1) return false
  const media = players[0]
  if (!media.paused) return 'playing'
  if (media.ended || media.error) return false
  const player = media.closest(rules.box)
  const control = rules.controls.map(selector => player?.querySelector(selector)).find(Boolean)
  if (!control || control.disabled || control.getAttribute('aria-disabled') === 'true') return false
  control.click()
  return 'clicked'
})(${JSON.stringify(rules)})`

async function playChapterVideo(
  browserId: string, mid: string, stillCurrent: () => Promise<boolean>, rules: WebsiteMediaControls, recovery?: { focusRequired: boolean },
) {
  const readVideo = () => callProtocol(browserId, 'media_tick', { mid }).catch(() => null)
  const playing = (tick: Awaited<ReturnType<typeof readVideo>>) => tick?.mid === mid && videoIsPlaying(tick)
  const fail = (reason: string, error: string, dispatched = false) => ({ ok: false as const, reason, error, dispatched })
  let tick = await readVideo()
  for (let attempt = 0; !recovery && tick?.mid !== mid && attempt < 3; attempt++) {
    await waitMs(250)
    tick = await readVideo()
  }
  if (tick?.mid === mid && tick.ended === true) {
    return {
      ok: true as const, status: 'awaiting_credit' as const,
      hint: '视频已播完。等待平台登记这个任务点，再用 browser_review_chapter 复核。',
    }
  }

  let dispatched = false
  if (!playing(tick)) {
    if (tick?.mid !== mid || !tick.frameId || !tick.loaderId || tick.paused !== true) {
      return fail('not_found', '指定任务点的播放器还未就绪。请核对视频所在页面。')
    }
    const frame = { frameId: String(tick.frameId), loaderId: String(tick.loaderId) }
    if (recovery?.focusRequired) {
      const appFocused = await Promise.resolve().then(() => getCurrentWindow().isFocused()).catch(() => null)
      const page = await evalBrowserViewInFrame(browserId, foreground, '', frame).catch(() => null)
      if (page?.visible !== true || !(appFocused ?? page.focused)) {
        return { ok: true as const, status: 'needs_foreground' as const, hint: focusHint }
      }
    }

    if (!await stillCurrent()) return fail('stale', '当前章节已切换，请重新复核。')
    if (recovery) {
      const result = await evalBrowserViewInFrame(browserId, resumeControl(rules), '', frame).catch(() => false)
      if (result !== 'clicked' && result !== 'playing') return fail('not_found', '原视频的续播控件不可用。')
      dispatched = result === 'clicked'
    } else {
      const clicked = await actOnceOnBrowser(browserId, {
        by: 'css', value: rules.controls.join(', '),
        nth: 1, ...frame,
      }, 'click')
      dispatched = clicked.dispatched
      if (!clicked.ok) return fail('invalid', '指定视频的播放按钮未确认触发，请复核页面。', dispatched)
    }
    for (let attempt = 0; attempt < 4; attempt++) {
      await waitMs(400)
      tick = await readVideo()
      if (playing(tick)) break
    }
  }

  const confirmed = asVideoTick(tick)
  if (!playing(tick) || !confirmed || !await stillCurrent()) {
    return fail('stale', '未确认指定视频在当前章节播放。先复核页面，再继续。', dispatched)
  }
  return { ok: true as const, status: 'playing' as const, tick: confirmed }
}

function registerChapterWatch(
  browserId: string, sessionId: string, tick: ChaoxingVideoTick, mid: string, title: string,
  stillCurrent: () => Promise<boolean>, focusRequired: boolean, rules: WebsiteMediaControls,
) {
  const epoch = browserAutomationEpoch(browserId)
  pinChaoxingPlayMid(browserId, mid)
  startChaoxingWatch(browserId, sessionId, { ...tick, title, mid }, {
    recoverPause: async isActive => {
      const ownsPlayback = () => isActive() && !userControlsBrowser(sessionId)
      const canResume = async () => ownsPlayback() && await stillCurrent() && ownsPlayback()
      const attemptPlayback = () => playChapterVideo(browserId, mid, canResume, rules, { focusRequired })
      for (let attempt = 0; attempt < 12 && ownsPlayback(); attempt++) {
        const resumed = await (epoch == null ? attemptPlayback() : withBrowserAutomation(browserId, epoch, attemptPlayback))
        if (resumed.ok === false) return null
        if (resumed.status === 'playing') return resumed.tick
        if (resumed.status !== 'needs_foreground') return null
        await waitMs(1500)
      }
      return null
    },
  })
}

export async function watchExistingChapterVideo(browserId: string, sessionId: string, tick: ChaoxingVideoTick | null) {
  if (!tick?.mid || !videoIsPlaying(tick)) return false
  const chapter = await readStudentChapterCard(browserId)
  const jobs = chapter?.jobs?.filter(job => job.kind === 'video' && job.mid === tick.mid)
  if (jobs?.length !== 1) return false
  const job = jobs[0]
  registerChapterWatch(browserId, sessionId, tick, job.mid, job.name || chapter.header.title,
    async () => Boolean(sameStudentChapterPage(await readStudentChapter(browserId), chapter)), job.focusRequired, chapter.rules.player)
  return true
}

export async function watchChapterVideo(
  browserId: string, sessionId: string, mid: string, title: string,
  stillCurrent: () => Promise<boolean>, rules: WebsiteMediaControls, focusRequired = false,
) {
  // Before the initial native click the preview can be visible while chat holds focus.
  const result = await playChapterVideo(browserId, mid, stillCurrent, rules)
  if (result.ok === false || result.status !== 'playing') return result
  registerChapterWatch(browserId, sessionId, result.tick, mid, title, stillCurrent, focusRequired, rules)
  return {
    ok: true as const, status: 'watching' as const,
    hint: '已监控指定视频，本轮直接用 browser_finish(watching) 等待事件。',
  }
}
