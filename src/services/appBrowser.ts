import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import {
  CHAOXING_CAPTCHA_CHECK,
  CHAOXING_CAPTCHA_FILL,
  CHAOXING_CAPTCHA_IMAGE,
  CHAOXING_CAPTCHA_REFRESH,
  CHAOXING_CHAPTER_HOOK,
  CHAOXING_CHAPTER_TICK,
  CHAOXING_CLICK_CHAPTER_TAB,
  CHAOXING_CLICK_VIDEO_TAB,
  CHAOXING_NEXT_STEP,
  CHAOXING_OPEN_CHAPTER,
  CHAOXING_PARSE_CHAPTERS,
  CHAOXING_PLAY_SCRIPT,
  CHAOXING_STUDY_INSPECT,
  CHAOXING_VIDEO_HOOK,
  CHAOXING_VIDEO_TICK,
} from './browserSkills/chaoxingStudy'
import { writeDebugDump } from './agentDebugLog'
import { SAME_ORIGIN_FRAMES, askFrames, asObject, evalBrowserView, waitMs } from './browserEval'

export {
  SAME_ORIGIN_FRAMES,
  askFrames,
  asObject,
  evalBrowserView,
  waitMs,
} from './browserEval'
export type { ChaoxingHomeworkInfo, HomeworkLiveState } from './chaoxingHomework'
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
} from './chaoxingHomework'

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
      if (win && win.location && win.location.href.indexOf(href) < 0) win.location.assign(href);
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

const catalogReadySnap = (id: string) =>
  evalBrowserView(id, `(function(){
    var href = location.href || '';
    var text = '';
    var walk = function(win, depth){
      try {
        var piece = ((win.document.body && win.document.body.innerText) || '');
        if (!(/暂无任务|默认班级/.test(piece) && !/已完成任务点/.test(piece))) text += piece + '\\n';
      } catch (e) {}
      if ((depth || 0) > 4) return;
      try {
        var list = win.document.querySelectorAll('iframe');
        for (var i = 0; i < list.length; i++) {
          try { if (list[i].contentWindow) walk(list[i].contentWindow, (depth || 0) + 1); } catch (e) {}
        }
      } catch (e) {}
    };
    walk(window, 0);
    var extras = window.__ZE_FRAME_SNAPS__ || [];
    for (var e = 0; e < extras.length; e++) {
      var extraText = String((extras[e] && extras[e].text) || '');
      if (extraText) text += extraText + '\\n';
    }
    return {
      href: href,
      onCatalog: /已完成任务点/.test(text) || !!document.querySelector('.catalog_title, #coursetree'),
      hasProgress: /已完成任务点/.test(text),
      hasDir: text.indexOf('目录') >= 0 && /已完成任务点|维护|第\\d/.test(text),
      sample: text.replace(/\\s+/g, ' ').slice(0, 120),
    };
  })()`) as Promise<{
    href?: string
    onCatalog?: boolean
    hasProgress?: boolean
    hasDir?: boolean
    sample?: string
  } | null>

const waitForChaoxingCatalog = async (id: string, maxMs = 10000) => {
  const started = Date.now()
  let last: Awaited<ReturnType<typeof catalogReadySnap>> = null
  while (Date.now() - started < maxMs) {
    await askFrames(id, 'snap')
    last = await catalogReadySnap(id).catch(() => null)
    if (last?.onCatalog && (last.hasProgress || last.hasDir)) return last
    await waitMs(400)
  }
  return last
}

export const openChaoxingChapters = async (id: string) => {
  const probe = await evalBrowserView(id, `(function(){
    var href = location.href || '';
    var text = '';
    try { text = (document.body && document.body.innerText) || ''; } catch (e) {}
    return {
      url: href,
      already: /已完成任务点/.test(text) || !!document.querySelector('.catalog_title, #coursetree'),
      onStudent: /\\/mycourse\\/stu/.test(href),
    };
  })()`) as { url?: string; already?: boolean; onStudent?: boolean }
  // 只点页内「章节」标签，不要把 iframe src 当顶层网页打开
  if (probe?.onStudent && !probe?.already) {
    await evalBrowserView(id, CHAOXING_CLICK_CHAPTER_TAB).catch(() => null)
    await waitMs(400)
  }
  return readChaoxingChapterSnap(id)
}

const bareChapterTitle = (value: unknown) =>
  String(value || '')
    .replace(/[（(]\s*\d+\s*[）)]\s*$/g, '')
    .replace(/^\d+(?:\.\d+)+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()

const titlesMatch = (a: unknown, b: unknown) => {
  const left = bareChapterTitle(a)
  const right = bareChapterTitle(b)
  if (!left || !right) return false
  return left === right || left.includes(right) || right.includes(left)
}

const CHAOXING_DUMP_CAPTURE = `(function(){
  var out = [];
  function one(win, depth, label){
    var item = {
      label: label,
      depth: depth || 0,
      href: '',
      title: '',
      sameOrigin: false,
      html: '',
      text: '',
      iframeMeta: [],
      error: ''
    };
    try {
      item.href = (win.location && win.location.href) || '';
      item.title = (win.document && win.document.title) || '';
      item.sameOrigin = true;
      var doc = win.document;
      item.html = (doc.documentElement && doc.documentElement.outerHTML) || '';
      item.text = ((doc.body && doc.body.innerText) || '').slice(0, 40000);
      var list = doc.querySelectorAll('iframe');
      for (var i = 0; i < list.length && i < 16; i++) {
        var el = list[i];
        var src = '';
        try { src = el.src || el.getAttribute('src') || ''; } catch (e) {}
        item.iframeMeta.push({
          i: i,
          id: el.id || '',
          cls: String(el.className || '').slice(0, 80),
          src: src,
          w: el.offsetWidth || 0,
          h: el.offsetHeight || 0
        });
        try {
          if (el.contentWindow) one(el.contentWindow, (depth || 0) + 1, label + '/iframe' + i);
        } catch (e) {
          out.push({
            label: label + '/iframe' + i,
            depth: (depth || 0) + 1,
            href: src,
            title: '',
            sameOrigin: false,
            html: '',
            text: '',
            iframeMeta: [],
            error: 'cross-origin'
          });
        }
      }
    } catch (e) {
      item.error = String(e && e.message || e);
    }
    out.push(item);
  }
  one(window, 0, 'top');
  window.__cxHtmlDump = out;
  return {
    url: location.href,
    count: out.length,
    frames: out.map(function(x){
      return {
        label: x.label,
        href: x.href,
        title: x.title,
        sameOrigin: x.sameOrigin,
        htmlLen: (x.html || '').length,
        textLen: (x.text || '').length,
        error: x.error,
        iframes: x.iframeMeta
      };
    })
  };
})()`

const CHAOXING_DUMP_OUTLINE = `(function(){
  var sels = [
    '#coursetree', '.posCatalog_name', '.posCatalog_select', '.posCatalog_active',
    '.catalog_title', '.catalog_task', '.catalog_name', 'a.clicktitle',
    '.chapter_item', '.orangeNew', '.jobUnfinishCount', '.prevHoverTips',
    '.catalog_points', '.roundpointStudent'
  ];
  var hits = [];
  for (var s = 0; s < sels.length; s++) {
    var nodes = [];
    try { nodes = document.querySelectorAll(sels[s]); } catch (e) { nodes = []; }
    var samples = [];
    for (var i = 0; i < nodes.length && samples.length < 5; i++) {
      samples.push(String(nodes[i].outerHTML || '').slice(0, 1200));
    }
    hits.push({ sel: sels[s], count: nodes.length, samples: samples });
  }
  return {
    url: location.href,
    title: document.title,
    bodyText: ((document.body && document.body.innerText) || '').slice(0, 8000),
    hits: hits
  };
})()`

const dumpChunk = (index: number, start: number, size: number) => `(function(){
  var d = (window.__cxHtmlDump || [])[${index}];
  if (!d) return { done: true };
  var html = d.html || '';
  return {
    label: d.label,
    href: d.href || '',
    start: ${start},
    chunk: html.slice(${start}, ${start + size}),
    left: Math.max(0, html.length - ${start} - ${size})
  };
})()`

const dumpTextChunk = (index: number, start: number, size: number) => `(function(){
  var d = (window.__cxHtmlDump || [])[${index}];
  if (!d) return { done: true };
  var text = d.text || '';
  return {
    label: d.label,
    start: ${start},
    chunk: text.slice(${start}, ${start + size}),
    left: Math.max(0, text.length - ${start} - ${size})
  };
})()`

const readEvalChunks = async (id: string, scriptFor: (start: number) => string, max = 400000) => {
  const size = 6000
  let start = 0
  let out = ''
  let label = ''
  let href = ''
  while (start < max) {
    const part = await evalBrowserView(id, scriptFor(start)).catch(() => null) as {
      done?: boolean
      label?: string
      href?: string
      chunk?: string
      left?: number
    } | null
    if (!part || part.done) break
    if (part.label) label = part.label
    if (part.href) href = part.href
    out += String(part.chunk || '')
    if (!Number(part.left)) break
    start += size
  }
  return { label, href, text: out }
}

export const dumpChaoxingParseHtml = async (id: string, reason = 'parse') => {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const latest = 'chaoxing-parse/latest'
  const archive = `chaoxing-parse/${stamp}`
  const writeBoth = (name: string, text: string, ext: 'html' | 'md' | 'json' | 'txt' = 'html') => {
    writeDebugDump(`${latest}/${name}`, text, ext)
    writeDebugDump(`${archive}/${name}`, text, ext)
    // vite 未重启时新目录写不进去，同时落到已有的 agent-chat 日志
    const fallbackExt = ext === 'md' ? 'md' : 'txt'
    writeDebugDump(`cx-dump-${name.replace(/[^\w.-]+/g, '_')}`, text, fallbackExt)
  }
  try {
    const index = await evalBrowserView(id, CHAOXING_DUMP_CAPTURE) as {
      url?: string
      count?: number
      frames?: Array<{
        label: string
        href: string
        title?: string
        sameOrigin: boolean
        htmlLen: number
        textLen: number
        error?: string
        iframes?: Array<{ i: number; id: string; cls: string; src: string; w: number; h: number }>
      }>
    }
    const outline = await evalBrowserView(id, CHAOXING_DUMP_OUTLINE).catch(() => null)
    writeBoth('index', JSON.stringify({ reason, ts: new Date().toISOString(), ...index }, null, 2), 'json')
    writeBoth('outline', JSON.stringify(outline, null, 2), 'json')
    const frames = index?.frames || []
    const summary: string[] = [
      `# 学习通解析快照`,
      `reason: ${reason}`,
      `url: ${index?.url || ''}`,
      `frames: ${frames.length}`,
      '',
    ]
    for (let i = 0; i < frames.length; i++) {
      const meta = frames[i]
      const html = await readEvalChunks(id, (start) => dumpChunk(i, start, 6000))
      const text = await readEvalChunks(id, (start) => dumpTextChunk(i, start, 6000))
      const file = `${String(i).padStart(2, '0')}-${(meta.label || 'frame').replace(/[^\w.-]+/g, '_')}`
      writeBoth(file, html.text || `<!-- empty sameOrigin=${meta.sameOrigin} error=${meta.error || ''} -->`, 'html')
      writeBoth(`${file}-text`, text.text || '', 'txt')
      summary.push(`## ${meta.label}`)
      summary.push(`href: ${meta.href}`)
      summary.push(`sameOrigin: ${meta.sameOrigin} htmlLen: ${meta.htmlLen} textLen: ${meta.textLen} error: ${meta.error || ''}`)
      if (meta.iframes?.length) {
        for (const frame of meta.iframes) {
          summary.push(`- iframe[${frame.i}] id=${frame.id} ${frame.w}x${frame.h} ${frame.src}`)
        }
      }
      summary.push('')
    }
    writeBoth('README', `${summary.join('\n').trim()}\n`, 'md')
    return { ok: true, dir: latest, frames: frames.length }
  } catch (error) {
    writeBoth('error', String((error as Error)?.message || error), 'txt')
    return { ok: false, error: String((error as Error)?.message || error) }
  }
}

export type ChaoxingChapterSnap = {
  url?: string
  page?: string
  current?: string
  unfinished?: string[]
  unfinishedCount?: number
  firstUnfinished?: string
  onUnfinished?: boolean
  progress?: { done: number; total: number } | null
  chapters?: Array<{ title: string; jobs: number; unfinished: boolean; active?: boolean; href?: string; studyHref?: string; chapterId?: string }>
  hint?: string
  via?: string
  ts?: number
}

const CAPTCHA_HINT = '学习通弹出图片验证码（9010）。看图读出 4 位字母或数字，调用 browser_chaoxing_captcha 填上并提交，然后继续刷课。不要问用户。'

export const readChaoxingCaptcha = async (id: string) => {
  const hit = asObject(await evalBrowserView(id, CHAOXING_CAPTCHA_CHECK).catch(() => null))
  return Boolean(hit.captcha)
}

export const readChaoxingCaptchaImage = async (id: string) => {
  let shot = asObject(await evalBrowserView(id, CHAOXING_CAPTCHA_IMAGE).catch(() => null))
  if (!shot.image && shot.pending) {
    await waitMs(500)
    shot = asObject(await evalBrowserView(id, `(function(){ return window.__ZE_CAPTCHA_IMG__ || ${CHAOXING_CAPTCHA_IMAGE}; })()`).catch(() => null))
  }
  const image = String(shot.image || '')
  return {
    captcha: true,
    image: image.startsWith('data:image/') ? image : '',
    src: String(shot.src || ''),
  }
}

export const fillChaoxingCaptcha = async (id: string, code: string) => {
  const filled = asObject(await evalBrowserView(id, `${CHAOXING_CAPTCHA_FILL}(${JSON.stringify(String(code || '').trim())})`).catch(() => null))
  if (!filled.ok) return { ok: false, error: String(filled.error || '没填上验证码') }
  await waitMs(900)
  const still = await readChaoxingCaptcha(id)
  return { ok: !still, code: String(filled.code || code), still }
}

export const refreshChaoxingCaptcha = async (id: string) => {
  await evalBrowserView(id, CHAOXING_CAPTCHA_REFRESH).catch(() => null)
  await waitMs(450)
}

const unfinishedFromCatalogText = (text: string) => {
  const lines = String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const unfinished: string[] = []
  const progressHit = String(text || '').match(/已完成任务点\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/)
  const progress = progressHit
    ? { done: Number(progressHit[1]), total: Number(progressHit[2]) }
    : null
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const next = lines[i + 1] || ''
    if (/^\d{1,2}$/.test(line) && /^第/.test(next)) continue
    if (/已完成任务点|^目录$|^第/.test(line)) continue
    if (/^\d{1,2}$/.test(next) && !/^第/.test(line) && line.length > 1 && !/资料|测验|考试|作业|讨论|问卷/.test(line) && !/^第/.test(lines[i + 2] || '')) {
      const title = bareChapterTitle(line) || line
      if (title && !unfinished.some((item) => titlesMatch(item, title))) unfinished.push(title)
    }
  }
  if (!unfinished.length && !(progress && progress.total > progress.done)) return null
  return {
    url: '',
    page: 'chapters',
    current: '',
    progress,
    unfinished,
    unfinishedCount: progress && progress.total > progress.done ? progress.total - progress.done : unfinished.length,
    chapters: unfinished.map((title) => ({ title, jobs: 1, unfinished: true })),
    via: 'frames',
  } as ChaoxingChapterSnap
}

const unfinishedFromFrameSnaps = async (id: string) => {
  await askFrames(id, 'snap')
  const extras = asObject(await evalBrowserView(id, `(function(){
    var extras = window.__ZE_FRAME_SNAPS__ || [];
    var text = '';
    for (var i = 0; i < extras.length; i++) {
      if (extras[i] && extras[i].text) text += String(extras[i].text) + '\\n';
    }
    return { text: text.slice(0, 14000) };
  })()`).catch(() => null))
  return unfinishedFromCatalogText(String(extras.text || ''))
}

export const installChaoxingChapterHook = async (id: string) => {
  await askFrames(id, 'snap')
  return evalBrowserView(id, CHAOXING_CHAPTER_HOOK) as Promise<ChaoxingChapterSnap | null>
}

export const readChaoxingChapterTick = (id: string) =>
  evalBrowserView(id, CHAOXING_CHAPTER_TICK) as Promise<ChaoxingChapterSnap | null>

export const readChaoxingChapterSnap = async (id: string) => {
  const first = await installChaoxingChapterHook(id).catch(() => null)
  if ((first?.unfinished || []).length || (first?.progress && first.progress.total > first.progress.done)) {
    return first
  }
  for (let i = 0; i < 8; i += 1) {
    await waitMs(500)
    const tick = await readChaoxingChapterTick(id).catch(() => null)
    if ((tick?.unfinished || []).length || (tick?.progress && tick.progress.total > tick.progress.done)) {
      return tick
    }
    if (i === 3 || i === 6) await installChaoxingChapterHook(id).catch(() => null)
  }
  const last = (await readChaoxingChapterTick(id).catch(() => null)) || first
  if ((last?.unfinished || []).length || (last?.progress && last.progress.total > last.progress.done)) return last
  return (await unfinishedFromFrameSnaps(id)) || last
}

export const parseChaoxingChapters = async (id: string) => {
  const snap = await readChaoxingChapterSnap(id).catch(() => null)
  if (snap && ((snap.unfinished || []).length || snap.progress)) return snap
  try {
    return await evalBrowserView(id, CHAOXING_PARSE_CHAPTERS) as ChaoxingChapterSnap | null
  } catch (error) {
    await dumpChaoxingParseHtml(id, 'parse-error').catch(() => null)
    throw error
  }
}

export const openChaoxingChapter = async (id: string, title: string) => {
  const want = bareChapterTitle(title)
  if (!want) return { ok: false, error: '缺少节名' }
  const opened = asObject(await evalBrowserView(id, `${CHAOXING_OPEN_CHAPTER}(${JSON.stringify(want)})`))
  if (opened.ok) {
    await waitMs(1000)
    return opened
  }
  const parsed = await parseChaoxingChapters(id).catch(() => null)
  const hit = (parsed?.chapters || []).find((item) => titlesMatch(item.title, want))
  const studyHref = String(hit?.studyHref || '')
  const href = String(hit?.href || '')
  const playerHref = studyHref.includes('studentstudy')
    ? studyHref
    : (href.includes('studentstudy') ? href : '')
  if (playerHref) {
    await navigateBrowserView(id, playerHref)
    await waitMs(1200)
    return { ok: true, title: hit?.title || want, via: 'player' }
  }
  const chapterId = String(hit?.chapterId || '')
  if (chapterId) {
    const state = await getBrowserState(id).catch(() => null)
    try {
      const current = new URL(String(state?.url || parsed?.url || ''))
      const courseId = current.searchParams.get('courseid') || current.searchParams.get('courseId') || ''
      const clazzid = current.searchParams.get('clazzid') || current.searchParams.get('clazzId') || ''
      const cpi = current.searchParams.get('cpi') || ''
      const enc = current.searchParams.get('enc') || current.searchParams.get('stuenc') || ''
      if (courseId && clazzid) {
        const player = `https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=${chapterId}&courseId=${courseId}&clazzid=${clazzid}${cpi ? `&cpi=${cpi}` : ''}${enc ? `&enc=${enc}` : ''}&mooc2=1`
        await navigateBrowserView(id, player)
        await waitMs(1200)
        return { ok: true, title: hit?.title || want, via: 'chapterId' }
      }
    } catch {
      // ignore
    }
  }
  const fallback = await clickBrowserText(id, want).catch(() => null) as { ok?: boolean; text?: string } | null
  if (fallback?.ok) {
    await waitMs(1000)
    return { ok: true, title: want, via: 'click_text', text: fallback.text }
  }
  return { ok: false, error: String(opened.error || `目录里没有「${want}」`), want }
}

const asVideoTick = (value: ChaoxingVideoTick | Record<string, unknown> | null | undefined): ChaoxingVideoTick | null => {
  if (!value) return null
  const duration = Number(value.duration) || 0
  const current = Number(value.current) || 0
  return {
    current,
    duration,
    paused: Boolean(value.paused),
    ended: Boolean(value.ended),
    ready: Number(value.ready) || 0,
    src: String(value.src || ''),
  }
}

const tickLooksLikeVideo = (tick: ChaoxingVideoTick | null | undefined) => {
  if (!tick) return false
  const duration = Number(tick.duration) || 0
  const current = Number(tick.current) || 0
  if (duration <= 1) return false
  if (tick.ended) return false
  if (current >= duration - 1.5) return false
  return true
}

export const videoIsPlaying = (tick: ChaoxingVideoTick | Record<string, unknown> | null | undefined) => {
  const snap = asVideoTick(tick)
  return Boolean(tickLooksLikeVideo(snap) && snap && snap.paused === false)
}

export const playChaoxingVideo = async (id: string) => {
  if (await readChaoxingCaptcha(id)) {
    return { captcha: true, hasVideo: false, playing: false, hint: CAPTCHA_HINT }
  }
  const tab = await evalBrowserView(id, CHAOXING_CLICK_VIDEO_TAB).catch(() => null) as {
    quiz?: boolean
    step?: string
    ok?: boolean
    already?: boolean
  } | null
  if (tab?.quiz) {
    return { quiz: true, step: tab.step || '', hasVideo: false, playing: false, hint: '当前是测验/作业，停下让用户自己做' }
  }
  if (tab?.ok && !tab.already) {
    await waitMs(800)
  }
  let last: Record<string, unknown> = {}
  let baseline = -1
  let sawPlayer = false
  for (let i = 0; i < 8; i += 1) {
    last = asObject(await evalBrowserView(id, CHAOXING_PLAY_SCRIPT))
    const tick = asVideoTick(await readChaoxingVideoTick(id).catch(() => null)) || asVideoTick(last)
    if (tickLooksLikeVideo(tick)) {
      sawPlayer = true
      if (tick && tick.paused === false) {
        if (baseline < 0) {
          baseline = tick.current
        } else if (tick.current >= baseline + 0.2) {
          const info = await readChaoxingVideo(id).catch(() => null)
          return {
            page: last.page || 'player',
            hasVideo: true,
            playing: true,
            paused: false,
            ended: false,
            current: tick.current,
            duration: tick.duration,
            title: info?.current || '',
            next: info?.next || '',
            jobDone: info?.jobDone ?? null,
            moreVideos: Boolean(info?.moreVideos),
            videoCount: Number(info?.videoCount) || 0,
            videoIndex: Number(info?.videoIndex) || 0,
            step: info?.step || '',
          }
        }
      }
    }
    await waitMs(800)
  }
  const tick = asVideoTick(await readChaoxingVideoTick(id).catch(() => null)) || asVideoTick(last)
  const info = await readChaoxingVideo(id).catch(() => null)
  if (sawPlayer || tickLooksLikeVideo(tick)) {
    return {
      page: last.page || 'player',
      hasVideo: true,
      playing: false,
      paused: tick?.paused !== false,
      ended: Boolean(tick?.ended),
      current: tick?.current || 0,
      duration: tick?.duration || 0,
      title: info?.current || '',
      next: info?.next || '',
      jobDone: info?.jobDone ?? null,
      moreVideos: Boolean(info?.moreVideos),
      videoCount: Number(info?.videoCount) || 0,
      videoIndex: Number(info?.videoIndex) || 0,
      step: info?.step || '',
      hint: '播放器在，但视频没有真正播起来。再 browser_chaoxing_play，不要说正在播放。',
    }
  }
  return {
    hasVideo: false,
    playing: false,
    title: info?.current || '',
    hint: '当前节没有视频（可能是资料/PDF）。用 browser_chaoxing_next 跳到下一节视频，不要停。',
  }
}

const SKIP_CHAPTER = /资料|测验|考试|作业|讨论|问卷/

const clickChapterOrNext = async (id: string, name?: string) => {
  const target = String(name || '').trim()
  if (target) {
    const hit = await clickBrowserText(id, target).catch(() => null) as { ok?: boolean } | null
    if (hit?.ok) return hit
  }
  return clickBrowserText(id, '下一节')
}

export const openNextChaoxingStep = async (id: string) => {
  const moved = asObject(await evalBrowserView(id, CHAOXING_NEXT_STEP).catch(() => null))
  if (moved.quiz) {
    return { quiz: true, step: String(moved.step || ''), hasVideo: false, more: false }
  }
  if (!moved.ok) {
    return { ok: false, chapterDone: true, more: false, videoCount: Number(moved.videoCount) || 0 }
  }
  await waitMs(1000)
  const page = await readChaoxingVideo(id).catch(() => null)
  if (page?.captcha || await readChaoxingCaptcha(id)) {
    return { captcha: true, hasVideo: false, more: false, hint: CAPTCHA_HINT }
  }
  if (page?.quiz) {
    return { quiz: true, step: String(page.step || moved.step || ''), hasVideo: false, more: false }
  }
  const played = await playChaoxingVideo(id)
  if (played.captcha) {
    return { captcha: true, hasVideo: false, more: false, hint: CAPTCHA_HINT }
  }
  return {
    ok: Boolean(played.hasVideo),
    more: true,
    chapterDone: false,
    opened: String(played.title || moved.step || ''),
    step: String(moved.step || ''),
    videoCount: Number(moved.videoCount) || 0,
    ...played,
  }
}

export const openNextChaoxingChapter = async (id: string) => {
  if (await readChaoxingCaptcha(id)) {
    return { captcha: true, hasVideo: false, skipped: [], hint: CAPTCHA_HINT }
  }
  const skipped: string[] = []
  const start = await readChaoxingVideo(id).catch(() => null)
  if (start?.quiz) {
    return { quiz: true, step: start.step || '', hasVideo: false, skipped }
  }
  const same = await openNextChaoxingStep(id)
  if (same.quiz) return { ...same, skipped }
  if (same.captcha) return { ...same, skipped, captcha: true, hint: CAPTCHA_HINT }
  if (same.ok && same.hasVideo) return { ...same, skipped, sameChapter: true }
  const fromId = String(start?.chapterId || '').trim()
  const fromTitle = String(start?.current || '').trim()
  await clickChapterOrNext(id, start?.next)
  for (let i = 0; i < 10; i += 1) {
    await waitMs(900)
    const page = await readChaoxingVideo(id).catch(() => null)
    if (page?.captcha || await readChaoxingCaptcha(id)) {
      return { captcha: true, hasVideo: false, skipped, hint: CAPTCHA_HINT }
    }
    if (page?.quiz) {
      return { quiz: true, current: page.current || '', skipped, hasVideo: false }
    }
    const title = String(page?.current || '').trim()
    const chapterId = String(page?.chapterId || '').trim()
    const moved = Boolean((chapterId && fromId && chapterId !== fromId) || (title && fromTitle && title !== fromTitle))
    const looksDoc = SKIP_CHAPTER.test(title) || SKIP_CHAPTER.test(String(page?.step || ''))
    if (looksDoc) {
      skipped.push(title || '资料节')
      await clickChapterOrNext(id, page?.next)
      continue
    }
    const played = await playChaoxingVideo(id)
    if (played.captcha) {
      return { captcha: true, hasVideo: false, skipped, hint: CAPTCHA_HINT }
    }
    const duration = Number(played?.duration) || 0
    const current = Number(played?.current) || 0
    const playing = Boolean(played?.playing || videoIsPlaying(played))
    const hasPlayer = Boolean(played?.hasVideo && duration > 1 && !played.ended)
    if (playing && (moved || current < 8)) {
      return { ok: true, opened: title || String(played.title || ''), skipped, ...played, playing: true }
    }
    if (hasPlayer && moved) {
      return { ok: true, opened: title || String(played.title || ''), skipped, ...played, playing: false }
    }
    if (!moved || !hasPlayer) {
      skipped.push(title || (hasPlayer ? '还在上一节' : '播放器未就绪'))
      await clickChapterOrNext(id, page?.next)
    }
  }
  return {
    ok: false,
    hasVideo: false,
    skipped,
    hint: '没能切到下一节视频，或播放器还没就绪',
  }
}

export const studyChaoxingUnfinished = async (id: string, title?: string) => {
  if (await readChaoxingCaptcha(id)) {
    return { ok: false, captcha: true, done: false, hint: CAPTCHA_HINT }
  }
  let parseError = ''
  const onStudent = await evalBrowserView(id, `(function(){ return /\\/mycourse\\/stu/.test(location.href || ''); })()`).catch(() => false)
  if (onStudent) {
    await evalBrowserView(id, CHAOXING_CLICK_CHAPTER_TAB).catch(() => null)
    await waitForChaoxingCatalog(id, 5000)
  }
  let parsed = await readChaoxingChapterSnap(id).catch((error) => {
    parseError = String(error?.message || error || '')
    return null
  })
  if (!(parsed?.unfinished || []).length && !parsed?.progress) {
    await evalBrowserView(id, CHAOXING_CLICK_CHAPTER_TAB).catch(() => null)
    await waitForChaoxingCatalog(id, 4000)
    parsed = await readChaoxingChapterSnap(id).catch((error) => {
      parseError = String(error?.message || error || parseError)
      return parsed
    })
  }
  if (!(parsed?.unfinished || []).length) {
    parsed = (await unfinishedFromFrameSnaps(id)) || parsed
  }
  const unfinished = (parsed?.unfinished || []).map(bareChapterTitle).filter(Boolean)
  const progress = parsed?.progress || null
  const progressLeft = progress && progress.total > progress.done
    ? progress.total - progress.done
    : 0
  const preferred = bareChapterTitle(title)
  const queue = preferred
    ? [preferred, ...unfinished.filter((item) => !titlesMatch(item, preferred))]
    : unfinished
  if (!queue.length) {
    if (progressLeft > 0) {
      return {
        ok: false,
        done: false,
        unfinished: [],
        unfinishedCount: progressLeft,
        progress,
        page: parsed?.page,
        url: parsed?.url,
        hint: `页面显示还有 ${progressLeft} 个未完成任务点（已完成 ${progress?.done}/${progress?.total}），但目录项没对上。不要说全部完成。立刻 browser_get_page 看目录正文和 iframe，读到节名就再调 browser_chaoxing_study，title 填干净节名。`,
      }
    }
    const stillNotCatalog = parsed?.page !== 'chapters' && parsed?.page !== 'player' && !progress
    if (stillNotCatalog || parsed?.page === 'student' || Boolean(parseError)) {
      return {
        ok: false,
        done: false,
        unfinished: [],
        unfinishedCount: 0,
        progress,
        page: parsed?.page,
        url: parsed?.url,
        error: parseError || undefined,
        hint: parseError
          ? `解析目录失败：${parseError}。不要说全部完成。立刻 browser_get_page / browser_eval 自己读页面：找「已完成任务点 x/y」和节名旁的数字，读到未完成节名再 browser_chaoxing_study。`
          : '课程壳或目录 iframe 还没读到未完成节。不要说全部完成。点「章节」后等两秒，再用 browser_get_page 看 iframe 正文，或 browser_eval 扫 .catalog_title / #coursetree。',
      }
    }
    if (!progress) {
      return {
        ok: false,
        done: false,
        unfinished: [],
        unfinishedCount: 0,
        page: parsed?.page,
        url: parsed?.url,
        hint: '解析器没读到进度，不等于全部完成。立刻 browser_get_page 自己解析目录，不要问用户。',
      }
    }
    return {
      ok: false,
      done: true,
      unfinished: [],
      unfinishedCount: 0,
      progress,
      hint: `已完成任务点 ${progress.done}/${progress.total}。`,
    }
  }

  const skipped: string[] = []
  for (const want of queue.slice(0, 6)) {
    const alreadyHere = Boolean(parsed?.onUnfinished && titlesMatch(parsed?.current, want))
      || (parsed?.page === 'player' && titlesMatch(parsed?.current, want))

    if (!alreadyHere) {
      const opened = await openChaoxingChapter(id, want)
      if (!opened.ok) {
        skipped.push(`${want}（打不开）`)
        continue
      }
      await waitMs(1000)
    }

    if (await readChaoxingCaptcha(id)) {
      return { ok: false, captcha: true, done: false, target: want, hint: CAPTCHA_HINT }
    }
    const played = await playChaoxingVideo(id)
    if (played.captcha) {
      return { ok: false, captcha: true, done: false, target: want, hint: CAPTCHA_HINT }
    }
    if (played.quiz) {
      return {
        ok: false,
        quiz: true,
        target: want,
        unfinished,
        unfinishedCount: Number(parsed?.unfinishedCount) || unfinished.length || progressLeft,
        progress,
        skipped,
        hint: '当前是测验/作业，停下让用户自己做。',
      }
    }
    if (!played.hasVideo) {
      skipped.push(want)
      parsed = await parseChaoxingChapters(id).catch(() => parsed)
      continue
    }

    const info = await readChaoxingVideo(id).catch(() => null)
    const openedTitle = String(info?.current || played.title || want).trim()
    const playing = Boolean(played.playing || videoIsPlaying(played))
    return {
      ok: true,
      target: want,
      opened: openedTitle,
      unfinished,
      unfinishedCount: Number(parsed?.unfinishedCount) || unfinished.length || progressLeft,
      progress,
      skipped,
      playing,
      hasVideo: true,
      paused: Boolean(played.paused),
      ended: Boolean(played.ended),
      current: Number(played.current) || 0,
      duration: Number(played.duration) || 0,
      next: info?.next || played.next || '',
      jobDone: info?.jobDone ?? played.jobDone ?? null,
      moreVideos: Boolean(info?.moreVideos ?? played.moreVideos),
      videoCount: Number(info?.videoCount || played.videoCount) || 0,
      videoIndex: Number(info?.videoIndex || played.videoIndex) || 0,
      step: info?.step || played.step || '',
      quiz: false,
      hint: playing
        ? `已打开并确认在播「${openedTitle}」。进度在 Agent 面板，系统会定时核对，不要再 click_text。`
        : `已打开「${openedTitle}」，但还没播起来。再调一次 browser_chaoxing_study 或 browser_chaoxing_play。`,
    }
  }

  return {
    ok: false,
    done: false,
    unfinished,
    unfinishedCount: Number(parsed?.unfinishedCount) || unfinished.length || progressLeft,
    progress,
    skipped,
    hint: `未完成还有：${unfinished.join('、') || `任务点 ${progressLeft}`}。尝试打开失败或都是资料节。不要说全部完成，可再调一次 browser_chaoxing_study。`,
  }
}

export type ChaoxingVideoInfo = {
  page?: string
  chapterId?: string
  step?: string
  quiz?: boolean
  captcha?: boolean
  jobDone?: boolean | null
  current?: string
  next?: string
  unfinished?: string[]
  moreVideos?: boolean
  videoCount?: number
  videoIndex?: number
  steps?: Array<{ label: string; video?: boolean; quiz?: boolean; doc?: boolean; active?: boolean; jobDone?: boolean | null }>
  video?: {
    paused: boolean
    ended: boolean
    current: number
    duration: number
  } | null
}

export const readChaoxingVideo = (id: string) =>
  evalBrowserView(id, CHAOXING_STUDY_INSPECT) as Promise<ChaoxingVideoInfo | null>

export type ChaoxingVideoTick = {
  current: number
  duration: number
  paused: boolean
  ended: boolean
  ready?: number
  src?: string
  ts?: number
  hasVideo?: boolean
}

export const installChaoxingVideoHook = (id: string) =>
  evalBrowserView(id, CHAOXING_VIDEO_HOOK) as Promise<ChaoxingVideoTick | { hooked?: boolean; hasVideo?: boolean } | null>

export const readChaoxingVideoTick = (id: string) =>
  evalBrowserView(id, CHAOXING_VIDEO_TICK) as Promise<ChaoxingVideoTick | null>

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
