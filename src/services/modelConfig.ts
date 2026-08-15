import { reactive, watch, computed } from 'vue'
import { normalizeApiProtocol } from './modelProtocol'

// AI 平台配置接口
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

// 远程模型数据 URL（测试版 / 正式版统一）
const PROD_REMOTE_MODELS_URL = 'https://webapi.zaizhexue.top/live/models.json'
const TAURI_DEV_REMOTE_MODELS_URL = 'https://webapi.zaizhexue.top/live/models.json'
const REMOTE_MODELS_REQUEST_COOLDOWN_MS = 30 * 1000
const USER_CREATED_PLATFORM_ID_PREFIX = 'custom_'
const LEGACY_USER_CREATED_MODEL_ID_PREFIX = 'model_'

const getRemoteModelsUrls = (): string[] => {
  return [TAURI_DEV_REMOTE_MODELS_URL, PROD_REMOTE_MODELS_URL].filter(
    (url, index, arr) => arr.indexOf(url) === index
  )
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

const resolveRemoteHasVision = (raw: Record<string, unknown> | AIModel): boolean => {
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


const normalizeRemoteModelsCatalog = (json: unknown): RemoteModelsCatalog => {
  const toStringList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))]
  }

  const normalizeModelIconMappings = (value: unknown): RemoteModelIconMapping[] => {
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const record = item as Record<string, unknown>
          const icon = typeof record.icon === 'string' ? record.icon.trim() : ''
          const models = toStringList(record.models ?? record.keywords ?? record.aliases)
          if (!icon || !models.length) return null
          return { icon, models }
        })
        .filter((item): item is RemoteModelIconMapping => item !== null)
    }

    if (value && typeof value === 'object') {
      return Object.entries(value)
        .map(([icon, modelsValue]) => {
          const normalizedIcon = icon.trim()
          const models = Array.isArray(modelsValue)
            ? toStringList(modelsValue)
            : typeof modelsValue === 'string'
              ? [modelsValue.trim()].filter(Boolean)
              : []

          if (!normalizedIcon || !models.length) return null
          return { icon: normalizedIcon, models }
        })
        .filter((item): item is RemoteModelIconMapping => item !== null)
    }

    return []
  }

  if (Array.isArray(json)) {
    const platforms = json as AIPlatform[]
    const fallbackProvidersList = toStringList(platforms.map(platform => platform.icon))
    return {
      providersList: fallbackProvidersList,
      modelIconMappings: [],
      platforms,
      questionImageAlgorithm: null,
    }
  }

  if (json && typeof json === 'object') {
    const record = json as Record<string, unknown>
    const platforms = Array.isArray(record.platforms) ? record.platforms as AIPlatform[] : []
    const providersList = toStringList(record.providers_list)
    const fallbackProvidersList = toStringList(platforms.map(platform => platform.icon))
    const modelIconMappings = normalizeModelIconMappings(record.model_icon_mappings)
    const questionImageAlgorithm = typeof record.question_image_algorithm === 'string'
      ? record.question_image_algorithm.trim()
      : typeof record.questionImageAlgorithm === 'string'
        ? record.questionImageAlgorithm.trim()
        : record.question_image && typeof record.question_image === 'object' && typeof (record.question_image as Record<string, unknown>).algorithm === 'string'
          ? ((record.question_image as Record<string, unknown>).algorithm as string).trim()
          : null

    return {
      providersList: providersList.length ? providersList : fallbackProvidersList,
      modelIconMappings,
      platforms,
      questionImageAlgorithm: questionImageAlgorithm || null,
    }
  }

  return {
    providersList: [],
    modelIconMappings: [],
    platforms: [],
    questionImageAlgorithm: null,
  }
}

const dedupeRemotePlatforms = (platforms: AIPlatform[]): AIPlatform[] => {
  const seenPlatformIds = new Set<string>()

  return platforms.reduce<AIPlatform[]>((acc, platform) => {
    if (!platform?.id || seenPlatformIds.has(platform.id)) {
      return acc
    }

    seenPlatformIds.add(platform.id)

    const seenModelIds = new Set<string>()
    const models = (platform.models || []).reduce<AIModel[]>((modelAcc, model) => {
      if (!model?.id || seenModelIds.has(model.id)) {
        return modelAcc
      }

      seenModelIds.add(model.id)
      modelAcc.push(model)
      return modelAcc
    }, [])

    acc.push({
      ...platform,
      models,
    })

    return acc
  }, [])
}

const isLikelyUserCreatedPlatform = (platform: Pick<AIPlatform, 'id'>): boolean => {
  return typeof platform.id === 'string' && platform.id.startsWith(USER_CREATED_PLATFORM_ID_PREFIX)
}

const isLikelyUserCreatedModel = (model: Pick<AIModel, 'id' | 'platformId'>, platformId?: string): boolean => {
  if (!model?.id) return false
  if (model.id.startsWith(LEGACY_USER_CREATED_MODEL_ID_PREFIX)) return true

  const resolvedPlatformId = platformId || model.platformId
  return !!resolvedPlatformId && model.id.startsWith(`${resolvedPlatformId}_`) && /_\d+$/.test(model.id)
}

const dedupeModelsById = (models: AIModel[]): AIModel[] => {
  const modelMap = new Map<string, AIModel>()

  for (const model of models) {
    if (!model?.id) continue

    const existing = modelMap.get(model.id)
    if (!existing || (!!model.isRemote && !existing.isRemote)) {
      modelMap.set(model.id, model)
    }
  }

  return [...modelMap.values()]
}

const getPlatformApiKey = (platforms: AIPlatform[], preferredPlatform?: AIPlatform): string => {
  if (preferredPlatform?.apiKey?.trim()) {
    return preferredPlatform.apiKey
  }

  return platforms.find(platform => platform.apiKey?.trim())?.apiKey || ''
}

const sanitizeStoredPlatforms = (platforms: AIPlatform[]): AIPlatform[] => {
  const groupedPlatforms = new Map<string, AIPlatform[]>()

  for (const platform of platforms) {
    if (!platform?.id || !platform.name?.trim()) continue

    const existingPlatforms = groupedPlatforms.get(platform.id)
    if (existingPlatforms) {
      existingPlatforms.push(platform)
    } else {
      groupedPlatforms.set(platform.id, [platform])
    }
  }

  return [...groupedPlatforms.values()].map((sameIdPlatforms) => {
    const hasRemoteDuplicate = sameIdPlatforms.some(platform => platform.isRemote)
    const preferredPlatform = sameIdPlatforms.find(platform => platform.isRemote)
      ?? sameIdPlatforms.find(platform => isLikelyUserCreatedPlatform(platform))
      ?? sameIdPlatforms[0]

    const models = dedupeModelsById(
      sameIdPlatforms.flatMap(platform => (platform.models || [])
        .filter((model): model is AIModel => !!model?.id)
        .filter((model) => {
          if (!hasRemoteDuplicate) return true
          if (model.isRemote) return true
          return isLikelyUserCreatedModel(model, platform.id)
        })
        .map(model => {
          const legacy = model as AIModel & { name?: string }
          const displayName = (legacy.displayName || legacy.name || legacy.id || '').trim() || legacy.id
          const nextModel: AIModel = {
            ...model,
            displayName,
            platformId: preferredPlatform.id,
            isRemote: model.isRemote === true,
            hasVision: modelHasVision(model),
            category: 'text',
          }
          // 废弃模型 name 字段
          delete (nextModel as AIModel & { name?: string }).name
          // 远程模型不再保留 jsCode
          if (nextModel.isRemote) {
            delete nextModel.jsCode
          }
          return nextModel
        })
      )
    )

    const apiProtocol = inferPlatformApiProtocol({
      ...preferredPlatform,
      models,
    })
    return {
      ...preferredPlatform,
      displayName: preferredPlatform.displayName || preferredPlatform.name || preferredPlatform.id,
      apiKey: getPlatformApiKey(sameIdPlatforms, preferredPlatform),
      apiProtocol,
      models: models.map((model) => ({
        ...model,
        apiProtocol: model.isRemote && apiProtocol === 'custom' ? 'openai-chat' : apiProtocol,
      })),
    }
  })
}

let cachedRemoteModelsCatalog: RemoteModelsCatalog | null = null
let cachedRemoteModelsCatalogAt = 0
let pendingRemoteModelsCatalogRequest: Promise<RemoteModelsCatalog> | null = null

const fetchRemoteModelsCatalogFromUrl = async (url: string): Promise<RemoteModelsCatalog> => {
  try {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    const r = await tauriFetch(url, { method: 'GET' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return normalizeRemoteModelsCatalog(await r.json())
  } catch (tauriError) {
    // 非 Tauri 或插件失败时回退到浏览器 fetch
    try {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return normalizeRemoteModelsCatalog(await r.json())
    } catch (browserError) {
      throw browserError instanceof Error ? browserError : tauriError
    }
  }
}

const requestRemoteModelsCatalog = async (): Promise<RemoteModelsCatalog> => {
  const urls = getRemoteModelsUrls()
  let lastError: unknown

  for (const url of urls) {
    try {
      return await fetchRemoteModelsCatalogFromUrl(url)
    } catch (error) {
      lastError = error
      console.warn(`加载远程模型目录失败 (${url}):`, error)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('加载远程模型目录失败')
}

export const fetchRemoteModelsCatalog = async (): Promise<RemoteModelsCatalog> => {
  const now = Date.now()

  if (cachedRemoteModelsCatalog && now - cachedRemoteModelsCatalogAt < REMOTE_MODELS_REQUEST_COOLDOWN_MS) {
    return cachedRemoteModelsCatalog
  }

  if (pendingRemoteModelsCatalogRequest) {
    return pendingRemoteModelsCatalogRequest
  }

  pendingRemoteModelsCatalogRequest = requestRemoteModelsCatalog()
    .then((catalog) => {
      cachedRemoteModelsCatalog = catalog
      cachedRemoteModelsCatalogAt = Date.now()
      return catalog
    })
    .finally(() => {
      pendingRemoteModelsCatalogRequest = null
    })

  return pendingRemoteModelsCatalogRequest
}

// 默认模型配置（无预定义平台，全部来自远程同步）
const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  selectedTextModel: null,
  selectedTextModels: [],
  selectedSummaryModel: null,
  selectedSummaryModels: [],
  selectedVisionModel: null,
  selectedAgentModel: null,
  platforms: [],
  globalSettings: {
    timeout: 30000,
    retryCount: 3,
    enableLogging: false
  },
  deletedPredefinedPlatforms: [],
  deletedPredefinedModels: []
}

// 模型配置存储键
const MODEL_SETTINGS_STORAGE_KEY = 'model_settings'

/**
 * 模型配置管理器类
 */
class ModelConfigManager {
  private settings: ModelSettings
  private listeners: Set<(settings: ModelSettings) => void> = new Set()
  private remotePlatformsSyncAt = 0
  private pendingRemotePlatformsSync: Promise<void> | null = null
  private shouldPersistLoadedSettings = false

  constructor() {
    this.settings = reactive(this.loadSettings())
    this.normalizeSelectedModels()
    if (this.shouldPersistLoadedSettings) {
      this.saveSettings()
    }
    this.setupAutoSave()
  }

  /**
   * 从本地存储加载模型配置
   */
  private loadSettings(): ModelSettings {
    try {
      const stored = localStorage.getItem(MODEL_SETTINGS_STORAGE_KEY)
      if (stored) {
        const parsedSettings = JSON.parse(stored)
        const loadedSettings: ModelSettings = {
          ...DEFAULT_MODEL_SETTINGS,
          ...parsedSettings,
          platforms: (parsedSettings.platforms || []).filter((p: AIPlatform) => p.name?.trim()),
        }
        const sanitizedSettings: ModelSettings = {
          ...loadedSettings,
          platforms: sanitizeStoredPlatforms(loadedSettings.platforms || []),
        }

        this.shouldPersistLoadedSettings = JSON.stringify(loadedSettings) !== JSON.stringify(sanitizedSettings)
        return sanitizedSettings
      }
    } catch (error) {
      console.warn('加载模型配置失败，使用默认配置:', error)
    }
    return { ...DEFAULT_MODEL_SETTINGS }
  }

  private dedupeAndFilterModelIds(modelIds: Array<string | null | undefined>, validIds: Set<string>, maxCount: number): string[] {
    const uniqueIds: string[] = []

    for (const modelId of modelIds) {
      if (!modelId || !validIds.has(modelId) || uniqueIds.includes(modelId)) {
        continue
      }

      uniqueIds.push(modelId)
      if (uniqueIds.length >= maxCount) {
        break
      }
    }

    return uniqueIds
  }

  private autoDetectEnableThinking(): void {
    for (const platform of this.settings.platforms) {
      for (const model of platform.models || []) {
        // 用户已明确设置过（true/false）则不再覆盖，避免“关闭思考”被启动/同步逻辑改回开启
        if (typeof model.enableThinking === 'boolean') continue

        const id = (model.id || '').toLowerCase()
        const label = (model.displayName || '').toLowerCase()
        const isKnownThinking =
          id.includes('reasoner') || label.includes('reasoner') ||
          id.includes('-r1') || label.includes('-r1') ||
          id.includes('thinking') || label.includes('thinking') ||
          id.includes('deepseek-r1') || label.includes('deepseek r1') ||
          id.startsWith('o1') || id.startsWith('o3')
        if (isKnownThinking) {
          model.enableThinking = true
        }
      }
    }
  }

  private normalizeSelectedModels(): void {
    this.autoDetectEnableThinking()
    const enabledPlatforms = this.settings.platforms.filter(platform => platform.enabled !== false)
    const allModels = enabledPlatforms.flatMap(platform => platform.models || [])
    const enabledModels = allModels.filter(model => model.enabled !== false)
    const textModelIds = new Set(enabledModels.map(model => model.id))
    const summaryModelIds = new Set(enabledModels.map(model => model.id))
    const visionModelIds = new Set(enabledModels.filter(model => modelHasVision(model)).map(model => model.id))

    const normalizedTextModels = this.dedupeAndFilterModelIds(
      [
        ...(this.settings.selectedTextModels || []),
        ...(this.settings.selectedTextModel ? [this.settings.selectedTextModel] : [])
      ],
      textModelIds,
      5
    )

    const normalizedSummaryModels = this.dedupeAndFilterModelIds(
      [
        ...(this.settings.selectedSummaryModels || []),
        ...(this.settings.selectedSummaryModel ? [this.settings.selectedSummaryModel] : [])
      ],
      summaryModelIds,
      1
    )

    this.settings.selectedTextModels = normalizedTextModels
    this.settings.selectedTextModel = normalizedTextModels[0] || null
    this.settings.selectedSummaryModels = normalizedSummaryModels
    this.settings.selectedSummaryModel = normalizedSummaryModels[0] || null
    this.settings.selectedVisionModel = this.settings.selectedVisionModel && visionModelIds.has(this.settings.selectedVisionModel)
      ? this.settings.selectedVisionModel
      : null
    const agentModelIds = new Set(enabledModels.map((model) => model.id))
    this.settings.selectedAgentModel = this.settings.selectedAgentModel && agentModelIds.has(this.settings.selectedAgentModel)
      ? this.settings.selectedAgentModel
      : null
  }

  private clearSelectedModelsForPlatform(platformId: string): void {
    const platform = this.settings.platforms.find(item => item.id === platformId)
    if (!platform) return

    const platformModelIds = new Set((platform.models || []).map(model => model.id))

    if (this.settings.selectedTextModels) {
      this.settings.selectedTextModels = this.settings.selectedTextModels.filter(id => !platformModelIds.has(id))
      this.settings.selectedTextModel = this.settings.selectedTextModels[0] || null
    }

    if (this.settings.selectedSummaryModels) {
      this.settings.selectedSummaryModels = this.settings.selectedSummaryModels.filter(id => !platformModelIds.has(id))
      this.settings.selectedSummaryModel = this.settings.selectedSummaryModels[0] || null
    }

    if (this.settings.selectedVisionModel && platformModelIds.has(this.settings.selectedVisionModel)) {
      this.settings.selectedVisionModel = null
    }
    if (this.settings.selectedAgentModel && platformModelIds.has(this.settings.selectedAgentModel)) {
      this.settings.selectedAgentModel = null
    }
  }

  private sortPlatformsByRemoteOrder(platforms: AIPlatform[], remotePlatforms: AIPlatform[]): AIPlatform[] {
    const remoteOrder = new Map(remotePlatforms.map((platform, index) => [platform.id, index]))

    return [...platforms].sort((a, b) => {
      const aIndex = remoteOrder.get(a.id)
      const bIndex = remoteOrder.get(b.id)
      const aIsRemote = aIndex !== undefined
      const bIsRemote = bIndex !== undefined

      if (aIsRemote && bIsRemote) return aIndex - bIndex
      if (aIsRemote) return -1
      if (bIsRemote) return 1
      return 0
    })
  }

  private sortModelsByRemoteOrder(models: AIModel[], remoteModels: AIModel[]): AIModel[] {
    const remoteOrder = new Map(remoteModels.map((model, index) => [model.id, index]))

    return [...models].sort((a, b) => {
      const aIndex = remoteOrder.get(a.id)
      const bIndex = remoteOrder.get(b.id)
      const aIsRemote = aIndex !== undefined
      const bIsRemote = bIndex !== undefined

      if (aIsRemote && bIsRemote) return aIndex - bIndex
      if (aIsRemote) return -1
      if (bIsRemote) return 1
      return 0
    })
  }

  private findLocalPlatformWithSameRemoteModelId(remotePlatform: AIPlatform): AIPlatform | undefined {
    const remoteModelIds = new Set((remotePlatform.models || []).map(model => model.id).filter(Boolean))
    if (!remoteModelIds.size) return undefined

    return this.settings.platforms
      .filter(platform => !platform.isRemote && platform.apiKey?.trim())
      .map(platform => ({
        platform,
        matchedModelCount: (platform.models || []).reduce(
          (count, model) => count + (remoteModelIds.has(model.id) ? 1 : 0),
          0
        ),
      }))
      .filter(item => item.matchedModelCount > 0)
      .sort((a, b) => b.matchedModelCount - a.matchedModelCount)[0]?.platform
  }

  /**
   * 从远程同步平台和模型数据（每次启动时调用）
   * - 远程平台/模型标记 isRemote: true，禁止编辑/删除
   * - 保留用户的 apiKey、enabled 状态
   * - 远程已删除的平台/模型：若其模型被选中，自动替换为同平台同类型的另一个模型
   */
  private async performRemotePlatformsSync(): Promise<boolean> {
    let remotePlatforms: AIPlatform[] = []
    try {
      const catalog = await fetchRemoteModelsCatalog()
      remotePlatforms = dedupeRemotePlatforms(catalog.platforms)
    } catch (err) {
      console.warn('远程模型同步失败，跳过同步:', err)
      return false
    }

    const remotePlatformIds = new Set(remotePlatforms.map(p => p.id))
    const existingPlatformsById = this.settings.platforms.reduce<Map<string, AIPlatform[]>>((map, platform) => {
      const existingPlatforms = map.get(platform.id)
      if (existingPlatforms) {
        existingPlatforms.push(platform)
      } else {
        map.set(platform.id, [platform])
      }
      return map
    }, new Map<string, AIPlatform[]>())

    for (const localPlatform of this.settings.platforms) {
      if (!localPlatform.isRemote) continue
      if (remotePlatformIds.has(localPlatform.id)) continue

      const userModels = localPlatform.models.filter(model => !model.isRemote && isLikelyUserCreatedModel(model, localPlatform.id))
      if (userModels.length > 0) {
        for (const model of localPlatform.models.filter(model => model.isRemote)) {
          this._replaceSelectedModel(model.id, localPlatform.id)
        }
        localPlatform.isRemote = false
        localPlatform.models = userModels
      } else {
        for (const model of localPlatform.models) {
          this._replaceSelectedModel(model.id, localPlatform.id)
        }
      }
    }

    this.settings.platforms = this.settings.platforms.filter(
      platform => !platform.isRemote && platform.name?.trim() && !remotePlatformIds.has(platform.id)
    )

    const newRemotePlatforms: AIPlatform[] = remotePlatforms.map(rp => {
      const existingPlatforms = existingPlatformsById.get(rp.id) || []
      const existing = existingPlatforms.find(platform => platform.isRemote)
        ?? existingPlatforms.find(platform => platform.apiKey?.trim())
        ?? existingPlatforms[0]
      const preservedApiKey = getPlatformApiKey(existingPlatforms, existing)
        || this.findLocalPlatformWithSameRemoteModelId(rp)?.apiKey
        || ''
      const inferredProtocol = inferPlatformApiProtocol(rp)
      const platformProtocol = inferredProtocol === 'custom' ? 'openai-chat' : inferredProtocol

      const remoteModels: AIModel[] = (rp.models || []).map(rm => {
        // 自动检测思考模型：根据模型名称/ID 包含关键词时默认开启思考
        const runtimeModelId = (rm.modelId || rm.id || '').toLowerCase()
        const modelIdLower = (rm.id || '').toLowerCase()
        const modelNameLower = (rm.displayName || (rm as { name?: string }).name || '').toLowerCase()
        const thinkingProbe = `${runtimeModelId} ${modelIdLower} ${modelNameLower}`
        const isKnownThinkingModel =
          thinkingProbe.includes('reasoner') ||
          thinkingProbe.includes('-r1') ||
          thinkingProbe.includes('thinking') ||
          thinkingProbe.includes('deepseek-r1') ||
          thinkingProbe.includes('deepseek r1') ||
          runtimeModelId.startsWith('o1') ||
          runtimeModelId.startsWith('o3') ||
          modelIdLower.startsWith('o1') ||
          modelIdLower.startsWith('o3')
        // 保留用户已有的设置，否则按自动检测
        const existingModel = existingPlatforms.flatMap(p => p.models || []).find(m => m.id === rm.id)
        // 远程不再下发/使用 jsCode、pricing；调用只认 modelId（或 id）+ 协议预设
        // 协议与思考配置由管理员锁定：每次同步强制采用远程值（缺省才回退 heuristic / 默认）
        const {
          jsCode: _ignoredRemoteJsCode,
          pricing: _ignoredRemotePricing,
          name: _ignoredRemoteName,
          icon: _ignoredRemoteIcon,
          description: _ignoredRemoteDescription,
          ...remoteModelFields
        } = rm as AIModel & { pricing?: unknown; name?: string }
        return {
          ...remoteModelFields,
          platformId: rp.id,
          isRemote: true,
          jsCode: undefined,
          displayName: rm.displayName || existingModel?.displayName || (rm as { name?: string }).name || rm.id,
          modelId: rm.modelId?.trim() || rm.id,
          apiProtocol: platformProtocol,
          enabled: rm.enabled ?? true,
          maxTokens: rm.maxTokens ?? 4096,
          temperature: rm.temperature ?? 0.7,
          topP: rm.topP ?? 0.9,
          category: 'text',
          hasVision: resolveRemoteHasVision(rm as AIModel & Record<string, unknown>),
          enableThinking: rm.enableThinking ?? isKnownThinkingModel,
          thinkingOffEnableThinkingFalse: rm.thinkingOffEnableThinkingFalse ?? true,
          thinkingOffThinkingTypeDisabled: rm.thinkingOffThinkingTypeDisabled ?? false,
          thinkingOffResponsesEffort: rm.thinkingOffResponsesEffort
            ?? (rm.thinkingOffEffortNone ? 'minimal' : 'minimal'),
          thinkingEffort: rm.thinkingEffort ?? 'medium',
        }
      })
      const localModels = dedupeModelsById(
        existingPlatforms.flatMap(platform => (platform.models || [])
          .filter(model => !model.isRemote && isLikelyUserCreatedModel(model, rp.id))
          .map(model => ({
            ...model,
            platformId: rp.id,
            isRemote: false,
            hasVision: modelHasVision(model),
            category: 'text' as const,
            apiProtocol: platformProtocol,
          })))
      )
      const models = this.sortModelsByRemoteOrder(dedupeModelsById([...remoteModels, ...localModels]), remoteModels)

      if (existingPlatforms.length > 0) {
        const remoteModelIds = new Set(remoteModels.map(m => m.id))
        for (const oldModel of existingPlatforms.flatMap(platform => (platform.models || []).filter(model => model.isRemote))) {
          if (!remoteModelIds.has(oldModel.id)) {
            this._replaceSelectedModel(oldModel.id, rp.id, models)
          }
        }
      }

      return {
        id: rp.id,
        name: rp.name || rp.displayName || rp.id,
        displayName: rp.displayName || rp.name || rp.id,
        baseUrl: rp.baseUrl || '',
        apiProtocol: platformProtocol,
        description: rp.description,
        icon: rp.icon,
        url: rp.url,
        inviteUrl: rp.inviteUrl,
        inviteText: rp.inviteText,
        inviteCode: rp.inviteCode || existing?.inviteCode,
        isRemote: true,
        apiKey: preservedApiKey,
        enabled: existing?.enabled ?? true,
        customHeaders: existing?.customHeaders,
        models,
      }
    })

    this.settings.platforms = this.sortPlatformsByRemoteOrder(
      [...newRemotePlatforms, ...this.settings.platforms],
      remotePlatforms
    )
    this.normalizeSelectedModels()
    return true
  }

  async syncRemotePlatforms(): Promise<void> {
    const now = Date.now()

    if (this.remotePlatformsSyncAt && now - this.remotePlatformsSyncAt < REMOTE_MODELS_REQUEST_COOLDOWN_MS) {
      return
    }

    if (this.pendingRemotePlatformsSync) {
      return this.pendingRemotePlatformsSync
    }

    this.pendingRemotePlatformsSync = this.performRemotePlatformsSync()
      .then((didSync) => {
        if (didSync) {
          this.remotePlatformsSyncAt = Date.now()
        }
      })
      .finally(() => {
        this.pendingRemotePlatformsSync = null
      })

    return this.pendingRemotePlatformsSync
  }

  /**
   * 当某个模型被删除/消失时，若它被选中，替换为同平台同类型的另一个可用模型
   */
  private _replaceSelectedModel(
    modelId: string,
    platformId: string,
    candidateModels?: AIModel[]
  ): void {
    const pool = candidateModels
      ?? this.settings.platforms.find(p => p.id === platformId)?.models ?? []
    const findReplacement = (visionOnly = false): AIModel | undefined =>
      pool.find((model) =>
        model.id !== modelId
        && model.enabled !== false
        && (!visionOnly || modelHasVision(model))
      )

    if (this.settings.selectedTextModels?.includes(modelId)) {
      const replacement = findReplacement()
      this.settings.selectedTextModels = this.settings.selectedTextModels.filter(id => id !== modelId)
      if (replacement && !this.settings.selectedTextModels.includes(replacement.id)) {
        this.settings.selectedTextModels.push(replacement.id)
      }
      this.settings.selectedTextModel = this.settings.selectedTextModels[0] || null
    }
    if (this.settings.selectedSummaryModels?.includes(modelId)) {
      const replacement = findReplacement()
      this.settings.selectedSummaryModels = this.settings.selectedSummaryModels.filter(id => id !== modelId)
      if (replacement && !this.settings.selectedSummaryModels.includes(replacement.id)) {
        this.settings.selectedSummaryModels.push(replacement.id)
      }
      this.settings.selectedSummaryModel = this.settings.selectedSummaryModels[0] || null
    }
    if (this.settings.selectedVisionModel === modelId) {
      this.settings.selectedVisionModel = findReplacement(true)?.id || null
    }
    if (this.settings.selectedAgentModel === modelId) {
      this.settings.selectedAgentModel = findReplacement()?.id || null
    }
  }

  /**
   * 保存配置到本地存储，并异步写入文件
   */
  private saveSettings(): void {
    try {
      localStorage.setItem(MODEL_SETTINGS_STORAGE_KEY, JSON.stringify(this.settings))
      this.notifyListeners()
      // 异步写入 model_config.json
      this.saveToFile()
    } catch (error) {
      console.error('保存模型配置失败:', error)
      throw new Error('模型配置保存失败')
    }
  }

  /**
   * 异步写入 model_config.json
   */
  private async saveToFile(): Promise<void> {
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('write_model_config', { content: JSON.stringify(this.settings) })
    } catch {
      // 非 Tauri 环境忽略
    }
  }

  /**
   * 设置自动保存
   */
  private setupAutoSave(): void {
    watch(
      () => this.settings,
      () => {
        this.saveSettings()
      },
      { deep: true }
    )
  }

  /**
   * 通知监听器配置已更改
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.settings)
      } catch (error) {
        console.error('模型配置监听器执行失败:', error)
      }
    })
  }

  /**
   * 获取当前配置
   */
  getSettings(): ModelSettings {
    return this.settings
  }

  /**
   * 获取所有平台
   */
  getPlatforms(): AIPlatform[] {
    return this.settings.platforms
  }

  /**
   * 获取启用的平台
   */
  getEnabledPlatforms(): AIPlatform[] {
    // 平台必须启用，且有启用的模型才返回
    return this.settings.platforms.filter(p => 
      p.enabled && 
      p.models && 
      p.models.some(model => model.enabled)
    )
  }

  /**
   * 获取所有可用模型
   */
  getAvailableModels(): AIModel[] {
    return this.getEnabledPlatforms()
      .flatMap(platform => platform.models)
      .filter(model => model.enabled)
  }

  /**
   * 获取当前选中的文本模型（向后兼容，返回第一个选中模型）
   */
  getSelectedTextModel(): AIModel | null {
    // 优先从新字段 [0] 获取
    if (this.settings.selectedTextModels && this.settings.selectedTextModels.length > 0) {
      const allModels = this.settings.platforms.flatMap(p => p.models)
      return allModels.find(m => m.id === this.settings.selectedTextModels[0]) || null
    }
    // 兜底从旧字段获取
    if (this.settings.selectedTextModel) {
      const allModels = this.settings.platforms.flatMap(p => p.models)
      return allModels.find(m => m.id === this.settings.selectedTextModel) || null
    }
    return null
  }

  /**
   * 获取所有选中的文本模型
   */
  getSelectedTextModels(): AIModel[] {
    // 如果新字段有数据，直接返回
    if (this.settings.selectedTextModels && this.settings.selectedTextModels.length > 0) {
      const allModels = this.settings.platforms.flatMap(p => p.models)
      return this.settings.selectedTextModels
        .map(id => allModels.find(m => m.id === id))
        .filter((m): m is AIModel => m !== undefined)
    }
    // 如果新字段为空但旧字段有值，尝试转换
    const legacyModel = this.getSelectedTextModel()
    return legacyModel ? [legacyModel] : []
  }

  /**
   * 切换文本模型选中状态（最多5个）
   */
  toggleSelectedTextModel(modelId: string): void {
    this.normalizeSelectedModels()
    if (!this.settings.selectedTextModels) this.settings.selectedTextModels = []
    const idx = this.settings.selectedTextModels.indexOf(modelId)
    if (idx !== -1) {
      this.settings.selectedTextModels.splice(idx, 1)
    } else {
      if (this.settings.selectedTextModels.length >= 5) return
      this.settings.selectedTextModels.push(modelId)
    }
    this.settings.selectedTextModel = this.settings.selectedTextModels[0] || null
  }

  /**
   * 判断文本模型是否被选中
   */
  isTextModelSelected(modelId: string): boolean {
    if (!this.settings.selectedTextModels) return false
    return this.settings.selectedTextModels.includes(modelId)
  }

  /**
   * 获取当前选中的总结模型（向后兼容，返回第一个选中模型）
   */
  getSelectedSummaryModel(): AIModel | null {
    // 优先从新字段 [0] 获取
    if (this.settings.selectedSummaryModels && this.settings.selectedSummaryModels.length > 0) {
      const allModels = this.settings.platforms.flatMap(p => p.models)
      return allModels.find(m => m.id === this.settings.selectedSummaryModels[0]) || null
    }
    // 兜底从旧字段获取
    if (this.settings.selectedSummaryModel) {
      const allModels = this.settings.platforms.flatMap(p => p.models)
      return allModels.find(m => m.id === this.settings.selectedSummaryModel) || null
    }
    return null
  }

  /**
   * 获取所有选中的总结模型
   */
  getSelectedSummaryModels(): AIModel[] {
    // 如果新字段有数据，直接返回
    if (this.settings.selectedSummaryModels && this.settings.selectedSummaryModels.length > 0) {
      const allModels = this.settings.platforms.flatMap(p => p.models)
      return this.settings.selectedSummaryModels
        .map(id => allModels.find(m => m.id === id))
        .filter((m): m is AIModel => m !== undefined)
    }
    // 如果新字段为空但旧字段有值，尝试转换
    const legacyModel = this.getSelectedSummaryModel()
    return legacyModel ? [legacyModel] : []
  }

  /**
   * 切换总结模型选中状态（最多5个）
   */
  toggleSelectedSummaryModel(modelId: string): void {
    if (!this.settings.selectedSummaryModels) this.settings.selectedSummaryModels = []
    
    const isSelected = this.settings.selectedSummaryModels.includes(modelId)
    
    if (isSelected) {
      // 如果已经选中，则取消全部选中
      this.settings.selectedSummaryModels = []
      this.settings.selectedSummaryModel = null
    } else {
      // 如果未选中，则清除之前的选择，仅选中当前这一个
      this.settings.selectedSummaryModels = [modelId]
      this.settings.selectedSummaryModel = modelId
    }
  }

  /**
   * 判断总结模型是否被选中
   */
  isSummaryModelSelected(modelId: string): boolean {
    if (!this.settings.selectedSummaryModels) return false
    return this.settings.selectedSummaryModels.includes(modelId)
  }

  /**
   * 获取当前选中的视觉模型
   */
  getSelectedVisionModel(): AIModel | null {
    if (!this.settings.selectedVisionModel) return null
    
    const allModels = this.settings.platforms.flatMap(p => p.models)
    return allModels.find(m => m.id === this.settings.selectedVisionModel && modelHasVision(m)) || null
  }

  /**
   * 获取当前选中的模型（文本模型或视觉模型）
   */
  getSelectedModel(): AIModel | null {
    // 优先返回总结模型，然后文本模型，如果没有则返回视觉模型
    const summaryModel = this.getSelectedSummaryModel()
    if (summaryModel) {
      return summaryModel
    }
    const textModel = this.getSelectedTextModel()
    if (textModel) {
      return textModel
    }
    return this.getSelectedVisionModel()
  }

  /**
   * 设置选中的文本模型（向后兼容，替换整个选中列表为单个模型）
   */
  setSelectedTextModel(modelId: string | null): void {
    this.settings.selectedTextModel = modelId
    this.settings.selectedTextModels = modelId ? [modelId] : []
  }

  /**
   * 设置选中的总结模型
   */
  setSelectedSummaryModel(modelId: string | null): void {
    this.settings.selectedSummaryModel = modelId
    this.settings.selectedSummaryModels = modelId ? [modelId] : []
  }

  /**
   * 设置选中的视觉模型
   */
  setSelectedVisionModel(modelId: string | null): void {
    this.settings.selectedVisionModel = modelId
    // 移除互斥逻辑，允许同时选择文本和视觉模型
  }

  /**
   * 切换视觉模型选中状态（再点一次取消选择）
   */
  toggleSelectedVisionModel(modelId: string): void {
    if (this.settings.selectedVisionModel === modelId) {
      this.settings.selectedVisionModel = null
    } else {
      this.settings.selectedVisionModel = modelId
    }
  }

  /**
   * 判断视觉模型是否被选中
   */
  isVisionModelSelected(modelId: string): boolean {
    return this.settings.selectedVisionModel === modelId
  }

  getSelectedAgentModel(): AIModel | null {
    if (!this.settings.selectedAgentModel) return null
    const allModels = this.settings.platforms.flatMap((platform) => platform.models)
    return allModels.find((model) => model.id === this.settings.selectedAgentModel) || null
  }

  setSelectedAgentModel(modelId: string | null): void {
    this.settings.selectedAgentModel = modelId
  }

  toggleSelectedAgentModel(modelId: string): void {
    if (this.settings.selectedAgentModel === modelId) {
      this.settings.selectedAgentModel = null
    } else {
      this.settings.selectedAgentModel = modelId
    }
  }

  isAgentModelSelected(modelId: string): boolean {
    return this.settings.selectedAgentModel === modelId
  }

  /**
   * 设置选中的模型（兼容旧接口，设置文本模型）
   */
  setSelectedModel(modelId: string | null): void {
    this.setSelectedTextModel(modelId)
  }

  /**
   * 添加自定义平台
   */
  addPlatform(platform: Omit<AIPlatform, 'id'>): string {
    const id = `custom_${Date.now()}`
    const apiProtocol = inferPlatformApiProtocol(platform)
    const newPlatform: AIPlatform = {
      ...platform,
      id,
      displayName: platform.name,
      enabled: platform.enabled ?? true,
      isRemote: false,
      apiProtocol,
      models: (platform.models || []).map((model) => ({ ...model, apiProtocol }))
    }

    this.settings.platforms.push(newPlatform)
    return id
  }

  /**
   * 更新平台配置
   */
  updatePlatform(platformId: string, updates: Partial<AIPlatform>): void {
    const platform = this.settings.platforms.find(p => p.id === platformId)
    if (platform) {
      const wasEnabled = platform.enabled !== false
      Object.assign(platform, updates)
      if (updates.name) {
        platform.displayName = updates.name
      }
      if (updates.apiProtocol !== undefined) {
        const apiProtocol = inferPlatformApiProtocol(platform)
        platform.apiProtocol = apiProtocol
        platform.models = (platform.models || []).map((model) => ({ ...model, apiProtocol }))
      }
      if (wasEnabled && platform.enabled === false) {
        this.clearSelectedModelsForPlatform(platformId)
      }
      this.normalizeSelectedModels()
    }
  }

  /**
   * 删除平台
   */
  removePlatform(platformId: string): void {
    const duplicatedPlatforms = this.settings.platforms.filter(platform => platform.id === platformId)
    if (!duplicatedPlatforms.length) return

    const duplicatedModelIds = new Set(duplicatedPlatforms.flatMap(platform => (platform.models || []).map(model => model.id)))

    this.settings.platforms = this.settings.platforms.filter(platform => platform.id !== platformId)
    this.settings.selectedTextModels = (this.settings.selectedTextModels || []).filter(id => !duplicatedModelIds.has(id))
    this.settings.selectedSummaryModels = (this.settings.selectedSummaryModels || []).filter(id => !duplicatedModelIds.has(id))

    if (this.settings.selectedTextModel && duplicatedModelIds.has(this.settings.selectedTextModel)) {
      this.settings.selectedTextModel = null
    }
    if (this.settings.selectedSummaryModel && duplicatedModelIds.has(this.settings.selectedSummaryModel)) {
      this.settings.selectedSummaryModel = null
    }
    if (this.settings.selectedVisionModel && duplicatedModelIds.has(this.settings.selectedVisionModel)) {
      this.settings.selectedVisionModel = null
    }
    if (this.settings.selectedAgentModel && duplicatedModelIds.has(this.settings.selectedAgentModel)) {
      this.settings.selectedAgentModel = null
    }

    this.normalizeSelectedModels()
  }

  /**
   * 添加自定义模型到平台
   */
  addModelToPlatform(platformId: string, model: Omit<AIModel, 'id' | 'platformId'>): string {
    const platform = this.settings.platforms.find(p => p.id === platformId)
    if (!platform) {
      throw new Error('平台不存在')
    }

    const modelId = `${platformId}_${model.displayName || 'model'}_${Date.now()}`
    const newModel: AIModel = {
      ...model,
      id: modelId,
      platformId,
      isRemote: false,
    }

    platform.models.push(newModel)
    return modelId
  }

  /**
   * 更新模型配置
   */
  updateModel(modelId: string, updates: Partial<AIModel>): void {
    for (const platform of this.settings.platforms) {
      const model = platform.models.find(m => m.id === modelId)
      if (model) {
        Object.assign(model, updates)
        this.normalizeSelectedModels()
        break
      }
    }
  }

  /**
   * 删除模型（远程模型不可删除，调用方应先检查 isRemote）
   */
  removeModel(modelId: string): void {
    for (const platform of this.settings.platforms) {
      const index = platform.models.findIndex(m => m.id === modelId)
      if (index !== -1) {
        const model = platform.models[index]
        // 替换选中状态（若被选中，自动切换到同平台同类型的另一个模型）
        this._replaceSelectedModel(modelId, platform.id)
        platform.models.splice(index, 1)
        break
      }
    }
  }

  /**
   * 更新全局设置
   */
  updateGlobalSettings(updates: Partial<ModelSettings['globalSettings']>): void {
    Object.assign(this.settings.globalSettings, updates)
  }

  /**
   * 重置配置
   */
  reset(): void {
    Object.assign(this.settings, DEFAULT_MODEL_SETTINGS)
  }

  /**
   * 导出配置
   */
  export(): string {
    return JSON.stringify(this.settings, null, 2)
  }

  /**
   * 导入配置
   */
  import(jsonString: string): void {
    try {
      const importedSettings = JSON.parse(jsonString)
      if (this.validateSettings(importedSettings)) {
        Object.assign(this.settings, {
          ...DEFAULT_MODEL_SETTINGS,
          ...importedSettings,
          platforms: sanitizeStoredPlatforms(importedSettings.platforms || []),
        })
        this.normalizeSelectedModels()
      } else {
        throw new Error('配置格式无效')
      }
    } catch (error) {
      console.error('导入配置失败:', error)
      throw new Error('配置导入失败')
    }
  }

  /**
   * 验证配置格式
   */
  private validateSettings(settings: any): boolean {
    return (
      typeof settings === 'object' &&
      Array.isArray(settings.platforms) &&
      typeof settings.globalSettings === 'object'
    )
  }

  /**
   * 添加配置变更监听器
   */
  addListener(listener: (settings: ModelSettings) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 移除配置变更监听器
   */
  removeListener(listener: (settings: ModelSettings) => void): void {
    this.listeners.delete(listener)
  }
}

// 导出单例实例
export const modelConfigManager = new ModelConfigManager()

// 导出类型
export type { ModelConfigManager }

// 导出组合式函数
export function useModelConfig() {
  const settings = modelConfigManager.getSettings()
  
  return {
    settings,
    platforms: computed(() => modelConfigManager.getPlatforms()),
    selectedModel: computed(() => modelConfigManager.getSelectedModel()),
    selectedTextModel: computed(() => modelConfigManager.getSelectedTextModel()),
    selectedTextModels: computed(() => modelConfigManager.getSelectedTextModels()),
    selectedSummaryModel: computed(() => modelConfigManager.getSelectedSummaryModel()),
    selectedSummaryModels: computed(() => modelConfigManager.getSelectedSummaryModels()),
    selectedVisionModel: computed(() => modelConfigManager.getSelectedVisionModel()),
    selectedAgentModel: computed(() => modelConfigManager.getSelectedAgentModel()),
    availableModels: computed(() => modelConfigManager.getAvailableModels()),

    // 方法
    setSelectedModel: modelConfigManager.setSelectedModel.bind(modelConfigManager),
    setSelectedTextModel: modelConfigManager.setSelectedTextModel.bind(modelConfigManager),
    setSelectedSummaryModel: modelConfigManager.setSelectedSummaryModel.bind(modelConfigManager),
    setSelectedVisionModel: modelConfigManager.setSelectedVisionModel.bind(modelConfigManager),
    setSelectedAgentModel: modelConfigManager.setSelectedAgentModel.bind(modelConfigManager),
    toggleSelectedTextModel: modelConfigManager.toggleSelectedTextModel.bind(modelConfigManager),
    toggleSelectedSummaryModel: modelConfigManager.toggleSelectedSummaryModel.bind(modelConfigManager),
    toggleSelectedVisionModel: modelConfigManager.toggleSelectedVisionModel.bind(modelConfigManager),
    toggleSelectedAgentModel: modelConfigManager.toggleSelectedAgentModel.bind(modelConfigManager),
    isTextModelSelected: modelConfigManager.isTextModelSelected.bind(modelConfigManager),
    isSummaryModelSelected: modelConfigManager.isSummaryModelSelected.bind(modelConfigManager),
    isVisionModelSelected: modelConfigManager.isVisionModelSelected.bind(modelConfigManager),
    isAgentModelSelected: modelConfigManager.isAgentModelSelected.bind(modelConfigManager),
    addPlatform: modelConfigManager.addPlatform.bind(modelConfigManager),
    updatePlatform: modelConfigManager.updatePlatform.bind(modelConfigManager),
    removePlatform: modelConfigManager.removePlatform.bind(modelConfigManager),
    addModelToPlatform: modelConfigManager.addModelToPlatform.bind(modelConfigManager),
    updateModel: modelConfigManager.updateModel.bind(modelConfigManager),
    removeModel: modelConfigManager.removeModel.bind(modelConfigManager),
    updateGlobalSettings: modelConfigManager.updateGlobalSettings.bind(modelConfigManager),
    syncRemotePlatforms: modelConfigManager.syncRemotePlatforms.bind(modelConfigManager),
    
    // 工具方法
    export: modelConfigManager.export.bind(modelConfigManager),
    import: modelConfigManager.import.bind(modelConfigManager),
    reset: modelConfigManager.reset.bind(modelConfigManager),
    addListener: modelConfigManager.addListener.bind(modelConfigManager),
    removeListener: modelConfigManager.removeListener.bind(modelConfigManager)
  }
}
