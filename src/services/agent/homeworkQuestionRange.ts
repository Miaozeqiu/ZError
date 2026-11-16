export type HomeworkQuestionRange = { start: number; end: number }

export function isHomeworkQuestionRange(value: unknown): value is HomeworkQuestionRange {
  if (!value || typeof value !== 'object') return false
  const { start, end } = value as HomeworkQuestionRange
  return Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 1 && end >= start
}

export function requestedHomeworkQuestionRange(goal: string): HomeworkQuestionRange | undefined {
  const text = goal.normalize('NFKC').replace(/《[^》]*》|「[^」]*」|“[^”]*”/g, '')
  if (/除了|排除|跳过|不包含|不做|不用做|别做|不要做|不答|不用答|别答|不要答/.test(text)) return
  const matches = [...text.matchAll(/前\s*(\d+)\s*(?:道\s*)?题|(?:第\s*)?(\d+)\s*[-–—~〜至到]\s*(?:第\s*)?(\d+)\s*(?:道\s*)?题|第\s*(\d+)\s*(?:道\s*)?题/g)]
  if (matches.length !== 1) return
  const [, first, start, end, single] = matches[0]
  const range = first ? { start: 1, end: Number(first) } : { start: Number(start ?? single), end: Number(end ?? single) }
  if (isHomeworkQuestionRange(range)) return range
}
