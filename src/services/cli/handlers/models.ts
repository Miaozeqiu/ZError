import type { AIPlatform, ModelSettings } from '../../model/configTypes'
import type { CliHandler, CliHandlerGroup, CliParams } from '../contracts'
import { requiredText, webUrl } from '../values'

type Mutation = Exclude<keyof CliHandlerGroup<'models'>, 'models.list'>
function mutateModel<M extends Mutation>(mutate: (settings: ModelSettings, p: CliParams<M>) => void): CliHandler<M> {
  return async (p, context) => {
    const { modelConfigManager } = await import('../../model/configManager')
    return modelConfigManager.commit(async draft => { await context.assertActive(); mutate(draft, p) })
  }
}
function platformOf(settings: ModelSettings, id: string): AIPlatform {
  const platform = settings.platforms.find(row => row.id === id)
  if (!platform) throw new Error('供应商不存在')
  return platform
}
function clearSelection(settings: ModelSettings, ids: Set<string>): void {
  for (const key of ['selectedTextModel', 'selectedSummaryModel', 'selectedAgentModel'] as const) if (settings[key] && ids.has(settings[key]!)) settings[key] = null
  settings.selectedTextModels = settings.selectedTextModels?.filter(id => !ids.has(id))
  settings.selectedSummaryModels = settings.selectedSummaryModels?.filter(id => !ids.has(id))
}

export const modelHandlers = {
  'models.list': async () => {
    const { modelConfigManager } = await import('../../model/configManager')
    await modelConfigManager.ready
    return modelConfigManager.getSettings()
  },
  'models.add': mutateModel<'models.add'>((settings, p) => {
    let platform = p.platformId ? platformOf(settings, p.platformId) : undefined
    if (platform?.isRemote) throw new Error('请创建自定义供应商，不能向远程供应商添加模型')
    if (!platform) {
      platform = { id: `custom_${crypto.randomUUID()}`, name: requiredText(p.name, 'name'), displayName: requiredText(p.name, 'name'), baseUrl: webUrl(requiredText(p.baseUrl, 'baseUrl')), apiKey: p.apiKey || '', enabled: true, isRemote: false, apiProtocol: p.protocol || 'openai-chat', models: [] }
      settings.platforms.push(platform)
    }
    const modelId = requiredText(p.model.modelId, 'model.modelId')
    if (platform.models.some(row => row.modelId === modelId)) throw new Error('该供应商已存在此模型')
    platform.models.push({ id: `model_${crypto.randomUUID()}`, modelId, displayName: p.model.displayName || modelId, platformId: platform.id, maxTokens: p.model.maxTokens || 4096, temperature: 0.7, topP: 1, enabled: true, category: 'text', supportsTools: p.model.supportsTools ?? true, hasVision: p.model.hasVision ?? false, isRemote: false })
  }),
  'models.key': mutateModel<'models.key'>((settings, p) => { platformOf(settings, p.platformId).apiKey = p.apiKey }),
  'models.select': mutateModel<'models.select'>((settings, p) => {
    if (p.id !== null) {
      const platform = settings.platforms.find(row => row.models.some(model => model.id === p.id))
      const model = platform?.models.find(row => row.id === p.id)
      if (!platform || !model) throw new Error('模型不存在')
      if (!platform.enabled || !model.enabled) throw new Error('模型或供应商已禁用')
    }
    if (p.role === 'agent') settings.selectedAgentModel = p.id
    if (p.role === 'answer') { settings.selectedTextModel = p.id; settings.selectedTextModels = p.id ? [p.id] : [] }
    if (p.role === 'summary') { settings.selectedSummaryModel = p.id; settings.selectedSummaryModels = p.id ? [p.id] : [] }
  }),
  'models.remove': mutateModel<'models.remove'>((settings, p) => {
    const platform = settings.platforms.find(row => row.models.some(model => model.id === p.id))
    const model = platform?.models.find(row => row.id === p.id)
    if (!platform || !model) throw new Error('模型不存在')
    if (model.isRemote || platform.isRemote) throw new Error('不能删除远程模型')
    platform.models = platform.models.filter(row => row.id !== p.id)
    clearSelection(settings, new Set([p.id]))
  }),
  'models.platform_remove': mutateModel<'models.platform_remove'>((settings, p) => {
    const platform = platformOf(settings, p.platformId)
    if (platform.isRemote) throw new Error('不能删除远程供应商')
    settings.platforms = settings.platforms.filter(row => row.id !== p.platformId)
    clearSelection(settings, new Set(platform.models.map(model => model.id)))
  }),
} satisfies CliHandlerGroup<'models'>
