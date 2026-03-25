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
  
  // 如果是文件名，使用 public 目录路径
  if (icon.includes('.')) {
    // 无论是开发环境还是生产环境，public 目录下的资源都可以通过 /assets/... 访问
    const iconPath = `/assets/images/providers/${icon}`
    console.log('✅ [DEBUG] Using public path:', iconPath)
    return iconPath
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
      description: platform.description,
      baseUrl: platform.baseUrl,
      apiKey: platform.apiKey || '',
      icon: platform.icon || ''
    }
  } else {
    resetForm()
  }
}, { immediate: true })

// 打开时：加载图标列表
watch(() => props.show, (show) => {
  if (show) {
    loadAvailableIcons()
    marketplaceOpen.value = false
    showIconPicker.value = false
  }
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

<style>
/* 引入通用弹窗样式 */
@import '../styles/dialog.css';
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
</style>