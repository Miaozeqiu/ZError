import { SAME_ORIGIN_FRAMES, asObject, evalBrowserView } from '../eval'
import { CHROME_HELPERS } from './chrome'
import { rememberPageRefs, type PageRef } from './refs'

const SNAPSHOT_LIMIT = 220

const SNAPSHOT_SCRIPT = `(function(){
${SAME_ORIGIN_FRAMES}
${CHROME_HELPERS}
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
  if (el.id) return { by: 'css', value: '#' + __zeEsc(el.id) };
  if (role && name && (role === 'button' || role === 'tab' || role === 'link' || role === 'textbox' || role === 'heading')) {
    return { by: 'role', value: role, name: name };
  }
  if (name) return { by: 'text', value: name, exact: true };
  return { by: 'css', value: __zePath(el) };
}
function __zePushChrome(el, name){
  if (!el || !name || seen['name:' + name]) return;
  var path = __zePath(el);
  if (seen[path]) return;
  seen[path] = 1;
  seen['name:' + name] = 1;
  refs.push({
    id: 'e' + (refs.length + 1),
    role: 'button',
    name: name,
    locator: { by: 'text', value: name, exact: true },
    checked: null,
  });
}
function __zeCollectChrome(doc){
  var list = [];
  try {
    list = doc.querySelectorAll('.tab-item[coursetype], .tab-item, [coursetype], [data-url], [data-href], [data-id], [data-header], [onclick*="pageHeader"], a[href*="pageHeader"], [title="作业"], [title="章节"], [title="任务"], [title="我学的课"], [title="我教的课"], [title="已学的课"], [title="统计"], [title="资料"], [title="考试"], [title="讨论"], [title="通知"], [aria-label="作业"], [aria-label="章节"], [aria-label="我学的课"]');
  } catch (eC) { return; }
  for (var c = 0; c < list.length && refs.length < ${SNAPSHOT_LIMIT}; c++) {
    __zePushChrome(list[c], __zeChromeName(list[c]));
  }
  if (doc.body) {
    var walker = null;
    try { walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null); } catch (eT) { walker = null; }
    var nodeText = null;
    var seenText = 0;
    while (walker && (nodeText = walker.nextNode())) {
      if (++seenText > 3000) break;
      var tx = String(nodeText.nodeValue || '').replace(/\s+/g, '');
      if (tx !== '我学的课' && tx !== '我教的课' && tx !== '已学的课') continue;
      var el = nodeText.parentElement;
      if (!el) continue;
      __zePushChrome(el, tx === '已学的课' ? '我学的课' : tx);
    }
  }
  if (seen['name:作业'] && seen['name:我学的课']) return;
  var rail = [];
  try { rail = doc.querySelectorAll('a, button, li, span, p, [class*="nav"], [class*="Nav"], [class*="tab"]'); } catch (eR) { return; }
  var railMax = rail.length < 200 ? rail.length : 200;
  for (var r = 0; r < railMax && refs.length < ${SNAPSHOT_LIMIT}; r++) {
    var node = rail[r];
    var box = null;
    try { box = node.getBoundingClientRect(); } catch (eB) { continue; }
    if (!box || box.left > 180 || box.left + box.width > 280) continue;
    if (box.width < 12 || box.height < 12 || box.top < 36 || box.top > 920) continue;
    __zePushChrome(node, __zeChromeName(node));
  }
}
var seen = {};
var refs = [];
var frames = __sameFrames(window, 0);
for (var f = 0; f < frames.length && refs.length < ${SNAPSHOT_LIMIT}; f++) {
  var doc = null;
  try { doc = frames[f].document; } catch (e) { continue; }
  if (!doc) continue;
  __zeCollectChrome(doc);
  var nodes = [];
  try {
    nodes = doc.querySelectorAll('a, button, input, select, textarea, label, h1, h2, h3, h4, [role="tab"], [role="button"], [role="link"], [role="menuitem"], [role="checkbox"], [role="radio"], [role="listitem"], [role="treeitem"], [contenteditable="true"], [title], [data-url], [data-id], [alt]');
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
    var path = __zePath(el);
    if (seen[path]) continue;
    seen[path] = 1;
    var id = 'e' + (refs.length + 1);
    var locator = __zeLocator(el, role, name);
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
    refs.push({ id: id, role: role, name: name || role, value: value, locator: locator, checked: checked });
  }
  try {
    var extra = doc.querySelectorAll('label, span, em, i, b, p, li, [data-url], [data-id], [class*="nav"], [class*="check"], [class*="Check"], [class*="auto"], [class*="remember"], [style*="cursor: pointer"]');
    for (var x = 0; x < extra.length && refs.length < ${SNAPSHOT_LIMIT}; x++) {
      var node = extra[x];
      var hook = String(node.getAttribute('data-url') || node.getAttribute('onclick') || node.getAttribute('href') || '');
      var chromeName = __zeChromeName(node);
      var isHwTab = chromeName === '作业' || /pageHeader=8|\\/work\\//i.test(hook);
      if (!__zePainted(node) && !chromeName && !isHwTab) continue;
      var extraName = chromeName || String(node.getAttribute('aria-label') || node.getAttribute('title') || node.innerText || node.textContent || '').replace(/\\s+/g, ' ').trim();
      extraName = __zeChromeWord(extraName) || extraName;
      if (isHwTab) extraName = extraName || '作业';
      if (!extraName || extraName.length < 2 || extraName.length > 24) continue;
      if (seen[__zePath(node)] || seen['name:' + extraName]) continue;
      var st = '';
      try { st = String((node.ownerDocument.defaultView || window).getComputedStyle(node).cursor || ''); } catch (e4) {}
      var cls = String(node.className || '');
      var looksCheck = extraName === '下次自动登录' || extraName === '记住密码' || extraName === '自动登录' || /check|autoLogin|remember/i.test(cls);
      var looksBtn = !!chromeName || isHwTab || /^(登录|注册|提交|确定|下一步|打开课程|我的课程|进入课程|开始学习|章节|作业|任务|统计|资料|考试|讨论|通知|我学的课|我教的课|已学的课)$/.test(extraName);
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
var extras = window.__ZE_FRAME_SNAPS__ || [];
var extraLines = 0;
var topHref = '';
try { topHref = String(location.href || '').split('#')[0]; } catch (eTop) {}
for (var e = 0; e < extras.length && refs.length < ${SNAPSHOT_LIMIT}; e++) {
  var extraItem = extras[e] || {};
  var extraHref = String(extraItem.href || '').split('#')[0];
  if (extraHref && extraHref === topHref) continue;
  var extraRefs = extraItem.refs || [];
  if (extraRefs.length) {
    for (var r = 0; r < extraRefs.length && refs.length < ${SNAPSHOT_LIMIT}; r++) {
      var er = extraRefs[r] || {};
      var en = String(er.name || '').replace(/\\s+/g, ' ').trim();
      if (!en || en.length < 2 || en.length > 40) continue;
      if (seen['name:' + en]) continue;
      seen['name:' + en] = 1;
      refs.push({
        id: 'e' + (refs.length + 1),
        role: er.role || 'link',
        name: en,
        value: String(er.value || ''),
        locator: { by: 'text', value: en, exact: true },
        checked: null,
      });
    }
    continue;
  }
  var extraText = String(extraItem.text || '');
  if (!extraText) continue;
  var lines = extraText.split(/\\n/);
  for (var L = 0; L < lines.length && refs.length < ${SNAPSHOT_LIMIT} && extraLines < 40; L++) {
    var line = String(lines[L] || '').replace(/\\s+/g, ' ').trim();
    if (!line || line.length < 2 || line.length > 36) continue;
    if (seen['name:' + line]) continue;
    seen['name:' + line] = 1;
    extraLines += 1;
    refs.push({
      id: 'e' + (refs.length + 1),
      role: 'listitem',
      name: line,
      locator: { by: 'text', value: line, exact: true },
      checked: null,
    });
  }
}
var title = String(document.title || '');
if (title.indexOf('ZRRESULT:') === 0) title = '';
var bodyText = '';
try { bodyText = String((document.body && document.body.innerText) || ''); } catch (eBody) {}
var captcha = !!(document.querySelector('#ucode, .yzmInp, form[action*="processVerify"], img[src*="processVerify"]')
  || /请输入图片中的验证码|【\\s*9010\\s*】/.test(bodyText));
var iframes = [];
try {
          var frameEls = document.querySelectorAll('iframe[src]');
  for (var fi = 0; fi < frameEls.length && iframes.length < 8; fi++) {
    var fe = frameEls[fi];
    var live = '';
    try { live = String((fe.contentWindow && fe.contentWindow.location && fe.contentWindow.location.href) || ''); } catch (eLive) {}
    iframes.push({ id: fe.id || '', src: live || fe.src || '' });
  }
} catch (eFrame) {}
window.__ZE_SNAP_REFS__ = refs;
return { url: location.href, title: title, captcha: captcha, iframes: iframes, refs: refs };
})()`

export const formatAriaSnapshot = (refs: PageRef[]) => refs.map((ref) => {
  const name = ref.name ? ` ${JSON.stringify(ref.name)}` : ''
  const value = ref.value ? ` value=${JSON.stringify(ref.value)}` : ''
  const check = ref.checked == null ? '' : ref.checked ? ' [checked]' : ' [unchecked]'
  return `- ${ref.role || 'generic'}${name} [ref=${ref.id}]${value}${check}`
}).join('\n')

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
  const iframes = (Array.isArray(raw.iframes) ? raw.iframes : []).map((item) => {
    const row = asObject(item)
    return { id: String(row.id || ''), src: String(row.src || '') }
  }).filter((item) => item.src)
  return {
    url: String(raw.url || ''),
    title: String(raw.title || ''),
    captcha: Boolean(raw.captcha),
    iframes,
    refs,
    snapshot: formatAriaSnapshot(refs),
  }
}
