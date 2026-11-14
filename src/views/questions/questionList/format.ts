/** 展示用纯函数。不碰 Vue ref。 */
import { normalizeLocalSearchCharacter, normalizeLocalSearchText } from '../../../utils/question/localSearchText'
import type { AIResponse } from '../../../services/app/database'

export const hasSelectedFolder = (folderId?: string | null) => (
  folderId != null && folderId !== '' && folderId !== 'error'
)

export const parseFolderId = (folderId: string) => {
  const parsed = Number.parseInt(folderId, 10)
  return Number.isNaN(parsed) ? null : parsed
}

export const typeTagKind = (type: string): 'single' | 'multiple' | 'judgement' | 'fill' | 'other' => {
  const t = type.replace(/\s/g, '')
  if (/多选|多项|不定项/.test(t)) return 'multiple'
  if (/判断/.test(t)) return 'judgement'
  if (/填空|简答|解答/.test(t)) return 'fill'
  if (/单选|单项/.test(t)) return 'single'
  return 'other'
}

export const formatTime = (timeStr?: string): string => {
  if (!timeStr) return ''
  try {
    return new Date(timeStr).toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  } catch (error) {
    console.error('时间格式化错误:', error)
    return timeStr
  }
}

export const getQuestionCreateTime = (question: AIResponse) => {
  const timestamp = new Date(question.create_time || '').getTime()
  return Number.isNaN(timestamp) ? 0 : timestamp
}

export const sortQuestionListByCreateTime = (list: AIResponse[], order: 'desc' | 'asc') => (
  [...list].sort((a, b) => {
    const diff = getQuestionCreateTime(a) - getQuestionCreateTime(b)
    return order === 'asc' ? diff : -diff
  })
)

export const highlightSearchTerm = (text: string, searchTerm: string, highlightTerms: string[]) => {
  const phrase = normalizeLocalSearchText(searchTerm)
  const terms = [...new Set([phrase, ...highlightTerms.filter(term => /[\p{L}\p{N}]/u.test(term)).map(normalizeLocalSearchText)])]
    .filter(Boolean).sort((a, b) => b.length - a.length)
  if (!terms.length) return [{ text, matched: false }]

  let normalized = ''
  let offset = 0
  const positions: { start: number; end: number }[] = []
  for (const char of text) {
    const mapped = normalizeLocalSearchCharacter(char)
    for (let i = 0; i < mapped.length; i++) positions.push({ start: offset, end: offset + char.length })
    normalized += mapped
    offset += char.length
  }
  const parts: { text: string; matched: boolean }[] = []
  let start = 0
  for (let i = 0; i < normalized.length;) {
    const term = terms.find(term => normalized.startsWith(term, i))
    if (!term) {
      i++
      continue
    }
    const left = positions[i].start
    const right = positions[i + term.length - 1].end
    if (left < start) {
      i++
      continue
    }
    if (left > start) parts.push({ text: text.slice(start, left), matched: false })
    parts.push({ text: text.slice(left, right), matched: true })
    start = right
    i += term.length
  }
  if (start < text.length) parts.push({ text: text.slice(start), matched: false })
  return parts
}
