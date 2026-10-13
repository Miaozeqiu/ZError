/** 平台 / 模型增删改、右键菜单、协议下拉。测连通和图标不要写回这里。 */
import { computed, nextTick, ref } from 'vue'
import type { AIModel, AIPlatform, ApiProtocol } from '../../../services/model/config'
import { environmentDetector } from '../../../services/app/environmentDetector'
import { claimExclusiveMenu, useExclusiveMenu } from '../../../composables/useExclusiveMenu'
import type { ModelConfigApi } from './types'
import type { ModelSettingsState } from './state'
import type { bindSettingsScroll } from './scroll'
import type { bindModelTest } from './testModel'
import type { bindModelIcons } from './icons'

export type PlatformOpsCtx = {
  state: ModelSettingsState
  config: ModelConfigApi
  scroll: ReturnType<typeof bindSettingsScroll>
  test: ReturnType<typeof bindModelTest>
  icons: ReturnType<typeof bindModelIcons>
}

export const bindPlatformOps = (ctx: PlatformOpsCtx) => {
  const {
    showAddPlatformDialog,
    showEditPlatformDialog,
    editingPlatform,
    showModelConfigDialog,
    editingModel,
    selectedPlatform,
    selectedModel,
    selectedCategory,
    isSelectedPlatformDisabled,
    isVisionUnavailable,
    showTestDialog,
    testDialogModelName,
    testingModelId,
    currentTestResult,
    currentTestError,
    streamingResponse,
    streamingReasoning,
    showDeleteModelDialog,
    deleteModelName,
    deleteModelId,
    showDeletePlatformDialog,
    deletePlatformName,
    deletePlatformId,
    iconLoadErrors,
    platformIconUrls,
    showPlatformContextMenu,
    contextMenuX,
    contextMenuY,
    contextMenuPlatform,
    showModelContextMenu,
    modelContextMenuX,
    modelContextMenuY,
    contextMenuModel,
    modelToTest,
    showApiKey,
  } = ctx.state

  const {
    settings: modelConfig,
    addPlatform,
    updatePlatform,
    removePlatform,
    addModelToPlatform,
    updateModel,
    removeModel,
    toggleSelectedTextModel,
    toggleSelectedSummaryModel,
    toggleSelectedVisionModel,
    toggleSelectedAgentModel,
  } = ctx.config

  const { updateScrollbarThumb, detailContent } = ctx.scroll
  const { testModel } = ctx.test
  const { getPlatformIconUrl } = ctx.icons

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

  const revealModelInList = async (
    platformId: string,
    modelId: string,
    category: 'summary' | 'text' | 'vision' | 'agent'
  ) => {
    const latestPlatform = modelConfig.platforms.find(platform => platform.id === platformId)
    if (latestPlatform) {
      selectedPlatform.value = latestPlatform
      selectedModel.value = latestPlatform.models.find(model => model.id === modelId) || null
    }

    selectedCategory.value = category

    await nextTick()
    updateScrollbarThumb()

    const modelElements = Array.from(detailContent.value?.querySelectorAll('.model-item[data-model-id]') || []) as HTMLElement[]
    const targetElement = modelElements.find(element => element.dataset.modelId === modelId)
    targetElement?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }

  const selectModel = (model: AIModel) => {
    if (isSelectedPlatformDisabled.value || isVisionUnavailable(model)) {
      return
    }

    if (selectedCategory.value === 'text') {
      toggleSelectedTextModel(model.id)
    } else if (selectedCategory.value === 'summary') {
      toggleSelectedSummaryModel(model.id)
    } else if (selectedCategory.value === 'vision') {
      toggleSelectedVisionModel(model.id)
      // currentVisionModel 由 watch(globalSelectedVisionModel) 同步
    } else if (selectedCategory.value === 'agent') {
      toggleSelectedAgentModel(model.id)
    }
  }

  const showPlatformMenu = (event: MouseEvent, platform: AIPlatform) => {
    event.preventDefault()
    claimExclusiveMenu('platform-context-menu')
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
    claimExclusiveMenu('model-context-menu')
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

  const handleDeletePlatform = async () => {
    if (contextMenuPlatform.value && !contextMenuPlatform.value.isRemote) {
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

  const handleTestModel = async (payload?: { testFunctionCalling: boolean }) => {
    if (contextMenuModel.value) {
      modelToTest.value = contextMenuModel.value
      testDialogModelName.value = contextMenuModel.value.displayName || contextMenuModel.value.id
      showTestDialog.value = true
      testingModelId.value = null // 不自动开始测试，等待用户点击
      currentTestResult.value = null
      currentTestError.value = ''
      streamingResponse.value = ''
      streamingReasoning.value = ''
      // 延迟执行以确保弹窗打开后再触发自动测试
      await nextTick()
      testModel(contextMenuModel.value, payload?.testFunctionCalling ?? false)
    }
    hideModelMenu()
  }

  const handleStartTest = async ({ testFunctionCalling }: { testFunctionCalling: boolean }) => {
    if (modelToTest.value) {
      await testModel(modelToTest.value, testFunctionCalling)
    }
  }

  const handleDeleteModel = async () => {
    if (contextMenuModel.value && !contextMenuModel.value.isRemote) {
      deleteModelName.value = contextMenuModel.value.displayName || contextMenuModel.value.id
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

  const platformProtocolOptions = computed(() => {
    const options: { value: ApiProtocol; label: string; endpoint: string }[] = [
      { value: 'openai-chat', label: 'Chat', endpoint: '/chat/completions' },
      { value: 'openai-response', label: 'Responses', endpoint: '/responses' },
      { value: 'anthropic', label: 'Messages', endpoint: '/v1/messages' },
    ]
    if (!selectedPlatform.value?.isRemote) {
      options.push({ value: 'custom', label: '自定义', endpoint: '自定义' })
    }
    return options
  })

  const currentPlatformProtocolPath = computed(() => {
    const value = selectedPlatform.value?.apiProtocol || 'openai-chat'
    return platformProtocolOptions.value.find((opt) => opt.value === value)?.endpoint || '/chat/completions'
  })

  const showPlatformProtocolDropdown = ref(false)
  const platformProtocolTriggerRef = ref<HTMLElement | null>(null)
  const platformProtocolDropdownRef = ref<HTMLElement | null>(null)
  const platformProtocolDropdownStyle = ref<Record<string, string>>({})
  useExclusiveMenu('model-settings-platform-protocol', showPlatformProtocolDropdown)

  const updatePlatformProtocolDropdownPosition = () => {
    if (!platformProtocolTriggerRef.value) return
    const triggerRect = platformProtocolTriggerRef.value.getBoundingClientRect()
    const dropdownWidth = Math.max(triggerRect.width, 220)
    const estimatedHeight = platformProtocolDropdownRef.value?.getBoundingClientRect().height || 168
    const spaceBelow = window.innerHeight - triggerRect.bottom
    const showAbove = spaceBelow < estimatedHeight + 12 && triggerRect.top > estimatedHeight + 12

    platformProtocolDropdownStyle.value = {
      position: 'fixed',
      left: `${Math.max(8, Math.min(triggerRect.right - dropdownWidth, window.innerWidth - dropdownWidth - 8))}px`,
      top: showAbove ? `${Math.max(8, triggerRect.top - estimatedHeight - 6)}px` : `${triggerRect.bottom + 6}px`,
      width: `${dropdownWidth}px`,
      zIndex: '2000',
    }
  }

  const closePlatformProtocolDropdown = () => {
    showPlatformProtocolDropdown.value = false
  }

  const togglePlatformProtocolDropdown = async () => {
    if (selectedPlatform.value?.isRemote) return
    showPlatformProtocolDropdown.value = !showPlatformProtocolDropdown.value
    if (showPlatformProtocolDropdown.value) {
      await nextTick()
      updatePlatformProtocolDropdownPosition()
    }
  }

  const selectPlatformProtocol = async (protocol: ApiProtocol) => {
    closePlatformProtocolDropdown()
    await updatePlatformApiProtocol(protocol)
  }

  const handlePlatformProtocolOutsideClick = (event: Event) => {
    if (!showPlatformProtocolDropdown.value) return
    const target = event.target as Node | null
    if (
      target &&
      (
        platformProtocolTriggerRef.value?.contains(target) ||
        platformProtocolDropdownRef.value?.contains(target)
      )
    ) {
      return
    }
    closePlatformProtocolDropdown()
  }

  const updatePlatformApiProtocol = async (protocol: ApiProtocol) => {
    if (!selectedPlatform.value || selectedPlatform.value.isRemote) return
    try {
      selectedPlatform.value.apiProtocol = protocol
      await updatePlatform(selectedPlatform.value.id, { apiProtocol: protocol })
    } catch (error) {
      console.error('更新平台协议失败:', error)
    }
  }

  // -------- 添加模型下拉 --------
  const showAddModelDropdown = ref(false)
  useExclusiveMenu('model-settings-add-model', showAddModelDropdown)
  const addModelDropdownRef = ref<HTMLElement | null>(null)

  const openAddModelDropdown = () => {
    showAddModelDropdown.value = !showAddModelDropdown.value
  }

  const closeAddModelDropdown = () => {
    showAddModelDropdown.value = false
  }

  const openTemplate = () => {
    closeAddModelDropdown()
    addNewModel()
  }

  const openQuickAdd = () => {
    closeAddModelDropdown()
    addNewModel()
  }


  // 点击外部关闭下拉
  const handleAddModelOutsideClick = (e: MouseEvent) => {
    if (addModelDropdownRef.value && !addModelDropdownRef.value.contains(e.target as Node)) {
      closeAddModelDropdown()
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
  }

  const onModelConfigAfterLeave = () => {
    if (!showModelConfigDialog.value) {
      editingModel.value = null
    }
  }

  const saveModel = async (modelData: Partial<AIModel>) => {
    if (!selectedPlatform.value) return

    try {
      const platformId = selectedPlatform.value.id
      let newModelId: string | null = null
      let revealCategory: 'summary' | 'text' | 'vision' | 'agent' | null = null

      if (editingModel.value) {
        // 远程模型只允许改本机思考开关，名称 / id / 协议仍跟远控
        if (editingModel.value.isRemote) {
          await updateModel(editingModel.value.id, {
            enableThinking: modelData.enableThinking,
            thinkingOffEnableThinkingFalse: modelData.thinkingOffEnableThinkingFalse,
            thinkingOffThinkingTypeDisabled: modelData.thinkingOffThinkingTypeDisabled,
            thinkingOffResponsesEffort: modelData.thinkingOffResponsesEffort,
            thinkingEffort: modelData.thinkingEffort,
          })
          closeModelDialog()
          return
        }
        // 使用 ModelConfigManager 的 updateModel 以确保正确保存
        await updateModel(editingModel.value.id, {
          displayName: modelData.displayName,
          modelId: modelData.modelId,
          jsCode: modelData.jsCode,
          category: 'text',
          hasVision: modelData.hasVision === true,
          enableThinking: modelData.enableThinking,
          thinkingOffEnableThinkingFalse: modelData.thinkingOffEnableThinkingFalse,
          thinkingOffThinkingTypeDisabled: modelData.thinkingOffThinkingTypeDisabled,
          thinkingOffResponsesEffort: modelData.thinkingOffResponsesEffort,
          thinkingEffort: modelData.thinkingEffort,
          apiProtocol: selectedPlatform.value.apiProtocol || modelData.apiProtocol
        })
      } else {
        // 使用 addModelToPlatform 自动生成 ID 并保存
        const newModelData = {
          displayName: modelData.displayName || '新模型',
          maxTokens: 4096,
          temperature: 0.7,
          topP: 1.0,
          enabled: true,
          modelId: modelData.modelId,
          jsCode: modelData.jsCode || '',
          category: 'text' as const,
          hasVision: modelData.hasVision === true,
          enableThinking: modelData.enableThinking ?? false,
          thinkingOffEnableThinkingFalse: modelData.thinkingOffEnableThinkingFalse ?? true,
          thinkingOffThinkingTypeDisabled: modelData.thinkingOffThinkingTypeDisabled ?? false,
          thinkingOffResponsesEffort: modelData.thinkingOffResponsesEffort ?? 'minimal',
          thinkingEffort: modelData.thinkingEffort ?? 'medium',
          apiProtocol: selectedPlatform.value.apiProtocol || modelData.apiProtocol
        }
        newModelId = await addModelToPlatform(platformId, newModelData)
        const stayOnCurrent = selectedCategory.value !== 'vision' || newModelData.hasVision
        revealCategory = stayOnCurrent ? selectedCategory.value : 'text'
      }
    
      closeModelDialog()

      if (newModelId && revealCategory) {
        await revealModelInList(platformId, newModelId, revealCategory)
      }
    } catch (error) {
      console.error('保存模型失败:', error)
      alert('保存失败，请检查模型配置')
    }
  }

  const deleteModel = async (modelId: string) => {
    if (selectedPlatform.value) {
      // 使用 ModelConfigManager 的 removeModel 以确保清理选中状态
      await removeModel(modelId)
      if (selectedModel.value?.id === modelId) {
        selectedModel.value = null
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
    await openPlatformUrl(url)
  }

  const openPlatformUrl = async (url: string) => {
    if (environmentDetector.isTauriEnvironment) {
      try {
        const { openUrl } = await import('@tauri-apps/plugin-opener')
        await openUrl(url)
      } catch (error) {
        window.open(url, '_blank')
      }
    } else {
      window.open(url, '_blank')
    }
  }

  const copyTextToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.setAttribute('readonly', 'true')
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      document.body.appendChild(textarea)
      textarea.select()
      document.execCommand('copy')
      document.body.removeChild(textarea)
    }
  }

  const inviteField = (value?: string) => (value || '').trim()

  const platformHasInvite = (platform?: AIPlatform | null) => {
    if (!platform) return false
    return Boolean(
      inviteField(platform.inviteUrl)
      || inviteField(platform.inviteCode)
      || inviteField(platform.inviteText)
    )
  }

  const handleInviteButtonClick = async (platform: AIPlatform) => {
    const inviteCode = inviteField(platform.inviteCode)
    const inviteUrl = inviteField(platform.inviteUrl)

    if (inviteCode) {
      await copyTextToClipboard(inviteCode)
    }

    if (inviteUrl) {
      await openPlatformUrl(inviteUrl)
    }
  }

  const addModel = async (platformId: string, model: AIModel) => {
    if (selectedPlatform.value && selectedPlatform.value.id === platformId) {
      selectedPlatform.value.models.push(model)
      await updatePlatform(selectedPlatform.value.id, selectedPlatform.value)
    }
  }
  return {
    editPlatform,
    deletePlatform,
    confirmDeletePlatform,
    cancelDeletePlatform,
    closePlatformDialog,
    savePlatform,
    selectPlatform,
    revealModelInList,
    selectModel,
    showPlatformMenu,
    hidePlatformMenu,
    showModelContextMenuHandler,
    hideModelMenu,
    handleEditPlatform,
    handleDeletePlatform,
    handleEditModel,
    handleTestModel,
    handleStartTest,
    handleDeleteModel,
    toggleApiKeyVisibility,
    updatePlatformApiKey,
    updatePlatformEnabled,
    updatePlatformBaseUrl,
    platformProtocolOptions,
    currentPlatformProtocolPath,
    showPlatformProtocolDropdown,
    platformProtocolTriggerRef,
    platformProtocolDropdownRef,
    platformProtocolDropdownStyle,
    updatePlatformProtocolDropdownPosition,
    closePlatformProtocolDropdown,
    togglePlatformProtocolDropdown,
    selectPlatformProtocol,
    handlePlatformProtocolOutsideClick,
    updatePlatformApiProtocol,
    showAddModelDropdown,
    addModelDropdownRef,
    openAddModelDropdown,
    closeAddModelDropdown,
    openTemplate,
    openQuickAdd,
    handleAddModelOutsideClick,
    addNewModel,
    editModel,
    closeModelDialog,
    onModelConfigAfterLeave,
    saveModel,
    deleteModel,
    confirmDeleteModel,
    cancelDeleteModel,
    openModelConfigDocs,
    openPlatformUrl,
    copyTextToClipboard,
    inviteField,
    platformHasInvite,
    handleInviteButtonClick,
    addModel,
  }
}
