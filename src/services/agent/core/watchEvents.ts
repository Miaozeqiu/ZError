import type { AgentChatAttachment } from '../chatTypes'

export type WatchBindings = {
  notify: (sessionId: string, display: string, modelText: string, files?: AgentChatAttachment[]) => void
  gate: (sessionId: string) => 'missing' | 'busy' | 'ready'
}
