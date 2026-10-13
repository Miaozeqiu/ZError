/** 远程模型目录：拉取、归一化、和本地缓存合并去重。 */
import type { AIModel, AIPlatform, RemoteModelIconMapping, RemoteModelsCatalog } from './configTypes'
import { inferPlatformApiProtocol, modelHasVision } from './configTypes'

// 远程模型数据 URL（测试版 / 正式版统一）
export const PROD_REMOTE_MODELS_URL = 'https://webapi.zaizhexue.top/live/models.json'
export const TAURI_DEV_REMOTE_MODELS_URL = 'https://webapi.zaizhexue.top/live/models.json'
export const REMOTE_MODELS_REQUEST_COOLDOWN_MS = 30 * 1000
export const USER_CREATED_PLATFORM_ID_PREFIX = 'custom_'
export const LEGACY_USER_CREATED_MODEL_ID_PREFIX = 'model_'

const getRemoteModelsUrls = (): string[] => {
  return [TAURI_DEV_REMOTE_MODELS_URL, PROD_REMOTE_MODELS_URL].filter(
    (url, index, arr) => arr.indexOf(url) === index
  )
}

export const normalizeRemoteModelsCatalog = (json: unknown): RemoteModelsCatalog => {
  const toStringList = (value: unknown): string[] => {
    if (!Array.isArray(value)) return []
    return [...new Set(value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0))]
  }

  const normalizeModelIconMappings = (value: unknown): RemoteModelIconMapping[] => {
    if (Array.isArray(value)) {
      return value
        .map((item) => {
          if (!item || typeof item !== 'object') return null
          const record = item as Record<string, unknown>
          const icon = typeof record.icon === 'string' ? record.icon.trim() : ''
          const models = toStringList(record.models ?? record.keywords ?? record.aliases)
          if (!icon || !models.length) return null
          return { icon, models }
        })
        .filter((item): item is RemoteModelIconMapping => item !== null)
    }

    if (value && typeof value === 'object') {
      return Object.entries(value)
        .map(([icon, modelsValue]) => {
          const normalizedIcon = icon.trim()
          const models = Array.isArray(modelsValue)
            ? toStringList(modelsValue)
            : typeof modelsValue === 'string'
              ? [modelsValue.trim()].filter(Boolean)
              : []

          if (!normalizedIcon || !models.length) return null
          return { icon: normalizedIcon, models }
        })
        .filter((item): item is RemoteModelIconMapping => item !== null)
    }

    return []
  }

  if (Array.isArray(json)) {
    const platforms = json as AIPlatform[]
    const fallbackProvidersList = toStringList(platforms.map(platform => platform.icon))
    return {
      providersList: fallbackProvidersList,
      modelIconMappings: [],
      platforms,
      questionImageAlgorithm: null,
    }
  }

  if (json && typeof json === 'object') {
    const record = json as Record<string, unknown>
    const platforms = Array.isArray(record.platforms) ? record.platforms as AIPlatform[] : []
    const providersList = toStringList(record.providers_list)
    const fallbackProvidersList = toStringList(platforms.map(platform => platform.icon))
    const modelIconMappings = normalizeModelIconMappings(record.model_icon_mappings)
    const questionImageAlgorithm = typeof record.question_image_algorithm === 'string'
      ? record.question_image_algorithm.trim()
      : typeof record.questionImageAlgorithm === 'string'
        ? record.questionImageAlgorithm.trim()
        : record.question_image && typeof record.question_image === 'object' && typeof (record.question_image as Record<string, unknown>).algorithm === 'string'
          ? ((record.question_image as Record<string, unknown>).algorithm as string).trim()
          : null

    return {
      providersList: providersList.length ? providersList : fallbackProvidersList,
      modelIconMappings,
      platforms,
      questionImageAlgorithm: questionImageAlgorithm || null,
    }
  }

  return {
    providersList: [],
    modelIconMappings: [],
    platforms: [],
    questionImageAlgorithm: null,
  }
}

export const dedupeRemotePlatforms = (platforms: AIPlatform[]): AIPlatform[] => {
  const seenPlatformIds = new Set<string>()

  return platforms.reduce<AIPlatform[]>((acc, platform) => {
    if (!platform?.id || seenPlatformIds.has(platform.id)) {
      return acc
    }

    seenPlatformIds.add(platform.id)

    const seenModelIds = new Set<string>()
    const models = (platform.models || []).reduce<AIModel[]>((modelAcc, model) => {
      if (!model?.id || seenModelIds.has(model.id)) {
        return modelAcc
      }

      seenModelIds.add(model.id)
      modelAcc.push(model)
      return modelAcc
    }, [])

    acc.push({
      ...platform,
      models,
    })

    return acc
  }, [])
}

export const isLikelyUserCreatedPlatform = (platform: Pick<AIPlatform, 'id'>): boolean => {
  return typeof platform.id === 'string' && platform.id.startsWith(USER_CREATED_PLATFORM_ID_PREFIX)
}

export const isLikelyUserCreatedModel = (model: Pick<AIModel, 'id' | 'platformId'>, platformId?: string): boolean => {
  if (!model?.id) return false
  if (model.id.startsWith(LEGACY_USER_CREATED_MODEL_ID_PREFIX)) return true

  const resolvedPlatformId = platformId || model.platformId
  return !!resolvedPlatformId && model.id.startsWith(`${resolvedPlatformId}_`) && /_\d+$/.test(model.id)
}

export const dedupeModelsById = (models: AIModel[]): AIModel[] => {
  const modelMap = new Map<string, AIModel>()

  for (const model of models) {
    if (!model?.id) continue

    const existing = modelMap.get(model.id)
    if (!existing || (!!model.isRemote && !existing.isRemote)) {
      modelMap.set(model.id, model)
    }
  }

  return [...modelMap.values()]
}

export const getPlatformApiKey = (platforms: AIPlatform[], preferredPlatform?: AIPlatform): string => {
  if (preferredPlatform?.apiKey?.trim()) {
    return preferredPlatform.apiKey
  }

  return platforms.find(platform => platform.apiKey?.trim())?.apiKey || ''
}

export const sanitizeStoredPlatforms = (platforms: AIPlatform[]): AIPlatform[] => {
  const groupedPlatforms = new Map<string, AIPlatform[]>()

  for (const platform of platforms) {
    if (!platform?.id || !platform.name?.trim()) continue

    const existingPlatforms = groupedPlatforms.get(platform.id)
    if (existingPlatforms) {
      existingPlatforms.push(platform)
    } else {
      groupedPlatforms.set(platform.id, [platform])
    }
  }

  return [...groupedPlatforms.values()].map((sameIdPlatforms) => {
    const hasRemoteDuplicate = sameIdPlatforms.some(platform => platform.isRemote)
    const preferredPlatform = sameIdPlatforms.find(platform => platform.isRemote)
      ?? sameIdPlatforms.find(platform => isLikelyUserCreatedPlatform(platform))
      ?? sameIdPlatforms[0]

    const models = dedupeModelsById(
      sameIdPlatforms.flatMap(platform => (platform.models || [])
        .filter((model): model is AIModel => !!model?.id)
        .filter((model) => {
          if (!hasRemoteDuplicate) return true
          if (model.isRemote) return true
          return isLikelyUserCreatedModel(model, platform.id)
        })
        .map(model => {
          const legacy = model as AIModel & { name?: string }
          const displayName = (legacy.displayName || legacy.name || legacy.id || '').trim() || legacy.id
          const nextModel: AIModel = {
            ...model,
            displayName,
            platformId: preferredPlatform.id,
            isRemote: model.isRemote === true,
            hasVision: modelHasVision(model),
            category: 'text',
          }
          // 废弃模型 name 字段
          delete (nextModel as AIModel & { name?: string }).name
          // 远程模型不再保留 jsCode
          if (nextModel.isRemote) {
            delete nextModel.jsCode
          }
          return nextModel
        })
      )
    )

    const inferredProtocol = inferPlatformApiProtocol({
      ...preferredPlatform,
      models,
    })
    // 远程平台不再允许 custom：2.2.8 起只走固定协议，旧缓存里的 custom 需纠正
    const hasRemoteModels = models.some((model) => model.isRemote)
    const apiProtocol = (hasRemoteModels || preferredPlatform.isRemote) && inferredProtocol === 'custom'
      ? 'openai-chat'
      : inferredProtocol
    return {
      ...preferredPlatform,
      displayName: preferredPlatform.displayName || preferredPlatform.name || preferredPlatform.id,
      apiKey: getPlatformApiKey(sameIdPlatforms, preferredPlatform),
      apiProtocol,
      models: models.map((model) => ({
        ...model,
        apiProtocol: model.isRemote && apiProtocol === 'custom' ? 'openai-chat' : apiProtocol,
      })),
    }
  })
}

let cachedRemoteModelsCatalog: RemoteModelsCatalog | null = null
let cachedRemoteModelsCatalogAt = 0
let pendingRemoteModelsCatalogRequest: Promise<RemoteModelsCatalog> | null = null

const fetchRemoteModelsCatalogFromUrl = async (url: string): Promise<RemoteModelsCatalog> => {
  try {
    const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
    const r = await tauriFetch(url, { method: 'GET' })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return normalizeRemoteModelsCatalog(await r.json())
  } catch (tauriError) {
    // 非 Tauri 或插件失败时回退到浏览器 fetch
    try {
      const r = await fetch(url)
      if (!r.ok) throw new Error(`HTTP ${r.status}`)
      return normalizeRemoteModelsCatalog(await r.json())
    } catch (browserError) {
      throw browserError instanceof Error ? browserError : tauriError
    }
  }
}

const requestRemoteModelsCatalog = async (): Promise<RemoteModelsCatalog> => {
  const urls = getRemoteModelsUrls()
  let lastError: unknown

  for (const url of urls) {
    try {
      return await fetchRemoteModelsCatalogFromUrl(url)
    } catch (error) {
      lastError = error
      console.warn(`加载远程模型目录失败 (${url}):`, error)
    }
  }

  throw lastError instanceof Error ? lastError : new Error('加载远程模型目录失败')
}

export const fetchRemoteModelsCatalog = async (): Promise<RemoteModelsCatalog> => {
  const now = Date.now()

  if (cachedRemoteModelsCatalog && now - cachedRemoteModelsCatalogAt < REMOTE_MODELS_REQUEST_COOLDOWN_MS) {
    return cachedRemoteModelsCatalog
  }

  if (pendingRemoteModelsCatalogRequest) {
    return pendingRemoteModelsCatalogRequest
  }

  pendingRemoteModelsCatalogRequest = requestRemoteModelsCatalog()
    .then((catalog) => {
      cachedRemoteModelsCatalog = catalog
      cachedRemoteModelsCatalogAt = Date.now()
      return catalog
    })
    .finally(() => {
      pendingRemoteModelsCatalogRequest = null
    })

  return pendingRemoteModelsCatalogRequest
}
