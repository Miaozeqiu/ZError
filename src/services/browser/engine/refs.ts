import type { BrowserLocator } from './types'

export type PageRef = {
  id: string
  role: string
  name: string
  value?: string
  checked?: boolean
  disabled?: boolean
  framePath?: string
  locator: BrowserLocator
}

type CachedLocator = BrowserLocator & { checked?: boolean; disabled?: boolean }
const cache = new Map<string, Record<string, CachedLocator>>()

export const rememberPageRefs = (browserId: string, refs: PageRef[]) => {
  const map: Record<string, CachedLocator> = {}
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
      frameId: ref.locator.frameId,
      loaderId: ref.locator.loaderId,
      role: ref.role || ref.locator.role,
      backend: Number(ref.locator.backend) > 0 ? Number(ref.locator.backend) : undefined,
      checked: ref.checked,
      disabled: ref.disabled,
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
    checked: locator.checked,
    disabled: locator.disabled,
    locator: { ...locator },
  }))
}

export const locatorFromCache = (browserId: string, ref: string) => (
  cache.get(browserId)?.[String(ref || '').trim()] || null
)

const SNAPSHOT_REF = /^e\d+$/i

/** 兼容误放进 ref 的 CSS 选择器；快照引用使用 e 加数字的格式。 */
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
  return locatorFromCache(browserId, key)
}

export const publicRefs = (refs: PageRef[]) => refs.map((ref) => ({
  id: ref.id,
  role: ref.role,
  name: ref.name,
  ...(ref.value ? { value: ref.value } : {}),
  ...((ref.role === 'checkbox' || ref.role === 'radio') && typeof ref.checked === 'boolean' ? { checked: ref.checked } : {}),
  ...(ref.disabled ? { disabled: true } : {}),
}))
