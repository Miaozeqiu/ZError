import { asObject, evalBrowserFrames, evalBrowserView, waitMs } from '../eval'
import type { CourseListKind } from './courseList'
import { VIRTUAL_MOUSE_JS } from './virtualMouse'

const labelOf = (kind: CourseListKind) => (kind === 'student' ? '我学的课' : '我教的课')

/** 课表地址不能当顶层打开，也不能拿来改 iframe src。 */
export const isSpaceListTopUrl = (url: string) => (
  /visit\/(?:courses|interaction)|courselist/i.test(url)
    && !/stucoursemiddle|mycourse\/stu|courseid=/i.test(url)
)

export const spaceTabOfHref = (href: string) => {
  if (/visit\/courses/i.test(href)) return '我学的课'
  if (/visit\/interaction/i.test(href)) return '我教的课'
  return ''
}

/**
 * 页签只看 iframe 里的 DOM（#courseType / .tab-item.current）。
 * 外壳 #frame_content.src 点完页签也不会变，禁止用来判断。
 */
export const READ_SPACE_LIST = `(function(){
  function tabFrom(type, label){
    var t = String(label || '').replace(/\\s+/g, '');
    if (type === '1' || t === '我学的课' || t === '已学的课') return '我学的课';
    if (type === '0' || t === '我教的课') return '我教的课';
    return '';
  }
  function liveHref(doc){
    try {
      if (doc && doc.defaultView && doc.defaultView.location) {
        var href = String(doc.defaultView.location.href || '');
        if (href && href !== 'about:blank') return href;
      }
    } catch (e) {}
    return '';
  }
  function fromDoc(doc){
    var type = '';
    var label = '';
    try {
      var hid = doc.querySelector('#courseType');
      if (hid) type = String(hid.value || hid.getAttribute('value') || '');
    } catch (e0) {}
    try {
      var cur = doc.querySelector('.tab-item.current, .tab-item.active, .tab-item.selected, .tab-item[class*="current"]');
      if (cur) {
        if (!type) type = String(cur.getAttribute('coursetype') || '');
        label = String(cur.innerText || cur.textContent || '');
      }
    } catch (e1) {}
    var tab = tabFrom(type, label);
    return { href: liveHref(doc), tab: tab, type: type, ok: !!tab, via: 'doc' };
  }
  if (document.querySelector('.tab-item[coursetype], #courseType, .course-tab')) {
    return fromDoc(document);
  }
  var f = document.querySelector('#frame_content, iframe[name="frame_content"]') || document.querySelector('iframe');
  if (f) {
    try {
      var doc = f.contentDocument;
      if (doc && doc.querySelector('.tab-item[coursetype], #courseType, .course-tab')) {
        return fromDoc(doc);
      }
    } catch (e2) {}
    try {
      var live = String((f.contentWindow && f.contentWindow.location && f.contentWindow.location.href) || '');
      if (live && live !== 'about:blank') {
        var byLive = /visit\\/courses|courselist/i.test(live) ? '我学的课' : (/visit\\/interaction/i.test(live) ? '我教的课' : '');
        if (byLive) return { href: live, tab: byLive, type: '', ok: true, via: 'contentWindow' };
      }
    } catch (e3) {}
  }
  return { href: '', tab: '', type: '', ok: false, via: 'none' };
})()`

export const readSpaceList = async (id: string) => {
  const raw = await evalBrowserView(id, READ_SPACE_LIST).catch(() => null)
  const row = asObject(raw)
  const via = String(row.via || '')
  const frame = via === 'src-attr' ? '' : String(row.href || (typeof raw === 'string' ? raw : '') || '')
  const tab = String(row.tab || '')
  return { tab, frame, via, stale: false }
}

/**
 * 从当前 document 走进同源 iframe（#frame_content 常用 document.domain）。
 * 只点真正的 .tab-item，不点外壳、不改 iframe src。
 */
export const CLICK_SPACE_TAB = (kind: CourseListKind) => `(function(){
${VIRTUAL_MOUSE_JS}
  var student = ${kind === 'student' ? 'true' : 'false'};
  function compact(s){ return String(s || '').replace(/\\s+/g, ''); }
  function spaceListHref(el){
    var h = '';
    try { h = String(el.getAttribute('href') || el.href || el.getAttribute('data-url') || el.getAttribute('onclick') || ''); } catch (eH) {}
    return /visit\\/(?:courses|interaction)|courselist/i.test(h) && !/stucoursemiddle|mycourse\\/stu|courseid=/i.test(h);
  }
  function isTab(el){
    if (!el) return false;
    if (String(el.tagName || '').toLowerCase() === 'a') return false;
    if (spaceListHref(el)) return false;
    var cls = String(el.className || '');
    var type = String(el.getAttribute('coursetype') || '');
    return /\\btab-item\\b/.test(cls) || type === '0' || type === '1';
  }
  function matchTab(el){
    if (!isTab(el)) return false;
    var type = String(el.getAttribute('coursetype') || '');
    var label = compact(el.innerText || el.textContent || '');
    if (label.indexOf('删除') >= 0) return false;
    if (student) return type === '1' || label === '我学的课' || label === '已学的课';
    return type === '0' || label === '我教的课';
  }
  function docs(){
    var out = [];
    var seen = [];
    function add(doc){
      if (!doc) return;
      for (var i = 0; i < seen.length; i++) if (seen[i] === doc) return;
      seen.push(doc);
      out.push(doc);
    }
    add(document);
    var list = [];
    try { list = document.querySelectorAll('iframe'); } catch (e) {}
    for (var i = 0; i < list.length; i++) {
      try { add(list[i].contentDocument); } catch (e2) {}
    }
    return out;
  }
  function fireClick(el){
    var doc = el.ownerDocument || document;
    var view = (doc.defaultView || window);
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (eS) {}
    try { __zeMouseOn(el, 'click', compact(el.innerText || el.textContent || '')); } catch (eM) {}
    var r = { left: 0, top: 0, width: 2, height: 2 };
    try { r = el.getBoundingClientRect(); } catch (eR) {}
    var x = r.left + r.width / 2;
    var y = r.top + r.height / 2;
    var opts = { bubbles: true, cancelable: true, view: view, clientX: x, clientY: y, button: 0 };
    var fire = function(type, Ctor){
      if (typeof Ctor !== 'function') return;
      try { el.dispatchEvent(new Ctor(type, opts)); } catch (eF) {}
    };
    if (typeof view.PointerEvent === 'function') fire('pointerdown', view.PointerEvent);
    fire('mousedown', view.MouseEvent);
    if (typeof view.PointerEvent === 'function') fire('pointerup', view.PointerEvent);
    fire('mouseup', view.MouseEvent);
    fire('click', view.MouseEvent);
    try { el.click(); } catch (eC) {}
    try {
      var jq = view.jQuery || view.$;
      if (jq && typeof jq === 'function') jq(el).trigger('click');
    } catch (eJ) {}
  }
  var hit = null;
  var from = 'document';
  var all = docs();
  for (var d = 0; d < all.length && !hit; d++) {
    var nodes = [];
    try { nodes = all[d].querySelectorAll('.tab-item[coursetype], .tab-item, [coursetype]'); } catch (eQ) { nodes = []; }
    for (var i = 0; i < nodes.length; i++) {
      if (!matchTab(nodes[i])) continue;
      hit = nodes[i];
      from = d === 0 ? 'document' : 'iframe';
      break;
    }
  }
  if (!hit) return { ok: false, clicked: false, docs: all.length };
  fireClick(hit);
  return {
    ok: true,
    clicked: true,
    from: from,
    type: String(hit.getAttribute('coursetype') || ''),
    text: compact(hit.innerText || hit.textContent || ''),
  };
})()`

const waitSpaceTab = async (id: string, kind: CourseListKind) => {
  const wantTab = labelOf(kind)
  const started = Date.now()
  while (Date.now() - started < 4500) {
    const live = await readSpaceList(id)
    if (live.tab === wantTab) return live
    await waitMs(280)
  }
  return readSpaceList(id)
}

export const clickSpaceTab = async (id: string, kind: CourseListKind) => {
  const text = labelOf(kind)
  const before = await readSpaceList(id)
  if (before.tab === text) {
    return { ok: true, text, already: true, tab: before.tab, frame: before.frame, via: 'already' }
  }

  const top = asObject(await evalBrowserView(id, CLICK_SPACE_TAB(kind)).catch(() => ({})))
  const fromTop = Boolean(top.clicked)
  let live = await waitSpaceTab(id, kind)
  if (live.tab === text) {
    return { ok: true, text, tab: live.tab, frame: live.frame, via: fromTop ? 'frame-doc' : 'tab-item' }
  }

  const frames = await evalBrowserFrames(id, CLICK_SPACE_TAB(kind)).catch(() => null)
  const fromFrames = (frames?.frames || []).some((row) => Boolean(asObject(row.result).clicked))
  live = await waitSpaceTab(id, kind)
  if (live.tab === text) {
    return { ok: true, text, tab: live.tab, frame: live.frame, via: fromFrames ? 'frame-eval' : 'tab-item' }
  }

  const { invoke } = await import('@tauri-apps/api/core')
  const sel = kind === 'student' ? '.tab-item[coursetype="1"]' : '.tab-item[coursetype="0"]'
  const bySel = asObject(await invoke('browser_cdp_click', { id, selector: sel }).catch(() => ({})))
  live = await waitSpaceTab(id, kind)
  if (live.tab === text) {
    return { ok: true, text, tab: live.tab, frame: live.frame, via: 'cdp-sel' }
  }

  const byText = asObject(await invoke('browser_cdp_click_text', { id, text }).catch(() => ({})))
  live = await waitSpaceTab(id, kind)
  if (live.tab === text) {
    return { ok: true, text, tab: live.tab, frame: live.frame, via: 'cdp-text' }
  }

  return {
    ok: false,
    error: `页签还是「${live.tab || '未知'}」，没有切到「${text}」`,
    text,
    tab: live.tab,
    frame: live.frame || before.frame,
    hint: '页签在 #frame_content 里。再 click_text 一次，或看 get_state.spaceTab。不要 navigate，不要改 iframe src，不要 eval 扫整页。',
    tried: { top: fromTop, frames: fromFrames, selector: Boolean(bySel.ok), text: Boolean(byText.ok) },
  }
}
