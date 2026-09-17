import { act } from '../browser/protocol'
import { siteGraphForUrl, siteGraphNodeForUrl } from '../browser/siteGraphCore'
import {
  invokeSiteScript,
  locateSiteScript,
  parseSiteHtml,
  sitePackageOf,
} from './registry'
import type { ParserHandle, SiteCard } from './types'

export {
  invokeSiteScript,
  listSitePackages,
  locateSiteScript,
  parseSiteDocument,
  parseSiteHtml,
  registerSitePackage,
  sitePackageOf,
} from './registry'

const parserRolesOf = (href: string) => {
  const node = siteGraphNodeForUrl(href)
  return (node?.parserIds || []).filter((id) => id && id !== 'login' && id !== 'captcha')
}

/** 通用站点卡。学习通作业/刷课仍走专用 cardFrom*。 */
export const readSiteCardFromHtml = (html: string, href: string, role?: string): SiteCard | null => {
  const site = siteGraphForUrl(href)
  const siteId = site?.id || ''
  const roles = role ? [role] : parserRolesOf(href)
  if (!roles.length) return null
  for (const id of roles) {
    if (id === 'homework' || id === 'study') continue
    const pack = sitePackageOf(siteId, id)
      || sitePackageOf(site?.host || '', id)
      || sitePackageOf(String(site?.host || '').replace(/^www\./, ''), id)
    if (!pack) continue
    const card = parseSiteHtml(pack.siteId, id, html, href)
    if (card.ok) return card
  }
  return null
}

export const runHandle = async (
  browserId: string,
  href: string,
  handle: ParserHandle,
  op: 'click' | 'invoke' = 'click',
) => {
  const site = siteGraphForUrl(href)
  const siteId = site?.id || ''
  const roles = parserRolesOf(href)
  const role = roles[0] || ''
  const pack = sitePackageOf(siteId, role) || sitePackageOf(site?.host || '', role)
  if (!pack) return { ok: false, error: '当前页没有解析包' }
  if (op === 'invoke') {
    const { asObject, evalBrowserView } = await import('../browser/eval')
    const script = invokeSiteScript(pack.siteId, pack.role, handle)
    if (!script) return { ok: false, error: `没有 locate ${pack.siteId}/${pack.role}` }
    return asObject(await evalBrowserView(browserId, script).catch(() => null))
  }
  const script = locateSiteScript(pack.siteId, pack.role, handle)
  if (!script) return { ok: false, error: `没有 locate ${pack.siteId}/${pack.role}` }
  return act(browserId, { op: 'click', at: { by: 'script', value: script } })
}
