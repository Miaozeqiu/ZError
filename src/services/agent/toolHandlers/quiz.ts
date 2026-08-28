import { databaseService } from '../../app/database'
import { associateQuestionsToKnowledge, notifyQuestionKnowledgeUpdated, type QuestionKnowledgeHint } from '../../study/questionKnowledge'
import { resolveQuizTitle, saveQuizCards, saveQuizTitle } from '../../../utils/question/quizPractice'
import { parseCampusQuestionIds, resolveCampusQuizCards } from '../campusSession'
import { pickPracticeCards, resolveQuizCards, saveQuestions } from '../quizTools'
import { lastStudyFocus } from '../studyHelpers'
import type { ChatToolHandler } from '../toolContext'
import { resolveFolder } from '../toolShared'

export const presentQuiz: ChatToolHandler = async ({ call, args, ctx }) => {
  const campusQuiz = await resolveCampusQuizCards(ctx.sessionId, args)
  let cards = campusQuiz.cards
  if (!cards.length) cards = await resolveQuizCards(args)
  if (!cards.length) {
    const count = Math.min(10, Math.max(1, Number(args.count) || 5))
    const folder = args.folder_id != null ? await resolveFolder(args.folder_id, args.folder_name) : null
    cards = await pickPracticeCards(ctx.sessionId, count, folder?.id)
  }
  if (!cards.length) {
    return JSON.stringify({
      error: parseCampusQuestionIds(args).length || args.paper_id
        ? '没有找到这些校园题。先 list_campus_questions，再把 campus_question_ids 或 paper_id 传给 present_quiz。'
        : '没有可出示的题目。请先 list_questions，或传入 question_ids。',
    })
  }
  const subjectId = ctx.studySubjectId()
  const focus = subjectId ? lastStudyFocus.get(subjectId) : undefined
  const defaultNodeId = Number(args.node_id) > 0 ? Number(args.node_id) : focus?.nodeId
  const defaultNodeName = String(args.node_name || args.knowledge_point || focus?.nodeName || '').trim()
  const defaultParent = String(args.parent_name || '').trim()
  cards = cards.map((card) => ({
    ...card,
    node_id: card.node_id || defaultNodeId,
    node_name: card.node_name || defaultNodeName || undefined,
    knowledge_point: card.knowledge_point || defaultNodeName || undefined,
    parent_name: card.parent_name || defaultParent || undefined,
    subject_id: card.subject_id || subjectId,
  }))
  const folder = args.folder_id != null ? await resolveFolder(args.folder_id, args.folder_name) : null
  const existingHints: QuestionKnowledgeHint[] = []
  for (let index = 0; index < cards.length; index += 1) {
    const card = cards[index]
    if (card.question_id) {
      if (card.node_id || card.node_name || card.knowledge_point || card.parent_name) {
        existingHints.push({
          questionId: card.question_id,
          question: card.question,
          knowledge_point: card.knowledge_point,
          node_name: card.node_name,
          node_id: card.node_id,
          parent_name: card.parent_name,
          subject_id: card.subject_id || subjectId,
        })
      }
      continue
    }
    if (!card.question || !card.answer) continue
    const saved = await saveQuestions([{
      question: card.question,
      options: card.options,
      answer: card.answer,
      question_type: card.question_type,
      knowledge_point: card.knowledge_point,
      node_name: card.node_name,
      node_id: card.node_id,
      parent_name: card.parent_name,
      subject_id: card.subject_id || subjectId,
    }], folder?.id ?? 0, subjectId)
    const id = saved.questionIds[0]
    if (id) cards[index] = { ...card, uid: `q-${id}`, question_id: id }
  }
  const presentedIds = cards.map((card) => card.question_id).filter((id): id is number => Number(id) > 0)
  const existingLinks = presentedIds.length
    ? await databaseService.listQuestionKnowledge(presentedIds).catch(() => [])
    : []
  const linkedIds = new Set(existingLinks.map((item) => item.question_id))
  for (const card of cards) {
    if (!card.question_id || linkedIds.has(card.question_id)) continue
    if (!(card.node_id || card.node_name || card.knowledge_point || card.parent_name)) continue
    existingHints.push({
      questionId: card.question_id,
      question: card.question,
      knowledge_point: card.knowledge_point,
      node_name: card.node_name,
      node_id: card.node_id,
      parent_name: card.parent_name,
      subject_id: card.subject_id || subjectId,
    })
  }
  if (existingHints.length) {
    const associated = await associateQuestionsToKnowledge(existingHints, { subjectId, createMissing: true })
    if (associated.linked || associated.created) {
      notifyQuestionKnowledgeUpdated({ subjectId })
      window.dispatchEvent(new CustomEvent('study-graph-updated', { detail: { subjectId } }))
    }
  }
  const links = presentedIds.length
    ? await databaseService.listQuestionKnowledge(presentedIds).catch(() => [])
    : []
  const knowledgeByQuestion = new Map<number, string[]>()
  for (const item of links) {
    const names = knowledgeByQuestion.get(item.question_id) || []
    if (item.node_name && !names.includes(item.node_name)) names.push(item.node_name)
    knowledgeByQuestion.set(item.question_id, names)
  }
  const title = resolveQuizTitle({
    ...args,
    title: args.title || campusQuiz.title,
    paper_name: args.paper_name || campusQuiz.title,
  }, cards)
  saveQuizCards(call.id, cards)
  saveQuizTitle(call.id, title)
  return JSON.stringify({
    presented: cards.length,
    title,
    questions: cards.map((card) => ({
      question_id: card.question_id,
      question: card.question.slice(0, 180),
      question_type: card.question_type,
      importance: card.importance,
      mastery: card.mastery,
      difficulty: card.difficulty,
      knowledge_point: (card.question_id && knowledgeByQuestion.get(card.question_id)?.join('、'))
        || card.node_name
        || card.knowledge_point,
    })),
    message: `已出示 ${cards.length} 道可点选练习，作答会记到关联知识点。现在直接用一两句话收尾，不要再调用任何工具，也不要再列出选项。`,
  })
}

export const quizToolHandlers: Record<string, ChatToolHandler> = {
  present_quiz: presentQuiz,
}
