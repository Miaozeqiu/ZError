import type { AgentChatSession, AgentChatMessage } from '../agent/chatTypes'

export const sessionBusy = (session: AgentChatSession) => session.messages.some(message => message.status === 'streaming')
const terminalStatus = (message: AgentChatMessage) => {
  if (message.status === 'failed' || message.status === 'stopped') return message.status
  if (message.status === 'streaming') return message.run?.status || 'running'
  if (message.taskOutcome === 'blocked' || message.taskOutcome === 'incomplete') return message.taskOutcome
  return message.run?.status || message.status
}

export function taskSnapshot(session: AgentChatSession, messageId?: string, details = false) {
  const scoped = messageId !== undefined
  const message = scoped ? session.messages.find(row => row.role === 'assistant' && row.id === messageId) : session.messages.filter(row => row.role === 'assistant').at(-1)
  if (scoped && !message) throw new Error('指定的任务消息不存在，可能已删除；不会读取其他任务代替')
  return {
    id: session.id, messageId: message?.id, title: session.title, browserId: session.browserId,
    updatedAt: session.updatedAt, busy: scoped ? message?.status === 'streaming' : sessionBusy(session),
    status: message ? terminalStatus(message) : 'idle', outcome: message?.taskOutcome,
    ...(details ? { messages: (scoped && message ? [message] : session.messages.slice(-6)).map(row => ({
      id: row.id, role: row.role, content: row.content.slice(-16000), truncated: row.content.length > 16000,
      status: row.status, error: row.error, run: row.run,
      steps: row.steps.slice(-20).map(step => ({ id: step.id, name: step.name, label: step.label, status: step.status, result: step.result?.slice(0, 4000) })),
    })) } : {}),
  }
}
