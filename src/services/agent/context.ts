import { isImageAttachment } from './folderTokens'
import { messageHistoryText } from './modelHistory'
import { AGENT_SYSTEM_PROMPT } from './prompts'
import { assembleAgentTools } from './tools'
import { peekAppBrowserUrl } from '../browser/appBrowser'
import { buildModelHistory } from './modelHistory'
import { compactAgentRequestMessages } from '../model/agentRequestContext'
import type { AgentChatSession, AgentContextSummary, AgentContextUsage } from './chatTypes'

export const AGENT_CONTEXT_LIMIT = 256 * 1024
// 达到这个用量就在后台把早期对话压成摘要
export const AGENT_CONTEXT_COMPACT_AT = 192 * 1024
export const BROWSER_CONTEXT_COMPACT_AT = 32 * 1024
// 压缩后保留的近期原文预算，留足空间让摘要 + 近况都能进请求
export const CONTEXT_KEEP_TOKENS = 48 * 1024
export const BROWSER_CONTEXT_KEEP_TOKENS = 12 * 1024
export const CONTEXT_KEEP_MIN_MESSAGES = 4
export const CONTEXT_COMPACT_MIN_MESSAGES = 4
export const CONTEXT_COMPACT_INPUT_TOKENS = 100 * 1024
export const CONTEXT_COMPACT_MSG_CHARS = 4800
const IMAGE_CONTEXT_TOKENS = 765
const STUDY_PREFIX_SAMPLE = '【学习状态】当前对话挂着科目（subject_id=000）。掌握进度 00%，约 00 个知识点。讲解、出题、改图谱时默认用这个科目，不要另建同名科目。订正或复习错题时调用 list_recent_wrong_questions。\n\n'

export const estimateTextTokens = (text: string) => {
  const raw = String(text || '')
  if (!raw) return 0
  let cjk = 0
  let other = 0
  for (const ch of raw) {
    const code = ch.codePointAt(0) || 0
    if (code >= 0x2e80 && code <= 0x9fff || code >= 0xf900 && code <= 0xfaff || code >= 0xff00 && code <= 0xffef) {
      cjk += 1
    } else {
      other += 1
    }
  }
  return cjk + Math.ceil(other / 4)
}

export const messagePlainText = (content: unknown) => {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && 'text' in part) return String((part as { text?: unknown }).text || '')
      return ''
    }).join('\n')
  }
  return content == null ? '' : String(content)
}

let cachedSystemTokens = 0
let cachedToolSignature = ''
let cachedToolTokens = 0

// 摘要之后的消息才会原文进请求，摘要之前的只由摘要代表。
// 摘要里的 coveredThrough 找不到时视为失效，退回全量原文。
export const splitCompactedHistory = (session?: AgentChatSession | null) => {
  const messages = session?.messages || []
  const summary = session?.contextSummary
  if (!summary?.text) return { summary: null, kept: messages, compactedCount: 0 }
  const index = messages.findIndex((item) => item.id === summary.coveredThrough)
  if (index < 0) return { summary: null, kept: messages, compactedCount: 0 }
  return { summary, kept: messages.slice(index + 1), compactedCount: index + 1 }
}

export const contextSummaryPrompt = (summary?: AgentContextSummary | null) => (
  summary?.text
    ? `\n\n【前文摘要】这轮对话早期的 ${summary.coveredCount} 条消息已归档成下面的摘要，原文不再随请求发送。把它当作已经发生过的事实，需要更早的细节就直接说不记得并请用户补充，不要编造。\n${summary.text}`
    : ''
)

export const estimateAgentContext = (
  session?: AgentChatSession | null,
  draftText = '',
  pendingImages = 0,
): AgentContextUsage => {
  if (!cachedSystemTokens) cachedSystemTokens = estimateTextTokens(AGENT_SYSTEM_PROMPT)
  const systemTokens = cachedSystemTokens
  const tools = assembleAgentTools(peekAppBrowserUrl(session?.browserId || ''))
  const toolSignature = tools.map(tool => tool.function.name).join(',')
  if (toolSignature !== cachedToolSignature) {
    cachedToolSignature = toolSignature
    cachedToolTokens = estimateTextTokens(JSON.stringify(tools))
  }
  const toolTokens = cachedToolTokens
  const { summary, kept, compactedCount } = splitCompactedHistory(session)
  const summaryTokens = summary ? estimateTextTokens(contextSummaryPrompt(summary)) : 0
  // 使用实际回放结构估算，不能拿每条工具仅 1200 字符的展示摘要代替。
  const replay = buildModelHistory(kept)
  const history = estimateTextTokens(JSON.stringify(compactAgentRequestMessages(replay)))
  const study = session?.studySubjectId ? estimateTextTokens(STUDY_PREFIX_SAMPLE) : 0
  const draft = estimateTextTokens(draftText)
  const imageCount = kept.reduce((sum, item) => (
    sum + (item.attachments || []).filter(isImageAttachment).length
  ), Math.max(0, pendingImages))
  const images = imageCount * IMAGE_CONTEXT_TOKENS
  const used = Math.min(
    AGENT_CONTEXT_LIMIT,
    systemTokens + toolTokens + summaryTokens + history + study + draft + images,
  )
  return {
    limit: AGENT_CONTEXT_LIMIT,
    used,
    remain: Math.max(0, AGENT_CONTEXT_LIMIT - used),
    percent: Math.min(100, (used / AGENT_CONTEXT_LIMIT) * 100),
    system: systemTokens,
    tools: toolTokens,
    summary: summaryTokens,
    history,
    study,
    draft,
    images,
    compactedCount,
  }
}
