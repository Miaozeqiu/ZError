/** 平台 / 模型图标。加载、映射、透明底检测都在这里。 */
import { fetchRemoteModelsCatalog } from '../../../services/model/config'
import type { AIModel, AIPlatform } from '../../../services/model/config'
import { getPlatformIconDisplayUrl, resolvePlatformIconUrl } from '../../../services/app/iconCache'
import type { ModelSettingsState } from './state'

export const PROD_REMOTE_MODEL_ICON_BASE_URL = 'https://webapi.zaizhexue.top/models/'
export const DEV_REMOTE_MODEL_ICON_BASE_URL = 'https://webapi.zaizhexue.top/models/'

export const bindModelIcons = (
  state: ModelSettingsState,
  getPlatforms: () => AIPlatform[],
) => {
  const {
    iconLoadErrors,
    platformIconUrls,
    platformIconBackgrounds,
    remoteModelIconMappings,
  } = state

  const getRemoteModelIconBaseUrl = (): string => {
    const isTauriDev = import.meta.env.DEV && typeof window !== 'undefined' && (window.__TAURI__ || window.__TAURI_INTERNALS__)
    return isTauriDev ? DEV_REMOTE_MODEL_ICON_BASE_URL : PROD_REMOTE_MODEL_ICON_BASE_URL
  }

  const resolveModelIconUrl = (icon?: string): string => {
    if (!icon) return ''
    if (/^data:/i.test(icon)) return icon
    if (/^https?:\/\//i.test(icon)) return icon

    const normalizedIcon = icon
      .trim()
      .replace(/^\/+/, '')
      .replace(/^assets\/images\/models\//i, '')
      .replace(/^models\//i, '')

    if (!normalizedIcon) return ''
    return new URL(normalizedIcon, getRemoteModelIconBaseUrl()).toString()
  }

  const loadRemoteModelIconMappings = async () => {
    try {
      const catalog = await fetchRemoteModelsCatalog()
      remoteModelIconMappings.value = catalog.modelIconMappings || []
    } catch (error) {
      console.warn('加载远程模型图标映射失败:', error)
      remoteModelIconMappings.value = []
    }
  }

  const getPlatformIconUrl = async (icon: string) => {
    console.log('🔍 [DEBUG] getPlatformIconUrl called with icon:', icon)

    const displayUrl = getPlatformIconDisplayUrl(icon)
    if (!displayUrl) {
      console.log('📝 [DEBUG] Icon is not a file, returning empty string for:', icon)
      return ''
    }

    console.log('✅ [DEBUG] Using provider path:', displayUrl)

    try {
      return await resolvePlatformIconUrl(icon)
    } catch (error) {
      console.warn('⚠️ [DEBUG] Resolve provider icon failed, fallback to display URL:', icon, error)
      return displayUrl
    }
  }

  const getPlatformInitials = (name: string) => {
    return name
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase())
      .join('')
      .substring(0, 2)
  }

  const isEmoji = (str: string) => {
    if (!str) return false
    const emojiRegex = /[\u{1F600}-\u{1F64F}]|[\u{1F300}-\u{1F5FF}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]/u
    const isSingleChar = str.length <= 4 && !str.includes('.') && !str.includes('/') && !str.includes('http')
    return emojiRegex.test(str) || isSingleChar
  }

  const isSvgIcon = (icon?: string) => {
    if (!icon) return false
    return /^data:image\/svg\+xml/i.test(icon) || /\.svg(?:$|[?#])/i.test(icon)
  }

  const shouldUsePlatformIconBackground = (platform: AIPlatform) => {
    if (!platform.icon) return false
    if (isEmoji(platform.icon)) return true
    if (isSvgIcon(platform.icon) || isSvgIcon(platformIconUrls.value[platform.id])) return true
    return !!platformIconBackgrounds.value[platform.id]
  }

  const detectTransparentChannel = (img: HTMLImageElement) => {
    try {
      const sampleSize = 24
      const canvas = document.createElement('canvas')
      canvas.width = sampleSize
      canvas.height = sampleSize
      const ctx = canvas.getContext('2d')
      if (!ctx) return false

      ctx.clearRect(0, 0, sampleSize, sampleSize)
      ctx.drawImage(img, 0, 0, sampleSize, sampleSize)

      const { data } = ctx.getImageData(0, 0, sampleSize, sampleSize)
      for (let i = 3; i < data.length; i += 4) {
        if (data[i] < 250) return true
      }
    } catch {
      return false
    }

    return false
  }

  const handlePlatformIconLoad = (platform: AIPlatform, event: Event) => {
    const img = event.target as HTMLImageElement | null
    if (!img) return

    if (isSvgIcon(platform.icon) || isSvgIcon(img.currentSrc || img.src)) {
      platformIconBackgrounds.value[platform.id] = true
      return
    }

    platformIconBackgrounds.value[platform.id] = detectTransparentChannel(img)
  }

  const handleIconError = (platformId: string) => {
    iconLoadErrors.value[platformId] = true
    platformIconBackgrounds.value[platformId] = false
  }

  const getModelIcon = (model: AIModel): string => {
    if (model.icon) {
      return resolveModelIconUrl(model.icon)
    }

    const searchStr = `${model.displayName || ''} ${model.id || ''}`.toLowerCase()
    const matchedMapping = remoteModelIconMappings.value.find((mapping) =>
      mapping.models.some((keyword) => searchStr.includes(keyword.toLowerCase())),
    )

    return resolveModelIconUrl(matchedMapping?.icon)
  }

  const loadPlatformIcons = async () => {
    for (const platform of getPlatforms()) {
      platformIconBackgrounds.value[platform.id] = isSvgIcon(platform.icon)
      if (platform.icon && platform.icon.includes('.')) {
        try {
          platformIconUrls.value[platform.id] = await getPlatformIconUrl(platform.icon)
        } catch (error) {
          console.error(`Failed to load icon for platform ${platform.id}:`, error)
        }
      }
    }
  }

  return {
    PROD_REMOTE_MODEL_ICON_BASE_URL,
    DEV_REMOTE_MODEL_ICON_BASE_URL,
    getRemoteModelIconBaseUrl,
    resolveModelIconUrl,
    loadRemoteModelIconMappings,
    loadPlatformIcons,
    getPlatformIconUrl,
    getPlatformInitials,
    isEmoji,
    isSvgIcon,
    shouldUsePlatformIconBackground,
    detectTransparentChannel,
    handlePlatformIconLoad,
    handleIconError,
    getModelIcon,
  }
}
