import { estimateContextTokens, estimateTextTokens } from './contextBudget'
import { projectToolResult } from './toolResultProjection'
/** 只裁剪发给模型的副本，完整工具文字记录仍用于对话展示与加密落盘。 */
export const AGENT_REQUEST_TOKEN_BUDGET = 24 * 1024
const PAGE_TOOLS = new Set(['browser_get_page', 'browser_click', 'browser_click_text', 'browser_type', 'browser_reload', 'browser_find', 'browser_navigate'])

export const estimateRequestTextTokens = estimateTextTokens
export const isToolImageMessage = (message: any) => message?.__agentToolImage === true

const parseObject = (text: unknown): Record<string, any> | null => {
  try {
    const parsed = typeof text === 'string' ? JSON.parse(text) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch { return null }
}
const clip = (text: string, limit: number) => text.length > limit ? `${text.slice(0, limit)}…（历史内容已精简）` : text
const frameMeta = (frame: any) => {
  if (!frame || typeof frame !== 'object') return frame
  return Object.fromEntries(['id', 'frameId', 'loaderId', 'path', 'name', 'label', 'url', 'cross', 'priority'].filter(key => frame[key] !== undefined).map(key => [key, frame[key]]))
}
const pageContent = (text: string, old: boolean) => {
  const data = parseObject(text)
  if (!data) return clip(text, old ? 300 : 8000)
  const next = { ...data }
  // refs 属于执行器的定位索引，模型使用 snapshot 中的 ref 即可。
  delete next.refs
  if (Array.isArray(next.frames)) next.frames = next.frames.map(frameMeta)
  if (next.preferredFrame) next.preferredFrame = frameMeta(next.preferredFrame)
  if (old) {
    const summary = Object.fromEntries(['ok', 'error', 'reason', 'url', 'title', 'navigated', 'frame', 'empty', 'captcha', 'observation_id', 'operation_id', 'resultUncertain', 'pendingOperations'].filter(key => next[key] !== undefined).map(key => [key, next[key]]))
    return JSON.stringify({ ...summary, history: '旧页面快照已省略，定位使用最新快照；需要旧内容时重新读取。' })
  }
  return JSON.stringify(next)
}
const historicalContent = projectToolResult

export const compactAgentRequestMessages = (messages: any[], toolImageMessages = new Set<any>(), budget = AGENT_REQUEST_TOKEN_BUDGET) => {
  const pages = messages.flatMap((message, index) => message.role === 'tool' && PAGE_TOOLS.has(message.name) ? [index] : [])
  const recentPages = new Set(pages.slice(-3))
  const image = (message: any) => isToolImageMessage(message) || toolImageMessages.has(message)
  const latestImage = [...messages].reverse().find(image)
  let next = messages.map((message, index) => {
    if (image(message) && message !== latestImage) {
      return { ...message, content: '先前工具截图已省略，请参考识别结论；需要图像时重新截图。' }
    }
    if (message.role === 'tool' && PAGE_TOOLS.has(message.name)) {
      return { ...message, content: historicalContent(pageContent(String(message.content || ''), !recentPages.has(index)), 12000, message.tool_call_id) }
    }
    // 最近的非页面结果（题目、文件等）保持完整；更早的结果只保留摘要。
    if (message.role === 'tool' && index < messages.length - 12) {
      return { ...message, content: historicalContent(String(message.content || ''), 1600, message.tool_call_id) }
    }
    if (message.role === 'tool') return { ...message, content: historicalContent(String(message.content || ''), 16000, message.tool_call_id) }
    return message
  })
  if (estimateContextTokens(next) > budget) {
    // 保持 assistant/tool 成对及 tool_call_id，进一步精简旧结果，不删除用户目标。
    next = next.map((message, index) => message.role === 'tool' && index < next.length - 6
      ? { ...message, content: historicalContent(String(message.content || ''), 400, message.tool_call_id) }
      : message)
  }
  return next
}
