import { databaseService, type PracticeMarks, type QuestionKnowledgeLink } from '../app/database'

export const clipToolResult = (text: string) => (text.length > 12000 ? `${text.slice(0, 11999)}…` : text)

export const notifyFoldersChanged = (folderId?: number) => {
  window.dispatchEvent(new CustomEvent('questions-imported', { detail: { folderId } }))
}

export const notifyCampusUpdated = (detail?: { courseId?: number; paperId?: number }) => {
  window.dispatchEvent(new CustomEvent('campus-updated', { detail: detail || {} }))
}

export const resolveFolder = async (id?: unknown, name?: unknown) => {
  const folders = await databaseService.getFolders()
  const folderId = Number(id)
  if (Number.isFinite(folderId)) {
    const found = folders.find((folder) => folder.id === folderId)
    if (found) return found
  }
  const keyword = String(name || '').trim()
  if (!keyword) return null
  const exact = folders.filter((folder) => folder.name === keyword)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) {
    throw new Error(`有多个同名文件夹「${keyword}」，请改用 folder_id`)
  }
  const fuzzy = folders.filter((folder) => folder.name.includes(keyword))
  if (fuzzy.length === 1) return fuzzy[0]
  if (fuzzy.length > 1) {
    throw new Error(`有多个文件夹名称包含「${keyword}」，请改用 folder_id`)
  }
  return null
}

export const summarizeQuestion = (item: {
  id: number
  question?: string
  options?: string
  answer?: string
  question_type?: string
  folder_id?: number
  folder_name?: string
  importance?: number
  mastery?: number
  difficulty?: number
}) => ({
  id: item.id,
  question: String(item.question || '').slice(0, 180),
  options: String(item.options || '').slice(0, 220),
  answer: String(item.answer || '').slice(0, 80),
  question_type: item.question_type || '',
  folderId: item.folder_id ?? 0,
  folderName: item.folder_name || '',
  importance: item.importance ?? 0,
  mastery: item.mastery ?? 0,
  difficulty: item.difficulty ?? 0,
})

export const withPractice = async <T extends { id: number }>(items: T[]) => {
  const ids = items.map((item) => item.id)
  const [summaries, marks, links] = await Promise.all([
    databaseService.getPracticeSummaries(ids),
    databaseService.getRecentPracticeMarks(ids, 5).catch((): PracticeMarks[] => []),
    databaseService.listQuestionKnowledge(ids).catch((): QuestionKnowledgeLink[] => []),
  ])
  const map = new Map(summaries.map((item) => [item.question_id, item] as const))
  const markMap = new Map(marks.map((item) => [item.question_id, item.results || []] as const))
  const byQuestion = new Map<number, { node_id: number; node_name: string; subject_id: number; subject_name: string }[]>()
  for (const item of links) {
    const list = byQuestion.get(item.question_id) || []
    list.push({
      node_id: item.node_id,
      node_name: item.node_name,
      subject_id: item.subject_id,
      subject_name: item.subject_name,
    })
    byQuestion.set(item.question_id, list)
  }
  return items.map((item) => {
    const practice = map.get(item.id)
    return {
      ...summarizeQuestion(item as any),
      practice: practice
        ? { ...practice, recent: markMap.get(item.id) || [] }
        : { count: 0, recent: markMap.get(item.id) || [] },
      knowledge: byQuestion.get(item.id) || [],
    }
  })
}

export const parseQuestionIds = (args: any) => {
  const raw = args?.question_ids ?? args?.question_id
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : []
  return [...new Set(list.map((value) => Number(value)).filter((id) => Number.isFinite(id) && id > 0))]
}

const listedBySession = new Map<string, { id: number; mastery?: number; question_type?: string; folder_id?: number }[]>()

export const rememberListed = (sessionId: string, items: { id: number; mastery?: number; question_type?: string; folder_id?: number }[]) => {
  listedBySession.set(sessionId, items.filter((item) => item.id > 0))
}

export const listedQuestionsOf = (sessionId: string) => listedBySession.get(sessionId) || []
