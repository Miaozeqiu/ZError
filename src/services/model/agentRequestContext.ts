/** 只裁剪发给模型的副本，完整工具记录仍用于对话展示与落盘。 */
export const AGENT_REQUEST_TOKEN_BUDGET = 24 * 1024
const PAGE_TOOLS = new Set(['browser_get_page', 'browser_click', 'browser_click_text', 'browser_type', 'browser_reload', 'browser_find', 'browser_navigate'])

export const estimateRequestTextTokens = (text: string) => {
  let cjk = 0
  let other = 0
  for (const ch of text) {
    const code = ch.codePointAt(0) || 0
    if (code >= 0x2e80 && code <= 0x9fff || code >= 0xf900 && code <= 0xfaff || code >= 0xff00 && code <= 0xffef) cjk += 1
    else other += 1
  }
  return cjk + Math.ceil(other / 4)
}

const parseObject = (text: unknown): Record<string, any> | null => {
  try {
    const parsed = typeof text === 'string' ? JSON.parse(text) : null
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null
  } catch { return null }
}
const clip = (text: string, limit: number) => text.length > limit ? `${text.slice(0, limit)}…（历史内容已精简）` : text
const frameMeta = (frame: any) => {
  if (!frame || typeof frame !== 'object') return frame
  return Object.fromEntries(['id', 'frameId', 'path', 'name', 'label', 'url', 'cross', 'priority'].filter(key => frame[key] !== undefined).map(key => [key, frame[key]]))
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
    const summary = Object.fromEntries(['ok', 'error', 'reason', 'url', 'title', 'text', 'navigated', 'frame', 'empty', 'captcha'].filter(key => next[key] !== undefined).map(key => [key, next[key]]))
    return JSON.stringify({ ...summary, history: '旧页面快照已省略，定位使用最新快照；需要旧内容时重新读取。' })
  }
  return JSON.stringify(next)
}
const historicalContent = (text: string, limit: number) => {
  if (text.length <= limit) return text
  const data = parseObject(text)
  if (!data) return clip(text, limit)
  return JSON.stringify({
    ...Object.fromEntries(['ok', 'error', 'reason', 'url', 'title', 'status', 'finished', 'summary'].filter(key => data[key] !== undefined).map(key => [key, data[key]])),
    historyExcerpt: clip(text, limit),
  })
}

export const compactAgentRequestMessages = (messages: any[], toolImageMessages = new Set<any>()) => {
  const pages = messages.flatMap((message, index) => message.role === 'tool' && PAGE_TOOLS.has(message.name) ? [index] : [])
  const recentPages = new Set(pages.slice(-3))
  const latestImage = [...messages].reverse().find(message => toolImageMessages.has(message))
  let next = messages.map((message, index) => {
    if (toolImageMessages.has(message) && message !== latestImage) {
      return { ...message, content: '先前工具截图已省略，请参考识别结论；需要图像时重新截图。' }
    }
    if (message.role === 'tool' && PAGE_TOOLS.has(message.name)) {
      return { ...message, content: pageContent(String(message.content || ''), !recentPages.has(index)) }
    }
    // 最近的非页面结果（题目、文件等）保持完整；更早的结果只保留摘要。
    if (message.role === 'tool' && index < messages.length - 12) {
      return { ...message, content: historicalContent(String(message.content || ''), 1600) }
    }
    return message
  })
  const tokens = () => estimateRequestTextTokens(JSON.stringify(next).replace(/data:image\/[^"\s]+/g, '[图片]'))
  if (tokens() > AGENT_REQUEST_TOKEN_BUDGET) {
    // 保持 assistant/tool 成对及 tool_call_id，进一步精简旧结果，不删除用户目标。
    next = next.map((message, index) => message.role === 'tool' && index < next.length - 6
      ? { ...message, content: historicalContent(String(message.content || ''), 400) }
      : message)
  }
  return next
}
