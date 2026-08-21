export const FORGETTING_STAGE_MAX = 6

export const FORGETTING_STAGES = [
  { stage: 0, days: 0.5, label: '刚学', short: '刚学' },
  { stage: 1, days: 1, label: '第 1 天', short: '1天' },
  { stage: 2, days: 2, label: '第 2 天', short: '2天' },
  { stage: 3, days: 4, label: '第 4 天', short: '4天' },
  { stage: 4, days: 7, label: '第 7 天', short: '7天' },
  { stage: 5, days: 15, label: '第 15 天', short: '15天' },
  { stage: 6, days: 30, label: '第 30 天', short: '30天' },
] as const

export type ForgettingNode = {
  mastery?: number
  forgetting_stage?: number
  last_reviewed_at?: string | null
}

export type RetentionTreeNode = ForgettingNode & {
  children?: RetentionTreeNode[]
}

export const clampForgettingStage = (value: unknown) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(FORGETTING_STAGE_MAX, Math.round(n)))
}

export const forgettingStrengthDays = (stage: number) =>
  FORGETTING_STAGES[clampForgettingStage(stage)]?.days ?? 0.5

export const stageBaseMastery = (stage: number) => {
  const value = clampForgettingStage(stage)
  if (value <= 0) return 1
  if (value <= 3) return 2
  return 3
}

export const forgettingStageLabel = (stage?: number) =>
  FORGETTING_STAGES[clampForgettingStage(stage)]?.label || '刚学'

export const daysSinceReviewed = (raw?: string | null, now = Date.now()) => {
  const text = String(raw || '').trim()
  if (!text) return 0
  const at = Date.parse(text.includes('T') ? text : text.replace(' ', 'T') + 'Z')
  if (!Number.isFinite(at)) return 0
  return Math.max(0, (now - at) / 86400000)
}

export const retentionFromCurve = (stage: number, lastReviewedAt?: string | null, now = Date.now()) => {
  const days = daysSinceReviewed(lastReviewedAt, now)
  const strength = Math.max(0.25, forgettingStrengthDays(stage))
  return Math.exp(-days / strength)
}

// 连续记忆保持率 0–1；未评估返回 null。随 now 增大按指数曲线衰减。
export const retentionScore = (node: ForgettingNode, now = Date.now()): number | null => {
  const stored = Number(node.mastery) || 0
  const stage = clampForgettingStage(node.forgetting_stage)
  const reviewed = String(node.last_reviewed_at || '').trim()
  if (!reviewed && stage === 0 && stored === 0) return null
  return retentionFromCurve(stage, reviewed, now)
}

const averageRetention = (scores: Array<number | null>) => {
  if (!scores.length || scores.every((score) => score == null)) return null
  return scores.reduce((sum, score) => sum + (score ?? 0), 0) / scores.length
}

// 有子节点时，熟练度等于子树平均值；叶子才用自己的遗忘曲线。
export const rolledRetention = (node: RetentionTreeNode, now = Date.now()): number | null => {
  const children = node.children || []
  if (children.length) return averageRetention(children.map((child) => rolledRetention(child, now)))
  return retentionScore(node, now)
}

export const rolledRetentionForest = <T extends ForgettingNode & { id: number; parent_id?: number | null }>(
  nodes: T[],
  now = Date.now(),
): number => {
  if (!nodes.length) return 0
  const ids = new Set(nodes.map((node) => node.id))
  const children = new Map<number, T[]>()
  const roots: T[] = []
  for (const node of nodes) {
    const parentId = node.parent_id
    if (parentId != null && ids.has(parentId) && parentId !== node.id) {
      const list = children.get(parentId)
      if (list) list.push(node)
      else children.set(parentId, [node])
    } else {
      roots.push(node)
    }
  }
  const roll = (node: T): number | null => {
    const kids = children.get(node.id) || []
    if (kids.length) return averageRetention(kids.map(roll))
    return retentionScore(node, now)
  }
  return averageRetention((roots.length ? roots : nodes).map(roll)) ?? 0
}

export const effectiveMastery = (node: ForgettingNode, now = Date.now()) => {
  const stored = Number(node.mastery) || 0
  const stage = clampForgettingStage(node.forgetting_stage)
  const reviewed = String(node.last_reviewed_at || '').trim()
  if (!reviewed && stage === 0 && stored === 0) return 0
  const base = stageBaseMastery(stage)
  const retention = retentionFromCurve(stage, reviewed, now)
  if (retention >= 0.7) return base
  if (retention >= 0.4) return Math.max(1, Math.min(2, base))
  return 1
}

export const reviewedAtFromDaysAgo = (daysAgo?: number) => {
  const days = Number(daysAgo)
  const offset = Number.isFinite(days) && days > 0 ? days : 0
  return new Date(Date.now() - offset * 86400000).toISOString()
}

export const applyForgettingToNode = <T extends ForgettingNode>(node: T, now = Date.now()): T => ({
  ...node,
  mastery: effectiveMastery(node, now),
})

export type ForgettingBand = 'unset' | 'weak' | 'fair' | 'solid'

export const forgettingBandOf = (retention: number | null): ForgettingBand => {
  if (retention == null) return 'unset'
  if (retention < 0.4) return 'weak'
  if (retention < 0.8) return 'fair'
  return 'solid'
}

export const FORGETTING_BAND_LABEL: Record<ForgettingBand, string> = {
  unset: '未评估',
  weak: '遗忘中',
  fair: '记忆中',
  solid: '牢固',
}

const collectLeaves = (node: RetentionTreeNode): RetentionTreeNode[] => {
  if (!node.children?.length) return [node]
  return node.children.flatMap(collectLeaves)
}

export const formatForgettingDays = (days: number) => {
  if (days < 1 / 24) return '刚刚'
  if (days < 1) return `${Math.max(1, Math.round(days * 24))} 小时前`
  if (days < 1.5) return '1 天前'
  return `${Math.round(days)} 天前`
}

export type ForgettingCurveView = {
  retention: number | null
  stage: number
  stageLabel: string
  strengthDays: number
  days: number
  fromChildren: boolean
  leafCount: number
  band: ForgettingBand
  bandLabel: string
}

export const forgettingCurveView = (node: RetentionTreeNode, now = Date.now()): ForgettingCurveView => {
  const retention = rolledRetention(node, now)
  const leaves = collectLeaves(node)
  const evaluated = leaves.filter((leaf) => retentionScore(leaf, now) != null)
  const samples = evaluated.length ? evaluated : (node.children?.length ? [] : [node])
  const stage = samples.length
    ? Math.round(samples.reduce((sum, item) => sum + clampForgettingStage(item.forgetting_stage), 0) / samples.length)
    : clampForgettingStage(node.forgetting_stage)
  const strengthDays = forgettingStrengthDays(stage)
  const days = retention != null && retention > 0
    ? -strengthDays * Math.log(Math.max(0.001, Math.min(1, retention)))
    : (samples.length
      ? samples.reduce((sum, item) => sum + daysSinceReviewed(item.last_reviewed_at, now), 0) / samples.length
      : daysSinceReviewed(node.last_reviewed_at, now))
  const band = forgettingBandOf(retention)
  return {
    retention,
    stage,
    stageLabel: forgettingStageLabel(stage),
    strengthDays,
    days,
    fromChildren: Boolean(node.children?.length),
    leafCount: leaves.length,
    band,
    bandLabel: FORGETTING_BAND_LABEL[band],
  }
}
