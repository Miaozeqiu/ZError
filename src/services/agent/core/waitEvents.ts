import type { AgentWaitResult } from '../agentWait'

export type AgentWakeEvent = Omit<Partial<AgentWaitResult>, 'ok' | 'waited'>
const handlers = new Map<string, (event: AgentWakeEvent) => boolean>()

export const registerAgentWait = (sessionId: string, handler: (event: AgentWakeEvent) => boolean) => {
  handlers.set(sessionId, handler)
}
export const unregisterAgentWait = (sessionId: string) => { handlers.delete(sessionId) }
export const hasAgentWait = (sessionId: string) => handlers.has(sessionId)
export const wakeAgentWait = (sessionId: string, event: AgentWakeEvent = {}) => handlers.get(sessionId)?.(event) ?? false
