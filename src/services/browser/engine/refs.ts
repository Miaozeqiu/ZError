import { asObject, evalBrowserView } from '../eval'
import type { BrowserLocator } from './types'

export type PageRef = {
  id: string
  role: string
  name: string
  checked?: boolean
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
    }
  }
  cache.set(browserId, map)
}

export const locatorFromCache = (browserId: string, ref: string) => (
  cache.get(browserId)?.[String(ref || '').trim()] || null
)

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
    exact: Boolean(row.exact),
  }
}

export const publicRefs = (refs: PageRef[]) => refs.map((ref) => ({
  id: ref.id,
  role: ref.role,
  name: ref.name,
  ...(ref.role === 'checkbox' || ref.role === 'radio' ? { checked: Boolean(ref.checked) } : {}),
}))
