<template>
  <div class="about-app">
    <h2 class="section-title">关于应用</h2>

    <div class="about-info">
      <div class="app-info">
        <div class="app-icon">
          <img class="app-icon-image" src="/icons/favicon.ico" alt="logo">
        </div>

        <div class="app-details">
          <h3 class="app-name">ZError</h3>
          <p class="app-version">版本 2.0.2</p>
          <p class="app-description">支持OCS的AI题库</p>
        </div>
      </div>

      <!-- 链接信息 -->
      <div class="app-links">
        <div class="link-item">
          <div class="link-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="link-info">
            <span class="link-label">官方网站</span>
            <a href="https://app.zerror.cc" target="_blank" class="link-url">app.zerror.cc</a>
          </div>
        </div>

        <div class="link-item">
          <div class="link-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="link-info">
            <span class="link-label">GitHub 仓库</span>
            <a href="https://github.com/Miaozeqiu/ZError" target="_blank" class="link-url">github.com/Miaozeqiu/ZError</a>
          </div>
        </div>

        <div class="link-item">
          <div class="link-icon">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <polyline points="14,2 14,8 20,8" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              <polyline points="10,9 9,9 8,9" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
          </div>
          <div class="link-info">
            <span class="link-label">开源许可证</span>
            <a href="https://mit-license.org/" target="_blank" class="link-url">MIT License</a>
          </div>
        </div>
      </div>

      <!-- 调试面板 -->
      <div class="debug-panel">
        <div class="setting-item">
          <div class="setting-info">
            <h3 class="setting-title">调试面板</h3>
            <p class="setting-description">开启开发者调试工具，用于问题诊断和性能分析</p>
          </div>
          <div class="setting-control">
            <button 
              class="debug-button"
              @click="openDebugPanel"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M20 9V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M9 22V12h6v10M2 10.6L2 19a2 2 0 0 0 2 2h2M22 10.6V19a2 2 0 0 1-2 2h-2" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
              打开调试面板
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useSettingsManager } from '../../composables/useSettingsManager'
import { useModelConfig } from '../../services/modelConfig'
import { environmentDetector } from '../../services/environmentDetector'

// 获取设置和模型配置
const { settings } = useSettingsManager()
const { modelConfig } = useModelConfig()

// 调试信息
const debugInfo = ref({
  tauriEnv: false,
  tauriObject: false,
  tauriInternals: false,
  environmentType: 'browser' as 'tauri' | 'browser',
  availableApis: [] as string[]
})

// 检查环境信息
const checkEnvironment = () => {
  const envInfo = environmentDetector.getEnvironmentInfo()
  debugInfo.value = {
    tauriEnv: envInfo.isTauri,
    tauriObject: typeof window !== 'undefined' && !!window.__TAURI__,
    tauriInternals: typeof window !== 'undefined' && !!window.__TAURI_INTERNALS__,
    environmentType: envInfo.type,
    availableApis: envInfo.availableApis
  }
}

// 组件挂载时检查环境
onMounted(() => {
  checkEnvironment()
})

/**
 * 打开调试面板
 */
const openDebugPanel = async () => {
  try {
    if (environmentDetector.isTauriEnvironment()) {
      // Tauri 环境：调用后端命令打开开发者工具
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('open_devtools')
      console.log('开发者工具已打开')
    } else {
      // 浏览器环境：输出调试信息并尝试模拟 F12
      console.log('=== 调试信息 ===')
      console.log('当前环境:', debugInfo.value.environmentType)
      console.log('Tauri 环境:', debugInfo.value.tauriEnv)
      console.log('可用 API:', debugInfo.value.availableApis)
      console.log('设置信息:', settings.value)
      console.log('模型配置:', modelConfig.value)
      
      // 尝试触发浏览器开发者工具（某些浏览器支持）
      if (typeof window !== 'undefined') {
        const event = new KeyboardEvent('keydown', {
          key: 'F12',
          code: 'F12',
          keyCode: 123,
          which: 123,
          bubbles: true
        })
        document.dispatchEvent(event)
      }
    }
  } catch (error) {
    console.error('打开调试面板失败:', error)
  }
}
</script>

<style scoped>
.about-app {
  padding: 0;
}

.section-title {
  font-size: 24px;
  font-weight: 600;
  color: var(--about-section-title-color);
  margin-bottom: 24px;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--about-section-title-border);
}

.about-info {
  padding: 20px 0;
}

.app-info {
  display: flex;
  align-items: center;
  gap: 20px;
  margin-bottom: 32px;
}

.app-icon {
  margin-left: 5px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  border-radius: 32px;
  color: white;
}

.app-icon-image {
  width: 72px;
  height: 72px;
}

.app-name {
  font-size: 24px;
  font-weight: 600;
  color: var(--about-text);
  margin-top: 0px;
  margin-bottom: 4px;
}

.app-version {
  font-size: 14px;
  color: var(--about-text-secondary);
  margin-bottom: 0px;
  margin-top: 0px;
}

.app-description {
  margin-top: 0px;
  margin-bottom: 0px;
  font-size: 16px;
  color: var(--about-text);
}

.app-links {
  margin-top: 24px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.link-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: var(--about-card-bg);
  border: 1px solid var(--about-card-border);
  border-radius: 8px;
  transition: all 0.2s ease;
}

.link-item:hover {
  background: var(--about-card-hover-bg);
  border-color: var(--about-accent);
}

.link-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  background: var(--about-link-icon-bg);
  border-radius: 8px;
  color: white;
  flex-shrink: 0;
}

.link-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
}

.link-label {
  font-size: 14px;
  font-weight: 600;
  color: var(--about-text);
}

.link-url {
  font-size: 13px;
  color: var(--about-accent);
  text-decoration: none;
  transition: color 0.2s ease;
}

.link-url:hover {
  color: var(--about-accent-hover);
  text-decoration: underline;
}

/* 调试面板样式 */
.debug-panel {
  margin-top: 32px;
  padding-top: 24px;
  border-top: 1px solid var(--about-card-border);
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
}

.setting-info {
  flex: 1;
}

.setting-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.setting-description {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.setting-control {
  flex-shrink: 0;
}

.debug-button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: var(--about-debug-button-bg);
  border: 1px solid var(--about-debug-button-border);
  border-radius: 6px;
  color: var(--about-debug-button-color);
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.debug-button:hover {
  background: var(--about-debug-button-hover-bg);
  border-color: var(--about-debug-button-hover-border);
  color: var(--about-debug-button-hover-color);
}

.debug-button:active {
  transform: translateY(1px);
}

.debug-button svg {
  flex-shrink: 0;
}


</style>