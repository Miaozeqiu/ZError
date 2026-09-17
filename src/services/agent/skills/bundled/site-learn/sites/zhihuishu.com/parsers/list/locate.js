function locate(handle){
  handle = handle || {};
  if (handle.kind !== 'work') return { found: false, error: '只支持 work' };
  var hit = findCourse(document, handle.title);
  if (!hit) return { found: false, error: '列表里没有「' + (handle.title || '') + '」' };
  var pos = boxOf(hit.el);
  if (!pos) return { found: false, error: '课名不在可视区' };
  return { found: true, ok: true, x: pos.x, y: pos.y, text: hit.title, space: pos.space };
}
