export const IMPORTANCE_LEVELS = [
  { value: 0, label: '/' },
  { value: 1, label: '低' },
  { value: 2, label: '中' },
  { value: 3, label: '高' },
] as const

export const MASTERY_LEVELS = [
  { value: 0, label: '/' },
  { value: 1, label: '未掌握' },
  { value: 2, label: '一般' },
  { value: 3, label: '已掌握' },
] as const

export const DIFFICULTY_LEVELS = [
  { value: 0, label: '/' },
  { value: 1, label: '简单' },
  { value: 2, label: '中等' },
  { value: 3, label: '困难' },
] as const

export type QuestionMetricValue = 0 | 1 | 2 | 3
export type QuestionMetricKey = 'importance' | 'mastery' | 'difficulty'

export const METRIC_DEFS = {
  importance: { key: 'importance', label: '重要性', levels: IMPORTANCE_LEVELS },
  mastery: { key: 'mastery', label: '掌握程度', levels: MASTERY_LEVELS },
  difficulty: { key: 'difficulty', label: '难度', levels: DIFFICULTY_LEVELS },
} as const

export const METRIC_KEYS = ['importance', 'mastery', 'difficulty'] as const

export const normalizeMetric = (value?: number | null): QuestionMetricValue => {
  const n = Number(value)
  if (n === 1 || n === 2 || n === 3) return n
  return 0
}

export const importanceLabel = (value?: number | null) =>
  IMPORTANCE_LEVELS[normalizeMetric(value)].label

export const masteryLabel = (value?: number | null) =>
  MASTERY_LEVELS[normalizeMetric(value)].label

export const difficultyLabel = (value?: number | null) =>
  DIFFICULTY_LEVELS[normalizeMetric(value)].label

export const metricValueLabel = (key: QuestionMetricKey, value?: number | null) =>
  METRIC_DEFS[key].levels[normalizeMetric(value)].label

export const cycleMetric = (value?: number | null): QuestionMetricValue =>
  ((normalizeMetric(value) + 1) % 4) as QuestionMetricValue

const parseMetric = (
  value: unknown,
  levels: readonly { value: QuestionMetricValue; label: string }[],
): QuestionMetricValue => {
  if (value == null || value === '') return 0
  if (typeof value === 'number') return normalizeMetric(value)
  const text = String(value).trim()
  if (text === '/' || text === '-' || text === '—' || text === '未设置') return 0
  const byLabel = levels.find((level) => level.label === text)
  if (byLabel) return byLabel.value
  return normalizeMetric(Number(text))
}

export const parseImportance = (value?: unknown): QuestionMetricValue =>
  parseMetric(value, IMPORTANCE_LEVELS)

export const parseMastery = (value?: unknown): QuestionMetricValue =>
  parseMetric(value, MASTERY_LEVELS)

export const parseDifficulty = (value?: unknown): QuestionMetricValue =>
  parseMetric(value, DIFFICULTY_LEVELS)
