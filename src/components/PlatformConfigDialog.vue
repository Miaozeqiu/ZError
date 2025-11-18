<template>
  <!-- 当平台广场打开时，独立显示市场弹窗，不渲染底层编辑弹窗阴影 -->
  <div v-if="show && marketplaceOpen" class="marketplace-overlay" @click="handleMarketplaceOverlay">
    <div class="marketplace-panel" @click.stop>
      <div class="marketplace-header">
        <h4 class="marketplace-title">平台广场</h4>
        <button class="dialog-close" @click="closeMarketplace">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <div class="marketplace-body">
        <div class="marketplace-left">
          <div class="marketplace-list-title">平台</div>
          <div class="platform-list" v-if="!isLoadingMarket && marketPlatforms.length">
            <div
              v-for="p in marketPlatforms"
              :key="p.id"
              class="platform-item"
              @click="selectMarketplacePlatform(p)"
            >
              <div class="platform-item-row">
                <div class="platform-item-icon">
                  <img v-if="p.icon && isImageIcon(p.icon)" :src="getIconUrl(p.icon)" :alt="p.displayName || p.name || p.id" />
                  <div v-else class="icon-fallback-small">{{ (p.displayName || p.name || p.id).slice(0,2).toUpperCase() }}</div>
                </div>
                <div class="platform-item-info">
                  <div class="platform-name">{{ p.displayName || p.name || p.id }}</div>
                  <div class="platform-desc">{{ p.description }}</div>
                </div>
              </div>
            </div>
          </div>
          <div v-else class="marketplace-placeholder">
            <div v-if="isLoadingMarket">正在加载平台列表…</div>
            <div v-else-if="marketError">{{ marketError }}</div>
            <div v-else>暂无平台数据</div>
          </div>
        </div>
        <div class="marketplace-right">
          <div class="marketplace-list-title">操作</div>
          <!-- 自定义平台入口 -->
          <div class="custom-item" @click="chooseCustomPlatform">
            <div class="model-header">
              <div class="model-name">自定义平台</div>
              <div class="model-tag">手动配置</div>
            </div>
            <div class="model-desc">不依赖预设，直接进入平台编辑。</div>
          </div>
        </div>
      </div>
    </div>
  </div>
  <!-- 市场未打开时，显示常规编辑弹窗 -->
  <div v-else-if="show" class="dialog-overlay" @click="handleOverlayClick">
    <div class="dialog-content" @click.stop>
      <div class="dialog-header">
        <h3 class="dialog-title">{{ isEditing ? '编辑平台' : '添加平台' }}</h3>
        <button class="dialog-close" @click="$emit('close')">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M18 6L6 18M6 6l12 12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <!-- 平台图标显示区域 - 顶部居中 -->
        <div class="icon-display-section">
          <div class="icon-preview-large">
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
          </div>
          
          <!-- 可折叠的图标选择器 -->
          <div class="icon-selector-toggle">
            <button 
              type="button"
              class="toggle-button"
              @click="showIconPicker = !showIconPicker"
            >
              <span>选择图标</span>
              <svg 
                class="toggle-arrow"
                :class="{ 'rotated': showIconPicker }"
                width="16" 
                height="16" 
                viewBox="0 0 1024 1024" 
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M512 714.666667c-8.533333 0-17.066667-2.133333-23.466667-8.533334L146.133333 362.666667c-12.8-12.8-12.8-32 0-44.8s32-12.8 44.8 0L512 640l321.066667-322.133333c12.8-12.8 32-12.8 44.8 0s12.8 32 0 44.8L535.466667 706.133333c-6.4 6.4-14.933333 8.533333-23.466667 8.533334z" fill="currentColor"/>
              </svg>
            </button>
          </div>
          
          <!-- 图标选择器内容 -->
          <div v-if="showIconPicker" class="icon-picker-content">
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
        </div>

        <form @submit.prevent="handleSubmit">
          <div class="form-group">
            <label class="form-label">平台名称</label>
            <input 
              v-model="formData.name" 
              type="text" 
              class="form-input" 
              placeholder="例如：硅基流动"
              required
            >
          </div>

          <div class="form-group">
            <label class="form-label">平台描述</label>
            <textarea 
              v-model="formData.description" 
              class="form-textarea" 
              placeholder="简要描述这个AI平台"
              rows="3"
            ></textarea>
          </div>

          <div class="form-group">
            <label class="form-label">API 基础URL</label>
            <input 
              v-model="formData.baseUrl" 
              type="url" 
              class="form-input" 
              placeholder="https://api.siliconflow.cn/v1"
              required
            >
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

          <div class="dialog-actions">
            <button type="button" class="btn btn-secondary" @click="$emit('close')">
              取消
            </button>
            <button type="submit" class="btn btn-primary">
              {{ isEditing ? '保存' : '添加' }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed, nextTick } from 'vue'
import type { AIPlatform, AIModel } from '../services/modelConfig'

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

const formData = ref({
  name: '',
  description: '',
  baseUrl: '',
  apiKey: '',
  icon: ''
})

// 图标相关状态
const iconLoadError = ref(false)
const iconError = ref('')
const showIconPicker = ref(false)

// 可用图标列表
const availableIcons = ref<string[]>([])
const iconUrls = ref<Record<string, string>>({})
const emojiOptions = ['🤖', '🧠', '🔍', '⚡', '🚀', '💡', '🎯', '🔥', '⭐', '💎', '🌟', '🎨']

// 获取可用图标列表
const loadAvailableIcons = async () => {
  // 这里可以从assets目录读取可用图标
  // 暂时使用硬编码的常见图标
  availableIcons.value = [
    'silicon.png',
    'deepseek.png',
    'bailian.png',
    'moonshot.png',
    'doubao.png',
    'zhipu.png',
    'freeqwq.svg',
    'lanyun.png',
    'tencent-cloud-ti.png',
    'xirang.png',
    'bytedance.png',
    'baidu-cloud.svg',
    'baichuan.png',
    'openai.png',
    'fireworks.png',
    'anthropic.png',
    'google.png',
    'gemini.png',
    'grok.png',
    'macos.svg',
    'perplexity.png',
    'aws-bedrock.webp',
    'modelscope.png',
    'baidu-cloud.svg',
    'ollama.png',
    'groq.png',
    'perplexity.png',
    'mistral.png',
    '302ai.webp',
    'longcat.png',
    'dashscope.png',
    'cohere.png',
    'cephalon.jpeg',
    'cherryin.png',
    'gpustack.svg',
    'infini.png'
  ]
  
  // 预加载所有图标URL
  for (const icon of availableIcons.value) {
    iconUrls.value[icon] = await getIconUrl(icon)
  }
}

const resetForm = () => {
  formData.value = {
    name: '',
    description: '',
    baseUrl: '',
    apiKey: '',
    icon: ''
  }
  iconLoadError.value = false
  iconError.value = ''
}

// 图标相关方法
const isImageIcon = (icon: string) => {
  return icon.includes('.')
}

const getIconUrl = (icon: string) => {
  console.log('🔍 [DEBUG] getIconUrl called with icon:', icon)
  
  // 如果是网络URL，直接返回
  if (icon.startsWith('http://') || icon.startsWith('https://')) {
    console.log('✅ [DEBUG] Using network URL:', icon)
    return icon
  }
  
  // 如果是文件名，构建本地路径
  if (icon.includes('.')) {
    try {
      // 使用更可靠的环境检测
      const isTauriEnv = typeof window !== 'undefined' && (window.__TAURI__ || window.__TAURI_INTERNALS__)
      console.log('🔍 [DEBUG] Environment detection - isTauriEnv:', isTauriEnv)
      
      if (isTauriEnv) {
        // 检查是否在开发环境
        const isDev = import.meta.env.DEV
        console.log('🔍 [DEBUG] import.meta.env.DEV:', isDev)
        
        if (isDev) {
          // 开发环境：使用 Vite 开发服务器路径
          const devPath = `/src/assets/images/providers/${icon}`
          console.log('✅ [DEBUG] Using development path:', devPath)
          return devPath
        } else {
          // 生产环境：使用 frontendDist 管理的静态资源路径
          console.log('🚀 [DEBUG] Production environment detected')
          
          // 直接使用 public 目录中的资源路径
          const publicPath = `/assets/images/providers/${icon}`
          console.log('✅ [DEBUG] Using public path:', publicPath)
          return publicPath
        }
      } else {
        // 在浏览器环境中使用 public 目录路径
        const browserPath = `/assets/images/providers/${icon}`
        console.log('🌐 [DEBUG] Using browser path:', browserPath)
        return browserPath
      }
    } catch (error) {
      console.error('💥 [DEBUG] Critical error in getIconUrl:', error)
      // 回退到 public 目录路径
      const emergencyPath = `/assets/images/providers/${icon}`
      console.log('🆘 [DEBUG] Using emergency fallback path:', emergencyPath)
      return emergencyPath
    }
  }
  
  // 如果不是文件名，返回原始值
  return icon
}

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
      description: platform.description,
      baseUrl: platform.baseUrl,
      apiKey: platform.apiKey || '',
      icon: platform.icon || ''
    }
  } else {
    resetForm()
  }
}, { immediate: true })

// 打开时：加载图标列表，并在“添加模式”默认进入平台广场
watch(() => props.show, async (show) => {
  if (show) {
    loadAvailableIcons()
    await nextTick()
    if (!isEditing.value) {
      marketplaceOpen.value = true
      // 首次进入时加载平台列表
      if (!marketPlatforms.value.length) {
        await loadMarketplace()
      }
    }
  }
})

const handleSubmit = () => {
  const platformData: any = {
    name: formData.value.name,
    displayName: formData.value.name, // 设置displayName与name相同
    description: formData.value.description,
    baseUrl: formData.value.baseUrl,
    apiKey: formData.value.apiKey || undefined,
    icon: formData.value.icon || undefined
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

// ===== 平台广场（远程 JSON 选择） =====
interface MarketplacePlatform {
  id: string
  name?: string
  displayName?: string
  description?: string
  baseUrl?: string
  icon?: string
  models?: any[]
}

const marketplaceOpen = ref(false)
const marketPlatforms = ref<MarketplacePlatform[]>([])
const isLoadingMarket = ref(false)
const marketError = ref<string | null>(null)

const openMarketplace = async () => {
  marketplaceOpen.value = true
  if (!marketPlatforms.value.length) {
    await loadMarketplace()
  }
}

const closeMarketplace = () => {
  // 在“添加模式且默认进入平台广场”的场景下，关闭市场即退出添加流程
  if (!isEditing.value) {
    emit('close')
    return
  }
  // 编辑场景：返回编辑界面
  marketplaceOpen.value = false
}

const handleMarketplaceOverlay = (_e: MouseEvent) => {
  // 点击遮罩关闭
  closeMarketplace()
}

const loadMarketplace = async () => {
  isLoadingMarket.value = true
  marketError.value = null
  try {
    const remoteUrl = 'https://app.zerror.cc/models.json'
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    const r = await tauriFetch(remoteUrl, { method: 'GET' })
    if (!r.ok) throw new Error(`远程拉取失败 ${r.status}`)
    const json = await r.json()
    if (!Array.isArray(json)) throw new Error('数据格式错误：期望数组')
    marketPlatforms.value = json as MarketplacePlatform[]
  } catch (err: any) {
    console.warn('使用 Tauri HTTP 插件加载平台广场失败，回退到本地 models.json：', err)
    try {
      const localUrl = '/models.json'
      const lr = await fetch(localUrl, { method: 'GET' })
      if (!lr.ok) throw new Error(`本地拉取失败 ${lr.status}`)
      const json = await lr.json()
      if (!Array.isArray(json)) throw new Error('本地数据格式错误：期望数组')
      marketPlatforms.value = json as MarketplacePlatform[]
    } catch (err2: any) {
      marketError.value = err2?.message || '无法加载平台广场数据'
    }
  } finally {
    isLoadingMarket.value = false
  }
}

const selectMarketplacePlatform = (p: MarketplacePlatform) => {
  // 回填到表单
  formData.value.name = p.displayName || p.name || p.id || ''
  formData.value.description = p.description || ''
  formData.value.baseUrl = p.baseUrl || ''
  formData.value.icon = p.icon || ''
  // 关闭平台广场，进入编辑界面
  marketplaceOpen.value = false
}

const chooseCustomPlatform = () => {
  // 清空并进入编辑界面
  resetForm()
  marketplaceOpen.value = false
}
</script>

<style scoped>
.marketplace-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--platform-config-overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: overlay-fade-in 160ms ease-out both;
}

.marketplace-panel {
  background: var(--platform-config-dialog-bg);
  border: 1px solid var(--platform-config-dialog-border);
  border-radius: 12px;
  box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04);
  width: 92vw;
  max-width: 1100px;
  max-height: 90vh;
  overflow: hidden;
  will-change: transform, opacity;
  transform-origin: center center;
  backface-visibility: hidden;
  animation: popup-in 180ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.marketplace-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--platform-config-dialog-header-border);
}

.marketplace-title {
  font-size: 16px;
  font-weight: 600;
  margin: 0;
}

.marketplace-body {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0;
  height: calc(90vh - 80px);
}

.marketplace-left,
.marketplace-right {
  padding: 16px;
  overflow-y: auto;
}

.marketplace-list-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--platform-config-icon-category-title-text);
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.platform-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.platform-item {
  border: 1px solid var(--platform-config-icon-option-border);
  border-radius: 8px;
  padding: 10px;
  cursor: pointer;
  transition: all 0.15s ease;
  background: var(--platform-config-icon-option-bg);
}

.platform-item:hover {
  border-color: var(--platform-config-icon-option-hover-border);
  background: var(--platform-config-icon-option-hover-bg);
}

.platform-item-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.platform-item-icon{
  display: flex;
  align-items: center;
  justify-content: center;
}

.platform-item-icon img {
  width: 40px;
  height: 40px;
  max-width: 40px;
  max-height: 40px;
  object-fit: contain;
  border-radius: 6px;
}

.icon-fallback-small {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--platform-config-icon-fallback-text);
  border: 2px solid var(--platform-config-icon-display-border);
}

.platform-item-info .platform-name {
  font-size: 14px;
  font-weight: 600;
}

.platform-item-info .platform-desc {
  font-size: 12px;
  color: var(--text-secondary);
}

.marketplace-placeholder {
  border: 1px dashed var(--platform-config-icon-option-border);
  border-radius: 8px;
  padding: 16px;
  text-align: center;
  color: var(--text-secondary);
}

.custom-item {
  border: 1px solid var(--platform-config-icon-option-border);
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
  transition: all 0.15s ease;
  background: var(--platform-config-icon-option-bg);
}

.custom-item:hover {
  border-color: var(--platform-config-icon-option-hover-border);
  background: var(--platform-config-icon-option-hover-bg);
}

.model-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.model-name {
  font-size: 14px;
  font-weight: 600;
}

.model-tag {
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 10px;
  background: var(--platform-config-icon-section-title-bg);
}

.model-desc {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary);
}
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--platform-config-overlay-bg);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: overlay-fade-in 160ms ease-out both;
}

.dialog-content {
  background: var(--platform-config-dialog-bg);
  border: 1px solid var(--platform-config-dialog-border);
  border-radius: 12px;
  width: 90%;
  max-width: 600px;
  max-height: 90vh;
  overflow: hidden;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  will-change: transform, opacity;
  transform-origin: center center;
  backface-visibility: hidden;
  animation: popup-in 180ms cubic-bezier(0.2, 0.7, 0.2, 1) both;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--platform-config-dialog-header-border);
}

.dialog-title {
  font-size: 18px;
  font-weight: 600;
  color: var(--platform-config-dialog-title-text);
  margin: 0;
}

.dialog-close {
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: var(--platform-config-dialog-close-text);
  border-radius: 4px;
  transition: all 0.2s ease;
}

.dialog-close:hover {
  background: var(--platform-config-dialog-close-hover-bg);
  color: var(--platform-config-dialog-close-hover-text);
}

.dialog-body {
  padding: 24px;
  max-height: calc(90vh - 140px);
  overflow-y: auto;
}

.form-group {
  margin-bottom: 20px;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--platform-config-form-label-text);
  margin-bottom: 6px;
}

.form-input {
  box-sizing: border-box;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  font-size: 14px;
  transition: border-color 0.2s ease;
  background-color: var(--bg-secondary);
}

.form-input:focus {
  outline: none;
  border-color: var(--platform-config-form-input-focus-border);
}

.form-textarea {
  color: var(--text-primary);
  box-sizing: border-box;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--border-color, #e2e8f0);
  border-radius: 8px;
  font-size: 14px;
  resize: none;
  min-height: 80px;
  transition: border-color 0.2s ease;
  background-color: var(--bg-secondary);
}

.form-textarea:focus {
  outline: none;
  border-color: var(--platform-config-form-input-focus-border);
}

.btn-secondary:hover {
  background: #667eea;
  color: white;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 24px;
  padding-top: 20px;
  border-top: 1px solid var(--platform-config-dialog-header-border);
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-primary {
  background: var(--dialog-button-primary-bg);
  color: var(--dialog-button-primary-text);
}

.btn-primary:hover {
  background: var(--dialog-button-primary-hover);
}

.btn-secondary {
  background: var(--platform-config-btn-secondary-bg);
  color: var(--platform-config-btn-secondary-text);
  border: 1px solid var(--platform-config-btn-secondary-border);
}

.btn-secondary:hover {
  background: var(--platform-config-btn-secondary-hover-bg);
  color: var(--platform-config-btn-secondary-hover-text);
}

/* 图标相关样式 */
.icon-section {
  margin-bottom: 20px;
}

.icon-preview {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.icon-display {
  width: 40px;
  height: 40px;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 2px solid var(--platform-config-icon-display-border);
  background: var(--platform-config-icon-display-bg);
}

.icon-image {
  width: 32px;
  height: 32px;
  object-fit: contain;
  border-radius: 4px;
}

.icon-emoji {
  font-size: 24px;
}

.icon-fallback {
  font-size: 14px;
  font-weight: 600;
  color: var(--platform-config-icon-fallback-text);
}

.icon-input-group {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.icon-input {
  flex: 1;
}

.btn-icon {
  padding: 10px 16px;
  background: var(--platform-config-btn-secondary-bg);
  border: 1px solid var(--platform-config-btn-secondary-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-icon:hover {
  background: var(--platform-config-toggle-button-hover-bg);
}

.icon-picker {
  position: relative;
}

.icon-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--platform-config-icon-dropdown-bg);
  border: 1px solid var(--platform-config-icon-dropdown-border);
  border-radius: 8px;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.1);
  z-index: 1001;
  max-height: 300px;
  overflow-y: auto;
}

.icon-section-title {
  padding: 12px 16px;
  font-size: 12px;
  font-weight: 600;
  color: var(--platform-config-icon-section-title-text);
  background: var(--platform-config-icon-section-title-bg);
  border-bottom: 1px solid var(--platform-config-icon-dropdown-border);
}

.icon-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(50px, 1fr));
  gap: 8px;
  padding: 12px;
}

.icon-option {
  width: 50px;
  height: 50px;
  border: 1px solid var(--platform-config-icon-option-border);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--platform-config-icon-option-bg);
}

.icon-option:hover {
  border-color: var(--platform-config-icon-option-hover-border);
  background: var(--platform-config-icon-option-hover-bg);
}

.icon-option img {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.icon-option .emoji {
  font-size: 20px;
}

/* 新的图标显示区域样式 */
.icon-display-section {
  text-align: center;
  margin-bottom: 24px;
  padding: 20px;
  border-bottom: 1px solid #e2e8f0;
}

.icon-preview-large {
  width: 80px;
  height: 80px;
  margin: 0 auto 16px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--platform-config-icon-display-bg);
  border: 2px solid var(--platform-config-icon-display-border);
}

.icon-image-large {
  width: 60px;
  height: 60px;
  object-fit: contain;
  border-radius: 8px;
}

.icon-emoji-large {
  font-size: 48px;
  line-height: 1;
}

.icon-fallback-large {
  font-size: 24px;
  font-weight: 600;
  color: var(--platform-config-icon-fallback-text);
  background: linear-gradient(135deg, #667eea, #764ba2);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.icon-selector-toggle {
  display: flex;
  justify-content: right;
  margin-bottom: 16px;
}

.toggle-button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--platform-config-toggle-button-bg);
  border: 1px solid var(--platform-config-toggle-button-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  font-size: 14px;
  color: var(--platform-config-toggle-button-text);
}

.toggle-button:hover {
  background: var(--platform-config-toggle-button-hover-bg);
  border-color: var(--platform-config-toggle-button-hover-border);
}

.toggle-arrow {
  transition: transform 0.2s ease;
}

.toggle-arrow.rotated {
  transform: rotate(180deg);
}

.icon-picker-content {
  background: var(--platform-config-icon-picker-content-bg);
  border: 1px solid var(--platform-config-icon-picker-content-border);
  border-radius: 8px;
  padding: 16px;
  margin-top: 8px;
}

.icon-category {
  margin-bottom: 16px;
}

.icon-category:last-child {
  margin-bottom: 0;
}

.icon-category h5 {
  font-size: 12px;
  font-weight: 600;
  color: var(--platform-config-icon-category-title-text);
  margin: 0 0 8px 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.icon-option {
  width: 40px;
  height: 40px;
  border: 1px solid var(--platform-config-icon-option-border);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--platform-config-icon-option-bg);
}

.icon-option:hover {
  border-color: var(--platform-config-icon-option-hover-border);
  background: var(--platform-config-icon-option-hover-bg);
}

.icon-option.active {
  border-color: var(--platform-config-icon-option-active-border);
}

.icon-option-image {
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.emoji-option {
  font-size: 18px;
}

.icon-error {
  color: var(--platform-config-error-text);
  font-size: 12px;
  margin-bottom: 8px;
  padding: 8px;
  background: var(--platform-config-error-bg);
  border-radius: 4px;
}
@keyframes popup-in {
  from {
    transform: translateY(10px) scale(0.98);
    opacity: 0;
  }
  to {
    transform: translateY(0) scale(1);
    opacity: 1;
  }
}
@keyframes overlay-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}
</style>