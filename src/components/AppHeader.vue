<template>
  <div class="app-header" data-tauri-drag-region>
    <div class="header-left">
      <div class="app-logo">
        <img src="/icons/favicon.ico" alt="ZError Logo" width="20" height="20" />
      </div>
      <div class="app-title">ZError</div>
    </div>
    
    <div class="header-center">
      <!-- 可以在这里添加搜索框或其他功能 -->
    </div>
    
    <div class="header-right">
      <button 
        class="window-control minimize" 
        @click="minimizeWindow"
        title="最小化"
      >
        <svg width="12" height="12" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
          <path d="M863.7 552.5H160.3c-10.6 0-19.2-8.6-19.2-19.2v-41.7c0-10.6 8.6-19.2 19.2-19.2h703.3c10.6 0 19.2 8.6 19.2 19.2v41.7c0 10.6-8.5 19.2-19.1 19.2z" fill="currentColor"/>
        </svg>
      </button>
      
      <button 
        class="window-control maximize" 
        @click="toggleMaximize"
        :title="isMaximized ? '还原' : '最大化'"
      >
        <svg width="12" height="12" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" v-if="!isMaximized">
          <path d="M770.9 923.3H253.1c-83.8 0-151.9-68.2-151.9-151.9V253.6c0-83.8 68.2-151.9 151.9-151.9h517.8c83.8 0 151.9 68.2 151.9 151.9v517.8c0 83.8-68.1 151.9-151.9 151.9zM253.1 181.7c-39.7 0-71.9 32.3-71.9 71.9v517.8c0 39.7 32.3 71.9 71.9 71.9h517.8c39.7 0 71.9-32.3 71.9-71.9V253.6c0-39.7-32.3-71.9-71.9-71.9H253.1z" fill="currentColor"/>
        </svg>
        <svg width="12" height="12" viewBox="0 0 12 12" v-else>
          <rect x="2" y="3" width="6" height="6" stroke="currentColor" stroke-width="1.5" fill="none"/>
          <rect x="4" y="1" width="6" height="6" stroke="currentColor" stroke-width="1.5" fill="none"/>
        </svg>
      </button>
      
      <button 
        class="window-control close" 
        @click="closeWindow"
        title="关闭"
      >
        <svg width="12" height="12" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
          <path d="M897.6 183.5L183 898.1c-7.5 7.5-19.6 7.5-27.1 0l-29.5-29.5c-7.5-7.5-7.5-19.6 0-27.1L841 126.9c7.5-7.5 19.6-7.5 27.1 0l29.5 29.5c7.5 7.4 7.5 19.6 0 27.1z" fill="currentColor"/>
          <path d="M183 126.9l714.7 714.7c7.5 7.5 7.5 19.6 0 27.1l-29.5 29.5c-7.5 7.5-19.6 7.5-27.1 0L126.4 183.5c-7.5-7.5-7.5-19.6 0-27.1l29.5-29.5c7.4-7.5 19.6-7.5 27.1 0z" fill="currentColor"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const isMaximized = ref(false)
const isTauri = ref(false)

const minimizeWindow = async () => {
  console.log('Minimize button clicked')
  console.log('isTauri.value:', isTauri.value)
  
  if (!isTauri.value) {
    console.log('Not in Tauri environment, skipping minimize')
    return
  }
  
  try {
    console.log('Attempting to minimize window...')
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const appWindow = getCurrentWindow()
    await appWindow.minimize()
    console.log('Window minimized successfully')
  } catch (error) {
    console.error('Failed to minimize window:', error)
  }
}

const toggleMaximize = async () => {
  console.log('Maximize/Restore button clicked')
  console.log('isTauri.value:', isTauri.value)
  console.log('isMaximized.value:', isMaximized.value)
  
  if (!isTauri.value) {
    console.log('Not in Tauri environment, skipping maximize/restore')
    return
  }
  
  try {
    console.log('Attempting to toggle maximize...')
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const appWindow = getCurrentWindow()
    if (isMaximized.value) {
      console.log('Unmaximizing window...')
      await appWindow.unmaximize()
    } else {
      console.log('Maximizing window...')
      await appWindow.maximize()
    }
    isMaximized.value = !isMaximized.value
    console.log('Window toggle completed, new state:', isMaximized.value)
  } catch (error) {
    console.error('Failed to toggle maximize:', error)
  }
}

const closeWindow = async () => {
  console.log('Close button clicked')
  console.log('isTauri.value:', isTauri.value)
  
  if (!isTauri.value) {
    console.log('Not in Tauri environment, skipping close')
    return
  }
  
  try {
    console.log('Attempting to close window...')
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const appWindow = getCurrentWindow()
    await appWindow.close()
    console.log('Window closed successfully')
  } catch (error) {
    console.error('Failed to close window:', error)
  }
}

// 检测是否在Tauri环境中运行
const checkTauriEnvironment = () => {
  console.log('Checking Tauri environment...')
  console.log('window.__TAURI__:', typeof window !== 'undefined' ? window.__TAURI__ : 'window undefined')
  console.log('window.__TAURI_INTERNALS__:', typeof window !== 'undefined' ? window.__TAURI_INTERNALS__ : 'window undefined')
  
  // 更新检测逻辑，使用 __TAURI_INTERNALS__ 作为检测标准
  const isTauriEnv = typeof window !== 'undefined' && window.__TAURI_INTERNALS__ !== undefined
  console.log('Tauri environment detected:', isTauriEnv)
  return isTauriEnv
}

// 监听窗口状态变化
onMounted(async () => {
  isTauri.value = checkTauriEnvironment()
  
  if (!isTauri.value) {
    console.log('Running in browser environment, Tauri APIs disabled')
    return
  }
  
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const appWindow = getCurrentWindow()
    isMaximized.value = await appWindow.isMaximized()
    
    // 监听窗口最大化/还原事件
    const unlistenResize = await appWindow.onResized(() => {
      appWindow.isMaximized().then(maximized => {
        isMaximized.value = maximized
      })
    })
    
    // 组件卸载时清理监听器
    return () => {
      unlistenResize()
    }
  } catch (error) {
    console.error('Failed to setup window listeners:', error)
  }
})
</script>

<style scoped>
.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 32px;
  background: var(--bg-primary, #f4f4f4);
  color: var(--text-primary, #2d3748);
  user-select: none;
  position: relative;
  z-index: 1000;
}

.header-left {
  margin-left: 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  color:  #ffbd42;
}

.app-logo {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}

.app-logo svg {
  color: rgba(255, 255, 255, 0.9);
}

.app-title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
}

.header-center {
  flex: 1;
  display: flex;
  justify-content: center;
  align-items: center;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 1px;
  flex: 0 0 auto;
}

.window-control {
  border-radius: 0px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-primary, #2d3748);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background-color 0.2s ease;
}

.window-control:hover {
  background-color: rgba(158, 158, 158, 0.1);
}

.window-control.close:hover {
  background-color: #e74c3c;
  color: white;
}

.window-control.minimize:hover,
.window-control.maximize:hover {
  background-color: var(--bg-secondary, #e2e8f0);
}

/* 确保拖拽区域不会被按钮阻挡 */
.window-control {
  -webkit-app-region: no-drag;
}
</style>