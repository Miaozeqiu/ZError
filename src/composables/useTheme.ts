import { ref, computed, watch, onMounted, readonly } from 'vue'
import { settingsManager } from '../services/settings'
import { getCurrentWindow } from '@tauri-apps/api/window'
import type { UnlistenFn } from '@tauri-apps/api/event'

export type ThemeMode = 'light' | 'dark' | 'auto'

// 主题状态管理
const currentTheme = ref<ThemeMode>('light')
const systemPrefersDark = ref(false)

// 计算实际应用的主题
const effectiveTheme = computed(() => {
  if (currentTheme.value === 'auto') {
    return systemPrefersDark.value ? 'dark' : 'light'
  }
  return currentTheme.value
})

// 应用主题到DOM
const applyTheme = (theme: ThemeMode) => {
  const root = document.documentElement
  
  // 计算实际要应用的主题
  const actualTheme = theme === 'auto' 
    ? (systemPrefersDark.value ? 'dark' : 'light')
    : theme
  
  // 移除之前的主题类
  root.removeAttribute('data-theme')
  
  // 应用新主题
  if (actualTheme !== 'light') {
    root.setAttribute('data-theme', actualTheme)
  }
}

// 发送主题变化事件
const emitThemeChange = async (theme: ThemeMode, actualTheme: string) => {
  try {
    const { emit } = await import('@tauri-apps/api/event')
    await emit('theme-changed', { 
      theme: actualTheme,
      originalTheme: theme 
    })
    console.log('✅ 主题变化事件已发送:', actualTheme)
  } catch (eventError) {
    console.warn('发送主题变化事件失败:', eventError)
  }
}

// 检测系统主题偏好
const detectSystemTheme = async (): Promise<UnlistenFn | undefined> => {
  try {
    // 优先使用 Tauri API 获取系统主题
    if (typeof window !== 'undefined' && window.__TAURI__) {
      const appWindow = getCurrentWindow()
      const theme = await appWindow.theme()
      systemPrefersDark.value = theme === 'dark'
      
      // 监听系统主题变化
      const unlisten = await appWindow.onThemeChanged(({ payload: theme }) => {
        systemPrefersDark.value = theme === 'dark'
        
        // 如果当前是auto模式，发送主题变化事件
        if (currentTheme.value === 'auto') {
          const actualTheme = theme === 'dark' ? 'dark' : 'light'
          emitThemeChange('auto', actualTheme)
        }
      })
      
      return unlisten
    }
  } catch (error) {
    console.warn('Failed to detect system theme via Tauri API, falling back to CSS media query:', error)
  }
  
  // 回退到 CSS media query
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    systemPrefersDark.value = mediaQuery.matches
    
    // 监听系统主题变化
    mediaQuery.addEventListener('change', (e) => {
      systemPrefersDark.value = e.matches
      
      // 如果当前是auto模式，发送主题变化事件
      if (currentTheme.value === 'auto') {
        const actualTheme = e.matches ? 'dark' : 'light'
        emitThemeChange('auto', actualTheme)
      }
    })
  }
}

// 主题管理组合式函数
export function useTheme() {
  let themeUnlisten: UnlistenFn | null = null
  
  // 初始化主题
  const initTheme = async () => {
    try {
      // 检测系统主题偏好
      themeUnlisten = await detectSystemTheme()
      
      // 从设置中加载主题
      const settings = await settingsManager.getSettings()
      currentTheme.value = settings.theme as ThemeMode
      
      // 应用主题
      applyTheme(currentTheme.value)
    } catch (error) {
      console.warn('Failed to initialize theme:', error)
      // 使用默认主题
      currentTheme.value = 'light'
      applyTheme('light')
    }
  }
  
  // 清理函数
  const cleanup = () => {
    if (themeUnlisten) {
      themeUnlisten()
      themeUnlisten = null
    }
  }
  
  // 设置主题
  const setTheme = async (theme: ThemeMode) => {
    try {
      currentTheme.value = theme
      applyTheme(theme)
      
      // 保存到设置
      settingsManager.set('theme', theme)
      await settingsManager.save()
      
      // 发送主题变化事件到其他窗口
      const actualTheme = theme === 'auto' 
        ? (systemPrefersDark.value ? 'dark' : 'light')
        : theme
      
      await emitThemeChange(theme, actualTheme)
    } catch (error) {
      console.error('Failed to set theme:', error)
    }
  }
  
  // 切换主题
  const toggleTheme = async () => {
    const themes: ThemeMode[] = ['light', 'dark', 'auto']
    const currentIndex = themes.indexOf(currentTheme.value)
    const nextIndex = (currentIndex + 1) % themes.length
    await setTheme(themes[nextIndex])
  }
  
  // 获取主题显示名称
  const getThemeDisplayName = (theme: ThemeMode): string => {
    const names = {
      light: '浅色主题',
      dark: '深色主题',
      auto: '跟随系统'
    }
    return names[theme]
  }
  
  // 获取主题图标
  const getThemeIcon = (theme: ThemeMode): string => {
    const icons = {
      light: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z',
      dark: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z',
      auto: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'
    }
    return icons[theme]
  }
  
  // 监听主题变化
  watch(effectiveTheme, (newTheme) => {
    applyTheme(currentTheme.value)
  })
  
  // 监听系统主题变化（仅在auto模式下）
  watch([systemPrefersDark, currentTheme], () => {
    if (currentTheme.value === 'auto') {
      applyTheme('auto')
    }
  })
  
  return {
    // 状态
    currentTheme: readonly(currentTheme),
    effectiveTheme: readonly(effectiveTheme),
    systemPrefersDark: readonly(systemPrefersDark),
    
    // 方法
    initTheme,
    setTheme,
    toggleTheme,
    getThemeDisplayName,
    getThemeIcon,
    cleanup,
    
    // 工具方法
    isLight: computed(() => effectiveTheme.value === 'light'),
    isDark: computed(() => effectiveTheme.value === 'dark'),
    isAuto: computed(() => currentTheme.value === 'auto')
  }
}

// 全局主题实例
let globalThemeInstance: ReturnType<typeof useTheme> | null = null

// 获取全局主题实例
export function getGlobalTheme() {
  if (!globalThemeInstance) {
    globalThemeInstance = useTheme()
  }
  return globalThemeInstance
}

// 初始化全局主题
export async function initGlobalTheme() {
  const theme = getGlobalTheme()
  await theme.initTheme()
  return theme
}

// 导出只读的主题状态
export const themeState = computed(() => {
  const theme = getGlobalTheme()
  return {
    current: theme.currentTheme.value,
    effective: theme.effectiveTheme.value,
    isLight: theme.isLight.value,
    isDark: theme.isDark.value,
    isAuto: theme.isAuto.value
  }
})