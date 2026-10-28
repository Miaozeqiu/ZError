import type { ImportTaskStep } from '../app/importTasks'

export interface AgentQuizAttempt {
  stepId: string
  uid: string
  question_id?: number
  question: string
  options?: string
  selected: string
  answer: string
  correct?: boolean
  note?: string
  explanation?: string
  index?: number
  total?: number
  kind?: 'submit' | 'note'
}

export interface AgentStudyEvalNote {
  status: 'running' | 'done' | 'empty' | 'failed'
  text: string
  updated?: number
}

export interface AgentChatAttachment {
  kind?: 'file' | 'folder' | 'image'
  filePath: string
  fileName: string
  folderId?: number
  folderName?: string
  folderPath?: string
  imageUrl?: string
  mimeType?: string
}

export interface AgentTodoItem {
  id: string
  text: string
  status: 'pending' | 'done' | 'cancelled'
  reason?: string
}

export type AgentTranscriptItem = {
  role: string
  content?: unknown
  name?: string
  tool_call_id?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: { name: string; arguments: string }
  }>
}

export interface AgentChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  kind?: 'watch'
  /** 发给模型的用户正文；监控钩子的展示文案和模型文案不同时才写 */
  modelContent?: string
  attachments?: AgentChatAttachment[]
  steps: ImportTaskStep[]
  /** 本轮按模型回合回放的 assistant / tool 消息 */
  transcript?: AgentTranscriptItem[]
  todos?: AgentTodoItem[]
  quizAttempts?: AgentQuizAttempt[]
  quizReported?: boolean
  studyEval?: AgentStudyEvalNote
  status: 'streaming' | 'done' | 'failed' | 'stopped'
  waiting?: boolean
  awaitingVideo?: boolean
  /** 消息生成结束与任务实际完成分别记录；旧消息没有此字段。 */
  taskOutcome?: 'completed' | 'blocked' | 'incomplete'
  stopReason?: 'user' | 'browser-takeover'
  error?: string
}

export interface AgentContextSummary {
  text: string
  // 摘要覆盖到哪条消息（含）。用 id 而不是下标，避免消息增删后错位
  coveredThrough: string
  coveredCount: number
  tokens: number
  updatedAt: number
}

export type AgentSubagentKind = 'explore' | 'execute'

export type AgentSubagentJobStatus = 'running' | 'done' | 'failed' | 'stopped'

export interface AgentSubagentJob {
  id: string
  parentSessionId: string
  kind: AgentSubagentKind
  goal: string
  todoId?: string
  status: AgentSubagentJobStatus
  summary?: string
  url?: string
  card?: unknown
  error?: string
  startedAt: number
  endedAt?: number
}

export interface AgentChatSession {
  id: string
  title: string
  messages: AgentChatMessage[]
  attachments?: AgentChatAttachment[]
  studySubjectId?: number
  browserId?: string
  /** 当前对话拥有的标签页；browserId 为当前操作的标签。 */
  browserIds?: string[]
  parentId?: string
  role?: 'parent' | AgentSubagentKind
  todos?: AgentTodoItem[]
  jobs?: AgentSubagentJob[]
  contextSummary?: AgentContextSummary
  createdAt: number
  updatedAt: number
}

export type AgentContextUsage = {
  limit: number
  used: number
  remain: number
  percent: number
  system: number
  tools: number
  summary: number
  history: number
  study: number
  draft: number
  images: number
  compactedCount: number
}
