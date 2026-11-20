import type { AIPlatform } from './configTypes'

export const usesSharedDeepSeekKey = (platform: Pick<AIPlatform, 'baseUrl' | 'isRemote'>): boolean => {
  if (!platform.isRemote) return false
  try {
    const url = new URL(platform.baseUrl)
    return url.origin === 'https://api.deepseek.com' && !url.username && !url.password
  } catch {
    return false
  }
}
