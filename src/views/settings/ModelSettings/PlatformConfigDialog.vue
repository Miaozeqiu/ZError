﻿<template>
  <div v-if="show" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-content" @click.stop>
      <div class="dialog-header">
        <button class="btn-back" @click="$emit('close')" title="返回">
          <svg t="1774357412434" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg" width="18" height="18">
            <path d="M768 96c19.2-19.2 19.2-51.2 0-70.4-19.2-19.2-51.2-19.2-70.4 0l-448 448c-19.2 19.2-19.2 51.2 0 70.4l448 448c19.2 19.2 51.2 19.2 70.4 0 19.2-19.2 19.2-51.2 0-70.4L358.4 512l409.6-416z" fill="currentColor"/>
          </svg>
        </button>
        <h3 class="dialog-title">{{ isEditing ? '编辑平台' : '添加平台' }}</h3>
        <button class="btn-confirm" @click="handleSubmit">完成</button>
      </div>

      <div class="dialog-body">
        <!-- 平台图标显示区域 - 顶部居中 -->
        <div class="icon-display-section">
          <div class="icon-preview-large" ref="iconPreviewRef" @click="toggleIconPicker">
            <img 
              v-if="formData.icon && !iconLoadError && isImageIcon(formData.icon)"
              :src="getIconUrl(formData.icon)"
              :alt="formData.name"
              @error="handleIconLoadError"
              class="icon-image-large"
            />
            <div 
              v-else-if="formData.icon && !isImageIcon(formData.icon)"
              class="icon-emoji-large"
            >
              {{ formData.icon }}
            </div>
            <div 
              v-else
              class="icon-fallback-large"
            >
              {{ getInitials(formData.name) }}
            </div>
            <!-- 右下角展开箭头 -->
            <div class="icon-expand-badge">
              <svg
                class="toggle-arrow"
                :class="{ 'rotated': showIconPicker }"
                width="10"
                height="10"
                viewBox="0 0 1024 1024"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M512 714.666667c-8.533333 0-17.066667-2.133333-23.466667-8.533334L146.133333 362.666667c-12.8-12.8-12.8-32 0-44.8s32-12.8 44.8 0L512 640l321.066667-322.133333c12.8-12.8 32-12.8 44.8 0s12.8 32 0 44.8L535.466667 706.133333c-6.4 6.4-14.933333 8.533333-23.466667 8.533334z" fill="currentColor"/>
              </svg>
            </div>
          </div>
          
  
          
          <!-- 图标选择器内容 -->
          <Teleport to="body">
            <div v-if="showIconPicker" ref="iconPickerRef" class="icon-picker-content" :style="pickerStyle">
              <div v-if="iconError" class="icon-error">
                {{ iconError }}
              </div>
              <div class="icon-picker">
                <div class="icon-category">
                  <h5>预设图标</h5>
                  <div class="icon-grid">
                    <div 
                      v-for="icon in availableIcons" 
                      :key="icon"
                      class="icon-option"
                      :class="{ active: formData.icon === icon }"
                      @click="selectIcon(icon)"
                    >
                      <img 
                        :src="iconUrls[icon] || getIconUrl(icon)"
                        :alt="icon"
                        @error="handleIconError(icon)"
                        class="icon-option-image"
                      />
                    </div>
                  </div>
                </div>
                <div class="icon-category">
                  <h5>Emoji图标</h5>
                  <div class="icon-grid">
                    <div 
                      v-for="emoji in emojiOptions" 
                      :key="emoji"
                      class="icon-option emoji-option"
                      :class="{ active: formData.icon === emoji }"
                      @click="selectIcon(emoji)"
                    >
                      {{ emoji }}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </Teleport>
        </div>

        <form @submit.prevent="handleSubmit">
          <div class="form-group">
            <label class="form-label">平台名称</label>
            <input 
              v-model="formData.name" 
              type="text" 
              class="form-input" 
              placeholder="例如：自定义平台"
              required
            >
          </div>

          <div class="form-group">
            <label class="form-label">API 基础URL</label>
            <div class="base-url-row">
              <input
                v-model="formData.baseUrl"
                type="url"
                class="form-input"
                placeholder="例如：https://api.openai.com/v1"
                required
              >
              <div class="protocol-select-wrap">
                <button
                  ref="protocolTriggerRef"
                  type="button"
                  class="protocol-select-trigger"
                  :class="{ open: showProtocolDropdown }"
                  aria-haspopup="listbox"
                  :aria-expanded="showProtocolDropdown"
                  @click="toggleProtocolDropdown"
                >
                  <span class="protocol-select-path">{{ currentProtocolPath }}</span>
                  <svg class="protocol-select-arrow" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
                    <path d="M4.2 6.2a.75.75 0 0 1 1.06 0L8 8.94l2.74-2.74a.75.75 0 1 1 1.06 1.06l-3.27 3.27a.75.75 0 0 1-1.06 0L4.2 7.26a.75.75 0 0 1 0-1.06z" fill="currentColor"/>
                  </svg>
                </button>
                <Teleport to="body">
                  <Transition name="dropdown-pop">
                    <div
                      v-if="showProtocolDropdown"
                      ref="protocolDropdownRef"
                      class="protocol-dropdown"
                      :style="protocolDropdownStyle"
                      role="listbox"
                      aria-label="API 协议"
                    >
                      <button
                        v-for="opt in protocolOptions"
                        :key="opt.value"
                        type="button"
                        class="protocol-dropdown-item"
                        :class="{ active: formData.apiProtocol === opt.value }"
                        role="option"
                        :aria-selected="formData.apiProtocol === opt.value"
                        @click="selectProtocol(opt.value)"
                      >
                        <span class="protocol-dropdown-path">{{ opt.endpoint }}</span>
                        <span class="protocol-dropdown-meta">{{ opt.label }}</span>
                      </button>
                    </div>
                  </Transition>
                </Teleport>
              </div>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">API Key</label>
            <input
              v-model="formData.apiKey"
              type="password"
              class="form-input"
              placeholder="输入您的API密钥"
            >
          </div>

        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, nextTick, onMounted, onUnmounted } from 'vue'
import { fetchRemoteModelsCatalog, type AIPlatform, type ApiProtocol } from '../../../services/model/config'
import { getPlatformIconDisplayUrl, isImageIconValue, resolvePlatformIconUrl } from '../../../services/app/iconCache'
import { useExclusiveMenu } from '../../../composables/useExclusiveMenu'

interface Props {
  show: boolean
  platform?: AIPlatform | null
}

interface Emits {
  (e: 'close'): void
  (e: 'save', platform: Omit<AIPlatform, 'id' | 'isBuiltIn'>): void
}

const props = defineProps<Props>()
const emit = defineEmits<Emits>()

const isEditing = computed(() => !!props.platform)

const protocolOptions: { value: ApiProtocol; label: string; endpoint: string }[] = [
  { value: 'openai-chat', label: 'Chat', endpoint: '/chat/completions' },
  { value: 'openai-response', label: 'Responses', endpoint: '/responses' },
  { value: 'anthropic', label: 'Messages', endpoint: '/v1/messages' },
  { value: 'custom', label: '自定义', endpoint: '自定义' },
]

const currentProtocolPath = computed(() => {
  return protocolOptions.find((opt) => opt.value === formData.value.apiProtocol)?.endpoint || '/chat/completions'
})

const showProtocolDropdown = ref(false)
const protocolTriggerRef = ref<HTMLElement | null>(null)
const protocolDropdownRef = ref<HTMLElement | null>(null)
const protocolDropdownStyle = ref<Record<string, string>>({})
useExclusiveMenu('platform-config-protocol', showProtocolDropdown)

const updateProtocolDropdownPosition = () => {
  if (!protocolTriggerRef.value) return
  const triggerRect = protocolTriggerRef.value.getBoundingClientRect()
  const dropdownWidth = Math.max(triggerRect.width, 220)
  const estimatedHeight = protocolDropdownRef.value?.getBoundingClientRect().height || 200
  const spaceBelow = window.innerHeight - triggerRect.bottom
  const showAbove = spaceBelow < estimatedHeight + 12 && triggerRect.top > estimatedHeight + 12

  protocolDropdownStyle.value = {
    position: 'fixed',
    left: `${Math.max(8, Math.min(triggerRect.right - dropdownWidth, window.innerWidth - dropdownWidth - 8))}px`,
    top: showAbove ? `${Math.max(8, triggerRect.top - estimatedHeight - 6)}px` : `${triggerRect.bottom + 6}px`,
    width: `${dropdownWidth}px`,
    zIndex: '2400',
  }
}

const closeProtocolDropdown = () => {
  showProtocolDropdown.value = false
}

const toggleProtocolDropdown = async () => {
  showProtocolDropdown.value = !showProtocolDropdown.value
  if (showProtocolDropdown.value) {
    await nextTick()
    updateProtocolDropdownPosition()
  }
}

const selectProtocol = (protocol: ApiProtocol) => {
  formData.value.apiProtocol = protocol
  closeProtocolDropdown()
}

const handleProtocolOutsideClick = (event: Event) => {
  if (!showProtocolDropdown.value) return
  const target = event.target as Node | null
  if (
    target &&
    (
      protocolTriggerRef.value?.contains(target) ||
      protocolDropdownRef.value?.contains(target)
    )
  ) {
    return
  }
  closeProtocolDropdown()
}

const formData = ref({
  name: '',
  baseUrl: '',
  apiKey: '',
  icon: '',
  apiProtocol: 'openai-chat' as ApiProtocol,
})

// 图标相关状态
const iconLoadError = ref(false)
const iconError = ref('')
const showIconPicker = ref(false)
const iconPreviewRef = ref<HTMLElement | null>(null)
const iconPickerRef = ref<HTMLElement | null>(null)

const pickerStyle = ref<Record<string, string>>({})

const updatePickerPosition = () => {
  if (!iconPreviewRef.value) return
  const previewRect = iconPreviewRef.value.getBoundingClientRect()
  // 用实际渲染宽度，fallback 到 CSS 计算值
  const pickerWidth = iconPickerRef.value
    ? iconPickerRef.value.getBoundingClientRect().width
    : Math.min(520, window.innerWidth * 0.8)
  const centerX = previewRect.left + previewRect.width / 2
  let left = centerX - pickerWidth / 2
  if (left + pickerWidth > window.innerWidth - 8) left = window.innerWidth - pickerWidth - 8
  if (left < 8) left = 8
  console.log('[picker] previewRect:', previewRect, 'centerX:', centerX, 'pickerWidth:', pickerWidth, 'left:', left)
  pickerStyle.value = {
    top: `${previewRect.bottom + 8}px`,
    left: `${left}px`,
  }
}

const toggleIconPicker = async () => {
  showIconPicker.value = !showIconPicker.value
  if (showIconPicker.value) {
    await nextTick()
    await nextTick() // 第二次确保 picker DOM 完全渲染
    updatePickerPosition()
  }
}

// 可用图标列表
const availableIcons = ref<string[]>([])
const iconUrls = ref<Record<string, string>>({})
const resolvedIconUrls = ref<Record<string, string>>({})
const emojiOptions = ['🤖', '🧠', '🔍', '⚡', '🚀', '💡', '🎯', '🔥', '⭐', '💎', '🌟', '🎨']

const primeIconUrlCache = async (icon?: string) => {
  if (!icon || !isImageIconValue(icon)) return

  resolvedIconUrls.value[icon] = getPlatformIconDisplayUrl(icon)

  try {
    resolvedIconUrls.value[icon] = await resolvePlatformIconUrl(icon)
    if (formData.value.icon === icon) {
      iconLoadError.value = false
    }
  } catch (error) {
    console.warn('缓存平台图标失败，回退到原始地址:', icon, error)
  }
}

// 获取可用图标列表
const loadAvailableIcons = async () => {
  iconError.value = ''

  try {
    const catalog = await fetchRemoteModelsCatalog()
    availableIcons.value = catalog.providersList
  } catch (error: any) {
    console.warn('加载 providers_list 失败:', error)
    availableIcons.value = []
    iconError.value = error?.message || '图标列表加载失败'
  }

  for (const icon of availableIcons.value) {
    iconUrls.value[icon] = getPlatformIconDisplayUrl(icon)
  }
}

const resetForm = () => {
  formData.value = {
    name: '',
    baseUrl: '',
    apiKey: '',
    icon: '',
    apiProtocol: 'openai-chat',
  }
  iconLoadError.value = false
  iconError.value = ''
}

// 图标相关方法
const isImageIcon = (icon: string) => isImageIconValue(icon)

const getIconUrl = (icon: string) => {
  if (!icon) return ''
  return resolvedIconUrls.value[icon] || getPlatformIconDisplayUrl(icon) || icon
}

watch(() => formData.value.icon, (icon) => {
  if (icon) {
    void primeIconUrlCache(icon)
    iconLoadError.value = false
  }
})

const getInitials = (name: string) => {
  return name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase())
    .join('')
    .substring(0, 2)
}

const selectIcon = (icon: string) => {
  formData.value.icon = icon
  iconLoadError.value = false
  showIconPicker.value = false
}

const handleIconLoadError = () => {
  console.error('❌ [DEBUG] Icon load error for:', formData.value.icon)
  iconLoadError.value = true
}

const handleIconError = (icon: string) => {
  console.warn(`图标加载失败: ${icon}`)
}

// 监听平台数据变化，初始化表单
watch(() => props.platform, (platform) => {
  if (platform) {
    formData.value = {
      name: platform.name,
      baseUrl: platform.baseUrl,
      apiKey: platform.apiKey || '',
      icon: platform.icon || '',
      apiProtocol: platform.apiProtocol || 'openai-chat',
    }
  } else {
    resetForm()
  }
}, { immediate: true })

// 打开时：加载图标列表
watch(() => props.show, (show) => {
  if (show) {
    loadAvailableIcons()
    showIconPicker.value = false
  } else {
    closeProtocolDropdown()
  }
})

onMounted(() => {
  document.addEventListener('click', handleProtocolOutsideClick)
  window.addEventListener('resize', closeProtocolDropdown)
})

onUnmounted(() => {
  document.removeEventListener('click', handleProtocolOutsideClick)
  window.removeEventListener('resize', closeProtocolDropdown)
})

const handleSubmit = () => {
  if (!formData.value.name.trim()) {
    alert('请填写平台名称')
    return
  }
  if (!formData.value.baseUrl.trim()) {
    alert('请填写 API 基础URL')
    return
  }
  const platformData: any = {
    name: formData.value.name,
    displayName: formData.value.name,
    baseUrl: formData.value.baseUrl,
    apiProtocol: formData.value.apiProtocol,
    apiKey: formData.value.apiKey || undefined,
    icon: formData.value.icon || undefined,
    enabled: props.platform?.enabled ?? true
  }
  
  // 只有在创建新平台时才提供空的模型数组
  // 编辑现有平台时不传递 models 字段，避免覆盖现有模型
  if (!isEditing.value) {
    platformData.models = []
  }
  
  emit('save', platformData)
}

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

</script>

<style>
@import '../../../styles/dialog.css';
</style>

<style scoped>
/* 组件私有样式：dialog-content 尺寸覆盖 */
.dialog-content {
  background: var(--platform-config-dialog-bg);
  border: 1px solid var(--platform-config-dialog-border);
  border-radius: 12px;
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  overflow: clip;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  transform-origin: center center;
  backface-visibility: hidden;
  animation: popup-in 180ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.btn-secondary:hover {
  background: var(--platform-config-btn-secondary-hover-bg);
  color: var(--platform-config-btn-secondary-hover-text);
}

.base-url-row {
  display: flex;
  align-items: stretch;
  gap: 8px;
}

.base-url-row .form-input {
  flex: 1;
  min-width: 0;
}

.protocol-select-wrap {
  position: relative;
  flex: 0 0 auto;
}

.protocol-select-trigger {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 220px;
  height: 100%;
  min-height: 42px;
  padding: 0 12px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--form-input-bg, #F7F7F7);
  color: var(--text-primary);
  font: inherit;
  font-size: 14px;
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease, transform 0.12s ease;
}

.protocol-select-trigger:hover,
.protocol-select-trigger.open {
  background: var(--form-input-hover-bg, #f0f0f0);
  border-color: var(--form-input-hover-border, transparent);
}

.protocol-select-trigger:focus {
  outline: none;
  border-color: var(--form-input-focus-border, #3182ce);
}

.protocol-select-trigger:active {
  transform: scale(0.97);
}

.protocol-select-path,
.protocol-dropdown-path {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 12px;
  letter-spacing: -0.01em;
}

.protocol-select-arrow {
  flex-shrink: 0;
  color: var(--text-secondary, #718096);
  transition: transform 0.16s ease;
}

.protocol-select-trigger.open .protocol-select-arrow {
  transform: rotate(180deg);
}

.protocol-dropdown {
  box-sizing: border-box;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  background: var(--context-menu-bg, rgba(255, 255, 255, 0.4));
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid var(--context-menu-border, rgba(255, 255, 255, 0.55));
  border-radius: 12px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22), 0 4px 12px rgba(0, 0, 0, 0.12), inset 0 0.5px 0 rgba(255, 255, 255, 0.5);
  font-size: 14px;
}

.protocol-dropdown-item {
  appearance: none;
  box-sizing: border-box;
  width: 100%;
  min-height: 32px;
  padding: 4px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--context-menu-item-text, #2d3748);
  font: inherit;
  font-size: 14px;
  text-align: left;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  transition: background-color 0.2s ease;
}

.protocol-dropdown-item:hover,
.protocol-dropdown-item.active {
  background-color: var(--context-menu-item-hover-bg, rgba(0, 0, 0, 0.06));
}

.protocol-dropdown-meta {
  color: var(--text-secondary, #718096);
  font-size: 11px;
  flex-shrink: 0;
}

.dropdown-pop-enter-active,
.dropdown-pop-leave-active {
  transition: opacity 0.14s ease, transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1);
  transform-origin: top center;
}

.dropdown-pop-enter-from,
.dropdown-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.96);
}

@media (prefers-reduced-transparency: reduce) {
  .protocol-dropdown {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
    background: #ffffff;
  }
}

</style>
