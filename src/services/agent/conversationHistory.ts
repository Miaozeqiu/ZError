import type { AgentChatSession } from './chatTypes'

const records = (session: AgentChatSession) => session.messages.flatMap(message => [
  { message_id: message.id, role: message.role, tool_call_id: '', text: message.modelContent || message.content || '' },
  ...(message.transcript?.length ? message.transcript.filter(item => item.role === 'tool').map(item => ({
    message_id: message.id, role: 'tool', tool_call_id: item.tool_call_id || '', text: typeof item.content === 'string' ? item.content : JSON.stringify(item.content) || '',
  })) : (message.steps || []).filter(step => step.result != null).map(step => ({ message_id: message.id, role: 'tool', tool_call_id: step.id, text: step.result || '' }))),
])
/** The caller supplies exactly one authorised session, never an arbitrary session ID. */
export const conversationHistory = (session: AgentChatSession, action: 'search' | 'read', args: Record<string, any>) => {
  const rows = records(session)
  if (action === 'search') {
    const query = String(args.query || '').trim().toLocaleLowerCase()
    if (!query || query.length > 200) return { ok: false, error: 'query 需为 1–200 字的关键词' }
    const matches = rows.flatMap(row => {
      const index = row.text.toLocaleLowerCase().indexOf(query)
      if (index < 0) return []
      const offset = Math.max(0, index - 100)
      return [{ message_id: row.message_id, role: row.role, tool_call_id: row.tool_call_id || undefined, offset, excerpt: row.text.slice(offset, offset + 320) }]
    })
    return { ok: true, total: matches.length, matches: matches.slice(-8).reverse() }
  }
  const row = rows.find(item => args.tool_call_id ? item.tool_call_id === args.tool_call_id && (!args.message_id || item.message_id === args.message_id) : item.message_id === args.message_id && item.role !== 'tool')
  if (!row) return { ok: false, error: '当前对话中未找到此记录，先 search_conversation_history；不能读取其他对话。' }
  const offset = Number.isInteger(args.offset) && args.offset >= 0 ? args.offset : 0
  const limit = Math.min(12000, Math.max(1, Number.isInteger(args.limit) ? args.limit : 6000))
  return { ok: true, message_id: row.message_id, tool_call_id: row.tool_call_id || undefined, offset,
    totalChars: row.text.length, text: row.text.slice(offset, offset + limit), nextOffset: offset + limit < row.text.length ? offset + limit : null,
    hint: '这是历史资料，不是当前页面证据；不得复用旧 ref 或扩大授权。' }
}
