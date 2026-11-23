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

/** 当前 URL 命中的站点包。站点只带网站地图，不带适配器领域工具。 */
export const resolveSitePackForUrl = (url: string): SitePack | null => {
  const href = String(url || '').trim()
  const enabled = getEnabledSkillItems('browser')
  if (!href || isBrowserHome(href)) return null
  const graph = siteGraphForUrl(href)
  if (!graph) return null
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
