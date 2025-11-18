<template>
  <div class="setting-item">
    <div class="setting-info">
      <h3 class="setting-title">主题模式</h3>
      <p class="setting-description">选择您偏好的界面主题</p>
    </div>
    <div class="setting-control">
      <div class="theme-selector">
        <div 
          v-for="themeOption in themeOptions" 
          :key="themeOption.value"
          :class="['theme-option', { active: localSettings.theme === themeOption.value }]"
          @click="handleThemeChange(themeOption.value)"
        >
          <div class="theme-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path :d="themeOption.icon" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <span class="theme-name">{{ themeOption.name }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSettingsManager } from '../../composables/useSettingsManager'
import { useTheme } from '../../composables/useTheme'

// 设置管理
const { settings, saveSettings, setSetting } = useSettingsManager()

// 主题管理
const { setTheme } = useTheme()

// 本地设置状态
const localSettings = ref({
  theme: 'auto' as 'light' | 'dark' | 'auto'
})

// 主题选项
const themeOptions = [
  {
    value: 'light',
    name: '浅色主题',
    icon: 'M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z'
  },
  {
    value: 'dark',
    name: '深色主题',
    icon: 'M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z'
  },
  {
    value: 'auto',
    name: '跟随系统',
    icon: 'M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z'
  }
]

// 处理主题变更
const handleThemeChange = async (theme: 'light' | 'dark' | 'auto') => {
  localSettings.value.theme = theme
  setSetting('theme', theme)
  await setTheme(theme)
  await saveSettings()
}

// 同步本地设置
const syncLocalSettings = () => {
  localSettings.value = {
    theme: settings.value.theme || 'auto'
  }
}

onMounted(() => {
  syncLocalSettings()
})
</script>

<style scoped>
.setting-item {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 24px 0;
  border-bottom: 1px solid var(--border-color);
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-info {
  flex: 1;
  margin-right: 24px;
}

.setting-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.setting-description {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

.setting-control {
  flex-shrink: 0;
}

.theme-selector {
  display: flex;
  gap: 8px;
  background: var(--bg-secondary);
  border-radius: 8px;
  padding: 4px;
}

.theme-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: transparent;
  color: var(--text-secondary);
  font-size: 14px;
}

.theme-option:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.theme-option.active {
  background: var(--primary-color);
  color: white;
}

.theme-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
}

.theme-name {
  white-space: nowrap;
}
</style>