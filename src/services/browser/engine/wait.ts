import { invoke } from '@tauri-apps/api/core'
import { SAME_ORIGIN_FRAMES, askFrames, evalBrowserView, waitMs } from '../eval'
import { probeOnBrowser } from './act'
import { resolveRefLocator } from './refs'
import type { BrowserLocator } from './types'

const WAIT_POLL_MS = 150
const WAIT_TIMEOUT_MS = 8000

const hostPathOf = (value: string) => {
  try {
    const parsed = new URL(value)
    return `${parsed.hostname}${parsed.pathname}`.toLowerCase()
  } catch {
    return String(value || '').split(/[?#]/)[0].toLowerCase()
  }
}

/** mooc2 课程壳是 /mycourse/stu，目录页才是 studentcourse。等其中任一即到课。 */
const isCourseArrivalUrl = (url: string) => (
  /\/mycourse\/studentcourse|stucoursemiddle|\/mycourse\/stu(?:\?|$|\/|&)/i.test(url)
)

const wantsCourseArrival = (want: string) => (
  /studentcourse|stucoursemiddle|mycourse\/stu/i.test(want) && !/studentstudy/i.test(want)
)

const urlMatches = (url: string, want: string) => {
  const needle = String(want || '').trim().toLowerCase()
  if (!needle) return false
  if (wantsCourseArrival(needle) && isCourseArrivalUrl(url)) return true
  return hostPathOf(url).includes(needle)
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

export const waitForBrowser = async (
  id: string,
  input: {
    url?: string
    text?: string
    selector?: string
    ref?: string
    locator?: BrowserLocator
    timeout?: number
  },
) => {
  const timeout = Math.min(20000, Math.max(400, input.timeout ?? WAIT_TIMEOUT_MS))
  const started = Date.now()
  const wantUrl = String(input.url || '').trim()
  const wantText = String(input.text || '').trim()
  let locator = input.locator || null
  if (!locator && input.selector) locator = { by: 'css', value: String(input.selector).trim() }
  if (!locator && input.ref) locator = await resolveRefLocator(id, String(input.ref))
  if (!wantUrl && !wantText && !locator) {
    return { ok: false, error: '缺少 url / text / selector / ref' }
  }
  let lastUrl = ''
  let asked = false
  while (Date.now() - started < timeout) {
    lastUrl = await pageUrl(id)
    if (wantUrl && urlMatches(lastUrl, wantUrl)) {
      return { ok: true, url: lastUrl }
    }
    if (wantText) {
      if (!asked) {
        await askFrames(id, 'snap').catch(() => false)
        asked = true
      }
      const found = await evalBrowserView(id, `(function(){
        ${SAME_ORIGIN_FRAMES}
        var want = ${JSON.stringify(wantText)};
        var frames = __sameFrames(window, 0);
        for (var i = 0; i < frames.length; i++) {
          try {
            var t = ((frames[i].document.body && frames[i].document.body.innerText) || '');
            if (t.indexOf(want) >= 0) return { ok: true, url: location.href || '' };
          } catch (e) {}
        }
        var extras = window.__ZE_FRAME_SNAPS__ || [];
        for (var e = 0; e < extras.length; e++) {
          if (String((extras[e] && extras[e].text) || '').indexOf(want) >= 0) return { ok: true, url: location.href || '' };
        }
        return { ok: false, url: location.href || '' };
      })()`).catch(() => null) as { ok?: boolean; url?: string } | null
      if (found?.ok) return { ok: true, url: found.url || lastUrl }
      const probed = await probeOnBrowser(id, { by: 'text', value: wantText })
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
