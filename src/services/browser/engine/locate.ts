import { SAME_ORIGIN_FRAMES } from '../eval'
import { siteSelectorsForText } from './clickFind'
import type { ActReason, BrowserLocator } from './types'

/** 可再探：节点还没好。ambiguous / disabled / invalid 立刻失败。 */
export const RETRYABLE_REASONS: ActReason[] = [
  'not_found',
  'hidden',
  'covered',
  'unstable',
  'readonly',
  'timeout',
]

export const isRetryableReason = (reason?: ActReason | string) => (
  RETRYABLE_REASONS.includes(String(reason || '') as ActReason)
)

export const locatorsToTry = (locator: BrowserLocator): BrowserLocator[] => {
  const value = String(locator.value || '').trim()
  if (!value) return []
  if (locator.by === 'text' || locator.by === 'label') {
    const css = siteSelectorsForText(value).map((sel) => ({ by: 'css' as const, value: sel }))
    return [...css, { ...locator, value }]
  }
  return [{ ...locator, value }]
}

/** 元素中心 → 顶层 page CSS 像素，给 CDP Input 用。与学习通 LOCATE_* 的 boxOf 同语义。 */
export const BOX_OF_PAGE = `function boxOf(el){
  if (!el) return null;
  function map(){
    var r = null;
    try { r = el.getBoundingClientRect(); } catch (e1) {}
    if (!r || r.width < 2 || r.height < 2) return null;
    var x = r.left + r.width / 2;
    var y = r.top + r.height / 2;
    var win = el.ownerDocument && el.ownerDocument.defaultView;
    var topWin = null;
    try { topWin = (win && win.top) || win; } catch (e2) { topWin = win; }
    var reached = !win || !topWin || win === topWin;
    for (var g = 0; win && topWin && win !== topWin && g < 8; g++) {
      var frame = null;
      try { frame = win.frameElement; } catch (e3) { break; }
      if (!frame) break;
      var fr = null;
      try { fr = frame.getBoundingClientRect(); } catch (e4) {}
      if (!fr) break;
      x += fr.left + (Number(frame.clientLeft) || 0);
      y += fr.top + (Number(frame.clientTop) || 0);
      try { win = win.parent; } catch (e5) { win = null; break; }
      if (win === topWin) reached = true;
    }
    return { x: x, y: y, space: reached ? 'page' : 'frame', area: r.width * r.height };
  }
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e0) {}
  var pos = map();
  if (!pos) return null;
  if (pos.space === 'page') {
    var topWin = null;
    try { topWin = (el.ownerDocument && el.ownerDocument.defaultView && el.ownerDocument.defaultView.top) || window.top; } catch (e6) {}
    var vw = 0, vh = 0;
    try { vw = (topWin && topWin.innerWidth) || 0; vh = (topWin && topWin.innerHeight) || 0; } catch (e7) {}
    if (vw > 2 && vh > 2 && (pos.x < 2 || pos.y < 2 || pos.x > vw - 2 || pos.y > vh - 2)) {
      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e8) {}
      pos = map() || pos;
    }
  }
  return pos;
}`

const LOCATE_HELPERS = `function __zeCompact(s){ return String(s || '').replace(/\\s+/g, ''); }
function __zeLabel(el){
  if (!el) return '';
  var t = '';
  try { t = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || ''; } catch (e) {}
  t = String(t || '').replace(/\\s+/g, ' ').trim();
  if (t && t.length <= 40) return t;
  try { t = String(el.innerText || el.textContent || el.value || el.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').trim(); } catch (e2) { t = ''; }
  return t.slice(0, 80);
}
function __zePainted(el){
  if (!el || !el.ownerDocument) return false;
  try {
    var st = (el.ownerDocument.defaultView || window).getComputedStyle(el);
    if (!st || st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  } catch (e) { return false; }
}
function __zeVisible(el){ return __zePainted(el); }
function __zeDisabled(el){
  if (!el) return false;
  if (el.disabled) return true;
  try {
    if (el.getAttribute('aria-disabled') === 'true') return true;
    if (el.closest && el.closest('[disabled], [aria-disabled="true"]')) return true;
  } catch (e) {}
  return false;
}
function __zeReadonly(el){
  if (!el) return false;
  if (el.readOnly) return true;
  try { if (el.getAttribute('aria-readonly') === 'true') return true; } catch (e) {}
  return false;
}
function __zeHit(el){
  try {
    var doc = el.ownerDocument;
    var r = el.getBoundingClientRect();
    var x = r.left + r.width / 2;
    var y = r.top + r.height / 2;
    var top = null;
    try { top = doc.elementFromPoint(x, y); } catch (e0) {}
    if (!top) return { ok: true, cover: '' };
    var n = top;
    while (n) {
      if (n === el) return { ok: true, cover: '' };
      n = n.parentElement;
    }
    if (el.contains && el.contains(top)) return { ok: true, cover: '' };
    return { ok: false, cover: __zeLabel(top).slice(0, 40) };
  } catch (e) {
    return { ok: true, cover: '' };
  }
}
function __zeClickable(el){
  var cur = el;
  for (var i = 0; i < 5 && cur; i++) {
    var tag = String(cur.tagName || '').toLowerCase();
    try {
      if (cur.getAttribute('coursetype') || /\\btab-item\\b/.test(String(cur.className || ''))) return cur;
    } catch (eTab) {}
    if (tag === 'a' || tag === 'button' || tag === 'label' || tag === 'input' || tag === 'textarea' || tag === 'select') return cur;
    try {
      var role = String(cur.getAttribute('role') || '');
      if (role === 'tab' || role === 'button' || role === 'link' || role === 'menuitem') return cur;
      if (cur.getAttribute('onclick') || cur.getAttribute('data-url') || cur.getAttribute('href')) return cur;
    } catch (e) {}
    var parent = cur.parentElement;
    if (!parent || (parent.childElementCount || 0) > 8) return cur;
    cur = parent;
  }
  return el;
}
function __zeRoleOf(el){
  try {
    var role = String(el.getAttribute('role') || '').toLowerCase();
    if (role) return role;
  } catch (e) {}
  var tag = String(el.tagName || '').toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'input') {
    var type = String(el.type || 'text').toLowerCase();
    if (type === 'submit' || type === 'button') return 'button';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    return 'textbox';
  }
  if (tag === 'textarea') return 'textbox';
  if (tag === 'select') return 'combobox';
  return '';
}
function __zeFindText(doc, want){
  if (!doc || !doc.body || !want) return [];
  var walker = null;
  var showText = (window.NodeFilter && window.NodeFilter.SHOW_TEXT) || 4;
  try { walker = doc.createTreeWalker(doc.body, showText, null); } catch (e) { return []; }
  var out = [];
  var n = null;
  var seen = 0;
  var exact = [];
  var fuzzy = [];
  while ((n = walker.nextNode())) {
    if (++seen > 4000) break;
    var tx = __zeCompact(n.nodeValue);
    if (!tx || tx.length > 64) continue;
    if (tx.indexOf('删除') >= 0 && want.indexOf('删除') < 0) continue;
    var hit = tx === want;
    var near = !hit && tx.length <= want.length + 8 && tx.indexOf(want) >= 0;
    if (!hit && !near) continue;
    var el = n.parentElement;
    if (!el) continue;
    var kids = 0;
    try { kids = el.childElementCount || 0; } catch (e2) { kids = 0; }
    if (kids > 12) continue;
    var node = __zeClickable(el);
    if (!node) continue;
    if (hit) exact.push(node);
    else fuzzy.push(node);
  }
  out = exact.length ? exact : fuzzy;
  var uniq = [];
  for (var i = 0; i < out.length; i++) {
    if (uniq.indexOf(out[i]) < 0) uniq.push(out[i]);
  }
  return uniq;
}
function __zeCollect(loc){
  var by = String(loc.by || 'css');
  var value = String(loc.value || '');
  var name = String(loc.name || '');
  var exact = !!loc.exact;
  var out = [];
  if (!value) return out;
  var frames = __sameFrames(window, 0);
  var want = __zeCompact(value);
  for (var i = 0; i < frames.length; i++) {
    var doc = null;
    try { doc = frames[i].document; } catch (e) { continue; }
    if (!doc) continue;
    try {
      if (by === 'css') {
        var found = doc.querySelectorAll(value);
        for (var c = 0; c < found.length && out.length < 24; c++) out.push(found[c]);
        continue;
      }
      if (by === 'label') {
        var labels = doc.querySelectorAll('label');
        for (var L = 0; L < labels.length; L++) {
          var lt = __zeCompact(__zeLabel(labels[L]));
          if (lt !== want && lt.indexOf(want) < 0) continue;
          var forId = labels[L].getAttribute('for');
          var ctrl = forId ? doc.getElementById(forId) : labels[L].querySelector('input, textarea, select');
          out.push(ctrl || labels[L]);
        }
        continue;
      }
      if (by === 'text') {
        var texts = __zeFindText(doc, want);
        for (var t = 0; t < texts.length && out.length < 24; t++) out.push(texts[t]);
        var tagged = doc.querySelectorAll('a, button, input, label, [role="tab"], [role="button"], [role="link"], [title], [aria-label]');
        for (var g = 0; g < tagged.length && out.length < 24; g++) {
          var gl = __zeCompact(__zeLabel(tagged[g]));
          if (gl === want || gl.indexOf(want) === 0) out.push(tagged[g]);
        }
        continue;
      }
      var nodes = doc.querySelectorAll('a, button, input, label, select, textarea, [role], [onclick], [data-url], [title]');
      var wantRole = want.toLowerCase();
      var wantName = __zeCompact(name);
      for (var j = 0; j < nodes.length && out.length < 24; j++) {
        var el = nodes[j];
        var label = __zeCompact(__zeLabel(el));
        if (by === 'role') {
          if (__zeRoleOf(el) !== wantRole) continue;
          if (wantName && label !== wantName && label.indexOf(wantName) < 0) continue;
          out.push(el);
          continue;
        }
        if (!label) continue;
        if (label === want || (!exact && label.length <= 48 && label.indexOf(want) >= 0)) out.push(el);
      }
    } catch (e4) {}
  }
  var uniq = [];
  for (var u = 0; u < out.length; u++) {
    if (uniq.indexOf(out[u]) < 0) uniq.push(out[u]);
  }
  return uniq;
}
function __zePick(list, loc){
  var visible = [];
  for (var i = 0; i < list.length; i++) {
    if (__zeVisible(list[i])) visible.push(list[i]);
  }
  var pool = visible.length ? visible : list;
  if (!pool.length) return { el: null, extra: [] };
  if (pool.length === 1) return { el: pool[0], extra: [] };
  var want = __zeCompact(String(loc.name || loc.value || ''));
  var exact = [];
  for (var e = 0; e < pool.length; e++) {
    if (__zeCompact(__zeLabel(pool[e])) === want) exact.push(pool[e]);
  }
  if (exact.length === 1) return { el: exact[0], extra: [] };
  if (exact.length > 1) return { el: null, extra: exact };
  if (String(loc.by || '') === 'css') return { el: null, extra: pool };
  return { el: null, extra: pool };
}
function __zeFail(reason, extra){
  extra = extra || {};
  extra.ok = false;
  extra.reason = reason;
  extra.retry = reason === 'not_found' || reason === 'hidden' || reason === 'covered' || reason === 'unstable' || reason === 'readonly';
  extra.error = extra.error || ({
    not_found: '没有找到元素',
    hidden: '元素不可见',
    covered: '元素被挡住',
    disabled: '元素已禁用',
    readonly: '输入框不可编辑',
    unstable: '元素还在动',
    ambiguous: '匹配到多个元素',
    invalid: '缺少定位条件'
  })[reason] || '定位失败';
  return extra;
}
function __zeReady(el, loc){
  var cand = [];
  var label = __zeLabel(el).slice(0, 80);
  if (!__zeVisible(el)) return __zeFail('hidden', { text: label, candidates: cand });
  if (__zeDisabled(el)) return __zeFail('disabled', { text: label, retry: false });
  var hit = __zeHit(el);
  if (!hit.ok) return __zeFail('covered', { text: label, cover: hit.cover });
  var pos = boxOf(el);
  if (!pos) return __zeFail('hidden', { text: label });
  var box = [Math.round(pos.x), Math.round(pos.y)].join(',');
  var sig = String(loc.by || '') + ':' + String(loc.value || '') + ':' + String(loc.name || '');
  var prev = window.__ZE_LOCATE_BOX__ || null;
  if (prev && prev.sig === sig && prev.box !== box) {
    window.__ZE_LOCATE_BOX__ = { sig: sig, box: box };
    return __zeFail('unstable', { text: label, box: box });
  }
  window.__ZE_LOCATE_BOX__ = { sig: sig, box: box };
  return {
    ok: true,
    x: pos.x,
    y: pos.y,
    space: pos.space,
    area: pos.area,
    text: label,
    exact: __zeCompact(label) === __zeCompact(String(loc.name || loc.value || '')),
  };
}`

export const buildLocateBoxScript = (locator: BrowserLocator) => `(function(){
${SAME_ORIGIN_FRAMES}
${BOX_OF_PAGE}
${LOCATE_HELPERS}
  var loc = ${JSON.stringify({
    by: locator.by,
    value: String(locator.value || '').trim(),
    name: locator.name || '',
    exact: Boolean(locator.exact),
  })};
  if (!loc.value) return __zeFail('invalid', { retry: false });
  var list = __zeCollect(loc);
  if (!list.length) return __zeFail('not_found');
  var picked = __zePick(list, loc);
  if (!picked.el) {
    var names = [];
    var extra = picked.extra || [];
    for (var i = 0; i < extra.length && names.length < 6; i++) {
      var nm = __zeLabel(extra[i]).slice(0, 24);
      if (nm) names.push({ text: nm, reason: 'ambiguous' });
    }
    return __zeFail('ambiguous', { retry: false, candidates: names });
  }
  return __zeReady(picked.el, loc);
})()`
