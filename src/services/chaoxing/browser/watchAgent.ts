import {
  openNextChaoxingChapter,
  playChaoxingVideo,
  readChaoxingVideo,
  videoIsPlaying,
} from '../../browser/appBrowser'
import { solveChaoxingCaptcha } from './captcha'
import {
  formatVideoClock,
  setChaoxingWatchHandler,
  startChaoxingWatch,
  type VideoWatchCheck,
} from './watch'
import type { AgentChatAttachment } from '../../agent/chatTypes'

type WatchNotify = (
  sessionId: string,
  display: string,
  modelText: string,
  files?: AgentChatAttachment[],
) => void
type WatchGate = (sessionId: string) => 'missing' | 'busy' | 'ready'

let notifyWatchImpl: WatchNotify | null = null
let sessionGateImpl: WatchGate | null = null

const pendingCaptchaNotices = new Map<string, string>()
const queuedWatchChecks = new Map<string, VideoWatchCheck>()
const watchCheckRank: Record<VideoWatchCheck['kind'], number> = {
  progress: 1,
  heartbeat: 1,
  stalled: 2,
  lost: 3,
  quiz: 4,
  done: 5,
  captcha: 6,
}

const watchVideoLine = (state: VideoWatchCheck['status']) => {
  if (!(state.videoCount > 1)) return ''
  const index = state.videoIndex || 1
  return ` 本章视频 ${index}/${state.videoCount}${state.moreVideos ? '，后面还有视频' : '，这是最后一个'}`
}

const formatWatchDisplay = (check: VideoWatchCheck) => {
  const title = check.status.title || '当前节'
  if (check.kind === 'done') return `进度检查 · ${title} 已完成`
  if (check.kind === 'captcha') return `进度检查 · 遇到验证码`
  if (check.kind === 'quiz') return `进度检查 · 遇到测验`
  if (check.kind === 'lost') return `进度检查 · ${title} 找不到播放器`
  if (check.kind === 'stalled') return `进度检查 · ${title} 进度卡住`
  if (check.kind === 'heartbeat') return `进度检查 · ${title} 定时核对`
  const clock = `${formatVideoClock(check.status.current)} / ${formatVideoClock(check.status.duration)}`
  return `进度检查 · ${title} ${check.percent}%（${clock}）`
}

const formatWatchPrompt = (check: VideoWatchCheck) => {
  const state = check.status
  const clock = `${formatVideoClock(state.current)} / ${formatVideoClock(state.duration)}`
  const base = `【播放监控】${state.title || '当前节'} ${clock}（${state.percent}%）paused=${state.paused} ended=${state.ended} jobDone=${state.jobDone}${watchVideoLine(state)}`
  if (check.kind === 'captcha') {
    return `${base}\n学习通弹出图片验证码（9010）。图会附上或页面上有 #ccc。立刻认出 4 位并 browser_chaoxing_captcha。不要问用户，不要 browser_wait。提交后再 play 或 study。`
  }
  if (check.kind === 'quiz') {
    return `${base}\n当前是章节测验。系统会按 ocs 流程自动搜题/随机/暂存；若失败再 inspect/guess，然后 browser_chaoxing_next。`
  }
  if (check.kind === 'done') {
    return `${base}\n这个视频已经结束。系统会先切本章下一个视频，没有了再切下一章。一句话即可，不要再点下一节。`
  }
  if (check.kind === 'lost') {
    return `${base}\n播放器丢了或页面不对。立刻 browser_chaoxing_play；还不行就回章节目录 click_text 当前节名再 play。不要问用户，不要 browser_wait。`
  }
  if (check.kind === 'stalled') {
    return `${base}\n进度卡住或暂停了。立刻 browser_chaoxing_play 继续播。不要 browser_wait 空等。`
  }
  if (state.paused || state.status === 'stalled') {
    return `${base}\n视频是暂停或卡住的，没有在播。立刻 browser_chaoxing_play。禁止说正在播放。`
  }
  return `${base}\n定时核对：paused 必须是 false，进度要在走，页面不能弹窗卡住。暂停/卡住立刻 browser_chaoxing_play；播放器没了就回目录点节名再 play；遇到测验就 homework inspect/fill/guess 后继续。确认正常就一句话回报进度，不要 browser_wait，监控还会再叫你。`
}

const advancingBrowsers = new Set<string>()
const recoveringBrowsers = new Set<string>()
const recoverAttempts = new Map<string, number>()

const notifyWatch = (sessionId: string, display: string, modelText: string) => {
  notifyWatchImpl?.(sessionId, display, modelText)
}

const captchaImageFile = (image?: string) => {
  const url = String(image || '').trim()
  if (!url.startsWith('data:image/')) return undefined
  return [{
    kind: 'image' as const,
    filePath: `image:captcha-${Date.now()}`,
    fileName: '验证码.jpg',
    imageUrl: url,
    mimeType: url.startsWith('data:image/png') ? 'image/png' : 'image/jpeg',
  }]
}

const notifyCaptchaWithImage = (sessionId: string, image?: string, error?: string) => {
  pendingCaptchaNotices.delete(sessionId)
  notifyWatchImpl?.(
    sessionId,
    '进度检查 · 遇到验证码',
    `学习通弹出图片验证码（9010）。${error ? `自动识别失败：${error}。` : ''}图已附上。立刻认出 4 位字母或数字，调用 browser_chaoxing_captcha。不要问用户，不要 browser_wait。提交后再 study 或 play。`,
    captchaImageFile(image),
  )
}

const runAfterCaptcha = async <T extends { captcha?: boolean; hint?: string }>(
  sessionId: string,
  browserId: string,
  action: () => Promise<T>,
): Promise<T & { captchaSolved?: boolean; filled?: boolean }> => {
  let result = await action()
  if (!result?.captcha) return result
  const solved = await solveChaoxingCaptcha(browserId)
  if (solved.ok) {
    pendingCaptchaNotices.delete(sessionId)
    result = await action()
    if (!result?.captcha) return { ...result, captchaSolved: true }
  }
  if (solved.image) pendingCaptchaNotices.set(sessionId, solved.image)
  return {
    ...result,
    captcha: true,
    filled: false,
    hint: solved.ok
      ? result.hint
      : `${solved.error || '验证码没自动认出来'}。图会随后附上，立刻认出 4 位并 browser_chaoxing_captcha，然后继续 study。不要问用户。`,
  }
}

const seedFromPlayed = (played: Record<string, unknown>, fallback?: VideoWatchCheck['status']) => ({
  current: Number(played.current) || 0,
  duration: Number(played.duration) || 0,
  paused: Boolean(played.paused),
  ended: Boolean(played.ended),
  title: String(played.opened || played.title || fallback?.title || '').trim(),
  next: String(played.next || fallback?.next || ''),
  step: String(played.step || fallback?.step || ''),
  moreVideos: Boolean(played.moreVideos),
  videoCount: Number(played.videoCount) || fallback?.videoCount || 0,
  videoIndex: Number(played.videoIndex) || fallback?.videoIndex || 0,
})

const recoverPlayback = async (check: VideoWatchCheck) => {
  const { browserId, sessionId } = check
  if (!browserId || recoveringBrowsers.has(browserId) || advancingBrowsers.has(browserId)) return
  recoveringBrowsers.add(browserId)
  const attempts = (recoverAttempts.get(browserId) || 0) + 1
  recoverAttempts.set(browserId, attempts)
  try {
    const snap = await readChaoxingVideo(browserId).catch(() => null)
    if (snap?.captcha) {
      void handleCaptchaWatch({ ...check, kind: 'captcha' })
      return
    }
    if (snap?.quiz) {
      void handleChapterQuizWatch({ ...check, kind: 'quiz' })
      return
    }
    const played = await playChaoxingVideo(browserId) as Record<string, unknown>
    if (videoIsPlaying(played)) {
      recoverAttempts.set(browserId, 0)
      startChaoxingWatch(browserId, sessionId, seedFromPlayed({
        ...played,
        title: played.title || check.status.title,
      }, check.status), { resume: true })
      // 自动恢复成功：面板进度条继续走，不叫醒 Agent
      return
    }
    notifyWatch(
      sessionId,
      formatWatchDisplay(check),
      `${formatWatchPrompt(check)}\n系统已自动点过播放仍没起来（第 ${attempts} 次）。立刻再 browser_chaoxing_play；页面不对就回目录 click_text 节名再 play。不要问用户。`,
    )
  } catch (error) {
    notifyWatch(
      sessionId,
      formatWatchDisplay(check),
      `${formatWatchPrompt(check)}\n自动恢复失败：${error instanceof Error ? error.message : String(error)}。立刻 browser_chaoxing_play；页面不对就回目录点节名。`,
    )
  } finally {
    recoveringBrowsers.delete(browserId)
  }
}

const handleCaptchaWatch = async (check: VideoWatchCheck) => {
  const { browserId, sessionId } = check
  if (!browserId) return
  const solved = await solveChaoxingCaptcha(browserId)
  if (solved.ok) {
    pendingCaptchaNotices.delete(sessionId)
    const played = await playChaoxingVideo(browserId) as Record<string, unknown>
    if (played?.captcha) {
      notifyCaptchaWithImage(sessionId, solved.image, '提交后验证码还在')
      return
    }
    if (videoIsPlaying(played)) {
      recoverAttempts.set(browserId, 0)
      startChaoxingWatch(browserId, sessionId, seedFromPlayed({
        ...played,
        title: played.title || check.status.title,
      }, check.status))
      // 验证码自动过且已在播：不叫醒 Agent
      return
    }
    notifyWatch(
      sessionId,
      '进度检查 · 已填写验证码',
      '验证码已自动填写并提交。立刻 browser_chaoxing_play；页面不对就回目录 click_text 节名再 play。不要问用户。',
    )
    return
  }
  notifyCaptchaWithImage(sessionId, solved.image, solved.error)
}

const chapterQuizOnce = new Set<string>()

const handleChapterQuizWatch = async (check: VideoWatchCheck) => {
  const { browserId, sessionId } = check
  if (!browserId) return
  const key = `${browserId}:${check.status.step || check.status.title || 'quiz'}`
  if (chapterQuizOnce.has(key) || advancingBrowsers.has(browserId)) {
    notifyWatch(
      sessionId,
      '进度检查 · 章节测验',
      '章节测验还在。调用 browser_chaoxing_homework inspect/guess/save，完成后 browser_chaoxing_next。',
    )
    return
  }
  chapterQuizOnce.add(key)
  advancingBrowsers.add(browserId)
  try {
    const { runChaoxingChapterQuiz } = await import('../homework/chapterQuiz')
    const result = await runChaoxingChapterQuiz(browserId)
    if (!result.ok) {
      notifyWatch(
        sessionId,
        '进度检查 · 章节测验未完成',
        `${result.hint || result.error || '章节测验自动作答失败'}。用 browser_chaoxing_homework inspect/guess/save，再 browser_chaoxing_next。`,
      )
      return
    }
    // 对齐 ocs：任务点做完直接进下一个，不叫醒 Agent
  } catch (error) {
    notifyWatch(
      sessionId,
      '进度检查 · 章节测验失败',
      `自动作答出错：${error instanceof Error ? error.message : String(error)}。用 homework inspect/guess，再 next。`,
    )
    return
  } finally {
    advancingBrowsers.delete(browserId)
    window.setTimeout(() => chapterQuizOnce.delete(key), 60_000)
  }
  await advanceToNextVideo(check)
}

const advanceToNextVideo = async (check: VideoWatchCheck) => {
  const { browserId, sessionId } = check
  if (!browserId || advancingBrowsers.has(browserId)) return
  advancingBrowsers.add(browserId)
  try {
    const next = await openNextChaoxingChapter(browserId) as {
      hasVideo?: boolean
      quiz?: boolean
      opened?: string
      title?: string
      next?: string
      current?: number
      duration?: number
      paused?: boolean
      ended?: boolean
      skipped?: string[]
      hint?: string
      step?: string
      sameChapter?: boolean
      moreVideos?: boolean
      videoCount?: number
      videoIndex?: number
    }
    if (next?.quiz) {
      advancingBrowsers.delete(browserId)
      await handleChapterQuizWatch({
        ...check,
        kind: 'quiz',
        status: {
          ...check.status,
          step: String(next.step || next.title || check.status.step || ''),
          title: String(next.title || next.step || check.status.title || ''),
          quiz: true,
          status: 'quiz',
        },
      })
      return
    }
    if (next?.hasVideo && Number(next.duration) > 1) {
      let played = next
      if (!videoIsPlaying(played)) {
        played = await playChaoxingVideo(browserId) as typeof next
      }
      const title = String(played.opened || played.title || next.opened || next.title || '下一节').trim()
      const playing = videoIsPlaying(played)
      recoverAttempts.set(browserId, 0)
      startChaoxingWatch(browserId, sessionId, seedFromPlayed({
        ...played,
        opened: title,
        next: played.next || next.next || '',
        moreVideos: played.moreVideos ?? next.moreVideos,
        videoCount: played.videoCount || next.videoCount,
        videoIndex: played.videoIndex || next.videoIndex,
      }, check.status))
      if (playing) {
        // 播完自动切下一段且已在播：进度条更新即可，不叫醒 Agent
        return
      }
      notifyWatch(
        sessionId,
        `进度检查 · 已打开「${title}」但未播放`,
        `${next.sameChapter ? '本章下一个视频' : '下一节'}「${title}」已经打开，但视频是暂停的。立刻 browser_chaoxing_play。禁止说正在播放、视频仍在后台播放。`,
      )
      return
    }
    notifyWatch(
      sessionId,
      '进度检查 · 需要继续',
      `上一节已播完，自动打开下一节失败。${next?.hint || ''} 跳过了：${(next?.skipped || []).join('、') || '无'}。调用 browser_chaoxing_next 再试；若已无未完成，browser_finish(status=done)。不要问用户手动点。`,
    )
  } catch (error) {
    notifyWatch(
      sessionId,
      '进度检查 · 切换下一节失败',
      `打开下一节出错：${error instanceof Error ? error.message : String(error)}。调用 browser_chaoxing_next 再试。`,
    )
  } finally {
    advancingBrowsers.delete(browserId)
  }
}

const enqueueWatchCheck = (check: VideoWatchCheck) => {
  const gate = sessionGateImpl?.(check.sessionId) || 'missing'
  if (gate === 'missing') return
  if (gate === 'busy') {
    const prev = queuedWatchChecks.get(check.sessionId)
    if (!prev || watchCheckRank[check.kind] >= watchCheckRank[prev.kind]) {
      queuedWatchChecks.set(check.sessionId, check)
    }
    return
  }
  // 正常播放中的 progress / heartbeat：只更新面板，绝不叫 Agent
  if (check.kind === 'progress' || check.kind === 'heartbeat') return
  if (check.kind === 'done') {
    void advanceToNextVideo(check)
    return
  }
  if (check.kind === 'captcha') {
    void handleCaptchaWatch(check)
    return
  }
  if (check.kind === 'quiz') {
    void handleChapterQuizWatch(check)
    return
  }
  if (check.kind === 'stalled' || check.kind === 'lost') {
    void recoverPlayback(check)
    return
  }
}


export const clearPendingCaptcha = (sessionId: string) => {
  pendingCaptchaNotices.delete(sessionId)
}

export const dropWatchQueue = (sessionId: string) => {
  queuedWatchChecks.delete(sessionId)
  pendingCaptchaNotices.delete(sessionId)
}

export const flushWatchAfterTurn = (sessionId: string) => {
  const queued = queuedWatchChecks.get(sessionId)
  const pendingImage = pendingCaptchaNotices.get(sessionId)
  if (pendingImage && (!queued || queued.kind !== 'captcha')) {
    pendingCaptchaNotices.delete(sessionId)
    window.setTimeout(() => notifyCaptchaWithImage(sessionId, pendingImage), 0)
  }
  if (queued) {
    queuedWatchChecks.delete(sessionId)
    window.setTimeout(() => enqueueWatchCheck(queued), 0)
  }
}

export const bindChaoxingWatchAgent = (input: {
  notify: WatchNotify
  gate: WatchGate
}) => {
  notifyWatchImpl = input.notify
  sessionGateImpl = input.gate
  setChaoxingWatchHandler(enqueueWatchCheck)
}

export { runAfterCaptcha }
