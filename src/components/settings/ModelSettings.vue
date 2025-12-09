<template>
  <div class="model-settings-container">
    <!-- 左侧平台列表 -->
    <div class="platform-sidebar">
      <div class="sidebar-header">
        <h3 class="sidebar-title">AI 平台管理</h3>
        <div class="header-actions">
          <button class="btn btn-small btn-secondary help-button" @click="openModelConfigDocs" title="查看模型配置文档">
            <svg width="14" height="14" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
              <path d="M463.99957 784.352211c0 26.509985 21.490445 48.00043 48.00043 48.00043s48.00043-21.490445 48.00043-48.00043c0-26.509985-21.490445-48.00043-48.00043-48.00043S463.99957 757.842226 463.99957 784.352211z" fill="currentColor"></path>
              <path d="M512 960c-247.039484 0-448-200.960516-448-448S264.960516 64 512 64 960 264.960516 960 512 759.039484 960 512 960zM512 128.287273c-211.584464 0-383.712727 172.128262-383.712727 383.712727 0 211.551781 172.128262 383.712727 383.712727 383.712727 211.551781 0 383.712727-172.159226 383.712727-383.712727C895.712727 300.415536 723.551781 128.287273 512 128.287273z" fill="currentColor"></path>
              <path d="M512 673.695256c-17.664722 0-32.00086-14.336138-32.00086-31.99914l0-54.112297c0-52.352533 39.999785-92.352318 75.32751-127.647359 25.887273-25.919957 52.67249-52.67249 52.67249-74.016718 0-53.343368-43.07206-96.735385-95.99914-96.735385-53.823303 0-95.99914 41.535923-95.99914 94.559333 0 17.664722-14.336138 31.99914-32.00086 31.99914s-32.00086-14.336138-32.00086-31.99914c0-87.423948 71.775299-158.559333 160.00086-158.559333s160.00086 72.095256 160.00086 160.735385c0 47.904099-36.32028 84.191695-71.424378 119.295794-27.839699 27.776052-56.575622 56.511974-56.575622 82.3356l0 54.112297C544.00086 659.328155 529.664722 673.695256 512 673.695256z" fill="currentColor"></path>
            </svg>
          </button>
          <button class="btn btn-small btn-primary" @click="showAddPlatformDialog = true">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 5v14m-7-7h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
            </svg>
            添加
          </button>
        </div>
      </div>
      
      <div class="platform-list">
        <div 
          v-for="platform in modelConfig.platforms" 
          :key="platform.id"
          class="platform-item"
          :class="{ active: selectedPlatform?.id === platform.id }"
          @click="selectPlatform(platform)"
          @contextmenu="showPlatformMenu($event, platform)"
        >
          <div class="platform-icon">
            <!-- 如果是emoji，直接显示 -->
            <div 
              v-if="platform.icon && isEmoji(platform.icon)"
              class="icon-emoji"
            >
              {{ platform.icon }}
            </div>
            <!-- 如果是图片URL，使用img标签 -->
            <img 
              v-else-if="platform.icon && !isEmoji(platform.icon) && !iconLoadErrors[platform.id]"
              :src="platformIconUrls[platform.id]"
              :alt="platform.displayName"
              @error="handleIconError(platform.id)"
              class="icon-image"
            />
            <!-- 否则显示文字回退 -->
            <div 
              v-else
              class="icon-fallback"
            >
              {{ getPlatformInitials(platform.displayName) }}
            </div>
          </div>
          <div class="platform-info">
            <h4 class="platform-name">{{ platform.displayName }}</h4>
          </div>
          <!-- 启用开关 - 右侧 -->
          <Toggle
            v-model="platform.enabled"
            variant="platform"
            size="medium"
            @change="updatePlatformEnabled"
            @click.stop
          />
        </div>
      </div>
    </div>

    <!-- 右侧平台详情 -->
    <div class="platform-detail">
      <div v-if="selectedPlatform" class="detail-content">
        <!-- 平台基本信息 -->
        <div class="detail-section">
          <div class="section-header">
          <div class="header-actions">
            <!-- <button class="btn btn-small btn-primary" @click="showMarkdownDemo = true">
              Markdown 演示
            </button> -->
          </div>
        </div>
          <p class="platform-description">{{ selectedPlatform.description }}</p>
        </div>

        <!-- API Key 配置 -->
        <div class="detail-section">
          <h4 class="subsection-title">API 配置</h4>
          <div class="form-group">
            <label class="form-label">API Key</label>
            <div class="input-group">
              <div class="input-with-suffix">
                <input 
                  :type="showApiKey ? 'text' : 'password'"
                  v-model="selectedPlatform.apiKey"
                  @input="updatePlatformApiKey"
                  class="form-input api-key-input"
                  placeholder="请输入API Key"
                >
                <button 
                  class="input-suffix-btn"
                  @click="toggleApiKeyVisibility"
                >
                  <svg 
                    v-if="!showApiKey"
                    t="1761195836172" 
                    class="icon" 
                    viewBox="0 0 1024 1024" 
                    version="1.1" 
                    xmlns="http://www.w3.org/2000/svg" 
                    p-id="1305" 
                    width="16" 
                    height="16"
                  >
                    <path d="M512 217.7792c258.0992 0 410.752 223.0784 453.504 295.5008C922.88 585.344 770.9696 806.2464 512 806.2464c-291.5072 0-420.9152-220.8-454.8352-291.4304C99.1488 444.9024 255.2832 217.7792 512 217.7792M512 166.5792c-338.3296 0-512 345.3696-512 345.3696s131.072 345.4976 512 345.4976c344.9856 0 512-344.1408 512-344.1408S855.6544 166.5792 512 166.5792L512 166.5792zM512.0256 396.1856c67.0208 0 115.6864 48.6912 115.6864 115.8144 0 67.1744-48.64 115.8656-115.6864 115.8656-67.0464 0-115.7376-48.6912-115.7376-115.8656C396.288 444.8768 444.9792 396.1856 512.0256 396.1856M512.0256 344.9856c-96.896 0-166.9376 73.0624-166.9376 167.0144 0 94.0032 70.016 167.0656 166.9376 167.0656 96.8704 0 166.8864-73.0624 166.8864-167.0656C678.912 418.0224 608.896 344.9856 512.0256 344.9856L512.0256 344.9856z" fill="currentColor" p-id="1306"></path>
                  </svg>
                  <svg 
                    v-else
                    t="1761195878569" 
                    class="icon" 
                    viewBox="0 0 1024 1024" 
                    version="1.1" 
                    xmlns="http://www.w3.org/2000/svg" 
                    p-id="1455" 
                    width="16" 
                    height="16"
                  >
                    <path d="M962.41027 511.792269 905.058051 443.432345c30.108738-36.255739 55.207369-77.30362 74.140581-122.626875 6.777357-16.22759-0.870834-34.859949-17.098423-41.637306-16.290011-6.797823-34.859949 0.8913-41.637306 17.098423C853.249081 457.180464 696.791703 557.13906 512.148379 557.13906c-186.156794 0-342.67557-100.186793-408.499741-261.452687-6.632047-16.290011-25.181519-24.124444-41.491996-17.450441-16.290011 6.632047-24.103978 25.222451-17.450441 41.49302 19.34765 47.403636 46.134737 90.343611 78.658478 128.121006l-53.6632 63.942311c-11.295254 13.45136-9.534144 33.533744 3.937682 44.850487 5.948479 4.994758 13.223163 7.440459 20.435425 7.440459 9.077749 0 18.114566-3.875261 24.415063-11.378142l49.720402-59.244312c34.487465 30.608112 73.528644 56.220443 115.855658 76.374458l-30.384008 83.471087c-6.031367 16.518209 2.486634 34.777061 19.026332 40.787962 3.585665 1.305739 7.254218 1.927909 10.880815 1.927909 12.994965 0 25.201985-8.020674 29.907147-20.953218l29.694299-81.572854c43.456744 14.417361 89.441055 23.432689 137.125077 26.191522l0 96.624664c0 17.575284 14.258749 31.834033 31.834033 31.834033 17.575284 0 31.834033-14.258749 31.834033-31.834033l0-96.589872c50.570769-2.822278 98.975199-12.387122 144.327106-27.960819l30.326702 83.307358c4.705162 12.932544 16.912182 20.953218 29.907147 20.953218 3.626597 0 7.29515-0.62217 10.880815-1.927909 16.538675-6.009877 25.056676-24.269753 19.026332-40.787962l-31.321356-86.041632c41.663912-20.509103 79.855746-46.515407 113.648386-77.547167l52.844555 62.987566c6.300496 7.502881 15.315824 11.378142 24.415063 11.378142 7.212262 0 14.46648-2.445702 20.435425-7.440459C971.944414 545.326013 973.705524 525.263072 962.41027 511.792269z" fill="currentColor" p-id="1456"></path>
                  </svg>
                </button>
              </div>
            </div>
            <div class="form-tip">
              <a 
                href="https://docs.zerror.cc/docs/get-apiKey" 
                target="_blank" 
                rel="noopener noreferrer" 
                class="api-doc-link"
              >
                如何获取Api Key?
              </a>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label">Base URL</label>
            <input 
              type="text" 
              v-model="selectedPlatform.baseUrl"
              @input="updatePlatformBaseUrl"
              class="form-input"
              placeholder="API 基础地址"
            >
          </div>
        </div>

        <!-- 模型管理 -->
        <div class="detail-section">
          <div class="section-header">
            <h4 class="subsection-title">模型管理</h4>
            <div class="header-actions">
              <!-- 模型分类筛选 -->
              <ModelCategorySwitch v-model="selectedCategory" />
              <button class="btn btn-small btn-primary" @click="addNewModel">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M12 5v14m-7-7h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
                </svg>
                添加模型
              </button>
            </div>
          </div>
          
          <div class="model-list">
            <div 
              v-for="model in filteredModels" 
              :key="model.id"
              class="model-item"
              :class="{ active: currentModel?.id === model.id }"
              @click="selectModel(model)"
              @contextmenu.prevent="showModelContextMenuHandler($event, model)"
            >
              <div class="model-info">
                <div class="model-header">
                  <h5 class="model-name">{{ model.displayName }}</h5>
                 
                </div>
                
              </div>
              <div class="model-actions">
                <div v-if="currentModel && currentModel.id === model.id" class="model-selected">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                    <path d="M20 6L9 17l-5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path>
                  </svg>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      <div v-else class="empty-state">
        <div class="empty-icon">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <path d="M2 17L12 22L22 17" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
            <path d="M2 12L12 17L22 12" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>
          </svg>
        </div>
        <h3>选择一个AI平台</h3>
        <p>从左侧列表中选择一个平台来查看和编辑其配置</p>
      </div>
    </div>

    <!-- 平台配置对话框 -->
    <PlatformConfigDialog 
      :show="showAddPlatformDialog || showEditPlatformDialog"
      :platform="editingPlatform"
      @close="closePlatformDialog"
      @save="savePlatform"
    />

    <!-- 模型配置对话框 -->
    <ModelConfigDialog 
      :show="showModelConfigDialog"
      :model="editingModel"
      :start-in-marketplace="!editingModel"
      @close="closeModelDialog"
      @save="saveModel"
    />

    <!-- 平台右键菜单 -->
    <PlatformContextMenu
      :visible="showPlatformContextMenu"
      :x="contextMenuX"
      :y="contextMenuY"
      :platform="contextMenuPlatform"
      @edit-platform="handleEditPlatform"
      @duplicate-platform="handleDuplicatePlatform"
      @delete-platform="handleDeletePlatform"
    />

    <!-- 模型右键菜单 -->
    <ModelContextMenu
      :visible="showModelContextMenu"
      :x="modelContextMenuX"
      :y="modelContextMenuY"
      :model="contextMenuModel"
      @edit-model="handleEditModel"
      @duplicate-model="handleDuplicateModel"
      @test-model="handleTestModel"
      @delete-model="handleDeleteModel"
    />

    <!-- 测试弹窗 -->
    <ModelTestDialog
      :visible="showTestDialog"
      :model-name="testDialogModelName"
      :testing="testingModelId !== null"
      :test-result="currentTestResult"
      :test-error="currentTestError"
      :streaming-response="streamingResponse"
      :streaming-reasoning="streamingReasoning"
      @close="handleCloseTestDialog"
      @cancel-test="handleCancelTest"
    />

    <!-- Markdown 演示弹窗 -->
    <MarkdownDemoDialog
      :visible="showMarkdownDemo"
      @close="showMarkdownDemo = false"
    />

    <!-- 删除模型确认弹窗 -->
    <ModelDeleteConfirmDialog
      :visible="showDeleteModelDialog"
      :model-name="deleteModelName"
      @confirm="confirmDeleteModel"
      @cancel="cancelDeleteModel"
    />

    <!-- 删除平台确认弹窗 -->
    <PlatformDeleteConfirmDialog
      :visible="showDeletePlatformDialog"
      :platform-name="deletePlatformName"
      @confirm="confirmDeletePlatform"
      @cancel="cancelDeletePlatform"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, computed } from 'vue'
import { useModelConfig } from '../../services/modelConfig'
import type { AIPlatform, AIModel } from '../../services/modelConfig'
import { environmentDetector } from '../../services/environmentDetector'
import PlatformConfigDialog from '../PlatformConfigDialog.vue'
import ModelConfigDialog from '../ModelConfigDialog.vue'
import PlatformContextMenu from '../PlatformContextMenu.vue'
import ModelContextMenu from '../ModelContextMenu.vue'
import ModelTestDialog from '../ModelTestDialog.vue'
import MarkdownDemoDialog from '../MarkdownDemoDialog.vue'
import ModelDeleteConfirmDialog from '../ModelDeleteConfirmDialog.vue'
import PlatformDeleteConfirmDialog from '../PlatformDeleteConfirmDialog.vue'
import Toggle from '../Toggle.vue'
import ModelCategorySwitch from '../ModelCategorySwitch.vue'

// 模型配置管理
const { 
  settings: modelConfig, 
  addPlatform, 
  updatePlatform, 
  removePlatform, 
  setSelectedModel: setCurrentModel, 
  setSelectedTextModel,
  setSelectedVisionModel,
  selectedModel: globalSelectedModel,
  selectedTextModel: globalSelectedTextModel,
  selectedVisionModel: globalSelectedVisionModel
} = useModelConfig()

// 对话框状态
const showAddPlatformDialog = ref(false)
const showEditPlatformDialog = ref(false)
const editingPlatform = ref<AIPlatform | null>(null)

// 模型配置对话框状态
const showModelConfigDialog = ref(false)
const editingModel = ref<AIModel | null>(null)

// 模型设置相关状态
const selectedPlatform = ref<AIPlatform | null>(null)
const selectedModel = ref<AIModel | null>(null)
const currentTextModel = ref<AIModel | null>(null)
const currentVisionModel = ref<AIModel | null>(null)
const showApiKey = ref(false)

// 模型分类筛选状态
const selectedCategory = ref<'text' | 'vision'>('text')

// 计算属性：根据分类筛选模型
const filteredModels = computed(() => {
  if (!selectedPlatform.value) return []
  
  const models = selectedPlatform.value.models || []
  
  return models.filter(model => model.category === selectedCategory.value)
})

// 计算属性：当前选中的模型（根据分类）
const currentModel = computed(() => {
  // 优先返回当前分类对应的模型
  if (selectedCategory.value === 'text') {
    return currentTextModel.value
  } else {
    return currentVisionModel.value
  }
})
const testingModelId = ref<string | null>(null)
const testResults = ref<{[key: string]: any}>({})
const testErrors = ref<{[key: string]: string}>({})
const testAbortController = ref<AbortController | null>(null)

// 测试弹窗状态
const showTestDialog = ref(false)
const testDialogModelName = ref('')
const currentTestResult = ref<any>(null)
const currentTestError = ref('')
const streamingResponse = ref('')
const streamingReasoning = ref('')

const showMarkdownDemo = ref(false)

// 删除模型弹窗状态
const showDeleteModelDialog = ref(false)
const deleteModelName = ref('')
const deleteModelId = ref('')

// 删除平台弹窗状态
const showDeletePlatformDialog = ref(false)
const deletePlatformName = ref('')
const deletePlatformId = ref('')

// 图标加载错误状态
const iconLoadErrors = ref<{[key: string]: boolean}>({})
const platformIconUrls = ref<Record<string, string>>({})

// 预加载平台图标
const loadPlatformIcons = async () => {
  for (const platform of modelConfig.platforms) {
    if (platform.icon && platform.icon.includes('.')) {
      try {
        platformIconUrls.value[platform.id] = await getPlatformIconUrl(platform.icon)
      } catch (error) {
        console.error(`Failed to load icon for platform ${platform.id}:`, error)
      }
    }
  }
}

// 右键菜单状态
const showPlatformContextMenu = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMenuPlatform = ref<AIPlatform | null>(null)

// 模型右键菜单状态
const showModelContextMenu = ref(false)
const modelContextMenuX = ref(0)
const modelContextMenuY = ref(0)
const contextMenuModel = ref<AIModel | null>(null)

// 平台管理方法
const editPlatform = (platform: AIPlatform) => {
  editingPlatform.value = { ...platform }
  showEditPlatformDialog.value = true
}

const deletePlatform = async (platformId: string) => {
  await removePlatform(platformId)
}

// 确认删除平台
const confirmDeletePlatform = async () => {
  if (deletePlatformId.value) {
    await deletePlatform(deletePlatformId.value)
  }
  showDeletePlatformDialog.value = false
  deletePlatformName.value = ''
  deletePlatformId.value = ''
}

// 取消删除平台
const cancelDeletePlatform = () => {
  showDeletePlatformDialog.value = false
  deletePlatformName.value = ''
  deletePlatformId.value = ''
}

const closePlatformDialog = () => {
  showAddPlatformDialog.value = false
  showEditPlatformDialog.value = false
  editingPlatform.value = null
}

const savePlatform = async (platformData: Omit<AIPlatform, 'id' | 'isBuiltIn'>) => {
  try {
    if (editingPlatform.value) {
      // 编辑现有平台
      await updatePlatform(editingPlatform.value.id, platformData)
      
      // 如果图标发生了变化，清除缓存并重新加载
      if (platformData.icon !== editingPlatform.value.icon) {
        // 清除旧的图标缓存
        delete platformIconUrls.value[editingPlatform.value.id]
        delete iconLoadErrors.value[editingPlatform.value.id]
        
        // 重新加载该平台的图标
        if (platformData.icon && platformData.icon.includes('.')) {
          try {
            platformIconUrls.value[editingPlatform.value.id] = await getPlatformIconUrl(platformData.icon)
          } catch (error) {
            console.error(`Failed to load updated icon for platform ${editingPlatform.value.id}:`, error)
            iconLoadErrors.value[editingPlatform.value.id] = true
          }
        }
      }
    } else {
      // 添加新平台
      const newPlatformId = await addPlatform(platformData)
      
      // 为新平台加载图标
      if (platformData.icon && platformData.icon.includes('.')) {
        try {
          platformIconUrls.value[newPlatformId] = await getPlatformIconUrl(platformData.icon)
        } catch (error) {
          console.error(`Failed to load icon for new platform ${newPlatformId}:`, error)
          iconLoadErrors.value[newPlatformId] = true
        }
      }
    }
    closePlatformDialog()
  } catch (error) {
    console.error('保存平台配置失败:', error)
    alert('保存失败，请检查配置信息')
  }
}

// 模型设置相关方法
const selectPlatform = (platform: AIPlatform) => {
  selectedPlatform.value = platform
  selectedModel.value = null
}

const selectModel = (model: AIModel) => {
  console.log('🔍 [DEBUG] selectModel called with:', model.displayName, 'category:', model.category)
  
  // 根据模型类别更新对应的状态
  if (model.category === 'text') {
    console.log('📝 [DEBUG] Setting text model:', model.displayName)
    currentTextModel.value = model
    setSelectedTextModel(model.id)
  } else if (model.category === 'vision') {
    console.log('👁️ [DEBUG] Setting vision model:', model.displayName)
    currentVisionModel.value = model
    setSelectedVisionModel(model.id)
  }
  
  console.log('✅ [DEBUG] Model selection completed')
  console.log('📊 [DEBUG] Current state - Text:', currentTextModel.value?.displayName, 'Vision:', currentVisionModel.value?.displayName)
}

// 图标相关方法
const getPlatformIconUrl = async (icon: string) => {
  console.log('🔍 [DEBUG] getPlatformIconUrl called with icon:', icon)
  
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
          
          try {
            // 方法1：使用 public 目录中的资源（通过 frontendDist 管理）
            const publicPath = `/assets/images/providers/${icon}`
            console.log('✅ [DEBUG] Using frontendDist managed path:', publicPath)
            return publicPath
          } catch (error) {
            console.error('❌ [DEBUG] frontendDist path failed:', error)
            
            // 方法2：尝试使用 Tauri 资源解析
            try {
              console.log('🔍 [DEBUG] Attempting Tauri resource resolution')
              const { convertFileSrc } = await import('@tauri-apps/api/core')
              const resourcePath = `assets/images/providers/${icon}`
              const convertedUrl = convertFileSrc(resourcePath)
              console.log('✅ [DEBUG] Tauri converted URL:', convertedUrl)
              return convertedUrl
            } catch (tauriError) {
              console.error('❌ [DEBUG] Tauri resource resolution failed:', tauriError)
              
              // 方法3：回退到相对路径
              const fallbackPath = `/assets/images/providers/${icon}`
              console.log('⚠️ [DEBUG] Using fallback path:', fallbackPath)
              return fallbackPath
            }
          }
        }
      } else {
        // 在浏览器环境中使用 public 目录路径
        const browserPath = `/assets/images/providers/${icon}`
        console.log('🌐 [DEBUG] Using browser path:', browserPath)
        return browserPath
      }
    } catch (error) {
      console.error('💥 [DEBUG] Critical error in getPlatformIconUrl:', error)
      // 回退到 public 目录路径
      const emergencyPath = `/assets/images/providers/${icon}`
      console.log('🆘 [DEBUG] Using emergency fallback path:', emergencyPath)
      return emergencyPath
    }
  }
  
  // 如果是emoji或其他字符，返回空字符串让其使用文字回退
  console.log('📝 [DEBUG] Icon is not a file, returning empty string for:', icon)
  return ''
}

const getPlatformInitials = (name: string) => {
  return name
    .split(' ')
    .map(word => word.charAt(0).toUpperCase())
    .join('')
    .substring(0, 2)
}

// 判断是否为emoji
const isEmoji = (str: string) => {
  if (!str) return false
  
  // 简单的emoji检测：检查是否包含emoji字符
  const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u
  
  // 或者检查是否是单个字符且不包含文件扩展名或URL特征
  const isSingleChar = str.length <= 4 && !str.includes('.') && !str.includes('/') && !str.includes('http')
  
  return emojiRegex.test(str) || isSingleChar
}

const handleIconError = (platformId: string) => {
  iconLoadErrors.value[platformId] = true
}

// 右键菜单相关方法
const showPlatformMenu = (event: MouseEvent, platform: AIPlatform) => {
  event.preventDefault()
  contextMenuX.value = event.clientX
  contextMenuY.value = event.clientY
  contextMenuPlatform.value = platform
  showPlatformContextMenu.value = true
}

const hidePlatformMenu = () => {
  showPlatformContextMenu.value = false
  contextMenuPlatform.value = null
}

const showModelContextMenuHandler = (event: MouseEvent, model: AIModel) => {
  event.preventDefault()
  modelContextMenuX.value = event.clientX
  modelContextMenuY.value = event.clientY
  contextMenuModel.value = model
  showModelContextMenu.value = true
}

const hideModelMenu = () => {
  showModelContextMenu.value = false
  contextMenuModel.value = null
}

const handleEditPlatform = () => {
  if (contextMenuPlatform.value) {
    editPlatform(contextMenuPlatform.value)
  }
  hidePlatformMenu()
}

const handleDuplicatePlatform = async () => {
  if (contextMenuPlatform.value) {
    const duplicatedPlatform = {
      ...contextMenuPlatform.value,
      displayName: `${contextMenuPlatform.value.displayName} (副本)`,
      id: undefined,
      isBuiltIn: false
    }
    delete duplicatedPlatform.id
    await addPlatform(duplicatedPlatform)
  }
  hidePlatformMenu()
}

const handleDeletePlatform = async () => {
  if (contextMenuPlatform.value) {
    deletePlatformName.value = contextMenuPlatform.value.name
    deletePlatformId.value = contextMenuPlatform.value.id
    showDeletePlatformDialog.value = true
  }
  hidePlatformMenu()
}

const handleEditModel = () => {
  if (contextMenuModel.value) {
    editModel(contextMenuModel.value)
  }
  hideModelMenu()
}

const handleDuplicateModel = async () => {
  if (contextMenuModel.value && selectedPlatform.value) {
    const duplicatedModel = {
      ...contextMenuModel.value,
      displayName: `${contextMenuModel.value.displayName} (副本)`,
      id: `model_${Date.now()}`,
      name: `model_${Date.now()}`
    }
    await addModel(selectedPlatform.value.id, duplicatedModel)
  }
  hideModelMenu()
}

const handleTestModel = async () => {
  if (contextMenuModel.value) {
    await testModel(contextMenuModel.value)
  }
  hideModelMenu()
}

const handleDeleteModel = async () => {
  if (contextMenuModel.value) {
    deleteModelName.value = contextMenuModel.value.displayName || contextMenuModel.value.name
    deleteModelId.value = contextMenuModel.value.id
    showDeleteModelDialog.value = true
  }
  hideModelMenu()
}

const toggleApiKeyVisibility = () => {
  showApiKey.value = !showApiKey.value
}

const updatePlatformApiKey = async () => {
  if (selectedPlatform.value) {
    try {
      await updatePlatform(selectedPlatform.value.id, {
        apiKey: selectedPlatform.value.apiKey
      })
    } catch (error) {
      console.error('更新API Key失败:', error)
    }
  }
}

const updatePlatformEnabled = async () => {
  if (selectedPlatform.value) {
    try {
      await updatePlatform(selectedPlatform.value.id, {
        enabled: selectedPlatform.value.enabled
      })
    } catch (error) {
      console.error('更新平台启用状态失败:', error)
    }
  }
}

const updatePlatformBaseUrl = async () => {
  if (selectedPlatform.value) {
    try {
      await updatePlatform(selectedPlatform.value.id, {
        baseUrl: selectedPlatform.value.baseUrl
      })
    } catch (error) {
      console.error('更新Base URL失败:', error)
    }
  }
}

const addNewModel = () => {
  if (selectedPlatform.value) {
    editingModel.value = null
    showModelConfigDialog.value = true
  }
}

const editModel = (model: AIModel) => {
  editingModel.value = { ...model }
  showModelConfigDialog.value = true
}

const closeModelDialog = () => {
  showModelConfigDialog.value = false
  editingModel.value = null
}

const saveModel = async (modelData: Partial<AIModel>) => {
  if (!selectedPlatform.value) return

  try {
    if (editingModel.value) {
      // 编辑现有模型
      const modelIndex = selectedPlatform.value.models.findIndex(m => m.id === editingModel.value!.id)
      if (modelIndex !== -1) {
        // 更新displayName、jsCode和category字段
        selectedPlatform.value.models[modelIndex].displayName = modelData.displayName!
        selectedPlatform.value.models[modelIndex].jsCode = modelData.jsCode
        selectedPlatform.value.models[modelIndex].category = modelData.category!
        
        if (selectedModel.value?.id === editingModel.value.id) {
          selectedModel.value = selectedPlatform.value.models[modelIndex]
        }
      }
    } else {
      // 添加新模型
      const newModel: AIModel = {
        id: `model_${Date.now()}`,
        name: `model_${Date.now()}`,
        displayName: modelData.displayName!,
        platformId: selectedPlatform.value.id,
        maxTokens: 4096,
        temperature: 0.7,
        topP: 1.0,
        enabled: true,
        jsCode: modelData.jsCode,
        category: modelData.category!
      }
      selectedPlatform.value.models.push(newModel)
      selectedModel.value = newModel
    }
    
    await updatePlatform(selectedPlatform.value.id, selectedPlatform.value)
    closeModelDialog()
  } catch (error) {
    console.error('保存模型失败:', error)
    alert('保存失败，请检查模型配置')
  }
}

const deleteModel = async (modelId: string) => {
  if (selectedPlatform.value) {
    const modelIndex = selectedPlatform.value.models.findIndex(m => m.id === modelId)
    if (modelIndex !== -1) {
      selectedPlatform.value.models.splice(modelIndex, 1)
      if (selectedModel.value?.id === modelId) {
        selectedModel.value = null
      }
      await updatePlatform(selectedPlatform.value.id, selectedPlatform.value)
    }
  }
}

// 确认删除模型
const confirmDeleteModel = async () => {
  if (deleteModelId.value) {
    await deleteModel(deleteModelId.value)
  }
  showDeleteModelDialog.value = false
  deleteModelName.value = ''
  deleteModelId.value = ''
}

// 取消删除模型
const cancelDeleteModel = () => {
  showDeleteModelDialog.value = false
  deleteModelName.value = ''
  deleteModelId.value = ''
}

const openModelConfigDocs = async () => {
  const url = 'https://docs.zerror.cc/docs/local/modelConfig'
  
  if (environmentDetector.isTauriEnvironment) {
    try {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
    } catch (error) {
      console.error('Failed to open URL with Tauri opener:', error)
      // 回退到 window.open
      window.open(url, '_blank')
    }
  } else {
    window.open(url, '_blank')
  }
}

const addModel = async (platformId: string, model: AIModel) => {
  if (selectedPlatform.value && selectedPlatform.value.id === platformId) {
    selectedPlatform.value.models.push(model)
    await updatePlatform(selectedPlatform.value.id, selectedPlatform.value)
  }
}

// 测试模型功能
const testModel = async (model: AIModel) => {
  if (!selectedPlatform.value) return
  
  // 创建AbortController用于取消请求
  testAbortController.value = new AbortController()
  
  // 显示测试弹窗
  testDialogModelName.value = model.name
  showTestDialog.value = true
  testingModelId.value = model.id
  currentTestResult.value = null
  currentTestError.value = ''
  streamingResponse.value = '' // 重置流式响应
  streamingReasoning.value = '' // 重置流式思考过程
  
  try {
    // 根据模型类型构建不同的测试输入数据
    let testInput
    
    if (model.category === 'vision') {
      // 视觉模型测试：使用图片输入
      // 将图片转换为base64格式
      let imageBase64 = ''
      try {
        // 使用与getPlatformIconUrl相同的环境检测逻辑
        const isTauriEnv = typeof window !== 'undefined' && (window.__TAURI__ || window.__TAURI_INTERNALS__)
        console.log('🔍 [DEBUG] Environment detection for test image - isTauriEnv:', isTauriEnv)
        
        let imageUrl = ''
        
        if (isTauriEnv) {
          // 检查是否在开发环境
          const isDev = import.meta.env.DEV
          console.log('🔍 [DEBUG] import.meta.env.DEV:', isDev)
          
          if (isDev) {
            // 开发环境：使用 Vite 开发服务器路径
            imageUrl = '/src/assets/images/vlm_text/vlm_test.png'
            console.log('✅ [DEBUG] Using development path for test image:', imageUrl)
          } else {
            // 生产环境：使用 frontendDist 管理的静态资源路径
            console.log('🚀 [DEBUG] Production environment detected for test image')
            
            try {
              // 方法1：使用 public 目录中的资源（通过 frontendDist 管理）
              imageUrl = '/assets/images/vlm_text/vlm_test.png'
              console.log('✅ [DEBUG] Using frontendDist managed path for test image:', imageUrl)
            } catch (error) {
              console.error('❌ [DEBUG] frontendDist path failed for test image:', error)
              
              // 方法2：尝试使用 Tauri 资源解析
              try {
                console.log('🔍 [DEBUG] Attempting Tauri resource resolution for test image')
                const { convertFileSrc } = await import('@tauri-apps/api/core')
                const resourcePath = 'assets/images/vlm_text/vlm_test.png'
                imageUrl = convertFileSrc(resourcePath)
                console.log('✅ [DEBUG] Tauri converted URL for test image:', imageUrl)
              } catch (tauriError) {
                console.error('❌ [DEBUG] Tauri resource resolution failed for test image:', tauriError)
                
                // 方法3：回退到相对路径
                imageUrl = '/assets/images/vlm_text/vlm_test.png'
                console.log('⚠️ [DEBUG] Using fallback path for test image:', imageUrl)
              }
            }
          }
        } else {
          // 在浏览器环境中使用 public 目录路径
          imageUrl = '/assets/images/vlm_text/vlm_test.png'
          console.log('🌐 [DEBUG] Using browser path for test image:', imageUrl)
        }
        
        // 使用确定的URL获取图片
        const response = await fetch(imageUrl)
        if (!response.ok) {
          throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`)
        }
        
        const blob = await response.blob()
        
        // 转换为base64
        const reader = new FileReader()
        imageBase64 = await new Promise((resolve, reject) => {
          reader.onload = () => resolve(reader.result as string)
          reader.onerror = reject
          reader.readAsDataURL(blob)
        })
        
        console.log('✅ 成功加载测试图片，base64长度:', imageBase64.length)
      } catch (error) {
        console.error('图片转换失败:', error)
        // 使用备用的简单测试图片
        const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU77zgAAAABJRU5ErkJggg=='
        imageBase64 = `data:image/png;base64,${testImageBase64}`
        console.log('⚠️ 使用备用测试图片')
      }
      
      testInput = {
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image_url',
                image_url: {
                  url: imageBase64,
                  detail: 'low'
                }
              },
              {
                type: 'text',
                text: '请解答题目中的问题'
              }
            ]
          }
        ],
        model: model.id,
        stream: true
      }
    } else {
      // 文本模型测试：使用纯文本输入
      testInput = {
        messages: [
          {
            role: 'user',
            content: '你好，这是一个测试消息，请简单回复确认收到。'
          }
        ],
        model: model.id,
        stream: true
      }
    }
    
    // 构建配置对象
    const config = {
      apiKey: selectedPlatform.value.apiKey,
      baseUrl: selectedPlatform.value.baseUrl,
      model: model.id,
      ...model
    }
    
    // 动态导入Tauri HTTP插件
    let tauriFetch
    try {
      const tauriHttp = await import('@tauri-apps/plugin-http')
      tauriFetch = tauriHttp.fetch
    } catch (importError) {
      console.warn('Tauri HTTP插件不可用，使用浏览器fetch:', importError)
      tauriFetch = fetch
    }
    
    // 执行JavaScript配置代码
    if (model.jsCode) {
      try {
        // 创建一个安全的执行环境
        let executableCode = model.jsCode.trim()
        let processModel
        
        if (executableCode.startsWith('async function') || executableCode.startsWith('function')) {
          // 如果是完整的函数声明，使用eval在安全环境中执行
          const safeEval = new Function('input', 'config', 'fetch', 'abortSignal', `
            ${executableCode}
            return processModel;
          `)
          processModel = safeEval(testInput, config, tauriFetch, testAbortController.value?.signal)
        } else {
          // 如果是函数体，包装为async函数
          const wrapperFunction = new Function('input', 'config', 'fetch', 'abortSignal', `
            return (async function processModel(input, config) {
              ${executableCode}
            });
          `)
          processModel = wrapperFunction(testInput, config, tauriFetch, testAbortController.value?.signal)
        }
        
        // 执行测试
        const result = await processModel(testInput, config)
        
        if (result) {
          // 如果返回的是生成器或异步迭代器，收集结果
          if (result[Symbol.asyncIterator]) {
            let fullResponse = ''
            let fullReasoning = ''
            streamingResponse.value = '' // 重置流式响应
            streamingReasoning.value = '' // 重置流式思考过程

            for await (const chunk of result) {
              if (chunk.content) {
                fullResponse += chunk.content
                streamingResponse.value = fullResponse // 实时更新流式响应
              }
              // 兼容新的思考过程字段
              if (chunk.reasoning_content) {
                fullReasoning += chunk.reasoning_content
                streamingReasoning.value = fullReasoning // 实时更新流式思考过程
              }
            }

            currentTestResult.value = {
              success: true,
              response: fullResponse,
              reasoning_content: fullReasoning,
              timestamp: new Date().toLocaleString(),
              modelType: model.category,
              testType: model.category === 'vision' ? '图像理解测试' : '文本对话测试'
            }
          } else {
            // 非流式返回：兼容对象格式与字符串格式
            let finalResponse = ''
            let finalReasoning = ''
            if (typeof result === 'string') {
              finalResponse = result
            } else if (result && typeof result === 'object') {
              finalResponse = (result.content ?? result.response ?? '')
              // 兼容新的思考过程字段
              finalReasoning = (result.reasoning_content ?? '')
            }

            currentTestResult.value = {
              success: true,
              response: finalResponse,
              reasoning_content: finalReasoning,
              timestamp: new Date().toLocaleString(),
              modelType: model.category,
              testType: model.category === 'vision' ? '图像理解测试' : '文本对话测试'
            }
          }
        } else {
          currentTestError.value = '模型配置代码未返回有效结果'
        }
      } catch (codeError) {
        console.error('执行模型配置代码失败:', codeError)
        currentTestError.value = `代码执行错误: ${codeError.message}`
      }
    } else {
      currentTestError.value = '模型未配置JavaScript代码'
    }
  } catch (error) {
    console.error('测试模型失败:', error)
    currentTestError.value = `测试失败: ${error.message}`
  } finally {
    testingModelId.value = null
    testAbortController.value = null
    // 测试完成后，如果有错误则清空流式响应
  if (currentTestError.value) {
    streamingResponse.value = ''
    streamingReasoning.value = ''
  }
}
}

// 处理测试弹窗关闭
const handleCloseTestDialog = () => {
  showTestDialog.value = false
}

// 处理取消测试
const handleCancelTest = () => {
  if (testAbortController.value) {
    testAbortController.value.abort()
    currentTestError.value = '测试已被用户取消'
    streamingResponse.value = ''
  }
}

onMounted(() => {
  // 添加全局点击事件监听，用于隐藏右键菜单
  document.addEventListener('click', hidePlatformMenu)
  document.addEventListener('click', hideModelMenu)
  
  // 预加载平台图标
  loadPlatformIcons()
})

// 监听全局模型选择变化，同步本地状态
watch(globalSelectedTextModel, (newModel) => {
  console.log('🔄 [DEBUG] globalSelectedTextModel changed to:', newModel?.displayName || 'null')
  currentTextModel.value = newModel
}, { immediate: true })

watch(globalSelectedVisionModel, (newModel) => {
  console.log('🔄 [DEBUG] globalSelectedVisionModel changed to:', newModel?.displayName || 'null')
  currentVisionModel.value = newModel
}, { immediate: true })

// 初始化本地状态
onMounted(() => {
  console.log('🚀 [DEBUG] ModelSettings mounted, initializing local state')
  currentTextModel.value = globalSelectedTextModel.value
  currentVisionModel.value = globalSelectedVisionModel.value
  console.log('📊 [DEBUG] Initial state - Text:', currentTextModel.value?.displayName, 'Vision:', currentVisionModel.value?.displayName)
})

// 监听平台数据变化，重新加载图标
watch(() => modelConfig.platforms, (newPlatforms, oldPlatforms) => {
  // 检查是否有平台的图标发生了变化
  if (oldPlatforms) {
    for (const newPlatform of newPlatforms) {
      const oldPlatform = oldPlatforms.find(p => p.id === newPlatform.id)
      if (oldPlatform && oldPlatform.icon !== newPlatform.icon) {
        // 图标发生了变化，清除缓存并重新加载
        delete platformIconUrls.value[newPlatform.id]
        delete iconLoadErrors.value[newPlatform.id]
        
        if (newPlatform.icon && newPlatform.icon.includes('.')) {
          getPlatformIconUrl(newPlatform.icon).then(url => {
            platformIconUrls.value[newPlatform.id] = url
          }).catch(error => {
            console.error(`Failed to reload icon for platform ${newPlatform.id}:`, error)
            iconLoadErrors.value[newPlatform.id] = true
          })
        }
      }
    }
  }
}, { deep: true })

onUnmounted(() => {
  // 移除全局点击事件监听
  document.removeEventListener('click', hidePlatformMenu)
  document.removeEventListener('click', hideModelMenu)
})
</script>

<style scoped>
/* 模型设置布局样式 */
.model-settings-container {
  background-color: var(--bg-primary, #f4f4f4);
  gap: 4px;
  display: flex;
  height: 100%;
}

.platform-sidebar {
  width: 300px;
  background: var(--bg-secondary, #ffffff);
  border-radius: 5px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  padding: 16px;
  border-bottom: 1px solid var(--border-primary, #e2e8f0);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sidebar-title {
  font-size: 16px;
  font-weight: 500;
  color: var(--text-primary, #2d3748);
  margin: 0;
}

.platform-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.platform-item {
  display: flex;
  align-items: center;
  padding: 12px;
  margin-bottom: 4px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 1px solid var(--platform-item-border);
  background-color: var(--platform-item-bg);
  color: var(--platform-item-text);
}

.platform-item:hover {
  background-color: var(--platform-item-hover-bg);
  border-color: var(--platform-item-hover-border);
  color: var(--platform-item-hover-text);
}

.platform-item.active {
  background-color: var(--platform-item-active-bg);
  border-color: var(--platform-item-active-border);
  color: var(--platform-item-active-text);
}

.platform-icon {
  width: 32px;
  height: 32px;
  margin-right: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  background-color: var(--platform-item-icon-bg);
  flex-shrink: 0;
  transition: background-color 0.2s ease;
}

.platform-item:hover .platform-icon {
  background-color: var(--platform-item-icon-hover-bg);
}

.platform-item.active .platform-icon {
  background-color: var(--platform-item-icon-active-bg);
}

.icon-emoji {
  font-size: 18px;
}

.icon-image {
  border-radius: 4px;
  width: 24px;
  height: 24px;
  object-fit: contain;
}

.icon-fallback {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #718096);
}

.platform-info {
  flex: 1;
  min-width: 0;
}

.platform-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #2d3748);
  margin: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.platform-detail {
  flex: 1;
  border-radius: 5px;
  background: var(--platform-detail-bg);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.detail-content {
  padding: 24px;
  overflow-y: auto;
  flex: 1;
  background: var(--platform-detail-content-bg);
}

.detail-section {
  margin-bottom: 32px;
}

.detail-section:last-child {
  margin-bottom: 0;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.subsection-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--platform-detail-header-text);
  margin: 0 0 16px 0;
}

.platform-description {
  color: var(--platform-detail-description-text);
  margin: 8px 0 0 0;
  line-height: 1.5;
}

/* 表单样式 */
.form-group {
  margin-bottom: 16px;
}

.form-label {
  display: block;
  font-size: 14px;
  font-weight: 500;
  color: var(--platform-detail-form-label-text);
  margin-bottom: 6px;
}

.form-input {
  box-sizing: border-box;
  width: 100%;
  padding: 8px 12px;
  border: 1px solid var(--platform-detail-form-input-border);
  border-radius: 6px;
  font-size: 14px;
  transition: border-color 0.2s ease;
  background-color: var(--platform-detail-form-input-bg);
  color: var(--platform-detail-form-input-text);
}

.form-tip {
  margin-top: 6px;
}

.api-doc-link {
  font-size: 12px;
  color: var(--text-accent, #3182ce);
  text-decoration: none;
}

.api-doc-link:hover {
  color: var(--text-accent-hover, #ffbf84);
}

.form-input:focus {
  outline: none;
  border-color: var(--platform-detail-form-input-focus-border);
  box-shadow: 0 0 0 3px var(--shadow-focus, rgba(49, 130, 206, 0.1));
}

.input-group {
  position: relative;
}

.input-with-suffix {
  position: relative;
  display: flex;
  align-items: center;
}

.api-key-input {
  padding-right: 40px;
}

input[type="password"].api-key-input::-webkit-toggle-password {
  -webkit-appearance: none!important;
  display: none!important;
}
input[type="password"].api-key-input::-moz-ui-password {
  -moz-appearance: none!important;
  display: none!important;
}
input[type="password"].api-key-input::-ms-reveal {
  display: none!important;
}

.input-suffix-btn {
  position: absolute;
  right: 8px;
  background: none;
  border: none;
  cursor: pointer;
  padding: 4px;
  color: var(--text-secondary, #718096);
  transition: color 0.2s ease;
}

.input-suffix-btn:hover {
  color: var(--text-primary, #2d3748);
}

/* 模型列表样式 */
.model-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.model-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px;
  border: 1px solid var(--model-item-border);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: var(--model-item-bg);
  color: var(--model-item-text);
}

.model-item:hover {
  background-color: var(--model-item-hover-bg);
  border-color: var(--model-item-hover-border);
  color: var(--model-item-hover-text);
}

.model-item.active {
  background-color: var(--model-item-active-bg);
  border-color: var(--model-item-active-border);
  color: var(--model-item-active-text);
}

.model-info {
  flex: 1;
}

.model-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--model-item-name-text);
  margin: 0;
}

.model-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-selected {
  color: var(--text-success, #38a169);
}

/* 空状态样式 */
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  text-align: center;
  padding: 40px;
}

.empty-icon {
  margin-bottom: 16px;
  color: var(--text-secondary, #a0aec0);
}

.empty-state h3 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
  margin: 0 0 8px 0;
}

.empty-state p {
  color: var(--text-secondary, #718096);
  margin: 0;
}

/* 按钮样式 */
.btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  text-decoration: none;
}

.btn-small {
  padding: 6px 12px;
  font-size: 12px;
}

.btn-primary {
  background-color: var(--btn-primary, #3182ce);
  color: white;
}

.btn-primary:hover {
  background-color: var(--btn-primary-hover, #2c5aa0);
}

.header-actions{
  display: flex;
  gap: 10px;
}


</style>