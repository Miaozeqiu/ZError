﻿import { reactive, watch, computed } from 'vue'

// AI 平台配置接口
export interface AIPlatform {
  id: string
  name: string
  displayName: string
  baseUrl: string
  apiKey: string
  enabled: boolean
  models: AIModel[]
  customHeaders?: Record<string, string>
  description?: string
  icon?: string        // 平台图标
  isRemote?: boolean   // 是否来自远程同步（禁止编辑/删除）
  url?: string         // 平台官网/控制台地址
  inviteUrl?: string   // 邀请链接
  inviteText?: string  // 邀请文字
}

// AI 模型配置接口
export interface AIModel {
  id: string
  name: string
  displayName: string
  platformId: string
  maxTokens: number
  temperature: number
  topP: number
  enabled: boolean
  category: 'text' | 'vision' | 'summary'  // 模型分类：文本模型、视觉模型或总结模型
  description?: string
  jsCode?: string  // 模型的JS代码配置
  icon?: string    // 模型图标
  isRemote?: boolean  // 是否来自远程同步（禁止编辑/删除）
  pricing?: {
    inputTokens: number  // 每千个输入token的价格
    outputTokens: number // 每千个输出token的价格
  }
}

// 模型配置设置接口
export interface ModelSettings {
  selectedTextModel: string | null    // 选中的文本模型（向后兼容，等于 selectedTextModels[0] 或 null）
  selectedTextModels: string[]        // 选中的文本模型列表（最多5个）
  selectedSummaryModel: string | null // 选中的总结模型（向后兼容，等于 selectedSummaryModels[0] 或 null）
  selectedSummaryModels: string[]     // 选中的总结模型列表（最多5个）
  selectedVisionModel: string | null  // 选中的视觉模型
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

// 远程模型数据 URL
const REMOTE_MODELS_URL = 'https://app.zerror.cc/models.json'

// 默认模型配置（无预定义平台，全部来自远程同步）
const DEFAULT_MODEL_SETTINGS: ModelSettings = {
  selectedTextModel: null,
  selectedTextModels: [],
  selectedSummaryModel: null,
  selectedSummaryModels: [],
  selectedVisionModel: null,
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

  constructor() {
    this.settings = reactive(this.loadSettings())
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
        return {
          ...DEFAULT_MODEL_SETTINGS,
          ...parsedSettings,
          // 过滤掉 name 为空的无效平台
          platforms: (parsedSettings.platforms || []).filter((p: AIPlatform) => p.name?.trim()),
        }
      }
    } catch (error) {
      console.warn('加载模型配置失败，使用默认配置:', error)
    }
    return { ...DEFAULT_MODEL_SETTINGS }
  }

  /**
   * 从远程同步平台和模型数据（每次启动时调用）
   * - 远程平台/模型标记 isRemote: true，禁止编辑/删除
   * - 保留用户的 apiKey、enabled 状态
   * - 远程已删除的平台/模型：若其模型被选中，自动替换为同平台同类型的另一个模型
   */
  async syncRemotePlatforms(): Promise<void> {
    let remotePlatforms: AIPlatform[] = []
    try {
      // 优先使用 Tauri HTTP 插件
      try {
        const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
        const r = await tauriFetch(REMOTE_MODELS_URL, { method: 'GET' })
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const json = await r.json()
        if (Array.isArray(json)) remotePlatforms = json as AIPlatform[]
      } catch {
        // 回退到浏览器 fetch（本地 models.json）
        const r = await fetch('/models.json')
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        const json = await r.json()
        if (Array.isArray(json)) remotePlatforms = json as AIPlatform[]
      }
    } catch (err) {
      console.warn('远程模型同步失败，跳过同步:', err)
      return
    }

    // 构建远程平台 id 集合
    const remotePlatformIds = new Set(remotePlatforms.map(p => p.id))

    // 处理远程平台已消失的情况
    for (const localPlatform of this.settings.platforms) {
      if (!localPlatform.isRemote) continue
      if (remotePlatformIds.has(localPlatform.id)) continue
      // 该远程平台已从远程消失
      const userModels = localPlatform.models.filter(m => !m.isRemote)
      if (userModels.length > 0) {
        // 有用户创建的模型，转为本地平台保留，只清理远程模型的选中状态
        for (const model of localPlatform.models.filter(m => m.isRemote)) {
          this._replaceSelectedModel(model.id, model.category, localPlatform.id)
        }
        localPlatform.isRemote = false
        localPlatform.models = userModels
      } else {
        // 无用户模型，清理所有选中状态
        for (const model of localPlatform.models) {
          this._replaceSelectedModel(model.id, model.category, localPlatform.id)
        }
      }
    }

    // 移除所有旧的远程平台（包括旧版本未标记 isRemote 的同 id 平台）
    // 已转为本地（isRemote=false）的平台不会被过滤掉
    const remotePlatformIdSet = new Set(remotePlatforms.map(p => p.id))
    const userPlatformMap = new Map(this.settings.platforms.map(p => [p.id, p]))
    this.settings.platforms = this.settings.platforms.filter(
      p => !p.isRemote && p.name?.trim()
    )

    // 将远程平台插入到列表最前面，保留用户的 apiKey/enabled

    const newRemotePlatforms: AIPlatform[] = remotePlatforms.map(rp => {
      const existing = userPlatformMap.get(rp.id)
      const models: AIModel[] = (rp.models || []).map(rm => ({
        ...rm,
        platformId: rp.id,
        isRemote: true,
        enabled: rm.enabled ?? true,
        maxTokens: rm.maxTokens ?? 4096,
        temperature: rm.temperature ?? 0.7,
        topP: rm.topP ?? 0.9,
      }))

      // 检查远程平台中已消失的模型，替换选中状态
      if (existing) {
        const remoteModelIds = new Set(models.map(m => m.id))
        for (const oldModel of existing.models.filter(m => m.isRemote)) {
          if (!remoteModelIds.has(oldModel.id)) {
            this._replaceSelectedModel(oldModel.id, oldModel.category, rp.id, models)
          }
        }
      }

      return {
        id: rp.id,
        name: rp.name || rp.displayName || rp.id,
        displayName: rp.displayName || rp.name || rp.id,
        baseUrl: rp.baseUrl || '',
        description: rp.description,
        icon: rp.icon,
        url: rp.url,
        inviteUrl: rp.inviteUrl,
        inviteText: rp.inviteText,
        isRemote: true,
        apiKey: existing?.apiKey || '',
        enabled: existing?.enabled ?? true,
        models,
      }
    })

    // 远程平台放前面，用户自定义平台放后面
    this.settings.platforms = [...newRemotePlatforms, ...this.settings.platforms]
  }

  /**
   * 当某个模型被删除/消失时，若它被选中，替换为同平台同类型的另一个可用模型
   */
  private _replaceSelectedModel(
    modelId: string,
    category: string,
    platformId: string,
    candidateModels?: AIModel[]
  ): void {
    const findReplacement = (): AIModel | undefined => {
      const pool = candidateModels
        ?? this.settings.platforms.find(p => p.id === platformId)?.models ?? []
      return pool.find(m => m.id !== modelId && m.category === category && m.enabled !== false)
    }

    if (category === 'text') {
      if (this.settings.selectedTextModels?.includes(modelId)) {
        const replacement = findReplacement()
        this.settings.selectedTextModels = this.settings.selectedTextModels.filter(id => id !== modelId)
        if (replacement && !this.settings.selectedTextModels.includes(replacement.id)) {
          this.settings.selectedTextModels.push(replacement.id)
        }
        this.settings.selectedTextModel = this.settings.selectedTextModels[0] || null
      }
    } else if (category === 'summary') {
      if (this.settings.selectedSummaryModels?.includes(modelId)) {
        const replacement = findReplacement()
        this.settings.selectedSummaryModels = this.settings.selectedSummaryModels.filter(id => id !== modelId)
        if (replacement && !this.settings.selectedSummaryModels.includes(replacement.id)) {
          this.settings.selectedSummaryModels.push(replacement.id)
        }
        this.settings.selectedSummaryModel = this.settings.selectedSummaryModels[0] || null
      }
    } else if (category === 'vision') {
      if (this.settings.selectedVisionModel === modelId) {
        const replacement = findReplacement()
        this.settings.selectedVisionModel = replacement?.id || null
      }
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
      return allModels.find(m => m.id === this.settings.selectedTextModels[0] && m.category === 'text') || null
    }
    // 兜底从旧字段获取
    if (this.settings.selectedTextModel) {
      const allModels = this.settings.platforms.flatMap(p => p.models)
      return allModels.find(m => m.id === this.settings.selectedTextModel && m.category === 'text') || null
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
        .map(id => allModels.find(m => m.id === id && m.category === 'text'))
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
    return allModels.find(m => m.id === this.settings.selectedVisionModel && m.category === 'vision') || null
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
    const newPlatform: AIPlatform = {
      ...platform,
      id,
      displayName: platform.name, // 确保设置 displayName 字段
      models: platform.models || [] // 使用传入的模型数组，如果为空则使用空数组
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
      Object.assign(platform, updates)
      // 如果更新了name字段，同时更新displayName
      if (updates.name) {
        platform.displayName = updates.name
      }
    }
  }

  /**
   * 删除平台
   */
  removePlatform(platformId: string): void {
    const index = this.settings.platforms.findIndex(p => p.id === platformId)
    if (index !== -1) {
      const platform = this.settings.platforms[index]
      // 清理该平台下所有模型的选中状态
      if (this.settings.selectedTextModels) {
        const platformModelIds = new Set(platform.models.map(m => m.id))
        this.settings.selectedTextModels = this.settings.selectedTextModels.filter(id => !platformModelIds.has(id))
        this.settings.selectedTextModel = this.settings.selectedTextModels[0] || null
      }
      if (this.settings.selectedSummaryModels) {
        const platformModelIds = new Set(platform.models.map(m => m.id))
        this.settings.selectedSummaryModels = this.settings.selectedSummaryModels.filter(id => !platformModelIds.has(id))
        this.settings.selectedSummaryModel = this.settings.selectedSummaryModels[0] || null
      }
      if (this.settings.selectedVisionModel && platform.models.some(m => m.id === this.settings.selectedVisionModel)) {
        this.settings.selectedVisionModel = null
      }
      this.settings.platforms.splice(index, 1)
    }
  }

  /**
   * 添加自定义模型到平台
   */
  addModelToPlatform(platformId: string, model: Omit<AIModel, 'id' | 'platformId'>): string {
    const platform = this.settings.platforms.find(p => p.id === platformId)
    if (!platform) {
      throw new Error('平台不存在')
    }

    const modelId = `${platformId}_${model.name}_${Date.now()}`
    const newModel: AIModel = {
      ...model,
      id: modelId,
      platformId
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
        this._replaceSelectedModel(modelId, model.category, platform.id)
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
        Object.assign(this.settings, importedSettings)
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
    availableModels: computed(() => modelConfigManager.getAvailableModels()),

    // 方法
    setSelectedModel: modelConfigManager.setSelectedModel.bind(modelConfigManager),
    setSelectedTextModel: modelConfigManager.setSelectedTextModel.bind(modelConfigManager),
    setSelectedSummaryModel: modelConfigManager.setSelectedSummaryModel.bind(modelConfigManager),
    setSelectedVisionModel: modelConfigManager.setSelectedVisionModel.bind(modelConfigManager),
    toggleSelectedTextModel: modelConfigManager.toggleSelectedTextModel.bind(modelConfigManager),
    toggleSelectedSummaryModel: modelConfigManager.toggleSelectedSummaryModel.bind(modelConfigManager),
    isTextModelSelected: modelConfigManager.isTextModelSelected.bind(modelConfigManager),
    isSummaryModelSelected: modelConfigManager.isSummaryModelSelected.bind(modelConfigManager),
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