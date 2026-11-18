import { installedExperienceHost } from './websiteRepository'
import { websitePrimaryHost } from './websiteIdentity'

export const WEBSITE_REPOSITORY_READ_ONLY = '此网站使用在线仓库或自定义 HTTP 接口。只可修改「本地经验」；请读取本站 SKILL.md 的 local_experience 后保存。'

export const websiteRepositoryTarget = (skillId: string, path: string): { host: string; path: string } | null => {
  if (skillId === 'chaoxing') return { host: 'chaoxing.com', path }
  const match = skillId === 'site-learn' ? path.match(/^sites\/([^/]+)\/(.+)$/) : null
  if (!match) return null
  const host = installedExperienceHost(websitePrimaryHost(match[1]))
  return host ? { host, path: match[2] } : null
}
