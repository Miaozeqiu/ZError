<template>
  <div v-if="props.activeTab !== 'questions' && props.activeTab !== 'import-tasks' && props.activeTab !== 'agent' && props.activeTab !== 'study' && props.activeTab !== 'campus' && props.activeTab !== 'browser'" class="tutorial-stepper">
    <div class="step" :class="{ completed: isStep1Completed, active: !isStep1Completed }" @click="emit('guide-to', 'model-settings')">
      <div class="step-indicator">
        <svg v-if="isStep1Completed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <span v-else>1</span>
      </div>
      <span class="step-text">配置 AI 模型</span>
      <div class="step-tooltip">
        <strong>步骤 1：配置 AI 模型</strong><br>
        前往"设置 &gt; 模型设置"，选择一个 AI 平台并填写您的 API Key。<br>
        <a data-v-f7451f5a="" href="https://docs.zerror.cc/get-apiKey" target="_blank" rel="noopener noreferrer" class="api-doc-link">如何获取Api Key?</a><br><br>
        <strong>必须完成：</strong><br>
        • 在填写 API Key 的平台下，至少选择<strong>一个文本模型</strong>。<br>
        • （可选）还可以选择一个视觉和总结模型。
      </div>
    </div>
    <div class="step-connector" :class="{ completed: isStep1Completed }"></div>
    <div class="step" :class="{ completed: isStep1Completed && isStep2Completed, active: isStep1Completed && !isStep2Completed }" @click="emit('guide-to', 'home')">
      <div class="step-indicator">
        <svg v-if="isStep1Completed && isStep2Completed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><polyline points="20 6 9 17 4 12"></polyline></svg>
        <span v-else>2</span>
      </div>
      <span class="step-text">启动服务</span>
      <div class="step-tooltip">
        <strong>步骤 2：启动服务</strong><br>
        在"首页"<br>启动本地服务器。
      </div>
    </div>
    <div class="step-connector" :class="{ completed: isStep1Completed && isStep2Completed }"></div>
    <div class="step" :class="{ completed: isStep1Completed && isStep2Completed && isStep3Completed, active: isStep1Completed && isStep2Completed && !isStep3Completed }" @click="emit('guide-to', 'ocs-config')">
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
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { listen, UnlistenFn } from '@tauri-apps/api/event'
import { useModelConfig } from '../../services/model/config'
import { serverRunning } from '../../services/app/serverState'

const props = defineProps<{
  activeTab?: string
}>()

const emit = defineEmits<{
  'guide-to': [target: 'model-settings' | 'home' | 'ocs-config']
}>()

const { platforms: computedPlatforms, selectedTextModels, selectedTextModel } = useModelConfig()

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
      const isSelected = selectedTextModelIds.has(model.id);
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
</script>

<style scoped>
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
