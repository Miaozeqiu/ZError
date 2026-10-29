import { invoke } from '@tauri-apps/api/core'
import { readBrowserPage } from '../appBrowser'
import { asObject, evalBrowserView, evalBrowserViewInFrame, evalBrowserViewMainIdle, waitMs } from '../eval'
import { callProtocol } from '../protocol'
import { probeOnBrowser } from './act'
import {
  abandonPageSnap,
  actionSnapBudgetMs,
  beginPageSnap,
  cachedPageSnap,
  clipSnapshot,
  snapshotContentChanged,
} from './pageSnap'
import { resolveRefLocator } from './refs'
import type { ActResult, BrowserLocator } from './types'
import { noteCourseNavigation } from '../coursePlan'
import { withPopupTabLimit } from '../tabLimits'

const lastFocus = new Map<string, string>()

const WAIT_POLL_MS = 150
const WAIT_TIMEOUT_MS = 8000
const RESPONSE_LOOKBACK_MS = 8000

const watched = new Set<string>()

const hostPathOf = (value: string) => {
  try {
    const parsed = new URL(value)
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase()
  } catch {
    return String(value || '').split(/[?#]/)[0].toLowerCase()
  }
}

const urlMatches = (url: string, want: string) => {
  const needle = String(want || '').trim().toLowerCase()
  if (!needle) return false
  return hostPathOf(url).includes(needle)
}

/** 比较落地页和目标是不是同一个站（忽略 www.，认同根域子域）。 */
export const pageHostOf = (value: string) => {
  try {
    return new URL(value).hostname.replace(/^www\./, '').toLowerCase()
  } catch {
    return ''
  }
}

const pageSiteRoot = (host: string) => {
  const parts = String(host || '').split('.').filter(Boolean)
  if (parts.length <= 2) return host
  return parts.slice(-2).join('.')
}

export const pageHostMatches = (landed: string, want: string) => {
  const a = pageHostOf(landed)
  const b = pageHostOf(want)
  if (!a || !b) return false
  if (a === b) return true
  return pageSiteRoot(a) === pageSiteRoot(b)
}

export const responseMatches = (url: string, want: string) => {
  const needle = String(want || '').trim().toLowerCase()
  const hay = String(url || '').toLowerCase()
  if (!needle || !hay) return false
  return hay.includes(needle)
}

/** `{ ok: false }` 继续等；其余按 JS 真值。 */
export const isWaitTruthy = (value: unknown) => {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'ok' in (value as object)) {
    return (value as { ok?: unknown }).ok !== false && (value as { ok?: unknown }).ok !== 0
  }
  return Boolean(value)
}

const pageUrl = async (id: string) => {
  const state = await invoke<{ url?: string }>('browser_get_state', { id }).catch(() => null)
  return String(state?.url || '')
}

const pageReady = async (id: string) => {
  const raw = await evalBrowserView(id, `(function(){ return { ready: document.readyState === 'complete' || document.readyState === 'interactive', url: location.href || '' }; })()`).catch(() => null)
  if (raw && typeof raw === 'object') return raw as { ready?: boolean; url?: string }
  return { ready: false, url: '' }
}

export const waitForNavigation = async (
  id: string,
  input: { from?: string; expect?: string; timeout?: number; reload?: boolean },
) => {
  const timeout = Math.min(20000, Math.max(400, input.timeout ?? WAIT_TIMEOUT_MS))
  const started = Date.now()
  const from = String(input.from || '').split('#')[0]
  const expect = String(input.expect || '').trim()
  let url = await pageUrl(id)
  let sawUnready = false
  while (Date.now() - started < timeout) {
    const ready = await pageReady(id)
    url = ready.url || await pageUrl(id)
    const bare = url.split('#')[0]
    if (ready.ready === false) sawUnready = true
    const settled = ready.ready !== false && (sawUnready || Date.now() - started > 280)
    if (!settled) {
      await waitMs(WAIT_POLL_MS)
      continue
    }
    if (input.reload) return { ok: true, url }
    if (expect && urlMatches(url, expect)) return { ok: true, url }
    if (!expect && from && bare && bare !== from) return { ok: true, url }
    await waitMs(WAIT_POLL_MS)
  }
  url = await pageUrl(id)
  return { ok: Boolean(url), url, reason: 'timeout' as const }
}

export const waitForFunction = async (
  id: string,
  script: string,
  input: { timeout?: number; frame?: string; poll?: number } = {},
) => {
  const body = String(script || '').trim()
  if (!body) return { ok: false, reason: 'invalid' as const, error: '缺少函数' }
  const timeout = Math.min(20000, Math.max(400, input.timeout ?? WAIT_TIMEOUT_MS))
  const poll = Math.min(2000, Math.max(80, input.poll ?? WAIT_POLL_MS))
  const frame = String(input.frame || '').trim()
  const started = Date.now()
  let last: unknown = null
  while (Date.now() - started < timeout) {
    try {
      last = frame
        ? await evalBrowserViewInFrame(id, body, frame)
        : await evalBrowserViewMainIdle(id, body)
      if (last != null && isWaitTruthy(last)) {
        return { ok: true, value: last, url: await pageUrl(id) }
      }
    } catch {
      last = null
    }
    await waitMs(poll)
  }
  return { ok: false, reason: 'timeout' as const, error: '等待超时', value: last, url: await pageUrl(id) }
}

const ensureNetworkWatch = async (id: string) => {
  if (watched.has(id)) return true
  try {
    const raw = asObject(await callProtocol(id, 'network', { action: 'watch' }))
    if (raw.ok !== false) {
      watched.add(id)
      return true
    }
  } catch {
    // 非 CEF 走 performance timing
  }
  return false
}

const recentNetworkHits = async (id: string) => {
  try {
    const raw = asObject(await callProtocol(id, 'network', { action: 'recent' }))
    return (Array.isArray(raw.hits) ? raw.hits : []).map((item) => {
      const row = asObject(item)
      return {
        url: String(row.url || ''),
        status: Number(row.status) || 0,
        mime: String(row.mime || ''),
        type: String(row.type || ''),
        at: Number(row.at) || 0,
      }
    }).filter((item) => item.url)
  } catch {
    return []
  }
}

const timingHit = async (id: string, want: string) => {
  const raw = asObject(await evalBrowserViewMainIdle(id, `(function(){
    var want = ${JSON.stringify(want.toLowerCase())};
    var list = [];
    try { list = performance.getEntriesByType('resource') || []; } catch (e) {}
    for (var i = list.length - 1; i >= 0; i--) {
      var name = String((list[i] && list[i].name) || '');
      if (name && name.toLowerCase().indexOf(want) >= 0) {
        return { ok: true, url: name, via: 'timing' };
      }
    }
    return { ok: false };
  })()`).catch(() => null))
  if (raw.ok && raw.url) return { url: String(raw.url), status: 0, mime: '', type: '', at: Date.now(), via: 'timing' as const }
  return null
}

export type NetworkHit = {
  url: string
  status: number
  mime: string
  type: string
  at: number
  via?: string
}

const peekResponse = async (id: string, want: string, since: number, cdp: boolean): Promise<NetworkHit | null> => {
  if (cdp) {
    return (await recentNetworkHits(id)).find((item) => item.at >= since && responseMatches(item.url, want)) || null
  }
  return timingHit(id, want)
}

export const waitForResponse = async (
  id: string,
  input: { url: string; timeout?: number; lookback?: number },
) => {
  const want = String(input.url || '').trim()
  if (!want) return { ok: false, reason: 'invalid' as const, error: '缺少 response' }
  const timeout = Math.min(20000, Math.max(400, input.timeout ?? WAIT_TIMEOUT_MS))
  const lookback = Math.min(20000, Math.max(0, input.lookback ?? RESPONSE_LOOKBACK_MS))
  const started = Date.now()
  const since = started - lookback
  const cdp = await ensureNetworkWatch(id)
  while (Date.now() - started < timeout) {
    const hit = await peekResponse(id, want, since, cdp)
    if (hit) return { ok: true, url: await pageUrl(id), response: hit }
    await waitMs(WAIT_POLL_MS)
  }
  return { ok: false, reason: 'timeout' as const, error: '等待超时', url: await pageUrl(id) }
}

export const waitForBrowser = async (
  id: string,
  input: {
    url?: string
    text?: string
    selector?: string
    ref?: string
    locator?: BrowserLocator
    fn?: string
    response?: string
    frame?: string
    timeout?: number
  },
) => {
  const timeout = Math.min(20000, Math.max(400, input.timeout ?? WAIT_TIMEOUT_MS))
  const started = Date.now()
  const wantUrl = String(input.url || '').trim()
  const wantText = String(input.text || '').trim()
  const wantFn = String(input.fn || '').trim()
  const wantResponse = String(input.response || '').trim()
  const frame = String(input.frame || '').trim()
  let locator = input.locator || null
  if (!locator && input.selector) locator = { by: 'css', value: String(input.selector).trim(), frame: frame || undefined }
  if (!locator && input.ref) locator = await resolveRefLocator(id, String(input.ref))
  if (!wantUrl && !wantText && !locator && !wantFn && !wantResponse) {
    return { ok: false, error: '缺少 url / text / selector / ref / fn / response' }
  }
  const since = started - RESPONSE_LOOKBACK_MS
  const cdp = wantResponse ? await ensureNetworkWatch(id) : false
  let lastUrl = ''
  while (Date.now() - started < timeout) {
    lastUrl = await pageUrl(id)
    if (wantResponse) {
      const hit = await peekResponse(id, wantResponse, since, cdp)
      if (hit) return { ok: true, url: lastUrl, response: hit }
    }
    if (wantFn) {
      try {
        const value = frame
          ? await evalBrowserViewInFrame(id, wantFn, frame)
          : await evalBrowserViewMainIdle(id, wantFn)
        if (value != null && isWaitTruthy(value)) return { ok: true, url: lastUrl, value }
      } catch {
        // 下一轮再探
      }
    }
    if (wantUrl && urlMatches(lastUrl, wantUrl)) {
      return { ok: true, url: lastUrl }
    }
    if (wantText) {
      const found = await evalBrowserView(id, `(function(){
        var want = ${JSON.stringify(wantText)};
        var t = ((document.body && document.body.innerText) || '');
        return { ok: t.indexOf(want) >= 0, found: t.indexOf(want) >= 0, url: location.href || '' };
      })()`).catch(() => null) as { ok?: boolean; url?: string } | null
      if (found?.ok) return { ok: true, url: found.url || lastUrl }
      const probed = await probeOnBrowser(id, { by: 'text', value: wantText, frame: frame || undefined })
      if (probed.ok) return { ok: true, url: lastUrl, text: probed.text }
    }
    if (locator) {
      const ready = await probeOnBrowser(id, locator)
      if (ready.ok) return { ok: true, url: lastUrl, text: ready.text }
    }
    await waitMs(WAIT_POLL_MS)
  }
  return {
    ok: false,
    reason: 'timeout',
    error: '等待超时',
    url: lastUrl || await pageUrl(id),
  }
}

/** 动作做完把新快照交回去。超时用上一份缓存，并作废晚到的 CDP，避免暗中重编号。 */
export const attachActionSnapshot = async <T extends ActResult>(
  browserId: string,
  result: T,
  frame?: string,
): Promise<T> => {
  const id = String(browserId || '').trim()
  if (!id) return result
  const gen = beginPageSnap(id)
  const prev = cachedPageSnap(id)
  let timer = 0
  try {
    const page = await Promise.race([
      readBrowserPage(id, { frame: result.requiresRefresh ? undefined : frame,
        acted: !result.requiresRefresh, maxFrames: result.requiresRefresh ? 8 : 2, gen }),
      new Promise<null>((resolve) => {
        timer = window.setTimeout(() => resolve(null), result.requiresRefresh ? 4000 : actionSnapBudgetMs())
      }),
    ])
    if (!page) {
      abandonPageSnap(id, gen)
      const changedPage = result.url && prev?.url && result.url !== prev.url
      const clip = clipSnapshot(changedPage ? '' : prev?.snapshot || '')
      return {
        ...result,
        url: String(result.url || prev?.url || ''),
        ...(prev?.title ? { title: prev.title } : {}),
        ...(clip.text ? { snapshot: clip.text } : {}),
        snapshotStale: true,
        ...(clip.truncated ? { snapshotTruncated: true } : {}),
        hint: [result.hint, '新快照尚未就绪；缓存仅供参考，先 get_page 更新后再使用 ref。'].filter(Boolean).join(' '),
      }
    }
    if ('error' in page && page.error) {
      abandonPageSnap(id, gen)
      return { ...result, snapshotError: page.error, snapshotStale: true,
        hint: [result.hint, `动作后的页面读取失败：${page.error}。不能据此认定页面为空或操作已完成。`].filter(Boolean).join(' ') }
    }
    const clip = clipSnapshot(page.snapshot || '')
    return {
      ...result,
      url: String(page.url || result.url || ''),
      ...(page.title ? { title: page.title } : {}),
      ...(clip.text ? { snapshot: clip.text } : {}),
      ...(clip.truncated ? { snapshotTruncated: true } : {}),
      hint: [
        result.hint,
        clip.truncated ? '快照已截到约 80 行，其余用 browser_find。' : '',
        clip.text ? '点下一动作用本次 snapshot 里的 ref。' : '',
      ].filter(Boolean).join(' ') || result.hint,
    }
  } catch {
    abandonPageSnap(id, gen)
    const clip = clipSnapshot(prev?.snapshot || '')
    return {
      ...result,
      url: String(result.url || prev?.url || ''),
      ...(clip.text ? { snapshot: clip.text } : {}),
      snapshotStale: true,
      hint: [result.hint, '页面读取失败，缓存仅供参考；先 get_page 更新后再使用 ref。'].filter(Boolean).join(' '),
    }
  } finally {
    if (timer) window.clearTimeout(timer)
  }
}

export const observedJson = async (browserId: string, body: Record<string, unknown>, frame?: string) => (
  JSON.stringify(await attachActionSnapshot(browserId, body as ActResult, frame))
)

const readFocus = async (id: string) => {
  const raw = await evalBrowserView(id, `(function(){ var el = document.activeElement; if (!el || el === document.body) return ''; return String(el.id || el.getAttribute('name') || el.tagName || ''); })()`).catch(() => '')
  return typeof raw === 'string' ? raw : ''
}

export const observeAfterClick = async (
  id: string,
  result: ActResult,
  fromUrl: string,
  frame?: string,
  tabLimitSequence?: number,
): Promise<ActResult> => {
  const beforeSnap = cachedPageSnap(id)?.snapshot || ''
  let base: ActResult
  if (!result.ok) {
    base = {
      ...result,
      ok: false,
      error: result.error || '点击失败',
    }
  } else {
    const from = String(fromUrl || '').split('#')[0]
    const beforeFocus = lastFocus.get(id)
    const timeout = /passport2|\/login/i.test(from) ? 3500 : 900
    try {
      const nav = await waitForNavigation(id, { from, timeout })
      const url = String(nav.url || from)
      const navigated = Boolean(url && from && url.split('#')[0] !== from)
      if (navigated) noteCourseNavigation(id, from, url)
      const focus = await readFocus(id)
      if (focus) lastFocus.set(id, focus)
      base = {
        ok: true,
        text: result.text,
        url,
        navigated,
        focusChanged: beforeFocus != null && focus !== '' ? beforeFocus !== focus : undefined,
        hint: navigated ? `已跳到 ${url}` : undefined,
      }
    } catch {
      base = {
        ok: true,
        text: result.text,
        url: from,
        navigated: false,
      }
    }
  }
  const seen = await attachActionSnapshot(id, base, frame)
  const checked = withPopupTabLimit(id, seen, tabLimitSequence)
  if (checked.reason === 'tab_limit') return checked
  if (result.ok) {
    const landed = String(seen.url || '').split('#')[0]
    const from = String(fromUrl || '').split('#')[0]
    if (landed && from && landed !== from && !seen.navigated) {
      seen.navigated = true
      noteCourseNavigation(id, from, landed)
    }
    const after = String(seen.snapshot || '')
    const before = clipSnapshot(beforeSnap).text
    const frameScope = (text: string) => (text.match(/^- iframe .*$/gm) || []).sort().join('\n')
    const comparable = frameScope(before) === frameScope(after)
    seen.domChanged = Boolean(seen.navigated) || (!seen.snapshotStale && comparable && snapshotContentChanged(before, after))
  }
  return seen
}
