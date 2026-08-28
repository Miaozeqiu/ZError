import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import { CHAOXING_STUDY_INSPECT } from './skills/chaoxingStudy'
import { SAME_ORIGIN_FRAMES, askFrames, asObject, evalBrowserView, waitMs } from './eval'

export {
  SAME_ORIGIN_FRAMES,
  askFrames,
  asObject,
  evalBrowserView,
  waitMs,
} from './eval'
export type { ChaoxingHomeworkInfo, HomeworkLiveState } from '../chaoxing/homework'
export {
  applyHomeworkLiveState,
  fillChaoxingHomework,
  inspectChaoxingHomework,
  installHomeworkLiveSync,
  openChaoxingHomeworkItem,
  openChaoxingHomeworkList,
  pickHomeworkOption,
  readHomeworkLiveState,
  saveChaoxingHomework,
  submitChaoxingHomework,
} from '../chaoxing/homework'
export type { ChaoxingChapterSnap, ChaoxingVideoInfo, ChaoxingVideoTick } from '../chaoxing/study'
export {
  dumpChaoxingParseHtml,
  fillChaoxingCaptcha,
  installChaoxingChapterHook,
  installChaoxingVideoHook,
  openChaoxingChapter,
  openChaoxingChapters,
  openNextChaoxingChapter,
  openNextChaoxingStep,
  parseChaoxingChapters,
  playChaoxingVideo,
  readChaoxingCaptcha,
  readChaoxingCaptchaImage,
  readChaoxingChapterSnap,
  readChaoxingChapterTick,
  readChaoxingVideo,
  readChaoxingVideoTick,
  refreshChaoxingCaptcha,
  studyChaoxingUnfinished,
  videoIsPlaying,
} from '../chaoxing/study'

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

export type BrowserBounds = {
  x: number
  y: number
  width: number
  height: number
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

export const openBrowserView = (id: string, url: string, bounds: BrowserBounds) => (
  invoke('browser_open', { id, url: normalizeBrowserUrl(url), ...bounds })
)

export const setBrowserBounds = (id: string, bounds: BrowserBounds) => (
  invoke('browser_set_bounds', { id, ...bounds })
)

export const showBrowserView = (id: string) => invoke('browser_show', { id })
export const hideBrowserView = (id: string) => invoke('browser_hide', { id })
export const hideAllBrowserViews = () => invoke('browser_hide_all')
export const closeBrowserView = (id: string) => invoke('browser_close', { id })
export const navigateBrowserView = (id: string, url: string) => (
  invoke('browser_navigate', { id, url: normalizeBrowserUrl(url) })
)
export const reloadBrowserView = (id: string) => invoke('browser_reload', { id })
export const goBackBrowserView = (id: string) => invoke('browser_go_back', { id })
export const goForwardBrowserView = (id: string) => invoke('browser_go_forward', { id })
export const setBrowserZoom = (id: string, zoom: number) => (
  invoke('browser_set_zoom', { id, zoom: clampBrowserZoom(zoom) })
)

export const getBrowserState = (id: string) => invoke<BrowserPageState>('browser_get_state', { id })

/** Walk same-origin iframes. Chaoxing's player sits two frames down. */

export const readBrowserPage = async (id: string) => {
  await askFrames(id, 'snap')
  return evalBrowserView(id, `${SAME_ORIGIN_FRAMES}
(function(){
  var frames = __sameFrames(window, 0);
  var iframeText = [];
  var catalogText = '';
  var homeworkText = '';
  var taskOnly = false;
  for (var i = 1; i < frames.length && iframeText.length < 6; i++) {
    try {
      var frameText = ((frames[i].document.body && frames[i].document.body.innerText) || '').trim();
      if (!frameText) continue;
      var frameHref = '';
      try { frameHref = (frames[i].location && frames[i].location.href) || ''; } catch (e) {}
      var kind = /studentcourse/.test(frameHref) || /已完成任务点/.test(frameText) ? '章节'
        : (/暂无任务|默认班级/.test(frameText) && !/已完成任务点/.test(frameText)) ? '任务'
        : '其他';
      if (kind === '任务') taskOnly = true;
      if (kind === '章节' && frameText.length > catalogText.length) catalogText = frameText;
      iframeText.push('[' + kind + '] ' + frameText.slice(0, 4000));
    } catch (e) {}
  }
  var extras = window.__ZE_FRAME_SNAPS__ || [];
  for (var e = 0; e < extras.length; e++) {
    var item = extras[e] || {};
    var extraText = String(item.text || '').trim();
    if (!extraText) continue;
    var extraKind = item.kind === 'catalog' || /已完成任务点/.test(extraText) ? '章节'
      : item.kind === 'work' || /作业列表|待做|doHomeWork|mooc2\\/work/.test(extraText + String(item.href || '')) ? '作业'
      : item.kind === 'task' ? '任务' : '其他';
    if (extraKind === '任务') taskOnly = true;
    if (extraKind === '章节' && extraText.length > catalogText.length) catalogText = extraText;
    if (extraKind === '作业' && extraText.length > homeworkText.length) homeworkText = extraText;
    iframeText.push('[' + extraKind + '] ' + extraText.slice(0, 4000));
  }
  var chaoxing = null;
  try {
    if (String(location.host).indexOf('chaoxing.com') >= 0) {
      chaoxing = (${CHAOXING_STUDY_INSPECT});
    }
  } catch (e) {
    chaoxing = { error: String(e && e.message || e) };
  }
  var topText = ((document.body && document.body.innerText) || '');
  var title = String(document.title || '');
  if (title.indexOf('ZRRESULT:') === 0) title = '';
  var captcha = !!(document.querySelector('#ucode, .yzmInp, form[action*="processVerify"]')
    || /请输入图片中的验证码|【\\s*9010\\s*】/.test(topText + catalogText));
  var text = captcha
    ? ('【验证码】学习通要求输入图片验证码（9010）。自己认图读出 4 位字母或数字，调用 browser_chaoxing_captcha 提交，然后继续刷课。不要问用户，不要 browser_wait。\\n\\n' + topText.slice(0, 4000))
    : homeworkText
    ? (topText.slice(0, 2000) + '\\n\\n【作业】\\n' + homeworkText.slice(0, 11000))
    : catalogText
    ? (topText.slice(0, 2500) + '\\n\\n【章节目录】\\n' + catalogText.slice(0, 11000))
    : (taskOnly
      ? (topText.slice(0, 2500) + '\\n\\n【注意】当前 iframe 是「任务」页（暂无任务），不是章节目录。先点「章节」等目录出现「已完成任务点」再读。')
      : topText.slice(0, 14000));
  return {
    url: location.href,
    title: title,
    text: text,
    iframeText: iframeText,
    catalogText: catalogText.slice(0, 11000),
    onTaskTab: taskOnly && !catalogText,
    headings: Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 20).map(function(el){ return (el.innerText || '').trim() }).filter(Boolean),
    links: Array.from(document.querySelectorAll('a[href]')).slice(0, 30).map(function(a){
      return { text: ((a.innerText || '').trim()).slice(0, 80), href: a.href }
    }).filter(function(item){ return item.text || item.href }),
    iframes: Array.from(document.querySelectorAll('iframe[src]')).slice(0, 8).map(function(el){
      return { id: el.id || '', src: el.src || '' }
    }),
    notices: ['#loginTip', '#phoneMsg', '#pwdMsg', '#quickCodeMsg'].map(function(sel){
      var el = document.querySelector(sel);
      var text = el && ((el.innerText || '').trim());
      if (!el || !text) return null;
      return { selector: sel, text: text.slice(0, 120) };
    }).filter(Boolean),
    captcha: captcha,
    chaoxing: chaoxing,
    chapters: (typeof window !== 'undefined' && window.__ZE_CHAPTERS__) || null
  };
})()`)
}

export const clickBrowserElement = (id: string, selector: string) => evalBrowserView(id, `${SAME_ORIGIN_FRAMES}
(function(){
  var el = __findEl(${JSON.stringify(selector)});
  if (!el) return { ok: false, error: '没有找到元素' };
  __clickEl(el);
  return { ok: true, text: ((el.innerText || el.value || el.getAttribute('title') || '') + '').slice(0, 80) };
})()`)

export const clickBrowserText = async (id: string, text: string) => {
  const want = String(text || '').trim()
  const localRaw = await evalBrowserView(id, `${SAME_ORIGIN_FRAMES}
(function(){
  var want = ${JSON.stringify(want)};
  if (!want) return { ok: false, error: '缺少文案' };
  var compact = function(value){ return String(value || '').replace(/\\s+/g, '') };
  var target = compact(want.replace(/[（(]\\s*\\d+\\s*[）)]\\s*$/g, ''));
  var frames = __sameFrames(window, 0);
  var exactLink = null;
  var exact = null;
  var fuzzyLink = null;
  var fuzzy = null;
  var linkHref = '';
  for (var i = 0; i < frames.length; i++) {
    try {
      var nodes = frames[i].document.querySelectorAll('a, button, [role="tab"], [role="button"], span, div, li, h3, h4');
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        var label = compact(el.getAttribute('title') || el.innerText || el.textContent || '');
        if (!label) continue;
        var href = __navHref(el);
        var isExact = label === target;
        var isFuzzy = !isExact && label.length <= 48 && label.indexOf(target) >= 0;
        if (!isExact && !isFuzzy) continue;
        if (href && /stucoursemiddle|mycourse|studentstudy|courseid=|work/.test(href)) {
          if (isExact && !exactLink) { exactLink = el; linkHref = href; }
          else if (!fuzzyLink) { fuzzyLink = el; if (!linkHref) linkHref = href; }
        }
        if (isExact && !exact) exact = el;
        else if (isFuzzy && !fuzzy) fuzzy = el;
      }
    } catch (e) {}
  }
  var hit = exactLink || fuzzyLink || exact || fuzzy;
  if (!hit) return { ok: false, error: '没有找到「' + want + '」' };
  var a = hit.tagName === 'A' ? hit : (hit.closest ? hit.closest('a') : null);
  var href = linkHref || __navHref(a || hit);
  __clickEl(a || hit);
  if (href) {
    try {
      var win = ((a || hit).ownerDocument && (a || hit).ownerDocument.defaultView) || window;
      var cur = '';
      try { cur = String((win && win.location && win.location.href) || ''); } catch (e0) {}
      if (/studentstudy/i.test(cur) && /studentstudy|chapterId=/i.test(href)) href = '';
      else if (win && win.location && win.location.href.indexOf(href) < 0) win.location.assign(href);
    } catch (e) {}
  }
  return {
    ok: true,
    text: ((hit.innerText || hit.getAttribute('title') || '') + '').replace(/\\s+/g, ' ').trim().slice(0, 80),
    href: href || '',
  };
})()`)
  const local = localRaw && typeof localRaw === 'object' ? localRaw as { ok?: boolean; text?: string; error?: string; href?: string } : {}
  if (local.ok) {
    const href = String(local.href || '').trim()
    if (/^https?:/i.test(href) && /stucoursemiddle|mycourse|studentstudy|courseid=/.test(href)) {
      const before = String((await getBrowserState(id).catch(() => null))?.url || '')
      if (/studentstudy/i.test(before) && /studentstudy/i.test(href)) return local
      await waitMs(500)
      const after = String((await getBrowserState(id).catch(() => null))?.url || '')
      const moved = after && before && after.split('#')[0] !== before.split('#')[0]
      if (!moved) {
        await navigateBrowserView(id, href)
        return { ...local, via: 'href' }
      }
    }
    return local
  }
  await askFrames(id, 'click', { text: want })
  const clicked = await evalBrowserView(id, `(function(){ return { ok: !!window.__ZE_CLICKED__, text: window.__ZE_CLICKED__ || '', href: window.__ZE_CLICKED_HREF__ || '' }; })()`).catch(() => null) as { ok?: boolean; text?: string; href?: string } | null
  if (clicked?.ok) {
    const href = String(clicked.href || '').trim()
    const before = String((await getBrowserState(id).catch(() => null))?.url || '')
    if (/studentstudy/i.test(before) && /studentstudy/i.test(href)) {
      return { ok: true, text: clicked.text || want, href, via: 'frame' }
    }
    if (/^https?:/i.test(href)) {
      await waitMs(400)
      const after = String((await getBrowserState(id).catch(() => null))?.url || '')
      if (!after || after.indexOf(href.slice(0, 40)) < 0) await navigateBrowserView(id, href)
    }
    return { ok: true, text: clicked.text || want, href, via: 'frame' }
  }
  return local
}

export const typeBrowserElement = (id: string, selector: string, text: string) => evalBrowserView(id, `${SAME_ORIGIN_FRAMES}
(function(){
  var el = __findEl(${JSON.stringify(selector)});
  if (!el) return { ok: false, error: '没有找到输入框' };
  el.focus();
  var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  var desc = Object.getOwnPropertyDescriptor(proto, 'value');
  if (desc && desc.set) desc.set.call(el, ${JSON.stringify(text)});
  else el.value = ${JSON.stringify(text)};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { ok: true };
})()`)


export const scrollBrowserView = (id: string, amount: number) => evalBrowserView(id, `window.scrollBy(0, ${Number(amount) || 0})`)


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

export const listenBrowserOpened = (handler: (state: BrowserPageState) => void): Promise<UnlistenFn> => (
  listen<BrowserPageState>('app-browser-opened', (event) => {
    if (event.payload) handler(event.payload)
  })
)
