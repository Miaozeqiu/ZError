import { hasWebsiteRepository } from './websiteRepository'
import { websitePrimaryHost } from './websiteIdentity'
export const websiteRepositoryTarget = (skillId: string, path: string): { host: string; path: string } | null => {
  if (skillId === 'chaoxing') return { host: 'chaoxing.com', path }
  const match = skillId === 'site-learn' ? path.match(/^sites\/([^/]+)\/(.+)$/) : null
  if (!match) return null
  const host = websitePrimaryHost(match[1])
  return hasWebsiteRepository(host) ? { host, path: match[2] } : null
}
