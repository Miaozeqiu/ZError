export type ExperienceEvidence = { path: string; verifiedAt: number; browserId: string; outcome: 'validated' | 'needs_review' }
export const experienceStatus = (evidence: ExperienceEvidence | undefined, now = Date.now()) => {
  if (!evidence) return '没有独立验证记录；按当前页面核对步骤，不要仅凭旧文档认定可用。'
  if (evidence.outcome === 'needs_review') return '上次使用此经验时存在定位失败，需重新观察；修正后再更新经验。'
  return now - evidence.verifiedAt > 90 * 86_400_000 ? '上次验证已超过 90 天，使用前重新核对页面结构。' : `最近一次通过收尾页面证据验证：${new Date(evidence.verifiedAt).toISOString()}。仍以当前页面为准。`
}
export const latestExperience = (messages: Array<{ skillEvidence?: ExperienceEvidence[] }>, path: string) => messages.flatMap(item => item.skillEvidence || []).filter(item => item.path === path).sort((a, b) => b.verifiedAt - a.verifiedAt)[0]
