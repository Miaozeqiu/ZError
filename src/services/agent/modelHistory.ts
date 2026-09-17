import type { ImportTaskStep } from '../app/importTasks'
import type { AgentChatMessage, AgentTranscriptItem } from './chatTypes'

/** 落盘与近几轮回放的上限 */
export const TOOL_ARGS_KEEP = 8000
export const TOOL_RESULT_KEEP = 16000
/** 更早但仍在保留窗口里的轮次，先裁工具结果 */
export const TOOL_ARGS_OLD = 800
export const TOOL_RESULT_OLD = 1600
export const RECENT_ASSISTANT_TURNS = 3

export type ClipLimits = {
  args: number
  result: number
}

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

export const clipTranscript = (
  items: ModelHistoryItem[] = [],
  limits: ClipLimits = { args: TOOL_ARGS_KEEP, result: TOOL_RESULT_KEEP },
): ModelHistoryItem[] => (
  items.map((item) => {
    if (item.role === 'tool') {
      return { ...item, content: clipToolText(item.content, limits.result) }
    }
    if (item.role === 'assistant' && item.tool_calls?.length) {
      return {
        ...item,
        content: typeof item.content === 'string' ? clipToolText(item.content, limits.result) : item.content,
        tool_calls: item.tool_calls.map((call) => ({
          ...call,
          function: {
            ...call.function,
            arguments: clipToolText(call.function?.arguments, limits.args),
          },
        })),
      }
    }
    if (typeof item.content === 'string') {
      return { ...item, content: clipToolText(item.content, limits.result) }
    }
    return item
  })
)

export const assistantTurnToHistory = (
  message: AgentChatMessage,
  limits?: ClipLimits,
): ModelHistoryItem[] => {
  if (message.transcript?.length) return clipTranscript(message.transcript, limits)
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
  return limits ? clipTranscript(out, limits) : out
}

export const buildModelHistory = (
  messages: AgentChatMessage[],
  mapUser?: (message: AgentChatMessage) => unknown,
): ModelHistoryItem[] => {
  const assistantAt = messages
    .map((message, index) => (message.role === 'assistant' ? index : -1))
    .filter((index) => index >= 0)
  const recentStart = assistantAt.length <= RECENT_ASSISTANT_TURNS
    ? 0
    : assistantAt[assistantAt.length - RECENT_ASSISTANT_TURNS]
  const out: ModelHistoryItem[] = []
  messages.forEach((message, index) => {
    if (message.role === 'user') {
      const content = mapUser ? mapUser(message) : (message.modelContent || message.content)
      if (content) out.push({ role: 'user', content })
      return
    }
    const recent = index >= recentStart
    out.push(...assistantTurnToHistory(message, recent
      ? { args: TOOL_ARGS_KEEP, result: TOOL_RESULT_KEEP }
      : { args: TOOL_ARGS_OLD, result: TOOL_RESULT_OLD }))
  })
  return out
}

const transcriptAsText = (items: AgentTranscriptItem[]) => {
  const lines: string[] = []
  for (const item of items) {
    if (item.role === 'tool') {
      lines.push(`${item.name || 'tool'} 完成 → ${clipToolText(item.content, 1200)}`)
      continue
    }
    if (item.role === 'assistant' && item.tool_calls?.length) {
      for (const call of item.tool_calls) {
        lines.push(`${call.function?.name || 'tool'} ${clipToolText(call.function?.arguments, 400)}`)
      }
      const spoken = typeof item.content === 'string' ? item.content.trim() : ''
      if (spoken) lines.push(spoken)
      continue
    }
    const spoken = typeof item.content === 'string' ? item.content.trim() : ''
    if (spoken) lines.push(spoken)
  }
  return lines.join('\n')
}

export const messageHistoryText = (message: AgentChatMessage) => {
  if (message.transcript?.length) {
    const spoken = String(message.content || '').trim()
    const tools = transcriptAsText(message.transcript)
    return [spoken, tools].filter(Boolean).join('\n')
  }
  const tools = (message.steps || [])
    .filter((step) => step.name)
    .map((step) => {
      const mark = step.status === 'failed' ? '失败' : '完成'
      const args = step.arguments ? ` ${clipToolText(step.arguments, 240)}` : ''
      const result = step.result || step.detail || ''
      return `${step.name} ${mark}${args}${result ? ` → ${clipToolText(result, 800)}` : ''}`
    })
    .join('\n')
  return [String(message.content || '').trim(), tools].filter(Boolean).join('\n')
}
