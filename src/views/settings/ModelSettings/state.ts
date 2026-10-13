/** 模型设置页的 ref 袋。滚动条、测连通、图标、平台操作都改这里的状态。 */
import { computed, ref } from 'vue'
import type { AIModel, AIPlatform, RemoteModelIconMapping } from '../../../services/model/config'
import { modelHasVision } from '../../../services/model/config'
import type { ModelConfigApi } from './types'

export const createModelSettingsState = (config: ModelConfigApi) => {
  const {
    selectedTextModel: globalSelectedTextModel,
    selectedTextModels: globalSelectedTextModels,
    selectedSummaryModel: globalSelectedSummaryModel,
    selectedSummaryModels: globalSelectedSummaryModels,
    selectedVisionModel: globalSelectedVisionModel,
    selectedAgentModel: globalSelectedAgentModel,
    isTextModelSelected,
    isSummaryModelSelected,
    isVisionModelSelected,
    isAgentModelSelected,
  } = config

  const showAddPlatformDialog = ref(false)
  const showEditPlatformDialog = ref(false)
  const editingPlatform = ref<AIPlatform | null>(null)
  const showModelConfigDialog = ref(false)
  const editingModel = ref<AIModel | null>(null)
  const selectedPlatform = ref<AIPlatform | null>(null)
  const selectedModel = ref<AIModel | null>(null)
  const currentVisionModel = ref<AIModel | null>(null)
  const showApiKey = ref(false)
  const selectedCategory = ref<'summary' | 'text' | 'vision' | 'agent'>('text')

  const currentMultiModels = computed(() => {
    if (selectedCategory.value === 'text') return globalSelectedTextModels.value
    if (selectedCategory.value === 'summary') return globalSelectedSummaryModels.value
    return []
  })

  const getPlatformSelectedCount = (platform: AIPlatform): number => {
    if (selectedCategory.value === 'vision') {
      return globalSelectedVisionModel.value?.platformId === platform.id ? 1 : 0
    }
    if (selectedCategory.value === 'agent') {
      return globalSelectedAgentModel.value?.platformId === platform.id ? 1 : 0
    }
    const ids = currentMultiModels.value.map((model) => model.id)
    return platform.models.filter((model) => ids.includes(model.id)).length
  }

  const isPlatformSelectedForCategory = (
    platform: AIPlatform,
    category: 'summary' | 'text' | 'vision' | 'agent',
  ) => {
    if (category === 'text') {
      return globalSelectedTextModels.value.some((model) => model.platformId === platform.id)
    }
    if (category === 'summary') {
      return globalSelectedSummaryModels.value.some((model) => model.platformId === platform.id)
    }
    if (category === 'vision') {
      return globalSelectedVisionModel.value?.platformId === platform.id
    }
    if (category === 'agent') {
      return globalSelectedAgentModel.value?.platformId === platform.id
    }
    return false
  }

  const isCurrentCategoryModelSelected = (model: AIModel) => {
    if (selectedCategory.value === 'vision') return isVisionModelSelected(model.id)
    if (selectedCategory.value === 'summary') return isSummaryModelSelected(model.id)
    if (selectedCategory.value === 'agent') return isAgentModelSelected(model.id)
    return isTextModelSelected(model.id)
  }

  const filteredModels = computed(() => {
    if (!selectedPlatform.value) return []
    return selectedPlatform.value.models || []
  })

  const isVisionUnavailable = (model: AIModel) => (
    selectedCategory.value === 'vision' && !modelHasVision(model)
  )

  const isSelectedPlatformDisabled = computed(() => selectedPlatform.value?.enabled === false)

  const currentModel = computed(() => {
    if (selectedCategory.value === 'text') return globalSelectedTextModel.value
    if (selectedCategory.value === 'summary') return globalSelectedSummaryModel.value
    if (selectedCategory.value === 'agent') return globalSelectedAgentModel.value
    return currentVisionModel.value
  })

  const testingModelId = ref<string | null>(null)
  const testResults = ref<{ [key: string]: any }>({})
  const testErrors = ref<{ [key: string]: string }>({})
  const testAbortController = ref<AbortController | null>(null)
  const showTestDialog = ref(false)
  const testDialogModelName = ref('')
  const currentTestResult = ref<any>(null)
  const currentTestError = ref('')
  const streamingResponse = ref('')
  const streamingReasoning = ref('')
  const showMarkdownDemo = ref(false)

  const showDeleteModelDialog = ref(false)
  const deleteModelName = ref('')
  const deleteModelId = ref('')
  const showDeletePlatformDialog = ref(false)
  const deletePlatformName = ref('')
  const deletePlatformId = ref('')

  const iconLoadErrors = ref<{ [key: string]: boolean }>({})
  const platformIconUrls = ref<Record<string, string>>({})
  const platformIconBackgrounds = ref<Record<string, boolean>>({})
  const remoteModelIconMappings = ref<RemoteModelIconMapping[]>([])

  const showPlatformContextMenu = ref(false)
  const contextMenuX = ref(0)
  const contextMenuY = ref(0)
  const contextMenuPlatform = ref<AIPlatform | null>(null)
  const showModelContextMenu = ref(false)
  const modelContextMenuX = ref(0)
  const modelContextMenuY = ref(0)
  const contextMenuModel = ref<AIModel | null>(null)
  const modelToTest = ref<AIModel | null>(null)

  return {
    showAddPlatformDialog,
    showEditPlatformDialog,
    editingPlatform,
    showModelConfigDialog,
    editingModel,
    selectedPlatform,
    selectedModel,
    currentVisionModel,
    showApiKey,
    selectedCategory,
    currentMultiModels,
    getPlatformSelectedCount,
    isPlatformSelectedForCategory,
    isCurrentCategoryModelSelected,
    filteredModels,
    isVisionUnavailable,
    isSelectedPlatformDisabled,
    currentModel,
    testingModelId,
    testResults,
    testErrors,
    testAbortController,
    showTestDialog,
    testDialogModelName,
    currentTestResult,
    currentTestError,
    streamingResponse,
    streamingReasoning,
    showMarkdownDemo,
    showDeleteModelDialog,
    deleteModelName,
    deleteModelId,
    showDeletePlatformDialog,
    deletePlatformName,
    deletePlatformId,
    iconLoadErrors,
    platformIconUrls,
    platformIconBackgrounds,
    remoteModelIconMappings,
    showPlatformContextMenu,
    contextMenuX,
    contextMenuY,
    contextMenuPlatform,
    showModelContextMenu,
    modelContextMenuX,
    modelContextMenuY,
    contextMenuModel,
    modelToTest,
  }
}

export type ModelSettingsState = ReturnType<typeof createModelSettingsState>
