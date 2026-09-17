/** 学习通壳入口。站点选择器只留在 TS，Rust FIND_* 不再硬编码。 */
export const SITE_CLICK_SELECTORS: Record<string, string[]> = {
  作业: ['[title="作业"]', '[aria-label="作业"]', '[onclick*="pageHeader=8"]', 'a[href*="pageHeader=8"]', '[data-url*="work"]', '[data-id="8"]'],
  章节: ['[title="章节"]', '[aria-label="章节"]', '[data-url*="studentcourse"]', '[onclick*="pageHeader=1"]'],
  我学的课: ['.tab-item[coursetype="1"]', '[coursetype="1"]', '.tab-item'],
  已学的课: ['.tab-item[coursetype="1"]', '[coursetype="1"]', '.tab-item'],
  我教的课: ['.tab-item[coursetype="0"]', '[coursetype="0"]', '.tab-item'],
}

export const siteSelectorsForText = (text: string): string[] => {
  const key = String(text || '').replace(/\s+/g, '')
  return SITE_CLICK_SELECTORS[key] || []
}

/** 按文案找可点节点：先已知入口，再按文本节点精确匹配。禁止全页 innerText / getComputedStyle。 */
export const CLICK_FIND_HELPERS = String.raw`
function __zeCompact(s){ return String(s || '').replace(/\s+/g, ''); }
function __zeBare(s){
  return __zeCompact(s).replace(/[;；].*$/, '').replace(/(待做|未做|未完成|未交|未提交|待交|待批阅|已完成|已批阅|已交)$/, '');
}
function __zeOwnText(el){
  if (!el) return '';
  var t = '';
  try { t = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('alt') || ''; } catch (e) {}
  t = __zeCompact(t);
  if (t) return t;
  var bits = [];
  try {
    for (var n = el.firstChild; n; n = n.nextSibling) {
      if (n.nodeType === 3) {
        var tx = __zeCompact(n.nodeValue);
        if (tx) bits.push(tx);
      }
    }
  } catch (e2) {}
  var own = bits.join('');
  if (own) return own;
  if (el.childElementCount === 1) {
    try {
      var kid = el.firstElementChild;
      var kt = __zeCompact((kid.getAttribute && (kid.getAttribute('aria-label') || kid.getAttribute('title'))) || '');
      if (kt && kt.length <= 24) return kt;
    } catch (e3) {}
  }
  return '';
}
function __zeClickable(el){
  var cur = el;
  for (var i = 0; i < 5 && cur; i++) {
    var tag = String(cur.tagName || '').toLowerCase();
    try {
      if (cur.getAttribute('coursetype') || /\btab-item\b/.test(String(cur.className || ''))) return cur;
    } catch (eTab) {}
    if (tag === 'a' || tag === 'button' || tag === 'label') return cur;
    try {
      var role = String(cur.getAttribute('role') || '');
      if (role === 'tab' || role === 'button' || role === 'link' || role === 'menuitem') return cur;
      if (cur.getAttribute('onclick') || cur.getAttribute('data-url') || cur.getAttribute('href')) return cur;
    } catch (e) {}
    if (tag === 'li' || tag === 'td') {
      var inner = null;
      try { inner = cur.querySelector('a, button, [onclick], [data-url], [href]'); } catch (e2) {}
      if (inner) return inner;
    }
    var parent = cur.parentElement;
    if (!parent || (parent.childElementCount || 0) > 8) return cur;
    cur = parent;
  }
  return el;
}
function __zeStudentTab(s){
  var c = __zeCompact(s);
  return c === '我学的课' || c === '已学的课';
}
function __zeLabelOk(want, label){
  var a = __zeCompact(want);
  var b = __zeCompact(label);
  if (!a || !b) return false;
  if (b.indexOf('删除') >= 0 && a.indexOf('删除') < 0) return false;
  if (__zeStudentTab(a) && __zeStudentTab(b)) return true;
  return b === a || b.indexOf(a) === 0;
}
function __zeSpaceListHref(el){
  var h = '';
  try { h = String(el.getAttribute('href') || el.href || el.getAttribute('data-url') || el.getAttribute('onclick') || ''); } catch (eH) {}
  return /visit\/(?:courses|interaction)|courselist/i.test(h) && !/stucoursemiddle|mycourse\/stu|courseid=/i.test(h);
}
function __zeKnownClick(target){
  var map = {
    '作业': ['[title="作业"]', '[aria-label="作业"]', '[onclick*="pageHeader=8"]', 'a[href*="pageHeader=8"]', '[data-url*="work"]', '[data-id="8"]'],
    '章节': ['[title="章节"]', '[aria-label="章节"]', '[data-url*="studentcourse"]', '[onclick*="pageHeader=1"]'],
    '我学的课': ['.tab-item[coursetype="1"]', '[coursetype="1"]', '.tab-item'],
    '已学的课': ['.tab-item[coursetype="1"]', '[coursetype="1"]', '.tab-item'],
    '我教的课': ['.tab-item[coursetype="0"]', '[coursetype="0"]', '.tab-item'],
  };
  var sels = map[target];
  if (!sels) return null;
  var frames = __sameFrames(window, 0);
  for (var i = 0; i < sels.length; i++) {
    for (var f = 0; f < frames.length; f++) {
      var nodes = [];
      try { nodes = frames[f].document.querySelectorAll(sels[i]); } catch (e) { continue; }
      for (var j = 0; j < nodes.length; j++) {
        var el = nodes[j];
        if (__zeSpaceListHref(el)) continue;
        if ((target === '我学的课' || target === '已学的课' || target === '我教的课') && String(el.tagName || '').toLowerCase() === 'a') continue;
        var label = __zeOwnText(el) || __zeCompact(el.innerText || el.textContent || '');
        if (__zeLabelOk(target, label) || __zeLabelOk(target, el.getAttribute && (el.getAttribute('title') || el.getAttribute('aria-label')))) {
          return el;
        }
      }
    }
  }
  return null;
}
function __zeFindByText(doc, target){
  if (!doc || !doc.body || !target) return null;
  var walker = null;
  try { walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null); } catch (e) { return null; }
  var exact = null;
  var fuzzy = null;
  var exactScore = 1e9;
  var fuzzyScore = 1e9;
  var n = null;
  var seen = 0;
  while ((n = walker.nextNode())) {
    if (++seen > 4000) break;
    var tx = __zeCompact(n.nodeValue);
    if (!tx || tx.length > 64) continue;
    if (tx.indexOf('删除') >= 0 && target.indexOf('删除') < 0) continue;
    var hit = tx === target || __zeBare(tx) === target;
    var near = !hit && tx.length <= target.length + 8 && tx.indexOf(target) >= 0;
    if (!hit && !near) continue;
    var el = n.parentElement;
    if (!el) continue;
    var kids = 0;
    try { kids = el.childElementCount || 0; } catch (e2) { kids = 0; }
    if (kids > 12) continue;
    var score = tx.length + kids;
    if (hit && score < exactScore) { exact = el; exactScore = score; }
    else if (near && score < fuzzyScore) { fuzzy = el; fuzzyScore = score; }
    if (hit && kids <= 1 && tx === target) break;
  }
    var node = exact || fuzzy;
  if (!node) return null;
  var hit = __zeClickable(node);
  if (hit && __zeSpaceListHref(hit)) return null;
  return hit;
}
function __zeFindClick(target){
  if (!target) return null;
  if (target === '已学的课') target = '我学的课';
  var known = __zeKnownClick(target);
  if (known) return known;
  var frames = __sameFrames(window, 0);
  for (var f = 0; f < frames.length; f++) {
    var doc = null;
    try { doc = frames[f].document; } catch (e) { continue; }
    var hit = __zeFindByText(doc, target);
    if (hit) return hit;
  }
  return null;
}
`

export const clickLabelMatches = (want: string, label: string) => {
  const a = String(want || '').replace(/\s+/g, '')
  const b = String(label || '').replace(/\s+/g, '')
  if (!a || !b) return false
  if (b.includes('删除') && !a.includes('删除')) return false
  if ((a === '我学的课' || a === '已学的课') && (b === '我学的课' || b === '已学的课')) return true
  return b === a || b.startsWith(a)
}