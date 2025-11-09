import { reactive, watch } from 'vue'

// 设置接口定义
export interface AppSettings {
  // 常规设置
  theme: 'light' | 'dark' | 'auto'
  language: 'zh-CN' | 'en-US'
  autoSave: boolean
  
  // 题库设置
  autoAddToQuestionBank: boolean
  // 非思考模型分析开关（影响后端提示词）
  enableNonThinkingModelAnalysis: boolean
  
  // 网络设置
  network: {
    serverPort: number
    enableLanAccess: boolean
    bindAddress: string
  }
  
  // 应用设置
  windowSize: {
    width: number
    height: number
  }
  windowPosition: {
    x: number
    y: number
  }
  autoUpdate: boolean
  enableNotifications: boolean
}

// 默认设置
const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  language: 'zh-CN',
  autoSave: true,
  autoAddToQuestionBank: false,
  enableNonThinkingModelAnalysis: false,
  network: {
    serverPort: 3000,
    enableLanAccess: false,
    bindAddress: '127.0.0.1'
  },
  windowSize: {
    width: 1200,
    height: 800
  },
  windowPosition: {
    x: 100,
    y: 100
  },
  autoUpdate: true,
  enableNotifications: true
}

// 设置存储键
const SETTINGS_STORAGE_KEY = 'app_settings'

/**
 * 设置管理器类
 * 提供设置的读取、保存、重置等功能
 */
class SettingsManager {
  private settings: AppSettings
  private listeners: Set<(settings: AppSettings) => void> = new Set()

  constructor() {
    this.settings = reactive(this.loadSettings())
    this.setupAutoSave()
  }

  /**
   * 从本地存储加载设置
   */
  private loadSettings(): AppSettings {
    try {
      const stored = localStorage.getItem(SETTINGS_STORAGE_KEY)
      if (stored) {
        const parsedSettings = JSON.parse(stored)
        // 合并默认设置和存储的设置，确保新增的设置项有默认值
        return { ...DEFAULT_SETTINGS, ...parsedSettings }
      }
    } catch (error) {
      console.warn('加载设置失败，使用默认设置:', error)
    }
    return { ...DEFAULT_SETTINGS }
  }

  /**
   * 保存设置到本地存储
   */
  private saveSettings(): void {
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(this.settings))
      this.notifyListeners()
    } catch (error) {
      console.error('保存设置失败:', error)
      throw new Error('设置保存失败')
    }
  }

  /**
   * 设置自动保存
   */
  private setupAutoSave(): void {
    watch(
      () => this.settings,
      () => {
        if (this.settings.autoSave) {
          this.saveSettings()
        }
      },
      { deep: true }
    )
  }

  /**
   * 通知监听器设置已更改
   */
  private notifyListeners(): void {
    this.listeners.forEach(listener => {
      try {
        listener(this.settings)
      } catch (error) {
        console.error('设置监听器执行失败:', error)
      }
    })
  }

  /**
   * 获取当前设置
   */
  getSettings(): AppSettings {
    return this.settings
  }

  /**
   * 获取特定设置项
   */
  get<K extends keyof AppSettings>(key: K): AppSettings[K] {
    return this.settings[key]
  }

  /**
   * 设置特定设置项
   */
  set<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    this.settings[key] = value
  }

  /**
   * 批量更新设置
   */
  update(newSettings: Partial<AppSettings>): void {
    Object.assign(this.settings, newSettings)
  }

  /**
   * 手动保存设置
   */
  save(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.saveSettings()
        resolve()
      } catch (error) {
        reject(error)
      }
    })
  }

  /**
   * 重置设置为默认值
   */
  reset(): void {
    Object.assign(this.settings, DEFAULT_SETTINGS)
  }

  /**
   * 重置特定设置项
   */
  resetKey<K extends keyof AppSettings>(key: K): void {
    this.settings[key] = DEFAULT_SETTINGS[key]
  }

  /**
   * 添加设置变更监听器
   */
  addListener(listener: (settings: AppSettings) => void): () => void {
    this.listeners.add(listener)
    // 返回取消监听的函数
    return () => {
      this.listeners.delete(listener)
    }
  }

  /**
   * 移除设置变更监听器
   */
  removeListener(listener: (settings: AppSettings) => void): void {
    this.listeners.delete(listener)
  }

  /**
   * 导出设置为JSON
   */
  export(): string {
    return JSON.stringify(this.settings, null, 2)
  }

  /**
   * 从JSON导入设置
   */
  import(jsonString: string): void {
    try {
      const importedSettings = JSON.parse(jsonString)
      // 验证导入的设置格式
      if (this.validateSettings(importedSettings)) {
        this.update(importedSettings)
      } else {
        throw new Error('导入的设置格式无效')
      }
    } catch (error) {
      console.error('导入设置失败:', error)
      throw new Error('设置导入失败')
    }
  }

  /**
   * 验证设置格式
   */
  private validateSettings(settings: any): boolean {
    if (!settings || typeof settings !== 'object') {
      return false
    }

    // 验证必要的设置项类型
    const validations = [
      () => !settings.theme || ['light', 'dark', 'auto'].includes(settings.theme),
      () => !settings.language || ['zh-CN', 'en-US'].includes(settings.language),
      () => !settings.autoSave || typeof settings.autoSave === 'boolean',
      () => !settings.autoAddToQuestionBank || typeof settings.autoAddToQuestionBank === 'boolean',
      () => !settings.enableNonThinkingModelAnalysis || typeof settings.enableNonThinkingModelAnalysis === 'boolean'
    ]

    return validations.every(validation => validation())
  }

  /**
   * 获取设置的描述信息
   */
  getSettingsInfo(): Record<keyof AppSettings, string> {
    return {
      theme: '界面主题模式',
      language: '应用界面语言',
      autoSave: '自动保存设置',
      autoAddToQuestionBank: '自动将AI返回的题目添加到本地题库',
      network: '网络配置设置',
      windowSize: '窗口大小',
      windowPosition: '窗口位置',
      autoUpdate: '自动更新应用',
      enableNotifications: '启用通知'
    }
  }
}

// 创建全局设置管理器实例
export const settingsManager = new SettingsManager()

// 导出设置管理器类型
export type { SettingsManager }

// 便捷的钩子函数
export function useSettings() {
  return {
    settings: settingsManager.getSettings(),
    get: settingsManager.get.bind(settingsManager),
    set: settingsManager.set.bind(settingsManager),
    update: settingsManager.update.bind(settingsManager),
    save: settingsManager.save.bind(settingsManager),
    reset: settingsManager.reset.bind(settingsManager),
    addListener: settingsManager.addListener.bind(settingsManager),
    removeListener: settingsManager.removeListener.bind(settingsManager)
  }
}