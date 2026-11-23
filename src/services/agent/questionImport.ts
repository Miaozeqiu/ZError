import type { ImportTemplateSource } from './importTemplateTypes'
import { parseQuestions, type ExtractedQuestion } from './import'

export function validateImportQuestions(raw: unknown, max = 5000): ExtractedQuestion[] {
  if (!Array.isArray(raw) || !raw.length || raw.length > max) throw new Error(`questions 必须是包含 1–${max} 道题的数组`)
  const invalid: number[] = []
  raw.forEach((item, index) => {
    if (!item || typeof item.question !== 'string' || !item.question.trim() || typeof item.answer !== 'string'
      || (item.options != null && typeof item.options !== 'string')) invalid.push(index + 1)
  })
  if (invalid.length) throw new Error(`第 ${invalid.slice(0, 20).join('、')} 道题字段无效：question 必须是非空字符串，answer、options 必须是字符串；原文无答案时 answer 填空字符串。尚未写入任何题目。`)
  return parseQuestions(raw)
}

type ImportResult = {
  sessionId: string; questions: ExtractedQuestion[]; createdAt: number; bytes: number
  source?: ImportTemplateSource; templateHandled?: boolean; folderId?: number; subjectId?: number; questionIds: number[]; running: boolean
}
const results = new Map<string, ImportResult>()
const MAX_BYTES = 16_000_000

export const clearQuestionImportResults = (sessionId: string) => {
  for (const [id, item] of results) if (item.sessionId === sessionId && !item.running) results.delete(id)
}

export function stageQuestionImport(sessionId: string, raw: unknown, source?: ImportTemplateSource) {
  const questions = validateImportQuestions(raw)
  const bytes = (JSON.stringify(questions).length + (source?.code.length || 0)) * 2
  if (bytes > 4_000_000) throw new Error('解析结果过大，请分段处理')
  for (const [id, item] of results) if (!item.running && Date.now() - item.createdAt > 60 * 60_000) results.delete(id)
  const used = [...results.values()].reduce((sum, item) => sum + item.bytes, 0)
  // 不静默丢弃已保存一部分的检查点；容量不足时让调用方分段或清理会话。
  if (results.size >= 32 || used + bytes > MAX_BYTES || [...results.values()].filter(item => item.sessionId === sessionId).length >= 8) {
    throw new Error('待导入结果过多，请先保存已有结果或清理该对话')
  }
  const resultId = crypto.randomUUID()
  results.set(resultId, { sessionId, questions, source, createdAt: Date.now(), bytes, questionIds: [], running: false })
  return {
    result_id: resultId, count: questions.length,
    missing_answers: questions.filter(item => !item.answer).length,
    preview: questions.slice(0, 2).map(item => ({ question: item.question.slice(0, 240), options: item.options?.slice(0, 360), answer: item.answer.slice(0, 120) })),
    saved: 0, template_saved: Boolean(source?.templateId), template_id: source?.templateId,
    next: source?.templateId
      ? '已使用保存过的模板完成解析，题目尚未写入；核对后用 save_questions(result_id, folder_id) 导入，不需要再保存模板。'
      : '这里只完成解析，题目和新模板均未保存。导入题目用 save_questions(result_id, folder_id)；仅用户明确要求保存算法时用 save_import_template(result_id)，无需重复导入。',
  }
}

export function questionImportResult(sessionId: string, id: string) {
  const item = results.get(id)
  if (!item || item.sessionId !== sessionId || (!item.running && Date.now() - item.createdAt > 60 * 60_000)) {
    throw new Error('解析结果不存在、已过期或不属于当前对话，请重新运行脚本')
  }
  return item
}
