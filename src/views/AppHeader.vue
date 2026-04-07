<template>
  <div class="app-header" data-tauri-drag-region>
    <div class="header-left">
      <div class="app-logo">
        <img src="/icons/favicon.ico" alt="ZError Logo" width="20" height="20" />
      </div>
      <div class="app-title">ZError</div>
    </div>
    
    <div class="header-center">
      <div class="tutorial-stepper">
        <div class="step" :class="{ completed: isStep1Completed, active: !isStep1Completed }" @click="$emit('guide-to', 'model-settings')">
          <div class="step-indicator">
            <svg v-if="isStep1Completed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span v-else>1</span>
          </div>
          <span class="step-text">配置 AI 模型</span>
          <div class="step-tooltip">
            <strong>步骤 1：配置 AI 模型</strong><br>
            前往“设置 &gt; 模型设置”，选择一个 AI 平台并填写您的 API Key。<br>
            <a data-v-f7451f5a="" href="https://docs.zerror.cc/get-apiKey" target="_blank" rel="noopener noreferrer" class="api-doc-link">如何获取Api Key?</a><br><br>
            <strong>必须完成：</strong><br>
            • 在填写 API Key 的平台下，至少选择<strong>一个文本模型</strong>。<br>
            • （可选）还可以选择一个视觉和总结模型。
          </div>
        </div>
        <div class="step-connector" :class="{ completed: isStep1Completed }"></div>
        <div class="step" :class="{ completed: isStep1Completed && isStep2Completed, active: isStep1Completed && !isStep2Completed }" @click="$emit('guide-to', 'home')">
          <div class="step-indicator">
            <svg v-if="isStep1Completed && isStep2Completed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span v-else>2</span>
          </div>
          <span class="step-text">启动服务</span>
          <div class="step-tooltip">
            <strong>步骤 2：启动服务</strong><br>
            在“首页”<br>启动本地服务器。
          </div>
        </div>
        <div class="step-connector" :class="{ completed: isStep1Completed && isStep2Completed }"></div>
        <div class="step" :class="{ completed: isStep1Completed && isStep2Completed && isStep3Completed, active: isStep1Completed && isStep2Completed && !isStep3Completed }" @click="$emit('guide-to', 'ocs-config')">
          <div class="step-indicator">
            <svg v-if="isStep1Completed && isStep2Completed && isStep3Completed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="20 6 9 17 4 12"></polyline></svg>
            <span v-else>3</span>
          </div>
          <span class="step-text">让OCS连接题库</span>
          <div class="step-tooltip">
            <strong>步骤 3：让OCS连接题库</strong><br>
            在OCS题库配置中，配置题库
          </div>
        </div>
      </div>
      <button
        v-if="props.activeTab === 'questions'"
        class="campus-entry"
        type="button"
        title="打开校园题库"
        @click="openCampusBank"
      >
        <svg t="1774676033971" class="campus-entry-icon" viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" p-id="13992" aria-hidden="true">
          <path d="M711.64369225 373.38084187m-146.83947615 0a146.83947615 146.83947615 0 1 0 293.67895229 0 146.83947615 146.83947615 0 1 0-293.67895229 0Z" fill="#FED16C" p-id="13993"></path>
          <path d="M952.5443192 863.53186765H470.7301199c-34.3829365 0-62.25434548-27.87140898-62.25434548-62.25434548v-95.0449999c0-69.4260875 56.27357867-125.69966617 125.69966617-125.69966617h354.89766716c69.4260875 0 125.69966617 56.27357867 125.69966617 125.69966617v95.0449999c0.02589076 34.3829365-27.84551822 62.25434548-62.22845472 62.25434548z" fill="#FED16C" p-id="13994"></path>
          <path d="M392.26815525 295.72149097m-185.01540977 0a185.01540978 185.01540978 0 1 0 370.03081955 0 185.01540978 185.01540978 0 1 0-370.03081955 0Z" fill="#F9A214" p-id="13995"></path>
          <path d="M676.21217975 913.30686419H108.32413076c-54.13759052 0-98.02243792-43.88484741-98.02243793-98.02243792v-80.89569658c0-98.11305561 79.53643141-177.66243239 177.66243241-177.66243241h408.63395081c98.11305561 0 177.66243239 79.53643141 177.6624324 177.66243241v80.89569658c-0.01294539 54.12464514-43.8977928 98.02243792-98.0483287 98.02243792z" fill="#F9A214" p-id="13996"></path>
          <path d="M392.28110064 381.12218075c-42.991616 0-81.49118419-22.21427675-102.9805195-59.45814283-8.18148187-14.14930331-3.32696336-32.24694835 10.82233995-40.40253945 14.09752178-8.20737264 32.24694835-3.35285413 40.40253944 10.82233995 10.82233995 18.70607803 30.16274173 29.86499792 51.75564011 29.86499793 21.59289837 0 40.93330015-11.1589199 51.71680395-29.86499793 8.20737264-14.17519408 26.26618153-18.97793106 40.42843023-10.84823072 14.14930331 8.18148187 19.00382183 26.27912691 10.84823071 40.42843022-21.50228069 37.21797531-59.9889035 59.45814282-102.96757412 59.45814283h-0.02589077z" fill="#FFFFFF" p-id="13997"></path>
        </svg>
        <span class="campus-entry-text">想将题库分享给同学？试试校园题库吧</span>
      </button>
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
import { ref, onMounted, computed, watch, onUnmounted } from 'vue'
import { useModelConfig } from '../services/modelConfig'
import { serverRunning } from '../services/serverState'
import { listen, UnlistenFn } from '@tauri-apps/api/event'

const props = defineProps<{
  activeTab?: string
}>()

const isMaximized = ref(false)
const isTauri = ref(false)

const { settings: modelSettings, platforms: computedPlatforms, selectedTextModels, selectedTextModel } = useModelConfig()

// Tutorial Stepper Logic
const isStep1Completed = computed(() => {
  console.log('--- 开始计算 isStep1Completed ---')
  if (!computedPlatforms.value || computedPlatforms.value.length === 0) {
    console.log('computedPlatforms 为空')
    return false;
  }
  
  // 获取当前选中的所有文本模型ID（兼容不同的配置方式）
  let selectedTextModelIds = new Set<string>();
  if (selectedTextModels.value && selectedTextModels.value.length > 0) {
    // selectedTextModels.value 是 AIModel 数组，取 id
    selectedTextModels.value.forEach(m => selectedTextModelIds.add(m.id));
  } else if (selectedTextModel.value) {
    selectedTextModelIds.add(selectedTextModel.value.id);
  }
  
  console.log('当前选中的文本模型 IDs:', Array.from(selectedTextModelIds));
  
  // 找到所有配置了有效 apiKey 的平台
  const configuredPlatforms = computedPlatforms.value.filter(p => p.apiKey && p.apiKey.trim() !== '');
  console.log('已配置 apiKey 的平台:', configuredPlatforms.map(p => p.id));
  
  // 判断：在这些配置了 apiKey 的平台中，是否至少有一个平台，其拥有的某个文本模型正处于被选中状态
  const isCompleted = configuredPlatforms.some(platform => {
    const hasSelectedTextModel = platform.models?.some(model => {
      const isSelected = model.category === 'text' && selectedTextModelIds.has(model.id);
      if (isSelected) {
        console.log(`找到符合条件的文本模型：${model.id} (属于平台: ${platform.id})`);
      }
      return isSelected;
    });
    return hasSelectedTextModel;
  });

  console.log('步骤1 最终计算结果:', isCompleted);
  console.log('--- 结束计算 ---')
  return isCompleted;
})

const isStep2Completed = computed(() => {
  return serverRunning.value
})

// OCS Config step check (listen to HEAD request event from backend)
const isStep3Completed = ref(false)
let unlistenHeadEvent: UnlistenFn | null = null;

onMounted(async () => {
  unlistenHeadEvent = await listen('ocs-head-received', () => {
    console.log('--- 接收到来自后端的 OCS HEAD 请求事件，步骤 3 已完成 ---');
    isStep3Completed.value = true;
  });
})

onUnmounted(() => {
  if (unlistenHeadEvent) {
    unlistenHeadEvent();
  }
})

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
    const { getCurrentWindow } = await import('@tauri-apps/api/window')
    const appWindow = getCurrentWindow()

    if (appWindow.label === 'main') {
      console.log('Main window detected, hiding to tray...')
      await appWindow.hide()
      console.log('Main window hidden successfully')
      return
    }

    console.log('Attempting to close secondary window...')
    await appWindow.close()
    console.log('Secondary window closed successfully')
  } catch (error) {
    console.error('Failed to close window:', error)
  }
}

const openCampusBank = async () => {
  const url = 'https://tiku.zerror.cc/campus'

  try {
    if (isTauri.value) {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
      return
    }

    window.open(url, '_blank', 'noopener,noreferrer')
  } catch (error) {
    console.error('打开校园题库失败:', error)
    window.open(url, '_blank', 'noopener,noreferrer')
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
  justify-content: right;
  align-items: center;
  min-width: 0;
  pointer-events: none;
}

.campus-entry {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  max-width: min(100%, 420px);
  padding: 2px 8px;
  border: none;
  outline: none;
  background: transparent;
  box-shadow: none;
  color: var(--text-primary, #2d3748);
  cursor: pointer;
  transition: color 0.2s ease, opacity 0.2s ease, transform 0.2s ease;
  -webkit-app-region: no-drag;
  pointer-events: auto;
}

.campus-entry:hover {
  color: color-mix(in srgb, var(--text-primary, #2d3748) 75%, #f9a214);
}

.campus-entry:active {
  transform: translateY(1px);
}

.campus-entry:focus-visible {
  border-radius: 999px;
  box-shadow: 0 0 0 2px color-mix(in srgb, #f9a214 45%, transparent);
}

.campus-entry-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  filter: drop-shadow(0 0 4px rgba(249, 162, 20, 0.55)) drop-shadow(0 0 10px rgba(254, 209, 108, 0.35));
}

.campus-entry:hover .campus-entry-icon {
  filter: drop-shadow(0 0 6px rgba(249, 162, 20, 0.7)) drop-shadow(0 0 14px rgba(254, 209, 108, 0.45));
}

.campus-entry-text {
  font-size: 12px;
  line-height: 1;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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

@media (max-width: 900px) {
  .campus-entry {
    max-width: 280px;
    padding-left: 10px;
    padding-right: 10px;
  }

  .campus-entry-text {
    font-size: 11px;
  }
}

/* Tutorial Stepper Styles */
.tutorial-stepper {
  /* --- Stepper CSS Variables (Restored original colors) --- */
  --stepper-text-primary: var(--text-primary);
  --stepper-text-secondary: var(--text-secondary);
  --stepper-border: transparent;
  --stepper-active-bg: transparent;
  --stepper-active-text: var(--color-primary, #667eea);
  --stepper-completed-bg: #48bb78;
  --stepper-tooltip-bg: rgba(255, 255, 255, 0.45);
  --stepper-tooltip-border: rgba(194, 194, 194, 0.6);
  --stepper-tooltip-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  --stepper-pulse-start: rgba(102, 126, 234, 0.5);
  --stepper-pulse-end: rgba(102, 126, 234, 0);
  --stepper-link-color: #ff9800;
  --stepper-link-hover: #e65100;
  --stepper-connector-bg: var(--border-color);

  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  pointer-events: auto;
  margin: 0 auto;
  padding: 2px 12px;
  border-radius: 16px;
}

[data-theme='dark'] .tutorial-stepper {
  /* --- Stepper CSS Variables (Restored original colors) --- */
  --stepper-text-primary: var(--text-primary);
  --stepper-text-secondary: var(--text-secondary);
  --stepper-border: transparent;
  --stepper-active-bg: transparent;
  --stepper-active-text: var(--color-primary, #667eea);
  --stepper-completed-bg: #48bb78;
  --stepper-tooltip-bg: rgba(30, 30, 30, 0.45);
  --stepper-tooltip-border: rgba(80, 80, 80, 0.6);
  --stepper-tooltip-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  --stepper-pulse-start: rgba(102, 126, 234, 0.5);
  --stepper-pulse-end: rgba(102, 126, 234, 0);
  --stepper-link-color: #ff9800;
  --stepper-link-hover: #e65100;
  --stepper-connector-bg: #656565;
}

.step {
  position: relative;
  display: flex;
  align-items: center;
  gap: 6px;
  color: var(--stepper-text-secondary);
  transition: all 0.3s ease;
  cursor: help;
}

.step:not(.active):not(.completed) .step-indicator,
.step:not(.active):not(.completed) .step-text {
  opacity: 0.5;
}

@keyframes pulse-ring {
  0% { box-shadow: 0 0 0 0 var(--stepper-pulse-start); }
  70% { box-shadow: 0 0 0 5px var(--stepper-pulse-end); }
  100% { box-shadow: 0 0 0 0 var(--stepper-pulse-end); }
}

.step.active {
  background: var(--stepper-active-bg);
  padding: 3px 8px;
  border-radius: 12px;
}

.step.completed {
  /* opacity: 0.8; */
}

.step-indicator {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--stepper-border);
  color: var(--stepper-text-secondary);
  font-size: 10px;
  font-weight: 600;
  transition: all 0.3s ease;
}

.step.active .step-indicator {
  background: var(--stepper-active-text);
  color: white;
  animation: pulse-ring 2s infinite;
}

.step.completed .step-indicator {
  background: var(--stepper-completed-bg);
  color: white;
}

.step-text {
  font-size: 12px;
  font-weight: 500;
  color: var(--stepper-text-primary);
  white-space: nowrap;
}

.step.active .step-text {
  color: var(--stepper-active-text);
}

.step-tooltip {
  position: absolute;
  top: 130%;
  left: 50%;
  transform: translateX(-50%) translateY(10px);
  background: var(--stepper-tooltip-bg);
  backdrop-filter: blur(20px) saturate(120%);
  -webkit-backdrop-filter: blur(20px) saturate(120%);
  border: 1px solid var(--stepper-tooltip-border);
  box-shadow: var(--stepper-tooltip-shadow);
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 12px;
  color: var(--stepper-text-primary);
  white-space: nowrap;
  opacity: 0;
  visibility: hidden;
  transition: all 0.2s ease;
  z-index: 100;
  line-height: 1.6;
  text-align: left;
}

.step-tooltip::before {
  content: '';
  position: absolute;
  top: -5px;
  left: 50%;
  transform: translateX(-50%) rotate(45deg);
  width: 8px;
  height: 8px;
  background: var(--stepper-tooltip-bg);
  backdrop-filter: blur(20px) saturate(120%);
  -webkit-backdrop-filter: blur(20px) saturate(120%);
  border-left: 1px solid var(--stepper-tooltip-border);
  border-top: 1px solid var(--stepper-tooltip-border);
}

.step-tooltip strong {
  font-size: 13px;
  color: var(--stepper-active-text);
}

.api-doc-link {
  color: var(--stepper-link-color);
  text-decoration: underline;
  margin-top: 4px;
  display: inline-block;
  font-weight: 500;
}

.api-doc-link:hover {
  color: var(--stepper-link-hover);
}

.step:hover .step-tooltip {
  opacity: 1;
  visibility: visible;
  transform: translateX(-50%) translateY(0);
}

.step-connector {
  width: 20px;
  height: 2px;
  background: var(--stepper-connector-bg);
  border-radius: 1px;
  transition: background 0.3s ease;
}

.step-connector.completed {
  background: var(--stepper-completed-bg);
}

@media (max-width: 768px) {
  .step-text {
    display: none;
  }
  .step-connector {
    width: 12px;
  }
}
</style>