/** Generic run completion checks. Website semantics are returned by installed packages. */
import { peekAppBrowserUrl } from '../browser/appBrowser'
import { pendingTodos } from './browserTodo'
import { classifyBrowserPage, type BrowserPageKind } from './browserLoop'
import { browserTaskIntent, type BrowserTaskIntent } from './browserTask'
import type { AgentSubagentKind, AgentTodoItem } from './chatTypes'
import { videoWatchFor } from '../platform/panelAccess'
import { coursePlanFor, courseProgress } from '../browser/coursePlan'
import type { ImportTaskStep } from '../app/importTasks'
import type { ScopedCompletionProof } from './scopedCompletionEvidence'
import { isWebsiteRuntimeToolName } from './websiteRuntime/protocol'
import { isReadOnlyReviewGoal, reviewObservationId } from './observationReview'
export type FinishStatus = 'done' | 'blocked' | 'watching'
export type FinishRole = 'parent' | AgentSubagentKind
export type FinishEvidence = {
  url?: string; intent?: BrowserTaskIntent; kind?: BrowserPageKind; todos?: AgentTodoItem[]; role?: FinishRole
  playing?: boolean; paused?: boolean; hasVideo?: boolean; watching?: boolean; watchStatus?: string
  pageSummary?: boolean; planDone?: number; planTotal?: number; planComplete?: boolean
  packagePending?: boolean; reviewObservationId?: string; reviewRequested?: boolean
}
export const collectFinishEvidence = async (browserId: string, sessionId: string,
  extras?: { todos?: AgentTodoItem[]; role?: FinishRole; steps?: ImportTaskStep[]; completion?: ScopedCompletionProof; goalText?: string },
): Promise<FinishEvidence> => {
  const url = browserId ? peekAppBrowserUrl(browserId) : '', watch = videoWatchFor(browserId)
  const plan = coursePlanFor(browserId), progress = plan ? courseProgress(plan.items) : null
  const steps = extras?.steps || []
  const latest = steps.filter(step => isWebsiteRuntimeToolName(step.name || '') && step.status === 'done').at(-1)
  let packagePending = false
  if (latest) {
    try {
      const receipt = JSON.parse(latest.result || '{}')
      packagePending = receipt.ok === true && receipt.observed_browser_id === browserId && receipt.observation_id === latest.id
        && receipt.result?.workflowPending === true
    } catch { /* Malformed results do not create completion evidence. */ }
  }
  return { url, kind: classifyBrowserPage(url), intent: browserTaskIntent(sessionId), todos: extras?.todos || [], role: extras?.role || 'parent',
    playing: Boolean(watch?.sessionId === sessionId && !watch.paused && !watch.ended), paused: watch?.paused,
    hasVideo: Boolean(watch), watching: Boolean(watch?.sessionId === sessionId && ['watching','paused','stalled'].includes(watch.status)), watchStatus: watch?.status,
    pageSummary: Boolean(url), planDone: progress?.done, planTotal: progress?.total, planComplete: progress?.complete,
    packagePending, reviewRequested: Boolean(extras?.goalText && isReadOnlyReviewGoal(extras.goalText)),
    reviewObservationId: reviewObservationId(extras?.goalText, steps, browserId, url),
  }
}
export const judgeFinish = (status: string, summary: string, evidence: FinishEvidence = {}):
  { ok: true; status: FinishStatus; summary: string } | { ok: false; error: string } => {
  const want = status.trim() as FinishStatus, text = summary.trim()
  if (!['done','blocked','watching'].includes(want)) return { ok:false,error:'status 必须是 done / blocked / watching' }
  if (!text) return { ok:false,error:'缺少 summary' }
  if (want === 'blocked') return text.length < 4 ? { ok:false,error:'blocked 要写清用户需要做什么' } : { ok:true,status:want,summary:text }
  if (want === 'watching') return evidence.watching || evidence.watchStatus === 'watching'
    ? { ok:true,status:want,summary:text } : { ok:false,error:'当前没有活动的视频监控，请先核对网页状态，再用 browser_watch 绑定目标媒体。' }
  const pending = pendingTodos(evidence.todos)
  if (evidence.role !== 'explore' && pending.length) return { ok:false,error:`清单还有未完成：${pending.map(row => row.text).join('、')}。请核对任务结果后更新清单，或说明具体阻塞。` }
  if (evidence.playing || evidence.watching) return { ok:false,error:'视频监控仍在运行，请继续核对任务或使用 watching。' }
  if ((evidence.planTotal || 0) > 0 && !evidence.planComplete) return { ok:false,error:'当前课程计划仍有未完成条目，请核对计划范围。' }
  if (evidence.packagePending && !evidence.reviewObservationId) return { ok:false,error:'网站工作流仍有待处理步骤，请使用当前仓库工具继续核对，或说明具体阻塞。' }
  if (evidence.reviewRequested && !evidence.reviewObservationId) return { ok:false,error:'只读复核还缺少当前标签的新页面证据，请读取页面或仓库只读工具后反馈。' }
  if (evidence.role === 'explore' && !evidence.pageSummary) return { ok:false,error:'尚无当前页面摘要，请先读取页面。' }
  // The model judges whether the requested goal is fulfilled from source receipts.
  // This host gate does not interpret platform URLs, job counters or tool names.
  return { ok:true,status:want,summary:text }
}
