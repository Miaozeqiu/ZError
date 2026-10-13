/** 模型配置对外入口。类型 configTypes、远程 configRemote、单例 configManager。 */
import { computed } from 'vue'
import { modelConfigManager } from './configManager'
import { modelHasVision } from './configTypes'

export type {
  AIModel,
  AIPlatform,
  ApiProtocol,
  ModelSettings,
  RemoteModelIconMapping,
  RemoteModelsCatalog,
  ThinkingEffort,
  ThinkingOffResponsesEffort,
} from './configTypes'
export {
  inferPlatformApiProtocol,
  modelHasVision,
  resolveModelApiProtocol,
  resolveRemoteHasVision,
} from './configTypes'
export { fetchRemoteModelsCatalog, normalizeRemoteModelsCatalog } from './configRemote'
export { modelConfigManager } from './configManager'
export type { ModelConfigManager } from './configManager'

export const hasUsableVisionModel = (): boolean => {
  const vision = modelConfigManager.getSelectedVisionModel()
  if (vision && modelHasVision(vision)) return true
  const agent = modelConfigManager.getSelectedAgentModel()
  if (agent && modelHasVision(agent)) return true
  return false
}

export function useModelConfig() {
  const settings = modelConfigManager.getSettings()

  return {
    settings,
    platforms: computed(() => modelConfigManager.getPlatforms()),
    selectedModel: computed(() => modelConfigManager.getSelectedModel()),
    selectedTextModel: computed(() => modelConfigManager.getSelectedTextModel()),
    selectedTextModels: computed(() => modelConfigManager.getSelectedTextModels()),
    selectedSummaryModel: computed(() => modelConfigManager.getSelectedSummaryModel()),
    selectedSummaryModels: computed(() => modelConfigManager.getSelectedSummaryModels()),
    selectedVisionModel: computed(() => modelConfigManager.getSelectedVisionModel()),
    selectedAgentModel: computed(() => modelConfigManager.getSelectedAgentModel()),
    availableModels: computed(() => modelConfigManager.getAvailableModels()),
    setSelectedModel: modelConfigManager.setSelectedModel.bind(modelConfigManager),
    setSelectedTextModel: modelConfigManager.setSelectedTextModel.bind(modelConfigManager),
    setSelectedSummaryModel: modelConfigManager.setSelectedSummaryModel.bind(modelConfigManager),
    setSelectedVisionModel: modelConfigManager.setSelectedVisionModel.bind(modelConfigManager),
    setSelectedAgentModel: modelConfigManager.setSelectedAgentModel.bind(modelConfigManager),
    toggleSelectedTextModel: modelConfigManager.toggleSelectedTextModel.bind(modelConfigManager),
    toggleSelectedSummaryModel: modelConfigManager.toggleSelectedSummaryModel.bind(modelConfigManager),
    toggleSelectedVisionModel: modelConfigManager.toggleSelectedVisionModel.bind(modelConfigManager),
    toggleSelectedAgentModel: modelConfigManager.toggleSelectedAgentModel.bind(modelConfigManager),
    isTextModelSelected: modelConfigManager.isTextModelSelected.bind(modelConfigManager),
    isSummaryModelSelected: modelConfigManager.isSummaryModelSelected.bind(modelConfigManager),
    isVisionModelSelected: modelConfigManager.isVisionModelSelected.bind(modelConfigManager),
    isAgentModelSelected: modelConfigManager.isAgentModelSelected.bind(modelConfigManager),
    addPlatform: modelConfigManager.addPlatform.bind(modelConfigManager),
    updatePlatform: modelConfigManager.updatePlatform.bind(modelConfigManager),
    removePlatform: modelConfigManager.removePlatform.bind(modelConfigManager),
    addModelToPlatform: modelConfigManager.addModelToPlatform.bind(modelConfigManager),
    updateModel: modelConfigManager.updateModel.bind(modelConfigManager),
    removeModel: modelConfigManager.removeModel.bind(modelConfigManager),
    updateGlobalSettings: modelConfigManager.updateGlobalSettings.bind(modelConfigManager),
    syncRemotePlatforms: modelConfigManager.syncRemotePlatforms.bind(modelConfigManager),
    export: modelConfigManager.export.bind(modelConfigManager),
    import: modelConfigManager.import.bind(modelConfigManager),
    reset: modelConfigManager.reset.bind(modelConfigManager),
    addListener: modelConfigManager.addListener.bind(modelConfigManager),
    removeListener: modelConfigManager.removeListener.bind(modelConfigManager),
  }
}
