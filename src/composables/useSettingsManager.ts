import { computed, ref } from 'vue'
import { settingsManager, type AppSettings } from '../services/app/settings'

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