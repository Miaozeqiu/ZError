import type { ImportTaskStep } from '../app/importTasks'
import type { AgentChatMessage, AgentTranscriptItem } from './chatTypes'

export const TOOL_ARGS_KEEP = 2000
export const TOOL_RESULT_KEEP = 4000

export type ModelHistoryItem = AgentTranscriptItem

export const clipToolText = (raw: unknown, max: number) => {
  const text = String(raw ?? '')
  if (text.length <= max) return text
  return `${text.slice(0, max)}…(${text.length})`
}

const replayableTools = (steps: ImportTaskStep[] = []) => (
  steps.filter((step) => (
    (step.kind || 'tool') === 'tool'
    && step.name
    && step.arguments != null
  ))
)

export const clipTranscript = (items: ModelHistoryItem[] = []): ModelHistoryItem[] => (
  items.map((item) => {
    if (item.role === 'tool') {
      return { ...item, content: clipToolText(item.content, TOOL_RESULT_KEEP) }
    }
    if (item.role === 'assistant' && item.tool_calls?.length) {
      return {
        ...item,
        content: typeof item.content === 'string' ? clipToolText(item.content, TOOL_RESULT_KEEP) : item.content,
        tool_calls: item.tool_calls.map((call) => ({
          ...call,
          function: {
            ...call.function,
            arguments: clipToolText(call.function?.arguments, TOOL_ARGS_KEEP),
          },
        })),
      }
    }
    if (typeof item.content === 'string') {
      return { ...item, content: clipToolText(item.content, TOOL_RESULT_KEEP) }
    }
    return item
  })
)

export const assistantTurnToHistory = (message: AgentChatMessage): ModelHistoryItem[] => {
  if (message.transcript?.length) return clipTranscript(message.transcript)
  const out: ModelHistoryItem[] = []
  const tools = replayableTools(message.steps)
  if (tools.length) {
    out.push({
      role: 'assistant',
      content: '',
      tool_calls: tools.map((step) => ({
        id: step.id,
        type: 'function',
        function: {
          name: step.name,
          arguments: step.arguments || '{}',
        },
      })),
    })
    for (const step of tools) {
      out.push({
        role: 'tool',
        tool_call_id: step.id,
        name: step.name,
        content: step.result || step.detail || (step.status === 'failed' ? 'failed' : 'ok'),
      })
    }
  } else if (message.steps?.length) {
    const recap = message.steps
      .filter((step) => step.name)
      .map((step) => {
        const mark = step.status === 'failed' ? '失败' : step.status === 'running' ? '进行中' : '完成'
        return `- ${step.name} ${mark}${step.detail ? `：${step.detail}` : ''}`
      })
      .join('\n')
    if (recap) {
      out.push({ role: 'assistant', content: `【本轮工具】\n${recap}` })
    }
  }
  const text = String(message.content || '').trim()
  if (text) out.push({ role: 'assistant', content: text })
  return out
}

export const buildModelHistory = (
  messages: AgentChatMessage[],
  mapUser?: (message: AgentChatMessage) => unknown,
): ModelHistoryItem[] => {
  const out: ModelHistoryItem[] = []
  for (const message of messages) {
    if (message.role === 'user') {
      const content = mapUser ? mapUser(message) : message.content
      if (content) out.push({ role: 'user', content })
      continue
    }
    out.push(...assistantTurnToHistory(message))
  }
  return out
}

export const messageHistoryText = (message: AgentChatMessage) => {
  const tools = (message.steps || [])
    .filter((step) => step.name)
    .map((step) => {
      const mark = step.status === 'failed' ? '失败' : '完成'
      const args = step.arguments ? ` ${clipToolText(step.arguments, 240)}` : ''
      const result = step.result || step.detail || ''
      return `${step.name} ${mark}${args}${result ? ` → ${clipToolText(result, 400)}` : ''}`
    })
    .join('\n')
  return [String(message.content || '').trim(), tools].filter(Boolean).join('\n')
}
