// 刷课 · helpers：认目录、任务点、播放器。parse 和 locate 共用。
function __cxClean(s){
  return String(s || '').split('\n').join(' ').split('\t').join(' ').split('\r').join(' ').split('  ').join(' ').trim();
}

function __cxHas(text, piece){
  return String(text || '').indexOf(piece) >= 0;
}

function __cxSkipParseFrame(href, doc){
  if (!doc) return true;
  if (doc.querySelector('#coursetree, .posCatalog_select, .catalog_title, .posCatalog_name, a.clicktitle')) return false;
  if (/studentcourse|studentstudy|stucoursemiddle|\/mycourse\/stu/.test(href || '')) return false;
  return /ananas|insertvideo|modules\/video|knowledge\/cards|about:blank/.test(href || '');
}

function zeDur(v){
  if (!v) return 0;
  var n = Number(v.duration);
  return (isFinite(n) && n > 1) ? n : 0;
}

function boxOf(el){
  if (!el) return null;
  function map(){
    var r = null;
    try { r = el.getBoundingClientRect(); } catch (e1) {}
    if (!r || r.width < 2 || r.height < 2) return null;
    var x = r.left + r.width / 2;
    var y = r.top + r.height / 2;
    var win = el.ownerDocument && el.ownerDocument.defaultView;
    var topWin = null;
    try { topWin = (win && win.top) || win; } catch (e2) { topWin = win; }
    var reached = !win || !topWin || win === topWin;
    for (var g = 0; win && topWin && win !== topWin && g < 8; g++) {
      var frame = null;
      try { frame = win.frameElement; } catch (e3) { break; }
      if (!frame) break;
      var fr = null;
      try { fr = frame.getBoundingClientRect(); } catch (e4) {}
      if (!fr) break;
      x += fr.left + (Number(frame.clientLeft) || 0);
      y += fr.top + (Number(frame.clientTop) || 0);
      try { win = win.parent; } catch (e5) { win = null; break; }
      if (win === topWin) reached = true;
    }
    return { x: x, y: y, space: reached ? 'page' : 'frame' };
  }
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e0) {}
  var pos = map();
  if (!pos) return null;
  if (pos.space === 'page') {
    var topWin = null;
    try { topWin = (el.ownerDocument && el.ownerDocument.defaultView && el.ownerDocument.defaultView.top) || window.top; } catch (e6) {}
    var vw = 0, vh = 0;
    try { vw = (topWin && topWin.innerWidth) || 0; vh = (topWin && topWin.innerHeight) || 0; } catch (e7) {}
    if (vw > 2 && vh > 2 && (pos.x < 2 || pos.y < 2 || pos.x > vw - 2 || pos.y > vh - 2)) {
      try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e8) {}
      pos = map() || pos;
    }
  }
  return { x: pos.x, y: pos.y, space: pos.space };
}

function zeFireClick(el){
  if (!el) return false;
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e0) {}
  var doc = el.ownerDocument;
  var win = doc && doc.defaultView;
  var Ev = (win && win.MouseEvent) || MouseEvent;
  var types = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'];
  for (var i = 0; i < types.length; i++) {
    try {
      el.dispatchEvent(new Ev(types[i], {
        bubbles: true,
        cancelable: true,
        view: win,
        buttons: types[i].indexOf('down') >= 0 ? 1 : 0
      }));
    } catch (e1) {}
  }
  try { el.click(); } catch (e2) {}
  return true;
}

/** 顶层 elementFromPoint 只会打到外层 iframe。要一层层进框再点。 */
function zePierceClick(pageX, pageY){
  var x = Number(pageX) || 0;
  var y = Number(pageY) || 0;
  var doc = document;
  try { if (window.top && window.top.document) doc = window.top.document; } catch (eR) {}
  for (var d = 0; d < 8 && doc; d++) {
    var el = null;
    try { el = doc.elementFromPoint(x, y); } catch (e0) {}
    if (!el) return { ok: false, depth: d };
    var tag = String(el.tagName || '').toUpperCase();
    if (tag === 'IFRAME' || tag === 'FRAME') {
      var r = null;
      try { r = el.getBoundingClientRect(); } catch (e1) {}
      if (r) { x -= r.left; y -= r.top; }
      var child = null;
      try { child = el.contentDocument; } catch (e2) {}
      if (!child) {
        zeFireClick(el);
        return { ok: true, via: 'iframe', depth: d };
      }
      doc = child;
      continue;
    }
    zeFireClick(el);
    return { ok: true, via: 'pierce', depth: d, tag: tag };
  }
  return { ok: false };
}

function zeControlVideo(action){
  var wantPlay = action !== 'pause';
  var hit = zeFindVideo();
  if (!hit || !hit.v) return { ok: false, hasVideo: false };
  var v = hit.v;
  var doc = v.ownerDocument;
  var win = doc && doc.defaultView;
  try { v.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (eS) {}
  var pos = boxOf(v);
  if (pos) zePierceClick(pos.x, pos.y);
  var btn = null;
  try {
    btn = wantPlay
      ? (doc && doc.querySelector('.vjs-big-play-button, .vjs-play-control.vjs-paused, .vjs-poster'))
      : (doc && doc.querySelector('.vjs-play-control.vjs-playing, button.vjs-playing'));
  } catch (eB) {}
  if (btn) zeFireClick(btn);
  else zeFireClick(v);
  try {
    var root = v.closest && v.closest('.video-js');
    var id = root && root.id;
    var vjs = win && win.videojs;
    if (vjs && id) {
      var player = vjs.getPlayer(id);
      if (player) {
        try { player.muted(false); } catch (e1) {}
        if (wantPlay) {
          // play() 在刷新后未就绪时会卡住 CDP（awaitPromise）。丢到下一轮。
          setTimeout(function(){
            try {
              var pr = player.play();
              if (pr && pr.catch) pr.catch(function(){});
            } catch (e2) {}
          }, 0);
        } else {
          try { player.pause(); } catch (e3) {}
        }
      }
    }
  } catch (e4) {}
  try { v.muted = false; } catch (e5) {}
  try {
    if (wantPlay) {
      setTimeout(function(){
        try { if (v.readyState < 1 && !(v.currentSrc || v.src)) v.load(); } catch (e6) {}
        try {
          var start = v.play();
          if (start && start.catch) start.catch(function(){});
        } catch (e7) {}
      }, 0);
    } else {
      v.pause();
    }
  } catch (e8) {}
  var tick = zeTickOf(v, hit.src);
  tick.ok = true;
  tick.via = 'iframe';
  return tick;
}

function zeChapterId(href){
  try {
    var u = new URL(String(href || ''), 'https://mooc1.chaoxing.com/');
    return String(u.searchParams.get('chapterId') || u.searchParams.get('chapterid') || u.searchParams.get('knowledgeid') || u.searchParams.get('knowledgeId') || '');
  } catch (e) { return ''; }
}

function zeWantChapter(){
  var href = '';
  try { href = String((window.top && window.top.location && window.top.location.href) || location.href || ''); } catch (e) {
    href = location.href || '';
  }
  return zeChapterId(href);
}

function zeSkipWrongChapter(iframe){
  var src = '';
  try { src = String(iframe.src || iframe.getAttribute('src') || ''); } catch (e) {}
  if (/doHomeWork|inserthomework|\/work\/|modules\/work|selectWork|workPreview/.test(src)) return true;
  var want = zeWantChapter();
  var fid = zeChapterId(src);
  return !!(want && fid && fid !== want);
}

function zeDocs(doc, ox, oy, depth){
  var out = [{ doc: doc, ox: ox || 0, oy: oy || 0 }];
  if ((depth || 0) > 7 || !doc) return out;
  var list = [];
  try { list = doc.querySelectorAll('iframe'); } catch (e) { return out; }
  for (var i = 0; i < list.length; i++) {
    if (zeSkipWrongChapter(list[i])) continue;
    var child = null;
    try {
      var href = '';
      try { href = String(list[i].contentWindow && list[i].contentWindow.location && list[i].contentWindow.location.href || ''); } catch (eH) { href = ''; }
      if (!href || href === 'about:blank') continue;
      var rs = '';
      try { rs = String(list[i].contentDocument && list[i].contentDocument.readyState || ''); } catch (eR) { rs = ''; }
      if (rs === 'uninitialized' || rs === 'loading') continue;
      child = list[i].contentDocument;
    } catch (e2) {}
    var r = null;
    try { r = list[i].getBoundingClientRect(); } catch (e3) {}
    if (!child || !r) continue;
    var insetX = 0, insetY = 0;
    try { insetX = Number(list[i].clientLeft) || 0; insetY = Number(list[i].clientTop) || 0; } catch (e4) {}
    out = out.concat(zeDocs(child, (ox || 0) + r.left + insetX, (oy || 0) + r.top + insetY, (depth || 0) + 1));
  }
  return out;
}

function zeAliveVideo(v){
  try {
    if (!v || String(v.tagName || '') !== 'VIDEO') return false;
    if (v.isConnected === false) return false;
    var r = v.getBoundingClientRect();
    return !r || (r.width >= 2 && r.height >= 2);
  } catch (e) { return false; }
}

function zePinnedVideo(){
  try {
    var topV = window.top && window.top.__zePinnedVideo;
    if (zeAliveVideo(topV)) return topV;
  } catch (e0) {}
  try {
    if (zeAliveVideo(window.__zePinnedVideo)) return window.__zePinnedVideo;
  } catch (e1) {}
  return null;
}

function zePinVideo(v){
  if (!v) return;
  try { window.__zePinnedVideo = v; } catch (e0) {}
  try { if (window.top) window.top.__zePinnedVideo = v; } catch (e1) {}
}

function zePinMid(mid){
  var id = String(mid || '').trim();
  if (!id) return;
  try { window.__zePinnedMid = id; } catch (e0) {}
  try { if (window.top) window.top.__zePinnedMid = id; } catch (e1) {}
}

function zeReadPinnedMid(win){
  try {
    var raw = win && win.__zePinnedMid;
    if (typeof raw !== 'string') return '';
    var mid = String(raw || '').trim();
    if (!mid || mid.indexOf('function') === 0) return '';
    return mid;
  } catch (e) {}
  return '';
}

function zePinnedMid(){
  try {
    var top = zeReadPinnedMid(window.top);
    if (top) return top;
  } catch (e0) {}
  return zeReadPinnedMid(window);
}

function zeClearPinnedMid(){
  try { window.__zePinnedMid = ''; } catch (e0) {}
  try { if (window.top) window.top.__zePinnedMid = ''; } catch (e1) {}
}

function zeMidOfVideo(v){
  try {
    var w = v && v.ownerDocument && v.ownerDocument.defaultView;
    for (var g = 0; w && g < 8; g++) {
      var fe = null;
      try { fe = w.frameElement; } catch (e) {}
      if (fe) {
        var attr = '';
        try { attr = String(fe.getAttribute('mid') || fe.getAttribute('data-mid') || ''); } catch (eA) {}
        if (attr) return attr;
      }
      var src = '';
      try { src = String((fe && (fe.src || fe.getAttribute('src'))) || (w.location && w.location.href) || ''); } catch (e2) {}
      var mm = src.match(/[?&]mid=([^&]+)/i);
      if (mm) return decodeURIComponent(mm[1] || '');
      try {
        if (!w.parent || w === w.top) break;
        w = w.parent;
      } catch (e3) { break; }
    }
  } catch (e4) {}
  return '';
}

function zeClearPinnedVideo(){
  try { window.__zePinnedVideo = null; } catch (e0) {}
  try { if (window.top) window.top.__zePinnedVideo = null; } catch (e1) {}
}

function zeFindVideo(){
  var want = zePinnedMid();
  var pinned = zePinnedVideo();
  if (pinned) {
    var pinnedMid = zeMidOfVideo(pinned);
    if (want && pinnedMid !== want) {
      zeClearPinnedVideo();
      pinned = null;
    } else if (pinned) {
      if (pinnedMid && !want) zePinMid(pinnedMid);
      return { v: pinned, src: String(pinned.currentSrc || pinned.src || ''), score: 1 };
    }
  }
  var root = document;
  try { if (window.top && window.top.document) root = window.top.document; } catch (eZ) {}
  var docs = zeDocs(root, 0, 0, 0);
  var playing = null;
  var pinnedHit = null;
  var first = null;
  for (var i = 0; i < docs.length; i++) {
    var vids = [];
    try { vids = docs[i].doc.querySelectorAll('video'); } catch (e) {}
    for (var j = 0; j < vids.length; j++) {
      var v = vids[j];
      var r = null;
      try { r = v.getBoundingClientRect(); } catch (e2) {}
      if (!r || r.width < 2 || r.height < 2) continue;
      var src = '';
      try { src = String(v.currentSrc || v.src || ''); } catch (e3) {}
      var hasShell = false;
      try { hasShell = !!(v.closest && v.closest('.video-js, .ans-video, #video, .player')); } catch (eJ) {}
      if (!src && !(Number(v.readyState) > 0) && !(Number(v.currentTime) > 0) && !hasShell) continue;
      var item = { v: v, src: src, score: 1 };
      if (!first) first = item;
      var mid = zeMidOfVideo(v);
      if (v.paused === false) {
        playing = item;
        if (mid && !want) zePinMid(mid);
      }
      if (want && mid && mid === want) pinnedHit = item;
    }
  }
  if (want && !pinnedHit) {
    for (var p = 0; p < docs.length && !pinnedHit; p++) {
      var frames = [];
      try { frames = docs[p].doc.querySelectorAll('iframe'); } catch (eF) {}
      for (var q = 0; q < frames.length; q++) {
        var fe = frames[q];
        var blob = '';
        try { blob = String((fe.getAttribute('mid') || fe.getAttribute('data-mid') || '') + ' ' + (fe.src || fe.getAttribute('src') || '')); } catch (eB) {}
        if (blob.indexOf(want) < 0) continue;
        var inner = null;
        try { inner = fe.contentDocument && fe.contentDocument.querySelector('video'); } catch (eI) {}
        if (inner) {
          pinnedHit = { v: inner, src: String(inner.currentSrc || inner.src || ''), score: 1 };
          break;
        }
      }
    }
  }
  var hit = pinnedHit || playing || first;
  if (want && !pinnedHit) zeClearPinnedMid();
  if (hit && hit.v) zePinVideo(hit.v);
  return hit;
}

function zeHostBox(el){
  try {
    var w = el && el.ownerDocument && el.ownerDocument.defaultView;
    for (var g = 0; w && g < 8; g++) {
      var fe = null;
      try { fe = w.frameElement; } catch (e) {}
      if (fe) {
        var box = null;
        try { box = fe.closest && fe.closest('.ans-attach-ct, .moduleDiv'); } catch (e2) {}
        if (box) return box;
      }
      try {
        if (!w.parent || w === w.top) break;
        w = w.parent;
      } catch (e3) { break; }
    }
  } catch (e4) {}
  try { return el && el.closest && el.closest('.ans-attach-ct, .moduleDiv'); } catch (e5) {}
  return null;
}

function zeVideoJobDone(v){
  var host = zeHostBox(v);
  if (!host) return false;
  var boxCls = String(host.className || '');
  if (/ans-job-finished/.test(boxCls)) return true;
  var icon = null;
  try { icon = host.querySelector('.ans-job-icon'); } catch (e0) {}
  var title = '';
  try { title = String((icon && (icon.getAttribute('title') || icon.getAttribute('aria-label') || icon.title)) || ''); } catch (e1) {}
  if (/任务点已完成/.test(title)) return true;
  if (/任务点未完成/.test(title)) return false;
  var icls = String((icon && icon.className) || '');
  return /ans-job-icon-finish|ans-job-done/.test(icls);
}

function zeTickOf(v, src){
  if (!v) return { hasVideo: false, current: 0, duration: 0, paused: true, ended: false, ready: 0, src: '', jobDone: false };
  return {
    hasVideo: true,
    current: Number(v.currentTime) || 0,
    duration: zeDur(v),
    paused: !!v.paused,
    ended: !!v.ended,
    ready: v.readyState || 0,
    src: String(src || v.currentSrc || v.src || ''),
    jobDone: zeVideoJobDone(v),
    ts: Date.now()
  };
}

function collectSteps(doc){
  var out = [];
  var seen = [];
  function kindOf(label){
    var isVideo = /视频|直播/.test(label) && !/测验/.test(label);
    var isQuiz = /测验|考试|作业/.test(label);
    var isDoc = /文档|PPT|阅读|图文|资料/.test(label);
    return { isVideo: isVideo, isQuiz: isQuiz, isDoc: isDoc };
  }
  function isActive(el){
    var cls = ' ' + String((el && el.className) || '') + ' ';
    return /(^|\s)(currents|current|active|selected)(\s|$)/.test(cls)
      || String((el && el.getAttribute && el.getAttribute('aria-selected')) || '') === 'true';
  }
  function zeJobDone(box, icon){
    var boxCls = String((box && box.className) || '');
    if (/ans-job-finished/.test(boxCls)) return true;
    var title = '';
    try {
      title = String((icon && (icon.getAttribute('title') || icon.getAttribute('aria-label') || icon.title)) || '');
    } catch (eT) {}
    if (/任务点已完成/.test(title)) return true;
    if (/任务点未完成/.test(title)) return false;
    var icls = String((icon && icon.className) || '');
    if (/ans-job-icon-finish|ans-job-done/.test(icls)) return true;
    return false;
  }
  function add(el, label, kind, done, mid, jobid){
    if (!el) return;
    for (var i = 0; i < seen.length; i++) if (seen[i] === el) return;
    seen.push(el);
    out.push({
      el: el, label: label, video: !!kind.isVideo, quiz: !!kind.isQuiz, doc: !!kind.isDoc,
      active: isActive(el), jobDone: done, mid: mid || '', jobid: jobid || ''
    });
  }
  function takeNodes(nodes){
    var icons = doc.querySelectorAll('.ans-attach-ct .ans-job-icon, .moduleDiv .ans-job-icon');
    var videoIcons = [];
    for (var i = 0; i < icons.length; i++) {
      var icEl = icons[i];
      if (icEl.closest && icEl.closest('#coursetree, .coursetree')) continue;
      if (/ans-job-video/.test(String(icEl.className || ''))) videoIcons.push(icEl);
    }
    var videoOrd = 0;
    for (var n = 0; n < nodes.length; n++) {
      var el = nodes[n];
      if (el && el.closest && el.closest('#coursetree, .coursetree')) continue;
      var label = String((el && (el.getAttribute('title') || el.textContent)) || '').replace(/\s+/g, ' ').trim();
      if (!label || label.length > 24) continue;
      var kind = kindOf(label);
      if (!kind.isVideo && !kind.isQuiz && !kind.isDoc) continue;
      var icon = el.querySelector && el.querySelector('.ans-job-icon');
      var host = null;
      try { host = el.closest && el.closest('.ans-attach-ct, .moduleDiv'); } catch (eH) {}
      var done = zeJobDone(host || el, icon);
      if (kind.isVideo) {
        videoOrd += 1;
        if (!done && videoIcons[videoOrd - 1]) {
          var ic = videoIcons[videoOrd - 1];
          var icHost = null;
          try { icHost = ic.closest && ic.closest('.ans-attach-ct, .moduleDiv'); } catch (eI) {}
          done = zeJobDone(icHost || ic, ic);
        }
      }
      add(el, label, kind, done, String((el.getAttribute && (el.getAttribute('mid') || el.getAttribute('data-mid'))) || ''), String((el.getAttribute && (el.getAttribute('jobid') || el.getAttribute('data-jobid'))) || ''));
    }
  }
  takeNodes(doc.querySelectorAll([
    '.tabtags a', '.tabtags span', '.tabtags li', '.tabtags p', '.tabtags div',
    '.prevTabs a', '.prevTabs span', '.prevTabs li',
    '.switchTab a', '.switchTab span',
    '.prev_ul .prev_title', '.prev_ul .prev_white',
    '#dct a', '#dct span', '#dct li', '#dct p',
    '.attachment-tabs .item', '.tab-list .tab-item', '.prevNext .prev_title'
  ].join(',')));
  if (out.length) return out;
  var titles = doc.querySelectorAll('.prev_title, .prev_white');
  if (titles.length > 1) takeNodes(titles);
  if (out.length) return out;
  var boxes = doc.querySelectorAll('.ans-attach-ct');
  if (!boxes.length) boxes = doc.querySelectorAll('.moduleDiv');
  for (var b = 0; b < boxes.length; b++) {
    var box = boxes[b];
    var iframe = box.querySelector && box.querySelector('iframe');
    var src = iframe ? String(iframe.src || iframe.getAttribute('src') || '') : '';
    var html = String(box.className || '');
    var v = !!box.querySelector('video')
      || /insertvideo|modules\/video/.test(src)
      || /insertvideo|videoContainer|ans-job-video/.test(html);
    var q = /doHomeWork|inserthomework|\/work\/|modules\/work|quiz|exam/.test(src)
      || /ans-job-work|work-module|insertwork/.test(html);
    var d = /pdf|document|innerbook|insertdoc/.test(src) || /insertdoc/.test(html);
    if (!v && !q && !d) continue;
    var r = null;
    try { r = box.getBoundingClientRect(); } catch (e0) {}
    if (r && (r.width < 2 || r.height < 2)) continue;
    var playing = false;
    try {
      var nested = null;
      if (iframe) {
        try { nested = iframe.contentDocument && iframe.contentDocument.querySelector('video'); } catch (eN) {}
      }
      if (!nested) nested = box.querySelector('video');
      playing = !!(nested && nested.paused === false);
    } catch (e) {}
    var ic = box.querySelector && box.querySelector('.ans-job-icon');
    var mid = '';
    var jobid = '';
    try {
      if (iframe) {
        mid = String(iframe.getAttribute('mid') || iframe.getAttribute('data-mid') || '');
        jobid = String(iframe.getAttribute('jobid') || iframe.getAttribute('data-jobid') || '');
      }
      if (!mid) {
        var mm = src.match(/[?&]mid=([^&]+)/i);
        if (mm) mid = decodeURIComponent(mm[1]);
      }
    } catch (e2) {}
    add(
      box,
      v ? ('视频' + (out.filter(function(s){ return s.video; }).length + 1)) : (q ? '测验' : '文档'),
      { isVideo: v, isQuiz: q, isDoc: d },
      zeJobDone(box, ic),
      mid,
      jobid
    );
    if (playing) out[out.length - 1].active = true;
  }
  return out;
}

function clickTarget(el){
  if (!el) return null;
  var prefer = el;
  try {
    var play = el.querySelector && el.querySelector('.vjs-big-play-button, .vjs-poster, .vjs-play-control.vjs-paused, video');
    var iframe = el.querySelector && el.querySelector('iframe');
    var child = null;
    try { child = iframe && iframe.contentDocument; } catch (eC) {}
    if (!play && child) {
      play = child.querySelector('.vjs-big-play-button, .vjs-poster, .vjs-play-control.vjs-paused, video');
    }
    var icon = el.querySelector && el.querySelector('.ans-job-icon');
    var tab = el.querySelector && el.querySelector('a, button, .prev_title, .posCatalog_name');
    if (play) prefer = play;
    else if (iframe) prefer = iframe;
    else if (icon) prefer = icon;
    else if (tab && !iframe) prefer = tab;
  } catch (e) {}
  return boxOf(prefer);
}

function tabClickTarget(el){
  if (!el) return null;
  var prefer = el;
  try {
    var iframe = el.querySelector && el.querySelector('iframe');
    var icon = el.querySelector && el.querySelector('.ans-job-icon');
    var tab = el.querySelector && el.querySelector('a, button, .prev_title, .prev_white, .posCatalog_name');
    if (tab && !iframe) prefer = tab;
    else if (icon) prefer = icon;
  } catch (e) {}
  return boxOf(prefer);
}

function collectAllSteps(){
  function hrefOf(winOrDoc){
    try {
      if (winOrDoc && winOrDoc.location) return String(winOrDoc.location.href || '');
      if (winOrDoc && winOrDoc.defaultView && winOrDoc.defaultView.location) {
        return String(winOrDoc.defaultView.location.href || '');
      }
    } catch (e) {}
    return '';
  }
  function idFromHref(href){
    return zeChapterId(href);
  }
  function currentChapterId(){
    var href = hrefOf(window);
    try { href = hrefOf(window.top) || href; } catch (e) {}
    return idFromHref(href);
  }
  function skipIframe(iframe){
    var src = '';
    try { src = String(iframe.src || iframe.getAttribute('src') || ''); } catch (e) {}
    if (/insertvideo|modules\/video|ananas\/modules\/video|\/work\/|doHomeWork|insertdoc|innerbook|insertbook/.test(src)) return true;
    if (/knowledge\/cards/.test(src)) return false;
    var wantId = currentChapterId();
    var fid = idFromHref(src);
    if (!fid) {
      try { fid = idFromHref(hrefOf(iframe.contentWindow)); } catch (eW) {}
    }
    if (!fid) {
      try { fid = idFromHref(hrefOf(iframe.contentDocument)); } catch (eD) {}
    }
    if (wantId && fid && fid !== wantId) return true;
    return false;
  }
  function docs(doc, depth){
    var out = [];
    if (!doc || (depth || 0) > 6) return out;
    out.push(doc);
    var list = [];
    try { list = doc.querySelectorAll('iframe'); } catch (e) { return out; }
    for (var i = 0; i < list.length; i++) {
      if (skipIframe(list[i])) continue;
      var child = null;
      try { child = list[i].contentDocument; } catch (e2) {}
      if (child) out = out.concat(docs(child, (depth || 0) + 1));
    }
    return out;
  }
  var root = document;
  try { if (window.top && window.top.document) root = window.top.document; } catch (eR) {}
  var all = docs(root, 0);
  var topPart = [];
  var contentPart = [];
  var matchedPart = [];
  var seenEl = [];
  var wantId = currentChapterId();
  function take(part, bucket){
    for (var b = 0; b < part.length; b++) {
      var el = part[b].el;
      var dup = false;
      for (var s = 0; s < seenEl.length; s++) if (seenEl[s] === el) { dup = true; break; }
      if (dup) continue;
      if (el) seenEl.push(el);
      bucket.push(part[b]);
    }
  }
  for (var a = 0; a < all.length; a++) {
    var part = collectSteps(all[a]);
    if (all[a] === root) {
      take(part, topPart);
      continue;
    }
    var docId = idFromHref(hrefOf(all[a]));
    if (wantId && docId && docId !== wantId) continue;
    if (wantId && docId && docId === wantId) take(part, matchedPart);
    else take(part, contentPart);
  }
  if (matchedPart.length) return matchedPart;
  if (contentPart.length) return contentPart;
  if (topPart.length) return topPart;
  if (wantId && all.length > 1) return [];
  return collectSteps(root);
}

function __cxFindChapterEl(doc, title, chapterId){
  var wantRaw = __cxClean(title);
  var wantId = String(chapterId || '').replace(/\D/g, '');
  var wantIndex = (wantRaw.match(/^(\d+(?:\.\d+)+)\b/) || [])[1] || '';
  var want = wantRaw.replace(/^\d+(?:\.\d+)+\s*/, '').replace(/[（(]\s*\d+\s*[）)]\s*$/g, '').trim();
  function labelOf(el){
    return String((el.getAttribute && el.getAttribute('title')) || el.textContent || '').replace(/\s+/g, ' ').trim();
  }
  function cleanTitle(t){
    return String(t || '')
      .replace(/^\d+(?:\.\d+)+\s*/, '')
      .replace(/[（(]\s*\d+\s*[）)]\s*$/g, '')
      .replace(/\s+\d{1,2}$/g, '')
      .trim();
  }
  function targetOf(el){
    if (!el) return null;
    if (el.querySelector) return el.querySelector('.posCatalog_name, .catalog_name, .posCatalog_title, a.clicktitle, a') || el;
    return el;
  }
  if (wantId) {
    var byId = null;
    try { byId = doc.getElementById('cur' + wantId) || doc.getElementById(wantId); } catch (eId) {}
    if (!byId) {
      var idNodes = [];
      try { idNodes = doc.querySelectorAll('#coursetree .posCatalog_select, a.clicktitle, .catalog_title, a[href*="chapterId"], a[href*="knowledgeid"]'); } catch (eN) {}
      for (var n = 0; n < idNodes.length; n++) {
        var html = '';
        try { html = idNodes[n].outerHTML || ''; } catch (e) {}
        var click = String(idNodes[n].getAttribute && idNodes[n].getAttribute('onclick') || '');
        if (html.indexOf('cur' + wantId) >= 0 || (/chapterId=/.test(html) && html.indexOf(wantId) >= 0) || (click.indexOf(wantId) >= 0 && /getTeacherAjax/.test(click))) {
          byId = idNodes[n];
          break;
        }
      }
    }
    if (byId) return targetOf(byId);
  }
  var prefer = [];
  try { prefer = doc.querySelectorAll('#coursetree .posCatalog_select .posCatalog_name, #coursetree .posCatalog_name'); } catch (eP) {}
  var nodes = prefer.length
    ? prefer
    : (function(){ try { return doc.querySelectorAll('a.clicktitle, .posCatalog_name, .catalog_name, a.chapter_item, .catalog_name a, .chapter_Td a, .catalog_title a, .catalog_title, li.chapter a'); } catch (eQ) { return []; } })();
  var exactIndex = null, exact = null, fuzzy = null;
  var wantBare = cleanTitle(want);
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var nodeTitle = labelOf(el);
    var bar = el.querySelector ? el.querySelector('.posCatalog_sbar') : null;
    var index = (bar ? String(bar.textContent || '').replace(/\s+/g, ' ').trim() : '') || ((nodeTitle.match(/^(\d+(?:\.\d+)+)\b/) || [])[1] || '');
    if (!nodeTitle && !index) continue;
    if (/资料|讨论|问卷/.test(nodeTitle) && !index) continue;
    if (wantIndex && index === wantIndex && !exactIndex) exactIndex = el;
    var bare = cleanTitle(nodeTitle) || index;
    if (wantIndex && index && wantIndex !== index) continue;
    if (wantBare && bare === wantBare && !exact) exact = el;
    else if (!wantIndex && wantBare && !fuzzy && (bare.indexOf(wantBare) >= 0 || wantBare.indexOf(bare) >= 0)) fuzzy = el;
  }
  var hit = exactIndex || exact || fuzzy;
  return targetOf(hit);
}

function zeInstallStudyApi(win){
  if (!win) return;
  try {
    win.__zeFindVideo = zeFindVideo;
    win.__zeTickOf = zeTickOf;
    win.__zePinVideo = zePinVideo;
    win.__zePinMid = zePinMid;
    win.__zeClearPinnedVideo = zeClearPinnedVideo;
    win.__zeClearPinnedMid = zeClearPinnedMid;
    win.__zeGetPinnedMid = zePinnedMid;
    win.__zeMidOfVideo = zeMidOfVideo;
    win.__zeDur = zeDur;
    win.__zeVideoJobDone = zeVideoJobDone;
    win.__zeHostBox = zeHostBox;
    win.__zeDocs = zeDocs;
    win.__zeBoxOf = boxOf;
    win.__zePierceClick = zePierceClick;
    win.__zeControlVideo = zeControlVideo;
    win.__zeCollectSteps = collectSteps;
    win.__zeCollectAllSteps = collectAllSteps;
    win.__cxFindChapterEl = __cxFindChapterEl;
    win.__cxClean = __cxClean;
    win.__zeStudyReady = 7;
  } catch (e) {}
}
try {
  var __zeRoot = (typeof window !== 'undefined' && window) || (typeof globalThis !== 'undefined' && globalThis);
  zeInstallStudyApi(__zeRoot);
  try { if (__zeRoot && __zeRoot.top) zeInstallStudyApi(__zeRoot.top); } catch (eTop) {}
} catch (eInstall) {}
