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
        <ModelCategorySwitch v-if="!forceCategory" v-model="selectedCategory" />
        <div v-else class="dialog-title-center">{{ forceCategoryTitle }}</div>
      </div>

      <div class="dialog-body">
        <div class="search-wrap">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
                :class="{
                  active: isModelSelected(model),
                  'model-item--no-vision': isVisionUnavailable(model)
                }"
                @click="selectModel(model)"
              >
                <div class="model-icon-wrap">
                  <img v-if="getModelIcon(model)" :src="getModelIcon(model)" :alt="model.displayName" class="model-icon-img" />
                  <div v-else class="model-icon-fallback">{{ (model.displayName || model.id).charAt(0).toUpperCase() }}</div>
                </div>
                <div class="model-main">
                  <span class="model-name">{{ model.displayName }}</span>
                  <span v-if="modelHasVision(model)" class="model-kind-tag">视觉</span>
                </div>
                <div class="model-selected">
                  <span v-if="isModelSelected(model)" class="model-dot"></span>
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
import type { AIModel, AIPlatform, RemoteModelIconMapping } from '../../services/model/config'
import { fetchRemoteModelsCatalog, modelHasVision } from '../../services/model/config'
import ModelCategorySwitch from '../settings/ModelSettings/ModelCategorySwitch.vue'

interface Props {
  show: boolean
  selectedTextModelIds: string[]
  selectedVisionModelId: string | null
  selectedSummaryModelIds: string[]
  selectedAgentModelId?: string | null
  availableModels: AIModel[]
  platforms: AIPlatform[]
  forceCategory?: 'text' | 'vision' | 'summary' | 'agent'
}

const props = defineProps<Props>()
const emit = defineEmits<{
  close: []
  modelSelected: [model: AIModel]
}>()

const ICON_BASE_URL = 'https://webapi.zaizhexue.top/models/'
const remoteModelIconMappings = ref<RemoteModelIconMapping[]>([])

const resolveModelIconUrl = (icon?: string): string => {
  if (!icon) return ''
  if (/^data:/i.test(icon) || /^https?:\/\//i.test(icon)) return icon
  const normalizedIcon = icon
    .trim()
    .replace(/^\/+/, '')
    .replace(/^assets\/images\/models\//i, '')
    .replace(/^models\//i, '')
  if (!normalizedIcon) return ''
  return new URL(normalizedIcon, ICON_BASE_URL).toString()
}

const getModelIcon = (model: AIModel): string => {
  if (model.icon) return resolveModelIconUrl(model.icon)
  const searchStr = `${model.displayName || ''} ${model.id || ''}`.toLowerCase()
  const matchedMapping = remoteModelIconMappings.value.find((mapping) =>
    mapping.models.some((keyword) => searchStr.includes(keyword.toLowerCase()))
  )
  return resolveModelIconUrl(matchedMapping?.icon)
}

const searchQuery = ref('')
const selectedCategory = ref<'text' | 'vision' | 'summary' | 'agent'>(props.forceCategory || 'text')

const forceCategoryTitle = computed(() => {
  if (props.forceCategory === 'vision') return '选择视觉模型'
  if (props.forceCategory === 'summary') return '选择总结模型'
  if (props.forceCategory === 'agent') return '选择 agent 模型'
  return '选择文本模型'
})

watch(() => props.forceCategory, (newVal) => {
  if (newVal) {
    selectedCategory.value = newVal
  }
})

const isModelSelected = (model: AIModel) => {
  if (selectedCategory.value === 'text') return props.selectedTextModelIds.includes(model.id)
  if (selectedCategory.value === 'vision') return props.selectedVisionModelId === model.id
  if (selectedCategory.value === 'summary') return props.selectedSummaryModelIds.includes(model.id)
  if (selectedCategory.value === 'agent') return props.selectedAgentModelId === model.id
  return false
}

const isVisionUnavailable = (model: AIModel) =>
  selectedCategory.value === 'vision' && !modelHasVision(model)

const filteredModels = computed(() => {
  let models = props.availableModels
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
  if (isVisionUnavailable(model)) return
  emit('modelSelected', {
    ...model,
    category: selectedCategory.value === 'agent' ? model.category : selectedCategory.value,
  })
}

watch(() => props.show, async (v) => {
  if (!v) return
  searchQuery.value = ''
  if (remoteModelIconMappings.value.length) return
  try {
    const catalog = await fetchRemoteModelsCatalog()
    remoteModelIconMappings.value = catalog.modelIconMappings || []
  } catch {
    remoteModelIconMappings.value = []
  }
})
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
  gap: 6px;
  height: 32px;
  padding: 0 8px;
  background: var(--form-input-bg, #F7F7F7);
  border-radius: 6px;
  margin-bottom: 10px;
  color: var(--text-secondary);
}

.search-input {
  flex: 1;
  min-width: 0;
  height: 100%;
  border: none;
  background: transparent;
  outline: none;
  font-size: 13px;
  line-height: 1;
  color: var(--text-primary);
}

.search-input::placeholder {
  text-indent: 6px;
}

.platform-group {
  margin-bottom: 12px;
}

.platform-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 4px;
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
  gap: 8px;
  padding: 7px 10px;
  border: 1px solid var(--model-item-border);
  border-radius: 10px;
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

.model-item--no-vision {
  cursor: not-allowed;
  opacity: 0.34;
  filter: grayscale(1);
}

.model-item--no-vision:hover {
  background: var(--model-item-bg);
  border-color: var(--model-item-border);
  color: var(--model-item-text);
}

.model-item--no-vision .model-name {
  color: var(--text-secondary, #9aa3af);
}

.model-icon-wrap {
  flex-shrink: 0;
  width: 22px;
  height: 22px;
  border-radius: 5px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
}

.model-icon-img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  border-radius: 5px;
}

.model-icon-fallback {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-accent-light, rgba(49, 130, 206, 0.1));
  color: var(--btn-primary, #3182ce);
  font-size: 11px;
  font-weight: 700;
  border-radius: 5px;
}

.model-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}

.model-name {
  font-size: 14px;
  font-weight: 500;
  color: inherit;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.model-kind-tag {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  padding: 2px 6px;
  border-radius: 4px;
  color: #c47b12;
  background: color-mix(in srgb, #f8bd40 28%, transparent);
}

.dialog-title-placeholder {
  flex: 1;
}

.dialog-title-center {
  flex: 1;
  text-align: center;
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-right: 32px; /* 抵消左侧按钮的宽度以保持居中 */
}

.model-selector-panel {
  max-width: 520px;
  display: flex;
  flex-direction: column;
}

.model-selected {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 8px;
  height: 8px;
  flex-shrink: 0;
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
