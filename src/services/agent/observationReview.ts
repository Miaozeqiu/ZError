import { installedWebsiteRuntimeTool } from './websiteRepository'
import { PASSIVE_WEBSITE_COMMANDS } from './websiteRuntime/protocol'
import type { ImportTaskStep } from '../app/importTasks'

/** 只识别用户当前明确提出的只读复核要求，不根据助手总结推断。 */
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

// 只读复核不等于课程完成：本轮必须有宿主确认的当前页面证据，且未执行修改操作。
export const reviewObservationId = (goal: string | undefined, steps: ImportTaskStep[], browserId: string, url: string,
  now = Date.now()): string | undefined => {
  if (!goal || !isReadOnlyReviewGoal(goal) || !browserId || !url) return
  const allowed = /^(?:load_agent_tools|read_agent_skill|read_agent_skill_file|list_agent_skills|search_conversation_history|read_conversation_history|browser_get_page|browser_screenshot|browser_get_state|browser_find|browser_eval|browser_scroll)$/
  const tools = steps.filter(step => step.kind === 'tool' && step.name !== 'browser_finish')
  const packageRead = (step: ImportTaskStep) => {
    const binding = installedWebsiteRuntimeTool(step.name || '')
    if (!binding) return false
    if (binding.tool.commands.every(op => PASSIVE_WEBSITE_COMMANDS.has(op) && op !== 'state.write' && op !== 'service.request')) return true
    // 多用途工具也能纯读取。只采信宿主外层回执，并绑定当前安装版本；仓库 result 中的声明无效。
    try {
      const receipt = JSON.parse(step.result || '{}')
      return receipt.ok === true && receipt.observed === true && receipt.read_only === true
        && receipt.repository?.id === binding.siteId && receipt.repository?.revision === binding.revision
        && receipt.repository?.sha256 === binding.runtime.bundle.sha256
    } catch { return false }
  }
  if (tools.some(step => !(allowed.test(step.name || '') || packageRead(step)) || step.status !== 'done')) return
  // 滚动后须重新读取视口；其余只读工具可继续检查已经确认的文档。
  let lastScroll = -1
  tools.forEach((step, index) => { if (step.name === 'browser_scroll') lastScroll = index })
  const latest = tools.slice(lastScroll + 1).filter(step => ['browser_get_page', 'browser_screenshot'].includes(step.name || '') || packageRead(step)).at(-1)
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
