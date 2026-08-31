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
}

export interface AgentChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  kind?: 'watch'
  attachments?: AgentChatAttachment[]
  steps: ImportTaskStep[]
  todos?: AgentTodoItem[]
  quizAttempts?: AgentQuizAttempt[]
  quizReported?: boolean
  studyEval?: AgentStudyEvalNote
  status: 'streaming' | 'done' | 'failed' | 'stopped'
  waiting?: boolean
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

export interface AgentChatSession {
  id: string
  title: string
  messages: AgentChatMessage[]
  attachments?: AgentChatAttachment[]
  studySubjectId?: number
  browserId?: string
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
