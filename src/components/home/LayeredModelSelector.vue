<template>
  <div class="model-selector-container">
    <!-- 触发按钮 -->
    <button 
      class="model-selector-button"
      @click.stop="toggleSelector"
    >
      <span class="current-model-info">
        <span class="model-name">{{ currentModel?.name || '选择模型' }}</span>
        <span v-if="currentModel" class="platform-name">{{ currentModel.platform }}</span>
      </span>
      <svg class="dropdown-icon" :class="{ 'rotated': isOpen }" width="16" height="16" viewBox="0 0 16 16" fill="none">
        <path d="M4 6L8 10L12 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <!-- 选择器面板 -->
    <div v-if="isOpen" class="layered-model-selector" @click.stop>
      <!-- 关闭按钮 -->
      <button class="close-button" @click="closeSelector">
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M12 4L4 12M4 4L12 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
        </svg>
      </button>
      
      <!-- 第一层：平台列表 -->
      <div class="platform-layer">
        <div class="layer-header">
          <h4>选择平台</h4>
        </div>
        
        <div class="platform-list">
          <div 
            v-for="platform in enabledPlatforms" 
            :key="platform.id"
            class="platform-item"
            :class="{ 
              active: selectedPlatformId === platform.id,
              'has-models': platform.models.filter(m => m.enabled).length > 0
            }"
            @mouseenter="handlePlatformHover(platform)"
            @mouseleave="handlePlatformLeave"
            @click="selectPlatform(platform.id)"
          >
            <div class="platform-info">
              <div class="platform-name">{{ platform.displayName }}</div>
              <div class="platform-description">{{ platform.description }}</div>
              <div class="model-count">{{ platform.models.filter(m => m.enabled).length }} 个模型</div>
            </div>
            <div class="platform-arrow">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <polyline points="9,18 15,12 9,6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            </div>
          </div>
          
          <div v-if="enabledPlatforms.length === 0" class="no-platforms">
            <p>暂无可用平台</p>
            <p class="hint">请在设置页面配置AI平台</p>
          </div>
        </div>
      </div>

      <!-- 第二层：模型列表 -->
      <div 
        v-if="showModelLayer && hoveredPlatform" 
        class="model-layer"
        :class="{ 'position-left': shouldPositionLeft }"
        ref="modelLayerRef"
        @mouseenter="handleModelLayerEnter"
        @mouseleave="handleModelLayerLeave"
      >
        <div class="layer-header">
          <h4>{{ hoveredPlatform.displayName }} 的模型</h4>
        </div>
        
        <div class="model-list">
          <div 
            v-for="model in hoveredPlatform.models.filter(m => m.enabled)" 
            :key="model.id"
            class="model-item"
            :class="{ active: currentModel?.id === model.id }"
            @click="selectModel(model)"
          >
            <div class="model-info">
              <div class="model-name">{{ model.displayName }}</div>
              <div v-if="model.description" class="model-description">{{ model.description }}</div>
              <div class="model-specs">
                <span class="spec-item">Token: {{ model.maxTokens }}</span>
                <span class="spec-item">温度: {{ model.temperature }}</span>
              </div>
            </div>
            <div v-if="currentModel?.id === model.id" class="model-selected">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <polyline points="20,6 9,17 4,12" stroke="currentColor" stroke-width="2" fill="none"/>
              </svg>
            </div>
          </div>
          
          <div v-if="hoveredPlatform.models.filter(m => m.enabled).length === 0" class="no-models">
            <p>该平台暂无可用模型</p>
            <p class="hint">请在设置页面配置模型</p>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useModelConfig } from '../../services/modelConfig'
import type { AIPlatform, AIModel } from '../../services/modelConfig'

interface Props {
  currentModel?: AIModel | null
}

const props = defineProps<Props>()

const emit = defineEmits<{
  'model-selected': [model: AIModel]
}>()

// 获取模型配置
const { platforms } = useModelConfig()

// 状态管理
const isOpen = ref(false)
const hoveredPlatform = ref<AIPlatform | null>(null)
const showModelLayer = ref(false)
const selectedPlatformId = ref<string | null>(null)
const hoverTimeout = ref<number | null>(null)
const leaveTimeout = ref<number | null>(null)
const shouldPositionLeft = ref(false)

// 模板引用
const modelLayerRef = ref<HTMLElement | null>(null)

// 计算属性
const enabledPlatforms = computed(() => {
  return platforms.filter(platform => 
    // 平台必须启用，且有启用的模型才显示
    platform.enabled && 
    platform.models && 
    platform.models.some(model => model.enabled)
  )
})

// 方法
const toggleSelector = () => {
  isOpen.value = !isOpen.value
  if (!isOpen.value) {
    closeSelector()
  }
}

const closeSelector = () => {
  isOpen.value = false
  showModelLayer.value = false
  hoveredPlatform.value = null
  selectedPlatformId.value = null
  shouldPositionLeft.value = false // 重置位置状态
}

const selectPlatform = (platformId: string) => {
  selectedPlatformId.value = platformId
}

const selectModel = (model: AIModel) => {
  emit('model-selected', model)
  closeSelector()
}

const handlePlatformHover = (platform: AIPlatform) => {
  console.log('平台悬停事件触发:', platform.displayName)
  
  // 清除离开定时器
  if (leaveTimeout.value) {
    clearTimeout(leaveTimeout.value)
    leaveTimeout.value = null
  }

  // 设置悬停定时器
  if (hoverTimeout.value) {
    clearTimeout(hoverTimeout.value)
  }
  
  hoverTimeout.value = window.setTimeout(() => {
    console.log('显示模型层:', platform.displayName, '模型数量:', platform.models.filter(m => m.enabled).length)
    hoveredPlatform.value = platform
    showModelLayer.value = true
    
    // 在下一个tick检查位置
    nextTick(() => {
      checkModelLayerPosition()
    })
  }, 200) // 200ms 延迟显示
}

const handlePlatformLeave = () => {
  console.log('平台离开事件触发')
  
  // 清除悬停定时器
  if (hoverTimeout.value) {
    clearTimeout(hoverTimeout.value)
    hoverTimeout.value = null
  }

  // 设置离开定时器
  leaveTimeout.value = window.setTimeout(() => {
    console.log('隐藏模型层')
    showModelLayer.value = false
    hoveredPlatform.value = null
  }, 300) // 300ms 延迟隐藏
}

const handleModelLayerEnter = () => {
  // 鼠标进入模型层时，清除离开定时器
  if (leaveTimeout.value) {
    clearTimeout(leaveTimeout.value)
    leaveTimeout.value = null
  }
}

const handleModelLayerLeave = () => {
  // 鼠标离开模型层时，设置离开定时器
  leaveTimeout.value = window.setTimeout(() => {
    showModelLayer.value = false
    hoveredPlatform.value = null
  }, 300)
}

// 全局点击事件处理
const handleGlobalClick = (event: Event) => {
  const target = event.target as HTMLElement
  if (!target.closest('.model-selector-container')) {
    closeSelector()
  }
}

// 生命周期
// 检查模型层位置，避免超出屏幕
const checkModelLayerPosition = () => {
  if (!modelLayerRef.value) return
  
  const modelLayer = modelLayerRef.value
  const rect = modelLayer.getBoundingClientRect()
  const viewportWidth = window.innerWidth
  
  // 如果模型层右边缘超出视口，则显示在左侧
  if (rect.right > viewportWidth - 20) { // 留20px边距
    shouldPositionLeft.value = true
    console.log('模型层超出右边界，切换到左侧显示')
  } else {
    shouldPositionLeft.value = false
    console.log('模型层位置正常，显示在右侧')
  }
}

onMounted(() => {
  document.addEventListener('click', handleGlobalClick)
})

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick)
  if (hoverTimeout.value) {
    clearTimeout(hoverTimeout.value)
  }
  if (leaveTimeout.value) {
    clearTimeout(leaveTimeout.value)
  }
})
</script>

<style scoped>
.model-selector-container {
  position: relative;
  display: inline-block;
}

.model-selector-button {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  background: var(--bg-primary, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 6px;
  cursor: pointer;
  font-size: 14px;
  color: var(--text-primary, #2d3748);
  transition: all 0.2s ease;
  min-width: 200px;
}

.model-selector-button:hover {
  border-color: var(--primary-color, #3b82f6);
  box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.1);
}

.current-model-info {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  flex: 1;
}

.model-name {
  font-weight: 500;
  color: var(--text-primary, #2d3748);
}

.platform-name {
  font-size: 12px;
  color: var(--text-secondary, #718096);
  margin-top: 2px;
}

.dropdown-icon {
  margin-left: 8px;
  transition: transform 0.2s ease;
  color: var(--text-secondary, #718096);
}

.dropdown-icon.rotated {
  transform: rotate(180deg);
}

.layered-model-selector {
  position: absolute;
  top: 100%;
  left: 0;
  z-index: 1000;
  display: flex;
  font-size: 14px;
  margin-top: 4px;
}

.close-button {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 1001;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  color: var(--text-secondary, #718096);
  transition: all 0.2s ease;
}

.close-button:hover {
  background: var(--hover-bg, #e2e8f0);
  color: var(--text-primary, #2d3748);
}

.platform-layer,
.model-layer {
  background: var(--bg-primary, #ffffff);
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  min-width: 280px;
  max-height: 400px;
  overflow-y: auto;
}

.model-layer {
  position: absolute;
  top: 0;
  margin-left: 4px;
  min-width: 320px;
  /* 默认在右侧显示 */
  left: 100%;
}

/* 当空间不足时，在左侧显示 */
.model-layer.position-left {
  left: auto;
  right: 100%;
  margin-left: 0;
  margin-right: 4px;
}

.layer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e2e8f0);
  background: var(--bg-secondary, #f8fafc);
  border-radius: 8px 8px 0 0;
}

.layer-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
}

.platform-list,
.model-list {
  padding: 8px 0;
}

.platform-item,
.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  cursor: pointer;
  transition: all 0.2s ease;
  border-bottom: 1px solid var(--border-light, #f1f5f9);
  background-color: var(--model-item-bg);
  color: var(--model-item-text);
}

.platform-item:last-child,
.model-item:last-child {
  border-bottom: none;
}

.platform-item:hover,
.model-item:hover {
  background-color: var(--model-item-hover-bg);
  color: var(--model-item-hover-text);
}

.platform-item.active,
.model-item.active {
  background-color: var(--model-item-active-bg);
  border-color: var(--model-item-active-border);
  color: var(--model-item-active-text);
}

.platform-info,
.model-info {
  flex: 1;
}

.platform-name,
.model-name {
  font-weight: 500;
  color: var(--model-item-name-text);
  margin-bottom: 4px;
}

.platform-description,
.model-description {
  font-size: 12px;
  color: var(--model-item-description-text);
  margin-bottom: 4px;
}

.model-count {
  font-size: 11px;
  color: var(--text-tertiary, #a0aec0);
}

.model-specs {
  display: flex;
  gap: 12px;
  margin-top: 4px;
}

.spec-item {
  font-size: 11px;
  color: var(--model-item-specs-text);
}

.platform-arrow,
.model-selected {
  color: var(--model-item-selected-icon);
  margin-left: 8px;
}

.platform-item.active .platform-arrow,
.model-item.active .model-selected {
  color: var(--model-item-selected-icon);
}

.no-platforms,
.no-models {
  padding: 24px 16px;
  text-align: center;
  color: var(--text-secondary, #718096);
}

.no-platforms p,
.no-models p {
  margin: 0 0 8px 0;
}

.hint {
  font-size: 12px;
  color: var(--text-tertiary, #a0aec0);
}
</style>