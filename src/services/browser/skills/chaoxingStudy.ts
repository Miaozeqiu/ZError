const cleanJs = `function __cxClean(s){
  return String(s || '').split('\\n').join(' ').split('\\t').join(' ').split('\\r').join(' ').split('  ').join(' ').trim();
}
function __cxHas(text, piece){
  return String(text || '').indexOf(piece) >= 0;
}
function __cxFrames(win, depth){
  var out = [win];
  if ((depth || 0) > 4) return out;
  try {
    var list = win.document.querySelectorAll('iframe');
    for (var i = 0; i < list.length; i++) {
      try {
        var child = list[i].contentWindow;
        if (child && child.document) out = out.concat(__cxFrames(child, (depth || 0) + 1));
      } catch (e) {}
    }
  } catch (e) {}
  return out;
}
function __cxIframeTree(win, depth){
  var out = [];
  if ((depth || 0) > 4) return out;
  try {
    var list = win.document.querySelectorAll('iframe');
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      var item = {
        depth: depth || 0,
        id: el.id || '',
        cls: String(el.className || '').slice(0, 80),
        src: String(el.src || '').slice(0, 220),
        sameOrigin: false,
        video: false,
        playBtn: false,
      };
      try {
        var child = el.contentWindow;
        if (child && child.document) {
          item.sameOrigin = true;
          item.video = !!child.document.querySelector('video');
          item.playBtn = !!child.document.querySelector('.vjs-big-play-button, .vjs-play-control');
          out.push(item);
          out = out.concat(__cxIframeTree(child, (depth || 0) + 1));
        } else {
          out.push(item);
        }
      } catch (e) {
        item.error = 'cross-origin';
        out.push(item);
      }
    }
  } catch (e) {}
  return out;
}
function __cxClick(el){
  if (!el) return;
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
  var view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: view }));
  if (typeof el.click === 'function') el.click();
}
function __cxFindVideo(){
  var frames = __cxFrames(window, 0);
  var best = null;
  var bestScore = -1;
  for (var i = 0; i < frames.length; i++) {
    try {
      var doc = frames[i].document;
      var href = '';
      try { href = (frames[i].location && frames[i].location.href) || ''; } catch (e) {}
      var nodes = doc.querySelectorAll('#video_html5_api, video[id*="video_html5"], video');
      for (var n = 0; n < nodes.length; n++) {
        var video = nodes[n];
        var width = 0;
        var height = 0;
        try { width = video.offsetWidth || 0; height = video.offsetHeight || 0; } catch (e) {}
        var score = 0;
        if (width >= 80 && height >= 40) score += 8;
        else if (width > 0 && height > 0) score += 2;
        if (__cxHas(href, 'ananas') || __cxHas(href, 'modules/video')) score += 5;
        if (video.id && __cxHas(video.id, 'video_html5')) score += 2;
        var duration = Number(video.duration);
        if (isFinite(duration) && duration > 1) score += 1;
        if (score > bestScore) {
          bestScore = score;
          best = video;
        }
      }
    } catch (e) {}
  }
  return best;
}
function __cxVideoSnap(video){
  if (!video) return null;
  var duration = Number(video.duration);
  return {
    current: Number(video.currentTime) || 0,
    duration: isFinite(duration) && duration > 0 ? duration : 0,
    paused: !!video.paused,
    ended: !!video.ended,
    ready: Number(video.readyState) || 0,
    src: String(video.currentSrc || video.src || ''),
    ts: Date.now(),
  };
}
function __cxJobCount(box){
  if (!box) return 0;
  var text = box.textContent || '';
  if (__cxHas(text, '未完成') || __cxHas(text, '待完成') || __cxHas(text, '未学')) return 1;
  var tips = box.querySelector && box.querySelector('.prevHoverTips, .catalog_tishi, .prev_tips');
  if (tips) {
    var tip = __cxClean(tips.textContent || tips.getAttribute('title') || '');
    if (__cxHas(tip, '未完成') || __cxHas(tip, '待完成')) return 1;
  }
  var mark = box.querySelector && box.querySelector('.orangeNew, .jobUnfinishCount, .jobUnfinish, span.orange, em.orange, .catalog_points, .roundpointStudent, [class*="unfinish"], [class*="Unfinish"], [class*="orange"]');
  if (mark) {
    var marked = parseInt(__cxClean(mark.textContent), 10);
    return isFinite(marked) && marked > 0 ? marked : 1;
  }
  var nodes = box.querySelectorAll('span, em, i, b, strong, font');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var raw = __cxClean(el.textContent);
    if (!/^\\d{1,2}$/.test(raw)) continue;
    if (el.closest && el.closest('.posCatalog_name, a.clicktitle, .clicktitle, .catalog_name, .chapter_index, .posCatalog_level')) continue;
    var n = parseInt(raw, 10);
    if (n > 0) return n;
  }
  for (var child = box.firstChild; child; child = child.nextSibling) {
    if (child.nodeType !== 3) continue;
    var lone = __cxClean(child.textContent);
    if (/^\\d{1,2}$/.test(lone) && parseInt(lone, 10) > 0) return parseInt(lone, 10);
  }
  return 0;
}
function __cxUnfinishedBox(box){
  return __cxJobCount(box) > 0;
}
function __cxCatalogText(root){
  try {
    var el = root || document.body;
    if (!el) return '';
    // document 本身没有 innerText，必须落到 body
    if (el === document || el.nodeType === 9) el = el.body || el.documentElement || el;
    return String(el.innerText || el.textContent || '');
  } catch (e) { return ''; }
}
function __cxCatalogProgress(text){
  var hit = String(text || '').match(/已完成任务点\\s*[:：]?\\s*(\\d+)\\s*\\/\\s*(\\d+)/);
  return hit ? { done: parseInt(hit[1], 10), total: parseInt(hit[2], 10) } : null;
}
function __cxCatalogProgressFromDoc(doc){
  if (!doc || !doc.querySelector) return null;
  var sels = ['.jobCompleteness', '.chapter_head', '.left', '#main', '.content'];
  for (var i = 0; i < sels.length; i++) {
    var el = doc.querySelector(sels[i]);
    if (!el) continue;
    var found = __cxCatalogProgress(__cxCatalogText(el));
    if (found) return found;
  }
  var text = __cxCatalogText(doc);
  if (text.length > 5000) text = text.slice(0, 5000);
  return __cxCatalogProgress(text);
}
function __cxSkipParseFrame(href, doc){
  if (!doc) return true;
  if (doc.querySelector('#coursetree, .posCatalog_select, .catalog_title, .posCatalog_name, a.clicktitle')) return false;
  if (/studentcourse|studentstudy|stucoursemiddle|\\/mycourse\\/stu/.test(href || '')) return false;
  return /ananas|insertvideo|modules\\/video|knowledge\\/cards|about:blank/.test(href || '');
}
function __cxJobsFromText(text){
  var jobs = {};
  var raw = String(text || '').replace(/\\r/g, '\\n');
  var lines = raw.split('\\n').map(__cxClean).filter(Boolean);
  for (var i = 0; i < lines.length; i++) {
    var line = lines[i];
    var next = lines[i + 1] || '';
    if (/^\\d{1,2}$/.test(line) && /^第/.test(next)) continue;
    if (/已完成任务点|^目录$|^第/.test(line)) continue;
    if (/^\\d{1,2}$/.test(next)) {
      var after = lines[i + 2] || '';
      if (/^第/.test(after)) continue;
      jobs[line] = parseInt(next, 10);
      continue;
    }
    var tail = line.match(/^(.*\\S)\\s+(\\d{1,2})$/);
    if (tail) {
      var title = __cxClean(tail[1]);
      if (title && !/^第/.test(title) && title !== '目录') jobs[title] = parseInt(tail[2], 10);
    }
  }
  return jobs;
}
function __cxJobsForTitle(title, jobs){
  title = __cxClean(title);
  if (!title || !jobs) return 0;
  if (jobs[title] != null) return jobs[title];
  var wantIndex = __cxCatalogIndex(title);
  var bareTitle = __cxBareTitle(title);
  for (var key in jobs) {
    if (!jobs.hasOwnProperty(key)) continue;
    var keyIndex = __cxCatalogIndex(key);
    if (wantIndex && keyIndex && wantIndex !== keyIndex) continue;
    var bareKey = __cxBareTitle(key);
    if (key === title || bareKey === title || bareKey === bareTitle) return jobs[key];
    if (!wantIndex && !keyIndex && bareTitle && (__cxHas(key, bareTitle) || __cxHas(bareTitle, bareKey))) return jobs[key];
  }
  return 0;
}
function __cxChapterLabel(raw){
  var text = __cxClean(raw);
  if (!text || text.length < 2) return '';
  if (__cxHas(text, 'ZRRESULT:')) return '';
  var skip = ['视频','文档','章节','测验','考试','作业','讨论','问卷','正在播放','导航','学习通','超星学习通','超星'];
  for (var i = 0; i < skip.length; i++) if (text === skip[i]) return '';
  return text.slice(0, 80);
}
function __cxChapterTitle(){
  var pick = function(el){
    if (!el) return '';
    return __cxChapterLabel(el.getAttribute('title') || el.textContent || '');
  };
  var active = document.querySelector('#coursetree .posCatalog_select.posCatalog_active .posCatalog_name, #coursetree .posCatalog_active .posCatalog_name, #coursetree dd.currents a, #coursetree .ncells .currents, #coursetree .currents .posCatalog_name');
  var title = pick(active);
  if (title) return title;
  var named = document.querySelector('.chapterName, .chapter_name, #chapterName, .tab_chapter, .prevHoverTips, .main .articletitle');
  title = pick(named);
  if (title) return title;
  var chapterId = '';
  try {
    var cu = new URL(location.href);
    chapterId = cu.searchParams.get('chapterId') || cu.searchParams.get('chapterid') || cu.searchParams.get('knowledgeid') || '';
  } catch (e) {}
  if (chapterId) {
    var nodes = document.querySelectorAll('#coursetree .posCatalog_select, #coursetree a, #coursetree li');
    for (var i = 0; i < nodes.length; i++) {
      var html = nodes[i].outerHTML || '';
      if (html.indexOf(chapterId) < 0) continue;
      var name = nodes[i].querySelector ? nodes[i].querySelector('.posCatalog_name, a') : null;
      title = pick(name) || pick(nodes[i]);
      if (title) return title;
    }
  }
  title = __cxChapterLabel(document.title.replace(/\\s*[-_|].*(学习通|超星).*$/, ''));
  return title;
}
function __cxSkipTitle(title){
  title = __cxClean(title);
  if (!title || title.length < 2) return true;
  if (__cxHas(title, '编辑章节') || __cxHas(title, '批量') || __cxHas(title, '打印')) return true;
  if (/^第.+部分/.test(title) || /^\\d+$/.test(title) || title === '目录') return true;
  return false;
}
function __cxCatalogIndex(title){
  var hit = String(title || '').trim().match(/^(\\d+(?:\\.\\d+)+)\\b/);
  return hit ? hit[1] : '';
}
function __cxBareTitle(title){
  var raw = __cxClean(String(title || '').replace(/[（(]\\s*\\d+\\s*[）)]\\s*$/g, ''));
  var index = __cxCatalogIndex(raw);
  var bare = __cxClean(raw.replace(/^\\d+(?:\\.\\d+)+\\s*/, ''));
  return bare || index;
}
function __cxTitleMatch(a, b){
  var ia = __cxCatalogIndex(a);
  var ib = __cxCatalogIndex(b);
  if (ia && ib && ia !== ib) return false;
  a = __cxBareTitle(a);
  b = __cxBareTitle(b);
  if (!a || !b) return ia && ib && ia === ib;
  if (ia && ib) return a === b;
  return a === b || __cxHas(a, b) || __cxHas(b, a);
}
function __cxHasUnfinishedChild(items, item){
  var idx = (item && (item.index || __cxCatalogIndex(item.title))) || '';
  var depth = item && item.depth;
  if (idx) {
    var prefix = idx + '.';
    for (var i = 0; i < items.length; i++) {
      if (items[i] === item || !items[i].unfinished) continue;
      var other = items[i].index || __cxCatalogIndex(items[i].title);
      if (other && other.indexOf(prefix) === 0) return true;
    }
  }
  if (typeof depth === 'number') {
    var start = -1;
    for (var s = 0; s < items.length; s++) if (items[s] === item) { start = s; break; }
    if (start >= 0) {
      for (var n = start + 1; n < items.length; n++) {
        if ((items[n].depth || 0) <= depth) break;
        if (items[n].unfinished) return true;
      }
    }
  }
  return false;
}
function __cxClearParentUnfinished(items){
  for (var i = 0; i < items.length; i++) {
    if (__cxHasUnfinishedChild(items, items[i])) items[i].unfinished = false;
  }
  return items;
}
function __cxSkipDocTitle(title){
  return __cxHas(title, '资料') || __cxHas(title, '测验') || __cxHas(title, '考试')
    || __cxHas(title, '作业') || __cxHas(title, '讨论') || __cxHas(title, '问卷');
}
function __cxOwnJobs(box){
  if (!box) return 0;
  var nested = box.querySelectorAll ? box.querySelectorAll('.posCatalog_select') : [];
  var hasChildSelect = false;
  for (var c = 0; c < nested.length; c++) {
    if (nested[c] !== box) { hasChildSelect = true; break; }
  }
  var kids = box.children || [];
  for (var i = 0; i < kids.length; i++) {
    var el = kids[i];
    if (!el || !el.className) continue;
    if (__cxHas(el.className, 'jobUnfinishCount')) {
      if (hasChildSelect) continue;
      var fromVal = parseInt(el.value || el.getAttribute('value') || el.textContent || '', 10);
      if (isFinite(fromVal) && fromVal >= 0) return fromVal;
    }
  }
  var oranges = box.querySelectorAll('.orangeNew');
  for (var o = 0; o < oranges.length; o++) {
    var wrap = oranges[o].closest ? oranges[o].closest('.posCatalog_select') : null;
    if (wrap && wrap !== box) continue;
    var n = parseInt(__cxClean(oranges[o].textContent || ''), 10);
    if (isFinite(n) && n >= 0) return n;
  }
  return 0;
}
function __cxOwnNameEl(box, isChapter){
  if (!box) return null;
  var want = isChapter ? 'posCatalog_title' : 'posCatalog_name';
  var kids = box.children || [];
  for (var i = 0; i < kids.length; i++) {
    if (kids[i] && __cxHas(kids[i].className, want)) return kids[i];
  }
  var all = box.querySelectorAll ? box.querySelectorAll('.' + want) : [];
  for (var j = 0; j < all.length; j++) {
    var wrap = all[j].closest ? all[j].closest('.posCatalog_select') : box;
    if (wrap === box) return all[j];
  }
  return null;
}
function __cxTreeDepth(box, tree){
  var depth = 0;
  var p = box && box.parentElement;
  while (p && p !== tree) {
    if (String(p.tagName || '').toLowerCase() === 'ul') depth += 1;
    p = p.parentElement;
  }
  return Math.max(0, depth - 1);
}
function __cxNodeId(box){
  if (!box) return '';
  var id = String(box.id || '');
  if (id.indexOf('cur') === 0) return id.slice(3);
  if (/^\\d{5,}$/.test(id)) return id;
  try {
    var click = String(box.getAttribute('onclick') || '') + (box.innerHTML || '');
    var hit = click.match(/getTeacherAjax\\s*\\(\\s*['\"]\\d+['\"]\\s*,\\s*['\"]\\d+['\"]\\s*,\\s*['\"](\\d+)['\"]/i);
    if (hit) return hit[1];
  } catch (e) {}
  return '';
}
function __cxStudyJobsLeft(doc){
  try {
    var el = doc.querySelector('#_studystate');
    var raw = el ? String(el.value || el.getAttribute('value') || '') : '';
    var hit = raw.match(/unfinishCount\\s*:\\s*(\\d+)/);
    return hit ? parseInt(hit[1], 10) : 0;
  } catch (e) { return 0; }
}
function __cxParsePlayerTree(root){
  var doc = root || document;
  var tree = doc.querySelector('#coursetree') || doc;
  var items = [];
  var nodes = tree.querySelectorAll('.posCatalog_select');
  var lastByDepth = {};
  for (var i = 0; i < nodes.length && items.length < 240; i++) {
    var box = nodes[i];
    var isChapter = __cxHas(box.className, 'firstLayer');
    var name = __cxOwnNameEl(box, isChapter);
    if (!name) continue;
    var raw = name.getAttribute('title') || name.textContent || '';
    var bar = name.querySelector('.posCatalog_sbar');
    var index = bar ? __cxClean(bar.textContent || '') : __cxCatalogIndex(raw);
    var nameOnly = __cxChapterLabel(raw);
    if (index && nameOnly) nameOnly = nameOnly.replace(new RegExp('^' + index.replace(/\\./g, '\\\\.') + '\\\\s*'), '');
    if (!nameOnly) nameOnly = index;
    if (__cxSkipTitle(nameOnly) && !index) continue;
    var title = index && nameOnly && nameOnly !== index ? (index + ' ' + nameOnly) : (nameOnly || index);
    if (!title) continue;
    var depth = isChapter ? 0 : __cxTreeDepth(box, tree);
    if (!isChapter && index) depth = Math.max(depth, String(index).split('.').length - 1);
    var parent = '';
    for (var d = depth - 1; d >= 0; d--) {
      if (lastByDepth[d]) { parent = lastByDepth[d]; break; }
    }
    var jobs = __cxOwnJobs(box);
    items.push({
      title: title,
      index: index,
      depth: depth,
      parent: parent,
      kind: isChapter ? 'chapter' : 'section',
      jobs: jobs,
      unfinished: jobs > 0,
      active: __cxHas(box.className, 'posCatalog_active'),
      chapterId: __cxNodeId(box),
      href: '',
      source: 'player',
    });
    lastByDepth[depth] = title;
  }
  for (var c = 0; c < items.length; c++) {
    if (items[c].kind !== 'chapter') continue;
    var sum = 0;
    for (var n = c + 1; n < items.length && items[n].kind !== 'chapter'; n++) {
      var nxt = items[n + 1];
      var leaf = !nxt || nxt.kind === 'chapter' || (nxt.depth || 0) <= (items[n].depth || 0);
      if (leaf) sum += items[n].jobs || 0;
    }
    items[c].jobs = sum;
    items[c].unfinished = sum > 0;
  }
  return __cxClearParentUnfinished(items);
}
function __cxParseCourseCatalog(root){
  var doc = root || document;
  var pageText = __cxCatalogText(doc);
  var textJobs = __cxJobsFromText(pageText);
  var items = [];
  var seen = {};
  var pushItem = function(title, href, box, source){
    title = __cxChapterLabel(title);
    var index = __cxCatalogIndex(title);
    if (__cxSkipTitle(title) && !index) return;
    href = href || '';
    if (href.indexOf('javascript:') === 0) href = '';
    var jobs = __cxJobCount(box) || __cxJobCount(box && box.parentElement) || __cxJobsForTitle(title, textJobs);
    // mooc2：.catalog_task 里两个 span 常表示未完成
    if (!jobs && box && box.querySelector) {
      var task = box.querySelector('.catalog_task') || (box.parentElement && box.parentElement.querySelector && box.parentElement.querySelector('.catalog_task'));
      if (task) {
        var marks = task.querySelectorAll('span, em, i, b');
        if (marks.length >= 2) jobs = 1;
        else {
          var t = __cxClean(task.textContent || '');
          if (/^\\d{1,2}$/.test(t) && parseInt(t, 10) > 0) jobs = parseInt(t, 10);
        }
      }
    }
    var key = (index || __cxBareTitle(title)) + '|' + href;
    if (seen[key]) {
      if (jobs > 0) {
        for (var s = 0; s < items.length; s++) {
          if (!__cxTitleMatch(items[s].title, title) || items[s].jobs) continue;
          items[s].jobs = jobs;
          items[s].unfinished = true;
        }
      }
      return;
    }
    seen[key] = true;
    var chapterId = '';
    var studyHref = href.indexOf('studentstudy') >= 0 ? href : '';
    try {
      var blob = ((box && box.outerHTML) || '') + ' ' + href;
      var idHit = blob.match(/chapterId[=:\"']+(\\d+)/i) || blob.match(/knowledgeid[=:\"']+(\\d+)/i) || blob.match(/id[=\"']+(?:\\w*-)?(\\d{6,})/i);
      if (idHit) chapterId = idHit[1];
    } catch (e) {}
    items.push({
      title: title,
      index: index,
      jobs: jobs,
      unfinished: jobs > 0,
      active: false,
      chapterId: chapterId,
      href: href,
      studyHref: studyHref,
      source: source || 'catalog',
    });
  };
  var nodes = doc.querySelectorAll('a.clicktitle, .posCatalog_name, a.chapter_item, .catalog_name a, .chapter_Td a, .catalog_title a, li.chapter a, .chapterList a, .unit_li a');
  for (var i = 0; i < nodes.length && items.length < 120; i++) {
    var el = nodes[i];
    var href = '';
    try { href = el.href || ''; } catch (e) {}
    var box = el.closest ? (el.closest('li, .chapter_item, .posCatalog_select, .catalog_item, .unit_li, tr, .catalog_rep, .chapter_unit') || el.parentElement) : el.parentElement;
    pushItem(el.getAttribute('title') || el.textContent || '', href, box, 'catalog');
  }
  // mooc2 studentcourse：节名在 .catalog_title > div，任务点在旁路 .catalog_task
  var titles = doc.querySelectorAll('.catalog_title');
  for (var t = 0; t < titles.length && items.length < 120; t++) {
    var titleRoot = titles[t];
    var indexEl = titleRoot.querySelector('div:nth-child(1), .catalog_sbar, .posCatalog_sbar');
    var nameEl = titleRoot.querySelector('div:nth-child(2), .catalog_name, a, span') || titleRoot;
    var indexText = __cxClean((indexEl && (indexEl.getAttribute('title') || indexEl.textContent)) || '');
    var nameText = __cxClean((nameEl.getAttribute('title') || nameEl.textContent || titleRoot.textContent || ''));
    var fullTitle = __cxCatalogIndex(indexText)
      ? (indexText + (nameText && nameText !== indexText ? ' ' + nameText : ''))
      : (nameEl.getAttribute('title') || nameEl.textContent || titleRoot.textContent || '');
    var wrap = titleRoot.closest ? (titleRoot.closest('.catalog_rep, .chapter_unit, li, .catalog_item') || titleRoot.parentElement) : titleRoot.parentElement;
    pushItem(fullTitle, '', wrap || titleRoot, 'mooc2');
  }
  // 正文「节名\\n数字」兜底补齐未完成
  if (!items.some(function(item){ return item.unfinished; })) {
    for (var jk in textJobs) {
      if (!textJobs.hasOwnProperty(jk) || !(textJobs[jk] > 0)) continue;
      pushItem(jk, '', null, 'text');
    }
  }
  return { items: __cxClearParentUnfinished(items), progress: __cxCatalogProgress(pageText) };
}
function __cxCatalogFetchUrl(){
  var list = document.querySelectorAll('a[data-url*="studentcourse"], [data-url*="studentcourse"], iframe[src*="studentcourse"], iframe[src], [data-url]');
  for (var i = 0; i < list.length; i++) {
    var src = '';
    try { src = list[i].src || list[i].getAttribute('src') || list[i].getAttribute('data-url') || ''; } catch (e) {}
    if (!src) continue;
    if (src.indexOf('studentcourse') < 0 && src.indexOf('studentstudy') < 0) continue;
    try { src = new URL(src, location.href).href; } catch (e) {}
    return src;
  }
  try {
    var u = new URL(location.href);
    var courseid = u.searchParams.get('courseid') || u.searchParams.get('courseId') || '';
    var clazzid = u.searchParams.get('clazzid') || u.searchParams.get('clazzId') || '';
    var cpi = u.searchParams.get('cpi') || '';
    var enc = u.searchParams.get('enc') || u.searchParams.get('stuenc') || '';
    var t = u.searchParams.get('t') || '';
    if (courseid && clazzid) {
      return 'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse?courseid=' + courseid
        + '&clazzid=' + clazzid
        + (cpi ? '&cpi=' + cpi : '')
        + '&ut=s'
        + (t ? '&t=' + t : '')
        + (enc ? '&stuenc=' + enc : '');
    }
  } catch (e) {}
  return '';
}
function __cxLoadCatalogHtml(){
  var url = __cxCatalogFetchUrl();
  if (!url) return { url: '', html: '', error: 'no-url' };
  try {
    var xhr = new XMLHttpRequest();
    xhr.open('GET', url, false);
    xhr.withCredentials = true;
    xhr.send(null);
    if (xhr.status >= 200 && xhr.status < 400) return { url: url, html: xhr.responseText || '', error: '' };
    return { url: url, html: '', error: 'status ' + xhr.status };
  } catch (e) {
    return { url: url, html: '', error: String(e && e.message || e) };
  }
}
function __cxJobIconDone(el){
  if (!el) return null;
  try {
    var icon = el.querySelector ? el.querySelector('.ans-job-icon') : null;
    if (!icon && el.parentElement && el.parentElement.querySelector) {
      icon = el.parentElement.querySelector('.ans-job-icon');
    }
    if (!icon) return null;
    var pos = '';
    try { pos = window.getComputedStyle(icon).backgroundPosition || ''; } catch (e) {}
    return pos === '0px -24px' || __cxHas(icon.className, 'finish') || __cxHas(icon.className, 'clear');
  } catch (e) { return null; }
}
function __cxCollectTabSteps(doc){
  var out = [];
  var nodes = doc.querySelectorAll('.prev_title, .prev_white, .prevTabs a, .prevTabs span, .prevTabs li, .switchTab a, .switchTab span, .tabtags a, .tabtags li');
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var label = __cxClean(el.getAttribute('title') || el.textContent || '');
    if (!label || label.length > 24) continue;
    var isVideo = __cxHas(label, '视频') && !__cxHas(label, '测验');
    var isQuiz = __cxHas(label, '测验') || __cxHas(label, '考试') || __cxHas(label, '作业');
    var isDoc = __cxHas(label, '文档') || __cxHas(label, 'PPT') || __cxHas(label, '阅读') || __cxHas(label, '图文');
    if (!isVideo && !isQuiz && !isDoc) continue;
    var cls = String(el.className || '');
    out.push({
      el: el,
      label: label,
      video: isVideo,
      quiz: isQuiz,
      doc: isDoc,
      active: __cxHas(cls, 'currents') || __cxHas(cls, 'active') || __cxHas(cls, 'select') || __cxHas(cls, 'curr'),
      jobDone: __cxJobIconDone(el),
    });
  }
  return out;
}
function __cxCollectJobSteps(){
  var out = [];
  var frames = __cxFrames(window, 0);
  for (var f = 0; f < frames.length; f++) {
    try {
      var doc = frames[f].document;
      var boxes = doc.querySelectorAll('.ans-attach-ct, .ans-cc, .moduleDiv');
      for (var i = 0; i < boxes.length; i++) {
        var box = boxes[i];
        var iframe = box.querySelector && box.querySelector('iframe');
        var src = iframe ? String(iframe.src || iframe.getAttribute('src') || '') : '';
        var html = '';
        try { html = String(box.className || ''); } catch (e) {}
        var isVideo = !!box.querySelector('video') || __cxHas(src, 'ananas') || __cxHas(src, 'insertvideo') || __cxHas(src, 'modules/video') || __cxHas(html, 'insertvideo');
        var isQuiz = __cxHas(src, 'work') || __cxHas(src, 'quiz') || __cxHas(src, 'exam') || __cxHas(html, 'work');
        var isDoc = __cxHas(src, 'pdf') || __cxHas(src, 'document') || __cxHas(src, 'innerbook') || __cxHas(html, 'insertdoc');
        if (!isVideo && !isQuiz && !isDoc) continue;
        var playing = false;
        try { playing = !!(box.querySelector('video') && box.querySelector('video').paused === false); } catch (e) {}
        out.push({
          el: box,
          label: isVideo ? ('视频' + (out.filter(function(s){ return s.video }).length + 1)) : (isQuiz ? '测验' : '文档'),
          video: isVideo,
          quiz: isQuiz,
          doc: isDoc,
          active: playing || __cxHas(String(box.className || ''), 'active'),
          jobDone: __cxJobIconDone(box),
        });
      }
    } catch (e) {}
  }
  return out;
}
function __cxListSteps(){
  var frames = __cxFrames(window, 0);
  var best = [];
  for (var f = 0; f < frames.length; f++) {
    try {
      var got = __cxCollectTabSteps(frames[f].document);
      if (got.length > best.length) best = got;
    } catch (e) {}
  }
  var videoTabs = 0;
  for (var t = 0; t < best.length; t++) if (best[t].video) videoTabs++;
  if (videoTabs <= 1) {
    var jobs = __cxCollectJobSteps();
    var videoJobs = 0;
    for (var j = 0; j < jobs.length; j++) if (jobs[j].video) videoJobs++;
    if (videoJobs > videoTabs) best = jobs;
  }
  if (best.length && !best.some(function(item){ return item.active; })) best[0].active = true;
  return best;
}
function __cxClickChapterTab(){
  var sels = ['a[data-url*="studentcourse"]', '[data-url*="studentcourse"]', 'a[data-url*="/mycourse/studentcourse"]'];
  for (var s = 0; s < sels.length; s++) {
    var el = document.querySelector(sels[s]);
    if (!el) continue;
    __cxClick(el);
    return { ok: true, via: sels[s] };
  }
  var nodes = document.querySelectorAll('a, [role="tab"], li, span');
  for (var i = 0; i < nodes.length; i++) {
    var t = __cxClean(nodes[i].getAttribute('title') || nodes[i].textContent || '');
    if (t === '章节') {
      __cxClick(nodes[i]);
      return { ok: true, via: 'text' };
    }
  }
  return { ok: false, error: '没有章节标签' };
}
`

export const CHAOXING_STUDY_INSPECT = `(function(){
  ${cleanJs}
  if (!__cxHas(location.host, 'chaoxing.com')) return null;
  if (document.querySelector('#ucode, .yzmInp, form[action*="processVerify"], img[src*="processVerify"]')
    || /请输入图片中的验证码|【\\s*9010\\s*】/.test(((document.body && document.body.innerText) || ''))) {
    return {
      page: 'captcha',
      captcha: true,
      quiz: false,
      video: null,
      hint: '学习通弹出图片验证码（9010）。自己认图读出 4 位，调用 browser_chaoxing_captcha 提交，然后继续刷课。不要问用户。',
    };
  }
  var jobDone = null;
  var video = __cxFindVideo();
  var iframeSrcs = [];
  var tree = __cxIframeTree(window, 0);
  for (var n = 0; n < tree.length && iframeSrcs.length < 12; n++) {
    if (tree[n].src) iframeSrcs.push(tree[n].src);
  }
  try {
    var iconDoc = (video && video.ownerDocument) || document;
    var icon = iconDoc.querySelector('.ans-job-icon');
    if (icon) {
      var pos = '';
      try { pos = window.getComputedStyle(icon).backgroundPosition || ''; } catch (e) {}
      jobDone = pos === '0px -24px' || __cxHas(icon.className, 'finish') || __cxHas(icon.className, 'clear');
    }
  } catch (e) {}
  var stepEl = document.querySelector('.prev_title');
  var step = stepEl ? __cxClean(stepEl.getAttribute('title') || stepEl.textContent || '') : '';
  var chapters = __cxParsePlayerTree(document);
  if (!chapters.length) {
    var nodes = document.querySelectorAll('#coursetree .posCatalog_select');
    for (var j = 0; j < nodes.length && chapters.length < 80; j++) {
      if (__cxHas(nodes[j].className, 'firstLayer')) continue;
      var name = nodes[j].querySelector('.posCatalog_name');
      var title = name ? __cxClean(name.getAttribute('title') || name.textContent || '') : '';
      if (!title) continue;
      var jobs = __cxJobCount(nodes[j]);
      chapters.push({
        title: title.slice(0, 80),
        index: __cxCatalogIndex(title),
        jobs: jobs,
        unfinished: jobs > 0,
        active: __cxHas(nodes[j].className, 'posCatalog_active'),
      });
    }
  }
  var treeJobs = __cxJobsFromText(__cxCatalogText(document.querySelector('#coursetree') || document.body));
  for (var t = 0; t < chapters.length; t++) {
    if (chapters[t].jobs) continue;
    var extra = __cxJobsForTitle(chapters[t].title, treeJobs);
    if (extra > 0) {
      chapters[t].jobs = extra;
      chapters[t].unfinished = true;
    }
  }
  chapters = __cxClearParentUnfinished(chapters);
  var path = location.pathname;
  var href = location.href;
  var page = 'other';
  if (__cxHas(href, 'passport2') || __cxHas(path, '/login')) page = 'login';
  else if (__cxHas(path, '/mycourse/tch')) page = 'teacher';
  else if (__cxHas(href, '/course/portal') || __cxHas(href, 'portal')) page = 'portal';
  else if (__cxHas(href, 'studentstudy') || document.querySelector('#coursetree')) page = 'player';
  else if (__cxHas(path, '/studentcourse')) page = 'chapters';
  else if (__cxHas(path, '/mycourse/stu')) page = 'student';
  else if (__cxHas(path, 'visit/interaction') || __cxHas(location.host, 'i.mooc.chaoxing') || __cxHas(location.host, 'i.chaoxing')) page = 'list';
  var chapterListUrl = '';
  for (var s = 0; s < iframeSrcs.length; s++) {
    if (__cxHas(iframeSrcs[s], '/studentcourse')) chapterListUrl = iframeSrcs[s];
  }
  if (!chapterListUrl && __cxHas(path, '/mycourse/stu')) {
    try {
      var u = new URL(href);
      var courseid = u.searchParams.get('courseid') || '';
      var clazzid = u.searchParams.get('clazzid') || '';
      var cpi = u.searchParams.get('cpi') || '';
      var enc = u.searchParams.get('enc') || u.searchParams.get('stuenc') || '';
      if (courseid && clazzid) {
        chapterListUrl = 'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse?courseid=' + courseid
          + '&clazzid=' + clazzid
          + (cpi ? '&cpi=' + cpi : '')
          + '&ut=s'
          + (enc ? '&stuenc=' + enc : '');
      }
    } catch (e) {}
  }
  var chapterId = '';
  try {
    var cu = new URL(href);
    chapterId = cu.searchParams.get('chapterId') || cu.searchParams.get('chapterid') || cu.searchParams.get('knowledgeid') || '';
  } catch (e) {}
  var listed = __cxListSteps();
  var videoCount = 0;
  var videoIndex = 0;
  var listedIdx = -1;
  var moreVideos = false;
  for (var li = 0; li < listed.length; li++) {
    if (listed[li].active) listedIdx = li;
    if (listed[li].video) {
      videoCount++;
      if (listed[li].active) videoIndex = videoCount;
    }
  }
  for (var lk = listedIdx + 1; lk < listed.length; lk++) {
    if (listed[lk].quiz) break;
    if (listed[lk].video && listed[lk].jobDone !== true) { moreVideos = true; break; }
  }
  if (!step && listedIdx >= 0) step = listed[listedIdx].label;
  return {
    host: location.host,
    path: path,
    page: page,
    chapterId: chapterId,
    step: step,
    quiz: __cxHas(step, '测验') || __cxHas(step, '考试') || __cxHas(step, '作业'),
    jobDone: jobDone,
    steps: listed.map(function(item){
      return { label: item.label, video: item.video, quiz: item.quiz, doc: item.doc, active: item.active, jobDone: item.jobDone };
    }),
    videoCount: videoCount,
    videoIndex: videoIndex,
    moreVideos: moreVideos,
    current: (function(){
      var active = chapters.filter(function(item){ return item.active })[0];
      return __cxChapterLabel(active && active.title) || __cxChapterTitle();
    })(),
    next: (function(){
      var skip = function(item){
        var title = item && item.title || '';
        return __cxHas(title, '资料') || __cxHas(title, '测验') || __cxHas(title, '考试')
          || __cxHas(title, '作业') || __cxHas(title, '讨论') || __cxHas(title, '问卷')
          || __cxHasUnfinishedChild(chapters, item);
      };
      var start = -1;
      for (var i = 0; i < chapters.length; i++) {
        if (chapters[i].active) { start = i; break; }
      }
      for (var k = start + 1; k < chapters.length; k++) {
        if (chapters[k].unfinished && !skip(chapters[k])) return chapters[k].title;
      }
      for (var n = 0; n < chapters.length; n++) {
        if (chapters[n].unfinished && !chapters[n].active && !skip(chapters[n])) return chapters[n].title;
      }
      return '';
    })(),
    unfinished: (function(){
      var fromTree = chapters.filter(function(item){ return item.unfinished }).map(function(item){ return item.title });
      if (fromTree.length) return fromTree;
      var jobs = __cxJobsFromText(__cxCatalogText(document.querySelector('#coursetree') || document.body));
      var names = [];
      for (var key in jobs) {
        if (jobs[key] > 0) names.push(key);
      }
      return names;
    })(),
    iframes: iframeSrcs.slice(0, 4),
    chapterListUrl: chapterListUrl,
    video: __cxVideoSnap(video),
  };
})()`

const chapterWatchJs = `
function __zeScanOne(win){
    var href = '';
    var path = '';
    var doc = null;
    try {
      href = (win.location && win.location.href) || '';
      path = (win.location && win.location.pathname) || '';
      doc = win.document;
    } catch (e) { return null; }
    if (!doc || __cxSkipParseFrame(href, doc)) return null;
    var page = 'other';
    if (__cxHas(path, '/studentcourse') || __cxHas(href, 'studentcourse')) page = 'chapters';
    else if (__cxHas(href, 'studentstudy') || doc.querySelector('#coursetree')) page = 'player';
    else if (__cxHas(path, '/mycourse/stu')) page = 'student';
    var hasTree = !!doc.querySelector('#coursetree, .posCatalog_select');
    var items = [];
    var progress = __cxCatalogProgressFromDoc(doc);
    if (hasTree || page === 'player') {
      items = __cxParsePlayerTree(doc);
      if (items.length && page === 'other') page = 'player';
      var leftJobs = __cxStudyJobsLeft(doc);
      if (leftJobs && !progress) {
        var jobTotal = 0;
        for (var jt = 0; jt < items.length; jt++) {
          if (items[jt].kind !== 'chapter') jobTotal += items[jt].jobs || 0;
        }
        if (jobTotal >= leftJobs) progress = { done: jobTotal - leftJobs, total: jobTotal };
      }
    } else if (doc.querySelector('.catalog_title, a.clicktitle, .catalog_name, .chapter_item')) {
      var catalog = __cxParseCourseCatalog(doc);
      items = catalog.items;
      progress = catalog.progress || progress;
    }
    items = __cxClearParentUnfinished(items);
    var unfinishedItems = items.filter(function(item){
      return item.unfinished && item.kind !== 'chapter' && !__cxSkipDocTitle(item.title) && !__cxHasUnfinishedChild(items, item);
    });
    var unfinished = unfinishedItems.map(function(item){ return item.title; });
    var active = items.filter(function(item){ return item.active; })[0];
    var current = active ? active.title : '';
    var onUnfinished = unfinishedItems.some(function(item){ return item.active || __cxTitleMatch(item.title, current); });
    var first = unfinishedItems[0] || null;
    var left = progress && progress.total > progress.done ? progress.total - progress.done : unfinished.length;
    return {
      url: href,
      page: page,
      current: current,
      count: items.length,
      progress: progress,
      unfinishedCount: left,
      unfinished: unfinished,
      firstUnfinished: first ? first.title : '',
      onUnfinished: onUnfinished,
      chapters: items.length ? items : unfinishedItems,
      score: (unfinished.length * 20) + (progress ? 8 : 0) + items.length + (page === 'chapters' || page === 'player' ? 3 : 0),
    };
  }
function __zeScanChapters(){
  var frames = __cxFrames(window, 0);
  var best = null;
  for (var f = 0; f < frames.length; f++) {
    var one = __zeScanOne(frames[f]);
    if (!one) continue;
    if (!best || one.score > best.score) best = one;
  }
  if (!best) best = {
    url: location.href,
    page: 'other',
    unfinished: [],
    unfinishedCount: 0,
    chapters: [],
    progress: null,
  };
  var left = best.unfinishedCount || 0;
  best.live = true;
  best.ts = Date.now();
  best.hint = left > 0
    ? (best.onUnfinished
      ? ('当前就在未完成节「' + (best.current || best.firstUnfinished || '') + '」。调用 browser_chaoxing_study 会直接播放，不要 click_text。')
      : ('未完成：' + (best.unfinished || []).join('、') + '。调用 browser_chaoxing_study 打开第一节并播放，不要自己点「xxx(1)」，不要打开 iframe 网址。'))
    : (best.progress
      ? ('已完成任务点 ' + best.progress.done + '/' + best.progress.total + '。')
      : '没有读到未完成章节。');
  return best;
}
function __zePublishChapters(){
  var snap = __zeScanChapters();
  window.__ZE_CHAPTERS__ = snap;
  try { if (window.top) window.top.__ZE_CHAPTERS__ = snap; } catch (e) {}
  return snap;
}
function __zeWatchDoc(doc){
  if (!doc || !doc.querySelector) return false;
  var root = doc.querySelector('#coursetree')
    || doc.querySelector('.chapterList, .catalog_list, .chapter_unit, .navdiv')
    || (doc.querySelector('.catalog_title, .posCatalog_select') ? doc.body : null);
  if (!root || root.__ZE_CH_OBS__) return false;
  var timer = 0;
  var obs = new MutationObserver(function(){
    if (timer) return;
    timer = setTimeout(function(){
      timer = 0;
      __zePublishChapters();
    }, 80);
  });
  obs.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['class', 'value'],
  });
  root.__ZE_CH_OBS__ = 1;
  return true;
}
function __zeBindChapters(){
  var frames = __cxFrames(window, 0);
  for (var i = 0; i < frames.length; i++) {
    try { __zeWatchDoc(frames[i].document); } catch (e) {}
  }
  window.__ZE_CH_LIVE__ = 1;
  window.__ZE_PUBLISH_CHAPTERS__ = __zePublishChapters;
  if (!window.__ZE_CH_RETRY__) {
    window.__ZE_CH_RETRY__ = setInterval(function(){
      var again = __cxFrames(window, 0);
      var added = false;
      for (var r = 0; r < again.length; r++) {
        try { if (__zeWatchDoc(again[r].document)) added = true; } catch (e) {}
      }
      if (added) __zePublishChapters();
      if (window.__ZE_CHAPTERS__ && window.__ZE_CHAPTERS__.chapters && window.__ZE_CHAPTERS__.chapters.length) {
        clearInterval(window.__ZE_CH_RETRY__);
        window.__ZE_CH_RETRY__ = 0;
      }
    }, 900);
  }
  if (window.__ZE_CHAPTERS__ && window.__ZE_CHAPTERS__.chapters && window.__ZE_CHAPTERS__.chapters.length) {
    return window.__ZE_CHAPTERS__;
  }
  return __zePublishChapters();
}
`

export const CHAOXING_CHAPTER_INSTALL = `(function(){
  ${cleanJs}
  ${chapterWatchJs}
  return __zeBindChapters();
})()`

export const CHAOXING_CHAPTER_READ = `(function(){
  try { if (window.__ZE_CHAPTERS__) return window.__ZE_CHAPTERS__; } catch (e) {}
  try { if (window.top && window.top.__ZE_CHAPTERS__) return window.top.__ZE_CHAPTERS__; } catch (e) {}
  return null;
})()`

export const CHAOXING_CHAPTER_REFRESH = `(function(){
  if (typeof window.__ZE_PUBLISH_CHAPTERS__ === 'function') return window.__ZE_PUBLISH_CHAPTERS__();
  return window.__ZE_CHAPTERS__ || { needInstall: true };
})()`

export const CHAOXING_PARSE_CHAPTERS = CHAOXING_CHAPTER_INSTALL
export const CHAOXING_LIST_CHAPTERS = CHAOXING_CHAPTER_INSTALL

export const CHAOXING_CLICK_CHAPTER_TAB = `(function(){
  ${cleanJs}
  return __cxClickChapterTab();
})()`

export const CHAOXING_OPEN_CHAPTER = `(function(rawTitle, rawId){
  ${cleanJs}
  var wantRaw = __cxClean(rawTitle);
  var wantIndex = __cxCatalogIndex(wantRaw);
  var want = __cxBareTitle(wantRaw);
  var wantId = String(rawId || '').replace(/\\D/g, '');
  if (!want && !wantIndex && !wantId) return { ok: false, error: '缺少节名' };
  var frames = __cxFrames(window, 0);
  var clickName = function(el, via){
    if (!el) return null;
    var name = el;
    if (el.querySelector) {
      name = el.querySelector('.posCatalog_name, .posCatalog_title, a.clicktitle, a') || el;
    }
    var box = name.closest ? name.closest('.posCatalog_select, li, .chapter_item, .catalog_item') : el;
    __cxClick(name);
    return {
      ok: true,
      title: __cxChapterLabel((name.getAttribute && name.getAttribute('title')) || name.textContent || ''),
      active: box ? __cxHas(box.className, 'posCatalog_active') : false,
      via: via,
    };
  };
  if (wantId) {
    for (var f = 0; f < frames.length; f++) {
      var doc = null;
      try { doc = frames[f].document; } catch (e) { continue; }
      if (!doc) continue;
      var byId = doc.getElementById('cur' + wantId) || doc.getElementById(wantId);
      if (byId) return clickName(byId, 'id');
      var idNodes = doc.querySelectorAll('#coursetree .posCatalog_select, a.clicktitle, .catalog_title, a[href*="chapterId"], a[href*="knowledgeid"]');
      for (var n = 0; n < idNodes.length; n++) {
        var html = '';
        try { html = idNodes[n].outerHTML || ''; } catch (e) {}
        if (html.indexOf('cur' + wantId) >= 0 || /chapterId=/.test(html) && html.indexOf(wantId) >= 0) {
          return clickName(idNodes[n], 'id-html');
        }
        var click = String(idNodes[n].getAttribute && idNodes[n].getAttribute('onclick') || '');
        if (click.indexOf(wantId) >= 0 && /getTeacherAjax/.test(click)) return clickName(idNodes[n], 'id-ajax');
      }
    }
  }
  var exactIndex = null;
  var exact = null;
  var fuzzy = null;
  for (var f2 = 0; f2 < frames.length; f2++) {
    var doc2 = null;
    try { doc2 = frames[f2].document; } catch (e) { continue; }
    if (!doc2) continue;
    var prefer = doc2.querySelectorAll('#coursetree .posCatalog_select .posCatalog_name, #coursetree .posCatalog_name');
    var nodes = prefer.length
      ? prefer
      : doc2.querySelectorAll('a.clicktitle, .posCatalog_name, a.chapter_item, .catalog_name a, .chapter_Td a, .catalog_title a, .catalog_title, .catalog_title div, li.chapter a');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var title = __cxChapterLabel(el.getAttribute('title') || el.textContent || '');
      var bar = el.querySelector ? el.querySelector('.posCatalog_sbar') : null;
      var index = (bar ? __cxClean(bar.textContent || '') : '') || __cxCatalogIndex(title);
      if (!title && !index) continue;
      if (__cxSkipTitle(title || index) && !index) continue;
      if (wantIndex && index === wantIndex && !exactIndex) exactIndex = el;
      var bare = __cxBareTitle(title || index);
      if (wantIndex && index && wantIndex !== index) continue;
      if (want && bare === want && !exact) exact = el;
      else if (!wantIndex && want && !fuzzy && (__cxHas(bare, want) || __cxHas(want, bare))) fuzzy = el;
    }
    if (exactIndex || exact) break;
  }
  var hit = exactIndex || exact || fuzzy;
  if (!hit) return { ok: false, error: '目录里没有「' + (want || wantIndex) + '」', want: want };
  return clickName(hit, wantIndex && hit === exactIndex ? 'index' : 'click');
})`

export const CHAOXING_PLAY_SCRIPT = `(function(){
  ${cleanJs}
  var frames = __cxFrames(window, 0);
  var video = __cxFindVideo();
  var playBtn = null;
  var cover = null;
  var searchDocs = [];
  if (video && video.ownerDocument) searchDocs.push(video.ownerDocument);
  for (var i = 0; i < frames.length; i++) {
    try { searchDocs.push(frames[i].document); } catch (e) {}
  }
  for (var d = 0; d < searchDocs.length; d++) {
    try {
      var doc = searchDocs[d];
      if (!playBtn) playBtn = doc.querySelector('.vjs-big-play-button, button.vjs-big-play-button, .vjs-play-control.vjs-paused');
      if (!cover) cover = doc.querySelector('.vjs-poster, .full_page_bg, .ans-job-poster');
    } catch (e) {}
  }
  if (playBtn) __cxClick(playBtn);
  else if (cover) __cxClick(cover);
  if (video) {
    try { video.muted = false; } catch (e) {}
    var start = video.play();
    if (start && start.catch) start.catch(function(){});
  }
  var snap = __cxVideoSnap(video) || {};
  return {
    page: (__cxHas(location.href, 'studentstudy') || document.querySelector('#coursetree')) ? 'player' : location.pathname,
    clickedPlay: !!playBtn,
    clickedCover: !playBtn && !!cover,
    hasVideo: !!video,
    paused: snap.paused == null ? null : snap.paused,
    ended: snap.ended || false,
    current: snap.current || 0,
    duration: snap.duration || 0,
    ready: snap.ready || 0,
    src: snap.src || '',
    frameCount: frames.length,
  };
})()`

export const CHAOXING_CLICK_VIDEO_TAB = `(function(){
  ${cleanJs}
  var steps = __cxListSteps();
  var current = null;
  for (var i = 0; i < steps.length; i++) if (steps[i].active) { current = steps[i]; break; }
  if (current && current.quiz) return { ok: false, quiz: true, step: current.label, steps: steps.length };
  if (current && current.video) {
    return { ok: true, already: true, step: current.label, videoCount: steps.filter(function(s){ return s.video }).length };
  }
  var hit = null;
  for (var k = 0; k < steps.length; k++) {
    if (steps[k].video && steps[k].jobDone !== true) { hit = steps[k]; break; }
  }
  if (!hit) {
    for (var n = 0; n < steps.length; n++) if (steps[n].video) { hit = steps[n]; break; }
  }
  if (!hit) return { ok: false, step: current ? current.label : '', error: '没有视频标签' };
  __cxClick(hit.el);
  return { ok: true, step: hit.label, videoCount: steps.filter(function(s){ return s.video }).length };
})()`

export const CHAOXING_NEXT_STEP = `(function(){
  ${cleanJs}
  var steps = __cxListSteps();
  var idx = -1;
  for (var i = 0; i < steps.length; i++) if (steps[i].active) { idx = i; break; }
  var videos = steps.filter(function(s){ return s.video });
  for (var k = idx + 1; k < steps.length; k++) {
    if (steps[k].quiz) {
      return { ok: false, quiz: true, step: steps[k].label, chapterDone: false, videoCount: videos.length };
    }
    if (steps[k].doc) continue;
    if (steps[k].video && steps[k].jobDone !== true) {
      __cxClick(steps[k].el);
      return {
        ok: true,
        step: steps[k].label,
        index: k,
        videoCount: videos.length,
        more: true,
        chapterDone: false,
      };
    }
  }
  var frames = __cxFrames(window, 0);
  for (var f = 0; f < frames.length; f++) {
    try {
      var nodes = frames[f].document.querySelectorAll('a, button, span, div, li');
      for (var n = 0; n < nodes.length; n++) {
        var label = __cxClean(nodes[n].getAttribute('title') || nodes[n].textContent || '');
        if (label === '下一个任务点' || label === '下一任务点' || label === '下一个视频') {
          __cxClick(nodes[n]);
          return { ok: true, step: label, more: true, chapterDone: false, videoCount: videos.length };
        }
      }
    } catch (e) {}
  }
  return {
    ok: false,
    more: false,
    chapterDone: true,
    videoCount: videos.length,
    step: idx >= 0 ? steps[idx].label : '',
  };
})()`

export const CHAOXING_VIDEO_HOOK = `(function(){
  ${cleanJs}
  var root = window;
  try { if (window.top && window.top.document) root = window.top; } catch (e) {}
  var write = function(video){
    video = video || __cxFindVideo();
    if (!video) {
      root.__ZE_VIDEO__ = null;
      return false;
    }
    root.__ZE_VIDEO__ = __cxVideoSnap(video);
    return true;
  };
  var bind = function(){
    var video = __cxFindVideo();
    if (!video) return write(null);
    if (!video.__zeBound) {
      video.__zeBound = true;
      var on = function(){ write(video); };
      video.addEventListener('timeupdate', on);
      video.addEventListener('play', on);
      video.addEventListener('pause', on);
      video.addEventListener('ended', on);
      video.addEventListener('seeked', on);
      video.addEventListener('loadedmetadata', on);
    }
    return write(video);
  };
  if (!root.__ZE_HOOK_TIMER__) root.__ZE_HOOK_TIMER__ = setInterval(bind, 1500);
  bind();
  return root.__ZE_VIDEO__ || { hooked: true, hasVideo: false };
})()`

export const CHAOXING_VIDEO_TICK = `(function(){
  ${cleanJs}
  var video = __cxFindVideo();
  if (video) return __cxVideoSnap(video);
  var cached = window.__ZE_VIDEO__;
  if (cached && cached.ts && (Date.now() - cached.ts) < 800) return cached;
  try {
    if (window.top && window.top.__ZE_VIDEO__) cached = window.top.__ZE_VIDEO__;
  } catch (e) {}
  return cached || null;
})()`

export const CHAOXING_CHAPTER_HOOK = `(function(){
  function clean(s){ return String(s || '').replace(/[\\n\\r\\t]+/g, ' ').replace(/  +/g, ' ').trim(); }
  function textOf(root){
    try {
      var el = root || document.body;
      if (el === document || (el && el.nodeType === 9)) el = el.body || el.documentElement;
      return String((el && (el.innerText || el.textContent)) || '');
    } catch (e) { return ''; }
  }
  function progressOf(text){
    var hit = String(text || '').match(/已完成任务点\\s*[:：]?\\s*(\\d+)\\s*\\/\\s*(\\d+)/);
    return hit ? { done: parseInt(hit[1], 10), total: parseInt(hit[2], 10) } : null;
  }
  function jobsFromText(text){
    var jobs = {};
    var lines = String(text || '').replace(/\\r/g, '\\n').split('\\n').map(clean).filter(Boolean);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var next = lines[i + 1] || '';
      if (/^\\d{1,2}$/.test(line) && /^第/.test(next)) continue;
      if (/已完成任务点|^目录$|^第/.test(line)) continue;
      if (/^\\d{1,2}$/.test(next) && !/^第/.test(line) && line.length > 1) {
        var after = lines[i + 2] || '';
        if (/^第/.test(after)) continue;
        jobs[line] = parseInt(next, 10);
      }
    }
    return jobs;
  }
  function skip(title){
    title = clean(title);
    var index = String(title || '').trim().match(/^(\\d+(?:\\.\\d+)+)\\b/);
    return !title || (title.length < 2 && !index) || /^ZRRESULT:/.test(title) || /^第.+部分/.test(title) || /^\\d+$/.test(title) || title === '目录'
      || /资料|测验|考试|作业|讨论|问卷/.test(title);
  }
  function catalogIndex(title){
    var hit = String(title || '').trim().match(/^(\\d+(?:\\.\\d+)+)\\b/);
    return hit ? hit[1] : '';
  }
  function bare(title){
    var raw = clean(String(title || '').replace(/[（(]\\s*\\d+\\s*[）)]\\s*$/g, ''));
    var index = catalogIndex(raw);
    var name = clean(raw.replace(/^\\d+(?:\\.\\d+)+\\s*/, ''));
    return name || index;
  }
  function jobsOfBox(box){
    if (!box) return 0;
    var task = box.querySelector ? (box.querySelector('.catalog_task, .orangeNew, .jobUnfinishCount, .jobUnfinish') || box) : box;
    var marks = task.querySelectorAll ? task.querySelectorAll('span, em, i, b') : [];
    if (marks.length >= 2 && /catalog_task/.test(String(task.className || ''))) return 1;
    var t = clean(task.textContent || '');
    if (/^\\d{1,2}$/.test(t) && parseInt(t, 10) > 0) return parseInt(t, 10);
    if (/未完成|待完成|未学/.test(t)) return 1;
    return 0;
  }
  function catalogFromDoc(doc, jobs){
    if (!doc || !doc.querySelectorAll) return;
    var nodes = doc.querySelectorAll('.catalog_title, .catalog_name, .posCatalog_name, a.clicktitle');
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var nameEl = el.querySelector ? (el.querySelector('div:nth-child(2), .catalog_name, a, span') || el) : el;
      var title = clean((nameEl.getAttribute && nameEl.getAttribute('title')) || nameEl.textContent || '');
      if (skip(title)) continue;
      var wrap = el.closest ? (el.closest('.catalog_rep, .chapter_unit, .posCatalog_select, .catalog_item, li') || el.parentElement) : el.parentElement;
      var n = jobsOfBox(wrap) || jobs[title] || jobs[bare(title)] || 0;
      if (n > 0) jobs[catalogIndex(title) ? title : (bare(title) || title)] = n;
    }
  }
  function isTaskOnly(text){
    return /暂无任务|默认班级/.test(text) && !/已完成任务点/.test(text);
  }
  function walk(win, depth, texts, docs){
    try {
      var piece = textOf(win.document);
      if (!isTaskOnly(piece)) {
        texts.push(piece);
        if (docs) docs.push(win.document);
      }
      if ((depth || 0) > 3) return;
      var list = win.document.querySelectorAll('iframe');
      for (var i = 0; i < list.length; i++) {
        try { if (list[i].contentWindow) walk(list[i].contentWindow, (depth || 0) + 1, texts, docs); } catch (e) {}
      }
    } catch (e) {}
  }
  var texts = [];
  var docs = [];
  walk(window, 0, texts, docs);
  try {
    var extras = window.__ZE_FRAME_SNAPS__ || [];
    for (var x = 0; x < extras.length; x++) {
      if (extras[x] && extras[x].text) texts.push(String(extras[x].text));
    }
  } catch (e) {}
  var pageText = texts.join('\\n');
  var progress = progressOf(pageText);
  var jobs = jobsFromText(pageText);
  for (var d = 0; d < docs.length; d++) catalogFromDoc(docs[d], jobs);
  var unfinished = [];
  for (var key in jobs) {
    if (jobs[key] > 0 && !skip(key)) unfinished.push(catalogIndex(key) ? key : (bare(key) || key));
  }
  unfinished = unfinished.filter(function(title){
    var idx = catalogIndex(title);
    if (!idx) return true;
    var prefix = idx + '.';
    for (var u = 0; u < unfinished.length; u++) {
      var other = catalogIndex(unfinished[u]);
      if (other && other.indexOf(prefix) === 0) return false;
    }
    return true;
  });
  var href = location.href || '';
  var page = 'other';
  if (/studentcourse/.test(href)) page = 'chapters';
  else if (/studentstudy/.test(href) || document.querySelector('#coursetree')) page = 'player';
  else if (/\\/mycourse\\/stu/.test(href)) page = (progress || unfinished.length) ? 'chapters' : 'student';
  var current = '';
  try {
    var name = document.querySelector('#coursetree .posCatalog_active .posCatalog_name');
    current = clean((name && (name.getAttribute('title') || name.textContent)) || '');
  } catch (e) {}
  var snap = {
    url: href,
    page: page,
    current: current,
    progress: progress,
    unfinished: unfinished,
    unfinishedCount: progress && progress.total > progress.done ? progress.total - progress.done : unfinished.length,
    chapters: unfinished.map(function(t){ return { title: t, jobs: jobs[t] || 1, unfinished: true }; }),
    ts: Date.now(),
  };
  window.__ZE_CHAPTERS__ = snap;
  if (!unfinished.length && !progress && !document.querySelector('#coursetree, .catalog_title, .posCatalog_select') && !window.__ZE_CHAPTER_FETCHING__) {
    var src = '';
    var frames = document.querySelectorAll('a[data-url*="studentcourse"], [data-url*="studentcourse"], iframe[src*="studentcourse"], iframe[src], [data-url]');
    for (var f = 0; f < frames.length; f++) {
      var u = frames[f].src || frames[f].getAttribute('src') || frames[f].getAttribute('data-url') || '';
      if (u.indexOf('studentcourse') >= 0) { src = u; break; }
    }
    if (!src) {
      try {
        var cu = new URL(href);
        var courseid = cu.searchParams.get('courseid') || cu.searchParams.get('courseId') || '';
        var clazzid = cu.searchParams.get('clazzid') || cu.searchParams.get('clazzId') || '';
        var cpi = cu.searchParams.get('cpi') || '';
        var enc = cu.searchParams.get('enc') || cu.searchParams.get('stuenc') || '';
        var t = cu.searchParams.get('t') || '';
        if (courseid && clazzid) {
          src = 'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse?courseid=' + courseid
            + '&clazzid=' + clazzid + (cpi ? '&cpi=' + cpi : '') + '&ut=s' + (t ? '&t=' + t : '') + (enc ? '&stuenc=' + enc : '');
        }
      } catch (e) {}
    }
    if (src) {
      try { src = new URL(src, location.href).href; } catch (e) {}
      window.__ZE_CHAPTER_FETCHING__ = true;
      fetch(src, { credentials: 'include' }).then(function(res){ return res.text(); }).then(function(html){
        var doc = new DOMParser().parseFromString(html, 'text/html');
        var remoteText = textOf(doc);
        var remoteProgress = progressOf(remoteText) || progress;
        var remoteJobs = jobsFromText(remoteText);
        catalogFromDoc(doc, remoteJobs);
        var names = [];
        for (var k in remoteJobs) {
          if (remoteJobs[k] > 0 && !skip(k)) names.push(catalogIndex(k) ? k : (bare(k) || k));
        }
        names = names.filter(function(title){
          var idx = catalogIndex(title);
          if (!idx) return true;
          var prefix = idx + '.';
          for (var n = 0; n < names.length; n++) {
            var other = catalogIndex(names[n]);
            if (other && other.indexOf(prefix) === 0) return false;
          }
          return true;
        });
        if (names.length || remoteProgress) {
          window.__ZE_CHAPTERS__ = {
            url: href,
            page: 'chapters',
            current: current,
            progress: remoteProgress,
            unfinished: names,
            unfinishedCount: remoteProgress && remoteProgress.total > remoteProgress.done ? remoteProgress.total - remoteProgress.done : names.length,
            chapters: names.map(function(t){ return { title: t, jobs: remoteJobs[t] || 1, unfinished: true }; }),
            ts: Date.now(),
            via: 'fetch',
          };
        }
        window.__ZE_CHAPTER_FETCHING__ = false;
      }).catch(function(){ window.__ZE_CHAPTER_FETCHING__ = false; });
    }
  }
  return snap;
})()`

export const CHAOXING_CHAPTER_TICK = CHAOXING_CHAPTER_READ

export const CHAOXING_CAPTCHA_CHECK = `(function(){
  var hit = function(doc){
    if (!doc) return false;
    try {
      if (doc.querySelector('#ucode, .yzmInp, form[action*="processVerify"], img[src*="processVerify"], #ccc')) return true;
      var t = ((doc.body && (doc.body.innerText || doc.body.textContent)) || '');
      return /请输入图片中的验证码|【\\s*9010\\s*】|processVerify/.test(t);
    } catch (e) { return false; }
  };
  if (hit(document)) return { captcha: true, message: '【9010】请输入图片中的验证码' };
  try {
    var extras = window.__ZE_FRAME_SNAPS__ || [];
    for (var i = 0; i < extras.length; i++) {
      if (/请输入图片中的验证码|【\\s*9010\\s*】|processVerify|#ucode/.test(String(extras[i].text || ''))) {
        return { captcha: true, message: '【9010】请输入图片中的验证码' };
      }
    }
  } catch (e) {}
  return { captcha: false };
})()`

export const CHAOXING_CAPTCHA_IMAGE = `(function(){
  var img = null;
  try { img = document.querySelector('#ccc, .yzmImg img, img[src*="processVerify"]'); } catch (e) {}
  if (img && !img.complete) {
    if (!window.__ZE_CAPTCHA_WAIT__) {
      window.__ZE_CAPTCHA_WAIT__ = true;
      img.onload = function(){ window.__ZE_CAPTCHA_WAIT__ = false; };
    }
    return window.__ZE_CAPTCHA_IMG__ || { captcha: true, pending: true, src: String(img.src || '') };
  }
  if (img) {
    try {
      var canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width || 104;
      canvas.height = img.naturalHeight || img.height || 44;
      var ctx = canvas.getContext('2d');
      if (ctx && canvas.width > 0 && canvas.height > 0) {
        ctx.drawImage(img, 0, 0);
        var data = canvas.toDataURL('image/jpeg', 0.92);
        if (data && data.length > 80) {
          window.__ZE_CAPTCHA_IMG__ = { captcha: true, image: data, src: String(img.src || '') };
          return window.__ZE_CAPTCHA_IMG__;
        }
      }
    } catch (e) {}
    if (img.src && !window.__ZE_CAPTCHA_FETCHING__) {
      window.__ZE_CAPTCHA_FETCHING__ = true;
      fetch(img.src, { credentials: 'include', cache: 'no-store' }).then(function(res){ return res.blob(); }).then(function(blob){
        var reader = new FileReader();
        reader.onload = function(){
          window.__ZE_CAPTCHA_IMG__ = { captcha: true, image: reader.result, src: String(img.src || '') };
          window.__ZE_CAPTCHA_FETCHING__ = false;
        };
        reader.readAsDataURL(blob);
      }).catch(function(){ window.__ZE_CAPTCHA_FETCHING__ = false; });
    }
    return window.__ZE_CAPTCHA_IMG__ || { captcha: true, pending: true, src: String(img.src || '') };
  }
  return window.__ZE_CAPTCHA_IMG__ || { captcha: true, image: null };
})()`

export const CHAOXING_CAPTCHA_REFRESH = `(function(){
  window.__ZE_CAPTCHA_IMG__ = null;
  window.__ZE_CAPTCHA_FETCHING__ = false;
  window.__ZE_CAPTCHA_WAIT__ = false;
  var img = null;
  try { img = document.querySelector('#ccc, .yzmImg img, img[src*="processVerify"]'); } catch (e) {}
  if (!img) return { ok: false };
  try { img.click(); } catch (e) {}
  var src = String(img.src || '');
  if (src) {
    img.src = /[?&]t=/.test(src)
      ? src.replace(/([?&]t=)\\d+/, '$1' + Date.now())
      : src + (src.indexOf('?') >= 0 ? '&' : '?') + 't=' + Date.now();
  }
  return { ok: true };
})()`

export const CHAOXING_CAPTCHA_FILL = `(function(code){
  code = String(code || '').replace(/\\s+/g, '');
  if (!/^[0-9a-zA-Z]{4}$/.test(code)) return { ok: false, error: '验证码必须是 4 位字母或数字' };
  var input = document.querySelector('#ucode, .yzmInp, input[name="ucode"]');
  if (!input) return { ok: false, error: '没有验证码输入框' };
  input.focus();
  input.value = code;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  var form = input.form || document.querySelector('form[action*="processVerify"]');
  var btn = document.querySelector('input.submit, input[type="submit"], button[type="submit"], .submit');
  if (form && typeof form.requestSubmit === 'function') form.requestSubmit(btn || undefined);
  else if (btn) btn.click();
  else if (form) form.submit();
  return { ok: true, code: code };
})`

export const CHAOXING_STUDY_PROMPT = `
学习通章节 / 未完成任务：
- 用户要刷课、播未完成时，第一件事就是 browser_chaoxing_study。不要先 get_page / eval / 点「章节」。study 会自己点章节、读目录、打开未完成节并播放。
- 禁止向用户要截图、页面文本或「配合提供信息」。目录在 iframe 里也能读。get_page 已经带了【章节目录】和未完成节名时，立刻 study，title 填带数字的第一节（如「维护网络安全」）。
- 解析器已经读到未完成列表时，直接 browser_chaoxing_study，不要自己点「xxx(1)」，不要打开 iframe 网址。
- 「暂无任务 / 默认班级」是「任务」页，不是章节目录。先点「章节」，等正文出现「已完成任务点 x/y」再读。不要把任务页当成没有章节。
- 本窗口能读、点所有 iframe（含跨域）。不要说「跨域无法读取」。get_page 会带【章节目录】；读到节名就 browser_chaoxing_study。
- 解析器空、失败、或页面只有课程壳（只有「章节/作业」没有节名）时，不要说全部完成，不要问用户。必须自己解析页面：browser_get_page 看【章节目录】和 iframe；没有节名就点「章节」等两秒再读；必要时 browser_eval 扫「已完成任务点 x/y」、.catalog_title、#coursetree。读到未完成节名立刻 browser_chaoxing_study，title 填干净节名。
- 只有正文明确「已完成任务点 n/n」（分子分母相同）且没有带未完成数字的节，才能说做完。24/29 这种绝对不是做完。解析器 unfinishedCount=0 也不等于做完。
- 可选 title：带编号的节名，如「4.4.1 某某」。父节 4.4 下面还有 4.4.1 时打开 4.4.1，不要停在父节点。不要带 (1)。
- 不要把 iframe 的 src（studentcourse、knowledge/cards、ananas）当顶层网址打开。
- 一节经常有多个视频。当前视频播完先切本章下一个视频，全部视频看完再下一章。
- 播放开始后，进度面板会自己走。视频在播时不要再 study / play，不要每次进度检查都重开当前节。暂停或卡住才 browser_chaoxing_play；播放器丢了才 study。章节测验默认停下；用户明确说写作业/答题再用 browser_chaoxing_homework。
- 弹出【9010】图片验证码时自己认图填写：看图读出 4 位字母或数字，调用 browser_chaoxing_captcha（code=那4位）或 browser_type #ucode 再点提交。不要问用户，不要 browser_wait。提交后再 browser_chaoxing_study。
`
