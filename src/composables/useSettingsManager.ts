import { computed, ref, watch } from 'vue'
import { settingsManager, type AppSettings } from '../services/settings'

/**
 * 设置管理组合式函数
 * 提供响应式的设置管理功能
 */
export function useSettingsManager() {
  // 响应式的设置对象
  const settings = computed(() => settingsManager.getSettings())
  
  // 加载状态
  const isLoading = ref(false)
  
  // 错误状态
  const error = ref<string | null>(null)

  /**
   * 获取特定设置项
   */
  const getSetting = <K extends keyof AppSettings>(key: K): AppSettings[K] => {
    return settingsManager.get(key)
  }

  /**
   * 设置特定设置项
   */
  const setSetting = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    try {
      error.value = null
      settingsManager.set(key, value)
    } catch (err) {
      error.value = err instanceof Error ? err.message : '设置更新失败'
      console.error('设置更新失败:', err)
    }
  }

  /**
   * 批量更新设置
   */
  const updateSettings = (newSettings: Partial<AppSettings>) => {
    try {
      error.value = null
      settingsManager.update(newSettings)
    } catch (err) {
      error.value = err instanceof Error ? err.message : '设置更新失败'
      console.error('批量设置更新失败:', err)
    }
  }

  /**
   * 保存设置
   */
  const saveSettings = async () => {
    try {
      isLoading.value = true
      error.value = null
      await settingsManager.save()
    } catch (err) {
      error.value = err instanceof Error ? err.message : '设置保存失败'
      console.error('设置保存失败:', err)
      throw err
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 重置设置
   */
  const resetSettings = () => {
    try {
      error.value = null
      settingsManager.reset()
    } catch (err) {
      error.value = err instanceof Error ? err.message : '设置重置失败'
      console.error('设置重置失败:', err)
    }
  }

  /**
   * 重置特定设置项
   */
  const resetSetting = <K extends keyof AppSettings>(key: K) => {
    try {
      error.value = null
      settingsManager.resetKey(key)
    } catch (err) {
      error.value = err instanceof Error ? err.message : '设置重置失败'
      console.error('设置项重置失败:', err)
    }
  }

  /**
   * 导出设置
   */
  const exportSettings = (): string => {
    try {
      error.value = null
      return settingsManager.export()
    } catch (err) {
      error.value = err instanceof Error ? err.message : '设置导出失败'
      console.error('设置导出失败:', err)
      throw err
    }
  }

  /**
   * 导入设置
   */
  const importSettings = (jsonString: string) => {
    try {
      error.value = null
      settingsManager.import(jsonString)
    } catch (err) {
      error.value = err instanceof Error ? err.message : '设置导入失败'
      console.error('设置导入失败:', err)
      throw err
    }
  }

  /**
   * 添加设置变更监听器
   */
  const addSettingsListener = (listener: (settings: AppSettings) => void) => {
    return settingsManager.addListener(listener)
  }

  /**
   * 获取设置描述信息
   */
  const getSettingsInfo = () => {
    return settingsManager.getSettingsInfo()
  }

  /**
   * 主题相关的便捷方法
   */
  const theme = {
    get current() {
      return getSetting('theme')
    },
    set(value: AppSettings['theme']) {
      setSetting('theme', value)
    },
    toggle() {
      const current = getSetting('theme')
      if (current === 'light') {
        setSetting('theme', 'dark')
      } else if (current === 'dark') {
        setSetting('theme', 'auto')
      } else {
        setSetting('theme', 'light')
      }
    },
    isLight: computed(() => getSetting('theme') === 'light'),
    isDark: computed(() => getSetting('theme') === 'dark'),
    isAuto: computed(() => getSetting('theme') === 'auto')
  }

  /**
   * 语言相关的便捷方法
   */
  const language = {
    get current() {
      return getSetting('language')
    },
    set(value: AppSettings['language']) {
      setSetting('language', value)
    },
    toggle() {
      const current = getSetting('language')
      setSetting('language', current === 'zh-CN' ? 'en-US' : 'zh-CN')
    },
    isChinese: computed(() => getSetting('language') === 'zh-CN'),
    isEnglish: computed(() => getSetting('language') === 'en-US')
  }

  /**
   * 题库设置相关的便捷方法
   */
  const questionSettings = {
    get difficulty() {
      return getSetting('defaultDifficulty')
    },
    set difficulty(value: AppSettings['defaultDifficulty']) {
      setSetting('defaultDifficulty', value)
    },
    get itemsPerPage() {
      return getSetting('itemsPerPage')
    },
    set itemsPerPage(value: AppSettings['itemsPerPage']) {
      setSetting('itemsPerPage', value)
    },
    get showExplanation() {
      return getSetting('showExplanation')
    },
    set showExplanation(value: AppSettings['showExplanation']) {
      setSetting('showExplanation', value)
    }
  }

  return {
    // 响应式数据
    settings,
    isLoading,
    error,
    
    // 基础方法
    getSetting,
    setSetting,
    updateSettings,
    saveSettings,
    resetSettings,
    resetSetting,
    
    // 导入导出
    exportSettings,
    importSettings,
    
    // 监听器
    addSettingsListener,
    
    // 工具方法
    getSettingsInfo,
    
    // 便捷访问器
    theme,
    language,
    questionSettings
  }
}

/**
 * 设置同步组合式函数
 * 用于在组件间同步设置状态
 */
export function useSettingsSync() {
  const { settings, addSettingsListener } = useSettingsManager()
  
  // 设置同步状态
  const syncStatus = ref<'idle' | 'syncing' | 'synced' | 'error'>('idle')
  
  /**
   * 同步设置到其他存储
   */
  const syncToStorage = async (storageKey: string) => {
    try {
      syncStatus.value = 'syncing'
      const settingsJson = JSON.stringify(settings.value)
      localStorage.setItem(storageKey, settingsJson)
      syncStatus.value = 'synced'
    } catch (error) {
      syncStatus.value = 'error'
      console.error('设置同步失败:', error)
    }
  }
  
  /**
   * 从其他存储同步设置
   */
  const syncFromStorage = (storageKey: string) => {
    try {
      syncStatus.value = 'syncing'
      const stored = localStorage.getItem(storageKey)
      if (stored) {
        const parsedSettings = JSON.parse(stored)
        settingsManager.update(parsedSettings)
        syncStatus.value = 'synced'
      }
    } catch (error) {
      syncStatus.value = 'error'
      console.error('设置同步失败:', error)
    }
  }
  
  return {
    syncStatus,
    syncToStorage,
    syncFromStorage
  }
}

/**
 * 设置验证组合式函数
 */
export function useSettingsValidation() {
  /**
   * 验证设置值
   */
  const validateSetting = <K extends keyof AppSettings>(
    key: K, 
    value: AppSettings[K]
  ): { isValid: boolean; error?: string } => {
    switch (key) {
      case 'theme':
        if (!['light', 'dark', 'auto'].includes(value as string)) {
          return { isValid: false, error: '主题值无效' }
        }
        break
      case 'language':
        if (!['zh-CN', 'en-US'].includes(value as string)) {
          return { isValid: false, error: '语言值无效' }
        }
        break
      case 'defaultDifficulty':
        if (!['easy', 'medium', 'hard'].includes(value as string)) {
          return { isValid: false, error: '难度值无效' }
        }
        break
      case 'itemsPerPage':
        if (typeof value !== 'number' || value < 1 || value > 100) {
          return { isValid: false, error: '每页项目数必须在1-100之间' }
        }
        break
      case 'autoSave':
      case 'showExplanation':
      case 'autoUpdate':
      case 'enableNotifications':
        if (typeof value !== 'boolean') {
          return { isValid: false, error: '布尔值无效' }
        }
        break
    }
    
    return { isValid: true }
  }
  
  /**
   * 验证所有设置
   */
  const validateAllSettings = (settings: Partial<AppSettings>) => {
    const errors: Record<string, string> = {}
    
    for (const [key, value] of Object.entries(settings)) {
      const validation = validateSetting(key as keyof AppSettings, value)
      if (!validation.isValid && validation.error) {
        errors[key] = validation.error
      }
    }
    
    return {
      isValid: Object.keys(errors).length === 0,
      errors
    }
  }
  
  return {
    validateSetting,
    validateAllSettings
  }
}