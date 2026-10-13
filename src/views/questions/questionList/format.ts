/** 展示用纯函数。不碰 Vue ref。 */
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
  if (!searchTerm.trim()) return text
  let terms = highlightTerms
  if (!terms.length) {
    terms = searchTerm.trim().split(/\s+/).filter((item) => item.length > 0)
  }
  if (!terms.length) return text
  const escaped = terms.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  return text.replace(new RegExp(`(${escaped.join('|')})`, 'gi'), '<mark class="search-highlight">$1</mark>')
}
