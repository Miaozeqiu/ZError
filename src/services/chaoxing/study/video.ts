import { callProtocol } from '../../browser/protocol'
import { readFrameHtml, useLegacyEval } from '../../browser/domRead'
import { asObject, evalBrowserViewMain, evalBrowserViewMainNow, waitMs } from '../../browser/eval'
import { readLastTick, tickMatchesMid } from '../../browser/pushEvents'
import { jobsFromHtml } from './localJobs'
import { locatorsForStudyControl, locatorsForStudyStep } from '../locators'
import { clickHomeworkBox } from '../homework/act'
import {
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
  const clicked = await clickHomeworkBox(id, locatorsForStudyStep(payload)).catch(() => ({ ok: false }))
  pinChaoxingPlayMid(id, payload.mid)
  if (clicked.ok) await waitMs(800)
  const { noteStudyParser } = await import('./debug')
  noteStudyParser({
    via: 'step',
    handle: { kind: 'step', ...payload },
    locate: { found: Boolean(clicked.ok), via: 'cdp', text: clicked.text },
    error: clicked.ok ? '' : String(clicked.error || '切换任务点失败'),
    force: true,
  })
  return {
    ok: Boolean(clicked.ok),
    step: String(clicked.text || payload.label || ''),
    mid: payload.mid,
    error: clicked.ok ? undefined : String(clicked.error || '切换任务点失败'),
    via: 'cdp',
  }
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
  function zeCheapVisible(el){
    if (!el) return false;
    var r = null;
    try { r = el.getBoundingClientRect(); } catch (eV) {}
    if (!r || r.width < 4 || r.height < 4) return false;
    try {
      var win = el.ownerDocument && el.ownerDocument.defaultView;
      var st = win && win.getComputedStyle && win.getComputedStyle(el);
      if (st && (st.display === 'none' || st.visibility === 'hidden' || Number(st.opacity) === 0)) return false;
    } catch (eS) {}
    return true;
  }
  function zeCheapPlayEl(doc, v){
    if (!doc) return v;
    var sels = '.vjs-big-play-button, button.vjs-big-play-button, .vjs-play-control.vjs-paused, .vjs-poster, .xt_video_player_play_btn, .play-btn, .playButton, .replay-btn, .vjs-ended .vjs-play-control';
    var list = [];
    try { list = doc.querySelectorAll(sels); } catch (eQ) { return v; }
    for (var i = 0; i < list.length; i++) {
      if (zeCheapVisible(list[i])) return list[i];
    }
    return v;
  }
  function zeCheapFire(el){
    if (!el) return;
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
  }
  function zeCheapStart(v){
    if (!v) return;
    var doc = v.ownerDocument;
    var win = doc && doc.defaultView;
    try { v.muted = false; } catch (e0) {}
    try {
      var root = v.closest && v.closest('.video-js, .video-js-box, #video');
      var id = root && root.id;
      var p = v.player;
      var vjs = win && win.videojs;
      if (!p && vjs) {
        if (id) try { p = vjs.getPlayer(id); } catch (e1) {}
        if (!p && vjs.getAllPlayers) try { p = vjs.getAllPlayers()[0]; } catch (e2) {}
        if (!p && vjs.getPlayers) {
          try {
            var ps = vjs.getPlayers() || {};
            for (var k in ps) { p = ps[k]; break; }
          } catch (e3) {}
        }
      }
      if (p) {
        try { if (p.muted) p.muted(false); } catch (e4) {}
        setTimeout(function(){
          try { var pr = p.play(); if (pr && pr.catch) pr.catch(function(){}); } catch (e5) {}
        }, 0);
      }
    } catch (e6) {}
    setTimeout(function(){
      try { if (v.readyState < 1 && !(v.currentSrc || v.src)) v.load(); } catch (e7) {}
      try { var st = v.play(); if (st && st.catch) st.catch(function(){}); } catch (e8) {}
    }, 0);
  }
  function zeCheapBox(el){
    if (!el) return null;
    try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e0) {}
    var r = null;
    try { r = el.getBoundingClientRect(); } catch (e1) {}
    if (!r || r.width < 2 || r.height < 2) return null;
    var x = r.left + r.width / 2;
    var y = r.top + r.height / 2;
    var win = el.ownerDocument && el.ownerDocument.defaultView;
    var topWin = null;
    try { topWin = (win && win.top) || win; } catch (e2) { topWin = win; }
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
    }
    return { x: x, y: y, space: 'page' };
  }
`

const cheapTickScript = (mid = '') => `(function(){${CHEAP_FIND_VIDEO}
  var hit = zeCheapHit(document, 0, ${JSON.stringify(mid)});
  if ((!hit || !hit.v) && ${JSON.stringify(mid)}) hit = zeCheapHit(document, 0, '');
  return zeCheapTick(hit && hit.v, hit && hit.mid);
})()`

const CHEAP_TICK = cheapTickScript('')

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
      if ((depth || 0) > 0 && /studentstudy/i.test(src)) continue;
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
    current = String((name && (name.textContent || name.getAttribute('title'))) || '').replace(/\\s+/g, ' ').trim();
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

/** 切章后上一节的 mid 必须清掉，否则裸 play 会拿旧 mid 当目标，播起来也判「不是那条」而反复点成暂停。 */
export const clearChaoxingPlayMid = (id: string) => {
  pinnedPlayMid.delete(String(id || '').trim())
}

const rememberPlayTick = (id: string, tick: ChaoxingVideoTick | null | undefined) => {
  if (!tick?.mid) return
  if (tick.paused === false || Number(tick.current) > 0.2) pinChaoxingPlayMid(id, tick.mid)
}

/** 点一次可视区里的大播放按钮，不等 play() Promise（未加载时会挂死 CDP）。 */
export const tapChaoxingPlay = async (id: string, opts?: { mid?: string }) => {
  const wantMid = String(opts?.mid || pinnedPlayMid.get(id) || '').trim()
  // 只有调用方点名的 mid 才是硬要求；钉住的 mid 只是「优先找这条」的提示，播起来别的可见条也算成功。
  const strictMid = Boolean(opts?.mid)
  if (opts?.mid) pinChaoxingPlayMid(id, opts.mid)
  const midOk = (tick: ChaoxingVideoTick | null) => !strictMid || !wantMid || !tick?.mid || tick.mid === wantMid
  let rawTick: ChaoxingVideoTick | null = null
  let clickedOk = false
  const deadline = Date.now() + 7_000
  // 已经在播就别再点：播放定位兜底会落到 <video> 本身，点一下就成了暂停。
  rawTick = asVideoTick(await readChaoxingVideoTick(id).catch(() => null))
  const alreadyPlaying = videoIsPlaying(rawTick) && midOk(rawTick)
  for (let i = 0; !alreadyPlaying && Date.now() < deadline && i < 14; i += 1) {
    const clicked = await clickHomeworkBox(id, locatorsForStudyControl('play', wantMid)).catch(() => ({ ok: false }))
    clickedOk = Boolean(clicked.ok) || clickedOk
    // 点到了就等 play 事件推上来再读；立刻读会拿到旧 tick 又点一次，落到 <video> 上就成了暂停。
    if (clicked.ok) await waitMs(650)
    rawTick = asVideoTick(await readChaoxingVideoTick(id).catch(() => null))
    if (videoIsPlaying(rawTick) && midOk(rawTick)) break
    if (i >= 2 && !tickLooksLikeVideo(rawTick) && !wantMid) {
      await clickHomeworkBox(id, locatorsForStudyControl('video-tab')).catch(() => null)
    }
    await waitMs(420)
  }
  const settled = await settlePlaying(id, rawTick)
  const tick = settled.tick
  const { noteStudyParser } = await import('./debug')
  noteStudyParser({
    via: 'play',
    handle: { kind: 'control', name: 'play' },
    locate: { found: clickedOk || tickLooksLikeVideo(rawTick), via: 'cdp', clicked: clickedOk },
    tick,
    playing: settled.playing,
    error: settled.playing || clickedOk || tickLooksLikeVideo(tick) ? '' : '播放器没点着或没播起来',
    force: true,
  })
  rememberPlayTick(id, tick)
  return {
    ok: Boolean(clickedOk || tickLooksLikeVideo(tick)),
    clickedPlay: clickedOk,
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
      hint: '课程壳/任务页/目录上的预览不能当播放器。先点节名进 studentstudy，再 看快照。',
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
    const tab = useLegacyEval()
      ? asObject(await evalBrowserViewMain(id, READ_STUDY_PLAYER()).catch(() => null))
      : asObject(await readChaoxingChapterJobTick(id).catch(() => null))
    if (tab.quiz) {
      return { quiz: true, step: String(tab.step || ''), hasVideo: false, playing: false, hint: '当前是章节测验。系统会按 ocs 流程自动搜题/随机/暂存' }
    }
    if (opts?.skipIfDone && tab.jobDone && Number(tab.videoCount) > 0) {
      return {
        hasVideo: false,
        playing: false,
        jobDone: true,
        chapterVideosDone: true,
        skipped: true,
        hint: '已按 skipIfDone 跳过已完成视频。要重播就不要带 skipIfDone。',
      }
    }
    const clicked = await clickHomeworkBox(id, locatorsForStudyControl('video-tab')).catch(() => ({ ok: false }))
    if (clicked.ok) await waitMs(800)
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
  const clicked = await clickHomeworkBox(id, locatorsForStudyControl('pause', pinnedPlayMid.get(id) || '')).catch(() => ({ ok: false }))
  await waitMs(200)
  const tick = asVideoTick(await readChaoxingVideoTick(id).catch(() => null))
  const hasVideo = tickLooksLikeVideo(tick) || Boolean(clicked.ok)
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
    current: tick?.current || 0,
    duration: tick?.duration || 0,
    hint: hasVideo
      ? (paused ? '已暂停当前视频。' : '已发暂停，但播放器仍在播；再试一次。')
      : '没读到可暂停的视频。',
  }
}

export const readChaoxingVideo = async (id: string): Promise<ChaoxingVideoInfo | null> => {
  if (await readChaoxingCaptcha(id)) {
    return { page: 'captcha', captcha: true, quiz: false, video: null, hint: CAPTCHA_HINT }
  }
  const jobs = await readChaoxingChapterJobTick(id).catch(() => null)
  const tick = asVideoTick(await readChaoxingVideoTick(id).catch(() => null))
  const player = useLegacyEval()
    ? asObject(await evalBrowserViewMain(id, READ_STUDY_PLAYER()).catch(() => null))
    : {
        page: 'player',
        chapterId: jobs?.chapterId || '',
        step: '',
        quiz: Boolean((jobs?.jobs || []).some((item) => item.quiz || item.kind === 'quiz')),
        jobDone: (jobs?.jobs || []).some((item) => item.jobDone === true),
        steps: jobs?.jobs || [],
        videoCount: Number(jobs?.videoCount) || 0,
        videoIndex: Number(jobs?.videoIndex) || 0,
        moreVideos: Number(jobs?.videoCount) > 1,
        current: jobs?.current || '',
        hasVideo: videoTickHasPlayer(tick),
        paused: tick?.paused,
        ended: tick?.ended,
        currentTime: tick?.current,
        duration: tick?.duration,
      }
  const slim = useLegacyEval()
    ? asObject(await evalBrowserViewMain(id, READ_CATALOG_SLIM()).catch(() => ({})))
    : {}
  const steps = (Array.isArray(player.steps) ? player.steps : jobs?.jobs || []) as NonNullable<ChaoxingVideoInfo['steps']>
  const unfinished = Array.isArray(slim.unfinished) ? slim.unfinished.map(String) : []
  const current = String(slim.current || player.current || jobs?.current || '')
  const { noteStudyParser } = await import('./debug')
  noteStudyParser({
    via: 'player',
    tick: videoTickHasPlayer(tick)
      ? { current: tick?.current, duration: tick?.duration, paused: tick?.paused, ended: tick?.ended, hasVideo: true }
      : { hasVideo: false },
    steps,
    playing: tick?.paused === false,
  })
  return {
    page: String(player.page || slim.page || 'other'),
    chapterId: String(player.chapterId || jobs?.chapterId || ''),
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
    video: videoTickHasPlayer(tick)
      ? {
          paused: Boolean(tick?.paused),
          ended: Boolean(tick?.ended),
          current: Number(tick?.current) || 0,
          duration: Number(tick?.duration) || 0,
        }
      : null,
  }
}

export const installChaoxingVideoHook = (id: string) => readChaoxingVideoTick(id)

export const readChaoxingVideoTick = async (id: string) => {
  const pin = pinnedPlayMid.get(id) || ''
  // 钉住 mid 时 Rust 只回那条；没钉住时 Rust 挑在播 / 可见的那条
  const cached = await readLastTick(id, pin).catch(() => null)
  if (cached?.ok && cached.tick && cached.ageMs <= 4000 && tickMatchesMid(cached.tick, pin)) {
    const tick = asVideoTick(cached.tick)
    if (tick) {
      rememberPlayTick(id, tick)
      return tick
    }
  }
  const cheap = await callProtocol(id, 'media_tick', { mid: pin }).catch(() => null)
  const tick = asVideoTick(asObject(cheap))
  rememberPlayTick(id, tick)
  return tick
}

export const readChaoxingChapterJobTick = async (id: string, opts?: { full?: boolean }) => {
  let cheap: Record<string, unknown> = {}
  let jobs: Record<string, unknown>[] = []
  if (!useLegacyEval()) {
    const cards = await readFrameHtml(id, 'knowledge/cards')
    if (cards.html) {
      jobs = jobsFromHtml(cards.html, 'knowledge/cards')
      // chapterId 必须带回去：面板用它判断这批任务点属于哪一节（jobChapterId）。
      // 丢了它，每次目录轮询都会把 jobs 判成「不属于本节」清空，进度和「当前」标记随之丢失。
      const knowledgeId = ((String(cards.url || '').match(/[?&]knowledgeid=(\d+)/i) || [])[1] || '')
      cheap = { jobs, current: '', chapterId: knowledgeId }
    }
  }
  if (!jobs.length) {
    cheap = asObject(await evalBrowserViewMainNow(id, CHEAP_COLLECT_JOBS).catch(() => null))
    jobs = Array.isArray(cheap.jobs) ? cheap.jobs as Record<string, unknown>[] : []
  }
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