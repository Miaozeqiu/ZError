// 刷课 · catalog：目录树、节名（本地跑，不注入页面）
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
      if (!/^\d{1,2}$/.test(raw)) continue;
      if (el.closest && el.closest('.posCatalog_name, a.clicktitle, .clicktitle, .catalog_name, .chapter_index, .posCatalog_level')) continue;
      var n = parseInt(raw, 10);
      if (n > 0) return n;
    }
    for (var child = box.firstChild; child; child = child.nextSibling) {
      if (child.nodeType !== 3) continue;
      var lone = __cxClean(child.textContent);
      if (/^\d{1,2}$/.test(lone) && parseInt(lone, 10) > 0) return parseInt(lone, 10);
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
    var hit = String(text || '').match(/已完成任务点\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/);
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

function __cxJobsFromText(text){
    var jobs = {};
    var raw = String(text || '').replace(/\r/g, '\n');
    var lines = raw.split('\n').map(__cxClean).filter(Boolean);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var next = lines[i + 1] || '';
      if (/^\d{1,2}$/.test(line) && /^第/.test(next)) continue;
      if (/已完成任务点|^目录$|^第/.test(line)) continue;
      if (/^\d{1,2}$/.test(next)) {
        var after = lines[i + 2] || '';
        if (/^第/.test(after)) continue;
        jobs[line] = parseInt(next, 10);
        continue;
      }
      var tail = line.match(/^(.*\S)\s+(\d{1,2})$/);
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
    title = __cxChapterLabel(document.title.replace(/\s*[-_|].*(学习通|超星).*$/, ''));
    return title;
  }

function __cxSkipTitle(title){
    title = __cxClean(title);
    if (!title || title.length < 2) return true;
    if (__cxHas(title, '编辑章节') || __cxHas(title, '批量') || __cxHas(title, '打印')) return true;
    if (/^第.+部分/.test(title) || /^\d+$/.test(title) || title === '目录') return true;
    return false;
  }

function __cxCatalogIndex(title){
    var hit = String(title || '').trim().match(/^(\d+(?:\.\d+)+)\b/);
    return hit ? hit[1] : '';
  }

function __cxBareTitle(title){
    var raw = __cxClean(String(title || '').replace(/[（(]\s*\d+\s*[）)]\s*$/g, ''));
    var index = __cxCatalogIndex(raw);
    var bare = __cxClean(raw.replace(/^\d+(?:\.\d+)+\s*/, ''));
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
    return __cxHas(title, '资料') || __cxHas(title, '讨论') || __cxHas(title, '问卷');
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
    if (/^\d{5,}$/.test(id)) return id;
    try {
      var click = String(box.getAttribute('onclick') || '') + (box.innerHTML || '');
      var hit = click.match(/getTeacherAjax\s*\(\s*['"]\d+['"]\s*,\s*['"]\d+['"]\s*,\s*['"](\d+)['"]/i);
      if (hit) return hit[1];
    } catch (e) {}
    return '';
  }

function __cxStudyJobsLeft(doc){
    try {
      var el = doc.querySelector('#_studystate');
      var raw = el ? String(el.value || el.getAttribute('value') || '') : '';
      var hit = raw.match(/unfinishCount\s*:\s*(\d+)/);
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
      if (index && nameOnly) nameOnly = nameOnly.replace(new RegExp('^' + index.replace(/\./g, '\\.') + '\\s*'), '');
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
            if (/^\d{1,2}$/.test(t) && parseInt(t, 10) > 0) jobs = parseInt(t, 10);
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
        var idHit = blob.match(/chapterId[=:"']+(\d+)/i) || blob.match(/knowledgeid[=:"']+(\d+)/i) || blob.match(/id[="']+(?:\w*-)?(\d{6,})/i);
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
    // 正文「节名\n数字」兜底补齐未完成
    if (!items.some(function(item){ return item.unfinished; })) {
      for (var jk in textJobs) {
        if (!textJobs.hasOwnProperty(jk) || !(textJobs[jk] > 0)) continue;
        pushItem(jk, '', null, 'text');
      }
    }
    return { items: __cxClearParentUnfinished(items), progress: __cxCatalogProgress(pageText) };
  }

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
      else if (__cxHas(href, 'studentstudy')) page = 'player';
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
          if (jobTotal >= leftJobs && jobTotal >= 8) progress = { done: jobTotal - leftJobs, total: jobTotal };
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

function parse(doc, href){
  href = String(href || '');
  var host = '';
  var path = '';
  try {
    var u = new URL(href || 'https://mooc1.chaoxing.com/');
    host = u.host;
    path = u.pathname;
    href = u.href;
  } catch (e) {}
  var snap = __zeScanOne({ location: { href: href, pathname: path, host: host }, document: doc });
  if (!snap) return { ok: false, page: 'unknown', error: '目录脚本没认出这一页' };
  snap.ok = true;
  snap.role = 'study';
  return snap;
}
