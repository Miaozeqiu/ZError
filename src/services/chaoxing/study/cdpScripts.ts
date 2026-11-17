/** 刷课页内脚本。认节 / 任务点 / 播放器在宿主 `chaoxing/host/study/`。 */
import {
  studyHelpersSource,
  studyLocateScript,
  studyPageScript,
  studyTickScript,
} from '../host/studyHost'

/** 测试用：helpers 里的 collectSteps / boxOf。 */
export const COLLECT_STEPS = studyHelpersSource()

export const LOCATE_STUDY_PLAY = () => studyLocateScript({ kind: 'control', name: 'play' })
export const LOCATE_STUDY_VIDEO_TAB = () => studyLocateScript({ kind: 'control', name: 'video-tab' })
export const LOCATE_CHAPTER_TAB = () => studyLocateScript({ kind: 'control', name: 'chapter-tab' })
export const LOCATE_NEXT_STEP = () => studyLocateScript({ kind: 'control', name: 'next' })
export const LOCATE_CHAPTER = (title: string, chapterId = '') => (
  studyLocateScript({ kind: 'chapter', title, chapterId })
)
export const LOCATE_STUDY_STEP = (want: {
  label?: string
  mid?: string
  jobid?: string
  videoIndex?: number
  index?: number
}) => studyLocateScript({
  kind: 'step',
  label: want?.label,
  mid: want?.mid,
  jobid: want?.jobid,
  videoIndex: want?.videoIndex,
  index: want?.index,
})

export const READ_VIDEO_TICK = () => studyTickScript(`
  var hit = zeFindVideo();
  if (!hit) return { hasVideo: false, current: 0, duration: 0, paused: true, ended: false, ready: 0, src: '' };
  return zeTickOf(hit.v, hit.src);
`)

export const NUDGE_VIDEO_PLAY = () => studyTickScript(`
  if (typeof zeControlVideo === 'function') return zeControlVideo('play');
  return { ok: false, hasVideo: false };
`)

export const NUDGE_VIDEO_PAUSE = () => studyTickScript(`
  if (typeof zeControlVideo === 'function') return zeControlVideo('pause');
  return { ok: false, hasVideo: false };
`)

export const READ_STUDY_PLAYER = () => studyTickScript(`
  var href = location.href || '';
  try { href = String((window.top && window.top.location && window.top.location.href) || href); } catch (eH) {}
  var path = '';
  try { path = String(new URL(href).pathname || ''); } catch (eP) { path = location.pathname || ''; }
  var page = 'other';
  if (/passport2/.test(href) || /\\/login/.test(path)) page = 'login';
  else if (/studentstudy/.test(href)) page = 'player';
  else if (/\\/studentcourse/.test(path)) page = 'chapters';
  else if (/\\/mycourse\\/stu/.test(path)) page = 'student';
  var chapterId = '';
  try { chapterId = new URL(href).searchParams.get('chapterId') || new URL(href).searchParams.get('chapterid') || new URL(href).searchParams.get('knowledgeid') || ''; } catch (e) {}
  var vHit = zeFindVideo();
  var v = vHit && vHit.v ? vHit.v : null;
  if (v) zePinVideo(v);
  var jobDone = null;
  var rawSteps = collectAllSteps();
  var videoMid = v ? zeMidOfVideo(v) : '';
  var owner = null;
  if (v) {
    var host = zeHostBox(v);
    if (host) {
      for (var oi = 0; oi < rawSteps.length; oi++) {
        if (!rawSteps[oi].video) continue;
        var el = rawSteps[oi].el;
        if (el === host || (el && el.contains && (el.contains(host) || host.contains(el)))) {
          owner = rawSteps[oi];
          break;
        }
      }
    }
    if (!owner && videoMid) {
      for (var om = 0; om < rawSteps.length; om++) {
        if (rawSteps[om].video && rawSteps[om].mid && rawSteps[om].mid === videoMid) {
          owner = rawSteps[om];
          break;
        }
      }
    }
  }
  if (owner) {
    for (var oa = 0; oa < rawSteps.length; oa++) {
      if (rawSteps[oa].video) rawSteps[oa].active = (rawSteps[oa] === owner);
    }
    if (owner.mid) {
      videoMid = owner.mid;
      zePinMid(owner.mid);
    }
  }
  var steps = rawSteps.map(function(item){
    return {
      label: item.label, video: item.video, quiz: item.quiz, doc: item.doc,
      active: item.active, jobDone: item.jobDone, mid: item.mid || '', jobid: item.jobid || ''
    };
  });
  var videoCount = 0, videoIndex = 0, listedIdx = -1, moreVideos = false;
  for (var i = 0; i < steps.length; i++) {
    if (steps[i].active) listedIdx = i;
    if (steps[i].video) {
      videoCount += 1;
      if (steps[i].active) videoIndex = videoCount;
    }
  }
  for (var k = listedIdx + 1; k < steps.length; k++) {
    if (steps[k].video && steps[k].jobDone !== true) { moreVideos = true; break; }
  }
  var stepEl = document.querySelector('.prev_title');
  var step = stepEl ? String(stepEl.getAttribute('title') || stepEl.textContent || '').replace(/\\s+/g, ' ').trim() : '';
  if (!step && listedIdx >= 0) step = steps[listedIdx].label;
  var current = '';
  try {
    var name = document.querySelector('#coursetree .posCatalog_active .posCatalog_name');
    current = String((name && (name.getAttribute('title') || name.textContent)) || '').replace(/\\s+/g, ' ').trim();
  } catch (e) {}
  return {
    page: page,
    chapterId: chapterId,
    step: step,
    quiz: (listedIdx >= 0 && steps[listedIdx].quiz)
      || (!videoCount && /^(测验|考试|作业)\\b/.test(step)),
    jobDone: owner ? owner.jobDone === true : jobDone,
    steps: steps,
    videoCount: videoCount,
    videoIndex: videoIndex,
    videoMid: videoMid,
    moreVideos: moreVideos,
    current: current,
    hasVideo: !!v,
    paused: v ? !!v.paused : true,
    ended: v ? !!v.ended : false,
    currentTime: v ? Number(v.currentTime) || 0 : 0,
    duration: v ? zeDur(v) : 0,
    tabCount: steps.length,
    jobs: steps.map(function(item){
      return {
        label: item.label,
        kind: item.video ? 'video' : item.quiz ? 'quiz' : 'doc',
        video: !!item.video,
        quiz: !!item.quiz,
        doc: !!item.doc,
        mid: item.mid || '',
        jobid: item.jobid || '',
        jobDone: item.jobDone === true,
        passed: item.jobDone === true,
        unfinished: item.jobDone !== true,
        active: !!item.active
      };
    })
  };
`)

export const READ_STUDY_LIVE = () => studyTickScript(`
  var href = location.href || '';
  try { href = String((window.top && window.top.location && window.top.location.href) || href); } catch (eH) {}
  var chapterId = '';
  try { chapterId = new URL(href).searchParams.get('chapterId') || new URL(href).searchParams.get('chapterid') || new URL(href).searchParams.get('knowledgeid') || ''; } catch (e) {}
  var vHit = zeFindVideo();
  var v = vHit && vHit.v ? vHit.v : null;
  if (v) zePinVideo(v);
  var current = '';
  try {
    var name = document.querySelector('#coursetree .posCatalog_active .posCatalog_name');
    current = String((name && (name.getAttribute('title') || name.textContent)) || '').replace(/\\s+/g, ' ').trim();
  } catch (eC) {}
  var activeLabel = '';
  try {
    var tab = document.querySelector('.tabtags .currents, .prev_title.currents, .prev_ul .currents');
    activeLabel = String((tab && (tab.getAttribute('title') || tab.textContent)) || '').replace(/\\s+/g, ' ').trim();
  } catch (eT) {}
  return {
    live: true,
    chapterId: chapterId,
    current: current,
    step: activeLabel,
    videoMid: v ? zeMidOfVideo(v) : '',
    hasVideo: !!v,
    paused: v ? !!v.paused : true,
    ended: v ? !!v.ended : false,
    currentTime: v ? Number(v.currentTime) || 0 : 0,
    duration: v ? zeDur(v) : 0,
    jobDone: v ? zeVideoJobDone(v) : false,
    jobs: []
  };
`)

export const READ_CAPTCHA = () => `(function(){
  var hit = document.querySelector('#ucode, .yzmInp, form[action*="processVerify"], img[src*="processVerify"], #ccc');
  var t = ((document.body && document.body.innerText) || '');
  return { captcha: !!(hit || /请输入图片中的验证码|【\\s*9010\\s*】|processVerify/.test(t)) };
})()`

export const READ_CAPTCHA_SRC = () => `(function(){
  var img = document.querySelector('#ccc, .yzmImg img, img[src*="processVerify"]');
  return { src: img ? String(img.src || '') : '' };
})()`

export const LOCATE_CAPTCHA_INPUT = () => `(function(){
  var el = document.querySelector('#ucode, .yzmInp, input[name="ucode"]');
  if (!el) return { found: false };
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
  var r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return { found: false };
  return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2, text: 'ucode' };
})()`

export const LOCATE_CAPTCHA_SUBMIT = () => `(function(){
  var el = document.querySelector('input.submit, input[type="submit"], button[type="submit"], .submit');
  if (!el) return { found: false };
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
  var r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return { found: false };
  return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2, text: 'submit' };
})()`

export const LOCATE_CAPTCHA_IMG = () => `(function(){
  var el = document.querySelector('#ccc, .yzmImg img, img[src*="processVerify"]');
  if (!el) return { found: false };
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
  var r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return { found: false };
  return { found: true, x: r.left + r.width / 2, y: r.top + r.height / 2, text: 'captcha' };
})()`

export const READ_CATALOG_READY = () => `(function(){
  function pierce(doc, href, depth, out){
    if (!doc || (depth || 0) > 6) return;
    var catalogLi = 0;
    try {
      catalogLi = doc.querySelectorAll('#coursetree .posCatalog_select, .catalog_title, a.clicktitle, .posCatalog_name, .chapter_item').length;
    } catch (e2) {}
    var sample = '';
    var hasProgress = false;
    try {
      var head = doc.querySelector('.jobCompleteness, .chapter_head, #_studystate');
      sample = head ? String(head.textContent || head.value || '').replace(/\\s+/g, ' ').trim().slice(0, 80) : '';
      hasProgress = /已完成任务点|unfinishCount/.test(sample);
    } catch (eP) {}
    out.push({
      href: href || '',
      onCatalog: hasProgress || catalogLi > 0,
      hasProgress: hasProgress,
      hasDir: catalogLi > 0,
      catalogLi: catalogLi,
      sample: sample
    });
    var list = [];
    try { list = doc.querySelectorAll('iframe'); } catch (e3) { return; }
    for (var i = 0; i < list.length; i++) {
      var child = null;
      var src = '';
      try { src = String(list[i].src || ''); } catch (e4) {}
      if (/ananas|insertvideo|modules\\/video|modules\\/work|doHomeWork|bbscircle|insertbbs|about:blank/i.test(src)) continue;
      try { child = list[i].contentDocument; } catch (e5) {}
      if (!child) continue;
      var childHref = src;
      try { childHref = String((child.defaultView && child.defaultView.location && child.defaultView.location.href) || src); } catch (e6) {}
      pierce(child, childHref, (depth || 0) + 1, out);
    }
  }
  var rows = [];
  pierce(document, location.href || '', 0, rows);
  var best = null;
  for (var r = 0; r < rows.length; r++) {
    if (!best
      || rows[r].catalogLi > best.catalogLi
      || (rows[r].hasProgress && !best.hasProgress)
      || (rows[r].onCatalog && !best.onCatalog)) best = rows[r];
  }
  best = best || { href: location.href || '', onCatalog: false, hasProgress: false, hasDir: false, catalogLi: 0, sample: '' };
  return {
    ok: true,
    href: best.href,
    url: best.href,
    onCatalog: best.onCatalog,
    hasProgress: best.hasProgress,
    hasDir: best.hasDir,
    catalogLi: best.catalogLi,
    sample: best.sample,
    pierced: rows.length
  };
})()`

/** 目录只抽节点，不拷 innerText / outerHTML。 */
export const READ_CATALOG_SLIM = () => `(function(){
  function clean(s){ return String(s || '').replace(/\\s+/g, ' ').trim(); }
  function catalogIndex(t){
    var m = clean(t).match(/^(\\d+(?:\\.\\d+)+)\\b/);
    return m ? m[1] : '';
  }
  function nodeId(box){
    var id = String((box && box.id) || '');
    if (id.indexOf('cur') === 0) return id.slice(3);
    if (/^\\d{5,}$/.test(id)) return id;
    try {
      var click = String(box.getAttribute('onclick') || '');
      var hit = click.match(/getTeacherAjax\\s*\\(\\s*['"]\\d+['"]\\s*,\\s*['"]\\d+['"]\\s*,\\s*['"](\\d+)['"]/i);
      if (hit) return hit[1];
    } catch (e) {}
    return '';
  }
  function ownJobs(box){
    if (!box) return 0;
    var kids = box.children || [];
    for (var i = 0; i < kids.length; i++) {
      if (kids[i] && /jobUnfinishCount/.test(String(kids[i].className || ''))) {
        var n = parseInt(kids[i].value || kids[i].getAttribute('value') || kids[i].textContent || '', 10);
        if (isFinite(n) && n >= 0) return n;
      }
    }
    var oranges = [];
    try { oranges = box.querySelectorAll('.orangeNew'); } catch (e0) {}
    for (var o = 0; o < oranges.length; o++) {
      var wrap = oranges[o].closest ? oranges[o].closest('.posCatalog_select') : null;
      if (wrap && wrap !== box) continue;
      var v = parseInt(clean(oranges[o].textContent || ''), 10);
      if (isFinite(v) && v >= 0) return v;
    }
    return 0;
  }
  function progressOf(doc){
    try {
      var st = doc.querySelector('#_studystate');
      var raw = st ? String(st.value || st.getAttribute('value') || '') : '';
      var uh = raw.match(/unfinishCount\\s*:\\s*(\\d+)/);
      var dh = raw.match(/finishCount\\s*:\\s*(\\d+)/);
      if (uh && dh) return { done: parseInt(dh[1], 10), total: parseInt(dh[1], 10) + parseInt(uh[1], 10) };
    } catch (e0) {}
    var els = [];
    try { els = doc.querySelectorAll('.jobCompleteness, .chapter_head'); } catch (e1) {}
    for (var i = 0; i < els.length; i++) {
      var t = clean(els[i].textContent || '').slice(0, 80);
      var m = t.match(/已完成任务点\\s*[:：]?\\s*(\\d+)\\s*\\/\\s*(\\d+)/);
      if (m) return { done: parseInt(m[1], 10), total: parseInt(m[2], 10) };
    }
    return null;
  }
  function fromTree(doc){
    var tree = null;
    try { tree = doc.querySelector('#coursetree'); } catch (e) {}
    if (!tree) return [];
    var items = [];
    var nodes = [];
    try { nodes = tree.querySelectorAll('.posCatalog_select'); } catch (e2) { return []; }
    for (var i = 0; i < nodes.length && items.length < 240; i++) {
      var box = nodes[i];
      var isChapter = /firstLayer/.test(String(box.className || ''));
      var name = null;
      try { name = box.querySelector(isChapter ? '.posCatalog_title' : '.posCatalog_name'); } catch (e3) {}
      if (!name) continue;
      var raw = name.getAttribute('title') || name.textContent || '';
      var bar = name.querySelector && name.querySelector('.posCatalog_sbar');
      var index = bar ? clean(bar.textContent || '') : catalogIndex(raw);
      var title = clean(raw);
      if (index && title.indexOf(index) === 0) title = clean(title.slice(index.length));
      if (!title) title = index;
      if (!title) continue;
      var jobs = ownJobs(box);
      items.push({
        title: index && title !== index ? (index + ' ' + title) : title,
        index: index,
        kind: isChapter ? 'chapter' : 'section',
        jobs: jobs,
        unfinished: jobs > 0,
        active: /posCatalog_active/.test(String(box.className || '')),
        chapterId: nodeId(box)
      });
    }
    return items;
  }
  function fromLinks(doc){
    var items = [];
    var nodes = [];
    try { nodes = doc.querySelectorAll('a.clicktitle, .posCatalog_name, .catalog_title, a.chapter_item'); } catch (e) { return []; }
    for (var i = 0; i < nodes.length && items.length < 120; i++) {
      var el = nodes[i];
      var title = clean(el.getAttribute('title') || el.textContent || '');
      if (!title || title.length < 2) continue;
      var box = el.closest ? (el.closest('.posCatalog_select, .catalog_rep, li, .chapter_item') || el) : el;
      var jobs = ownJobs(box);
      items.push({
        title: title,
        index: catalogIndex(title),
        kind: 'section',
        jobs: jobs,
        unfinished: jobs > 0,
        active: /active|current/.test(String((box.className || '') + ' ' + (el.className || ''))),
        chapterId: nodeId(box)
      });
    }
    return items;
  }
  function scoreDoc(doc, href){
    var chapters = fromTree(doc);
    if (!chapters.length) chapters = fromLinks(doc);
    var catalogLi = 0;
    try { catalogLi = doc.querySelectorAll('#coursetree .posCatalog_select, .catalog_title, a.clicktitle, .posCatalog_name').length; } catch (e) {}
    var progress = progressOf(doc);
    var score = chapters.length * 10 + catalogLi + (progress ? 80 : 0);
    if (/studentcourse/i.test(href)) score += 40;
    if (/studentstudy/i.test(href)) score += 20;
    return { href: href || '', chapters: chapters, catalogLi: catalogLi, progress: progress, score: score };
  }
  function skipFrame(src){
    return /ananas|insertvideo|modules\\/video|modules\\/work|doHomeWork|bbscircle|insertbbs|about:blank/i.test(src || '');
  }
  function walk(doc, href, depth, out){
    if (!doc || (depth || 0) > 6) return;
    out.push(scoreDoc(doc, href || ''));
    if ((out[out.length - 1].chapters || []).length) return;
    var list = [];
    try { list = doc.querySelectorAll('iframe'); } catch (e) { return; }
    for (var i = 0; i < list.length; i++) {
      var src = '';
      try { src = String(list[i].src || ''); } catch (e2) {}
      if (skipFrame(src)) continue;
      var child = null;
      try { child = list[i].contentDocument; } catch (e3) {}
      if (!child) continue;
      var childHref = src;
      try { childHref = String((child.defaultView && child.defaultView.location && child.defaultView.location.href) || src); } catch (e4) {}
      walk(child, childHref, (depth || 0) + 1, out);
      if (out.length && (out[out.length - 1].chapters || []).length) return;
    }
  }
  var rows = [];
  walk(document, location.href || '', 0, rows);
  rows.sort(function(a, b){ return (b.score || 0) - (a.score || 0); });
  var best = rows[0] || { href: location.href || '', chapters: [], catalogLi: 0, progress: null, score: 0 };
  var chapters = best.chapters || [];
  var current = '';
  var unfinished = [];
  for (var c = 0; c < chapters.length; c++) {
    if (chapters[c].active) current = chapters[c].title;
    if (chapters[c].unfinished && chapters[c].kind !== 'chapter') unfinished.push(chapters[c].title);
  }
  return {
    ok: true,
    url: best.href,
    catalogLi: best.catalogLi || 0,
    hasProgress: !!best.progress,
    progress: best.progress,
    current: current,
    chapters: chapters,
    unfinished: unfinished,
    unfinishedCount: best.progress && best.progress.total > best.progress.done
      ? (best.progress.total - best.progress.done)
      : unfinished.length,
    text: unfinished.slice(0, 8).join('、'),
    html: '',
    pierced: rows.length,
    candidates: rows.slice(0, 5).map(function(r){
      return { url: r.href, catalogLi: r.catalogLi, hasProgress: !!r.progress, score: Math.round(r.score || 0), chapters: (r.chapters || []).length };
    })
  };
})()`
