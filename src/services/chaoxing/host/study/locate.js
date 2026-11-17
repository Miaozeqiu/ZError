// 刷课 · locate：用 helpers 的同一套实体找节 / 任务点 / 播放器。
function locate(handle){
  handle = handle || {};
  var kind = handle.kind;
  if (kind === 'chapter') return locateChapter(handle.title, handle.chapterId);
  if (kind === 'step') return locateStep(handle);
  if (kind === 'control' && handle.name === 'play') return locatePlay();
  if (kind === 'control' && handle.name === 'video-tab') return locateVideoTab();
  if (kind === 'control' && handle.name === 'chapter-tab') return locateChapterTab();
  if (kind === 'control' && handle.name === 'next') return locateNext();
  return { found: false };
}

function catalogDocs(){
  function hasCatalog(doc){
    try {
      return !!(doc.querySelector('#coursetree, .posCatalog_name, a.clicktitle, .catalog_title'));
    } catch (eH) { return false; }
  }
  function docsOf(root, depth, out){
    if (!root || (depth || 0) > 6) return;
    if (hasCatalog(root)) out.push(root);
    var list = [];
    try { list = root.querySelectorAll('iframe'); } catch (e) { return; }
    for (var i = 0; i < list.length; i++) {
      var child = null;
      try { child = list[i].contentDocument; } catch (e2) {}
      if (child) docsOf(child, (depth || 0) + 1, out);
    }
  }
  var root = document;
  try { if (window.top && window.top.document) root = window.top.document; } catch (eR) {}
  var docs = [];
  docsOf(root, 0, docs);
  if (!docs.length) docs.push(root);
  return docs;
}

function locateChapter(title, chapterId){
  var wantRaw = __cxClean(title);
  var wantId = String(chapterId || '').replace(/\D/g, '');
  var docs = catalogDocs();
  for (var d = 0; d < docs.length; d++) {
    var el = __cxFindChapterEl(docs[d], title, chapterId);
    var pos = boxOf(el);
    if (!pos) continue;
    var text = String((el.getAttribute && el.getAttribute('title')) || el.textContent || '').replace(/\s+/g, ' ').trim();
    return { found: true, ok: true, x: pos.x, y: pos.y, space: pos.space, text: text, via: wantId ? 'id' : 'click' };
  }
  var wantIndex = (wantRaw.match(/^(\d+(?:\.\d+)+)\b/) || [])[1] || '';
  var want = wantRaw.replace(/^\d+(?:\.\d+)+\s*/, '').replace(/[（(]\s*\d+\s*[）)]\s*$/g, '').trim();
  return { found: false, ok: false, error: '目录里没有「' + (want || wantIndex || wantId) + '」', want: want };
}

function locateChapterTab(){
  var root = document;
  try { if (window.top && window.top.document) root = window.top.document; } catch (eR) {}
  var sels = ['a[data-url*="studentcourse"]', '[data-url*="studentcourse"]', 'a[data-url*="/mycourse/studentcourse"]'];
  for (var s = 0; s < sels.length; s++) {
    var pos = boxOf(root.querySelector(sels[s]));
    if (pos) return { found: true, x: pos.x, y: pos.y, space: pos.space, text: '章节', via: sels[s] };
  }
  var nodes = root.querySelectorAll('a, [role="tab"], li, span');
  for (var i = 0; i < nodes.length; i++) {
    var t = String(nodes[i].getAttribute('title') || nodes[i].textContent || '').replace(/\s+/g, ' ').trim();
    if (t === '章节') {
      var hit = boxOf(nodes[i]);
      if (hit) return { found: true, x: hit.x, y: hit.y, space: hit.space, text: '章节', via: 'text' };
    }
  }
  return { found: false };
}

function locatePlay(){
  var hit = zeFindVideo();
  if (hit && hit.v) {
    var v = hit.v;
    var doc = v.ownerDocument;
    var btn = null;
    try {
      btn = doc && doc.querySelector('.vjs-big-play-button, button.vjs-big-play-button, .vjs-play-control.vjs-paused, .vjs-poster, video');
    } catch (e0) {}
    if (!btn) btn = v;
    var pos = boxOf(btn);
    if (pos) return { found: true, x: pos.x, y: pos.y, space: pos.space || 'page', text: 'play', via: 'pinned' };
  }
  var want = zePinnedMid();
  if (want) {
    var root = document;
    try { if (window.top && window.top.document) root = window.top.document; } catch (eR) {}
    var docs = zeDocs(root, 0, 0, 0);
    for (var i = 0; i < docs.length; i++) {
      var list = [];
      try { list = docs[i].doc.querySelectorAll('iframe'); } catch (eL) {}
      for (var j = 0; j < list.length; j++) {
        var fe = list[j];
        var blob = '';
        try { blob = String((fe.getAttribute('mid') || fe.getAttribute('data-mid') || '') + ' ' + (fe.src || fe.getAttribute('src') || '')); } catch (eB) {}
        if (blob.indexOf(want) < 0) continue;
        var pos2 = boxOf(fe);
        if (pos2) return { found: true, x: pos2.x, y: pos2.y, space: pos2.space || 'page', text: 'play', via: 'mid' };
      }
    }
  }
  return { found: false };
}

function locateVideoTab(){
  var steps = collectAllSteps();
  var videos = steps.filter(function(s){ return s.video; });
  var current = null;
  for (var i = 0; i < steps.length; i++) if (steps[i].active) { current = steps[i]; break; }
  if (current && current.quiz) current = null;
  if (current && current.video && current.jobDone !== true) {
    return { found: false, ok: true, already: true, step: current.label, videoCount: videos.length, jobDone: false };
  }
  var hit = null;
  var start = 0;
  if (current && current.video) {
    for (var s = 0; s < steps.length; s++) if (steps[s] === current) { start = s + 1; break; }
  }
  for (var k = start; k < steps.length; k++) {
    if (steps[k].video && steps[k].jobDone !== true) { hit = steps[k]; break; }
  }
  if (!hit) {
    for (var n = 0; n < steps.length; n++) {
      if (steps[n].video && steps[n].jobDone !== true) { hit = steps[n]; break; }
    }
  }
  if (!hit) {
    if (current && current.video && current.jobDone === true) {
      return { found: false, ok: false, done: true, step: current.label, videoCount: videos.length, error: '本节视频任务点已完成' };
    }
    for (var m = 0; m < steps.length; m++) if (steps[m].video) { hit = steps[m]; break; }
  }
  if (!hit) return { found: false, ok: false, step: current ? current.label : '', error: '没有视频标签', videoCount: videos.length };
  if (hit.active && hit.jobDone !== true) {
    return { found: false, ok: true, already: true, step: hit.label, videoCount: videos.length, jobDone: hit.jobDone === true };
  }
  var pos = clickTarget(hit.el);
  if (!pos) return { found: false, ok: false, step: hit.label, error: '任务点不在可视区' };
  return { found: true, ok: true, x: pos.x, y: pos.y, text: hit.label, step: hit.label, videoCount: videos.length, jobDone: hit.jobDone === true };
}

function locateStep(handle){
  var wantLabel = String(handle.label || '').trim();
  var wantMid = String(handle.mid || '').trim();
  var wantJobid = String(handle.jobid || '').trim();
  var wantVideoIndex = Number(handle.videoIndex) || 0;
  var wantStepIndex = Number(handle.index) || 0;
  var steps = collectAllSteps();
  if (!steps.length) return { found: false, ok: false, error: '没有任务点标签' };
  function blobOf(el){
    try {
      var iframe = el && el.querySelector && el.querySelector('iframe');
      return String((el && el.outerHTML) || '') + ' ' + String((iframe && (iframe.src || iframe.getAttribute('src'))) || '');
    } catch (e) { return ''; }
  }
  var hit = null;
  if (wantMid) {
    for (var a = 0; a < steps.length; a++) {
      if (blobOf(steps[a].el).indexOf(wantMid) >= 0) { hit = steps[a]; break; }
    }
  }
  if (!hit && wantJobid) {
    for (var b = 0; b < steps.length; b++) {
      if (blobOf(steps[b].el).indexOf(wantJobid) >= 0) { hit = steps[b]; break; }
    }
  }
  if (!hit && wantVideoIndex > 0) {
    var vo = 0;
    for (var c = 0; c < steps.length; c++) {
      if (!steps[c].video) continue;
      vo += 1;
      if (vo === wantVideoIndex) { hit = steps[c]; break; }
    }
  }
  if (hit && hit.quiz && wantVideoIndex > 0) {
    hit = null;
    var voFix = 0;
    for (var cf = 0; cf < steps.length; cf++) {
      if (!steps[cf].video) continue;
      voFix += 1;
      if (voFix === wantVideoIndex) { hit = steps[cf]; break; }
    }
    if (!hit) {
      for (var vf = 0; vf < steps.length; vf++) if (steps[vf].video) { hit = steps[vf]; break; }
    }
  }
  if (!hit && wantStepIndex > 0 && wantStepIndex <= steps.length) hit = steps[wantStepIndex - 1];
  if (!hit && wantLabel) {
    var videoOrd = 0;
    var generic = wantVideoIndex > 0 && /^视频\d*$/.test(wantLabel);
    for (var d = 0; d < steps.length; d++) {
      var label = String(steps[d].label || '');
      if (steps[d].video) videoOrd += 1;
      if (generic && label === '视频') continue;
      if (label === wantLabel || wantLabel === String(d + 1)) { hit = steps[d]; break; }
      if (steps[d].video && (wantLabel === String(videoOrd) || wantLabel === ('视频' + videoOrd) || wantLabel === ('视频 ' + videoOrd))) {
        hit = steps[d];
        break;
      }
    }
  }
  if (!hit && wantLabel && !(wantVideoIndex > 0)) {
    for (var e = 0; e < steps.length; e++) {
      if (String(steps[e].label || '').indexOf(wantLabel) >= 0 || wantLabel.indexOf(String(steps[e].label || '')) >= 0) {
        hit = steps[e];
        break;
      }
    }
  }
  if (!hit) {
    return {
      found: false, ok: false,
      error: '没有「' + (wantLabel || ('视频' + wantVideoIndex) || wantMid || '任务点') + '」',
      steps: steps.map(function(s){ return s.label; }),
      tabCount: steps.length,
      videoCount: steps.filter(function(s){ return s.video; }).length
    };
  }
  var videoOrdOut = 0;
  for (var o = 0; o < steps.length; o++) {
    if (!steps[o].video) continue;
    videoOrdOut += 1;
    if (steps[o] === hit) break;
  }
  if (hit.mid) {
    try { window.__zePinnedMid = hit.mid; } catch (eP0) {}
    try { if (window.top) window.top.__zePinnedMid = hit.mid; } catch (eP1) {}
  }
  try { window.__zePinnedVideo = null; } catch (eC0) {}
  try { if (window.top) window.top.__zePinnedVideo = null; } catch (eC1) {}
  if (hit.active) {
    return {
      found: false, ok: true, already: true, step: hit.label,
      video: !!hit.video, quiz: !!hit.quiz, doc: !!hit.doc,
      tabCount: steps.length,
      videoIndex: videoOrdOut || wantVideoIndex
    };
  }
  if (hit.quiz) {
    var qpos = tabClickTarget(hit.el);
    if (!qpos) return { found: false, ok: false, quiz: true, step: hit.label };
    return {
      found: true, ok: false, quiz: true, x: qpos.x, y: qpos.y, text: hit.label,
      step: hit.label, video: !!hit.video, doc: !!hit.doc, videoIndex: videoOrdOut || wantVideoIndex
    };
  }
  var hasPlayer = false;
  try {
    hasPlayer = !!(hit.el && (
      (hit.el.querySelector && (hit.el.querySelector('iframe') || hit.el.querySelector('video')))
    ));
  } catch (eH) {}
  var pos = (hit.video && hasPlayer) ? clickTarget(hit.el) : tabClickTarget(hit.el);
  if (!pos) return { found: false, ok: false, step: hit.label, error: '任务点不在可视区' };
  return {
    found: true, ok: true, x: pos.x, y: pos.y, text: hit.label, step: hit.label,
    video: !!hit.video, quiz: !!hit.quiz, doc: !!hit.doc,
    tabCount: steps.length,
    videoIndex: videoOrdOut || wantVideoIndex
  };
}

function locateNext(){
  var steps = collectAllSteps();
  var idx = -1;
  for (var i = 0; i < steps.length; i++) if (steps[i].active) { idx = i; break; }
  var videos = steps.filter(function(s){ return s.video; });
  for (var k = idx + 1; k < steps.length; k++) {
    if (steps[k].doc) continue;
    if (steps[k].video && steps[k].jobDone !== true) {
      var vpos = clickTarget(steps[k].el);
      if (!vpos) return { found: false, ok: false, step: steps[k].label, error: '任务点不在可视区' };
      return { found: true, ok: true, x: vpos.x, y: vpos.y, text: steps[k].label, step: steps[k].label, index: k, videoCount: videos.length, more: true, chapterDone: false };
    }
  }
  for (var q = idx + 1; q < steps.length; q++) {
    if (steps[q].quiz && steps[q].jobDone !== true) {
      var qpos = clickTarget(steps[q].el);
      if (!qpos) return { found: false, ok: false, quiz: true, step: steps[q].label, chapterDone: false, videoCount: videos.length };
      return { found: true, ok: false, quiz: true, x: qpos.x, y: qpos.y, text: steps[q].label, step: steps[q].label, chapterDone: false, videoCount: videos.length, opened: true };
    }
  }
  var nodes = document.querySelectorAll('a, button, span, div, li');
  for (var n = 0; n < nodes.length; n++) {
    var label = String(nodes[n].getAttribute('title') || nodes[n].textContent || '').replace(/\s+/g, ' ').trim();
    if (label === '下一个任务点' || label === '下一任务点' || label === '下一个视频') {
      var npos = boxOf(nodes[n]);
      if (npos) return { found: true, ok: true, x: npos.x, y: npos.y, text: label, step: label, more: true, chapterDone: false, videoCount: videos.length };
    }
  }
  return {
    found: false, ok: false, more: false,
    chapterDone: steps.length > 1,
    tabCount: steps.length,
    videoCount: videos.length,
    step: idx >= 0 ? steps[idx].label : ''
  };
}
