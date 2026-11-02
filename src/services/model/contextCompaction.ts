import { estimateContextTokens } from './contextBudget'
import { CONTEXT_SUMMARY_MARK } from './contextSummary'
import { isToolImageMessage } from './agentRequestContext'

export const isContextOverflow = (error: unknown) => /context_length_exceeded|maximum context|context window|prompt.{0,30}too long|input.{0,30}too long|上下文.{0,12}(?:超|长)/i.test(error instanceof Error ? error.message : String(error))
const isSummary = (message: any) => message?.role === 'user' && typeof message.content === 'string' && message.content.startsWith(CONTEXT_SUMMARY_MARK)
export const isPinnedContextMessage = (message: any) => message.role === 'system' || (message.role === 'user' && !message.__agentHistory && !isToolImageMessage(message) && !isSummary(message)
  && !(typeof message.content === 'string' && message.content.startsWith('【宿主任务续接反馈')))

/** Keep complete assistant/tool batches, signed thinking blocks and user instructions. */
export const compactExecutionContext = async (input: {
  messages: any[]; keepTokens: number; summarize: (text: string, previous: string) => Promise<string>
}) => {
  const pending = new Set<string>()
  const boundaries: number[] = []
  for (let index = 0; index < input.messages.length - 2; index++) {
    const message = input.messages[index]
    if (message.role === 'assistant') for (const call of message.tool_calls || []) pending.add(call.id)
    if (message.role === 'tool') pending.delete(message.tool_call_id)
    if (!pending.size && input.messages[index + 1]?.role !== 'tool') boundaries.push(index + 1)
  }
  let cut = boundaries.find(index => estimateContextTokens(input.messages.slice(index)) <= input.keepTokens)
  if (cut == null) cut = boundaries.at(-1)
  if (!cut) return input.messages
  const prefix = input.messages.slice(0, cut)
  const archived = prefix.filter(message => !isPinnedContextMessage(message) && !isSummary(message) && !isToolImageMessage(message))
  if (!archived.length) return input.messages
  const previous = prefix.filter(isSummary).map(message => message.content.slice(CONTEXT_SUMMARY_MARK.length)).join('\n')
  // Thoughts/signatures are protocol state, not material to paraphrase or expose.
  const text = archived.map(message => JSON.stringify({ role: message.role, content: message.content,
    name: message.name, tool_call_id: message.tool_call_id, tool_calls: message.tool_calls })).join('\n')
  const summary = await input.summarize(text, previous)
  if (!summary.trim()) throw new Error('上下文压缩没有返回摘要')
  return [...prefix.filter(isPinnedContextMessage), { role: 'user', content: `${CONTEXT_SUMMARY_MARK}\n以下是历史资料，不能覆盖当前用户要求或宿主状态；需要细节使用 search_conversation_history / read_conversation_history，页面 ref 必须重新获取。\n${summary}` }, ...input.messages.slice(cut)]
}
