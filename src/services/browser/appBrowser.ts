/** 标签 / eval / 点选。学习通动作不在这里，走 platform adapter。 */
import { invoke } from '@tauri-apps/api/core'
import { browserAutomationArgs } from './control'
import { ref } from 'vue'
import { evalBrowserViewMain } from './eval'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { clickByLocator, fillByLocator } from './engine/act'
import { clickLabelMatches } from './engine/clickFind'
import { pageSnapAbandoned, rememberPageSnap } from './engine/pageSnap'
import { publicRefs, rememberPageRefs, type PageRef } from './engine/refs'
import { formatAriaSnapshot } from './engine/snapshot'
import { askFrames, asObject, evalBrowserView, isCefEngine, waitMs } from './eval'
import { claimClickText, guardNavigate } from './pageHooks'
import { act, clearCookies, cookies, setCookies, wait } from './protocol'

export {
  SAME_ORIGIN_FRAMES,
  askFrames,
  asObject,
  browserEngine,
  evalBrowserFrames,
  evalBrowserView,
  evalBrowserViewInFrame,
  evalBrowserViewMain,
  isCefEngine,
  waitMs,
} from './eval'
export { evaluate } from './protocol'
export {
  hideNativeVideo,
  playNativeVideo,
  readNativeVideo,
  startNativeVideoLoop,
  stopNativeVideoLoop,
  tickNativeVideo,
} from './nativeVideo'

export type AppBrowser = {
  id: string
  name: string
  url: string
  title: string
  zoom: number
  createdAt: number
  updatedAt: number
}

export const MIN_BROWSER_ZOOM = 0.5
export const MAX_BROWSER_ZOOM = 2
export const BROWSER_ZOOM_STEP = 0.1

export const clampBrowserZoom = (value: unknown) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return 1
  return Math.min(MAX_BROWSER_ZOOM, Math.max(MIN_BROWSER_ZOOM, Math.round(n * 10) / 10))
}

export type BrowserPageState = {
  id: string
  url: string
  title: string
}

export type BrowserLoadState = {
  id: string
  phase: 'started' | 'finished' | string
  url: string
}

export type BrowserBounds = {
  x: number
  y: number
  width: number
  height: number
  layout?: {
    viewportWidth: number; viewportHeight: number
    paddingRatio: number; paddingMin: number; paddingMax: number
    compactBreakpoint: number; compactPadding: number
  }
}

const STORAGE_KEY = 'zerror-app-browsers'
const SELECTED_KEY = 'zerror-app-browser-selected'

const createId = () => {
  const raw = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  return raw.replace(/[^a-zA-Z0-9]/g, '') || `${Date.now()}`
}

export const isBrowserHome = (value: string) => {
  const raw = String(value || '').trim()
  return !raw || raw === 'zerror://home' || /\/browser-home\.html(?:$|[?#])/.test(raw)
}

export const browserHomeUrl = () => {
  try {
    return new URL('/browser-home.html', window.location.origin).href
  } catch {
    return 'zerror://home'
  }
}

export const normalizeBrowserUrl = (value: string) => {
  const raw = String(value || '').trim()
  if (isBrowserHome(raw)) return browserHomeUrl()
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(raw)) return raw
  return `https://${raw}`
}

export const hostnameOf = (value: string) => {
  if (isBrowserHome(value)) return '导航'
  try {
    return new URL(normalizeBrowserUrl(value)).hostname.replace(/^www\./, '')
  } catch {
    return value || '导航'
  }
}

const readList = (): AppBrowser[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .map((item) => ({
        id: String(item?.id || ''),
        name: String(item?.name || '').trim(),
        url: String(item?.url || '').trim() || browserHomeUrl(),
        title: String(item?.title || '').trim(),
        zoom: clampBrowserZoom(item?.zoom),
        createdAt: Number(item?.createdAt) || Date.now(),
        updatedAt: Number(item?.updatedAt) || Date.now(),
      }))
      .filter((item) => item.id)
  } catch {
    return []
  }
}

const writeList = (items: AppBrowser[]) => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
}

export const listAppBrowsers = () => readList().sort((a, b) => a.createdAt - b.createdAt || a.updatedAt - b.updatedAt)

/** 本地记住的地址，不打 CDP。等 url / 回执用这个，避免和播放抢通道。 */
export const peekAppBrowser = (id: string) => readList().find((item) => item.id === id) || null

export const peekAppBrowserUrl = (id: string) => String(peekAppBrowser(id)?.url || '')

export const ensureDefaultBrowsers = () => {
  const home = browserHomeUrl()
  const items = readList().map((item) => (
    /bing\.com/i.test(item.url)
      ? { ...item, url: home, name: item.name === 'www.bing.com' || item.name === 'bing.com' ? '导航' : item.name }
      : item
  ))
  if (items.length) {
    writeList(items)
    const selected = getSelectedBrowserId()
    if (!items.some((item) => item.id === selected)) setSelectedBrowserId(items[0].id)
    return listAppBrowsers()
  }
  createAppBrowser({ name: '导航', url: home, title: '导航' })
  return listAppBrowsers()
}

export const getSelectedBrowserId = () => localStorage.getItem(SELECTED_KEY) || ''

export const setSelectedBrowserId = (id: string) => {
  if (id) localStorage.setItem(SELECTED_KEY, id)
  else localStorage.removeItem(SELECTED_KEY)
}

export const createAppBrowser = (input?: Partial<AppBrowser> & { id?: string }) => {
  const now = Date.now()
  const url = normalizeBrowserUrl(input?.url || browserHomeUrl())
  const next: AppBrowser = {
    id: String(input?.id || '').trim() || createId(),
    name: String(input?.name || '').trim() || hostnameOf(url),
    url,
    title: String(input?.title || '').trim(),
    zoom: clampBrowserZoom(input?.zoom),
    createdAt: input?.createdAt || now,
    updatedAt: now,
  }
  writeList([...readList().filter((item) => item.id !== next.id), next])
  setSelectedBrowserId(next.id)
  return next
}

export const upsertAppBrowser = (input: Partial<AppBrowser> & { id?: string }) => {
  const items = readList()
  const now = Date.now()
  const id = String(input.id || '').trim()
  if (!id) return createAppBrowser(input)
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) return createAppBrowser({ ...input, id })
  const prev = items[index]
  const url = normalizeBrowserUrl(input.url || prev.url)
  items[index] = {
    ...prev,
    name: String(input.name || prev.name || '').trim() || hostnameOf(url),
    url,
    title: String(input.title ?? prev.title ?? '').trim(),
    zoom: clampBrowserZoom(input.zoom ?? prev.zoom),
    updatedAt: now,
  }
  writeList(items)
  return items[index]
}

export const patchAppBrowser = (id: string, patch: Partial<Pick<AppBrowser, 'name' | 'url' | 'title' | 'zoom'>>) => {
  const items = readList()
  const index = items.findIndex((item) => item.id === id)
  if (index < 0) return null
  items[index] = {
    ...items[index],
    ...patch,
    zoom: clampBrowserZoom(patch.zoom ?? items[index].zoom),
    id: items[index].id,
    createdAt: items[index].createdAt,
    updatedAt: items[index].updatedAt,
  }
  writeList(items)
  return items[index]
}

export const removeAppBrowser = (id: string) => {
  writeList(readList().filter((item) => item.id !== id))
  if (getSelectedBrowserId() === id) setSelectedBrowserId('')
}

export const hostBounds = (el: HTMLElement | null): BrowserBounds | null => {
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (rect.width < 8 || rect.height < 8) return null
  return {
    x: Math.round(rect.left),
    y: Math.round(rect.top),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  }
}

export const openBrowserView = (id: string, url: string, bounds: BrowserBounds, hidden = false) => {
  const blocked = guardNavigate(url)
  if (blocked) return Promise.reject(new Error(blocked))
  return invoke('browser_open', { id, url: normalizeBrowserUrl(url), ...bounds, hidden })
}

let boundsFlight: Promise<void> | null = null
let boundsQueued: { id: string; bounds: BrowserBounds; notify: boolean } | null = null

/** 拖窗口/分栏时只保留最新一帧。网页 was_resized 由原生洞口 view 负责，这里默认不 notify。 */
export const setBrowserBounds = (id: string, bounds: BrowserBounds, notify = false) => {
  boundsQueued = { id, bounds, notify }
  if (boundsFlight) return boundsFlight
  boundsFlight = (async () => {
    try {
      while (boundsQueued) {
        const job = boundsQueued
        boundsQueued = null
        await invoke('browser_set_bounds', { id: job.id, ...job.bounds, notify: job.notify })
      }
    } finally {
      boundsFlight = null
    }
  })()
  return boundsFlight
}

export const showBrowserView = (id: string) => invoke('browser_show', { id })
export const hideBrowserView = (id: string) => invoke('browser_hide', { id })
export const hideAllBrowserViews = () => invoke('browser_hide_all')
export const closeBrowserView = async (id: string) => {
  await invoke('browser_close', { id })
  const next = { ...browserAudioMuted.value }
  delete next[id]
  browserAudioMuted.value = next
}
/** 当前应用进程内每个标签页的原生静音状态；页面导航和刷新不会重置。 */
export const browserAudioMuted = ref<Record<string, boolean>>({})
export const setBrowserAudioMuted = async (id: string, muted: boolean) => {
  await invoke('browser_set_audio_muted', { id, muted })
  browserAudioMuted.value = { ...browserAudioMuted.value, [id]: muted }
}
export const navigateBrowserView = (id: string, url: string, userInitiated = false) => {
  const blocked = guardNavigate(url)
  if (blocked) return Promise.reject(new Error(blocked))
  return invoke('browser_navigate', { id, url: normalizeBrowserUrl(url), ...(userInitiated ? { userInitiated } : browserAutomationArgs(id)) })
}
const loadPhase = new Map<string, { phase: string; at: number; url: string }>()
let loadWatch: Promise<UnlistenFn> | null = null

export const trackBrowserLoads = () => watchBrowserLoad()

const watchBrowserLoad = () => {
  if (!loadWatch) {
    loadWatch = listen<BrowserLoadState>('app-browser-load', (event) => {
      const state = event.payload
      if (!state?.id) return
      loadPhase.set(state.id, {
        phase: String(state.phase || ''),
        at: Date.now(),
        url: String(state.url || ''),
      })
    })
  }
  return loadWatch
}

/** 只有主文档真的在刷新时才等。切章是同页换 iframe，不能把 leftover started 当成整页重载。 */
export const waitForBrowserIdle = async (id: string, maxMs = 8_000) => {
  await watchBrowserLoad()
  const started = Date.now()
  const row = () => loadPhase.get(id)
  if (row()?.phase !== 'started') return
  while (Date.now() - started < maxMs) {
    const hit = row()
    if (hit?.phase === 'finished' && hit.at >= started - 80) {
      await waitMs(400)
      return
    }
    await waitMs(120)
  }
}

export const reloadBrowserView = async (id: string, userInitiated = false) => {
  await watchBrowserLoad()
  loadPhase.set(id, { phase: 'started', at: Date.now(), url: '' })
  await invoke('browser_reload', { id, ...(userInitiated ? { userInitiated } : browserAutomationArgs(id)) })
  await waitForBrowserIdle(id)
}
export const goBackBrowserView = (id: string, userInitiated = false) => invoke('browser_go_back', { id, ...(userInitiated ? { userInitiated } : browserAutomationArgs(id)) })
export const goForwardBrowserView = (id: string, userInitiated = false) => invoke('browser_go_forward', { id, ...(userInitiated ? { userInitiated } : browserAutomationArgs(id)) })
export const setBrowserZoom = (id: string, zoom: number) => (
  invoke('browser_set_zoom', { id, zoom: clampBrowserZoom(zoom) })
)

export const getBrowserState = (id: string) => invoke<BrowserPageState>('browser_get_state', { id })

export const screenshotBrowserView = async (id: string) => {
  const shot = asObject(await invoke('browser_screenshot', { id }))
  const image = String(shot.image || '')
  if (!image.startsWith('data:image/')) {
    throw new Error(String(shot.error || '截图失败'))
  }
  return {
    url: String(shot.url || ''),
    image,
  }
}

export const readBrowserFrameSrcs = async (id: string) => {
  const raw = await evalBrowserViewMain(id, `(function(){
    var out = [];
    try {
      var list = document.querySelectorAll('iframe[src]');
      for (var i = 0; i < list.length && out.length < 8; i++) {
        var el = list[i];
        var live = '';
        try { live = String((el.contentWindow && el.contentWindow.location && el.contentWindow.location.href) || ''); } catch (eLive) {}
        out.push(live || String(el.src || ''));
      }
    } catch (e) {}
    return out;
  })()`).catch(() => [])
  return (Array.isArray(raw) ? raw : []).map((item) => String(item || '')).filter(Boolean)
}

export type ReadPageOptions = {
  controlEpoch?: number
  /** 只附带网址里包含这段的那个子 frame（动作后）。 */
  frame?: string
  /** 只拍顶层；有 frame 时再加那一个子 frame。 */
  acted?: boolean
  /** get_page 的子 frame 上限，最大 8。 */
  maxFrames?: number
  /** 超时作废时不要把晚到的结果写进 ref 缓存。 */
  gen?: number
}

/** Playwright 风格可读快照：role / name / ref，不灌 innerText、不塞站点解析器。 */

export const readBrowserPage = async (id: string, opts: ReadPageOptions = {}) => {
  try {
    const { callProtocol } = await import('./protocol')
    const cdp = asObject(await callProtocol(id, 'snapshot', {
      ...(opts.frame ? { frame: opts.frame } : {}),
      ...(opts.acted ? { acted: true } : {}),
      maxFrames: opts.acted ? 2 : (opts.maxFrames ?? 8),
    }, opts.controlEpoch == null ? undefined : { expectedEpoch: opts.controlEpoch }))
    const refs = (Array.isArray(cdp.refs) ? cdp.refs : []) as PageRef[]
    const commit = opts.gen == null || !pageSnapAbandoned(id, opts.gen)
    if (commit) rememberPageRefs(id, refs)
    const frames = (Array.isArray(cdp.frames) ? cdp.frames : []).map((item) => {
      const row = asObject(item)
      return {
        url: String(row.url || ''),
        priority: Number(row.priority) || 0,
        snapshot: String(row.snapshot || ''),
        refCount: Number(row.refCount) || 0,
      }
    }).filter((item) => item.url || item.snapshot)
    const preferred = asObject(cdp.preferredFrame)
    const page = {
      url: String(cdp.url || ''),
      title: String(cdp.title || ''),
      snapshot: String(cdp.snapshot || '') || formatAriaSnapshot(refs),
      refs: publicRefs(refs),
      captcha: Boolean(cdp.captcha),
      iframes: (Array.isArray(cdp.iframes) ? cdp.iframes : []).map((item) => {
        if (typeof item === 'string') return { id: '', src: item }
        const row = asObject(item)
        return { id: String(row.id || ''), src: String(row.src || '') }
      }).filter((item) => item.src),
      frames,
      preferredFrame: preferred.url
        ? {
          url: String(preferred.url || ''),
          priority: Number(preferred.priority) || 0,
          snapshot: String(preferred.snapshot || ''),
          refCount: Number(preferred.refCount) || 0,
        }
        : null,
      framesCapped: Boolean(cdp.framesCapped),
    }
    if (commit) {
      rememberPageSnap(id, {
        url: page.url,
        title: page.title,
        snapshot: page.snapshot,
        refs,
      }, opts.gen)
    }
    return page
  } catch (error) {
    const state = await getBrowserState(id).catch(() => null)
    return {
      url: String(state?.url || ''),
      title: String(state?.title || ''),
      snapshot: '',
      refs: publicRefs([]),
      captcha: false,
      iframes: [],
      frames: [],
      preferredFrame: null,
      framesCapped: false,
      error: String((error as Error)?.message || error || '页面读取失败'),
    }
  }
}

export const clickBrowserElement = async (id: string, selector: string) => {
  try {
    const acted = await clickByLocator(id, { by: 'css', value: selector })
    if (acted.ok) return { ok: true, text: String(acted.text || ''), via: 'cdp' }
    return { ok: false, error: String(acted.error || '没有找到元素') }
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error || '点击失败') }
  }
}

export const clickBrowserText = async (id: string, text: string) => {
  const want = String(text || '').trim()
  const claimed = await claimClickText(id, want)
  if (claimed) return claimed
  try {
    const acted = await act(id, { op: 'click', at: { by: 'text', value: want } })
    const got = String(acted.text || '')
    if (acted.ok && (clickLabelMatches(want, got) || !got)) return { ok: true, text: got || want, via: 'cdp' }
    if (acted.ok && got) return { ok: false, error: `点到的是「${got}」，不是「${want}」`, text: got }
    const err = acted.error ? String(acted.error) : ''
    if (err.includes('点到的是')) return { ok: false, error: err, text: got }
    return { ok: false, error: err || `没有找到「${want}」`, text: got }
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error || `没有找到「${want}」`) }
  }
}

export const typeBrowserElement = async (id: string, selector: string, text: string) => {
  try {
    const acted = await fillByLocator(id, { by: 'css', value: selector }, text)
    if (acted.ok && acted.filled !== false) return { ...acted, via: 'cdp' }
    if (acted.ok === false) return acted
    return { ok: false, error: String(acted.error || '没有找到输入框'), filled: false, length: 0 }
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error || '没有找到输入框'), filled: false, length: 0 }
  }
}

export const scrollBrowserView = async (id: string, amount: number) => {
  const acted = await act(id, { op: 'scroll', amount: Number(amount) || 0 })
  if (acted.ok) return { ok: true, via: 'cdp' }
  return { ok: false, error: String(acted.error || '滚动失败') }
}

export const hoverBrowserElement = async (id: string, input: { text?: string; selector?: string }) => {
  const selector = String(input.selector || '').trim()
  const text = String(input.text || '').trim()
  if (!selector && !text) return { ok: false, error: 'hover 缺少定位', via: 'cdp' }
  const acted = await act(id, {
    op: 'hover',
    at: selector ? { by: 'css', value: selector } : { by: 'text', value: text },
  })
  return {
    ok: Boolean(acted.ok),
    text: String(acted.text || text),
    error: acted.error,
    via: 'cdp',
  }
}

export const pressBrowserKey = async (id: string, key: string) => {
  const acted = await act(id, { op: 'press', key })
  return {
    ok: Boolean(acted.ok),
    text: String(acted.text || key),
    error: acted.error,
    via: 'cdp',
  }
}

export const readBrowserCookies = (id: string, url?: string) => cookies(id, url)
export const setBrowserCookies = (
  id: string,
  list: Parameters<typeof setCookies>[1],
  url?: string,
) => setCookies(id, list, url)
export const clearBrowserCookies = (
  id: string,
  filter?: { name?: string; url?: string; domain?: string },
) => clearCookies(id, filter)

export const waitForPage = (
  id: string,
  input: {
    url?: string
    text?: string
    selector?: string
    ref?: string
    fn?: string
    response?: string
    frame?: string
    timeout?: number
  },
) => wait(id, input)

export const dblclickBrowserElement = async (id: string, selector: string) => {
  const acted = await act(id, { op: 'dblclick', at: { by: 'css', value: selector } })
  return { ok: Boolean(acted.ok), text: acted.text, error: acted.error, via: 'cdp' }
}

export const rightclickBrowserElement = async (id: string, input: { text?: string; selector?: string }) => {
  const selector = String(input.selector || '').trim()
  const text = String(input.text || '').trim()
  if (!selector && !text) return { ok: false, error: 'rightclick 缺少定位', via: 'cdp' }
  const acted = await act(id, {
    op: 'rightclick',
    at: selector ? { by: 'css', value: selector } : { by: 'text', value: text },
  })
  return { ok: Boolean(acted.ok), text: acted.text, error: acted.error, via: 'cdp' }
}

export const checkBrowserElement = async (id: string, selector: string) => {
  const acted = await act(id, { op: 'check', at: { by: 'css', value: selector } })
  return { ok: Boolean(acted.ok), text: acted.text, error: acted.error, via: 'cdp' }
}

export const uncheckBrowserElement = async (id: string, selector: string) => {
  const acted = await act(id, { op: 'uncheck', at: { by: 'css', value: selector } })
  return { ok: Boolean(acted.ok), text: acted.text, error: acted.error, via: 'cdp' }
}

export const selectBrowserOption = async (id: string, selector: string, value: string) => {
  const acted = await act(id, { op: 'select', at: { by: 'css', value: selector }, value })
  return { ok: Boolean(acted.ok), text: acted.text, error: acted.error, via: 'cdp' }
}


export const setAppAbovePage = (above: boolean, id?: string) => (
  invoke('browser_set_app_above_page', { above, id: id || null })
)

export const setBrowserAbstractionOverlay = (id: string, html: string | null) => (
  evalBrowserView(id, `(function(){
    var old = document.getElementById('__ze_abs_root');
    if (old && old.parentNode) old.parentNode.removeChild(old);
    var html = ${JSON.stringify(html)};
    if (!html) return { ok: true };
    var root = document.createElement('div');
    root.id = '__ze_abs_root';
    root.setAttribute('data-ze-abs', '1');
    var style = document.createElement('style');
    style.textContent = '#__ze_abs_root{position:fixed;inset:0;z-index:2147483647;pointer-events:none;font-family:-apple-system,BlinkMacSystemFont,sans-serif;}'
      + '#__ze_abs_root .ze-abs-menu{pointer-events:auto;position:absolute;top:12px;left:50%;transform:translateX(-50%);width:min(420px,calc(100% - 24px));max-height:min(42vh,340px);overflow:auto;padding:10px;border-radius:14px;border:1px solid rgba(0,0,0,.08);background:rgba(255,255,255,.96);box-shadow:0 10px 28px rgba(0,0,0,.12);}'
      + '#__ze_abs_root .ze-abs-card{margin:0 0 8px;padding:10px 12px;border-radius:12px;border:1px solid rgba(0,0,0,.08);background:rgba(245,245,247,.7);}'
      + '#__ze_abs_root .ze-abs-card.is-current{border-color:rgba(102,126,234,.34);background:rgba(102,126,234,.06);}'
      + '#__ze_abs_root .ze-abs-title{font-size:13px;font-weight:600;color:#2d3748;}'
      + '#__ze_abs_root .ze-abs-title span{margin-left:8px;padding:0 6px;border-radius:999px;background:rgba(102,126,234,.14);color:#667eea;font-size:11px;font-weight:500;}'
      + '#__ze_abs_root .ze-abs-tool{display:flex;gap:6px;align-items:baseline;margin-top:4px;font-size:12px;color:#718096;}'
      + '#__ze_abs_root .ze-abs-tool small{font-size:11px;color:#94a3b8;}'
      + '#__ze_abs_root .ze-abs-tool code{font-family:ui-monospace,Menlo,monospace;font-size:11px;color:#2d3748;}'
      + '#__ze_abs_root p{margin:4px 0 0;font-size:12px;color:#718096;line-height:1.4;}'
      + '#__ze_abs_root .ze-abs-list,#__ze_abs_root .ze-abs-works{margin:8px 0 0;padding:0;list-style:none;}'
      + '#__ze_abs_root .ze-abs-list li{display:flex;gap:8px;margin:0 0 6px;font-size:12px;color:#2d3748;}'
      + '#__ze_abs_root .ze-abs-list b{flex:0 0 18px;color:#94a3b8;font-weight:500;}'
      + '#__ze_abs_root .ze-abs-list i,#__ze_abs_root .ze-abs-list em{font-style:normal;margin-right:4px;font-size:11px;color:#718096;}'
      + '#__ze_abs_root .ze-abs-opts{margin-top:3px;display:flex;flex-wrap:wrap;gap:6px 10px;font-size:11px;color:#718096;}'
      + '#__ze_abs_root .ze-abs-opts .is-on{color:#667eea;}'
      + '#__ze_abs_root .ze-abs-works li{display:flex;justify-content:space-between;gap:10px;margin:0 0 4px;font-size:12px;color:#2d3748;}'
      + '#__ze_abs_root .ze-abs-empty{padding:16px 8px;font-size:12px;color:#94a3b8;}';
    var menu = document.createElement('div');
    menu.className = 'ze-abs-menu';
    menu.innerHTML = html;
    root.appendChild(style);
    root.appendChild(menu);
    (document.documentElement || document.body).appendChild(root);
    return { ok: true };
  })()`).catch(() => null)
)

export const listenBrowserState = (handler: (state: BrowserPageState) => void): Promise<UnlistenFn> => (
  listen<BrowserPageState>('app-browser-state', (event) => {
    if (event.payload) handler(event.payload)
  })
)

export const listenBrowserLoad = (handler: (state: BrowserLoadState) => void): Promise<UnlistenFn> => (
  listen<BrowserLoadState>('app-browser-load', (event) => {
    if (event.payload) handler(event.payload)
  })
)

export const listenBrowserOpened = (handler: (state: BrowserPageState & { openerId?: string }) => void): Promise<UnlistenFn> => (
  listen<BrowserPageState & { openerId?: string }>('app-browser-opened', (event) => {
    if (event.payload) handler(event.payload)
  })
)
