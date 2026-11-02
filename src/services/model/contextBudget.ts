/** Shared estimates for the composer, execution and summarisation. Not billing tokens. */
export const DEFAULT_CONTEXT_WINDOW = 64 * 1024
export const IMAGE_CONTEXT_TOKENS = 4096
export const estimateTextTokens = (text: string) => {
  let cjk = 0, other = 0
  for (const ch of String(text || '')) {
    const code = ch.codePointAt(0) || 0
    if (code >= 0x2e80 && code <= 0x9fff || code >= 0xf900 && code <= 0xfaff || code >= 0xff00 && code <= 0xffef) cjk++
    else other++
  }
  return cjk + Math.ceil(other / 4)
}
export const estimateContextTokens = (value: unknown) => {
  let images = 0
  const text = JSON.stringify(value, (key, item) => {
    if (item?.type === 'image_url') { images++; return { type: 'image_url', image_url: '[image]' } }
    if (key === '__agentToolImage') return undefined
    return item
  }) || ''
  return estimateTextTokens(text) + images * IMAGE_CONTEXT_TOKENS
}
export const resolveContextBudget = (model?: { contextWindow?: number; maxTokens?: number; context_window?: unknown; contextLength?: unknown; context_length?: unknown }) => {
  const configured = Number(model?.contextWindow ?? model?.context_window ?? model?.contextLength ?? model?.context_length)
  const contextWindow = Number.isFinite(configured) && configured >= 4096 ? Math.floor(configured) : DEFAULT_CONTEXT_WINDOW
  const requestedOutput = Number(model?.maxTokens)
  const outputReserve = Math.min(Number.isFinite(requestedOutput) && requestedOutput > 0 ? Math.floor(requestedOutput) : 4096, Math.floor(contextWindow / 2))
  const safety = Math.max(512, Math.ceil(contextWindow * 0.03))
  const inputLimit = contextWindow - outputReserve - safety
  const target = Math.min(24 * 1024, Math.floor(inputLimit * 0.65))
  return { contextWindow, outputReserve, safety, inputLimit, target, compactAt: Math.min(inputLimit, Math.floor(target * 1.4)), estimatedWindow: !(Number.isFinite(configured) && configured >= 4096) }
}
export class ContextCapacityError extends Error {
  constructor() { super('当前内容超过模型可用上下文，已停止发送。请缩小本次资料范围或配置更大的模型上下文窗口；已执行的操作不会重放。'); this.name = 'ContextCapacityError' }
}
