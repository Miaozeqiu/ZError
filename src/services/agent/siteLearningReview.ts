/** 本轮站点经验收尾检查。只核对工具证据，不自动生成或执行网页脚本。 */
import { websitePrimaryHost } from './websiteIdentity'
import { canonicalSkillToolName } from './skillToolNames'
import { resolveWebsiteSkillTarget } from './websiteSkillTarget'
type Step = { id: string; name: string; status: string; arguments?: string; result?: string }
export type LearningDecision = 'updated' | 'covered' | 'no_new' | 'deferred'
const object = (value: unknown): Record<string, any> => {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch { return {} }
}
const matchesSiteFile = (step: Step, path: string) => {
  const args = object(step.arguments)
  const result = object(step.result)
  const target = resolveWebsiteSkillTarget(String(result.id || args.skill_id || ''), String(result.path || args.path || ''))
  const expected = resolveWebsiteSkillTarget('site-learn', path)
  return target.skillId === expected.skillId && target.path === expected.path
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
  const base = { path, writePolicy: input.writePolicy }
  if (input.learning == null) return { ...base, ok: true, decision: 'no_new' as LearningDecision }
  const review = object(input.learning)
  const reason = String(review.reason || '').trim()
  const reject = (error: string) => ({ ...base, ok: false, error })
  if (!reason || !['updated', 'covered', 'no_new', 'deferred'].includes(review.decision)) {
    return reject('未确认这条经验声明：缺少有效的决策或理由。')
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
  if (review.decision === 'deferred' && input.writePolicy !== 'deny' && !attempted && !readFailed) return reject('暂未保存需有读取失败、写入被拒绝或失败的实际记录；没有新经验请使用 no_new。')
  return { ...base, ok: true, decision: review.decision as LearningDecision, reason }
}
