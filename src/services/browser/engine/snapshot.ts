import { SAME_ORIGIN_FRAMES, asObject, evalBrowserView } from '../eval'
import { rememberPageRefs, type PageRef } from './refs'

const SNAPSHOT_LIMIT = 220

export const SNAPSHOT_SCRIPT = `(function(){
${SAME_ORIGIN_FRAMES}
function __zeChromeName(el){
  try {
    var t = String(el.getAttribute('aria-label') || el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim();
    return t.length && t.length <= 40 ? t : '';
  } catch (e) { return ''; }
}
function __zeChromeWord(value){ return String(value || '').replace(/\\s+/g, ' ').trim(); }
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
  var titled = '';
  try { titled = el.getAttribute('aria-label') || el.getAttribute('title') || ''; } catch (e) {}
  titled = String(titled || '').replace(/\\s+/g, ' ').trim();
  var ph = '';
  if (!skipValue) {
    try { ph = String(el.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').trim(); } catch (ePh) { ph = ''; }
  }
  var t = '';
  if (ph && titled && ph !== titled && (tag === 'input' || tag === 'textarea')) t = ph;
  else t = titled;
  if (!t && !skipValue) {
    try { t = ph || el.innerText || el.textContent || el.value || ''; } catch (e2) {}
  }
  t = String(t || '').replace(/\\s+/g, ' ').trim();
  if (t && t !== 'on' && t === ph) return t.slice(0, 80);
  if (t && t !== 'on' && t.length <= 24) return t.slice(0, 40);
  var chrome = __zeChromeName(el);
  if (chrome) return chrome;
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
  if ((role === 'textbox' || role === 'searchbox') && el) {
    var ph = '';
    try { ph = String(el.getAttribute('placeholder') || '').replace(/\\s+/g, ' ').trim(); } catch (ePh) { ph = ''; }
    var phCss = ph ? ph.split('"').join('') : '';
    if (el.id) return { by: 'css', value: '#' + __zeEsc(el.id), name: name || ph };
    if (phCss) return { by: 'css', value: 'input[placeholder="' + phCss + '"],textarea[placeholder="' + phCss + '"]', name: name || ph };
  }
  if (el.id) return { by: 'css', value: '#' + __zeEsc(el.id) };
  if (role && name && (role === 'button' || role === 'tab' || role === 'link' || role === 'textbox' || role === 'heading' || role === 'treeitem' || role === 'menuitem' || role === 'listitem')) {
    return { by: 'role', value: role, name: name };
  }
  if (name) return { by: 'text', value: name, exact: true };
  return { by: 'css', value: __zePath(el) };
}
function __zeFrameShown(win){
  try {
    if (!win || win === window) return true;
  } catch (e) { return true; }
  var cur = win;
  for (var g = 0; g < 8; g++) {
    var fe = null;
    try { fe = cur.frameElement; } catch (e2) { return false; }
    if (!fe) return true;
    if (!__zePainted(fe)) return false;
    var parent = null;
    try { parent = cur.parent; } catch (e3) { return false; }
    if (!parent || parent === cur) return true;
    cur = parent;
    try { if (cur === window) return true; } catch (e4) { return true; }
  }
  return true;
}
function __zeAssignNth(list){
  var groups = {};
  for (var i = 0; i < list.length; i++) {
    var loc = list[i].locator || {};
    var key = [loc.by, loc.value, loc.name || '', loc.exact ? '1' : '0'].join('\\n');
    if (!groups[key]) groups[key] = [];
    groups[key].push(i);
  }
  for (var k in groups) {
    if (!Object.prototype.hasOwnProperty.call(groups, k) || groups[k].length < 2) continue;
    for (var n = 0; n < groups[k].length; n++) list[groups[k][n]].locator.nth = n + 1;
  }
}
function __zeTakeRefs(buckets){
  var limit = ${SNAPSHOT_LIMIT};
  var topCap = Math.floor(limit / 2);
  var chosen = [];
  var top = buckets.length ? buckets[0].refs : [];
  var topN = buckets.length <= 1 ? Math.min(top.length, limit) : Math.min(top.length, topCap, limit);
  for (var i = 0; i < topN; i++) chosen.push(top[i]);
  var rest = limit - chosen.length;
  var cursors = [];
  for (var c = 1; c < buckets.length; c++) cursors.push(0);
  var guard = 0;
  while (rest > 0 && guard < limit * 4) {
    var progressed = false;
    for (var k = 0; k < cursors.length && rest > 0; k++) {
      var bucketRefs = buckets[k + 1].refs;
      if (cursors[k] < bucketRefs.length) {
        chosen.push(bucketRefs[cursors[k]]);
        cursors[k] += 1;
        rest -= 1;
        progressed = true;
      }
    }
    if (!progressed) break;
    guard += 1;
  }
  for (var n = 0; n < chosen.length; n++) chosen[n].id = 'e' + (n + 1);
  return chosen;
}
function __zeScanFrame(win, path){
  var doc = null;
  try { doc = win.document; } catch (e) { return []; }
  if (!doc) return [];
  var frameHint = '';
  try { frameHint = __zeFrameHint(win); } catch (eFrameHint) {}
  var seen = {};
  var refs = [];
  var cap = ${SNAPSHOT_LIMIT};
  var nodes = [];
  try {
    nodes = doc.querySelectorAll('a, button, input, select, textarea, label, h1, h2, h3, h4, [role="tab"], [role="button"], [role="link"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="listitem"], [role="treeitem"], [contenteditable="true"], [title], [data-url], [data-id], [alt]');
  } catch (e2) { return []; }
  for (var i = 0; i < nodes.length && refs.length < cap; i++) {
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
      var chromeName = __zeChromeName(el);
      if (!__zeVisible(el) && !chromeName) continue;
      if (!role) {
        try { name = String(el.getAttribute('title') || '').replace(/\\s+/g, ' ').trim(); } catch (eTitle) { name = ''; }
        name = __zeChromeWord(name) || chromeName || name;
        if (!name || name.length > 40) continue;
        role = tag === 'a' ? 'link' : (chromeName ? 'button' : 'listitem');
      } else {
        name = __zeLabel(el) || chromeName;
      }
    }
    if (!name && role !== 'textbox') continue;
    var cssPath = __zePath(el);
    if (seen[cssPath]) continue;
    seen[cssPath] = 1;
    var id = 'e' + (refs.length + 1);
    var locator = __zeLocator(el, role, name);
    if (path) locator.framePath = path;
    if (frameHint) locator.frame = frameHint;
    var checked = null;
    if (role === 'checkbox' || role === 'radio') {
      try { checked = !!el.checked; } catch (e3) { checked = null; }
    }
    var value = '';
    if (role === 'textbox') {
      var itype = '';
      try { itype = String(el.type || '').toLowerCase(); } catch (eType) {}
      try {
        var rawVal = String(el.value || '').replace(/\\s+/g, ' ').trim();
        value = itype === 'password' ? (rawVal ? '已填写' : '') : rawVal.slice(0, 80);
      } catch (eVal) {}
    }
    refs.push({ id: id, role: role, name: name || role, value: value, locator: locator, checked: checked, framePath: path, frameLabel: frameHint });
  }
  try {
    var extra = doc.querySelectorAll('label, span, em, i, b, p, li, [data-url], [data-id], [class*="nav"], [class*="check"], [class*="Check"], [class*="auto"], [class*="remember"], [style*="cursor: pointer"]');
    for (var x = 0; x < extra.length && refs.length < ${SNAPSHOT_LIMIT}; x++) {
      var node = extra[x];
      var hook = String(node.getAttribute('data-url') || node.getAttribute('onclick') || node.getAttribute('href') || '');
      var chromeName = __zeChromeName(node);
      if (!__zePainted(node) && !chromeName) continue;
      var extraName = chromeName || String(node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
      extraName = __zeChromeWord(extraName) || extraName;
      if (!extraName || extraName.length < 2 || extraName.length > 24) continue;
      if (seen[__zePath(node)] || seen['name:' + extraName]) continue;
      var st = '';
      try { st = String((node.ownerDocument.defaultView || window).getComputedStyle(node).cursor || ''); } catch (e4) {}
      var cls = String(node.className || '');
      var looksCheck = extraName === '下次自动登录' || extraName === '记住密码' || extraName === '自动登录' || /check|autoLogin|remember/i.test(cls);
      var looksBtn = !!chromeName || /^(登录|注册|提交|确定|下一步)$/.test(extraName);
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
      var extraLoc = { by: 'text', value: extraName, exact: true };
      if (path) extraLoc.framePath = path;
      if (frameHint) extraLoc.frame = frameHint;
      refs.push({
        id: 'e' + (refs.length + 1),
        role: looksCheck ? 'checkbox' : 'button',
        name: extraName,
        locator: extraLoc,
        checked: looksCheck ? extraChecked : null,
        framePath: path,
        frameLabel: frameHint,
      });
    }
  } catch (e5) {}
  __zeAssignNth(refs);
  return refs;
}
function __zeWalkFrames(win, path, depth, buckets, frames){
  if (depth > 4 || frames.length >= 40) return;
  if (!__zeFrameShown(win)) return;
  var doc = null;
  try { doc = win.document; } catch (e) { return; }
  if (!doc) return;
  var hint = '';
  try { hint = __zeFrameHint(win); } catch (eHint) {}
  buckets.push({ path: path, label: hint, refs: __zeScanFrame(win, path) });
  var list = [];
  try { list = doc.querySelectorAll('iframe, frame'); } catch (eList) { return; }
  for (var i = 0; i < list.length && frames.length < 40; i++) {
    var fe = list[i];
    var childPath = path ? (path + '/' + i) : String(i);
    var id = '', mid = '', name = '', srcAttr = '';
    try { id = fe.id || ''; } catch (eId) {}
    try { name = fe.name || ''; } catch (eName) {}
    try { mid = fe.getAttribute('mid') || fe.getAttribute('data-mid') || ''; } catch (eMid) {}
    try { srcAttr = fe.getAttribute('src') || ''; } catch (eSrc) {}
    var label = mid || id || name || '';
    var shown = false;
    try { shown = __zePainted(fe); } catch (ePaint) {}
    if (!shown) {
      frames.push({ path: childPath, id: id, mid: mid, name: name, src: srcAttr, cross: false, hidden: true });
      continue;
    }
    var child = null, href = '', cross = false;
    try {
      child = fe.contentWindow;
      href = String((child && child.location && child.location.href) || '');
    } catch (eCross) { cross = true; }
    var src = href || srcAttr;
    if (!child || cross) {
      frames.push({ path: childPath, id: id, mid: mid, name: name, src: src || srcAttr, cross: true, hidden: false });
      continue;
    }
    var ready = 'loading', filled = false;
    try { ready = child.document.readyState; } catch (eReady) { ready = 'loading'; }
    var blank = !href || href === 'about:blank' || /^(?:about:|javascript:)/i.test(href);
    if (blank) {
      try { filled = !!(child.document && child.document.body && child.document.body.childElementCount); } catch (eFill) {}
    }
    if (ready === 'loading' || (blank && !filled)) continue;
    frames.push({ path: childPath, id: id, mid: mid, name: name, src: src, cross: false, hidden: false });
    __zeWalkFrames(child, childPath, depth + 1, buckets, frames);
  }
}
var buckets = [];
var iframes = [];
__zeWalkFrames(window, '', 0, buckets, iframes);
var refs = __zeTakeRefs(buckets);
var title = String(document.title || '');
if (title.indexOf('ZRRESULT:') === 0) title = '';
var bodyText = '';
try { bodyText = String((document.body && document.body.innerText) || ''); } catch (eBody) {}
var captcha = !!(document.querySelector('#ucode, .yzmInp, form[action*="processVerify"], img[src*="processVerify"]')
  || /请输入图片中的验证码|【\\s*9010\\s*】/.test(bodyText));
window.__ZE_SNAP_REFS__ = refs;
return { url: location.href, title: title, captcha: captcha, iframes: iframes, refs: refs };
})()`

export type SnapFrameInfo = {
  path: string
  id: string
  mid: string
  name: string
  src: string
  cross?: boolean
  hidden?: boolean
}

const refLine = (ref: PageRef) => {
  const name = ref.name ? ` ${JSON.stringify(ref.name)}` : ''
  const value = ref.value ? ` value=${JSON.stringify(ref.value)}` : ''
  const check = ref.checked == null ? '' : ref.checked ? ' [checked]' : ' [unchecked]'
  return `- ${ref.role || 'generic'}${name} [ref=${ref.id}]${value}${check}`
}

const frameLabelOf = (frame: SnapFrameInfo) => frame.mid || frame.id || frame.name || frame.src || frame.path

export const formatAriaSnapshot = (refs: PageRef[], frames: SnapFrameInfo[] = []) => {
  const groups = new Map<string, PageRef[]>()
  for (const ref of refs) {
    const key = ref.framePath || ''
    const list = groups.get(key) || []
    list.push(ref)
    groups.set(key, list)
  }
  const lines: string[] = []
  const emitted = new Set<string>()
  const emitGroup = (path: string, label: string) => {
    if (emitted.has(path)) return
    emitted.add(path)
    const list = groups.get(path) || []
    if (!list.length && !path) return
    if (path) lines.push(`- iframe ${JSON.stringify(label || path)} [frame=${path}]`)
    const indent = path ? '  ' : ''
    for (const ref of list) lines.push(indent + refLine(ref))
  }
  emitGroup('', '')
  for (const frame of frames) {
    if (frame.hidden) continue
    if (frame.cross) {
      lines.push(`- iframe ${JSON.stringify(frameLabelOf(frame))} [frame=${frame.path}] cross-origin`)
      emitted.add(frame.path)
      continue
    }
    emitGroup(frame.path, frameLabelOf(frame))
  }
  for (const path of groups.keys()) {
    if (!emitted.has(path)) emitGroup(path, path)
  }
  return lines.join('\n')
}

export const readPageSnapshot = async (browserId: string) => {
  const raw = asObject(await evalBrowserView(browserId, SNAPSHOT_SCRIPT).catch(() => ({ refs: [] })))
  const refs = (Array.isArray(raw.refs) ? raw.refs : []).map((item, index) => {
    const row = asObject(item)
    const locator = asObject(row.locator)
    return {
      id: String(row.id || `e${index + 1}`),
      role: String(row.role || ''),
      name: String(row.name || ''),
      ...(row.value ? { value: String(row.value) } : {}),
      ...(row.framePath ? { framePath: String(row.framePath) } : {}),
      ...(row.role === 'checkbox' || row.role === 'radio' ? { checked: Boolean(row.checked) } : {}),
      locator: {
        by: (String(locator.by || 'text') as PageRef['locator']['by']),
        value: String(locator.value || row.name || ''),
        name: locator.name ? String(locator.name) : undefined,
        exact: Boolean(locator.exact),
        nth: Number(locator.nth) > 0 ? Number(locator.nth) : undefined,
        frame: locator.frame ? String(locator.frame) : undefined,
        framePath: locator.framePath ? String(locator.framePath) : (row.framePath ? String(row.framePath) : undefined),
        role: String(row.role || ''),
      },
    } satisfies PageRef
  }).filter((item) => item.locator.value)
  rememberPageRefs(browserId, refs)
  const iframes = (Array.isArray(raw.iframes) ? raw.iframes : []).map((item) => {
    const row = asObject(item)
    return {
      path: String(row.path || ''),
      id: String(row.id || ''),
      mid: String(row.mid || ''),
      name: String(row.name || ''),
      src: String(row.src || ''),
      cross: Boolean(row.cross),
      hidden: Boolean(row.hidden),
    }
  }).filter((item) => item.src || item.path)
  return {
    url: String(raw.url || ''),
    title: String(raw.title || ''),
    captcha: Boolean(raw.captcha),
    iframes,
    refs,
    snapshot: formatAriaSnapshot(refs, iframes),
  }
}
