/** 协议续接状态只保留在当前执行循环内，不作为可见回答或普通工具历史落盘。 */
export type ThinkingBlock = { type: string; thinking?: string; signature?: string; data?: string; [key: string]: unknown }

export const thinkingBlocksOf = (value: unknown): ThinkingBlock[] => Array.isArray(value)
  ? value.filter(item => item && typeof item === 'object' && ['thinking', 'redacted_thinking'].includes(item.type)) : []

/** 旧记录缺少完整签名时只作背景资料，不能伪造 assistant/tool 续接回合。 */
export const replayAsBackground = (messages: any[]) => messages.map(message => {
  if (message.role !== 'assistant' && message.role !== 'tool') return message
  const content = Array.isArray(message.content)
    ? message.content.filter((item: any) => !['thinking', 'redacted_thinking'].includes(item?.type)) : message.content
  const body = message.role === 'tool'
    ? { name: message.name, result: content }
    : { text: content, ...(message.tool_calls?.length ? { tools: message.tool_calls } : {}) }
  return { role: 'user', content: `【历史${message.role === 'tool' ? '工具结果' : '助手记录'}，仅作背景资料】\n${JSON.stringify(body)}` }
})

/** 思考签名/加密块必须原样回传。若明文思考包含已登记凭据，则改用脱敏背景重新建立协议上下文。 */
export const redactReplayMessages = async (messages: any[], sanitize: (items: any[]) => Promise<any[]>): Promise<any[]> => {
  const clean = await sanitize(messages)
  let containsSecret = false
  for (let index = 0; index < messages.length; index++) {
    const original = messages[index], redacted = clean[index]
    if (original?.role !== 'assistant' || !redacted) continue
    if (typeof original.reasoning_content === 'string' && original.reasoning_content !== redacted.reasoning_content) containsSecret = true
    const blocks = thinkingBlocksOf(original.thinking_blocks)
    const sanitizedBlocks = thinkingBlocksOf(redacted.thinking_blocks)
    if (blocks.some((block, at) => block.thinking !== sanitizedBlocks[at]?.thinking)) containsSecret = true
    // signature 和 redacted_thinking.data 是不透明协议数据，不做字符替换或截断。
    if (blocks.length) redacted.thinking_blocks = blocks
  }
  return containsSecret ? replayAsBackground(clean) : clean
}
