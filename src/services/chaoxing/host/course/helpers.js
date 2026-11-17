// 课程壳 · helpers：侧栏页签和中间 iframe。parse / locate 共用。
function __cxCourseTabOf(href){
  var h = String(href || '');
  if (/studentcourse/i.test(h)) return '章节';
  if (/stuActiveList|\/active\/stu/i.test(h)) return '任务';
  if (/\/work\/(?:list|index|view)/i.test(h)) return '作业';
  if (/[?&]pageHeader=8(?:&|$)/i.test(h)) return '作业';
  if (/[?&]pageHeader=1(?:&|$)/i.test(h)) return '章节';
  return '';
}

function __cxCourseOn(el){
  if (!el) return false;
  var cls = '';
  try { cls = String(el.className || el.getAttribute('class') || ''); } catch (e) {}
  var aria = '';
  try { aria = String(el.getAttribute && el.getAttribute('aria-selected') || ''); } catch (e2) {}
  if (aria === 'true') return true;
  return /\b(current|active|selected|select|cur|on|navShow)\b/i.test(cls);
}

function __cxCourseChromeOn(el){
  var n = el;
  for (var i = 0; i < 4 && n; i++) {
    if (__cxCourseOn(n)) return true;
    n = n.parentElement;
  }
  return false;
}

function __cxCourseName(el){
  if (!el || !el.getAttribute) return '';
  var title = '';
  try { title = String(el.getAttribute('title') || el.getAttribute('aria-label') || '').replace(/\s+/g, ''); } catch (eT) {}
  if (title === '章节' || title === '任务' || title === '作业') return title;
  var hook = '';
  try { hook = String(el.getAttribute('data-url') || el.getAttribute('onclick') || el.getAttribute('href') || ''); } catch (eH) {}
  return __cxCourseTabOf(hook);
}

function __cxCourseLiveHref(win){
  try {
    var href = String((win && win.location && win.location.href) || '');
    if (href && href !== 'about:blank') return href;
  } catch (e) {}
  return '';
}

function __cxCourseWalkFrame(frame, depth){
  if (!frame || depth > 3) return '';
  var live = '';
  try { live = __cxCourseLiveHref(frame.contentWindow); } catch (eL) {}
  var tab = __cxCourseTabOf(live);
  if (tab) return tab;
  try {
    var doc = frame.contentDocument;
    if (doc) {
      var inner = doc.querySelector('#frame_content, iframe[name="frame_content"]') || doc.querySelector('iframe');
      if (inner) {
        var nested = __cxCourseWalkFrame(inner, depth + 1);
        if (nested) return nested;
      }
      tab = __cxCourseTabOf(__cxCourseLiveHref(doc.defaultView));
      if (tab) return tab;
    }
  } catch (eDoc) {}
  return '';
}

function __cxCourseRoot(doc){
  var root = doc || document;
  try { if (root.defaultView && root.defaultView.top && root.defaultView.top.document) root = root.defaultView.top.document; } catch (e) {}
  return root;
}

function __cxReadCourseTab(doc, href){
  var root = __cxCourseRoot(doc);
  var top = '';
  try { top = __cxCourseLiveHref(root.defaultView) || String(href || ''); } catch (eU) { top = String(href || ''); }

  var sideTab = '';
  var nodes = [];
  try { nodes = root.querySelectorAll('a, button, li, span, div, [data-url], [title], [onclick*="pageHeader"]'); } catch (eN) {}
  var max = nodes.length < 250 ? nodes.length : 250;
  for (var n = 0; n < max; n++) {
    var el = nodes[n];
    var name = __cxCourseName(el);
    if (name !== '任务' && name !== '章节' && name !== '作业') continue;
    var box = null;
    try { box = el.getBoundingClientRect(); } catch (eB) {}
    if (box && box.width > 0 && box.left > 240) continue;
    if (!__cxCourseChromeOn(el)) continue;
    sideTab = name;
    break;
  }

  var iframeTab = '';
  var main = null;
  try { main = root.querySelector('#frame_content, iframe[name="frame_content"]'); } catch (eM) {}
  if (!main) {
    try { main = root.querySelector('.main iframe, .right iframe, iframe'); } catch (eI) {}
  }
  iframeTab = __cxCourseWalkFrame(main, 0);

  if (sideTab === '章节' || sideTab === '作业') return { tab: sideTab, via: 'sidebar', href: top };
  if (iframeTab) return { tab: iframeTab, via: 'iframe', href: top };
  if (sideTab) return { tab: sideTab, via: 'sidebar', href: top };
  var topTab = __cxCourseTabOf(top);
  if (topTab) return { tab: topTab, via: 'top', href: top };
  return { tab: '', via: 'none', href: top };
}

function __cxCourseBox(el){
  if (!el) return null;
  var r = null;
  try { r = el.getBoundingClientRect(); } catch (e1) {}
  if (!r || r.width < 2 || r.height < 2) return null;
  return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2, text: __cxCourseName(el) };
}

function __cxFindCourseTab(root, want){
  var name = want === 'chapter-tab' || want === '章节' ? '章节'
    : want === 'homework-tab' || want === '作业' ? '作业'
    : want === 'task-tab' || want === '任务' ? '任务'
    : '';
  if (!name) return null;
  var doc = __cxCourseRoot(root);
  var sels = name === '章节'
    ? ['[title="章节"]', '[aria-label="章节"]', '[data-url*="studentcourse"]', '[onclick*="pageHeader=1"]']
    : name === '作业'
      ? ['[title="作业"]', '[aria-label="作业"]', '[onclick*="pageHeader=8"]', '[data-url*="work"]']
      : ['[title="任务"]', '[aria-label="任务"]', '[onclick*="pageHeader=0"]', '[data-url*="stuActiveList"]'];
  for (var s = 0; s < sels.length; s++) {
    var hit = null;
    try { hit = doc.querySelector(sels[s]); } catch (eQ) {}
    if (hit && __cxCourseName(hit) === name) return hit;
  }
  var nodes = [];
  try { nodes = doc.querySelectorAll('a, button, li, span, [data-url], [title]'); } catch (eN) {}
  for (var i = 0; i < nodes.length && i < 250; i++) {
    if (__cxCourseName(nodes[i]) === name) return nodes[i];
  }
  return null;
}
