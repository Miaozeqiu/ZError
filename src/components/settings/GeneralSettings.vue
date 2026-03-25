<template>
  <div class="general-settings">
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">主题模式</h3>
        <p class="setting-description">选择您偏好的界面主题</p>
      </div>
      <div class="setting-control">
        <ThemeSwitch v-model="localSettings.theme" @update:modelValue="handleThemeChange" />
      </div>
    </div>
  
    <div class="setting-item">
      <div class="setting-info">
        <h3 class="setting-title">缓存文件夹</h3>
        <p class="setting-description">打开应用缓存目录，可手动清理缓存文件</p>
      </div>
      <div class="setting-control">
        <button 
          ref="btnRef"
          class="open-cache-btn" 
          :class="{ 'btn-ripple': isAnimating }"
          @click="handleButtonClick"
        >
          <svg t="1774430153065" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="16" height="16">
            <path d="M418.688 133.333333a122.666667 122.666667 0 0 1 93.013333 42.666667H785.066667a186.666667 186.666667 0 0 1 186.581333 181.162667l0.085333 5.504v17.92h-0.256c0.170667 1.429333 0.256 2.88 0.256 4.373333V789.333333a186.666667 186.666667 0 0 1-186.666666 186.666667H238.933333A186.666667 186.666667 0 0 1 52.266667 789.333333V320a186.666667 186.666667 0 0 1 186.666666-186.666667z m0 74.666667H238.933333A112 112 0 0 0 126.933333 320v469.333333c0 61.866667 50.133333 112 112 112h546.133334c61.866667 0 112-50.133333 112-112V422.272H615.04a122.666667 122.666667 0 0 1-113.834667-76.992l-1.834666-4.842667-35.413334-100.416a48 48 0 0 0-45.269333-32.021333zM448 688a37.333333 37.333333 0 0 1 3.072 74.538667L448 762.666667h-170.666667a37.333333 37.333333 0 0 1-3.072-74.538667L277.333333 688h170.666667z m337.066667-437.333333H546.88l22.912 64.917333a48 48 0 0 0 41.685333 31.914667l3.562667 0.128 281.024-0.021334a112.021333 112.021333 0 0 0-106.389333-96.853333l-4.608-0.085333z" fill="currentColor"/>
          </svg>
          打开文件夹
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, nextTick } from 'vue'
import { useSettingsManager } from '../../composables/useSettingsManager'
import { useTheme } from '../../composables/useTheme'
import ThemeSwitch from '../ThemeSwitch.vue'

// 打开缓存文件夹
const openingCache = ref(false)
const isAnimating = ref(false)
const isCooldown = ref(false)

const btnRef = ref<HTMLElement | null>(null)
let animationTimer: any = null
const handleButtonClick = () => {
  // 1. 每次点击都会强制重新触发视觉动画
  if (animationTimer) clearTimeout(animationTimer)
  
  // 核心逻辑：先取消类名，强制重绘，再重新添加类名
  isAnimating.value = false
  
  if (btnRef.value) {
    // 强制引发重排 (Reflow)，确保浏览器感知到 class 的移除
    void btnRef.value.offsetWidth
  }
  
  // 使用 requestAnimationFrame 确保在下一次重绘时添加类名
  requestAnimationFrame(() => {
    isAnimating.value = true
    animationTimer = setTimeout(() => {
      isAnimating.value = false
      animationTimer = null
    }, 600)
  })

  // 2. 只有在冷却结束后才会再次触发实际逻辑
  if (isCooldown.value || openingCache.value) return
  
  isCooldown.value = true
  setTimeout(() => {
    isCooldown.value = false
  }, 5000)

  openCacheFolder()
}

// 打开处理函数
let invoke: any = null

const openCacheFolder = async () => {
  openingCache.value = true
  try {
    if (!invoke) {
      const core = await import('@tauri-apps/api/core')
      invoke = core.invoke
    }
    await invoke('open_cache_dir')
  } catch (e) {
    console.error('打开缓存文件夹失败:', e)
  } finally {
    openingCache.value = false
  }
}
// 设置管理
const { settings, saveSettings, setSetting } = useSettingsManager()

// 主题管理
const { setTheme } = useTheme()

// 本地设置状态
const localSettings = ref({
  theme: 'auto' as 'light' | 'dark' | 'auto'
})

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
  font-weight: 500;
  color: var(--text-primary);
  margin: 0 0 8px 0;
}

.setting-description {
  font-size: 12px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

.setting-control {
  flex-shrink: 0;
}

.open-cache-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  border-radius: 6px;
  border: 1px solid var(--border-color);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
  cursor: pointer;
  /* 显式禁用全局 transition 以防止在动画期间产生卡顿 */
  transition: background 0.2s ease, border-color 0.2s ease, opacity 0.2s ease !important;
}

.open-cache-btn:hover {
  background: var(--hover-bg);
  border-color: var(--border-secondary);
}

.open-cache-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 按钮阴影扩散动画 */
.btn-ripple {
  position: relative;
  overflow: visible;
  /* 确保动画不受全局 transition 干扰 */
  transition: none !important;
  animation: ripple-spread 0.6s cubic-bezier(0.23, 1, 0.32, 1);
}

@keyframes ripple-spread {
  0% {
    box-shadow: 0 0 0 0 rgba(102, 126, 234, 0.4);
  }
  100% {
    box-shadow: 0 0 0 15px rgba(102, 126, 234, 0);
  }
}
</style>