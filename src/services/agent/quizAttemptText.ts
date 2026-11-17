import type { AgentQuizAttempt, AgentQuizOptionQuote } from './chatTypes'

export const formatQuizOptionQuotes = (quotes: AgentQuizOptionQuote[]) => quotes.map(quote =>
  `引用题目：${quote.question}\n选项 ${quote.key}：${quote.text}`,
).join('\n\n')

export const formatQuizAttempt = (attempt: AgentQuizAttempt) => {
  const n = attempt.index && attempt.total ? `第 ${attempt.index}/${attempt.total} 题` : '这道练习'
  const id = attempt.question_id ? ` #${attempt.question_id}` : ''
  const result = attempt.correct == null ? '已作答' : attempt.correct ? '答对了' : '答错了'
  const last = Boolean(attempt.index && attempt.total && attempt.index >= attempt.total)
  const lines = [
    `${n}${id}`,
    '',
    attempt.question,
  ]
  if (attempt.options) lines.push('', attempt.options)
  lines.push('', `我选：${attempt.selected || '未选'}`, `对错：${result}`)
  if (attempt.answer) lines.push(`参考答案：${attempt.answer}`)
  if (attempt.explanation) lines.push(`题库解析：${attempt.explanation}`)
  if (attempt.note) lines.push(`备注：${attempt.note}`)
  lines.push('')
  lines.push(last
    ? '这是本轮最后一题。请针对我这一题的选择做评判和解析，可以一句话小结本轮，不要再出新题。'
    : '请针对我这一题的选择做评判和解析。不要出新题，我还在右侧继续做。')
  return lines.join('\n')
}
