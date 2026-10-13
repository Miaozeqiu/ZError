import { asObject, evalBrowserView } from '../eval'
import type { BrowserLocator } from './types'

export type PageRef = {
  id: string
  role: string
  name: string
  value?: string
  checked?: boolean
  framePath?: string
  locator: BrowserLocator
}

const cache = new Map<string, Record<string, BrowserLocator>>()

export const rememberPageRefs = (browserId: string, refs: PageRef[]) => {
  const map: Record<string, BrowserLocator> = {}
  for (const ref of refs) {
    const key = String(ref.id || '').trim()
    if (!key || !ref.locator?.by || !ref.locator.value) continue
    map[key] = {
      by: ref.locator.by,
      value: ref.locator.value,
      name: ref.locator.name,
      exact: ref.locator.exact,
      nth: ref.locator.nth,
      frame: ref.locator.frame,
      framePath: ref.locator.framePath,
      role: ref.role || ref.locator.role,
      backend: Number(ref.locator.backend) > 0 ? Number(ref.locator.backend) : undefined,
    }
  }
  cache.set(browserId, map)
}

export const listCachedPageRefs = (browserId: string): PageRef[] => {
  const map = cache.get(browserId)
  if (!map) return []
  return Object.entries(map).map(([id, locator]) => ({
    id,
    role: String(locator.role || ''),
    name: String(locator.name || (locator.by === 'text' || locator.by === 'label' ? locator.value : '') || ''),
    locator: { ...locator },
  }))
}

export const locatorFromCache = (browserId: string, ref: string) => (
  cache.get(browserId)?.[String(ref || '').trim()] || null
)

const SNAPSHOT_REF = /^e\d+$/i

/** 模型常把 #phone / input#pwd 塞进 ref。快照号是 e3，其余当 CSS。 */
export const looksLikeCssSelector = (value: string) => {
  const raw = String(value || '').trim()
  if (!raw || SNAPSHOT_REF.test(raw)) return false
  return /[#.\[\]>=~:+]/.test(raw) || /^(input|button|textarea|select|a|form|label|div|span)\b/i.test(raw)
}

export const cssSelectorFromArgs = (ref: string, selector: string) => {
  const css = String(selector || '').trim()
  if (css) return css
  const raw = String(ref || '').trim()
  return looksLikeCssSelector(raw) ? raw : ''
}

export const resolveRefLocator = async (browserId: string, ref: string) => {
  const key = String(ref || '').trim()
  if (!key) return null
  const cached = locatorFromCache(browserId, key)
  if (cached) return cached
  const row = asObject(await evalBrowserView(browserId, `(function(){
    var list = window.__ZE_SNAP_REFS__ || [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === ${JSON.stringify(key)}) return list[i].locator || null;
    }
    return null;
  })()`).catch(() => null))
  if (!row.by || !row.value) return null
  return {
    by: String(row.by) as BrowserLocator['by'],
    value: String(row.value),
    name: row.name ? String(row.name) : undefined,
    exact: row.exact ? true : undefined,
    nth: Number(row.nth) > 0 ? Number(row.nth) : undefined,
    frame: row.frame ? String(row.frame) : undefined,
    framePath: row.framePath ? String(row.framePath) : undefined,
    role: row.role ? String(row.role) : undefined,
  }
}

export const publicRefs = (refs: PageRef[]) => refs.map((ref) => ({
  id: ref.id,
  role: ref.role,
  name: ref.name,
  ...(ref.value ? { value: ref.value } : {}),
  ...(ref.role === 'checkbox' || ref.role === 'radio' ? { checked: Boolean(ref.checked) } : {}),
}))
