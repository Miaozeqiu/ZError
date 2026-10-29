import { hasAgentWait, wakeAgentWait } from '../../agent/agentWait'
import { readChaoxingVideo, videoIsPlaying } from '../study/video'
import { packAgentPanel, playPanelStudy } from './panelStudy'
import { solveChaoxingCaptcha } from './captcha'
import {
  formatVideoClock,
  setChaoxingWatchHandler,
  startChaoxingWatch,
  videoWatchFor,
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

/** 停滞事件排队期间若同一视频已恢复推进，不能再用旧状态唤醒 Agent。 */
const stalePlaybackIncident = (check: VideoWatchCheck) => {
  if (check.kind !== 'stalled' && check.kind !== 'lost') return false
  const live = videoWatchFor(check.browserId)
  if (!live || live.sessionId !== check.sessionId) return false
  if (live.startedAt > check.status.startedAt) return true
  return live.status === 'watching' && !live.paused && live.updatedAt > check.status.updatedAt
    && live.sampledCurrent > check.status.current + 0.35
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
    return `${base}\n学习通弹出图片验证码（9010）。图会附上或页面上有 #ccc。认出 4 位后填进输入框再点播放。`
  }
  if (check.kind === 'quiz') {
    return `${base}\n当前是章节测验。系统会按 ocs 流程自动搜题/随机/暂存；若失败再 inspect/guess，然后 看快照。`
  }
  if (check.kind === 'done') {
    return `${base}\n这个视频已经结束。不要自动点开下一段。看 jobs，用 看快照 指定 videoIndex / label；只剩测验就 看快照。`
  }
  if (check.kind === 'lost') {
    return `${base}\n播放器丢了或页面不对。可 play；还不行就回目录点当前节名再 play。`
  }
  if (check.kind === 'stalled') {
    return `${base}\n进度卡住或暂停了。paused=true。`
  }
  if (state.paused || state.status === 'stalled') {
    return `${base}\n视频是暂停或卡住的，没有在播。`
  }
  return `${base}\n定时核对：paused、进度、是否弹窗。暂停/卡住看 play；播放器没了回目录再 play；测验用 homework。进度看面板/watch。`
}

const recoveringBrowsers = new Set<string>()
const recoverAttempts = new Map<string, number>()
const panelEventOnce = new Set<string>()

const forgetPanelEvents = (browserId: string) => {
  for (const key of [...panelEventOnce]) {
    if (key.startsWith(`${browserId}:`)) panelEventOnce.delete(key)
  }
}

const formatPanelForAgent = (browserId: string) => {
  const panel = packAgentPanel(browserId)
  if (!panel) return ''
  return [
    `【解析面板】${panel.thisSection.title || '当前节'}`,
    panel.jobLine ? `任务点：${panel.jobLine}` : '',
    panel.thisSection.next ? `下一步：${panel.thisSection.next.label}（${panel.thisSection.next.kind}）` : '',
    panel.hint,
  ].filter(Boolean).join('\n')
}

const notifyPanelTakeover = (sessionId: string, display: string, extra: string, browserId: string) => {
  notifyWatch(
    sessionId,
    display,
    `${extra}\n${formatPanelForAgent(browserId)}\n处理完需要继续等再用 wait。已完成的视频不必再 watch。`,
  )
}

/** 解析面板有事件（测验 / 本节任务点已清完）时叫醒 Agent；视频还在播则继续闷头监控。 */
const maybeTakeoverFromPanel = (check: VideoWatchCheck) => {
  const panel = packAgentPanel(check.browserId)
  if (!panel || panel.event === 'need_video' || panel.event === 'empty') return false
  const key = `${check.browserId}:${panel.event}:${panel.leftJobs.join(',')}`
  if (panelEventOnce.has(key)) return true
  panelEventOnce.add(key)
  if (panel.event === 'quiz_left') {
    notifyPanelTakeover(
      check.sessionId,
      `解析面板 · ${panel.thisSection.title || '本节'} 视频已完成，还剩测验`,
      '本节视频已完成，还剩测验。读取页面并完成剩余任务；用户明确要求跳过时遵守用户的范围。',
      check.browserId,
    )
    return true
  }
  notifyPanelTakeover(
    check.sessionId,
    `解析面板 · ${panel.thisSection.title || '本节'} 任务点已完成`,
    '解析面板有事件：本节任务点都已完成。调用 看快照 去下一未完成节。',
    check.browserId,
  )
  return true
}

const notifyWatch = (sessionId: string, display: string, modelText: string) => {
  if (wakeAgentWait(sessionId, { reason: 'watch', display, hint: modelText })) {
    queuedWatchChecks.delete(sessionId)
    return
  }
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
  const hint = `学习通弹出图片验证码（9010）。${error ? `自动识别失败：${error}。` : ''}图已附上或页面上有 #ccc。立刻认出 4 位字母或数字并填进去。不要问用户。提交后再点播放。`
  if (wakeAgentWait(sessionId, {
    reason: 'captcha',
    display: '进度检查 · 遇到验证码',
    hint,
    captchaImage: String(image || '').startsWith('data:image/') ? image : undefined,
  })) {
    queuedWatchChecks.delete(sessionId)
    return
  }
  notifyWatchImpl?.(
    sessionId,
    '进度检查 · 遇到验证码',
    hint,
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
      : `${solved.error || '验证码没自动认出来'}。图会随后附上，立刻认出 4 位并填进去，然后继续播放。不要问用户。`,
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
  mid: String(played.mid || ''),
})

const recoverPlayback = async (check: VideoWatchCheck) => {
  const { browserId, sessionId } = check
  if (!browserId || recoveringBrowsers.has(browserId)) return
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
    const played = await playPanelStudy(browserId, { resume: true }) as Record<string, unknown>
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
      `${formatWatchPrompt(check)}\n系统已自动点过播放仍没起来（第 ${attempts} 次）。立刻再 看快照；页面不对就回目录 click_text 节名再 play。不要问用户。`,
    )
  } catch (error) {
    notifyWatch(
      sessionId,
      formatWatchDisplay(check),
      `${formatWatchPrompt(check)}\n自动恢复失败：${error instanceof Error ? error.message : String(error)}。立刻 看快照；页面不对就回目录点节名。`,
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
    const played = await playPanelStudy(browserId, { resume: true }) as Record<string, unknown>
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
      '验证码已自动填写并提交。立刻 看快照；页面不对就回目录 click_text 节名再 play。不要问用户。',
    )
    return
  }
  notifyCaptchaWithImage(sessionId, solved.image, solved.error)
}

const handleChapterQuizWatch = async (check: VideoWatchCheck) => {
  const { browserId, sessionId } = check
  if (!browserId) return
  if (maybeTakeoverFromPanel(check)) return
  const key = `${browserId}:quiz:${check.status.step || check.status.title || 'quiz'}`
  if (panelEventOnce.has(key)) return
  panelEventOnce.add(key)
  notifyPanelTakeover(
    sessionId,
    '解析面板 · 出现测验',
    '解析面板有事件：当前是章节测验。看卡片，用 看快照 按 handle 作答。',
    browserId,
  )
}

const handleVideoDone = (check: VideoWatchCheck) => {
  if (maybeTakeoverFromPanel(check)) return
  const panel = packAgentPanel(check.browserId)
  const nextJob = panel?.thisSection.next
  notifyPanelTakeover(
    check.sessionId,
    `解析面板 · ${panel?.thisSection.title || '本节'} 一段视频已完成`,
    nextJob
      ? `解析面板有事件：这段视频已完成。下一步是${nextJob.label}。看 jobs 后 看快照 指定 videoIndex / label，不要自动点开视频。`
      : '这段视频已完成。读取页面核对剩余视频和测验；先处理本节剩余任务，再进入下一节。',
    check.browserId,
  )
}

export const shouldDeferWatchNotify = (
  gate: 'missing' | 'busy' | 'ready',
  waiting: boolean,
) => {
  if (gate === 'missing') return 'drop' as const
  if (gate === 'busy' && !waiting) return 'queue' as const
  return 'now' as const
}

const enqueueWatchCheck = (check: VideoWatchCheck) => {
  if (stalePlaybackIncident(check)) return
  const gate = sessionGateImpl?.(check.sessionId) || 'missing'
  const defer = shouldDeferWatchNotify(gate, hasAgentWait(check.sessionId))
  if (defer === 'drop') return
  // 等着的回合也是 busy，但事件要立刻打断 wait，不能排队等回合结束再另开对话
  if (defer === 'queue') {
    const prev = queuedWatchChecks.get(check.sessionId)
    if (!prev || watchCheckRank[check.kind] >= watchCheckRank[prev.kind]) {
      queuedWatchChecks.set(check.sessionId, check)
    }
    return
  }
  // 正常播放中的 progress / heartbeat：只更新面板；解析面板有测验/本节已清完才叫 Agent
  if (check.kind === 'progress' || check.kind === 'heartbeat') {
    maybeTakeoverFromPanel(check)
    return
  }
  if (check.kind === 'done') {
    handleVideoDone(check)
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

export const notePanelEvent = (browserId: string, panel: { event: string; leftJobs: string[] }) => {
  if (panel.event === 'need_video' || panel.event === 'empty') return
  panelEventOnce.add(`${browserId}:${panel.event}:${panel.leftJobs.join(',')}`)
}

export const flushWatchIntoWait = (sessionId: string) => {
  const queued = queuedWatchChecks.get(sessionId)
  if (!queued) return
  queuedWatchChecks.delete(sessionId)
  if (stalePlaybackIncident(queued)) return
  if (queued.kind === 'stalled' || queued.kind === 'lost') {
    wakeAgentWait(sessionId, {
      reason: 'watch',
      display: formatWatchDisplay(queued),
      hint: formatWatchPrompt(queued),
    })
    return
  }
  enqueueWatchCheck(queued)
}

export const flushWatchAfterTurn = (sessionId: string) => {
  if (hasAgentWait(sessionId)) {
    flushWatchIntoWait(sessionId)
    return
  }
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
