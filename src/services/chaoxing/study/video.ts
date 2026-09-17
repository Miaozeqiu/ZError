import { asObject, evalBrowserViewMain, evalBrowserViewMainIdle, evalBrowserViewMainNow, waitMs } from '../../browser/eval'
import { clickHomeworkBox } from '../homework/act'
import {
  LOCATE_STUDY_PLAY,
  LOCATE_STUDY_STEP,
  LOCATE_STUDY_VIDEO_TAB,
  NUDGE_VIDEO_PAUSE,
  NUDGE_VIDEO_PLAY,
  READ_CATALOG_SLIM,
  READ_STUDY_LIVE,
  READ_STUDY_PLAYER,
  READ_VIDEO_TICK,
} from './cdpScripts'
import { CAPTCHA_HINT, readChaoxingCaptcha } from './captcha'
import type { ChaoxingVideoInfo, ChaoxingVideoTick } from './types'

export const asVideoTick = (value: ChaoxingVideoTick | Record<string, unknown> | null | undefined): ChaoxingVideoTick | null => {
  if (!value || typeof value !== 'object') return null
  const rec = value as Record<string, unknown>
  if (!('current' in rec || 'duration' in rec || 'paused' in rec || 'ended' in rec || 'hasVideo' in rec)) {
    return null
  }
  const duration = Number(rec.duration) || 0
  const current = Number(rec.current) || 0
  return {
    current,
    duration,
    paused: Boolean(rec.paused),
    ended: Boolean(rec.ended),
    ready: Number(rec.ready) || 0,
    src: String(rec.src || ''),
    mid: String(rec.mid || ''),
    hasVideo: rec.hasVideo === true,
  }
}

/** 页内真读到播放器。空对象 / 探测失败不能当成 current=0。 */
export const videoTickHasPlayer = (tick: ChaoxingVideoTick | null | undefined) => {
  if (!tick) return false
  if (tick.ended) return true
  if (Number(tick.duration) > 1 || Number(tick.current) > 0.2) return true
  if (String(tick.src || '').trim()) return true
  return false
}

const tickLooksLikeVideo = (tick: ChaoxingVideoTick | null | undefined) => {
  if (!tick) return false
  const duration = Number(tick.duration) || 0
  const current = Number(tick.current) || 0
  const ready = Number((tick as { ready?: number }).ready) || 0
  const src = String((tick as { src?: string }).src || '')
  if (tick.ended) return false
  if (duration > 1) {
    if (current >= duration - 1.5) return false
    return true
  }
  // 嵌套 iframe 里常见 duration 未就绪（NaN）但已有 src / 进度
  if (src && (ready >= 1 || current > 0.2 || tick.paused === false)) return true
  return false
}

export const videoIsPlaying = (tick: ChaoxingVideoTick | Record<string, unknown> | null | undefined) => {
  if (!tick || typeof tick !== 'object') return false
  const raw = tick as Record<string, unknown>
  if (raw.playing === false) return false
  // paused 缺省不能当成在播：play() 刚调用或回执漏字段时会误报
  if (raw.paused !== false) return false
  const snap = asVideoTick(tick)
  return Boolean(tickLooksLikeVideo(snap) && snap && snap.paused === false)
}

/** play() 会立刻把 paused 打成 false，自动播放被拒后又弹回去。要隔一会再读。 */
const settlePlaying = async (id: string, tick: ChaoxingVideoTick | null) => {
  if (!videoIsPlaying(tick)) return { playing: false, tick }
  await waitMs(480)
  const again = asVideoTick(await readChaoxingVideoTick(id).catch(() => null))
  return { playing: videoIsPlaying(again), tick: again || tick }
}

/** 点开本节某个任务点（优先 videoIndex / mid，标签常重名） */
export const clickChaoxingStep = async (
  id: string,
  want: string | {
    label?: string
    mid?: string
    jobid?: string
    videoIndex?: number
    index?: number
  },
) => {
  const payload = typeof want === 'string' || typeof want === 'number'
    ? { label: String(want || '').trim() }
    : {
        label: String(want?.label || '').trim(),
        mid: String(want?.mid || '').trim(),
        jobid: String(want?.jobid || '').trim(),
        videoIndex: Number(want?.videoIndex) || 0,
        index: Number(want?.index) || 0,
      }
  if (!payload.label && !payload.mid && !payload.jobid && !payload.videoIndex && !payload.index) {
    return { ok: false, error: '缺少任务点' }
  }
  const cheapStep = asObject(await evalBrowserViewMainNow(id, `(function(){
    var want = ${JSON.stringify(payload.label)};
    var mid = ${JSON.stringify(payload.mid)};
    var videoIndex = ${payload.videoIndex || 0};
    function kindOf(label){
      return /视频|直播/.test(label) && !/测验/.test(label);
    }
    function walk(doc, depth){
      if (!doc || (depth || 0) > 4) return null;
      var nodes = [];
      try { nodes = doc.querySelectorAll('.tabtags a, .tabtags span, .tabtags li, .prev_title, .prev_white, #dct a'); } catch (e0) {}
      var nVideo = 0;
      for (var i = 0; i < nodes.length; i++) {
        var el = nodes[i];
        if (el.closest && el.closest('#coursetree')) continue;
        var t = String((el.getAttribute && el.getAttribute('title')) || el.textContent || '').replace(/\\s+/g, ' ').trim();
        if (!t || t.length > 24) continue;
        var id = '';
        try { id = String(el.getAttribute('mid') || el.getAttribute('data-mid') || ''); } catch (e1) {}
        if (kindOf(t)) nVideo += 1;
        var hit = (mid && id && id === mid) || (want && t && (t === want || t.indexOf(want) >= 0)) || (videoIndex > 0 && kindOf(t) && nVideo === videoIndex);
        if (!hit) continue;
        var on = /currents|current|active/.test(String(el.className || ''));
        if (!on) { try { el.click(); } catch (e2) {} }
        return { ok: true, already: on, found: !on, text: t, via: 'cheap' };
      }
      var boxes = [];
      try { boxes = doc.querySelectorAll('.ans-attach-ct, .moduleDiv'); } catch (eB) {}
      var nBoxVideo = 0;
      for (var b = 0; b < boxes.length; b++) {
        var box = boxes[b];
        var iframe = null;
        try { iframe = box.querySelector('iframe'); } catch (eI) {}
        var bsrc = '';
        try { bsrc = iframe ? String(iframe.getAttribute('src') || iframe.src || '') : ''; } catch (eS2) {}
        var bmid = '';
        try {
          bmid = String((iframe && (iframe.getAttribute('mid') || iframe.getAttribute('data-mid'))) || (box.getAttribute && (box.getAttribute('mid') || box.getAttribute('data-mid'))) || '');
        } catch (eM) {}
        var isVideo = /modules\\/video|insertvideo|videoContainer/.test(bsrc + ' ' + String(box.className || ''));
        if (!isVideo) continue;
        nBoxVideo += 1;
        var hitBox = (mid && bmid && bmid === mid) || (videoIndex > 0 && nBoxVideo === videoIndex) || (want && want === ('视频' + nBoxVideo));
        if (!hitBox) continue;
        try { box.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (eV) {}
        var inner = null;
        try { inner = iframe && iframe.contentDocument; } catch (eC) {}
        var btn = null;
        try { btn = inner && inner.querySelector('.vjs-big-play-button, .vjs-poster, .vjs-play-control.vjs-paused, video'); } catch (eP) {}
        try { (btn || box).click(); } catch (eK) {}
        return { ok: true, already: false, found: true, text: want || ('视频' + nBoxVideo), mid: bmid, via: 'box' };
      }
      var list = [];
      try { list = doc.querySelectorAll('iframe'); } catch (e3) { return null; }
      for (var j = 0; j < list.length; j++) {
        var src = '';
        try { src = String(list[j].getAttribute('src') || ''); } catch (e4) {}
        if (!src || src === 'about:blank' || /insertvideo|ananas|doHomeWork/.test(src)) continue;
        var rs = '';
        try { rs = list[j].contentDocument ? String(list[j].contentDocument.readyState || '') : ''; } catch (e5) { continue; }
        if (!rs || rs === 'loading' || rs === 'uninitialized') continue;
        var child = null;
        try { child = list[j].contentDocument; } catch (e6) {}
        var next = walk(child, (depth || 0) + 1);
        if (next) return next;
      }
      return null;
    }
    return walk(document, 0) || { ok: false, found: false, error: '没找到任务点' };
  })()`).catch(() => null))
  if (cheapStep.ok) {
    pinChaoxingPlayMid(id, String(cheapStep.mid || payload.mid || ''))
    if (!cheapStep.already) await waitMs(800)
    const { noteStudyParser } = await import('./debug')
    noteStudyParser({
      via: 'step',
      handle: { kind: 'step', ...payload },
      locate: cheapStep,
      error: '',
      force: true,
    })
    return { ok: true, already: Boolean(cheapStep.already), step: String(cheapStep.text || payload.label || ''), via: 'cheap' }
  }
  const hit = asObject(await evalBrowserViewMainNow(id, LOCATE_STUDY_STEP(payload)).catch(() => null))
  const { noteStudyParser } = await import('./debug')
  noteStudyParser({
    via: 'step',
    handle: { kind: 'step', ...payload },
    locate: hit,
    steps: hit.steps,
    error: hit.found || hit.already ? '' : String(hit.error || '切换任务点失败'),
    force: true,
  })
  if (hit.quiz && !hit.found && !(payload.videoIndex > 0)) {
    return { ok: false, quiz: true, step: String(hit.step || '') }
  }
  if (hit.already) {
    return { ok: true, already: true, step: String(hit.step || ''), quiz: Boolean(hit.quiz), video: hit.video }
  }
  if (hit.found) {
    const clicked = await clickHomeworkBox(id, LOCATE_STUDY_STEP(payload)).catch(() => ({ ok: false }))
    if (clicked.ok) await waitMs(1200)
    noteStudyParser({
      via: 'step-click',
      handle: { kind: 'step', ...payload },
      locate: { ...hit, clicked: clicked.ok, clickError: clicked.error },
      error: clicked.ok ? '' : String(clicked.error || hit.error || '切换任务点失败'),
      force: true,
    })
    return {
      ok: Boolean(clicked.ok),
      quiz: Boolean(hit.quiz),
      step: String(hit.step || clicked.text || ''),
      video: hit.video,
      error: clicked.ok ? undefined : String(clicked.error || hit.error || '切换任务点失败'),
    }
  }
  return { ok: false, error: String(hit.error || '切换任务点失败'), steps: hit.steps }
}

/**
 * 切章后 20+ iframe 在重建：禁止注入 helpers，禁止读 location.href。
 * 只浅找看得见的 video，loading / about:blank 直接跳过。
 */
const CHEAP_FIND_VIDEO = `
  function zeIframeMid(iframe){
    if (!iframe) return '';
    var mid = '';
    try { mid = String(iframe.getAttribute('mid') || iframe.getAttribute('data-mid') || ''); } catch (e0) {}
    if (mid) return mid;
    try {
      var box = iframe.closest && iframe.closest('.ans-attach-ct, .moduleDiv');
      if (box) mid = String(box.getAttribute('mid') || box.getAttribute('data-mid') || '');
    } catch (e1) {}
    return mid || '';
  }
  function zeCheapHit(doc, depth, wantMid){
    if (!doc || (depth || 0) > 5) return null;
    wantMid = String(wantMid || '');
    var list = [];
    try { list = doc.querySelectorAll('iframe'); } catch (e2) { list = []; }
    if (wantMid) {
      for (var a = 0; a < list.length; a++) {
        var id = zeIframeMid(list[a]);
        var srcA = '';
        try { srcA = String(list[a].getAttribute('src') || ''); } catch (e3) {}
        if (id !== wantMid && srcA.indexOf(wantMid) < 0) continue;
        var rsA = '';
        try { rsA = list[a].contentDocument ? String(list[a].contentDocument.readyState || '') : ''; } catch (e4) { continue; }
        if (!rsA || rsA === 'loading' || rsA === 'uninitialized') continue;
        var childA = null;
        try { childA = list[a].contentDocument; } catch (e5) {}
        if (!childA) continue;
        var vidsA = [];
        try { vidsA = childA.querySelectorAll('video'); } catch (e6) {}
        if (vidsA[0]) return { v: vidsA[0], mid: id || wantMid };
        var nestedA = zeCheapHit(childA, (depth || 0) + 1, wantMid);
        if (nestedA) { if (!nestedA.mid) nestedA.mid = id || wantMid; return nestedA; }
      }
    }
    var vids = [];
    try { vids = doc.querySelectorAll('video'); } catch (e7) {}
    var best = null;
    for (var k = 0; k < vids.length; k++) {
      var v = vids[k];
      if (v.isConnected === false) continue;
      var srcV = '';
      try { srcV = String(v.currentSrc || v.src || ''); } catch (eS) {}
      var r = null;
      try { r = v.getBoundingClientRect(); } catch (eR) {}
      var tiny = r && (r.width < 8 || r.height < 8);
      if (wantMid) continue;
      if (v.paused === false && srcV) return { v: v, mid: '' };
      if (tiny && !srcV) continue;
      if (srcV && Number(v.duration) > 1) best = v;
      else if (!best && !tiny) best = v;
    }
    if (best && !wantMid) return { v: best, mid: '' };
    for (var i = 0; i < list.length; i++) {
      var src = '';
      try { src = String(list[i].getAttribute('src') || ''); } catch (e8) {}
      if (!src || src === 'about:blank') continue;
      var id2 = zeIframeMid(list[i]);
      if (wantMid && /modules\\/video|insertvideo/.test(src) && id2 && id2 !== wantMid) continue;
      var rs = '';
      try { rs = list[i].contentDocument ? String(list[i].contentDocument.readyState || '') : ''; } catch (e9) { continue; }
      if (!rs || rs === 'loading' || rs === 'uninitialized') continue;
      var child = null;
      try { child = list[i].contentDocument; } catch (e10) {}
      var hit = zeCheapHit(child, (depth || 0) + 1, wantMid);
      if (hit) { if (!hit.mid) hit.mid = id2; return hit; }
    }
    return null;
  }
  function zeCheapVideo(doc, depth){
    var hit = zeCheapHit(doc, depth, '');
    return hit ? hit.v : null;
  }
  function zeCheapDur(v){
    var d = Number(v && v.duration);
    if (d > 1 && isFinite(d)) return d;
    try {
      var doc = v && v.ownerDocument;
      var w = doc && doc.defaultView;
      var p = v && v.player;
      if (!p && w && w.videojs) {
        try {
          if (w.videojs.getAllPlayers) p = w.videojs.getAllPlayers()[0];
          if (!p && w.videojs.getPlayers) {
            var ps = w.videojs.getPlayers() || {};
            for (var k in ps) { p = ps[k]; break; }
          }
        } catch (eP) {}
      }
      if (p && typeof p.duration === 'function') {
        d = Number(p.duration());
        if (d > 1 && isFinite(d)) return d;
      }
      d = Number(w && w.duration);
      if (d > 1 && isFinite(d)) return d;
    } catch (eD) {}
    return 0;
  }
  function zeCheapTick(v, mid){
    if (!v) return { ok: false, hasVideo: false, current: 0, duration: 0, paused: true, ended: false, ready: 0, src: '', mid: '' };
    var src = '';
    try { src = String(v.currentSrc || v.src || ''); } catch (e11) {}
    return {
      ok: true,
      hasVideo: true,
      current: Number(v.currentTime) || 0,
      duration: zeCheapDur(v),
      paused: !!v.paused,
      ended: !!v.ended,
      ready: Number(v.readyState) || 0,
      src: src,
      mid: String(mid || '')
    };
  }
`

const cheapTickScript = (mid = '') => `(function(){${CHEAP_FIND_VIDEO}
  var hit = zeCheapHit(document, 0, ${JSON.stringify(mid)});
  if ((!hit || !hit.v) && ${JSON.stringify(mid)}) hit = zeCheapHit(document, 0, '');
  return zeCheapTick(hit && hit.v, hit && hit.mid);
})()`

const CHEAP_TICK = cheapTickScript('')

const CHEAP_CLICK_FIRST_VIDEO_TAB = `(function(){
  function kindOf(label){
    return /视频|直播/.test(label) && !/测验/.test(label);
  }
  function walk(doc, depth){
    if (!doc || (depth || 0) > 4) return null;
    var nodes = [];
    try { nodes = doc.querySelectorAll('.tabtags a, .tabtags span, .tabtags li, .prev_title, .prev_white, #dct a'); } catch (e0) {}
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.closest && el.closest('#coursetree')) continue;
      var t = String((el.getAttribute && el.getAttribute('title')) || el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!t || t.length > 24 || !kindOf(t)) continue;
      var on = /currents|current|active/.test(String(el.className || ''));
      if (!on) { try { el.click(); } catch (e1) {} }
      return { ok: true, already: on, text: t };
    }
    var boxes = [];
    try { boxes = doc.querySelectorAll('.ans-attach-ct.videoContainer, .ans-attach-ct'); } catch (eB) {}
    for (var b = 0; b < boxes.length; b++) {
      var srcB = '';
      try {
        var ifr = boxes[b].querySelector && boxes[b].querySelector('iframe');
        srcB = ifr ? String(ifr.getAttribute('src') || '') : '';
      } catch (eS) {}
      if (!/modules\\/video|insertvideo|videoContainer/.test(srcB + ' ' + String(boxes[b].className || ''))) continue;
      try { boxes[b].scrollIntoView({ block: 'center' }); } catch (eV) {}
      try { boxes[b].click(); } catch (eC) {}
      return { ok: true, already: false, text: '视频1' };
    }
    var list = [];
    try { list = doc.querySelectorAll('iframe'); } catch (e2) { return null; }
    for (var j = 0; j < list.length; j++) {
      var src = '';
      try { src = String(list[j].getAttribute('src') || ''); } catch (e3) {}
      if (!src || src === 'about:blank' || /insertvideo|ananas|doHomeWork/.test(src)) continue;
      var rs = '';
      try { rs = list[j].contentDocument ? String(list[j].contentDocument.readyState || '') : ''; } catch (e4) { continue; }
      if (!rs || rs === 'loading' || rs === 'uninitialized') continue;
      var child = null;
      try { child = list[j].contentDocument; } catch (e5) {}
      var next = walk(child, (depth || 0) + 1);
      if (next) return next;
    }
    return null;
  }
  return walk(document, 0) || { ok: false };
})()`

const cheapPlayScript = (mid = '') => `(function(){${CHEAP_FIND_VIDEO}
  var hit = zeCheapHit(document, 0, ${JSON.stringify(mid)});
  if (!hit || !hit.v) return { ok: false, hasVideo: false, mid: ${JSON.stringify(mid)} };
  var v = hit.v;
  var doc = v.ownerDocument;
  var btn = null;
  try { btn = doc && doc.querySelector('.vjs-big-play-button, .vjs-play-control.vjs-paused, .vjs-poster, .xt_video_player_play_btn, .play-btn'); } catch (e6) {}
  try { (btn || v).click(); } catch (e7) {}
  try { setTimeout(function(){ try { v.play(); } catch (e8) {} }, 0); } catch (e9) {}
  var tick = zeCheapTick(v, hit.mid);
  tick.ok = true;
  return tick;
})()`

const cheapPauseScript = (mid = '') => `(function(){${CHEAP_FIND_VIDEO}
  function pauseHit(h){
    if (!h || !h.v) return null;
    var v = h.v;
    var doc = v.ownerDocument;
    var btn = null;
    try { btn = doc && doc.querySelector('.vjs-play-control.vjs-playing, button.vjs-playing'); } catch (e6) {}
    try { (btn || v).click(); } catch (e7) {}
    try { v.pause(); } catch (e8) {}
    return zeCheapTick(v, h.mid);
  }
  var hit = zeCheapHit(document, 0, ${JSON.stringify(mid)});
  if ((!hit || !hit.v) && ${JSON.stringify(mid)}) hit = zeCheapHit(document, 0, '');
  var tick = pauseHit(hit);
  var extra = zeCheapHit(document, 0, '');
  if (extra && extra.v && extra.v.paused === false) pauseHit(extra);
  if (!tick) return { ok: false, hasVideo: false };
  tick.ok = true;
  tick.paused = true;
  return tick;
})()`

/** 只扫 ready 的同源文档。loading / 播放器内框跳过，不读 location.href。 */
const CHEAP_COLLECT_JOBS = `(function(){
  function kindOf(label){
    var isVideo = /视频|直播/.test(label) && !/测验/.test(label);
    var isQuiz = /测验|考试|作业/.test(label);
    var isDoc = /文档|PPT|阅读|图文|资料/.test(label);
    return { isVideo: isVideo, isQuiz: isQuiz, isDoc: isDoc };
  }
  function isActive(el){
    var cls = ' ' + String((el && el.className) || '') + ' ';
    return /(^|\\s)(currents|current|active|selected)(\\s|$)/.test(cls);
  }
  function jobDone(box, icon){
    if (/ans-job-finished/.test(String((box && box.className) || ''))) return true;
    var title = '';
    try { title = String((icon && (icon.getAttribute('title') || icon.getAttribute('aria-label') || icon.title)) || ''); } catch (e0) {}
    if (/任务点已完成/.test(title)) return true;
    if (/任务点未完成/.test(title)) return false;
    return /ans-job-icon-finish|ans-job-done/.test(String((icon && icon.className) || ''));
  }
  function collect(doc){
    var out = [];
    if (!doc) return out;
    var nodes = [];
    try {
      nodes = doc.querySelectorAll('.tabtags a, .tabtags span, .tabtags li, .prevTabs a, .prev_ul .prev_title, .prev_ul .prev_white, #dct a, #dct span, .attachment-tabs .item, .prev_title, .prev_white');
    } catch (e1) { return out; }
    for (var n = 0; n < nodes.length; n++) {
      var el = nodes[n];
      if (el.closest && el.closest('#coursetree, .coursetree')) continue;
      var label = String((el.getAttribute && el.getAttribute('title')) || el.textContent || '').replace(/\\s+/g, ' ').trim();
      if (!label || label.length > 24) continue;
      var kind = kindOf(label);
      if (!kind.isVideo && !kind.isQuiz && !kind.isDoc) continue;
      var host = null;
      try { host = el.closest && el.closest('.ans-attach-ct, .moduleDiv'); } catch (e2) {}
      var icon = null;
      try { icon = (host || el).querySelector && (host || el).querySelector('.ans-job-icon'); } catch (e3) {}
      out.push({
        label: label,
        kind: kind.isVideo ? 'video' : kind.isQuiz ? 'quiz' : 'doc',
        video: !!kind.isVideo,
        quiz: !!kind.isQuiz,
        doc: !!kind.isDoc,
        mid: String((el.getAttribute && (el.getAttribute('mid') || el.getAttribute('data-mid'))) || ''),
        jobid: String((el.getAttribute && (el.getAttribute('jobid') || el.getAttribute('data-jobid'))) || ''),
        jobDone: jobDone(host || el, icon),
        unfinished: !jobDone(host || el, icon),
        active: isActive(el)
      });
    }
    if (out.length) return out;
    var boxes = [];
    try { boxes = doc.querySelectorAll('.ans-attach-ct, .moduleDiv'); } catch (e4) { return out; }
    for (var b = 0; b < boxes.length; b++) {
      var box = boxes[b];
      var iframe = null;
      try { iframe = box.querySelector('iframe'); } catch (e5) {}
      var src = iframe ? String(iframe.getAttribute('src') || iframe.src || '') : '';
      var html = String(box.className || '');
      var v = false, q = false, d = false;
      try { v = !!box.querySelector('video') || /insertvideo|modules\\/video/.test(src) || /ans-job-video/.test(html); } catch (e6) {}
      q = /doHomeWork|inserthomework|\\/work\\/|modules\\/work/.test(src) || /ans-job-work/.test(html);
      d = /pdf|document|insertdoc|innerbook/.test(src);
      if (!v && !q && !d) continue;
      var ic = null;
      try { ic = box.querySelector('.ans-job-icon'); } catch (e7) {}
      var mid = '';
      try { mid = iframe ? String(iframe.getAttribute('mid') || iframe.getAttribute('data-mid') || '') : ''; } catch (e8) {}
      out.push({
        label: v ? ('视频' + (out.filter(function(s){ return s.video; }).length + 1)) : (q ? '测验' : '文档'),
        kind: v ? 'video' : q ? 'quiz' : 'doc',
        video: v, quiz: q, doc: d,
        mid: mid, jobid: '',
        jobDone: jobDone(box, ic),
        unfinished: !jobDone(box, ic),
        active: false
      });
    }
    return out;
  }
  function walk(doc, depth, acc){
    if (!doc || (depth || 0) > 4) return;
    var got = collect(doc);
    for (var i = 0; i < got.length; i++) acc.push(got[i]);
    var list = [];
    try { list = doc.querySelectorAll('iframe'); } catch (e9) { return; }
    for (var j = 0; j < list.length; j++) {
      var src = '';
      try { src = String(list[j].getAttribute('src') || ''); } catch (e10) {}
      if (!src || src === 'about:blank') continue;
      if (/insertvideo|ananas\\/modules\\/video|inserthomework|doHomeWork|insertdoc/.test(src)) continue;
      var rs = '';
      try { rs = list[j].contentDocument ? String(list[j].contentDocument.readyState || '') : ''; } catch (e11) { continue; }
      if (!rs || rs === 'loading' || rs === 'uninitialized') continue;
      var child = null;
      try { child = list[j].contentDocument; } catch (e12) {}
      walk(child, (depth || 0) + 1, acc);
    }
  }
  var jobs = [];
  walk(document, 0, jobs);
  var seen = {};
  var uniq = [];
  for (var u = 0; u < jobs.length; u++) {
    var key = (jobs[u].mid || '') + '|' + jobs[u].label + '|' + jobs[u].kind;
    if (seen[key]) continue;
    seen[key] = 1;
    uniq.push(jobs[u]);
  }
  var href = '';
  try { href = String(location.href || ''); } catch (e13) {}
  var chapterId = '';
  try { chapterId = (href.match(/[?&](?:chapterId|chapterid|knowledgeid)=(\\d+)/i) || [])[1] || ''; } catch (e14) {}
  var current = '';
  try {
    var name = document.querySelector('#coursetree .posCatalog_active .posCatalog_name');
    current = String((name && (name.getAttribute('title') || name.textContent)) || '').replace(/\\s+/g, ' ').trim();
  } catch (e15) {}
  return { ok: true, jobs: uniq, chapterId: chapterId, current: current, tabCount: uniq.length };
})()`

/** 叠着的多视频时，廉价扫描默认会拿到第一条。钉住上次播的 mid。 */
const pinnedPlayMid = new Map<string, string>()

export const pinChaoxingPlayMid = (id: string, mid?: string) => {
  const key = String(id || '').trim()
  const value = String(mid || '').trim()
  if (!key) return
  if (value) pinnedPlayMid.set(key, value)
}

const rememberPlayTick = (id: string, tick: ChaoxingVideoTick | null | undefined) => {
  if (!tick?.mid) return
  if (tick.paused === false || Number(tick.current) > 0.2) pinChaoxingPlayMid(id, tick.mid)
}

/** 点一次可视区里的大播放按钮，不等 play() Promise（未加载时会挂死 CDP）。 */
export const tapChaoxingPlay = async (id: string, opts?: { mid?: string }) => {
  const wantMid = String(opts?.mid || pinnedPlayMid.get(id) || '').trim()
  if (opts?.mid) pinChaoxingPlayMid(id, opts.mid)
  let nudged: Record<string, unknown> = {}
  let rawTick: ChaoxingVideoTick | null = null
  let openedTab = false
  const deadline = Date.now() + 7_000
  for (let i = 0; Date.now() < deadline && i < 14; i += 1) {
    nudged = asObject(await evalBrowserViewMainNow(id, cheapPlayScript(wantMid)).catch(() => null))
    rawTick = asVideoTick(nudged) || asVideoTick(await readChaoxingVideoTick(id).catch(() => null))
    const midOk = !wantMid || !rawTick?.mid || rawTick.mid === wantMid
    if (tickLooksLikeVideo(rawTick) && midOk) break
    if (!openedTab && i >= 2 && !nudged.hasVideo && !wantMid) {
      const tab = asObject(await evalBrowserViewMainNow(id, CHEAP_CLICK_FIRST_VIDEO_TAB).catch(() => null))
      if (tab.ok && !tab.already) openedTab = true
    }
    await waitMs(450)
  }
  let settled = await settlePlaying(id, rawTick)
  const locate = { found: Boolean(nudged.ok || tickLooksLikeVideo(rawTick)), via: 'cheap' }
  const clicked: { ok?: boolean } = { ok: Boolean(nudged.ok) }
  if (!settled.playing && (nudged.ok || tickLooksLikeVideo(rawTick) || openedTab)) {
    await waitMs(500)
    nudged = asObject(await evalBrowserViewMainNow(id, cheapPlayScript(wantMid)).catch(() => null))
    rawTick = asVideoTick(nudged) || asVideoTick(await readChaoxingVideoTick(id).catch(() => null)) || rawTick
    settled = await settlePlaying(id, rawTick)
  }
  const tick = settled.tick
  const { noteStudyParser } = await import('./debug')
  noteStudyParser({
    via: 'play',
    handle: { kind: 'control', name: 'play' },
    locate: { ...locate, clicked: clicked.ok },
    tick,
    playing: settled.playing,
    error: settled.playing || clicked.ok || nudged.ok ? '' : '播放器没点着或没播起来',
    force: true,
  })
  rememberPlayTick(id, tick)
  return {
    ok: Boolean(clicked.ok || nudged.ok || tickLooksLikeVideo(tick)),
    clickedPlay: Boolean((clicked as { ok?: boolean }).ok),
    hasVideo: tickLooksLikeVideo(tick),
    playing: settled.playing,
    paused: tick?.paused !== false,
    current: tick?.current || 0,
    duration: tick?.duration || 0,
    mid: String(tick?.mid || wantMid || ''),
  }
}

/** 对齐 ocs：已点到任务点后只播当前 attachment，不要再点「第一个未完成视频」 */
export const playChaoxingVideo = async (
  id: string,
  opts?: {
    skipTabClick?: boolean
    videoIndex?: number
    mid?: string
    jobid?: string
    label?: string
    skipIfDone?: boolean
  },
) => {
  if (await readChaoxingCaptcha(id)) {
    return { captcha: true, hasVideo: false, playing: false, hint: CAPTCHA_HINT }
  }
  const topHref = String(await evalBrowserViewMain(id, `(function(){ return location.href || ''; })()`).catch(() => '') || '')
  if (!/studentstudy/i.test(topHref)) {
    const header = (topHref.match(/[?&]pageHeader=(\d+)/i) || [])[1] || ''
    return {
      page: header === '0' ? 'course-tasks' : 'chapters',
      hasVideo: false,
      playing: false,
      error: '不在章节播放页（studentstudy）',
      hint: '课程壳/任务页/目录上的预览不能当播放器。先点节名进 studentstudy，再 browser_study_play。',
    }
  }
  {
    const ready = asVideoTick(await readChaoxingVideoTick(id).catch(() => null))
    if (!tickLooksLikeVideo(ready)) {
      const { waitForStudyPlayerReady } = await import('./chapters')
      await waitForStudyPlayerReady(id).catch(() => null)
    }
  }
  const tapped = await tapChaoxingPlay(id)
  if (tapped.hasVideo || tapped.playing || tapped.ok) {
    return {
      page: 'player',
      hasVideo: Boolean(tapped.hasVideo || tapped.ok),
      playing: Boolean(tapped.playing),
      paused: tapped.paused,
      current: tapped.current,
      duration: tapped.duration,
      clickedPlay: tapped.clickedPlay,
    }
  }
  const videoIndex = Number(opts?.videoIndex) || 0
  const mid = String(opts?.mid || '').trim()
  const jobid = String(opts?.jobid || '').trim()
  const label = String(opts?.label || '').trim()
  if (videoIndex > 1 || mid || jobid) {
    const stepped = await clickChaoxingStep(id, { videoIndex, mid, jobid, label })
    if (stepped.quiz) {
      return { quiz: true, step: String(stepped.step || ''), hasVideo: false, playing: false, hint: '当前是章节测验。系统会按 ocs 流程自动搜题/随机/暂存' }
    }
    if (!stepped.ok) {
      return { hasVideo: false, playing: false, error: String(stepped.error || '切换任务点失败'), stepped }
    }
    if (!stepped.already) await waitMs(1200)
    return tapChaoxingPlay(id)
  } else if (!opts?.skipTabClick) {
    const tab = asObject(await evalBrowserViewMain(id, LOCATE_STUDY_VIDEO_TAB()).catch(() => null))
    if (tab.quiz) {
      return { quiz: true, step: String(tab.step || ''), hasVideo: false, playing: false, hint: '当前是章节测验。系统会按 ocs 流程自动搜题/随机/暂存' }
    }
    // 已完成只是状态。没指定任务点就播当前；只有调用方明确 skipIfDone 才跳过。
    if (opts?.skipIfDone && tab.done && Number(tab.videoCount) > 0) {
      return {
        hasVideo: false,
        playing: false,
        jobDone: true,
        chapterVideosDone: true,
        skipped: true,
        hint: '已按 skipIfDone 跳过已完成视频。要重播就不要带 skipIfDone。',
      }
    }
    if (tab.found) {
      const clicked = await clickHomeworkBox(id, LOCATE_STUDY_VIDEO_TAB()).catch(() => ({ ok: false }))
      if (clicked.ok) await waitMs(800)
    }
  }
  const again = await tapChaoxingPlay(id)
  return {
    page: 'player',
    hasVideo: Boolean(again.hasVideo || again.ok),
    playing: Boolean(again.playing),
    paused: again.paused,
    current: again.current,
    duration: again.duration,
    clickedPlay: again.clickedPlay,
    retry: !again.hasVideo,
    hint: again.hasVideo
      ? (again.playing ? undefined : '播放器在，但视频没有真正播起来。再 play。')
      : '还没读到播放器。再 play，不要 next。',
  }
}

/** 暂停当前视口内的学习通视频（嵌套 iframe / videojs） */
export const pauseChaoxingVideo = async (id: string) => {
  if (await readChaoxingCaptcha(id)) {
    return { captcha: true, hasVideo: false, playing: false, paused: true, hint: CAPTCHA_HINT }
  }
  const nudged = asObject(await evalBrowserViewMainNow(id, cheapPauseScript(pinnedPlayMid.get(id) || '')).catch(() => null))
  await waitMs(200)
  const tick = asVideoTick(await readChaoxingVideoTick(id).catch(() => null)) || asVideoTick(nudged)
  const hasVideo = tickLooksLikeVideo(tick) || Boolean(nudged.ok)
  const paused = !tick || tick.paused !== false
  const { noteStudyParser } = await import('./debug')
  noteStudyParser({
    via: 'pause',
    handle: { kind: 'control', name: 'pause' },
    tick,
    playing: !paused && hasVideo,
    force: true,
  })
  return {
    page: 'player',
    hasVideo,
    playing: !paused && hasVideo,
    paused,
    ended: Boolean(tick?.ended),
    current: tick?.current || Number(nudged.current) || 0,
    duration: tick?.duration || Number(nudged.duration) || 0,
    hint: hasVideo
      ? (paused ? '已暂停当前视频。' : '已发暂停，但播放器仍在播；再试一次。')
      : '没读到可暂停的视频。',
  }
}

export const readChaoxingVideo = async (id: string): Promise<ChaoxingVideoInfo | null> => {
  if (await readChaoxingCaptcha(id)) {
    return { page: 'captcha', captcha: true, quiz: false, video: null, hint: CAPTCHA_HINT }
  }
  const player = asObject(await evalBrowserViewMain(id, READ_STUDY_PLAYER()).catch(() => null))
  const slim = asObject(await evalBrowserViewMain(id, READ_CATALOG_SLIM()).catch(() => ({})))
  const steps = (Array.isArray(player.steps) ? player.steps : []) as NonNullable<ChaoxingVideoInfo['steps']>
  const unfinished = Array.isArray(slim.unfinished) ? slim.unfinished.map(String) : []
  const current = String(slim.current || player.current || '')
  const { noteStudyParser } = await import('./debug')
  noteStudyParser({
    via: 'player',
    tick: player.hasVideo
      ? { current: player.currentTime, duration: player.duration, paused: player.paused, ended: player.ended, hasVideo: true }
      : { hasVideo: false },
    steps,
    playing: player.paused === false,
  })
  return {
    page: String(player.page || slim.page || 'other'),
    chapterId: String(player.chapterId || ''),
    step: String(player.step || ''),
    quiz: Boolean(player.quiz),
    jobDone: player.jobDone == null ? null : Boolean(player.jobDone),
    steps,
    videoCount: Number(player.videoCount) || 0,
    videoIndex: Number(player.videoIndex) || 0,
    moreVideos: Boolean(player.moreVideos),
    current,
    next: unfinished.find((title) => title && title !== current) || unfinished[0] || '',
    unfinished,
    video: player.hasVideo
      ? {
          paused: Boolean(player.paused),
          ended: Boolean(player.ended),
          current: Number(player.currentTime) || 0,
          duration: Number(player.duration) || 0,
        }
      : null,
  }
}

export const installChaoxingVideoHook = (id: string) => readChaoxingVideoTick(id)

export const readChaoxingVideoTick = async (id: string) => {
  const pin = pinnedPlayMid.get(id) || ''
  const cheap = await evalBrowserViewMainNow(id, cheapTickScript(pin)).catch(() => null)
  const tick = asVideoTick(asObject(cheap))
  rememberPlayTick(id, tick)
  return tick
}

export const readChaoxingChapterJobTick = async (id: string, opts?: { full?: boolean }) => {
  const cheap = asObject(await evalBrowserViewMainNow(id, CHEAP_COLLECT_JOBS).catch(() => null))
  let jobs = Array.isArray(cheap.jobs) ? cheap.jobs as Record<string, unknown>[] : []
  if (!jobs.length && opts?.full !== false) {
    const player = asObject(await evalBrowserViewMainNow(id, READ_STUDY_PLAYER()).catch(() => null))
    jobs = Array.isArray(player.jobs) ? player.jobs as Record<string, unknown>[] : []
    if (jobs.length) {
      return {
        live: false,
        jobs,
        current: String(player.current || cheap.current || ''),
        chapterId: String(player.chapterId || cheap.chapterId || '').replace(/\D/g, ''),
        videoCount: Number(player.videoCount) || 0,
        videoIndex: Number(player.videoIndex) || 0,
        videoMid: String(player.videoMid || ''),
        video: asVideoTick(player.hasVideo ? {
          current: Number(player.currentTime) || 0,
          duration: Number(player.duration) || 0,
          paused: Boolean(player.paused),
          ended: Boolean(player.ended),
        } : null),
        ts: Date.now(),
      }
    }
  }
  const tick = asVideoTick(await readChaoxingVideoTick(id).catch(() => null))
  const videos = jobs.filter((item) => item.video || item.kind === 'video')
  const videoIndex = videos.findIndex((item) => item.active) + 1
  if (jobs.length) {
    const { noteStudyParser } = await import('./debug')
    noteStudyParser({
      via: 'jobs',
      steps: jobs,
      tick,
      force: true,
    })
  }
  return {
    live: true,
    jobs,
    current: String(cheap.current || ''),
    chapterId: String(cheap.chapterId || '').replace(/\D/g, ''),
    videoCount: videos.length,
    videoIndex,
    videoMid: String(tick?.mid || (videos.find((item) => item.active) || {}).mid || ''),
    video: tick,
    ts: Date.now(),
  }
}