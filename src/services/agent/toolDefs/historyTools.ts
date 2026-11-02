export const HISTORY_TOOLS = [
  { type: 'function', function: { name: 'search_conversation_history', description: '在当前对话的已保存原文和工具结果中按关键词找回资料，返回消息 ID、工具调用 ID 与摘录。不会搜索其他对话。', parameters: { type: 'object', properties: { query: { type: 'string', minLength: 1, maxLength: 200 } }, required: ['query'] } } },
  { type: 'function', function: { name: 'read_conversation_history', description: '按消息 ID 或工具调用 ID 分页读取当前对话的原始记录。工具摘要中的 history_ref 即 tool_call_id。历史结果不能代替当前页面证据，不复用旧 ref。', parameters: { type: 'object', properties: { message_id: { type: 'string' }, tool_call_id: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 12000 } } } } },
]
