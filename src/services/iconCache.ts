const REMOTE_ICON_CACHE_PREFIX = 'remote_icon_cache_v1:'
const REMOTE_ICON_CACHE_TTL = 7 * 24 * 60 * 60 * 1000
const PROD_PLATFORM_ICON_BASE_URL = 'https://app.zerror.cc/providers/'
const DEV_PLATFORM_ICON_BASE_URL = 'http://localhost:5175/providers/'

const memoryIconCache = new Map<string, string>()
const pendingIconRequests = new Map<string, Promise<string>>()

interface RemoteIconCacheEntry {
  dataUrl: string
  timestamp: number
}

const isRemoteIconUrl = (icon?: string): boolean => !!icon && /^https?:\/\//i.test(icon)

const getPlatformIconBaseUrl = (): string => import.meta.env.DEV ? DEV_PLATFORM_ICON_BASE_URL : PROD_PLATFORM_ICON_BASE_URL

const normalizePlatformIconPath = (icon: string): string => icon
  .trim()
  .replace(/^\/+/, '')
  .replace(/^assets\/images\/providers\//i, '')
  .replace(/^providers\//i, '')

const getPlatformAssetIconUrl = (icon: string): string => {
  if (!icon || !icon.includes('.')) return ''
  const normalizedIcon = normalizePlatformIconPath(icon)
  if (!normalizedIcon) return ''
  return new URL(normalizedIcon, getPlatformIconBaseUrl()).toString()
}


const getResolvableIconUrl = (icon?: string): string => {
  if (!icon) return ''
  if (isRemoteIconUrl(icon)) return icon
  if (icon.includes('.')) return getPlatformAssetIconUrl(icon)
  return ''
}

const inferMimeTypeFromUrl = (url: string): string => {
  const cleanUrl = url.split('?')[0].split('#')[0].toLowerCase()
  if (cleanUrl.endsWith('.svg')) return 'image/svg+xml'
  if (cleanUrl.endsWith('.webp')) return 'image/webp'
  if (cleanUrl.endsWith('.jpg') || cleanUrl.endsWith('.jpeg')) return 'image/jpeg'
  if (cleanUrl.endsWith('.gif')) return 'image/gif'
  if (cleanUrl.endsWith('.bmp')) return 'image/bmp'
  if (cleanUrl.endsWith('.ico')) return 'image/x-icon'
  return 'image/png'
}

const getRemoteIconCacheKey = (url: string) => `${REMOTE_ICON_CACHE_PREFIX}${encodeURIComponent(url)}`

const readCachedRemoteIcon = (url: string): string | null => {
  if (memoryIconCache.has(url)) return memoryIconCache.get(url) || null

  try {
    const raw = localStorage.getItem(getRemoteIconCacheKey(url))
    if (!raw) return null

    const parsed = JSON.parse(raw) as RemoteIconCacheEntry
    if (!parsed?.dataUrl || !parsed?.timestamp) return null

    if (Date.now() - parsed.timestamp > REMOTE_ICON_CACHE_TTL) {
      localStorage.removeItem(getRemoteIconCacheKey(url))
      return null
    }

    memoryIconCache.set(url, parsed.dataUrl)
    return parsed.dataUrl
  } catch {
    return null
  }
}

const writeCachedRemoteIcon = (url: string, dataUrl: string) => {
  memoryIconCache.set(url, dataUrl)

  try {
    const payload: RemoteIconCacheEntry = { dataUrl, timestamp: Date.now() }
    localStorage.setItem(getRemoteIconCacheKey(url), JSON.stringify(payload))
  } catch (error) {
    console.warn('缓存远程平台图标失败:', error)
  }
}

const arrayBufferToDataUrl = (buffer: ArrayBuffer, contentType: string): string => {
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  let binary = ''

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }

  return `data:${contentType};base64,${btoa(binary)}`
}

const fetchIconResponse = async (url: string): Promise<Response> => {
  const isTauri = typeof window !== 'undefined' && (window.__TAURI__ || window.__TAURI_INTERNALS__)

  if (isTauri) {
    try {
      const { fetch: tauriFetch } = await import('@tauri-apps/plugin-http')
      return await tauriFetch(url, { method: 'GET' }) as Response
    } catch (error) {
      console.warn('使用 Tauri HTTP 获取远程平台图标失败，回退到浏览器 fetch:', error)
    }
  }

  return await fetch(url, { method: 'GET', cache: 'force-cache' })
}

export const isImageIconValue = (icon?: string): boolean => {
  if (!icon) return false
  return isRemoteIconUrl(icon) || icon.includes('.')
}

export const getPlatformIconDisplayUrl = (icon?: string): string => {
  if (!icon) return ''
  return getResolvableIconUrl(icon)
}

export const resolvePlatformIconUrl = async (icon?: string): Promise<string> => {
  if (!icon) return ''

  const resolvedUrl = getResolvableIconUrl(icon)
  if (!resolvedUrl) return icon

  const cached = readCachedRemoteIcon(resolvedUrl)
  if (cached) return cached

  const pending = pendingIconRequests.get(resolvedUrl)
  if (pending) return await pending

  const request = (async () => {
    try {
      const response = await fetchIconResponse(resolvedUrl)
      if (!response.ok) throw new Error(`HTTP ${response.status}`)

      const contentTypeHeader = response.headers?.get?.('content-type') || ''
      const contentType = contentTypeHeader.split(';')[0] || inferMimeTypeFromUrl(resolvedUrl)
      const buffer = await response.arrayBuffer()
      const dataUrl = arrayBufferToDataUrl(buffer, contentType)
      writeCachedRemoteIcon(resolvedUrl, dataUrl)
      return dataUrl
    } catch (error) {
      console.warn('缓存远程平台图标失败，回退到原始 URL:', resolvedUrl, error)
      return resolvedUrl
    } finally {
      pendingIconRequests.delete(resolvedUrl)
    }
  })()

  pendingIconRequests.set(resolvedUrl, request)
  return await request
}
