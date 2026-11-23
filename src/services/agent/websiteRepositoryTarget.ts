import { installedExperienceHost, websiteRepositoryHosts } from './websiteRepository'
import { websitePrimaryHost } from './websiteIdentity'

export const WEBSITE_REPOSITORY_READ_ONLY = '此网站使用在线仓库或自定义 HTTP 接口。只可修改「本地经验」；请读取本站 SKILL.md 的 local_experience 后保存。'

export const websiteRepositoryTarget = (skillId: string, path: string): { host: string; path: string } | null => {
  if (skillId === 'chaoxing') return { host: 'chaoxing.com', path }
  const match = skillId === 'site-learn' ? path.match(/^sites\/([^/]+)\/(.+)$/) : null
  if (!match) return null
  const host = installedExperienceHost(websitePrimaryHost(match[1]))
  return host ? { host, path: match[2] } : null
}

/** 只在路径可能属于网站仓库时加载索引，通用 Skill 的文件读取不依赖网站。 */
export const resolveWebsiteRepositoryTarget = async (skillId: string, path: string) => {
  if (!websiteRepositoryTarget(skillId, path) && !path.startsWith('sites/')) return null
  await websiteRepositoryHosts()
  return websiteRepositoryTarget(skillId, path)
}
