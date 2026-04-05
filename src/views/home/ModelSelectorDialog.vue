<template>
  <div v-if="show" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-panel model-selector-panel" @click.stop>
      <div class="dialog-header">
        <button class="btn-back" @click="emit('close')" title="关闭">
          <svg viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
            <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
          </svg>
        </button>
        <div class="dialog-title-placeholder"></div>
        <ModelCategorySwitch v-model="selectedCategory" />
      </div>

      <div class="dialog-body">
        <div class="search-wrap">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35" stroke-linecap="round"/>
          </svg>
          <input
            type="text"
            class="search-input"
            placeholder="搜索模型..."
            v-model="searchQuery"
          />
        </div>

        <div class="platform-groups">
          <div v-for="platform in platformsWithModels" :key="platform.id" class="platform-group">
            <div class="platform-header">
              <span class="platform-title">{{ platform.displayName }}</span>
              <span class="model-count">{{ platform.models.length }} 个模型</span>
            </div>
            <div class="model-list">
              <div
                v-for="model in platform.models"
                :key="model.id"
                class="model-item"
                :class="{ active: isModelSelected(model) }"
                @click="selectModel(model)"
              >
                <span class="model-name">{{ model.displayName }}</span>
                <div v-if="isModelSelected(model)" class="model-selected">
                  <span class="model-dot"></span>
                </div>
              </div>
            </div>
          </div>
          <div v-if="platformsWithModels.length === 0" class="empty-tip">暂无匹配模型</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AIModel, AIPlatform } from '../../services/modelConfig'
import ModelCategorySwitch from '../settings/ModelSettings/ModelCategorySwitch.vue'

interface Props {
  show: boolean
  selectedTextModelIds: string[]
  selectedVisionModelId: string | null
  selectedSummaryModelIds: string[]
  availableModels: AIModel[]
  platforms: AIPlatform[]
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
  modelSelected: [model: AIModel]
}>()

const searchQuery = ref('')
const selectedCategory = ref<'text' | 'vision' | 'summary'>('text')

const isModelSelected = (model: AIModel) => {
  if (selectedCategory.value === 'text') return props.selectedTextModelIds.includes(model.id)
  if (selectedCategory.value === 'vision') return props.selectedVisionModelId === model.id
  if (selectedCategory.value === 'summary') return props.selectedSummaryModelIds.includes(model.id)
  return false
}

const filteredModels = computed(() => {
  const targetCategory = selectedCategory.value === 'summary' ? 'text' : selectedCategory.value
  let models = props.availableModels.filter(m => m.category === targetCategory)
  if (searchQuery.value.trim()) {
    const q = searchQuery.value.toLowerCase()
    models = models.filter(m => m.displayName.toLowerCase().includes(q) || m.id.toLowerCase().includes(q))
  }
  return models
})

const platformsWithModels = computed(() => {
  const map = new Map<string, AIPlatform & { models: AIModel[] }>()
  props.platforms.forEach(p => map.set(p.id, { ...p, models: [] }))
  filteredModels.value.forEach(m => map.get(m.platformId)?.models.push(m))
  return Array.from(map.values()).filter(p => p.models.length > 0)
})

const handleOverlayClick = (e: MouseEvent) => {
  const target = e.target as HTMLElement
  if (target.closest('input')) return
  setTimeout(() => {
    if (window.getSelection()?.toString()) return
    emit('close')
  }, 0)
}

const selectModel = (model: AIModel) => {
  emit('modelSelected', { ...model, category: selectedCategory.value })
}

watch(() => props.show, (v) => { if (v) searchQuery.value = '' })
</script>

<style>
@import '../../styles/dialog.css';
</style>

<style scoped>
.model-selector-panel {
  max-width: 520px;
  display: flex;
  flex-direction: column;
}

.search-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--form-input-bg, #F7F7F7);
  border-radius: 8px;
  margin-bottom: 16px;
  color: var(--text-secondary);
}

.search-input {
  flex: 1;
  border: none;
  background: transparent;
  outline: none;
  font-size: 14px;
  color: var(--text-primary);
}

.platform-group {
  margin-bottom: 16px;
}

.platform-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 6px;
}

.platform-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
}

.model-count {
  font-size: 11px;
  color: var(--text-secondary);
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border: 1px solid var(--model-item-border);
  border-radius: 16px;
  cursor: pointer;
  background: var(--model-item-bg);
  color: var(--model-item-text);
  transition: all 0.2s ease;
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
  box-shadow: var(--model-item-active-shadow);
}

.model-name {
  font-size: 14px;
  font-weight: 500;
  color: inherit;
}

.dialog-title-placeholder {
  flex: 1;
}

.model-selected {
  display: flex;
  align-items: center;
  justify-content: center;
}

.model-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f8bd40;
  display: block;
  animation: dot-pop 0.2s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}

@keyframes dot-pop {
  from { transform: scale(0); opacity: 0; }
  to { transform: scale(1); opacity: 1; }
}

.empty-tip {
  text-align: center;
  color: var(--text-secondary);
  font-size: 13px;
  padding: 24px 0;
}
</style>
