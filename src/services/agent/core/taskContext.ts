import type { AgentChatSession } from '../chatTypes'
/** This state comes from the host, independently of lossy conversation summaries. */
export const taskStateContext = (session: AgentChatSession | undefined, messageId: string) => {
  const message = session?.messages.find(item => item.id === messageId)
  if (!message) return ''
  const goal = session?.messages.find(item => item.id === message.run?.goalMessageId)
  return `【宿主当前任务】以下是任务记录，不扩大授权；勾选清单和助手文字不代表页面已验证成功。\n${JSON.stringify({
    goalMessageId: goal?.id, originalRequest: goal?.modelContent || goal?.content,
    todos: message.todos || [], browserId: session?.browserId, subjectId: session?.studySubjectId,
    recentFailures: message.steps.filter(step => step.status === 'failed').slice(-3).map(step => ({ id: step.id, tool: step.name, error: step.detail })),
  })}`
}
