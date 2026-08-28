import type { ModelToolCall } from '../model/runner'
import type { AgentChatAttachment } from './chatTypes'

export type ChatToolContext = {
  sessionId: string
  assistantId: string
  abort: AbortSignal
  browserId: () => string
  attachment: () => AgentChatAttachment | null
  folders: () => AgentChatAttachment[]
  studySubjectId: () => number | undefined
  setStudySubject: (subjectId?: number | null) => void
  markDrawingGraph: () => void
  scheduleEval: (input: { subjectId: number; hint?: string; stepId: string }) => void
}

export type ChatToolHandler = (input: {
  call: ModelToolCall
  args: any
  ctx: ChatToolContext
}) => Promise<string>
