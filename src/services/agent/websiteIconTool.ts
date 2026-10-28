import { loadWebsiteIdentities, normalizeWebsiteHost, saveWebsiteIdentity, websitePrimaryHost } from './websiteIdentity'
import type { ChatToolHandler } from './toolContext'

const MAX_ICON_BYTES = 256 * 1024

export const websiteIconTool: ChatToolHandler = async ({ args, ctx }) => {
  await loadWebsiteIdentities()
  const browserId = ctx.browserId()
  const pageUrl = browserId ? (await import('../browser/appBrowser')).peekAppBrowserUrl(browserId) : ''
  const requestedHost = String(args.website || pageUrl || '').trim()
  const host = websitePrimaryHost(requestedHost)
  if (!host || !normalizeWebsiteHost(host)) return JSON.stringify({ ok: false, error: '请提供网站域名，或先打开该网站。' })
  let url: URL
  try {
    url = new URL(String(args.icon_url || ''))
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error()
  } catch { return JSON.stringify({ ok: false, error: '请提供网页实际声明的 http(s) 图标地址。' }) }
  const abort = new AbortController()
  const cancel = () => abort.abort()
  ctx.abort.addEventListener('abort', cancel, { once: true })
  const timeout = setTimeout(cancel, 12000)
  try {
    if (ctx.abort.aborted) throw new DOMException('已停止', 'AbortError')
    const fetcher = '__TAURI_INTERNALS__' in window ? (await import('@tauri-apps/plugin-http')).fetch : globalThis.fetch
    const response = await fetcher(url.href, {
      signal: abort.signal, credentials: 'omit',
      headers: { Accept: 'image/*', ...(pageUrl ? { Referer: new URL(pageUrl).origin + '/' } : {}) },
    })
    if (!response.ok) throw new Error(`图标下载失败（HTTP ${response.status}）`)
    if (Number(response.headers.get('content-length')) > MAX_ICON_BYTES) throw new Error('图标超过 256 KB，请选择较小的图标。')
    const chunks: Uint8Array[] = []
    const reader = response.body?.getReader()
    let size = 0
    if (!reader) throw new Error('图标响应没有内容')
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > MAX_ICON_BYTES) { await reader.cancel(); throw new Error('图标超过 256 KB，请选择较小的图标。') }
        chunks.push(value)
      }
    } finally { reader.releaseLock() }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length }
    const mime = iconMime(bytes)
    if (!mime) throw new Error('下载内容不是支持的图标图片，不能将网页或错误页保存为图标。')
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    const dataUrl = `data:${mime};base64,${btoa(binary)}`
    // Decode before publishing so a corrupt icon never replaces a working one.
    const image = new Image()
    image.src = dataUrl
    await new Promise<void>((resolve, reject) => {
      const stopped = () => reject(new DOMException('图标下载或验证已超时/停止', 'AbortError'))
      if (abort.signal.aborted) { stopped(); return }
      abort.signal.addEventListener('abort', stopped, { once: true })
      image.decode().then(resolve, reject).finally(() => abort.signal.removeEventListener('abort', stopped))
    })
    if (abort.signal.aborted) throw new DOMException('已停止', 'AbortError')
    await saveWebsiteIdentity(host, '', undefined, { url: url.href, dataUrl })
    return JSON.stringify({ ok: true, host, icon_url: url.href, cached: true, bytes: size })
  } catch (error) {
    if (ctx.abort.aborted) throw new DOMException('已停止', 'AbortError')
    return JSON.stringify({ ok: false, host, error: error instanceof Error ? error.message : String(error) })
  } finally {
    clearTimeout(timeout)
    ctx.abort.removeEventListener('abort', cancel)
  }
}

/** Inspect the bytes, not the server's often incorrect Content-Type. */
const iconMime = (b: Uint8Array) => {
  const prefix = Array.from(b.slice(0, 12))
  if (prefix.slice(0, 8).join(',') === '137,80,78,71,13,10,26,10') return 'image/png'
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) return 'image/jpeg'
  const text = new TextDecoder().decode(b)
  if (text.startsWith('GIF87a') || text.startsWith('GIF89a')) return 'image/gif'
  if (text.startsWith('RIFF') && text.slice(8, 12) === 'WEBP') return 'image/webp'
  if (b[0] === 0 && b[1] === 0 && b[2] === 1 && b[3] === 0) return 'image/x-icon'
  if (/^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)?<svg\b/i.test(text)) return 'image/svg+xml'
  return ''
}
