import { usesSharedDeepSeekKey } from './configKeyPolicy'
import { synchronizeRemoteCatalog } from './configRemoteSync'
import { replaceSelectedModel } from './configSelection'
/** 模型配置单例：本地存储、选中态、增删改平台/模型。远程拉取走 configRemote.ts。 */
import { reactive, watch } from 'vue'
import { readSecureDocument, writeSecureDocument } from '../security/secureStore'
import { createDocumentPersistence, replaceDocument } from '../security/documentPersistence'
import { settingsManager } from '../app/settings'
import type { SearchSettings } from '../searchProviders'
import type { AIModel, AIPlatform, ApiProtocol, ModelSettings } from './configTypes'
import { inferPlatformApiProtocol, isBuiltinApiProtocol, MAX_ANSWER_MODELS, modelHasVision } from './configTypes'
import { REMOTE_MODELS_REQUEST_COOLDOWN_MS, sanitizeStoredPlatforms } from './configRemote'

const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  selectedTextModel: null,
  selectedTextModels: [],
  selectedSummaryModel: null,
  selectedSummaryModels: [],
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
  readonly ready: Promise<void>
  private hydrated = false
  private settings: ModelSettings
  private readonly persistence: ReturnType<typeof createDocumentPersistence<ModelSettings>>
  private listeners: Set<(settings: ModelSettings) => void> = new Set()
  private remotePlatformsSyncAt = 0
  private pendingRemotePlatformsSync: Promise<void> | null = null


  constructor() {
    this.settings = reactive(this.loadSettings())
    this.persistence = createDocumentPersistence({
      ready: () => this.ready,
      writable: () => this.hydrated,
      read: () => this.settings,
      apply: value => replaceDocument(this.settings, value),
      write: value => writeSecureDocument('model_settings', value),
    })
    this.normalizeSelectedModels()
    this.ready = this.hydrate()
    this.setupAutoSave()
  }

  /**
   * 从本地存储加载模型配置
   */
  private loadSettings(): ModelSettings {
    return JSON.parse(JSON.stringify(DEFAULT_MODEL_SETTINGS))
  }

  private async hydrate(): Promise<void> {
    try {
      await settingsManager.ready
      const saved = await readSecureDocument<ModelSettings>('model_settings', MODEL_SETTINGS_STORAGE_KEY)
      if (saved) {
        Object.assign(this.settings, { ...DEFAULT_MODEL_SETTINGS, ...saved,
          platforms: sanitizeStoredPlatforms(saved.platforms || []) })
        this.normalizeSelectedModels()
      }
      this.settings.deepseekApiKey ??= this.settings.platforms
        .find(platform => usesSharedDeepSeekKey(platform) && platform.apiKey)?.apiKey
        || settingsManager.getSettings().search.deepseekApiKey || ''
      this.hydrated = true
    } catch { /* secureStorageState reports the failure; never overwrite unread data */ }
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
    const enabledModelIds = new Set(enabledModels.map(model => model.id))
    const legacyVisionId = this.settings.selectedVisionModel
    const legacyVision = legacyVisionId
      ? enabledModels.find(model => model.id === legacyVisionId && modelHasVision(model))
      : undefined

    const normalizedAnswerModels = this.dedupeAndFilterModelIds(
      [
        ...(this.settings.selectedTextModels || []),
        this.settings.selectedTextModel,
        legacyVision?.id,
      ],
      enabledModelIds,
      MAX_ANSWER_MODELS
    )

    const normalizedSummaryModels = this.dedupeAndFilterModelIds(
      [
        ...(this.settings.selectedSummaryModels || []),
        ...(this.settings.selectedSummaryModel ? [this.settings.selectedSummaryModel] : [])
      ],
      enabledModelIds,
      1
    )

    this.settings.selectedTextModels = normalizedAnswerModels
    this.settings.selectedTextModel = normalizedAnswerModels[0] || null
    this.settings.selectedSummaryModels = normalizedSummaryModels
    this.settings.selectedSummaryModel = normalizedSummaryModels[0] || null
    delete this.settings.selectedVisionModel
    this.settings.selectedAgentModel = this.settings.selectedAgentModel && enabledModelIds.has(this.settings.selectedAgentModel)
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

    if (this.settings.selectedAgentModel && platformModelIds.has(this.settings.selectedAgentModel)) {
      this.settings.selectedAgentModel = null
    }
  }







  /**
   * 从远程同步平台和模型数据（每次启动时调用）
   * - 远程平台/模型标记 isRemote: true
   * - 保留用户的 apiKey、enabled 状态
   * - 保留本地修改的地址和协议，同时更新远程默认设置
   * - 远程已删除的平台/模型：若其模型被选中，自动替换为同平台同类型的另一个模型
   */
  private performRemotePlatformsSync(): Promise<boolean> {
 return synchronizeRemoteCatalog({settings: this.settings, ready: this.ready,
  replaceSelectedModel: (id, platform, candidates) => this._replaceSelectedModel(id, platform, candidates),
  normalizeSelectedModels: () => this.normalizeSelectedModels(),
 })
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
  private _replaceSelectedModel(modelId: string, platformId: string, candidateModels?: AIModel[]): void {
 replaceSelectedModel(this.settings, modelId, platformId, candidateModels)
}

  /**
   * 保存配置到本地存储，并异步写入文件
   */
  private saveSettings(): void {
    if (!this.hydrated) return
    this.notifyListeners()
    void this.persistence.save().catch(() => undefined)
  }

  commit(mutate: (draft: ModelSettings) => void | Promise<void>): Promise<ModelSettings> {
    return this.persistence.commit(mutate).then(saved => { this.notifyListeners(); return saved })
  }

  save(): Promise<void> {
    return this.persistence.save().then(() => { this.notifyListeners() })
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

  getPlatformApiKey(platform: AIPlatform): string {
    return usesSharedDeepSeekKey(platform) ? this.settings.deepseekApiKey || '' : platform.apiKey
  }

  setDeepSeekApiKey(key: string): void {
    this.settings.deepseekApiKey = key
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
   * 获取所有选中的答题模型。
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
   * 切换答题模型选中状态。
   */
  toggleSelectedTextModel(modelId: string): void {
    this.normalizeSelectedModels()
    if (!this.settings.selectedTextModels) this.settings.selectedTextModels = []
    const idx = this.settings.selectedTextModels.indexOf(modelId)
    if (idx !== -1) {
      this.settings.selectedTextModels.splice(idx, 1)
    } else {
      if (this.settings.selectedTextModels.length >= MAX_ANSWER_MODELS) return
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
   * 从答题模型中选择第一个支持视觉的模型。
   */
  getSelectedVisionModel(): AIModel | null {
    return this.getSelectedTextModels().find(modelHasVision) || null
  }

  /**
   * 获取当前选中的模型（文本模型或视觉模型）
   */
  getSelectedModel(): AIModel | null {
    // 优先返回总结模型，然后是第一个答题模型。
    const summaryModel = this.getSelectedSummaryModel()
    if (summaryModel) {
      return summaryModel
    }
    return this.getSelectedTextModel()
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

  setPlatformApiProtocol(platformId: string, protocol: ApiProtocol): void {
    const platform = this.settings.platforms.find(item => item.id === platformId)
    if (!platform) return
    if (!platform.isRemote) {
      this.updatePlatform(platformId, { apiProtocol: protocol })
      return
    }
    if (!isBuiltinApiProtocol(protocol)) return

    const remoteApiProtocol = platform.remoteApiProtocol ?? 'openai-chat'
    const apiProtocolOverride = protocol === remoteApiProtocol ? undefined : protocol
    this.updatePlatform(platformId, {
      remoteApiProtocol,
      apiProtocolOverride,
      apiProtocol: protocol,
    })
  }

  resetPlatformConnection(platformId: string): void {
    const platform = this.settings.platforms.find(item => item.id === platformId)
    if (!platform?.isRemote || platform.remoteBaseUrl === undefined) return

    this.updatePlatform(platformId, {
      baseUrl: platform.remoteBaseUrl,
      apiProtocol: platform.remoteApiProtocol ?? 'openai-chat',
      apiProtocolOverride: undefined,
    })
  }

  /** 更新平台配置。 */
  updatePlatform(platformId: string, updates: Partial<AIPlatform>): void {
    const platform = this.settings.platforms.find(p => p.id === platformId)
    if (platform) {
      if (updates.apiKey !== undefined && usesSharedDeepSeekKey({ ...platform, ...updates })) {
        this.setDeepSeekApiKey(updates.apiKey)
        updates = { ...updates, apiKey: '' }
      }
      const wasEnabled = platform.enabled !== false
      Object.assign(platform, updates)
      if (platform.isRemote && updates.baseUrl !== undefined) {
        platform.baseUrlOverride = platform.baseUrl === platform.remoteBaseUrl ? undefined : platform.baseUrl
      }
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
    Object.assign(this.settings, DEFAULT_MODEL_SETTINGS, { deepseekApiKey: '' })
  }

  /**
   * 导出配置
   */
  export(): string {
    return JSON.stringify({ ...this.settings, deepseekApiKey: '', platforms: this.settings.platforms.map(platform => ({ ...platform, apiKey: '', customHeaders: {} })) }, null, 2)
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
          deepseekApiKey: this.settings.deepseekApiKey,
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

export const withConfiguredDeepSeekKey = (search: SearchSettings): SearchSettings => {
  if (search.provider !== 'deepseek') return search
  return { ...search, deepseekApiKey: modelConfigManager.getSettings().deepseekApiKey || '' }
}
