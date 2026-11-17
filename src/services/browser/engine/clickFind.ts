/** 通用精确文案。站点选择器不进引擎。 */

export const siteSelectorsForText = (_text: string): string[] => []

/** 按文案找可点节点：只按文本节点精确匹配。禁止全页 innerText / getComputedStyle。 */
export const CLICK_FIND_HELPERS = String.raw`
function __zeCompact(s){ return String(s || '').replace(/\s+/g, ''); }
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
  return bits.join('');
}
function __zeClickable(el){
  var cur = el;
  for (var i = 0; i < 5 && cur; i++) {
    var tag = String(cur.tagName || '').toLowerCase();
    if (tag === 'a' || tag === 'button' || tag === 'label') return cur;
    try {
      var role = String(cur.getAttribute('role') || '');
      if (role === 'tab' || role === 'button' || role === 'link' || role === 'menuitem' || role === 'treeitem' || role === 'listitem') return cur;
      if (cur.getAttribute('onclick') || cur.getAttribute('data-url') || cur.getAttribute('href')) return cur;
    } catch (e) {}
    var parent = cur.parentElement;
    if (!parent || (parent.childElementCount || 0) > 8) return cur;
    cur = parent;
  }
  return el;
}
function __zeLabelOk(want, label){
  var a = __zeCompact(want);
  var b = __zeCompact(label);
  if (!a || !b) return false;
  return b === a || b.indexOf(a) === 0;
}
function __zeFindByText(doc, target){
  if (!doc || !doc.body || !target) return null;
  var walker = null;
  try { walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT, null); } catch (e) { return null; }
  var exact = null;
  var exactScore = 1e9;
  var n = null;
  var seen = 0;
  while ((n = walker.nextNode())) {
    if (++seen > 4000) break;
    var tx = __zeCompact(n.nodeValue);
    if (!tx || tx.length > 64) continue;
    if (tx !== target) continue;
    var el = n.parentElement;
    if (!el) continue;
    var kids = 0;
    try { kids = el.childElementCount || 0; } catch (e2) { kids = 0; }
    if (kids > 12) continue;
    var score = tx.length + kids;
    if (score < exactScore) { exact = el; exactScore = score; }
    if (kids <= 1 && tx === target) break;
  }
  if (!exact) return null;
  return __zeClickable(exact);
}
function __zeFindClick(target){
  if (!target) return null;
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
  return b === a || b.startsWith(a)
}
