import { actOnceOnBrowser } from '../../browser/engine'
import { evalBrowserViewInFrame, waitMs } from '../../browser/eval'
import { callProtocol } from '../../browser/protocol'
import { videoWatchFor } from '../../platform/panelAccess'
import { readStudentChapter, readStudentChapterCard, revealChapterJob, sameStudentChapterPage } from '../../chaoxing/host/chapterTasks'
import { watchChapterVideo } from '../../platform/chaoxing/chapterPlayback'
import { runWebsiteScript } from '../websiteScripts'

type Context = {
  name: string
  args: Record<string, unknown>
  browserId: string
  sessionId: string
  role?: string
  wait?: (ms: number) => Promise<void>
}

const NO_TARGET = '页面还没有可核对的当前章节。先在学习通学生端打开用户要处理的小节。'
const MAX_JOBS = 32

export async function handleWebsiteChapterTools(ctx: Context): Promise<string> {
  const { browserId, sessionId, args, wait = waitMs } = ctx
  const advancing = ctx.name === 'browser_complete_chapter'
  const fail = (reason: string, error: string, clickDispatched = false) => JSON.stringify({ ok: false, reason, error, clickDispatched })
  if (advancing && ctx.role === 'explore') return fail('invalid', '当前权限只能查看章节。')
  if (advancing && (!sessionId || typeof args.chapter_key !== 'string')) return fail('invalid', '先用 browser_review_chapter 读取目标章节的 chapterKey。')
  if (args.video_only !== undefined && typeof args.video_only !== 'boolean') return fail('invalid', 'video_only 必须为布尔值。')
  if (args.video_mid !== undefined && (typeof args.video_mid !== 'string' || !/^[a-z\d_-]{1,100}$/i.test(args.video_mid) || args.tab !== undefined)) {
    return fail('invalid', '视频标识无效。请先核对当前小节。')
  }
  if (args.tab !== undefined && (!advancing || !Number.isSafeInteger(args.tab) || Number(args.tab) < 1)) return fail('invalid', 'tab 必须是当前章节可用的页签编号。')

  let state = await readStudentChapterCard(browserId)
  for (let attempt = 0; !advancing && args.video_mid !== undefined && attempt < 5; attempt++) {
    if (state && (state.identity.key !== args.chapter_key || state.jobs !== null)) break
    await wait(250)
    state = await readStudentChapterCard(browserId)
  }
  if (!state) return JSON.stringify({ ok: false, reason: 'not_found', error: NO_TARGET, retryable: true })
  if (!advancing && !sameStudentChapterPage(await readStudentChapter(browserId), state)) return fail('stale', NO_TARGET)
  const { identity, header, jobs, cards } = state
  if (args.chapter_key !== undefined && args.chapter_key !== identity.key) return fail('stale', '当前课程或章节已切换。请先核对页面。')
  const matching = args.video_mid === undefined ? undefined : jobs?.filter(job => job.kind === 'video' && job.mid === args.video_mid)
  if (args.video_mid !== undefined && matching?.length !== 1) return fail('stale', '当前页签未核对到唯一的原视频。')
  const plannedJobs = matching ?? jobs ?? []
  const receipt = {
    ok: true, chapterKey: identity.key, chapterId: identity.chapterId, title: header.title, chapterNumber: header.number,
    tab: header.tab, tabs: header.tabs.filter(item => item.id).map(item => item.tab),
    remaining: header.remaining, chapterComplete: header.remaining === 0,
    loaded: jobs !== null, jobCount: jobs?.length ?? 0,
    ...(matching ? { videoMid: matching[0].mid, videoJobDone: matching[0].done } : {}),
    jobs: (jobs || []).slice(0, MAX_JOBS).map(({ index, kind, name, done }) => ({ index: index + 1, kind, name, done })),
  }
  const report = (status: string, hint: string, extra: Record<string, unknown> = {}) => JSON.stringify({ ...receipt, status, hint, ...extra })
  if (!advancing) return report(receipt.chapterComplete ? 'complete' : 'observed', '已读取当前章节的网页任务点状态。')
  if (!receipt.loaded && !receipt.chapterComplete) return report('loading', '当前章节内容正在加载，请稍候复核。')

  const requestedTab = args.tab === undefined ? undefined : header.tabs.find(item => item.tab === args.tab && item.id && item.tab !== header.tab)
  if (requestedTab === undefined && args.tab !== undefined) return fail('invalid', '该页签不可切换。请先核对当前章节和可用页签。')
  const next = requestedTab ?? (matching ? undefined : header.tabs.find(item => item.tab > header.tab && item.id))
  const input = {
    remaining: header.remaining, loaded: receipt.loaded, videoOnly: args.video_only === true,
    targetTab: requestedTab?.tab ?? null, nextTab: next?.tab ?? null,
    jobs: plannedJobs.map(({ kind, done }) => ({ kind, done })),
  }

  const outstanding = requestedTab ? -1 : input.jobs.findIndex(job => !job.done && (!input.videoOnly || job.kind === 'video'))
  const expected = receipt.chapterComplete ? { action: 'complete' }
    : !input.loaded ? { action: 'loading' }
    : outstanding >= 0 ? { action: input.jobs[outstanding].kind, index: outstanding }
    : next ? { action: 'tab', tab: next.tab } : { action: 'pending' }
  let script
  try {
    script = await runWebsiteScript('chaoxing.com', 'chaoxing', 'chapters', input, value => {
      const proposed = value as Partial<{ action: string; index: number; tab: number }> | null
      if (!proposed || proposed.action !== expected.action || proposed.index !== expected.index || proposed.tab !== expected.tab) {
        throw new Error('章节脚本返回的动作与当前网页任务点不一致。')
      }
      return expected
    })
  } catch (error) {
    return fail('invalid', error instanceof Error ? error.message : '章节脚本运行失败。')
  }
  const { action, index } = script.result
  const verified = await readStudentChapter(browserId)
  if (!sameStudentChapterPage(verified, state) || verified?.header.cards?.href !== header.cards?.href || verified?.header.remaining !== header.remaining) {
    return fail('stale', '章节状态已刷新，请重新复核后继续。')
  }
  if (action === 'complete') return report('complete', '学习通章节目录已标记本节完成。')
  if (action === 'pending') return report('pending', '本页签没有可继续的任务点。核对同章其他页签及目录完成状态。')
  const watch = videoWatchFor(browserId)
  if (watch?.sessionId === sessionId && watch.status === 'watching') {
    return report('watching', '该标签已有视频监控。等待事件后重新复核章节。', { watching: true })
  }

  if (action === 'tab' && next) {
    const raw = await callProtocol(browserId, 'snapshot', { frame: 'main', maxFrames: 1, acted: true }).catch(() => null)
    const frames = Array.isArray(raw?.frames) ? raw.frames : []
    const root = frames.find(frame => frame.frameId === state.frameId && frame.url === identity.href)
    if (!root?.loaderId) return fail('invalid', '当前章节主文档已变化，无法确认页签。')
    const clicked = await actOnceOnBrowser(browserId, {
      by: 'css', value: `#prev_tab .prev_ul > li#${next.id}`, frameId: root.frameId, loaderId: root.loaderId,
    }, 'click')
    if (!clicked.ok) return fail('invalid', '没有确认目标页签已打开。请复核网页。', clicked.dispatched)
    await wait(400)
    const after = await readStudentChapter(browserId)
    if (after?.identity.key !== identity.key || after.header.tab !== next.tab) return fail('stale', '页签切换尚未确认，请复核当前页面。', true)
    return report('tab_changed', '已切到同一章节的目标页签。用 browser_review_chapter 读取任务点。', {
      tab: next.tab, loaded: false, jobs: [], jobCount: 0, remaining: after.header.remaining, chapterComplete: after.header.remaining === 0,
    })
  }

  const job = typeof index === 'number' ? plannedJobs[index] : undefined
  if (!job || !cards?.frameId) return fail('invalid', '当前任务点缺少可核对的网页位置。')
  const current = await readStudentChapterCard(browserId)
  const currentJob = current?.jobs?.[job.index]
  if (!sameStudentChapterPage(current, state) || current?.cards?.frameId !== cards.frameId || current?.cards?.url !== cards.url
    || !currentJob || currentJob.done || currentJob.kind !== job.kind
    || currentJob.mid !== job.mid || currentJob.selector !== job.selector) {
    return fail('stale', '任务点状态已刷新，请重新复核后继续。')
  }
  const detail = { job: { index: job.index + 1, kind: job.kind, name: job.name, done: job.done } }
  if (action === 'unknown') return report('unsupported_job', '该任务点类型需要用网页快照核对。', detail)

  if (action === 'quiz' || action === 'document') {
    if (job.selector) {
      const revealed = await evalBrowserViewInFrame(browserId, revealChapterJob(cards.url, job.selector), '', { frameId: cards.frameId }).catch(() => false)
      if (revealed !== true) return fail('stale', '未能定位任务点，请用当前页面快照核对。')
    }
    if (action === 'quiz') {
      return report('needs_quiz', '用当前测验网页核对题目和选项，按用户授权作答、保存或提交，再复核章节。', detail)
    }
    if (job.selector) {
      await wait(600)
      const after = await readStudentChapterCard(browserId)
      if (!sameStudentChapterPage(after, state) || after?.cards?.frameId !== cards.frameId) {
        return fail('stale', '章节页已改变，请先复核当前页面。', true)
      }
      if (after.header.remaining === 0 || after.jobs?.some(item => item.selector === job.selector && item.done)) {
        return report(after.header.remaining === 0 ? 'complete' : 'job_completed', '网页已登记该文档任务点完成，请复核剩余任务。', {
          job: { ...detail.job, done: true }, remaining: after.header.remaining, chapterComplete: after.header.remaining === 0,
        })
      }
    }
    return report('needs_document', '用当前文档控件阅读并核对平台标记。平台登记完成后再继续。', detail)
  }

  if (!job.mid || jobs?.filter(item => item.mid === job.mid).length !== 1) return fail('invalid', '未读到唯一的视频标识。请用当前页面快照核对。')
  const video = await watchChapterVideo(browserId, sessionId, job.mid, job.name || header.title,
    async () => { await wait(0); return Boolean(sameStudentChapterPage(await readStudentChapter(browserId), state)) }, job.focusRequired)
  if (video.ok === false) {
    if (video.reason === 'not_found' && !video.dispatched) return report('loading', video.error)
    return fail(video.reason, video.error, video.dispatched)
  }
  return report(video.status, video.hint, { ...detail, videoMid: job.mid, watching: video.status === 'watching' })
}
