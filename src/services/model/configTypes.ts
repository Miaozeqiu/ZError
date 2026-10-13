/** 模型 / 平台类型与纯函数。持久化在 configManager.ts，远程目录在 configRemote.ts。 */
import { normalizeApiProtocol } from './protocol'

export type ApiProtocol = 'openai-chat' | 'openai-response' | 'anthropic' | 'custom'

export interface AIPlatform {
  id: string
  name: string
  displayName: string
  baseUrl: string
  apiKey: string
  enabled: boolean
  models: AIModel[]
  /** 平台级协议；该平台下所有模型共用 */
  apiProtocol?: ApiProtocol
  customHeaders?: Record<string, string>
  description?: string
  icon?: string        // 平台图标
  isRemote?: boolean   // 是否来自远程同步（禁止编辑/删除）
  url?: string         // 平台官网/控制台地址
  inviteUrl?: string   // 邀请链接
  inviteText?: string  // 邀请文字
  inviteCode?: string  // 邀请码
}

// AI 模型配置接口
/** 开启思考时的强度：Chat 用 reasoning_effort，Responses/Messages 用 reasoning.effort */
export type ThinkingEffort = 'low' | 'medium' | 'high' | 'max'
/** Responses 关闭思考时 reasoning.effort 取值 */
export type ThinkingOffResponsesEffort = 'none' | 'minimal'

export interface AIModel {
  id: string
  modelId?: string
  displayName: string
  platformId: string
  maxTokens: number
  temperature: number
  topP: number
  enabled: boolean
  category: 'text' | 'vision' | 'summary'
  /** 是否具备视觉能力；远程字段兼容 hasVision / has_vision / vision / capabilities */
  hasVision?: boolean
  description?: string
  jsCode?: string  // 仅自定义协议使用；远程模型忽略此字段
  icon?: string    // 模型图标
  isRemote?: boolean  // 是否来自远程同步（禁止编辑/删除）
  enableThinking?: boolean  // 是否启用思考（reasoning）输出
  /** Chat 关闭：发送 enable_thinking: false（默认 true） */
  thinkingOffEnableThinkingFalse?: boolean
  /** @deprecated 已由 thinkingOffResponsesEffort 替代 */
  thinkingOffEffortNone?: boolean
  /** Chat / Messages 关闭：发送 thinking: { type: "disabled" } */
  thinkingOffThinkingTypeDisabled?: boolean
  /** @deprecated Chat 不再用 reasoning_effort 关闭 */
  thinkingOffReasoningEffortNone?: boolean
  /** Responses 关闭：reasoning.effort = none | minimal（默认 minimal） */
  thinkingOffResponsesEffort?: ThinkingOffResponsesEffort
  /** 开启思考时的强度（默认 medium） */
  thinkingEffort?: ThinkingEffort
  apiProtocol?: ApiProtocol
}

export const inferPlatformApiProtocol = (
  platform?: {
    apiProtocol?: ApiProtocol | string
    models?: Array<{ apiProtocol?: ApiProtocol | string }>
  } | null
): ApiProtocol => {
  if (platform?.apiProtocol) return normalizeApiProtocol(platform.apiProtocol)
  const counts: Record<ApiProtocol, number> = {
    'openai-chat': 0,
    'openai-response': 0,
    anthropic: 0,
    custom: 0,
  }
  for (const model of platform?.models || []) {
    counts[normalizeApiProtocol(model?.apiProtocol)] += 1
  }
  return (Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'openai-chat') as ApiProtocol
}

export const resolveModelApiProtocol = (
  model?: Pick<AIModel, 'apiProtocol'> | null,
  platform?: Pick<AIPlatform, 'apiProtocol'> | null
): ApiProtocol => {
  if (platform?.apiProtocol) return normalizeApiProtocol(platform.apiProtocol)
  return normalizeApiProtocol(model?.apiProtocol)
}

// 模型配置设置接口
export interface ModelSettings {
  selectedTextModel: string | null    // 选中的文本模型（向后兼容，等于 selectedTextModels[0] 或 null）
  selectedTextModels: string[]        // 选中的文本模型列表（最多5个）
  selectedSummaryModel: string | null // 选中的总结模型（向后兼容，等于 selectedSummaryModels[0] 或 null）
  selectedSummaryModels: string[]     // 选中的总结模型列表（最多5个）
  selectedVisionModel: string | null  // 选中的视觉模型
  selectedAgentModel: string | null   // agent 使用的模型（文本或视觉）
  platforms: AIPlatform[]
  globalSettings: {
    timeout: number
    retryCount: number
    enableLogging: boolean
  }
  // 记录用户删除的预设平台和模型，用于后续启动不再恢复（已废弃，保留兼容）
  deletedPredefinedPlatforms?: string[]
  deletedPredefinedModels?: string[]
}

export interface RemoteModelIconMapping {
  icon: string
  models: string[]
}

export const modelHasVision = (model?: Pick<AIModel, 'hasVision' | 'category'> | null): boolean => {
  if (!model) return false
  if (model.hasVision === true) return true
  if (model.hasVision === false) return false
  return model.category === 'vision'
}


export const resolveRemoteHasVision = (raw: Record<string, unknown> | AIModel): boolean => {
  const record = raw as Record<string, unknown>
  if (record.hasVision === true || record.has_vision === true || record.vision === true) return true
  if (record.hasVision === false || record.has_vision === false || record.vision === false) return false
  const capabilities = record.capabilities
  if (Array.isArray(capabilities) && capabilities.some((item) => String(item).toLowerCase() === 'vision')) {
    return true
  }
  if (capabilities && typeof capabilities === 'object' && (capabilities as { vision?: unknown }).vision === true) {
    return true
  }
  return record.category === 'vision'
}

export interface RemoteModelsCatalog {
  providersList: string[]
  modelIconMappings: RemoteModelIconMapping[]
  platforms: AIPlatform[]
  questionImageAlgorithm: string | null
}
