import type { ModelToolCall } from '../model/runner'
import type { AgentChatAttachment, AgentSubagentKind } from './chatTypes'

export type AgentToolRole = 'parent' | AgentSubagentKind

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
  getTodos?: () => import('./chatTypes').AgentTodoItem[]
  setTodos?: (todos: import('./chatTypes').AgentTodoItem[]) => void
  role?: AgentToolRole
  parentSessionId?: string
  parentAssistantId?: string
  parentStepId?: string
  jobId?: string
}

export type ChatToolHandler = (input: {
  call: ModelToolCall
  args: any
  ctx: ChatToolContext
}) => Promise<string>
