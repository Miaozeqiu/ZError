/** 本轮站点经验收尾检查。只核对工具证据，不自动生成或执行网页脚本。 */
import { websitePrimaryHost } from './websiteIdentity'
import { canonicalSkillToolName } from './skillToolNames'
type Step = { id: string; name: string; status: string; arguments?: string; result?: string }
export type LearningDecision = 'updated' | 'covered' | 'no_new' | 'deferred'
const object = (value: unknown): Record<string, any> => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { return {} }
}
const observation = /^(browser_get_state|browser_get_page|browser_find|browser_screenshot|browser_decode_chaoxing_font|browser_wait|browser_todo|browser_finish|browser_watch)$/
const matchesSiteFile = (step: Step, path: string) => {
  const args = object(step.arguments)
  const result = object(step.result)
  return (result.id || args.skill_id) === 'site-learn' && (result.path || args.path) === path
}
export const siteSkillReadIndex = (steps: Step[], path: string) => {
  for (let index = steps.length - 1; index >= 0; index--) {
    const step = steps[index]
    if (canonicalSkillToolName(step.name) !== 'read_agent_skill_file' || !matchesSiteFile(step, path)) continue
    const result = object(step.result)
    // A later failed read invalidates an earlier snapshot. Keep compatibility
    // with old, explicit "not found" results, but never with a real I/O failure.
    return (step.status === 'done' && !result.error && result.ok !== false)
      || (result.ok !== false && /还不存在|文件不存在|not found/i.test(String(result.error || '')))
      ? index : -1
  }
  return -1
}

export const reviewSiteLearning = (input: {
  url: string; steps: Step[]; learning?: unknown; writePolicy?: string
}) => {
  const host = websitePrimaryHost(input.url)
  const path = `sites/${host}/SKILL.md`
  const actions = input.steps.filter(step => {
    const name = canonicalSkillToolName(step.name)
    return name.startsWith('browser_') && !observation.test(name)
  })
  const successful = actions.filter(step => step.status === 'done' && !object(step.result).error && object(step.result).ok !== false)
  const recovered = actions.some((step, index) => step.status === 'failed'
    && actions.slice(index + 1).some(next => next.name === step.name && next.status === 'done'))
  const evals = new Set(successful.filter(step => step.name === 'browser_eval').map(step => object(step.arguments).script).filter(Boolean))
  const candidate = recovered || evals.size > 1
  const required = Boolean(host && !/^(localhost|127\.0\.0\.1)$/.test(host) && successful.length >= 2)
  const base = { required, path, candidate, writePolicy: input.writePolicy, evidence: successful.slice(-6).map(step => ({ id: step.id, name: step.name })) }
  if (!required) return { ...base, ok: true, decision: 'no_new' as LearningDecision, reason: '没有需要收尾检查的多步站点操作' }
  const review = object(input.learning)
  const reason = String(review.reason || '').trim()
  const reject = (error: string) => ({ ...base, ok: false, error,
    hint: `网页任务本身已完成，无需重做。先 read_agent_skill_file(skill_id=site-learn, path=${path})；exists=false 表示首次创建，可直接写入本轮验证的经验，不是读取失败。读取总说明不算读取本站原文。有增量时保留原文并用 write_agent_skill_file 更新完整正文。随后 browser_finish 带 learning={decision:updated|covered|no_new|deferred,reason:具体理由}。不要写账号、密码、验证码、临时 ref、具体题目答案或未验证猜测；拒绝/失败只报告暂未保存，不能反复申请。`,
  })
  if (!reason || !['updated', 'covered', 'no_new', 'deferred'].includes(review.decision)) {
    return reject('网页任务已完成，但还缺本轮站点经验检查。无需重做网页任务。')
  }
  const matches = (step: Step) => matchesSiteFile(step, path)
  const readAt = siteSkillReadIndex(input.steps, path)
  const hasRead = readAt >= 0
  const hasExistingRead = hasRead && input.steps[readAt].status === 'done' && !object(input.steps[readAt].result).error
    && object(input.steps[readAt].result).exists !== false
  const written = input.steps.some((step, index) => canonicalSkillToolName(step.name) === 'write_agent_skill_file'
    && matches(step) && step.status === 'done' && object(step.result).ok === true && object(step.result).unchanged !== true
    && siteSkillReadIndex(input.steps.slice(0, index), path) >= 0)
  const attempted = input.steps.some(step => canonicalSkillToolName(step.name) === 'write_agent_skill_file' && matches(step)
    && step.status !== 'running' && (step.status === 'failed' || object(step.result).denied || object(step.result).error))
  const readFailed = input.steps.some(step => canonicalSkillToolName(step.name) === 'read_agent_skill_file' && matches(step)
    && (object(step.result).ok === false || (object(step.result).error && !/还不存在|文件不存在|not found/i.test(String(object(step.result).error)))))
  if (review.decision === 'updated' && !written) return reject('不能声明已保存：缺少本轮读取原文并成功写入本站 Skill 的证据。')
  if (review.decision === 'covered' && !hasExistingRead) return reject('不能声明已有覆盖：请先成功读取本站 Skill 核对。')
  if (review.decision === 'no_new' && candidate) return reject('本轮存在换方法或修复后成功的候选经验，请核对已有覆盖，或保存经过验证的增量。')
  if (review.decision === 'deferred' && input.writePolicy !== 'deny' && !attempted && !readFailed) return reject('暂未保存需有读取失败、写入被拒绝或失败的实际记录；没有新经验请使用 no_new。')
  return { ...base, ok: true, decision: review.decision as LearningDecision, reason }
}

/** 模型绕过 finish 直接回复时，最多补两次检查；不能无限延长已完成的任务。 */
export const createLearningCompletionCheck = (read: () => { url: string; steps: Step[]; enabled: boolean; ready?: boolean }) => {
  let reminders = 0
  let deferred = false
  return {
    get deferred() {
      return deferred || read().steps.some(step => step.name === 'browser_finish' && step.status === 'done'
        && object(step.result).finished === true && object(step.result).learning?.decision === 'deferred')
    },
    beforeComplete: (remainingRounds = Infinity) => {
      const input = read()
      if (!input.enabled || input.ready === false || input.steps.some(step => step.name === 'browser_finish'
        && step.status === 'done' && object(step.result).finished === true)) return
      const review = reviewSiteLearning(input)
      if (!review.required) return
      if (remainingRounds <= 0) { deferred = true; return }
      if (reminders++ < 2) return `网页操作已经结束，不要重做任务。收尾前检查本站经验：${review.path}。读取已有 Skill，有验证过的增量才更新，再 browser_finish 填 learning 的 decision 和 reason。拒绝授权或失败则报告暂未保存。`
      deferred = true
    },
  }
}
