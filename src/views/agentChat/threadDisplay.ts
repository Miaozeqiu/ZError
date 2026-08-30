import type { AgentChatMessage, AgentChatSession } from '../../services/agent/chat'
import { isFileAttachment, isImageAttachment } from '../../services/agent/chat'
import type { ImportStepPreview, ImportTaskStep } from '../../services/app/importTasks'
import { getQuizCards, getQuizTitle, parseMarkdownQuizzes, parseQuizCards, stripMarkdownQuizzes, type QuizCard } from '../../utils/question/quizPractice'

export const WRITE_PREVIEW_COUNT = 3

export const quizCardsFor = (step: ImportTaskStep): QuizCard[] => {
  const stored = getQuizCards(step.id)
  if (stored.length) return stored
  return parseQuizCards(step.preview || [])
}

export const quizTitleFor = (step?: ImportTaskStep, stepId?: string) =>
  getQuizTitle(step?.id || stepId || '', '') || step?.title || '练习'

export const isBrowseQuizStep = (step?: ImportTaskStep) =>
  step?.name === 'list_campus_questions'
  || step?.name === 'search_campus_questions'
  || step?.name === 'save_campus_questions'
  || step?.name === 'update_campus_question'

export const isQuizStep = (step: ImportTaskStep) =>
  (step.name === 'present_quiz' || isBrowseQuizStep(step))
  && step.status === 'done'
  && quizCardsFor(step).length > 0

export const stepQuizCards = (message: AgentChatMessage) =>
  (message.steps || [])
    .filter((step) => isQuizStep(step))
    .flatMap((step) => quizCardsFor(step))

export const displayAssistantContent = (message: AgentChatMessage) => {
  const dumped = parseMarkdownQuizzes(message.content)
  if (!dumped.length) return message.content
  const stripped = stripMarkdownQuizzes(message.content, dumped)
  return stripped || '请在右侧练习页作答。'
}

export const typeTagKind = (type?: string) => {
  const text = String(type || '').replace(/\s/g, '')
  if (/多选|多项|不定项/.test(text)) return 'multiple'
  if (/判断/.test(text)) return 'judgement'
  if (/填空|简答|解答/.test(text)) return 'fill'
  if (/单选|单项/.test(text)) return 'single'
  return 'other'
}

export const visibleSteps = (steps: ImportTaskStep[]) => {
  const items: ImportTaskStep[] = []
  for (const step of steps) {
    if (step.name === 'evaluate_study_progress') continue
    const dup = items.find((item) => {
      if (item.name !== step.name) return false
      if (item.name === 'get_file_info' || item.name === 'list_folders') return true
      return item.target === step.target && item.label === step.label
    })
    if (!dup) {
      items.push(step)
      continue
    }
    if (step.status === 'done' || step.status === 'failed') {
      items[items.indexOf(dup)] = { ...dup, ...step, id: dup.id }
    }
  }
  return items
}

export type AssistantTimelineBlock =
  | { type: 'text'; key: string; content: string }
  | { type: 'step'; key: string; step: ImportTaskStep }

/** 按工具调用时的正文位置穿插显示，避免工具全部挤在最前面。 */
export const assistantTimeline = (message: AgentChatMessage): AssistantTimelineBlock[] => {
  const content = displayAssistantContent(message)
  const steps = visibleSteps(message.steps || [])
  if (!steps.length) {
    return content ? [{ type: 'text', key: `${message.id}-text`, content }] : []
  }
  const hasAnchors = steps.some((step) => typeof step.atContentLength === 'number')
  if (!hasAnchors) {
    return [
      ...steps.map((step) => ({ type: 'step' as const, key: step.id, step })),
      ...(content ? [{ type: 'text' as const, key: `${message.id}-text`, content }] : []),
    ]
  }
  const sorted = [...steps].sort((a, b) => {
    const la = a.atContentLength ?? 0
    const lb = b.atContentLength ?? 0
    if (la !== lb) return la - lb
    return (a.startedAt || 0) - (b.startedAt || 0)
  })
  const blocks: AssistantTimelineBlock[] = []
  let cursor = 0
  let textIndex = 0
  for (const step of sorted) {
    const at = Math.min(Math.max(0, step.atContentLength ?? 0), content.length)
    if (at > cursor) {
      blocks.push({
        type: 'text',
        key: `${message.id}-text-${textIndex}`,
        content: content.slice(cursor, at),
      })
      textIndex += 1
      cursor = at
    }
    blocks.push({ type: 'step', key: step.id, step })
  }
  if (cursor < content.length) {
    blocks.push({
      type: 'text',
      key: `${message.id}-text-${textIndex}`,
      content: content.slice(cursor),
    })
  }
  return blocks
}

export const isThinking = (message: AgentChatMessage) =>
  message.status === 'streaming' && message.waiting !== false

export const visiblePreview = (step: ImportTaskStep): ImportStepPreview[] => {
  const items = step.preview || []
  if (items.length <= WRITE_PREVIEW_COUNT) return items
  return items.slice(0, WRITE_PREVIEW_COUNT)
}

export const quizKeyOf = (messageId: string, stepId: string) => `${messageId}\t${stepId}`

export const quizStatFor = (message: AgentChatMessage, stepId: string, cards: QuizCard[], browse = false) => {
  if (browse) return `${cards.length} 题`
  const done = new Set((message.quizAttempts || []).map((item) => item.uid))
  const answered = cards.filter((card) => done.has(card.uid)).length
  if (message.quizReported || (cards.length && answered >= cards.length)) return `已完成 ${cards.length}`
  if (answered) return `${answered}/${cards.length}`
  return `${cards.length} 题`
}

export const firstUserMessageIdOf = (session?: AgentChatSession | null) =>
  session?.messages.find((message) => message.role === 'user')?.id || null

export const attachmentsForMessage = (session: AgentChatSession | null | undefined, message: AgentChatMessage) => {
  if (message.attachments?.length) return message.attachments
  const firstUserId = firstUserMessageIdOf(session)
  if (
    message.role === 'user'
    && message.id === firstUserId
    && !session?.messages.some((item) => item.attachments?.length)
    && session?.attachments?.length
  ) {
    return session.attachments
  }
  return []
}

export const filesForMessage = (session: AgentChatSession | null | undefined, message: AgentChatMessage) =>
  attachmentsForMessage(session, message).filter(isFileAttachment)

export const imagesForMessage = (session: AgentChatSession | null | undefined, message: AgentChatMessage) =>
  attachmentsForMessage(session, message).filter(isImageAttachment)

export const iconPaths = (name: string) => {
  if (name === 'get_file_info') {
    return ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8', 'M8 17h5']
  }
  if (name === 'read_range') {
    return ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z']
  }
  if (name === 'list_folders' || name === 'get_folder_info') {
    return ['M3 7h6l2 2h10v10H3z']
  }
  if (name === 'create_folder') {
    return ['M3 7h6l2 2h8v8H3z', 'M12 11v6', 'M9 14h6']
  }
  if (name === 'rename_folder') {
    return ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z']
  }
  if (name === 'move_folder') {
    return ['M3 7h6l2 2h10v10H3z', 'M8 14h8', 'M13 11l3 3-3 3']
  }
  if (name === 'delete_folder') {
    return ['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 12h10l1-12']
  }
  if (name === 'list_questions' || name === 'search_questions') {
    return ['M4 6h16', 'M4 12h16', 'M4 18h10']
  }
  if (
    name === 'get_campus_status'
    || name === 'list_campus_courses'
    || name === 'list_campus_papers'
    || name === 'list_campus_questions'
    || name === 'search_campus_questions'
    || name === 'list_campus_tags'
    || name === 'create_campus_paper'
    || name === 'update_campus_paper'
    || name === 'save_campus_questions'
    || name === 'update_campus_question'
  ) {
    return ['M4 4h16v6H4z', 'M4 14h7v6H4z', 'M13 14h7v6h-7z']
  }
  if (name === 'move_questions') {
    return ['M4 6h10', 'M4 12h10', 'M4 18h7', 'M14 15l4 3-4 3', 'M18 18H9']
  }
  if (name === 'save_questions') {
    return ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z']
  }
  if (name === 'update_question_metrics') {
    return ['M4 7h16', 'M4 12h10', 'M4 17h7']
  }
  if (name === 'list_recent_wrong_questions' || name === 'get_practice_history' || name === 'add_practice_note') {
    return ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8', 'M8 17h5']
  }
  if (name === 'present_quiz') {
    return ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11']
  }
  if (name === 'list_subjects' || name === 'get_subject' || name === 'create_subject' || name === 'rename_subject' || name === 'delete_subject') {
    return ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z']
  }
  if (name === 'get_knowledge_graph' || name === 'set_knowledge_graph' || name === 'patch_knowledge_graph' || name === 'focus_knowledge_graph' || name === 'open_knowledge_graph') {
    return ['M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M8 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M16 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M8 8l8 1', 'M7 9l2 6', 'M16 10l-1 4']
  }
  if (name === 'evaluate_study_progress') {
    return ['M3 17c3-8 6-10 9-10s6 2 9 10', 'M12 7v10']
  }
  return ['M12 3v3', 'M12 18v3', 'M3 12h3', 'M18 12h3']
}
