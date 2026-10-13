import { asObject } from './eval'

export const useLegacyEval = () => import.meta.env.VITE_LEGACY_EVAL === '1'

export const parseHtml = (html: string) => {
  if (typeof DOMParser === 'undefined') return null
  try {
    return new DOMParser().parseFromString(html, 'text/html')
  } catch {
    return null
  }
}

export const readFrameHtml = async (id: string, frame = 'main') => {
  const key = String(id || '').trim()
  if (!key) return { ok: false, html: '', url: '' }
  try {
    const { callProtocol } = await import('./protocol')
    const raw = asObject(await callProtocol(key, 'dom_html', { frame }))
    return {
      ok: Boolean(raw.ok && raw.html),
      html: String(raw.html || ''),
      url: String(raw.url || ''),
    }
  } catch {
    return { ok: false, html: '', url: '' }
  }
}
