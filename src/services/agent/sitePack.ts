import { getEnabledSkillItems } from './agentSkills'
import { PLATFORM_TOOLS } from '../platform/toolNames'
import { isBrowserHome } from '../browser/appBrowser'
import { siteGraphForUrl } from '../browser/siteGraphCore'

export type SitePackPanelKind = 'jobs' | 'cards' | 'list' | 'form'

export type SitePack = {
  skillId: string
  siteId: string
  name: string
  hostPattern: string
  tools: string[]
  roles: Array<'login' | 'study' | 'homework' | 'captcha'>
  panel: Partial<Record<'study' | 'homework', SitePackPanelKind>>
}

const CHAOXING_PACK: SitePack = {
  skillId: 'chaoxing',
  siteId: 'chaoxing',
  name: '学习通',
  hostPattern: 'chaoxing\\.com',
  tools: Object.values(PLATFORM_TOOLS),
  roles: ['login', 'study', 'homework', 'captcha'],
  panel: { study: 'jobs', homework: 'cards' },
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

const matchHost = (pattern: string, url: string) => {
  const host = hostOf(url)
  if (!pattern) return false
  try {
    return new RegExp(pattern, 'i').test(url) || new RegExp(pattern, 'i').test(host)
  } catch {
    return host.includes(pattern) || url.includes(pattern)
  }
}

/** 当前 URL 命中的站点包；没有适配器的自定义站点只带图谱、不带领域工具。 */
export const resolveSitePackForUrl = (url: string): SitePack | null => {
  const href = String(url || '').trim()
  const enabled = getEnabledSkillItems('browser')
  const chaoxingOn = enabled.some((item) => item.id === 'chaoxing')
  // 从导航页出发时还没有 chaoxing 域名，但仍要带上刷课/作业工具
  if ((!href || isBrowserHome(href)) && chaoxingOn) return CHAOXING_PACK
  if (!href) return null
  if (matchHost(CHAOXING_PACK.hostPattern, href) && chaoxingOn) {
    return CHAOXING_PACK
  }
  const graph = siteGraphForUrl(href)
  if (!graph) return null
  if (graph.id === 'chaoxing' && enabled.some((item) => item.id === 'chaoxing')) return CHAOXING_PACK
  const skill = enabled.find((item) => item.id === graph.id)
  return {
    skillId: skill?.id || graph.id,
    siteId: graph.id,
    name: graph.name || graph.id,
    hostPattern: graph.host || '',
    tools: [],
    roles: [],
    panel: {},
  }
}

export const sitePackHasTool = (pack: SitePack | null | undefined, name: string) => (
  Boolean(pack?.tools.includes(name))
)
