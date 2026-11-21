import { installedWebsiteRuntimeTool } from './websiteRepository'
import { PASSIVE_WEBSITE_COMMANDS } from './websiteRuntime/protocol'
import type { ImportTaskStep } from '../app/importTasks'

/** Explicit current-user review requests, never inferred from an Agent summary. */
export const isReadOnlyReviewGoal = (goal: string): boolean => {
  const quiz = /(?:章节|本节|本章|小节).{0,10}(?:测验|测试)/.test(goal)
  if ((!/只读/.test(goal) && !quiz) || !/核对|复核|查看|读取|检查|分析|观察|看(?:一?下|看)|读题/.test(goal)) return false
  const action = '(?:播放|刷课|刷完|看完|播完|答题|作答|提交|保存|修改|填写|补填|做题|做完|输入|点击|勾选|删除|进入|切换|打开|导航|上传|下载|登录)'
  const active = goal.replace(new RegExp('(?:不要|不必|无需|不用|禁止|不能|不|别)(?:再|去|做|进行)?' + action, 'g'), '')
    .replace(new RegExp('(?:已经|已)' + action, 'g'), '')
    .replace(/(?:作答|答题|填写)(?:情况|状态|记录|结果|进度|详情)/g, '')
    .replace(/(?:已经|已)完成/g, '')
  return !new RegExp(action + '|完成(?:章节|课程|视频|作业|测验|任务|\\s*\\d)').test(active)
    && !(quiz && /(?:^|[^未不])(?:完成|做|参加)(?:一下|下)?[^，。！？；]{0,14}(?:测验|测试)/.test(active))
}

// Read-only review completion is separate from course completion. There must be
// a current host-stamped page observation, and no action tools in this run.
export const reviewObservationId = (goal: string | undefined, steps: ImportTaskStep[], browserId: string, url: string,
  now = Date.now()): string | undefined => {
  if (!goal || !isReadOnlyReviewGoal(goal) || !browserId || !url) return
  const allowed = /^(?:read_agent_skill|read_agent_skill_file|list_agent_skills|search_conversation_history|read_conversation_history|browser_get_page|browser_screenshot|browser_get_state|browser_find|browser_eval|browser_scroll)$/
  const tools = steps.filter(step => step.kind === 'tool' && step.name !== 'browser_finish')
  const packageRead = (name: string) => { const tool = installedWebsiteRuntimeTool(name)?.tool; return Boolean(tool && tool.commands.every(op => PASSIVE_WEBSITE_COMMANDS.has(op) && op !== 'state.write' && op !== 'service.request')) }
  if (tools.some(step => !(allowed.test(step.name || '') || packageRead(step.name || '')) || step.status !== 'done')) return
  // Scrolling is part of looking at a page, but needs a new observation of the
  // resulting viewport. Other read tools can inspect that observed document.
  let lastScroll = -1
  tools.forEach((step, index) => { if (step.name === 'browser_scroll') lastScroll = index })
  const latest = tools.slice(lastScroll + 1).filter(step => ['browser_get_page', 'browser_screenshot'].includes(step.name || '') || packageRead(step.name || '')).at(-1)
  if (!latest) return
  try {
    const result = JSON.parse(latest.result || '{}')
    if (result.ok === false || result.error || result.snapshotStale || result.empty
      || result.observation_id !== latest.id || result.observed_browser_id !== browserId
      || !Number.isFinite(result.observed_at) || now - result.observed_at > 120_000 || result.observed_at > now
      || (result.url && String(result.url).split('#')[0] !== url.split('#')[0])) return
    return latest.id
  } catch { return }
}
