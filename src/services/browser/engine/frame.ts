/** 同源框身份。id / mid / name 要全等；网址只按子串。路径走 __zeFramePath，不和 mid 混。 */

export const FRAME_SCOPE = `function __zeFrameInfo(win){
  var href = '', id = '', mid = '', name = '', src = '';
  try { href = String((win.location && win.location.href) || ''); } catch (e0) {}
  try {
    var el = win.frameElement;
    if (el) {
      id = String(el.id || '');
      name = String(el.name || '');
      mid = String(el.getAttribute('mid') || el.getAttribute('data-mid') || el.getAttribute('data-id') || '');
      src = String(el.getAttribute('src') || el.src || '');
    }
  } catch (e1) {}
  return { href: href, id: id, mid: mid, name: name, src: src };
}
function __zeFramePath(win){
  var parts = [];
  var cur = win;
  for (var g = 0; cur && g < 8; g++) {
    var parent = null;
    try { parent = cur.parent; } catch (e0) { break; }
    if (!parent || parent === cur) break;
    var fe = null;
    try { fe = cur.frameElement; } catch (e1) { break; }
    if (!fe || !fe.ownerDocument) break;
    var idx = -1;
    try {
      var list = fe.ownerDocument.querySelectorAll('iframe, frame');
      for (var i = 0; i < list.length; i++) {
        if (list[i] === fe) { idx = i; break; }
      }
    } catch (e2) { break; }
    if (idx < 0) break;
    parts.unshift(String(idx));
    cur = parent;
  }
  return parts.join('/');
}
function __zeFrameOk(win, want){
  var w = String(want || '').replace(/\\s+/g, '').toLowerCase();
  if (!w) return true;
  var info = __zeFrameInfo(win);
  var exact = [info.id, info.mid, info.name];
  for (var i = 0; i < exact.length; i++) {
    var v = String(exact[i] || '').replace(/\\s+/g, '').toLowerCase();
    if (v && v === w) return true;
  }
  var href = String(info.href || '').toLowerCase();
  var src = String(info.src || '').toLowerCase();
  if (href && href.indexOf(w) >= 0) return true;
  if (src && src.indexOf(w) >= 0) return true;
  return false;
}
function __zePickFrames(frames, path, hint){
  var p = String(path || '');
  var h = String(hint || '');
  if (!p && !h) return frames;
  var pathHits = [];
  var hintHits = [];
  for (var i = 0; i < frames.length; i++) {
    if (p && __zeFramePath(frames[i]) === p) pathHits.push(frames[i]);
    else if (h && __zeFrameOk(frames[i], h)) hintHits.push(frames[i]);
  }
  if (pathHits.length) return pathHits;
  return hintHits;
}
function __zeFrameHint(win){
  try {
    if (!win || win === window) return '';
  } catch (e) { return ''; }
  var info = __zeFrameInfo(win);
  return info.mid || info.id || info.name || '';
}
`
