import { createPageDocument } from '../browser/pageDom'
import { evalLocalApi, joinParts, pageScript } from './runtime'
import type { ParserHandle, SiteCard } from './types'

export type SitePackageParts = {
  helpers: string
  parse: string
  locate: string
}

export type LoadedSitePackage = {
  siteId: string
  role: string
  parts: SitePackageParts
}

const packages = new Map<string, LoadedSitePackage>()

const keyOf = (siteId: string, role: string) => `${siteId}/${role}`

export const registerSitePackage = (siteId: string, role: string, parts: Partial<SitePackageParts>) => {
  const id = String(siteId || '').trim()
  const name = String(role || '').trim()
  if (!id || !name) return
  const prev = packages.get(keyOf(id, name))
  packages.set(keyOf(id, name), {
    siteId: id,
    role: name,
    parts: {
      helpers: parts.helpers ?? prev?.parts.helpers ?? '',
      parse: parts.parse ?? prev?.parts.parse ?? '',
      locate: parts.locate ?? prev?.parts.locate ?? '',
    },
  })
}

export const sitePackageOf = (siteId: string, role: string) => packages.get(keyOf(siteId, role)) || null

export const listSitePackages = () => [...packages.values()]

const asCard = (raw: unknown): SiteCard => {
  if (!raw || typeof raw !== 'object') return { ok: false, page: 'unknown', error: 'parse() 没有返回对象' }
  const card = raw as SiteCard
  return {
    ok: card.ok !== false,
    page: String(card.page || 'unknown'),
    next: card.next,
    confidence: card.confidence,
    handles: card.handles,
    error: card.error,
    hint: card.hint,
    url: card.url,
    title: card.title,
    ...card,
  }
}

export const parseSiteDocument = (siteId: string, role: string, doc: Document, href = ''): SiteCard => {
  const pack = sitePackageOf(siteId, role)
  if (!pack?.parts.parse) return { ok: false, page: 'unknown', error: `没有解析包 ${siteId}/${role}` }
  const api = evalLocalApi<{ parse?: (doc: Document, href?: string) => unknown }>(
    joinParts(pack.parts.helpers, pack.parts.parse),
    ['parse'],
  )
  if (typeof api.parse !== 'function') return { ok: false, page: 'unknown', error: '解析包缺少 parse(doc, href)' }
  return asCard(api.parse(doc, href))
}

export const parseSiteHtml = (siteId: string, role: string, html: string, href = '') => (
  parseSiteDocument(siteId, role, createPageDocument(html, href), href)
)

export const locateSiteScript = (siteId: string, role: string, handle: ParserHandle) => {
  const pack = sitePackageOf(siteId, role)
  if (!pack?.parts.locate) return ''
  return pageScript(joinParts(pack.parts.helpers, pack.parts.locate), `return locate(${JSON.stringify(handle)});`)
}

export const invokeSiteScript = (siteId: string, role: string, handle: ParserHandle) => {
  const pack = sitePackageOf(siteId, role)
  if (!pack?.parts.locate) return ''
  return pageScript(joinParts(pack.parts.helpers, pack.parts.locate), `return invoke(${JSON.stringify(handle)});`)
}
