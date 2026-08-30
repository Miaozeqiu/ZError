import { SAME_ORIGIN_FRAMES, asObject, evalBrowserView } from '../eval'
import { rememberPageRefs, type PageRef } from './refs'

const SNAPSHOT_LIMIT = 80

const SNAPSHOT_SCRIPT = `(function(){
${SAME_ORIGIN_FRAMES}
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
    try { t = el.getAttribute('placeholder') || el.innerText || el.textContent || el.value || ''; } catch (e2) {}
  }
  t = String(t || '').replace(/\\s+/g, ' ').trim();
  if (t && t !== 'on') return t.slice(0, 40);
  var lab = __zeAssocLabel(el);
  if (lab && lab !== el) {
    var lt = String(lab.innerText || lab.textContent || '').replace(/\\s+/g, ' ').trim();
    if (lt) return lt.slice(0, 40);
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
function __zePainted(el){
  if (!el || !el.ownerDocument) return false;
  try {
    var st = (el.ownerDocument.defaultView || window).getComputedStyle(el);
    if (!st || st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0) return false;
    var r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
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
function __zeRole(el){
  try {
    var role = String(el.getAttribute('role') || '').toLowerCase();
    if (role) return role;
  } catch (e) {}
  var tag = String(el.tagName || '').toLowerCase();
  if (tag === 'a') return 'link';
  if (tag === 'button') return 'button';
  if (tag === 'textarea') return 'textbox';
  if (tag === 'select') return 'combobox';
  if (tag === 'input') {
    var type = String(el.type || 'text').toLowerCase();
    if (type === 'submit' || type === 'button' || type === 'image') return 'button';
    if (type === 'checkbox') return 'checkbox';
    if (type === 'radio') return 'radio';
    if (type === 'hidden') return '';
    return 'textbox';
  }
  if (/^h[1-4]$/.test(tag)) return 'heading';
  return '';
}
function __zePath(el){
  if (el.id) return '#' + __zeEsc(el.id);
  var parts = [];
  var n = el;
  while (n && n.nodeType === 1 && parts.length < 5 && n.tagName !== 'HTML') {
    var name = String(n.tagName || '').toLowerCase();
    if (n.id) { parts.unshift('#' + __zeEsc(n.id)); break; }
    var parent = n.parentElement;
    if (parent) {
      var same = 0;
      var idx = 0;
      var kids = parent.children;
      for (var i = 0; i < kids.length; i++) {
        if (kids[i].tagName === n.tagName) {
          same += 1;
          if (kids[i] === n) idx = same;
        }
      }
      if (same > 1) name += ':nth-of-type(' + idx + ')';
    }
    parts.unshift(name);
    n = parent;
  }
  return parts.join('>');
}
function __zeLocator(el, role, name){
  if (role === 'checkbox' || role === 'radio') {
    if (name) return { by: 'label', value: name };
    if (el.id) return { by: 'css', value: '#' + __zeEsc(el.id) };
  }
  if (el.id) return { by: 'css', value: '#' + __zeEsc(el.id) };
  if (role && name && (role === 'button' || role === 'tab' || role === 'link' || role === 'textbox')) {
    return { by: 'role', value: role, name: name };
  }
  if (name) return { by: 'text', value: name, exact: true };
  return { by: 'css', value: __zePath(el) };
}
var seen = {};
var refs = [];
var frames = __sameFrames(window, 0);
for (var f = 0; f < frames.length && refs.length < ${SNAPSHOT_LIMIT}; f++) {
  var doc = null;
  try { doc = frames[f].document; } catch (e) { continue; }
  if (!doc) continue;
  var nodes = [];
  try {
    nodes = doc.querySelectorAll('a, button, input, select, textarea, label, [role="tab"], [role="button"], [role="link"], [role="menuitem"], [role="checkbox"], [role="radio"], [contenteditable="true"]');
  } catch (e2) { continue; }
  for (var i = 0; i < nodes.length && refs.length < ${SNAPSHOT_LIMIT}; i++) {
    var el = nodes[i];
    var tag = String(el.tagName || '').toLowerCase();
    var role = __zeRole(el);
    var name = '';
    if (tag === 'label') {
      var forId = el.getAttribute('for') || '';
      var ctrl = forId ? doc.getElementById(forId) : el.querySelector('input[type="checkbox"], input[type="radio"]');
      var ctype = ctrl ? String(ctrl.type || '').toLowerCase() : '';
      if (!ctrl || (ctype !== 'checkbox' && ctype !== 'radio')) continue;
      if (seen[__zePath(ctrl)]) continue;
      if (!__zePainted(el) && !__zeVisible(ctrl)) continue;
      role = ctype;
      name = __zeLabel(el) || __zeLabel(ctrl);
      el = ctrl;
    } else {
      if (!__zeVisible(el)) continue;
      if (!role || role === 'heading') continue;
      name = __zeLabel(el);
    }
    if (!name && role !== 'textbox') continue;
    var path = __zePath(el);
    if (seen[path]) continue;
    seen[path] = 1;
    var id = 'e' + (refs.length + 1);
    var locator = __zeLocator(el, role, name);
    var checked = null;
    if (role === 'checkbox' || role === 'radio') {
      try { checked = !!el.checked; } catch (e3) { checked = null; }
    }
    refs.push({ id: id, role: role, name: name || role, locator: locator, checked: checked });
  }
  try {
    var extra = doc.querySelectorAll('label, span, em, i, b, p, [class*="check"], [class*="Check"], [class*="auto"], [class*="remember"], [style*="cursor: pointer"]');
    for (var x = 0; x < extra.length && refs.length < ${SNAPSHOT_LIMIT}; x++) {
      var node = extra[x];
      if (!__zePainted(node)) continue;
      var extraName = String(node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!extraName || extraName.length < 2 || extraName.length > 16) continue;
      if (seen[__zePath(node)] || seen['name:' + extraName]) continue;
      var st = '';
      try { st = String((node.ownerDocument.defaultView || window).getComputedStyle(node).cursor || ''); } catch (e4) {}
      var cls = String(node.className || '');
      var looksCheck = extraName === '下次自动登录' || extraName === '记住密码' || extraName === '自动登录' || /check|autoLogin|remember/i.test(cls);
      var looksBtn = extraName === '登录' || extraName === '注册' || extraName === '提交' || extraName === '确定' || extraName === '下一步';
      if (!looksCheck && !looksBtn && st !== 'pointer' && String(node.tagName || '') !== 'LABEL') continue;
      seen[__zePath(node)] = 1;
      seen['name:' + extraName] = 1;
      var extraChecked = false;
      if (looksCheck) {
        var near = node.querySelector ? node.querySelector('input[type="checkbox"]') : null;
        if (!near && node.closest) {
          var wrap = node.closest('.auto-lg-next, .auto-login, label, p');
          near = wrap ? wrap.querySelector('input[type="checkbox"], .check-input') : null;
        }
        try { extraChecked = !!(near && near.checked); } catch (e6) {}
        if (!extraChecked && /\\b(checked|active|on)\\b/i.test(cls + ' ' + String((node.parentElement && node.parentElement.className) || ''))) extraChecked = true;
      }
      refs.push({
        id: 'e' + (refs.length + 1),
        role: looksCheck ? 'checkbox' : 'button',
        name: extraName,
        locator: { by: 'text', value: extraName, exact: true },
        checked: looksCheck ? extraChecked : null,
      });
    }
  } catch (e5) {}
}
window.__ZE_SNAP_REFS__ = refs;
return { refs: refs };
})()`

export const readPageSnapshot = async (browserId: string) => {
  const raw = asObject(await evalBrowserView(browserId, SNAPSHOT_SCRIPT).catch(() => ({ refs: [] })))
  const refs = (Array.isArray(raw.refs) ? raw.refs : []).map((item, index) => {
    const row = asObject(item)
    const locator = asObject(row.locator)
    return {
      id: String(row.id || `e${index + 1}`),
      role: String(row.role || ''),
      name: String(row.name || ''),
      ...(row.role === 'checkbox' || row.role === 'radio' ? { checked: Boolean(row.checked) } : {}),
      locator: {
        by: (String(locator.by || 'text') as PageRef['locator']['by']),
        value: String(locator.value || row.name || ''),
        name: locator.name ? String(locator.name) : undefined,
        exact: Boolean(locator.exact),
      },
    } satisfies PageRef
  }).filter((item) => item.locator.value)
  rememberPageRefs(browserId, refs)
  return refs
}
