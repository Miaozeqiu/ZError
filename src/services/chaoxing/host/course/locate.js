// 课程壳 · locate：点侧栏页签。不要点任务列表里的「章节测验」。
function locate(handle){
  handle = handle || {};
  if (handle.kind !== 'control') return { found: false };
  var el = __cxFindCourseTab(document, handle.name);
  var pos = __cxCourseBox(el);
  if (!pos) return { found: false, error: '侧栏没有「' + (handle.name || '') + '」' };
  return { found: true, ok: true, x: pos.x, y: pos.y, text: pos.text || handle.name, via: 'course-tab' };
}

function invoke(handle){
  var hit = locate(handle);
  if (!hit.found) return { ok: false, error: hit.error || '没找到页签' };
  return { ok: true, via: hit.via, text: hit.text };
}
