import { SAME_ORIGIN_FRAMES } from '../eval'
import type { ActOp, BrowserLocator } from './types'

/** 页内一次探测/执行。必须是单表达式，供 `var value = SCRIPT` 使用。 */
export const ENGINE_ACT_SCRIPT = (input: {
  op: ActOp
  locator: BrowserLocator
  text?: string
}) => `(function(){
${SAME_ORIGIN_FRAMES}
function __zeCompact(s){ return String(s || '').replace(/\\s+/g, ''); }
function __zeEsc(id){
  return String(id || '').replace(/([^a-zA-Z0-9_-])/g, '\\\\$1');
}
function __zeAssocLabel(el){
  if (!el || !el.ownerDocument) return null;
  try {
    if (el.labels && el.labels.length) return el.labels[0];
    var id = el.id;
    if (id) {
      var lab = el.ownerDocument.querySelector('label[for="' + __zeEsc(id) + '"]');
      if (lab) return lab;
    }
    return el.closest ? el.closest('label') : null;
  } catch (e) { return null; }
}
function __zeLabel(el){
  if (!el) return '';
  var tag = String(el.tagName || '').toLowerCase();
  var type = tag === 'input' ? String(el.type || '').toLowerCase() : '';
  var skipValue = type === 'checkbox' || type === 'radio';
  var t = '';
  try { t = el.getAttribute('aria-label') || el.getAttribute('title') || ''; } catch (e) {}
  if (!t && !skipValue) {
    try { t = el.innerText || el.textContent || el.value || el.getAttribute('placeholder') || ''; } catch (e2) {}
  }
  t = String(t || '').replace(/\\s+/g, ' ').trim();
  if (t && t !== 'on') return t;
  var lab = __zeAssocLabel(el);
  if (lab && lab !== el) {
    var lt = String(lab.innerText || lab.textContent || '').replace(/\\s+/g, ' ').trim();
    if (lt) return lt;
  }
  if (skipValue) {
    try {
      var sib = el.nextElementSibling;
      if (sib) {
        var st = String(sib.innerText || sib.textContent || '').replace(/\\s+/g, ' ').trim();
        if (st && st.length <= 40) return st;
      }
      var p = el.parentElement;
      if (p) {
        var pt = String(p.innerText || p.textContent || '').replace(/\\s+/g, ' ').trim();
        if (pt && pt.length <= 40) return pt;
      }
    } catch (e3) {}
  }
  return '';
}
function __zeBox(el){
  try {
    var r = el.getBoundingClientRect();
    return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)].join(',');
  } catch (e) { return ''; }
}
function __zePainted(el){
  if (!el || !el.ownerDocument) return false;
  try {
    var st = (el.ownerDocument.defaultView || window).getComputedStyle(el);
    if (!st || st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    return true;
  } catch (e) { return false; }
}
function __zeVisible(el){
  if (__zePainted(el)) return true;
  var type = '';
  try { type = String(el.type || '').toLowerCase(); } catch (e) {}
  if (type !== 'checkbox' && type !== 'radio') return false;
  var lab = __zeAssocLabel(el);
  if (lab && __zePainted(lab)) return true;
  try {
    if (el.nextElementSibling && __zePainted(el.nextElementSibling)) return true;
    var p = el.parentElement;
    if (p && __zePainted(p) && String(p.innerText || '').replace(/\\s+/g, ' ').trim()) return true;
  } catch (e2) {}
  return false;
}
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
  try {
    if (el.getAttribute('aria-readonly') === 'true') return true;
    if (el.isContentEditable) return false;
  } catch (e) {}
  return false;
}
function __zeEditable(el){
  if (!el) return false;
  var tag = String(el.tagName || '');
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return !__zeDisabled(el) && !__zeReadonly(el);
  try { if (el.isContentEditable) return !__zeDisabled(el); } catch (e) {}
  return false;
}
function __zeHit(el){
  try {
    var doc = el.ownerDocument;
    var r = el.getBoundingClientRect();
    var x = r.left + r.width / 2;
    var y = r.top + r.height / 2;
    var top = doc.elementFromPoint(x, y);
    var hitType = '';
    try { hitType = String(el.type || '').toLowerCase(); } catch (e0) {}
    if (!top) {
      if ((hitType === 'checkbox' || hitType === 'radio') && (__zeAssocLabel(el) || el.nextElementSibling)) return { ok: true, cover: '' };
      return { ok: false, cover: '' };
    }
    var n = top;
    var lab = __zeAssocLabel(el);
    while (n) {
      if (n === el || (lab && (n === lab))) return { ok: true, cover: '' };
      n = n.parentElement;
    }
    if (lab && top && lab.contains && lab.contains(top)) return { ok: true, cover: '' };
    var type = '';
    try { type = String(el.type || '').toLowerCase(); } catch (e2) {}
    if ((type === 'checkbox' || type === 'radio') && lab && __zePainted(lab)) return { ok: true, cover: '' };
    return { ok: false, cover: __zeLabel(top).slice(0, 40) };
  } catch (e) {
    return { ok: true, cover: '' };
  }
}
function __zeScrollNear(el){
  try {
    var n = el.parentElement;
    var doc = el.ownerDocument;
    while (n && n !== doc.body && n !== doc.documentElement) {
      var st = (doc.defaultView || window).getComputedStyle(n);
      var canY = st && (st.overflowY === 'auto' || st.overflowY === 'scroll') && n.scrollHeight > n.clientHeight + 4;
      if (canY) {
        var er = el.getBoundingClientRect();
        var nr = n.getBoundingClientRect();
        n.scrollTop += er.top - nr.top - Math.max(0, (nr.height - er.height) / 2);
        return;
      }
      n = n.parentElement;
    }
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  } catch (e) {}
}
function __zeClickTarget(el){
  var type = '';
  try { type = String(el.type || '').toLowerCase(); } catch (e0) {}
  if ((type === 'checkbox' || type === 'radio') && !__zePainted(el)) {
    var lab = __zeAssocLabel(el);
    if (lab && __zePainted(lab)) return lab;
  }
  var n = el;
  while (n && n.tagName && n.tagName !== 'BODY' && n.tagName !== 'HTML') {
    var tag = n.tagName;
    var role = '';
    try { role = String(n.getAttribute('role') || ''); } catch (e) {}
    if (tag === 'A' || tag === 'BUTTON' || tag === 'INPUT' || tag === 'LABEL' || tag === 'SELECT' || tag === 'TEXTAREA') return n;
    if (role === 'button' || role === 'tab' || role === 'link' || role === 'menuitem') return n;
    n = n.parentElement;
  }
  return el;
}
function __zeFireClick(el){
  __zeScrollNear(el);
  var view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
  var rect = { left: 0, top: 0, width: 2, height: 2 };
  try { rect = el.getBoundingClientRect(); } catch (e) {}
  var x = rect.left + (rect.width || 2) / 2;
  var y = rect.top + (rect.height || 2) / 2;
  var fire = function(type, Ctor){
    try { el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: view, clientX: x, clientY: y })); } catch (e2) {}
  };
  if (typeof PointerEvent === 'function') fire('pointerdown', PointerEvent);
  fire('mousedown', MouseEvent);
  if (typeof PointerEvent === 'function') fire('pointerup', PointerEvent);
  fire('mouseup', MouseEvent);
  if (typeof el.click === 'function') {
    try { el.click(); return true; } catch (e3) {}
  }
  fire('click', MouseEvent);
  return true;
}
function __zeFill(el, text){
  __zeScrollNear(el);
  try { el.focus(); } catch (e) {}
  var tag = String(el.tagName || '');
  if (el.isContentEditable) {
    el.textContent = text;
  } else {
    var proto = tag === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, text);
    else el.value = text;
  }
  try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e2) {}
  try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e3) {}
  return true;
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
  if (tag === 'h1' || tag === 'h2' || tag === 'h3' || tag === 'h4') return 'heading';
  return '';
}
function __zeCollect(loc){
  var by = String(loc.by || 'css');
  var value = String(loc.value || '');
  var name = String(loc.name || '');
  var exact = !!loc.exact;
  var out = [];
  if (!value) return out;
  var frames = __sameFrames(window, 0);
  for (var i = 0; i < frames.length; i++) {
    var doc = null;
    try { doc = frames[i].document; } catch (e) { continue; }
    if (!doc) continue;
    try {
      if (by === 'css') {
        var found = doc.querySelectorAll(value);
        for (var c = 0; c < found.length && out.length < 20; c++) out.push(found[c]);
        continue;
      }
      if (by === 'label') {
        var labels = doc.querySelectorAll('label');
        var want = __zeCompact(value);
        for (var L = 0; L < labels.length; L++) {
          if (__zeCompact(__zeLabel(labels[L])) !== want && __zeCompact(labels[L].innerText || '').indexOf(want) < 0) continue;
          var forId = labels[L].getAttribute('for');
          var ctrl = forId ? doc.getElementById(forId) : labels[L].querySelector('input, textarea, select');
          if (ctrl) out.push(ctrl);
        }
        continue;
      }
      var nodes = doc.querySelectorAll('a, button, input, label, select, textarea, [role="tab"], [role="button"], [role="link"], [role="menuitem"], [contenteditable="true"], span, div, li, h3, h4, p');
      var wantText = __zeCompact(value.replace(/[（(]\\s*\\d+\\s*[）)]\\s*$/g, ''));
      var wantRole = __zeCompact(value).toLowerCase();
      var wantName = __zeCompact(name);
      for (var j = 0; j < nodes.length && out.length < 24; j++) {
        var el = nodes[j];
        var label = __zeCompact(__zeLabel(el));
        if (!label) continue;
        if (by === 'role') {
          if (__zeRoleOf(el) !== wantRole) continue;
          if (wantName && label !== wantName && !(label.length <= 48 && label.indexOf(wantName) >= 0)) continue;
          out.push(el);
          continue;
        }
        var isExact = label === wantText;
        var isFuzzy = !exact && !isExact && label.length <= 48 && label.indexOf(wantText) >= 0;
        if (isExact || isFuzzy) out.push(el);
      }
    } catch (e4) {}
  }
  return out;
}
function __zePickScore(el, want){
  var tag = String(el.tagName || '');
  var role = __zeRoleOf(el);
  var lab = __zeCompact(__zeLabel(el));
  var score = 0;
  if (lab === want) score += 80;
  else if (lab.indexOf(want) >= 0) score += Math.max(4, 40 - Math.max(0, lab.length - want.length));
  if (tag === 'BUTTON' || role === 'button') score += 20;
  else if (tag === 'INPUT') score += 16;
  else if (tag === 'A' || role === 'link') score += 12;
  else if (tag === 'LABEL' || role === 'checkbox' || role === 'radio') score += 18;
  else if (role === 'tab') score += 10;
  try {
    var r = el.getBoundingClientRect();
    score += Math.max(0, 8 - Math.round((r.width + r.height) / 400));
  } catch (e) {}
  return score;
}
function __zePick(list, loc){
  var visible = [];
  for (var i = 0; i < list.length; i++) {
    if (__zeVisible(list[i])) visible.push(list[i]);
  }
  var pool = visible.length ? visible : list;
  if (!pool.length) return { el: null, extra: [] };
  var want = __zeCompact(String(loc.name || loc.value || '').replace(/[（(]\\s*\\d+\\s*[）)]\\s*$/g, ''));
  var exact = [];
  for (var e = 0; e < pool.length; e++) {
    if (__zeCompact(__zeLabel(pool[e])) === want) exact.push(pool[e]);
  }
  var chosen = exact.length ? exact : pool;
  if (chosen.length === 1) return { el: chosen[0], extra: [] };
  var best = chosen[0];
  var bestScore = __zePickScore(best, want);
  var tied = [best];
  for (var k = 1; k < chosen.length; k++) {
    var sc = __zePickScore(chosen[k], want);
    if (sc > bestScore) {
      best = chosen[k];
      bestScore = sc;
      tied = [best];
    } else if (sc === bestScore) {
      tied.push(chosen[k]);
    }
  }
  if (tied.length === 1 || exact.length === 1) return { el: best, extra: [] };
  if (exact.length >= 1) return { el: exact[0], extra: [] };
  return { el: bestScore >= 20 ? best : null, extra: chosen };
}
function __zeAct(op, loc, text){
  var list = __zeCollect(loc);
  if (!list.length) return { ok: false, reason: 'not_found', retry: true, error: '没有找到元素' };
  var picked = __zePick(list, loc);
  if (!picked.el) {
    var names = [];
    var extra = picked.extra;
    for (var i = 0; i < extra.length && names.length < 6; i++) {
      var nm = __zeLabel(extra[i]).slice(0, 24);
      if (nm) names.push({ text: nm, reason: 'ambiguous' });
    }
    return { ok: false, reason: 'ambiguous', retry: false, error: '匹配到多个元素', candidates: names };
  }
  var el = __zeClickTarget(picked.el);
  var cand = [];
  for (var c = 0; c < Math.min(list.length, 5); c++) {
    var ct = __zeLabel(list[c]).slice(0, 24);
    if (ct) cand.push({ text: ct });
  }
  if (!__zeVisible(el)) return { ok: false, reason: 'hidden', retry: true, error: '元素不可见', candidates: cand, box: __zeBox(el) };
  if (__zeDisabled(el)) return { ok: false, reason: 'disabled', retry: true, error: '元素已禁用', candidates: cand, box: __zeBox(el) };
  if (op === 'fill' && !__zeEditable(el)) {
    return { ok: false, reason: __zeReadonly(el) ? 'readonly' : 'disabled', retry: true, error: '输入框不可编辑', candidates: cand, box: __zeBox(el) };
  }
  __zeScrollNear(el);
  var hit = __zeHit(el);
  if (!hit.ok) return { ok: false, reason: 'covered', retry: true, error: '元素被挡住', cover: hit.cover, candidates: cand, box: __zeBox(el) };
  var box = __zeBox(el);
  var sig = String(loc.by || '') + ':' + String(loc.value || '') + ':' + String(loc.name || '');
  var prev = window.__ZE_ACT_BOX__ || null;
  if (prev && prev.sig === sig && prev.box !== box) {
    window.__ZE_ACT_BOX__ = { sig: sig, box: box };
    return { ok: false, reason: 'unstable', retry: true, error: '元素还在动', candidates: cand, box: box };
  }
  window.__ZE_ACT_BOX__ = { sig: sig, box: box };
  if (op === 'ready') return { ok: true, text: __zeLabel(el).slice(0, 80), box: box };
  if (op === 'fill') {
    __zeFill(el, String(text || ''));
    return { ok: true, text: String(text || '').slice(0, 80), box: box };
  }
  __zeFireClick(el);
  return { ok: true, text: __zeLabel(el).slice(0, 80), box: box };
}
return __zeAct(${JSON.stringify(input.op)}, ${JSON.stringify(input.locator)}, ${JSON.stringify(input.text || '')});
})()`
