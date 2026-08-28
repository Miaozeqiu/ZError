import { databaseService } from '../app/database'
import { parseQuizCards, type QuizCard } from '../../utils/question/quizPractice'
import { associateQuestionsToKnowledge } from '../study/questionKnowledge'
import { normalizeType, type ExtractedQuestion } from './import'
import { listedQuestionsOf, parseQuestionIds } from './toolShared'

const isChoiceType = (type?: string) => {
  const text = String(type || '')
  return /单选|多选|判断|选择/.test(text) || !text
}

export const cardsFromQuestions = async (items: { id: number }[]) => {
  const stored = await databaseService.getQuestionsByIds(items.map((item) => item.id))
  return stored
    .filter((item) => item.question && item.answer)
    .map((item) => ({
      uid: `q-${item.id}`,
      question_id: item.id,
      question: item.question,
      options: item.options || '',
      answer: item.answer || '',
      question_type: item.question_type || undefined,
      importance: item.importance,
      mastery: item.mastery,
      difficulty: item.difficulty,
    } satisfies QuizCard))
    .slice(0, 10)
}

export const hydrateQuizCards = async (cards: QuizCard[]) => {
  const next: QuizCard[] = []
  for (const card of cards) {
    if (card.question_id && card.answer) {
      next.push(card)
      continue
    }
    const keyword = card.question.replace(/\s+/g, '').slice(0, 24)
    if (!keyword) {
      if (card.options) next.push(card)
      continue
    }
    try {
      const found = await databaseService.searchQuestionsByTitle(card.question.slice(0, 40))
      const compact = (value: string) => value.replace(/\s+/g, '')
      const match = found.find((item) => {
        const left = compact(item.question || '')
        const right = compact(card.question)
        return left.includes(right.slice(0, 16)) || right.includes(left.slice(0, 16))
      })
      if (match) {
        next.push({
          ...card,
          uid: `q-${match.id}`,
          question_id: match.id,
          question: match.question,
          options: match.options || card.options,
          answer: match.answer || card.answer,
          question_type: match.question_type || card.question_type,
          importance: match.importance,
          mastery: match.mastery,
          difficulty: match.difficulty,
        })
        continue
      }
    } catch {
      // keep local card
    }
    if (card.question && card.options) next.push(card)
  }
  return next
}

export const pickPracticeCards = async (sessionId: string, count = 5, folderId?: number) => {
  const listed = listedQuestionsOf(sessionId)
  const ranked = [...listed].sort((a, b) => (a.mastery || 0) - (b.mastery || 0))
  const choice = ranked.filter((item) => isChoiceType(item.question_type))
  const picked = (choice.length ? choice : ranked).slice(0, count)
  if (picked.length) return cardsFromQuestions(picked)
  const folder = folderId != null ? folderId : 0
  const result = await databaseService.getPaginatedQuestions({
    folderId: folder,
    page: 1,
    pageSize: 40,
  })
  const weak = [...result.items].sort((a, b) => (a.mastery || 0) - (b.mastery || 0))
  return cardsFromQuestions(weak.slice(0, count))
}

export const resolveQuizCards = async (raw: unknown): Promise<QuizCard[]> => {
  const drafted = parseQuizCards(raw)
  const extraIds = raw && typeof raw === 'object' ? parseQuestionIds(raw) : []
  const ids = [...new Set([
    ...drafted.map((item) => item.question_id).filter((id): id is number => Number.isFinite(id) && (id as number) > 0),
    ...extraIds,
  ])]
  const stored = ids.length ? await databaseService.getQuestionsByIds(ids) : []
  const byId = new Map(stored.map((item) => [item.id, item]))
  const cards: QuizCard[] = []
  const used = new Set<number>()
  drafted.forEach((item, index) => {
    const fromBank = item.question_id ? byId.get(item.question_id) : undefined
    const question = item.question || fromBank?.question || ''
    const answer = item.answer || fromBank?.answer || ''
    if (!question || !answer) return
    if (item.question_id) used.add(item.question_id)
    cards.push({
      uid: item.question_id ? `q-${item.question_id}` : `g-${index}`,
      question_id: item.question_id,
      question,
      options: item.options || fromBank?.options || '',
      answer,
      question_type: item.question_type || fromBank?.question_type || undefined,
      explanation: item.explanation,
      importance: item.importance ?? fromBank?.importance,
      mastery: item.mastery ?? fromBank?.mastery,
      difficulty: item.difficulty ?? fromBank?.difficulty,
      knowledge_point: item.knowledge_point,
      node_name: item.node_name,
      node_id: item.node_id,
      parent_name: item.parent_name,
      subject_id: item.subject_id,
    })
  })
  for (const id of extraIds) {
    if (used.has(id) || !byId.has(id)) continue
    const fromBank = byId.get(id)!
    if (!fromBank.question || !fromBank.answer) continue
    cards.push({
      uid: `q-${id}`,
      question_id: id,
      question: fromBank.question,
      options: fromBank.options || '',
      answer: fromBank.answer || '',
      question_type: fromBank.question_type || undefined,
      importance: fromBank.importance,
      mastery: fromBank.mastery,
      difficulty: fromBank.difficulty,
    })
  }
  return cards.slice(0, 10)
}

export const saveQuestions = async (items: ExtractedQuestion[], folderId: number, subjectId?: number) => {
  const created: { id: number; item: ExtractedQuestion }[] = []
  for (const item of items) {
    const question = await databaseService.addQuestion({
      content: item.question,
      options: item.options || '',
      answer: item.answer,
      question_type: normalizeType(item.question_type),
      folderId,
      isAi: 1,
      importance: item.importance,
      mastery: item.mastery,
      difficulty: item.difficulty,
    })
    created.push({ id: question.id, item })
  }
  const association = created.length
    ? await associateQuestionsToKnowledge(
      created.map(({ id, item }) => ({
        questionId: id,
        question: item.question,
        knowledge_point: item.knowledge_point,
        node_name: item.node_name,
        node_id: item.node_id,
        parent_name: item.parent_name,
        subject_id: item.subject_id,
      })),
      { subjectId, createMissing: true },
    )
    : { linked: 0, created: 0, skipped: created.length, links: [] }
  if (created.length) {
    window.dispatchEvent(new CustomEvent('questions-imported', { detail: { folderId } }))
    if (association.created || association.linked) {
      window.dispatchEvent(new CustomEvent('study-graph-updated', { detail: { subjectId } }))
    }
  }
  return {
    saved: created.length,
    questionIds: created.map((item) => item.id),
    association,
  }
}
