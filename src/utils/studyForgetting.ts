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
  name?: string
  nodeId?: number
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

const parseReviewedAt = (raw?: string | null) => {
  const text = String(raw || '').trim()
  if (!text) return 0
  const at = Date.parse(text.includes('T') ? text : text.replace(' ', 'T') + 'Z')
  return Number.isFinite(at) ? at : 0
}

export const daysSinceReviewed = (raw?: string | null, now = Date.now()) => {
  const at = parseReviewedAt(raw)
  if (!at || now < at) return 0
  return (now - at) / 86400000
}

export const retentionFromCurve = (stage: number, lastReviewedAt?: string | null, now = Date.now()) => {
  const days = daysSinceReviewed(lastReviewedAt, now)
  const strength = Math.max(0.25, forgettingStrengthDays(stage))
  return Math.exp(-days / strength)
}

export type LapseState = {
  stage: number
  days: number
  retention: number
  strengthDays: number
}

// 错过当前阶段到期点就退回上一轮，只影响下次复习间隔，不改变当前这条指数曲线的速度。
export const lapseFromElapsed = (stage: number, days: number): LapseState => {
  let nextStage = clampForgettingStage(stage)
  let remain = Math.max(0, days)
  while (nextStage > 0 && remain > forgettingStrengthDays(nextStage)) {
    remain -= forgettingStrengthDays(nextStage)
    nextStage -= 1
  }
  const strengthDays = forgettingStrengthDays(nextStage)
  return {
    stage: nextStage,
    days: remain,
    retention: Math.exp(-Math.max(0, days) / Math.max(0.25, forgettingStrengthDays(stage))),
    strengthDays,
  }
}

export const lapseForgetting = (node: ForgettingNode, now = Date.now()): LapseState | null => {
  const stored = Number(node.mastery) || 0
  const reviewed = String(node.last_reviewed_at || '').trim()
  const stage = clampForgettingStage(node.forgetting_stage)
  if (!reviewed && stage === 0 && stored === 0) return null
  const reviewedAt = parseReviewedAt(reviewed)
  if (reviewedAt && now < reviewedAt) return null
  const days = daysSinceReviewed(reviewed || null, now)
  return {
    ...lapseFromElapsed(stage, days),
    retention: retentionFromCurve(stage, reviewed, now),
    strengthDays: forgettingStrengthDays(stage),
  }
}

export const nextForgettingStage = (
  node: ForgettingNode,
  input?: { remembered?: boolean; at?: number },
) => {
  const at = Number(input?.at) > 0 ? Number(input?.at) : Date.now()
  const remembered = input?.remembered !== false
  const lapse = lapseForgetting(node, at)
  if (!lapse) return 0
  if (!remembered) return Math.max(0, lapse.stage - 1)
  const days = daysSinceReviewed(node.last_reviewed_at, at)
  const stored = clampForgettingStage(node.forgetting_stage)
  const tooSoon = days < Math.min(0.75, forgettingStrengthDays(stored) * 0.35)
  if (tooSoon && lapse.retention >= 0.85) return lapse.stage
  if (lapse.retention >= 0.3) return Math.min(FORGETTING_STAGE_MAX, lapse.stage + 1)
  return Math.max(0, lapse.stage - 1)
}

export const retentionScore = (node: ForgettingNode, now = Date.now()): number | null => {
  const stored = Number(node.mastery) || 0
  const stage = clampForgettingStage(node.forgetting_stage)
  const reviewed = String(node.last_reviewed_at || '').trim()
  if (!reviewed && stage === 0 && stored === 0) return null
  const reviewedAt = parseReviewedAt(reviewed)
  if (reviewedAt && now < reviewedAt) return null
  return retentionFromCurve(stage, reviewed, now)
}

const averageRetention = (scores: Array<number | null>) => {
  if (!scores.length || scores.every((score) => score == null)) return null
  return scores.reduce((sum, score) => sum + (score ?? 0), 0) / scores.length
}

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
  const lapse = lapseForgetting(node, now)
  if (!lapse) return 0
  const base = stageBaseMastery(lapse.stage)
  if (lapse.retention >= 0.7) return base
  if (lapse.retention >= 0.4) return Math.max(1, Math.min(2, base))
  return 1
}

export const reviewedAtFromDaysAgo = (daysAgo?: number) => {
  const days = Number(daysAgo)
  const offset = Number.isFinite(days) && days > 0 ? days : 0
  return new Date(Date.now() - offset * 86400000).toISOString()
}

export type StudyEvalQuality = 'good' | 'fair' | 'poor'
export type StudyEvalKind = 'learn' | 'review'

export const parseStudyQuality = (raw: unknown): StudyEvalQuality => {
  const text = String(raw || '').trim().toLowerCase()
  if (['poor', 'bad', 'weak', '差', '生疏', '忘', '不会', 'weakly'].includes(text)) return 'poor'
  if (['fair', 'ok', 'okay', 'medium', '一般', '还行', '半对', '有印象'].includes(text)) return 'fair'
  return 'good'
}

export const parseStudyKind = (raw: unknown): StudyEvalKind => {
  const text = String(raw || '').trim().toLowerCase()
  if (['review', '复习', '回顾', '再学', '再讲'].includes(text)) return 'review'
  return 'learn'
}

export const retentionTargetForQuality = (quality: StudyEvalQuality) => {
  if (quality === 'poor') return 0.4
  if (quality === 'fair') return 0.72
  return 1
}

export const reviewedAtForQuality = (
  stage: number,
  quality: StudyEvalQuality,
  at = Date.now(),
) => {
  const target = retentionTargetForQuality(quality)
  if (target >= 0.99) return new Date(at).toISOString()
  const days = -Math.log(target) * Math.max(0.25, forgettingStrengthDays(stage))
  return new Date(at - days * 86400000).toISOString()
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

export const findGraphNode = (root: RetentionTreeNode | null | undefined, name: string) => {
  const needle = String(name || '').trim()
  if (!root || !needle) return null
  const walk = (node: RetentionTreeNode): RetentionTreeNode | null => {
    if (String(node.name || '').trim() === needle) return node
    for (const child of node.children || []) {
      const found = walk(child)
      if (found) return found
    }
    return null
  }
  return walk(root)
}

export const findGraphNodeById = (root: RetentionTreeNode | null | undefined, nodeId: number) => {
  if (!root || !Number.isFinite(nodeId)) return null
  const walk = (node: RetentionTreeNode): RetentionTreeNode | null => {
    if (Number(node.nodeId) === nodeId) return node
    for (const child of node.children || []) {
      const found = walk(child)
      if (found) return found
    }
    return null
  }
  return walk(root)
}

export const isLeafNode = (node: RetentionTreeNode | null | undefined) => !node?.children?.length

export const resolveCurveNode = (
  node: RetentionTreeNode,
  graph?: RetentionTreeNode | null,
) => {
  const nodeId = Number(node.nodeId)
  if (Number.isFinite(nodeId) && nodeId > 0) return findGraphNodeById(graph, nodeId) || node
  return findGraphNode(graph, node.name || '') || node
}

export type ParentCurveSample = { at: number; retention: number }

export type ParentCurveTick = { at: number; left: number; label: string }

export type ParentCurveView = {
  from: number
  end: number
  samples: ParentCurveSample[]
  retention: number | null
  ticks: ParentCurveTick[]
}

export type LeafCurveView = {
  from: number
  end: number
  now: number
  samples: ParentCurveSample[]
  future: ParentCurveSample[]
  ticks: ParentCurveTick[]
  retention: number | null
}

const formatParentTick = (at: number, spanMs: number, isEnd: boolean) => {
  if (isEnd && new Date(at).toDateString() === new Date().toDateString()) return '今天'
  const date = new Date(at)
  if (spanMs > 300 * 86400000) return `${String(date.getFullYear()).slice(2)}.${date.getMonth() + 1}`
  return `${date.getMonth() + 1}/${date.getDate()}`
}

const hashUnit = (seed: string, salt: number) => {
  let hash = 2166136261 ^ salt
  for (let i = 0; i < seed.length; i++) hash = Math.imul(hash ^ seed.charCodeAt(i), 16777619)
  return (hash >>> 0) / 4294967296
}

const reviewGapDays = (stage: number, seed: string) => {
  const base = forgettingStrengthDays(stage)
  return Math.max(0.16, base * (0.68 + hashUnit(seed, stage + 29) * 0.54))
}

const calendarTicks = (from: number, end: number, now: number): ParentCurveTick[] => {
  const span = Math.max(end - from, 1)
  const raw = [
    { at: from, label: formatParentTick(from, span, false) },
    { at: from + (now - from) * 0.5, label: formatParentTick(from + (now - from) * 0.5, span, false) },
    { at: now, label: '今天' },
    { at: end, label: formatParentTick(end, span, false) },
  ]
  const ticks: ParentCurveTick[] = []
  for (const item of raw) {
    const left = ((item.at - from) / span) * 100
    if (left < -2 || left > 102) continue
    if (ticks.some((tick) => Math.abs(tick.left - left) < 12)) continue
    ticks.push({ at: item.at, left, label: item.label })
  }
  if (!ticks.some((tick) => tick.label === '今天')) {
    ticks.push({ at: now, left: ((now - from) / span) * 100, label: '今天' })
    ticks.sort((a, b) => a.at - b.at)
  }
  return ticks
}

const decayAt = (stage: number, days: number) =>
  Math.exp(-Math.max(0, days) / Math.max(0.25, forgettingStrengthDays(stage)))

const sampleDecay = (from: number, to: number, stage: number, out: ParentCurveSample[]) => {
  const span = Math.max(1, to - from)
  const steps = Math.max(8, Math.min(24, Math.round(span / 21600000)))
  for (let i = 0; i <= steps; i++) {
    const at = from + (span * i) / steps
    out.push({ at, retention: decayAt(stage, (at - from) / 86400000) })
  }
}

const reconstructedReviews = (node: RetentionTreeNode, now = Date.now()) => {
  const lastAt = parseReviewedAt(node.last_reviewed_at)
  const stored = clampForgettingStage(node.forgetting_stage)
  if (!lastAt && stored === 0 && !(Number(node.mastery) || 0)) return []
  const seed = String(node.name || lastAt || 'leaf')
  const lastReview = lastAt || now
  const reviews = [{ at: lastReview, stage: stored }]
  let cursor = lastReview
  for (let stage = stored - 1; stage >= 0; stage--) {
    cursor -= reviewGapDays(stage, seed) * 86400000
    reviews.unshift({ at: cursor, stage })
  }
  return reviews
}

const leafRetentionAt = (node: RetentionTreeNode, at: number) => {
  const reviews = reconstructedReviews(node, at)
  if (!reviews.length) return null
  const last = reviews.filter((item) => item.at <= at).pop()
  if (!last) return null
  return decayAt(last.stage, (at - last.at) / 86400000)
}

const rolledRetentionAt = (node: RetentionTreeNode, at: number): number | null => {
  const children = node.children || []
  if (children.length) return averageRetention(children.map((child) => rolledRetentionAt(child, at)))
  return leafRetentionAt(node, at)
}

export const leafCurveView = (node: RetentionTreeNode, now = Date.now()): LeafCurveView => {
  const reviews = reconstructedReviews(node, now)
  const retention = retentionScore(node, now)
  if (!reviews.length || retention == null) {
    return { from: now - 3 * 86400000, end: now, now, samples: [], future: [], ticks: [], retention: null }
  }
  const lastReview = reviews[reviews.length - 1]
  const futureSpan = Math.max(3, forgettingStrengthDays(lastReview.stage)) * 86400000
  const from = reviews[0].at
  const end = now + futureSpan
  const samples: ParentCurveSample[] = []
  for (let i = 0; i < reviews.length; i++) {
    const review = reviews[i]
    const nextAt = i + 1 < reviews.length ? reviews[i + 1].at : now
    sampleDecay(review.at, nextAt, review.stage, samples)
  }
  const future: ParentCurveSample[] = [{ at: now, retention }]
  sampleDecay(lastReview.at, end, lastReview.stage, future)
  return {
    from,
    end,
    now,
    samples,
    future: future.filter((item) => item.at >= now - 1),
    ticks: calendarTicks(from, end, now),
    retention,
  }
}

export const parentCurveView = (node: RetentionTreeNode, now = Date.now()): ParentCurveView => {
  const leaves = collectLeaves(node)
  const reviewMarks = leaves.flatMap((leaf) => reconstructedReviews(leaf, now).map((item) => item.at))
  const times = reviewMarks.filter((at) => at > 0)
  const latest = times.length ? Math.max(...times) : now
  const earliest = times.length ? Math.min(...times) : now - 7 * 86400000
  const end = Math.max(now, latest)
  const span = Math.max(end - earliest, 3 * 86400000)
  const from = Math.min(earliest, end - span)
  const marks = new Set<number>()
  for (let i = 0; i <= 48; i++) marks.add(from + (span * i) / 48)
  marks.add(now)
  for (const at of times) {
    if (at < from || at > end) continue
    marks.add(at - 1)
    marks.add(at)
  }
  const samples = [...marks]
    .sort((a, b) => a - b)
    .map((at) => ({ at, retention: rolledRetentionAt(node, at) ?? 0 }))
  return {
    from,
    end,
    samples,
    retention: rolledRetention(node, now),
    ticks: calendarTicks(from, end, now),
  }
}

export const forgettingCurveView = (node: RetentionTreeNode, now = Date.now()): ForgettingCurveView => {
  const leaves = collectLeaves(node)
  if (!node.children?.length) {
    const score = retentionScore(node, now)
    const stage = clampForgettingStage(node.forgetting_stage)
    const strengthDays = forgettingStrengthDays(stage)
    return {
      retention: score,
      stage,
      stageLabel: forgettingStageLabel(stage),
      strengthDays,
      days: daysSinceReviewed(node.last_reviewed_at, now),
      fromChildren: false,
      leafCount: 1,
      band: forgettingBandOf(score),
      bandLabel: FORGETTING_BAND_LABEL[forgettingBandOf(score)],
    }
  }
  const retention = rolledRetention(node, now)
  const evaluated = leaves.filter((leaf) => retentionScore(leaf, now) != null)
  const stage = evaluated.length
    ? Math.round(evaluated.reduce((sum, item) => sum + clampForgettingStage(item.forgetting_stage), 0) / evaluated.length)
    : 0
  const strengthDays = forgettingStrengthDays(stage)
  const days = evaluated.length
    ? evaluated.reduce((sum, item) => sum + daysSinceReviewed(item.last_reviewed_at, now), 0) / evaluated.length
    : 0
  const band = forgettingBandOf(retention)
  return {
    retention,
    stage,
    stageLabel: forgettingStageLabel(stage),
    strengthDays,
    days,
    fromChildren: true,
    leafCount: leaves.length,
    band,
    bandLabel: FORGETTING_BAND_LABEL[band],
  }
}
