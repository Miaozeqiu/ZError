import { usesSharedDeepSeekKey } from './configKeyPolicy'


import { DEFAULT_MODEL_OUTPUT_TOKENS } from './contextBudget'
import type { AIModel, AIPlatform, ModelSettings } from './configTypes'
import { inferPlatformApiProtocol, isBuiltinApiProtocol, modelHasVision, resolveRemoteHasVision } from './configTypes'
import { dedupeModelsById, dedupeRemotePlatforms, fetchRemoteModelsCatalog, getPlatformApiKey, isLikelyUserCreatedModel } from './configRemote'

function sortPlatformsByRemoteOrder(platforms: AIPlatform[], remotePlatforms: AIPlatform[]) {
    const remoteOrder = new Map(remotePlatforms.map((platform, index) => [platform.id, index]))

    return [...platforms].sort((a, b) => {
      const aIndex = remoteOrder.get(a.id)
      const bIndex = remoteOrder.get(b.id)
      const aIsRemote = aIndex !== undefined
      const bIsRemote = bIndex !== undefined

      if (aIsRemote && bIsRemote) return aIndex - bIndex
      if (aIsRemote) return -1
      if (bIsRemote) return 1
      return 0
    })
  }

function sortModelsByRemoteOrder(models: AIModel[], remoteModels: AIModel[]) {
    const remoteOrder = new Map(remoteModels.map((model, index) => [model.id, index]))

    return [...models].sort((a, b) => {
      const aIndex = remoteOrder.get(a.id)
      const bIndex = remoteOrder.get(b.id)
      const aIsRemote = aIndex !== undefined
      const bIsRemote = bIndex !== undefined

      if (aIsRemote && bIsRemote) return aIndex - bIndex
      if (aIsRemote) return -1
      if (bIsRemote) return 1
      return 0
    })
  }

function findLocalPlatformWithSameRemoteModelId(settings: ModelSettings, remotePlatform: AIPlatform) {
    const remoteModelIds = new Set((remotePlatform.models || []).map(model => model.id).filter(Boolean))
    if (!remoteModelIds.size) return undefined

    return settings.platforms
      .filter(platform => !platform.isRemote && platform.apiKey?.trim())
      .map(platform => ({
        platform,
        matchedModelCount: (platform.models || []).reduce(
          (count, model) => count + (remoteModelIds.has(model.id) ? 1 : 0),
          0
        ),
      }))
      .filter(item => item.matchedModelCount > 0)
      .sort((a, b) => b.matchedModelCount - a.matchedModelCount)[0]?.platform
  }

export type RemoteCatalogContext = {
 settings: ModelSettings
 ready: Promise<void>
 replaceSelectedModel: (modelId: string, platformId: string, candidates?: AIModel[]) => void
 normalizeSelectedModels: () => void
}
export async function synchronizeRemoteCatalog(context: RemoteCatalogContext): Promise<boolean> {
 const settings = context.settings
    let remotePlatforms: AIPlatform[] = []
    try {
      const catalog = await fetchRemoteModelsCatalog()
      remotePlatforms = dedupeRemotePlatforms(catalog.platforms)
    } catch (err) {
      console.warn('远程模型同步失败，跳过同步:', err)
      return false
    }

    await context.ready
    const remotePlatformIds = new Set(remotePlatforms.map(p => p.id))
    const existingPlatformsById = settings.platforms.reduce<Map<string, AIPlatform[]>>((map, platform) => {
      const existingPlatforms = map.get(platform.id)
      if (existingPlatforms) {
        existingPlatforms.push(platform)
      } else {
        map.set(platform.id, [platform])
      }
      return map
    }, new Map<string, AIPlatform[]>())

    for (const localPlatform of settings.platforms) {
      if (!localPlatform.isRemote) continue
      if (remotePlatformIds.has(localPlatform.id)) continue

      const userModels = localPlatform.models.filter(model => !model.isRemote && isLikelyUserCreatedModel(model, localPlatform.id))
      if (userModels.length > 0) {
        for (const model of localPlatform.models.filter(model => model.isRemote)) {
          context.replaceSelectedModel(model.id, localPlatform.id)
        }
        localPlatform.isRemote = false
        delete localPlatform.remoteBaseUrl
        delete localPlatform.baseUrlOverride
        delete localPlatform.remoteApiProtocol
        delete localPlatform.apiProtocolOverride
        localPlatform.models = userModels
      } else {
        for (const model of localPlatform.models) {
          context.replaceSelectedModel(model.id, localPlatform.id)
        }
      }
    }

    settings.platforms = settings.platforms.filter(
      platform => !platform.isRemote && platform.name?.trim() && !remotePlatformIds.has(platform.id)
    )

    const newRemotePlatforms: AIPlatform[] = remotePlatforms.map(rp => {
      const existingPlatforms = existingPlatformsById.get(rp.id) || []
      const existing = existingPlatforms.find(platform => platform.isRemote)
        ?? existingPlatforms.find(platform => platform.apiKey?.trim())
        ?? existingPlatforms[0]
      const preservedApiKey = getPlatformApiKey(existingPlatforms, existing)
        || findLocalPlatformWithSameRemoteModelId(settings, rp)?.apiKey
        || ''
      const remoteBaseUrl = rp.baseUrl || ''
      const baseUrlOverride = existing?.baseUrlOverride
      const baseUrl = baseUrlOverride ?? remoteBaseUrl
      const inferredProtocol = inferPlatformApiProtocol(rp)
      const remoteApiProtocol = isBuiltinApiProtocol(inferredProtocol) ? inferredProtocol : 'openai-chat'
      const apiProtocolOverride = existing?.apiProtocolOverride
      const platformProtocol = apiProtocolOverride ?? remoteApiProtocol

      const remoteModels: AIModel[] = (rp.models || []).map(rm => {
        // 自动检测思考模型：根据模型名称/ID 包含关键词时默认开启思考
        const runtimeModelId = (rm.modelId || rm.id || '').toLowerCase()
        const modelIdLower = (rm.id || '').toLowerCase()
        const modelNameLower = (rm.displayName || (rm as { name?: string }).name || '').toLowerCase()
        const thinkingProbe = `${runtimeModelId} ${modelIdLower} ${modelNameLower}`
        const isKnownThinkingModel =
          thinkingProbe.includes('reasoner') ||
          thinkingProbe.includes('-r1') ||
          thinkingProbe.includes('thinking') ||
          thinkingProbe.includes('deepseek-r1') ||
          thinkingProbe.includes('deepseek r1') ||
          runtimeModelId.startsWith('o1') ||
          runtimeModelId.startsWith('o3') ||
          modelIdLower.startsWith('o1') ||
          modelIdLower.startsWith('o3')
        // 保留用户已有的设置，否则按自动检测
        const existingModel = existingPlatforms.flatMap(p => p.models || []).find(m => m.id === rm.id)
        // 远程不再下发/使用 jsCode、pricing；调用只认 modelId（或 id）+ 协议预设
        // 思考开关优先使用本机已保存的值。
        const {
          jsCode: _ignoredRemoteJsCode,
          pricing: _ignoredRemotePricing,
          name: _ignoredRemoteName,
          icon: _ignoredRemoteIcon,
          description: _ignoredRemoteDescription,
          maxTokensOverride: _ignoredOutputOverride,
          ...remoteModelFields
        } = rm as AIModel & { pricing?: unknown; name?: string; maxTokensOverride?: unknown }
        return {
          ...remoteModelFields,
          platformId: rp.id,
          isRemote: true,
          jsCode: undefined,
          displayName: rm.displayName || existingModel?.displayName || (rm as { name?: string }).name || rm.id,
          modelId: rm.modelId?.trim() || rm.id,
          apiProtocol: platformProtocol,
          enabled: rm.enabled ?? true,
          maxTokens: rm.maxTokens ?? DEFAULT_MODEL_OUTPUT_TOKENS,
          contextWindow: Number(rm.contextWindow ?? (rm as any).context_window ?? (rm as any).context_length ?? (rm as any).contextLength) || existingModel?.contextWindow,
          temperature: rm.temperature ?? 0.7,
          topP: rm.topP ?? 0.9,
          category: 'text',
          hasVision: resolveRemoteHasVision(rm as AIModel & Record<string, unknown>),
          enableThinking: typeof existingModel?.enableThinking === 'boolean'
            ? existingModel.enableThinking
            : (rm.enableThinking ?? isKnownThinkingModel),
          thinkingOffEnableThinkingFalse: typeof existingModel?.thinkingOffEnableThinkingFalse === 'boolean'
            ? existingModel.thinkingOffEnableThinkingFalse
            : (rm.thinkingOffEnableThinkingFalse ?? true),
          thinkingOffThinkingTypeDisabled: typeof existingModel?.thinkingOffThinkingTypeDisabled === 'boolean'
            ? existingModel.thinkingOffThinkingTypeDisabled
            : (rm.thinkingOffThinkingTypeDisabled ?? false),
          thinkingOffResponsesEffort: existingModel?.thinkingOffResponsesEffort
            ?? rm.thinkingOffResponsesEffort
            ?? 'minimal',
          thinkingEffort: existingModel?.thinkingEffort ?? rm.thinkingEffort ?? 'medium',
        }
      })
      const localModels = dedupeModelsById(
        existingPlatforms.flatMap(platform => (platform.models || [])
          .filter(model => !model.isRemote && isLikelyUserCreatedModel(model, rp.id))
          .map(model => ({
            ...model,
            platformId: rp.id,
            isRemote: false,
            hasVision: modelHasVision(model),
            category: 'text' as const,
            apiProtocol: platformProtocol,
          })))
      )
      const models = sortModelsByRemoteOrder(dedupeModelsById([...remoteModels, ...localModels]), remoteModels)

      if (existingPlatforms.length > 0) {
        const remoteModelIds = new Set(remoteModels.map(m => m.id))
        for (const oldModel of existingPlatforms.flatMap(platform => (platform.models || []).filter(model => model.isRemote))) {
          if (!remoteModelIds.has(oldModel.id)) {
            context.replaceSelectedModel(oldModel.id, rp.id, models)
          }
        }
      }

      return {
        id: rp.id,
        name: rp.name || rp.displayName || rp.id,
        displayName: rp.displayName || rp.name || rp.id,
        baseUrl,
        remoteBaseUrl,
        baseUrlOverride,
        apiProtocol: platformProtocol,
        remoteApiProtocol,
        apiProtocolOverride,
        description: rp.description,
        icon: rp.icon,
        url: rp.url,
        inviteUrl: String(rp.inviteUrl || '').trim(),
        inviteText: String(rp.inviteText || '').trim(),
        inviteCode: String(rp.inviteCode || '').trim(),
        isRemote: true,
        apiKey: usesSharedDeepSeekKey({ baseUrl, isRemote: true }) ? '' : preservedApiKey,
        enabled: existing?.enabled ?? true,
        customHeaders: existing?.customHeaders,
        models,
      }
    })

    settings.platforms = sortPlatformsByRemoteOrder(
      [...newRemotePlatforms, ...settings.platforms],
      remotePlatforms
    )
    context.normalizeSelectedModels()
    return true
  }
