<template>
  <div class="home-page">
    <HomeServerCard
      :server-running="serverRunning"
      :server-url="serverUrl"
      :is-toggling="isToggling"
      :network-open="networkOpen"
      @toggle-server="toggleServer"
      @open-ocs="openOCSConfig"
      @configure-port="configurePort"
      @open-model="openModelSelector"
      @toggle-network="toggleNetworkAccess"
      @open-folder="openFolderPicker"
    />

    <HomeRequestLogs
      :logs="filteredRequestLogs"
      :selected-id="selectedLog?.id"
      @select="showRequestDetails"
      @clear="clearLogs"
    />

    <HomeRequestDetails
      v-if="showLogDetails && selectedLog"
      :log="selectedLog"
      :slide-in="slideInActive"
      @close="closeRequestDetails"
      @retry-url-analysis="analyzeUrlQuestion"
    />

    <!-- 端口配置对话框 -->
    <PortConfigDialog :show="showPortDialog" :current-port="configuredPort" @close="showPortDialog = false"
      @confirm="handlePortConfirm" />

    <!-- 模型选择对话框 -->
    <ModelSelectorDialog :show="showModelSelector" :selected-text-model-ids="globalSelectedTextModels.map(m => m.id)"
      :selected-vision-model-id="globalSelectedVisionModel?.id || null"
      :selected-summary-model-ids="globalSelectedSummaryModels.map(m => m.id)" :available-models="availableModels"
      :platforms="platforms" @close="showModelSelector = false" @model-selected="selectModel" />

    <FolderPickerDialog :visible="showFolderPicker" :initial-folder-id="settings.questionSaveFolderId"
      @cancel="showFolderPicker = false" @confirm="handleFolderConfirm" />

  </div>

  <!-- OCS配置对话框 -->

  <OCSConfigDialog :visible="showOCSConfig" :current-port="configuredPort" @close="showOCSConfig = false"
    @test="testOCSConnection" />

  <ModelWarningDialog :visible="showNoModelDialog" @close="showNoModelDialog = false"
    @still-open="handleNoModelStillOpen" @select-model="handleNoModelSelect" />

  <!-- 后台自动渲染 URL 题目图片已移除，现直接使用原始 URL 渲染 img 标签 -->
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue'
import { useSettings } from '../services/app/settings'
import { useModelConfig } from '../services/model/config'
import { useQuestionServer } from '../services/questionServer'

import PortConfigDialog from './home/PortConfigDialog.vue'
import ModelSelectorDialog from './home/ModelSelectorDialog.vue'
import OCSConfigDialog from './home/OCSConfigDialog.vue'
import HomeServerCard from './home/HomeServerCard.vue'
import HomeRequestLogs from './home/HomeRequestLogs.vue'
import HomeRequestDetails from './home/HomeRequestDetails.vue'
import FolderPickerDialog from '../components/ui/FolderPickerDialog.vue'
import ModelWarningDialog from './home/ModelWarningDialog.vue'

defineEmits(['navigate'])
const props = defineProps<{ collapseTrigger?: number }>()

const { settings, get, set, save } = useSettings()
const {
  availableModels,
  selectedTextModels: globalSelectedTextModels,
  selectedSummaryModels: globalSelectedSummaryModels,
  selectedVisionModel: globalSelectedVisionModel,
  toggleSelectedTextModel,
  toggleSelectedSummaryModel,
  toggleSelectedVisionModel,
  platforms,
} = useModelConfig()

const {
  serverRunning,
  isToggling,
  serverUrl,
  serverPort,
  configuredPort,
  networkOpen,
  filteredRequestLogs,
  selectedLog,
  showLogDetails,
  slideInActive,
  startServer,
  stopServer,
  showRequestDetails,
  closeRequestDetails,
  clearLogs,
  analyzeUrlQuestion,
} = useQuestionServer()

const showPortDialog = ref(false)
const showModelSelector = ref(false)
const showNoModelDialog = ref(false)
const pendingStart = ref(false)
const showOCSConfig = ref(false)
const showFolderPicker = ref(false)

watch(() => props.collapseTrigger, () => {
  if (showLogDetails.value) closeRequestDetails()
})

const toggleServer = async () => {
  if (isToggling.value) return
  if (serverRunning.value) {
    await stopServer()
    return
  }
  if ((!globalSelectedTextModels.value || globalSelectedTextModels.value.length === 0) && !settings.suppressNoModelWarning) {
    pendingStart.value = true
    showNoModelDialog.value = true
    return
  }
  await startServer()
}

const configurePort = () => {
  showPortDialog.value = true
}

const openOCSConfig = () => {
  showOCSConfig.value = true
}

const openModelSelector = () => {
  showModelSelector.value = true
}

const openFolderPicker = () => {
  showFolderPicker.value = true
}

const handleFolderConfirm = async (folderId: number, folderName: string, folderPath: string) => {
  showFolderPicker.value = false
  set('questionSaveDir', folderPath || folderName)
  set('questionSaveFolderId', folderId)
  await save()
}

const handlePortConfirm = async (newPort: number) => {
  const wasRunning = serverRunning.value
  if (wasRunning) await stopServer()
  set('network', {
    ...get('network'),
    serverPort: newPort,
  })
  await save()
  if (wasRunning) await startServer()
  showPortDialog.value = false
}

const toggleNetworkAccess = async () => {
  const newNetworkOpen = !networkOpen.value
  set('network', {
    ...get('network'),
    enableLanAccess: newNetworkOpen,
    bindAddress: newNetworkOpen ? '0.0.0.0' : '127.0.0.1',
  })
  await save()
}

const selectModel = (model: any) => {
  const category = model.category || 'text'
  if (category === 'summary') toggleSelectedSummaryModel(model.id)
  else if (category === 'vision') toggleSelectedVisionModel(model.id)
  else toggleSelectedTextModel(model.id)
}

const testOCSConnection = async () => {
  try {
    const response = await fetch(`http://localhost:${serverPort.value}/query`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!response.ok) console.error('OCS连接测试失败:', response.status)
  } catch (error) {
    console.error('OCS连接测试错误:', error)
  }
}

const handleNoModelStillOpen = (dontRemind: boolean) => {
  if (dontRemind) {
    set('suppressNoModelWarning', true)
    save()
  }
  showNoModelDialog.value = false
  if (pendingStart.value) {
    pendingStart.value = false
    void startServer()
  }
}

const handleNoModelSelect = (dontRemind: boolean) => {
  if (dontRemind) {
    set('suppressNoModelWarning', true)
    save()
  }
  showNoModelDialog.value = false
  showModelSelector.value = true
}

watch(globalSelectedTextModels, (newModels) => {
  if (newModels && newModels.length > 0 && pendingStart.value) {
    pendingStart.value = false
    void startServer()
  }
})

onMounted(() => {
  window.addEventListener('open-ocs-config', openOCSConfig)
})

onUnmounted(() => {
  window.removeEventListener('open-ocs-config', openOCSConfig)
})
</script>

<style scoped>
.home-page {
  background-color: var(--bg-secondary);
  border-radius: 4px;
  height: calc(100% - 5px);
  width: calc(100% - 5px);
  margin: 0 2px 2px 0;
  padding: 20px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
  overflow: hidden;
  padding-bottom: 0px;
}

@media (max-width: 768px) {
  .home-page {
    padding: 16px;
    gap: 16px;
  }
}
</style>
