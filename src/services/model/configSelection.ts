import type { AIModel, ModelSettings } from './configTypes'
import { modelHasVision } from './configTypes'

export function replaceSelectedModel(settings: ModelSettings, modelId: string, platformId: string, candidateModels?: AIModel[]): void {
    const platformModels = settings.platforms.find(p => p.id === platformId)?.models ?? []
    const pool = candidateModels ?? platformModels
    const findReplacement = (requiresVision = false): AIModel | undefined =>
      pool.find((model) =>
        model.id !== modelId
        && model.enabled !== false
        && (!requiresVision || modelHasVision(model))
      )

    if (settings.selectedTextModels?.includes(modelId)) {
      const removed = platformModels.find(model => model.id === modelId)
      const replacement = findReplacement(modelHasVision(removed)) ?? findReplacement()
      settings.selectedTextModels = settings.selectedTextModels.filter(id => id !== modelId)
      if (replacement && !settings.selectedTextModels.includes(replacement.id)) {
        settings.selectedTextModels.push(replacement.id)
      }
      settings.selectedTextModel = settings.selectedTextModels[0] || null
    }
    if (settings.selectedSummaryModels?.includes(modelId)) {
      const replacement = findReplacement()
      settings.selectedSummaryModels = settings.selectedSummaryModels.filter(id => id !== modelId)
      if (replacement && !settings.selectedSummaryModels.includes(replacement.id)) {
        settings.selectedSummaryModels.push(replacement.id)
      }
      settings.selectedSummaryModel = settings.selectedSummaryModels[0] || null
    }
    if (settings.selectedAgentModel === modelId) {
      settings.selectedAgentModel = findReplacement()?.id || null
    }
  }
