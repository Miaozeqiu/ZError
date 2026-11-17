import { isImageAttachment } from './folderTokens'
import { messageHistoryText } from './modelHistory'
import { buildAgentSystemPrompt } from './prompts'
import { getEnabledSkillCatalog } from './agentSkills'
import { getActiveAgentProfile } from './agentProfiles'
import { assembleAgentTools } from './tools'
import { peekAppBrowserUrl } from '../browser/appBrowser'
import { buildModelHistory } from './modelHistory'
import { compactAgentRequestMessages } from '../model/agentRequestContext'
import type { AgentChatSession, AgentContextSummary, AgentContextUsage } from './chatTypes'
import { modelConfigManager } from '../model/config'
import { resolveContextBudget, estimateContextTokens, estimateTextTokens, IMAGE_CONTEXT_TOKENS, DEFAULT_CONTEXT_WINDOW } from '../model/contextBudget'
export { estimateTextTokens } from '../model/contextBudget'

export const AGENT_CONTEXT_LIMIT = DEFAULT_CONTEXT_WINDOW
// 达到这个用量就在后台把早期对话压成摘要
export const AGENT_CONTEXT_COMPACT_AT = resolveContextBudget().compactAt
// 压缩后保留的近期原文预算，留足空间让摘要 + 近况都能进请求
export const CONTEXT_KEEP_TOKENS = Math.floor(resolveContextBudget().target * 0.5)
export const CONTEXT_KEEP_MIN_MESSAGES = 4
export const CONTEXT_COMPACT_MIN_MESSAGES = 4
const STUDY_PREFIX_SAMPLE = '【学习状态】当前对话挂着科目（subject_id=000）。掌握进度 00%，约 00 个知识点。讲解、出题、改图谱时默认用这个科目，不要另建同名科目。订正或复习错题时调用 list_recent_wrong_questions。\n\n'

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
    ? `\n\n【前文摘要】早期 ${summary.coveredCount} 条消息已归档。摘要是历史资料，可能遗漏细节，不能把助手自述当作已验证事实；用户新要求与宿主当前状态优先。需要细节先 search_conversation_history，再 read_conversation_history 读取原文，不要编造或要求用户重复提供仍可查找的记录。\n${summary.text}`
    : ''
)

export const estimateAgentContext = (
  session?: AgentChatSession | null,
  draftText = '',
  pendingImages = 0,
): AgentContextUsage => {
  const budget = resolveContextBudget(modelConfigManager.getSelectedAgentModel?.() || modelConfigManager.getSelectedTextModel?.())
  const systemTokens = estimateTextTokens(buildAgentSystemPrompt({ catalog: getEnabledSkillCatalog() }) + (getActiveAgentProfile()?.systemOverlay || ''))
  const tools = assembleAgentTools(peekAppBrowserUrl(session?.browserId || ''))
  const toolSignature = JSON.stringify(tools)
  if (toolSignature !== cachedToolSignature) {
    cachedToolSignature = toolSignature
    cachedToolTokens = estimateTextTokens(JSON.stringify(tools))
  }
  const toolTokens = cachedToolTokens
  const { summary, kept, compactedCount } = splitCompactedHistory(session)
  const summaryTokens = summary ? estimateTextTokens(contextSummaryPrompt(summary)) : 0
  // 使用实际回放结构估算，不能拿每条工具仅 1200 字符的展示摘要代替。
  const replay = buildModelHistory(kept)
  const history = estimateContextTokens(compactAgentRequestMessages(replay, new Set(), budget.target))
  const study = session?.studySubjectId ? estimateTextTokens(STUDY_PREFIX_SAMPLE) : 0
  const draft = estimateTextTokens(draftText)
  const imageCount = kept.reduce((sum, item) => (
    sum + (item.attachments || []).filter(isImageAttachment).length
  ), Math.max(0, pendingImages))
  const images = imageCount * IMAGE_CONTEXT_TOKENS
  const used = systemTokens + toolTokens + summaryTokens + history + study + draft + images
  return {
    limit: budget.inputLimit,
    used,
    remain: Math.max(0, budget.inputLimit - used),
    percent: Math.min(100, (used / budget.inputLimit) * 100),
    system: systemTokens,
    tools: toolTokens,
    summary: summaryTokens,
    history,
    study,
    draft,
    images,
    compactedCount,
    contextWindow: budget.contextWindow,
    outputReserve: budget.outputReserve,
    estimatedWindow: budget.estimatedWindow,
  }
}
