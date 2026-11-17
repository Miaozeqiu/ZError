import { getEnabledSkillItems } from './agentSkills'
import { isBrowserHome } from '../browser/appBrowser'
import { siteGraphForUrl } from '../browser/siteGraphCore'

export type SitePackPanelKind = 'jobs' | 'cards' | 'list' | 'form'

export type SitePack = {
  skillId: string
  siteId: string
  name: string
  hostPattern: string
  roles: Array<'login' | 'study' | 'homework' | 'captcha'>
  panel: Partial<Record<'study' | 'homework', SitePackPanelKind>>
}

const CHAOXING_PACK: SitePack = {
  skillId: 'chaoxing',
  siteId: 'chaoxing',
  name: '学习通',
  hostPattern: 'chaoxing\\.com',
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

/** 当前 URL 命中的站点包。站点只带网站地图，不带适配器领域工具。 */
export const resolveSitePackForUrl = (url: string): SitePack | null => {
  const href = String(url || '').trim()
  const enabled = getEnabledSkillItems('browser')
  const chaoxingOn = enabled.some((item) => item.id === 'chaoxing')
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
    roles: [],
    panel: {},
  }
}
