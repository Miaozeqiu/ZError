<template>
  <div v-if="show" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-content" @click.stop>
      <div class="dialog-header">
        <div class="search-container">
          <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <circle cx="11" cy="11" r="8" stroke="currentColor" stroke-width="2"/>
            <path d="m21 21-4.35-4.35" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
          <input 
            type="text" 
            class="search-input" 
            placeholder="搜索模型..." 
            v-model="searchQuery"
            @input="handleSearch"
          />
        </div>
        
        <!-- 模型分类筛选 -->
        <div class="category-filter">
          <ModelCategorySwitch v-model="selectedCategory" />
        </div>
      </div>

      <div class="dialog-body">
        <div class="platform-groups">
          <div 
            v-for="platform in platformsWithModels" 
            :key="platform.id"
            class="platform-group"
          >
            <div class="platform-header">
              <div class="platform-title">{{ platform.displayName }}</div>
              <span class="model-count">{{ platform.models.length }} 个模型</span>
            </div>
            <div class="model-list">
              <div 
                v-for="model in platform.models" 
                :key="model.id"
                class="model-item"
                :class="{ 
                  'active-text': model.category === 'text' && props.currentTextModel?.id === model.id,
                  'active-vision': model.category === 'vision' && props.currentVisionModel?.id === model.id
                }"
                @click="selectModel(model)"
              >
                <div class="model-info">
                  <div class="model-name">{{ model.displayName }}</div>
                </div>
                <div v-if="(model.category === 'text' && props.currentTextModel?.id === model.id) || 
                           (model.category === 'vision' && props.currentVisionModel?.id === model.id)" 
                     class="model-selected">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { defineProps, defineEmits, computed, ref, watch } from 'vue'
import type { AIModel, AIPlatform } from '../../services/modelConfig'
import ModelCategorySwitch from '../ModelCategorySwitch.vue'

interface Props {
  show: boolean
  currentTextModel?: AIModel | null
  currentVisionModel?: AIModel | null
  availableModels: AIModel[]
  platforms: AIPlatform[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
  modelSelected: [model: AIModel]
}>()

// 搜索相关的响应式数据
const searchQuery = ref('')

// 分类筛选相关的响应式数据
const selectedCategory = ref<'text' | 'vision'>('text')

// 计算属性：过滤后的模型
const filteredModels = computed(() => {
  let models = props.availableModels
  
  // 按分类筛选 - 移除'全部'选项，只按选中的分类筛选
  models = models.filter(model => model.category === selectedCategory.value)
  
  // 按搜索关键词筛选
  if (searchQuery.value.trim()) {
    const query = searchQuery.value.toLowerCase().trim()
    models = models.filter(model => 
      model.displayName.toLowerCase().includes(query) ||
      model.id.toLowerCase().includes(query)
    )
  }
  
  return models
})

// 计算属性：按平台分组的模型
const platformsWithModels = computed(() => {
  const platformMap = new Map<string, AIPlatform & { models: AIModel[] }>()
  
  // 初始化平台映射
  props.platforms.forEach(platform => {
    platformMap.set(platform.id, {
      ...platform,
      models: []
    })
  })
  
  // 将过滤后的模型分配到对应平台
  filteredModels.value.forEach(model => {
    const platform = platformMap.get(model.platformId)
    if (platform) {
      platform.models.push(model)
    }
  })
  
  // 只返回有模型的平台
  return Array.from(platformMap.values()).filter(platform => platform.models.length > 0)
})

const handleOverlayClick = (event: MouseEvent) => {
  // 检查点击是否来自输入框或其相关操作
  const target = event.target as HTMLElement
  if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || 
      target.closest('input') || target.closest('textarea') || target.closest('select')) {
    return
  }
  
  // 使用 setTimeout 延迟检查文本选择状态，避免时序问题
  setTimeout(() => {
    const selection = window.getSelection()
    if (selection && selection.toString().length > 0) {
      return
    }
    
    // 检查是否有任何输入框处于焦点状态
    const activeElement = document.activeElement
    if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA' || activeElement.tagName === 'SELECT')) {
      return
    }
    
    emit('close')
  }, 0)
}

const selectModel = (model: AIModel) => {
  console.log('🔍 [DEBUG] ModelSelectorDialog - selectModel called with:', model.displayName, 'category:', model.category)
  emit('modelSelected', model)
  // 不关闭对话框，允许用户继续选择其他类别的模型
  // emit('close')
}

// 监听对话框显示状态，每次打开时重置搜索
watch(() => props.show, (newShow) => {
  if (newShow) {
    // 对话框打开时重置搜索查询
    searchQuery.value = ''
    console.log('对话框已打开，当前文本模型:', props.currentTextModel?.displayName || '无')
    console.log('对话框已打开，当前视觉模型:', props.currentVisionModel?.displayName || '无')
    
    // 添加更详细的调试信息
    console.log('ModelSelectorDialog - 接收到的props:')
    console.log('  - availableModels数量:', props.availableModels.length)
    console.log('  - platforms数量:', props.platforms.length)
    console.log('  - availableModels详情:', props.availableModels.map(m => ({
      id: m.id,
      name: m.displayName,
      platformId: m.platformId,
      enabled: m.enabled,
      category: m.category
    })))
    console.log('  - platforms详情:', props.platforms.map(p => ({
      id: p.id,
      name: p.displayName,
      enabled: p.enabled,
      modelCount: p.models?.length || 0
    })))
    console.log('  - platformsWithModels计算结果:', platformsWithModels.value.map(p => ({
      id: p.id,
      name: p.displayName,
      modelCount: p.models.length
    })))
  }
})

const handleSearch = () => {
  // 搜索逻辑已在计算属性中处理，这里可以添加额外的搜索处理逻辑
}

const getPlatformName = (platformId: string): string => {
  const platform = props.platforms.find(p => p.id === platformId)
  return platform?.name || '未知平台'
}
</script>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.dialog-content {
  background: var(--bg-secondary, #ffffff);
  border: 1px solid var(--border-primary, #e2e8f0);
  border-radius: 8px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
  width: 90%;
  max-width: 600px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px;
  border-bottom: 1px solid var(--border-primary, #e2e8f0);
  background: var(--bg-secondary, #ffffff);
  border-top-left-radius: 8px;
  border-top-right-radius: 8px;
}

.search-container {
  display: flex;
  align-items: center;
  flex: 1;
  gap: 12px;
}

.search-icon {
  color: var(--text-tertiary, #718096);
  flex-shrink: 0;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 50%;
  padding: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
}

.search-input {
  width: 100%;
  padding: 10px 12px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  color: var(--text-primary, #2d3748);
  background: transparent;
  outline: none;
  transition: background-color 0.2s ease;
}

.search-input:focus {
  background: transparent;
}

.search-input::placeholder {
  color: var(--text-tertiary, #718096);
}

/* 分类筛选样式 */
.category-filter {
  display: flex;
  gap: 8px;
  margin-top: 16px;
  justify-content: center;
}

.dialog-body {
  padding: 20px;
  max-height: 60vh;
  overflow-y: auto;
  background: var(--bg-secondary, #ffffff);
  border-bottom-left-radius: 8px;
  border-bottom-right-radius: 8px;
  flex: 1;
}

.platform-groups {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.platform-group {
  overflow: hidden;
  background: var(--bg-secondary, #ffffff);
}

.platform-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
}

.platform-title {
  margin: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-tertiary, #718096);
}

.model-count {
  font-size: 11px;
  color: var(--text-secondary, #4a5568);
  background: var(--bg-secondary, #ffffff);
  padding: 2px 6px;
  border-radius: 10px;
  border: 1px solid var(--border-primary, #e2e8f0);
}

.model-list {
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary, #ffffff);
}

.model-item {
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  margin: 3px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--model-item-bg);
  border: 1px solid var(--model-item-border);
  color: var(--model-item-text);
  position: relative;
}


.model-item:hover {
  background: var(--model-item-hover-bg);
  border-color: var(--model-item-hover-border);
  color: var(--model-item-hover-text);
}

.model-item.active {
  background: var(--model-item-active-bg);
  border-color: var(--model-item-active-border);
  color: var(--model-item-active-text);
}

.model-item.active-text {
  background: var(--model-item-active-bg);
  border-color: var(--primary-color, #3b82f6);
  color: var(--model-item-active-text);
}

.model-item.active-vision {
  background: var(--model-item-active-bg);
  border-color: var(--success-color, #3b82f6);
  color: var(--model-item-active-text);
}


.model-info {
  display: flex;
  flex-direction: column;
  flex: 1;
}

.model-name {
  font-weight: 500;
  color: var(--model-item-name-text);
  font-size: 14px;
  margin: 0;
}

.model-selected {
  color: var(--model-item-selected-icon);
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: 8px;
  flex-shrink: 0;
}



</style>