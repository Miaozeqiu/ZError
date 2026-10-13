/** 模型配置单例：本地存储、选中态、增删改平台/模型。远程拉取走 configRemote.ts。 */
import { reactive, watch } from 'vue'
import type { AIModel, AIPlatform, ModelSettings } from './configTypes'
import { inferPlatformApiProtocol, modelHasVision, resolveRemoteHasVision } from './configTypes'
import {
  REMOTE_MODELS_REQUEST_COOLDOWN_MS,
  dedupeModelsById,
  dedupeRemotePlatforms,
  fetchRemoteModelsCatalog,
  getPlatformApiKey,
  isLikelyUserCreatedModel,
  sanitizeStoredPlatforms,
} from './configRemote'

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
    retryCount: 10,
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
        // 协议跟远控。思考开关以本机已保存的值为准，没有才用远控缺省。
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
          enableThinking: typeof existingModel?.enableThinking === 'boolean'
            ? existingModel.enableThinking
            : (rm.enableThinking ?? isKnownThinkingModel),
          thinkingOffEnableThinkingFalse: typeof existingModel?.thinkingOffEnableThinkingFalse === 'boolean'
            ? existingModel.thinkingOffEnableThinkingFalse
            : (rm.thinkingOffEnableThinkingFalse ?? true),
          thinkingOffThinkingTypeDisabled: typeof existingModel?.thinkingOffThinkingTypeDisabled === 'boolean'
            ? existingModel.thinkingOffThinkingTypeDisabled
            : (rm.thinkingOffThinkingTypeDisabled ?? false),
          thinkingOffResponsesEffort: existingModel?.thinkingOffResponsesEffort
            ?? rm.thinkingOffResponsesEffort
            ?? 'minimal',
          thinkingEffort: existingModel?.thinkingEffort ?? rm.thinkingEffort ?? 'medium',
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
        inviteUrl: String(rp.inviteUrl || '').trim(),
        inviteText: String(rp.inviteText || '').trim(),
        inviteCode: String(rp.inviteCode || '').trim(),
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

export type { ModelConfigManager }
export const modelConfigManager = new ModelConfigManager()
