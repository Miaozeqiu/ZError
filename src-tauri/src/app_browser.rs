use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{
  webview::{NewWindowResponse, PageLoadEvent, WebviewBuilder},
  AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, WebviewUrl,
};
use url::Url;

const LABEL_PREFIX: &str = "app-browser-";
const OVERLAY_LABEL: &str = "app-abs-overlay";

// 注入到主文档和所有 iframe（含跨域）。页面脚本读不了 contentDocument，
// 但每个 frame 里的这份脚本可以通过 postMessage 把正文交回顶层。
const FRAME_BRIDGE: &str = r#"
(function(){
  if (window.__ZE_FRAME__) return;
  window.__ZE_FRAME__ = 1;
  function openHere(url){
    url = String(url || '');
    if (!url || url === 'about:blank' || url.indexOf('javascript:') === 0) return false;
    try {
      if (window.top && window.top.location) { window.top.location.href = url; return true; }
    } catch (e) {}
    try { location.href = url; return true; } catch (e2) { return false; }
  }
  function textOf(){
    try {
      var el = document.body || document.documentElement;
      return String((el && (el.innerText || el.textContent)) || '');
    } catch (e) { return ''; }
  }
  function hrefOf(){
    try { return String(location.href || ''); } catch (e) { return ''; }
  }
  function kindOf(href, text){
    if (/studentcourse|studentstudy/.test(href) || /已完成任务点/.test(text)) return 'catalog';
    if (/mooc2\\/work|doHomeWork|selectWork|作业列表|待做作业|pageHeader=8/.test(href + text) || document.querySelector('.questionLi, .singleQuesId, .workLi, .TiMu, .mark_item, [data-questionid]')) return 'work';
    if (/暂无任务|默认班级/.test(text) && !/已完成任务点/.test(text)) return 'task';
    return 'other';
  }
  function workSnap(){
    var works = [];
    var questions = [];
    function absUrl(src){
      src = String(src || '').trim();
      if (!src) return '';
      if (src.indexOf('//') === 0) src = 'https:' + src;
      else if (src.charAt(0) === '/') src = String(location.origin || 'https://mooc1.chaoxing.com') + src;
      return src;
    }
    function isDecorImg(src, img){
      if (!src || src.length > 400 || src.indexOf('data:') === 0) return true;
      if (/(?:^|[\\/_-])(?:logo|avatar|pixel|spacer|blank\\.gif)(?:$|[\\/.?_])/i.test(src)) return true;
      var w = img && (img.naturalWidth || img.width) || 0;
      var h = img && (img.naturalHeight || img.height) || 0;
      if (w && h && w < 10 && h < 10) return true;
      return false;
    }
    function isOptArea(node){
      if (!node || node.nodeType !== 1) return false;
      var cls = String(node.className || '');
      var tag = String(node.tagName || '').toLowerCase();
      if (/answerBg|answer_item|workTextWrap|num_option|checkDiv|choiceList|options|stem_answer/.test(cls)) return true;
      if (tag === 'ul' && /option|answer|choice/i.test(cls)) return true;
      return false;
    }
    function walkNodes(el, skipOpts){
      var text = [];
      var images = [];
      function walk(node){
        if (!node) return;
        if (node.nodeType === 3) {
          var t = String(node.textContent || '').replace(/\\s+/g, ' ');
          if (t) text.push(t);
          return;
        }
        if (node.nodeType !== 1) return;
        var tag = String(node.tagName || '').toLowerCase();
        if (tag === 'script' || tag === 'style') return;
        if (skipOpts && isOptArea(node)) return;
        if (tag === 'img') {
          var src = absUrl(node.currentSrc || node.src || node.getAttribute('src') || node.getAttribute('data-src') || node.getAttribute('data-original'));
          if (!isDecorImg(src, node)) {
            images.push(src);
            text.push('［图］');
          }
          return;
        }
        try {
          var bg = String((node.getAttribute && node.getAttribute('style')) || '');
          var bm = bg.match(/url\(["']?([^"')]+)["']?\)/);
          if (bm) {
            var bsrc = absUrl(bm[1]);
            if (!isDecorImg(bsrc, node)) {
              images.push(bsrc);
              text.push('［图］');
            }
          }
        } catch (e3) {}
        var kids = node.childNodes;
        for (var i = 0; i < kids.length; i++) walk(kids[i]);
      }
      walk(el);
      return { text: text.join('').replace(/\\s+/g, ' ').trim(), images: images };
    }
    function typeFrom(text, raw){
      var t = String(raw || text || '');
      if (/多选/.test(t)) return '多选题';
      if (/判断/.test(t)) return '判断题';
      if (/填空/.test(t)) return '填空题';
      if (/简答|论述|计算/.test(t)) return '简答题';
      if (/单选/.test(t)) return '单选题';
      return String(raw || '').trim();
    }
    function stripMeta(text, typeName){
      text = String(text || '').replace(/\\s+/g, ' ').trim();
      text = text.replace(/^\\d+\\s*[.、．)）]\\s*/, '');
      text = text.replace(/^\\d+(?=[（(]|单选|多选|填空|判断|简答)/, '');
      text = text.replace(/^[（(]\\s*(单选题|多选题|填空题|判断题|简答题|计算题|论述题|单选|多选|填空|判断)\\s*[)）]\\s*/, '');
      if (typeName) {
        var key = String(typeName).replace(/题$/, '');
        if (key) text = text.replace(new RegExp('^[（(]?\\s*' + key + '题?\\s*[)）]?\\s*'), '');
      }
      return text.trim();
    }
    function hwBoxes(){
      var cands = ['.questionLi', '.singleQuesId', '.mark_item', '.TiMu'];
      var best = [];
      for (var c = 0; c < cands.length; c++) {
        var raw = document.querySelectorAll(cands[c]);
        var leaves = [];
        for (var j = 0; j < raw.length; j++) {
          var nested = false;
          for (var k = 0; k < raw.length; k++) {
            if (j !== k && raw[j].contains && raw[j].contains(raw[k])) { nested = true; break; }
          }
          if (!nested) leaves.push(raw[j]);
        }
        if (leaves.length > best.length) best = leaves;
      }
      return best;
    }
    try {
      var links = document.querySelectorAll('a[href*="work"], a[href*="Work"], .titTxt a, .workName a, .work-title a, .homework-name, [class*="workName"] a');
      for (var i = 0; i < links.length && works.length < 30; i++) {
        var title = String(links[i].getAttribute('title') || links[i].innerText || '').replace(/\\s+/g, ' ').trim();
        if (!title || title.length < 2 || title.length > 80) continue;
        var wrap = links[i].closest ? links[i].closest('li, .workLi, tr, .listLi, .work-item') : links[i].parentElement;
        var block = String((wrap && (wrap.innerText || '')) || '');
        var status = /待做|未做/.test(block) ? '待做' : /待批阅/.test(block) ? '待批阅' : /已完成|已批阅/.test(block) ? '已完成' : '';
        works.push({ title: title, status: status, href: String(links[i].href || '') });
      }
      var boxes = hwBoxes();
      for (var q = 0; q < boxes.length && questions.length < 60; q++) {
        var box = boxes[q];
        var typeName = typeFrom('', box.getAttribute('typeName') || box.getAttribute('typename') || '');
        if (!typeName) {
          var typeEl = box.querySelector('.colorShallow, .Zy_type, .qType, .newZy_TItle');
          typeName = typeFrom((typeEl && (typeEl.innerText || typeEl.textContent)) || '', '');
        }
        var stemEl = box.querySelector('h3.mark_name, h3 .mark_name, h3, .Zy_TItle, .mark_name, .qtTitle, .question-title, .stem, .quesTitle');
        var walked = walkNodes(stemEl || box, !stemEl);
        if (!stemEl) {
          var cut = walked.text.split(/\\s*A[.、．)\\s]/)[0] || walked.text;
          walked.text = cut;
        } else {
          walked.text = walked.text.replace(/^\\d+[.、．\\s]*/, '').replace(/[（(]\\s*(单选题|多选题|填空题|判断题|简答题)\\s*[）)]/g, '').replace(/\\(\\s*\\)/g, ' ').replace(/\\s+/g, ' ').trim();
        }
        if ((!walked.text || walked.text.length < 4) && !walked.images.length) {
          walked = walkNodes(box, true);
          walked.text = (walked.text.split(/\\s*A[.、．)\\s]/)[0] || walked.text);
        }
        if (!typeName) typeName = typeFrom(walked.text, '');
        var idxHit = walked.text.match(/^\\s*(\\d+)/);
        var index = Number(idxHit && idxHit[1]) || (q + 1);
        var stem = stripMeta(walked.text, typeName);
        var stemImgs = walked.images.slice(0, 6);
        var opts = [];
        var wraps = box.querySelectorAll('.stem_answer .answerBg, .stem_answer .answer_item, .answerBg, .answer_item');
        if (!wraps.length) {
          var letters = box.querySelectorAll('.num_option, span[class*="choice"], a.checkDiv');
          var seen = {};
          var collected = [];
          for (var n = 0; n < letters.length; n++) {
            var host = letters[n].closest ? (letters[n].closest('.answerBg, .answer_item, li, label, div') || letters[n].parentElement) : letters[n].parentElement;
            var key = host || letters[n];
            if (seen[key]) continue;
            seen[key] = 1;
            collected.push(host || letters[n]);
          }
          wraps = collected;
        }
        for (var o = 0; o < wraps.length && opts.length < 8; o++) {
          var node = wraps[o];
          var bodyEl = node.querySelector ? node.querySelector('.answer_p') : null;
          var walkedOpt = walkNodes(bodyEl || node, false);
          var raw = walkedOpt.text;
          var letterEl = node.querySelector && node.querySelector('.num_option, span[class*="choice"], [data]');
          var letter = String((letterEl && letterEl.getAttribute('data')) || '').trim().toUpperCase();
          if (!/^[A-H]$/.test(letter)) {
            var aria = String(node.getAttribute && node.getAttribute('aria-label') || '');
            letter = (aria.match(/^([A-H])\\s/) || [])[1] || '';
          }
          if (!letter) letter = String((letterEl && (letterEl.innerText || letterEl.textContent)) || raw).replace(/\\s+/g, '').toUpperCase();
          letter = (letter.match(/^([A-H])/) || [])[1] || '';
          if (!letter && /正确|对/.test(raw)) letter = 'A';
          if (!letter && /错误|错/.test(raw)) letter = 'B';
          if (!letter) letter = String.fromCharCode(65 + opts.length);
          var optText = raw.replace(new RegExp('^' + letter + '[.、．\\s)]*'), '').replace(/\\s+/g, ' ').trim();
          var optImgs = walkedOpt.images.filter(function(src){ return stemImgs.indexOf(src) < 0; }).slice(0, 4);
          if (!optText && !optImgs.length && raw.length > 80) continue;
          if (opts.some(function(item){ return item.letter === letter; })) continue;
          opts.push({
            letter: letter,
            text: optText.slice(0, 120),
            image: optImgs[0] || '',
            images: optImgs,
            selected: /check_answer|checked|active|selected/.test(String(node.className || '') + String((letterEl && letterEl.className) || ''))
              || String(node.getAttribute && node.getAttribute('aria-checked') || '') === 'true'
          });
        }
        var imageCount = stemImgs.length + opts.reduce(function(n, item){ return n + (item.images ? item.images.length : 0); }, 0);
        if (stem || opts.length || imageCount) questions.push({
          id: String(box.getAttribute('data') || box.getAttribute('questionid') || box.getAttribute('data-questionid') || q + 1),
          index: index,
          typeName: typeName,
          stem: stem.slice(0, 400),
          images: stemImgs,
          options: opts,
          filled: opts.some(function(x){ return x.selected; }),
          imageCount: imageCount,
          needsVision: imageCount > 0 || stem.length < 12
        });
      }
    } catch (e) {}
    return { works: works, questions: questions };
  }
  function readHwState(){
    var boxes = document.querySelectorAll('.questionLi, .singleQuesId, .TiMu');
    var states = [];
    for (var i = 0; i < boxes.length && states.length < 40; i++) {
      var box = boxes[i];
      var selected = '';
      var nodes = box.querySelectorAll('.answerBg, .answer_item, .num_option, [aria-checked], input[type="radio"], input[type="checkbox"]');
      for (var n = 0; n < nodes.length; n++) {
        var el = nodes[n];
        var letter = String((el.getAttribute && el.getAttribute('data')) || '').toUpperCase();
        if (!/^[A-H]$/.test(letter)) {
          var child = el.querySelector && el.querySelector('.num_option, [data]');
          letter = String((child && child.getAttribute('data')) || '').toUpperCase();
        }
        if (!/^[A-H]$/.test(letter)) {
          var t = String(el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ');
          letter = (t.match(/^([A-H])/) || [])[1] || '';
        }
        var cls = String(el.className || '') + ' ' + String((el.parentElement && el.parentElement.className) || '');
        var on = /check_answer|checked|active|selected/.test(cls)
          || String(el.getAttribute && el.getAttribute('aria-checked') || '') === 'true'
          || Boolean(el.checked);
        if (on && letter && selected.indexOf(letter) < 0) selected += letter;
      }
      var blank = '';
      var inputs = box.querySelectorAll('input[type="text"], textarea');
      for (var b = 0; b < inputs.length; b++) blank += String(inputs[b].value || '');
      states.push({
        index: i + 1,
        selected: selected,
        filled: Boolean(selected || String(blank).trim())
      });
    }
    return { ts: Date.now(), count: states.length, states: states };
  }
  function bindHwSync(){
    if (window.__ZE_HW_BOUND__) return;
    var hasBox = false;
    try { hasBox = Boolean(document.querySelector('.questionLi, .singleQuesId, .TiMu')); } catch (e) {}
    if (!hasBox) return;
    window.__ZE_HW_BOUND__ = true;
    var send = function(){
      var state = readHwState();
      if (!state.count) return;
      try { window.__ZE_HW_STATE__ = state; } catch (e) {}
      var topWin = false;
      try { topWin = window.top === window; } catch (e2) { topWin = false; }
      if (!topWin) {
        state.__ze = 1;
        state.op = 'hwstate';
        reply(state);
      }
    };
    document.addEventListener('click', function(){ setTimeout(send, 30); }, true);
    document.addEventListener('change', function(){ setTimeout(send, 30); }, true);
    document.addEventListener('input', function(){ setTimeout(send, 80); }, true);
    setInterval(send, 1500);
    send();
  }
  function shotQuestion(index, done){
    var boxes = document.querySelectorAll('.questionLi, .singleQuesId, .TiMu');
    var box = boxes[Number(index) || 0];
    if (!box) { done(''); return; }
    try { box.scrollIntoView({ block: 'center' }); } catch (e) {}
    var imgs = [];
    var raw = box.querySelectorAll('img');
    for (var i = 0; i < raw.length && imgs.length < 8; i++) {
      var img = raw[i];
      var src = String(img.src || '');
      var w = img.naturalWidth || img.width || 0;
      var h = img.naturalHeight || img.height || 0;
      if (!src || /icon|logo|radio|check|btn|avatar|pixel/.test(src)) continue;
      if (w && h && (w < 16 || h < 16)) continue;
      imgs.push(img);
    }
    if (!imgs.length) { done(''); return; }
    var blobs = new Array(imgs.length);
    var ready = 0;
    var finish = function(){
      var pads = [];
      var maxW = 0;
      var totalH = 0;
      for (var i = 0; i < blobs.length; i++) {
        var im = blobs[i];
        if (!im) continue;
        var iw = im.naturalWidth || im.width || 1;
        var ih = im.naturalHeight || im.height || 1;
        var scale = Math.min(1, 720 / iw);
        pads.push({ im: im, dw: Math.round(iw * scale), dh: Math.round(ih * scale) });
        maxW = Math.max(maxW, Math.round(iw * scale));
        totalH += Math.round(ih * scale) + 8;
      }
      if (!pads.length) { done(''); return; }
      var c = document.createElement('canvas');
      c.width = maxW;
      c.height = Math.min(totalH, 2400);
      var ctx = c.getContext('2d');
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, c.width, c.height);
      var y = 0;
      for (var j = 0; j < pads.length && y < c.height; j++) {
        ctx.drawImage(pads[j].im, 0, y, pads[j].dw, pads[j].dh);
        y += pads[j].dh + 8;
      }
      try { done(c.toDataURL('image/jpeg', 0.72)); } catch (e) { done(''); }
    };
    var go = function(i, el){ blobs[i] = el; ready += 1; if (ready >= imgs.length) finish(); };
    for (var n = 0; n < imgs.length; n++) {
      (function(idx, img){
        try {
          var c = document.createElement('canvas');
          c.width = img.naturalWidth || img.width || 1;
          c.height = img.naturalHeight || img.height || 1;
          c.getContext('2d').drawImage(img, 0, 0);
          var im = new Image();
          im.onload = function(){ go(idx, im); };
          im.onerror = function(){ go(idx, null); };
          im.src = c.toDataURL('image/jpeg', 0.85);
          return;
        } catch (e) {}
        fetch(img.src, { credentials: 'include', cache: 'force-cache' }).then(function(res){ return res.blob(); }).then(function(blob){
          var reader = new FileReader();
          reader.onload = function(){
            var im = new Image();
            im.onload = function(){ go(idx, im); };
            im.onerror = function(){ go(idx, null); };
            im.src = String(reader.result || '');
          };
          reader.onerror = function(){ go(idx, null); };
          reader.readAsDataURL(blob);
        }).catch(function(){ go(idx, null); });
      })(n, imgs[n]);
    }
  }
  function snap(){
    var href = hrefOf();
    var text = textOf();
    var title = String(document.title || '');
    if (title.indexOf('ZRRESULT:') === 0) title = '';
    var hw = workSnap();
    var kind = kindOf(href, text);
    if (hw.works.length || hw.questions.length) kind = 'work';
    return { href: href, title: title, text: text.slice(0, 12000), kind: kind, works: hw.works, questions: hw.questions };
  }
  function fanout(data){
    try {
      var list = document.querySelectorAll('iframe');
      for (var i = 0; i < list.length; i++) {
        try { list[i].contentWindow.postMessage(data, '*'); } catch (e) {}
      }
    } catch (e) {}
    try {
      for (var j = 0; j < window.frames.length; j++) {
        try { window.frames[j].postMessage(data, '*'); } catch (e) {}
      }
    } catch (e) {}
  }
  function clickText(want){
    want = String(want || '').replace(/\s+/g, ' ').trim();
    if (!want) return false;
    var compact = function(v){ return String(v || '').replace(/\s+/g, ''); };
    var target = compact(want.replace(/[（(]\s*\d+\s*[）)]\s*$/g, ''));
    var nodes = document.querySelectorAll('a, button, [role="tab"], [role="button"], span, div, li, h3, h4');
    var exactLink = null;
    var exact = null;
    var fuzzy = null;
    var href = '';
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var label = compact(el.getAttribute('title') || el.innerText || el.textContent || '');
      if (!label) continue;
      var isExact = label === target;
      var isFuzzy = !isExact && label.length <= 48 && label.indexOf(target) >= 0;
      if (!isExact && !isFuzzy) continue;
      var a = el.tagName === 'A' ? el : (el.closest ? el.closest('a') : null);
      var link = '';
      try { link = String((a && (a.href || a.getAttribute('href'))) || ''); } catch (e) {}
      if (a && link && link.indexOf('javascript:') !== 0 && link !== '#') {
        if (isExact && !exactLink) { exactLink = a; href = link; }
        else if (!href) { exactLink = exactLink || a; href = link; }
      }
      if (isExact && !exact) exact = el;
      else if (isFuzzy && !fuzzy) fuzzy = el;
    }
    var hit = exactLink || exact || fuzzy;
    if (!hit) return false;
    var a = hit.tagName === 'A' ? hit : (hit.closest ? hit.closest('a') : null);
    if (a && (String(a.target || '') === '_blank' || String(a.target || '') === '_new')) a.target = '_self';
    try { (a || hit).scrollIntoView({ block: 'center' }); } catch (e) {}
    (a || hit).dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
    if (typeof (a || hit).click === 'function') (a || hit).click();
    if (href) openHere(href);
    return true;
  }
  function reply(payload){
    try { window.top.postMessage(payload, '*'); } catch (e) {
      try { window.parent.postMessage(payload, '*'); } catch (e2) {}
    }
  }
  var isTop = false;
  try { isTop = window.top === window; } catch (e) { isTop = false; }
  if (isTop) {
    window.__ZE_FRAME_SNAPS__ = [];
    window.__ZE_CLICKED__ = '';
    window.addEventListener('message', function(ev){
      var d = ev.data;
      if (!d || d.__ze !== 1) return;
      if (d.op === 'hello' || d.op === 'reply') {
        var next = [];
        var seen = {};
        var cur = window.__ZE_FRAME_SNAPS__ || [];
        var all = cur.concat([d]);
        for (var i = 0; i < all.length; i++) {
          var item = all[i];
          if (!item || !item.href) continue;
          var key = item.href + '|' + String(item.kind || '');
          if (seen[key]) continue;
          seen[key] = 1;
          next.push({ href: item.href, title: item.title || '', text: item.text || '', kind: item.kind || 'other', works: item.works || [], questions: item.questions || [] });
        }
        window.__ZE_FRAME_SNAPS__ = next;
      }
      if (d.op === 'clicked' && d.text) {
        window.__ZE_CLICKED__ = String(d.text);
        window.__ZE_CLICKED_HREF__ = String(d.href || '');
      }
      if (d.op === 'hwfilled') window.__ZE_HW_FILLED__ = d;
      if (d.op === 'hwstate' && d.states) window.__ZE_HW_STATE__ = d;
      if (d.op === 'hwsubmitted') window.__ZE_HW_SUBMITTED__ = d;
      if (d.op === 'hwshot') {
        window.__ZE_HW_SHOTS__ = window.__ZE_HW_SHOTS__ || {};
        var idx = Number(d.index || 0);
        if (d.image) window.__ZE_HW_SHOTS__[idx] = { ready: true, data: String(d.image || '') };
        else if (d.part != null) {
          var slot = window.__ZE_HW_SHOTS__[idx] || { parts: {}, got: 0, total: 0, ready: false, data: '' };
          slot.parts = slot.parts || {};
          slot.parts[d.off] = String(d.part || '');
          slot.total = Number(d.total || slot.total || 0);
          slot.got = 0;
          for (var pk in slot.parts) if (Object.prototype.hasOwnProperty.call(slot.parts, pk)) slot.got += String(slot.parts[pk] || '').length;
          if (slot.total && slot.got >= slot.total) {
            var keys = Object.keys(slot.parts).map(Number).sort(function(a,b){ return a - b; });
            var data = '';
            for (var ki = 0; ki < keys.length; ki++) data += slot.parts[keys[ki]];
            window.__ZE_HW_SHOTS__[idx] = { ready: true, data: data };
          } else {
            window.__ZE_HW_SHOTS__[idx] = slot;
          }
        }
      }
    });
    window.__ZE_ASK_FRAMES__ = function(op, extra){
      var msg = { __ze: 1, op: op || 'snap' };
      if (extra) {
        for (var k in extra) if (Object.prototype.hasOwnProperty.call(extra, k)) msg[k] = extra[k];
      }
      if (op === 'snap') {
        window.__ZE_FRAME_SNAPS__ = [];
        try {
          var self = snap();
          window.__ZE_FRAME_SNAPS__ = [{
            href: self.href,
            title: self.title || '',
            text: self.text || '',
            kind: self.kind || 'other',
            works: self.works || [],
            questions: self.questions || []
          }];
        } catch (eSnap) {}
      }
      if (op === 'click') { window.__ZE_CLICKED__ = ''; window.__ZE_CLICKED_HREF__ = ''; }
      if (op === 'hwfill') window.__ZE_HW_FILLED__ = null;
      if (op === 'hwsubmit') window.__ZE_HW_SUBMITTED__ = null;
      if (op === 'hwshot') {
        window.__ZE_HW_SHOTS__ = window.__ZE_HW_SHOTS__ || {};
        var shotIndex = extra && extra.index != null ? Number(extra.index) : -1;
        if (shotIndex >= 0) window.__ZE_HW_SHOTS__[shotIndex] = { ready: false, data: '', parts: {}, got: 0, total: 0 };
      }
      fanout(msg);
      return true;
    };
    bindHwSync();
  } else {
    window.addEventListener('message', function(ev){
      var d = ev.data;
      if (!d || d.__ze !== 1) return;
      if (d.op === 'snap' || d.op === 'click' || d.op === 'hwfill' || d.op === 'hwsubmit' || d.op === 'hwshot' || d.op === 'hwstate' || d.op === 'hwpick') fanout(d);
      if (d.op === 'snap') {
        var s = snap();
        s.__ze = 1;
        s.op = 'reply';
        reply(s);
      }
      if (d.op === 'click' && clickText(d.text)) {
        reply({ __ze: 1, op: 'clicked', text: d.text, href: hrefOf() });
      }
      if (d.op === 'hwfill') {
        var n = 0;
        try {
          var answers = d.answers;
          if (typeof answers === 'string') answers = JSON.parse(answers);
          var boxes = document.querySelectorAll('.questionLi, .singleQuesId, .TiMu');
          for (var ai = 0; answers && ai < answers.length; ai++) {
            var ans = answers[ai] || {};
            var want = String(ans.id || ans.questionId || '');
            var box = null;
            for (var bi = 0; bi < boxes.length; bi++) {
              var bid = String(boxes[bi].getAttribute('data') || boxes[bi].getAttribute('questionid') || '');
              if (want && bid === want) box = boxes[bi];
            }
            if (!box && ans.index) box = boxes[Number(ans.index) - 1];
            if (!box) continue;
            var letters = String(ans.answer || '').toUpperCase();
            var nodes = box.querySelectorAll('.answerBg, .answer_item, .num_option, ul li, label');
            for (var ni = 0; ni < nodes.length; ni++) {
              var tx = String(nodes[ni].innerText || nodes[ni].getAttribute('data') || '').replace(/\\s+/g, ' ').trim();
              var letter = (tx.match(/^([A-H])/) || [])[1] || '';
              if (letter && letters.indexOf(letter) >= 0) {
                nodes[ni].click();
                n += 1;
              }
            }
            var inputs = box.querySelectorAll('input[type="text"], textarea');
            var parts = String(ans.answer || '').split(/[;；\\n]/);
            for (var ii = 0; ii < inputs.length; ii++) {
              if (!parts[ii] && ii) continue;
              inputs[ii].value = parts[ii] || String(ans.answer || '');
              inputs[ii].dispatchEvent(new Event('input', { bubbles: true }));
              if (inputs[ii].value) n += 1;
            }
          }
        } catch (e) {}
        if (n) reply({ __ze: 1, op: 'hwfilled', filled: n, href: hrefOf() });
        try {
          bindHwSync();
          var filledState = readHwState();
          if (filledState.count) {
            filledState.__ze = 1;
            filledState.op = 'hwstate';
            reply(filledState);
          }
        } catch (e2) {}
      }
      if (d.op === 'hwstate') {
        bindHwSync();
        var asked = readHwState();
        if (asked.count) {
          asked.__ze = 1;
          asked.op = 'hwstate';
          reply(asked);
        }
      }
      if (d.op === 'hwpick') {
        try {
          var pboxes = document.querySelectorAll('.questionLi, .singleQuesId, .TiMu');
          var pbox = pboxes[Math.max(0, Number(d.index || 1) - 1)];
          var pletter = String(d.letter || '').toUpperCase();
          if (pbox && pletter) {
            var pnodes = pbox.querySelectorAll('.answerBg, .answer_item, .num_option, ul li, label');
            for (var pi = 0; pi < pnodes.length; pi++) {
              var pdata = String((pnodes[pi].getAttribute && pnodes[pi].getAttribute('data')) || '').toUpperCase();
              var ptx = String(pnodes[pi].innerText || '').replace(/\\s+/g, ' ').trim();
              var hit = /^[A-H]$/.test(pdata) ? pdata : ((ptx.match(/^([A-H])/) || [])[1] || '');
              if (hit === pletter) {
                pnodes[pi].click();
                break;
              }
            }
          }
          bindHwSync();
          var picked = readHwState();
          if (picked.count) {
            picked.__ze = 1;
            picked.op = 'hwstate';
            reply(picked);
          }
        } catch (e3) {}
      }
      if (d.op === 'hwsubmit') {
        var hit = document.querySelector('#submitBtn, .Btn_blue, input[value="提交"]');
        if (!hit) {
          var all = document.querySelectorAll('a, button, input, span');
          for (var si = 0; si < all.length; si++) {
            if (String(all[si].value || all[si].innerText || '').trim() === '提交') { hit = all[si]; break; }
          }
        }
        if (hit) {
          hit.click();
          reply({ __ze: 1, op: 'hwsubmitted', href: hrefOf() });
        } else if (typeof window.btnBlueSubmit === 'function') {
          window.btnBlueSubmit();
          reply({ __ze: 1, op: 'hwsubmitted', href: hrefOf() });
        }
      }
      if (d.op === 'hwshot') {
        shotQuestion(d.index, function(data){
          if (!data) { reply({ __ze: 1, op: 'hwshot', index: Number(d.index || 0), image: '' }); return; }
          var size = 7000;
          if (data.length <= size) { reply({ __ze: 1, op: 'hwshot', index: Number(d.index || 0), image: data }); return; }
          for (var off = 0; off < data.length; off += size) {
            reply({ __ze: 1, op: 'hwshot', index: Number(d.index || 0), part: data.slice(off, off + size), off: off, total: data.length });
          }
        });
      }
    });
    var hello = snap();
    hello.__ze = 1;
    hello.op = 'hello';
    reply(hello);
    bindHwSync();
  }
})();
"#;

#[derive(Clone, Serialize)]
pub struct BrowserPageState {
  id: String,
  url: String,
  title: String,
}

fn label_for(id: &str) -> Result<String, String> {
  let id = id.trim();
  if id.is_empty()
    || !id
      .chars()
      .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '/' | ':'))
  {
    return Err("浏览器标识无效".into());
  }
  Ok(format!("{LABEL_PREFIX}{id}"))
}

fn id_from_label(label: &str) -> Option<&str> {
  label.strip_prefix(LABEL_PREFIX)
}

fn is_home(raw: &str) -> bool {
  let trimmed = raw.trim();
  trimmed.is_empty()
    || trimmed == "zerror://home"
    || trimmed.contains("browser-home.html")
}

fn home_webview_url() -> WebviewUrl {
  if cfg!(debug_assertions) {
    WebviewUrl::External("http://localhost:1420/browser-home.html".parse().unwrap())
  } else {
    WebviewUrl::App("/browser-home.html".into())
  }
}

fn home_nav_url() -> Url {
  if cfg!(debug_assertions) {
    "http://localhost:1420/browser-home.html".parse().unwrap()
  } else {
    Url::parse("tauri://localhost/browser-home.html")
      .or_else(|_| Url::parse("https://tauri.localhost/browser-home.html"))
      .expect("home url")
  }
}

fn parse_url(raw: &str) -> Result<Url, String> {
  if is_home(raw) {
    return Ok(home_nav_url());
  }
  let trimmed = raw.trim();
  let candidate = if trimmed.contains("://") {
    trimmed.to_string()
  } else {
    format!("https://{trimmed}")
  };
  let url = Url::parse(&candidate).map_err(|err| format!("地址无效: {err}"))?;
  match url.scheme() {
    "http" | "https" | "tauri" => Ok(url),
    _ => Err("只支持 http/https 地址".into()),
  }
}

fn open_webview_url(raw: &str) -> Result<WebviewUrl, String> {
  if is_home(raw) {
    return Ok(home_webview_url());
  }
  Ok(WebviewUrl::External(parse_url(raw)?))
}

fn parent_window(app: &AppHandle) -> Result<tauri::Window, String> {
  app
    .get_webview("main")
    .map(|webview| webview.window())
    .ok_or_else(|| "主窗口不存在".into())
}

fn find_browser(app: &AppHandle, id: &str) -> Result<tauri::Webview, String> {
  let label = label_for(id)?;
  app
    .get_webview(&label)
    .ok_or_else(|| "浏览器尚未打开".into())
}

fn pending_evals() -> &'static Mutex<HashMap<String, tokio::sync::oneshot::Sender<String>>> {
  static MAP: OnceLock<Mutex<HashMap<String, tokio::sync::oneshot::Sender<String>>>> = OnceLock::new();
  MAP.get_or_init(|| Mutex::new(HashMap::new()))
}

fn take_eval(token: &str) -> Option<tokio::sync::oneshot::Sender<String>> {
  pending_evals().lock().ok()?.remove(token)
}

fn handle_title_change(app: &AppHandle, id: &str, url: String, title: String) {
  if let Some(rest) = title.strip_prefix("ZRRESULT:") {
    if let Some((token, payload)) = rest.split_once(':') {
      if let Some(tx) = take_eval(token) {
        let _ = tx.send(payload.to_string());
      }
    }
    return;
  }
  emit_state(app, id, url, title);
}

fn emit_state(app: &AppHandle, id: &str, url: String, title: String) {
  let _ = app.emit(
    "app-browser-state",
    BrowserPageState {
      id: id.to_string(),
      url,
      title,
    },
  );
}

fn emit_opened(app: &AppHandle, id: &str, url: String) {
  let _ = app.emit(
    "app-browser-opened",
    BrowserPageState {
      id: id.to_string(),
      url,
      title: String::new(),
    },
  );
}

fn new_browser_id() -> String {
  format!(
    "{:x}{:x}",
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|value| value.as_nanos())
      .unwrap_or(0),
    std::process::id()
  )
}

fn shared_data_dir(app: &AppHandle) -> Result<std::path::PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|err| err.to_string())?
    .join("app-browsers")
    .join("profile");
  std::fs::create_dir_all(&dir).map_err(|err| format!("创建浏览器数据目录失败: {err}"))?;
  Ok(dir)
}

fn hide_others(app: &AppHandle, keep_label: &str) {
  for (label, webview) in app.webviews() {
    if label != keep_label && id_from_label(&label).is_some() {
      let _ = webview.hide();
    }
  }
}

static APP_ABOVE_PAGE: AtomicBool = AtomicBool::new(false);

fn raise_nsview(webview: &tauri::Webview) {
  let _ = webview.with_webview(|platform| {
    #[cfg(target_os = "macos")]
    unsafe {
      use objc2::msg_send;
      use objc2::runtime::AnyObject;
      let view = platform.inner() as *mut AnyObject;
      if view.is_null() {
        return;
      }
      let superview: *mut AnyObject = msg_send![view, superview];
      if superview.is_null() {
        return;
      }
      let _: () = msg_send![superview, addSubview: view];
    }
    #[cfg(not(target_os = "macos"))]
    let _ = platform;
  });
}

fn set_webview_transparent(webview: &tauri::Webview, transparent: bool) {
  let _ = webview.with_webview(move |platform| {
    #[cfg(target_os = "macos")]
    unsafe {
      use objc2::msg_send;
      use objc2::runtime::{AnyClass, AnyObject};
      use objc2_foundation::NSString;
      let view = platform.inner() as *mut AnyObject;
      if view.is_null() {
        return;
      }
      let _: () = msg_send![view, setWantsLayer: true];
      let _: () = msg_send![view, setOpaque: !transparent];
      if let Some(nsnumber) = AnyClass::get(c"NSNumber") {
        let value: *mut AnyObject = msg_send![nsnumber, numberWithBool: !transparent];
        let key = NSString::from_str("drawsBackground");
        let _: () = msg_send![view, setValue: value, forKey: &*key];
      }
      if let Some(nscolor) = AnyClass::get(c"NSColor") {
        let color: *mut AnyObject = if transparent {
          msg_send![nscolor, clearColor]
        } else {
          msg_send![nscolor, windowBackgroundColor]
        };
        let _: () = msg_send![view, setUnderPageBackgroundColor: color];
        let layer: *mut AnyObject = msg_send![view, layer];
        if !layer.is_null() {
          let _: () = msg_send![layer, setOpaque: !transparent];
          if transparent {
            let cg: *mut std::ffi::c_void = msg_send![color, CGColor];
            let _: () = msg_send![layer, setBackgroundColor: cg];
          }
        }
      }
    }
    #[cfg(not(target_os = "macos"))]
    let _ = (platform, transparent);
  });
}

fn close_legacy_overlay(app: &AppHandle) {
  if let Some(overlay) = app.get_webview(OVERLAY_LABEL) {
    let _ = overlay.close();
  }
}

fn raise_page_or_app(app: &AppHandle) {
  if APP_ABOVE_PAGE.load(Ordering::SeqCst) {
    if let Some(main) = app.get_webview("main") {
      raise_nsview(&main);
    }
    return;
  }
}

fn raise_browser_page(app: &AppHandle, id: Option<&str>) {
  if let Some(id) = id {
    if let Ok(webview) = find_browser(app, id) {
      raise_nsview(&webview);
      return;
    }
  }
  for (label, webview) in app.webviews() {
    if id_from_label(&label).is_some() {
      raise_nsview(&webview);
    }
  }
}

fn apply_bounds(webview: &tauri::Webview, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
  let width = width.max(1.0);
  let height = height.max(1.0);
  webview
    .set_position(LogicalPosition::new(x.max(0.0), y.max(0.0)))
    .map_err(|err| err.to_string())?;
  webview
    .set_size(LogicalSize::new(width, height))
    .map_err(|err| err.to_string())?;
  Ok(())
}

#[tauri::command]
pub async fn browser_open(
  app: AppHandle,
  id: String,
  url: String,
  x: f64,
  y: f64,
  width: f64,
  height: f64,
) -> Result<(), String> {
  let label = label_for(&id)?;
  let parsed = open_webview_url(&url)?;
  hide_others(&app, &label);
  if let Some(existing) = app.get_webview(&label) {
    apply_bounds(&existing, x, y, width, height)?;
    existing.show().map_err(|err| err.to_string())?;
    return Ok(());
  }

  let window = parent_window(&app)?;
  let data_dir = shared_data_dir(&app)?;

  let state_id = id.clone();
  let title_id = id.clone();
  let popup_app = app.clone();
  let mut builder = WebviewBuilder::new(&label, parsed)
    .data_directory(data_dir)
    .focused(true)
    .accept_first_mouse(true)
    .initialization_script_for_all_frames(FRAME_BRIDGE)
    .on_new_window(move |url, _features| {
      let scheme = url.scheme();
      if scheme == "http" || scheme == "https" {
        let id = new_browser_id();
        emit_opened(&popup_app, &id, url.to_string());
      }
      NewWindowResponse::Deny
    })
    .on_page_load(move |webview, payload| {
      if payload.event() == PageLoadEvent::Finished {
        emit_state(
          webview.app_handle(),
          &state_id,
          payload.url().to_string(),
          String::new(),
        );
      }
    })
    .on_document_title_changed(move |webview, title| {
      let url = webview
        .url()
        .map(|value| value.to_string())
        .unwrap_or_default();
      handle_title_change(webview.app_handle(), &title_id, url, title);
    });

  #[cfg(debug_assertions)]
  {
    builder = builder.devtools(true);
  }

  let webview = window
    .add_child(
      builder,
      LogicalPosition::new(x.max(0.0), y.max(0.0)),
      LogicalSize::new(width.max(1.0), height.max(1.0)),
    )
    .map_err(|err| err.to_string())?;
  webview.show().map_err(|err| err.to_string())?;
  raise_page_or_app(&app);
  Ok(())
}

#[tauri::command]
pub async fn browser_set_bounds(
  app: AppHandle,
  id: String,
  x: f64,
  y: f64,
  width: f64,
  height: f64,
) -> Result<(), String> {
  let webview = find_browser(&app, &id)?;
  apply_bounds(&webview, x, y, width, height)?;
  raise_page_or_app(&app);
  Ok(())
}

#[tauri::command]
pub async fn browser_show(app: AppHandle, id: String) -> Result<(), String> {
  find_browser(&app, &id)?
    .show()
    .map_err(|err| err.to_string())?;
  raise_page_or_app(&app);
  Ok(())
}

#[tauri::command]
pub async fn browser_hide(app: AppHandle, id: String) -> Result<(), String> {
  find_browser(&app, &id)?
    .hide()
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn browser_hide_all(app: AppHandle) -> Result<(), String> {
  for (label, webview) in app.webviews() {
    if id_from_label(&label).is_some() {
      let _ = webview.hide();
    }
  }
  Ok(())
}

#[tauri::command]
pub async fn browser_close(app: AppHandle, id: String) -> Result<(), String> {
  if let Ok(webview) = find_browser(&app, &id) {
    webview.close().map_err(|err| err.to_string())?;
  }
  Ok(())
}

#[tauri::command]
pub async fn browser_navigate(app: AppHandle, id: String, url: String) -> Result<(), String> {
  find_browser(&app, &id)?
    .navigate(parse_url(&url)?)
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn browser_reload(app: AppHandle, id: String) -> Result<(), String> {
  find_browser(&app, &id)?
    .reload()
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn browser_go_back(app: AppHandle, id: String) -> Result<(), String> {
  find_browser(&app, &id)?
    .eval("history.back()")
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn browser_go_forward(app: AppHandle, id: String) -> Result<(), String> {
  find_browser(&app, &id)?
    .eval("history.forward()")
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn browser_set_zoom(app: AppHandle, id: String, zoom: f64) -> Result<(), String> {
  let zoom = if zoom.is_finite() {
    zoom.clamp(0.25, 5.0)
  } else {
    1.0
  };
  find_browser(&app, &id)?
    .set_zoom(zoom)
    .map_err(|err| err.to_string())
}

#[tauri::command]
pub async fn browser_get_state(app: AppHandle, id: String) -> Result<BrowserPageState, String> {
  let webview = find_browser(&app, &id)?;
  Ok(BrowserPageState {
    id,
    url: webview
      .url()
      .map(|value| value.to_string())
      .unwrap_or_default(),
    title: String::new(),
  })
}

fn prepare_eval_script(script: &str) -> String {
  let trimmed = script.trim();
  // 已经是 IIFE / 表达式时不要再包一层，否则 return 值会丢成 null。
  let already = trimmed.starts_with("(function")
    || trimmed.starts_with("(()=>")
    || trimmed.starts_with("(() =>")
    || trimmed.starts_with("(async")
    || trimmed.ends_with(")()")
    || trimmed.ends_with(")();");
  if already {
    return trimmed.to_string();
  }
  if trimmed.contains("return ") || trimmed.starts_with("return") {
    return format!("(function(){{\n{trimmed}\n}})()");
  }
  trimmed.to_string()
}

#[tauri::command]
pub async fn browser_set_app_above_page(
  app: AppHandle,
  above: bool,
  id: Option<String>,
) -> Result<(), String> {
  close_legacy_overlay(&app);
  APP_ABOVE_PAGE.store(above, Ordering::SeqCst);
  let Some(main) = app.get_webview("main") else {
    return Err("主窗口不存在".into());
  };
  if above {
    set_webview_transparent(&main, true);
    raise_nsview(&main);
  } else {
    raise_browser_page(&app, id.as_deref());
    set_webview_transparent(&main, false);
  }
  Ok(())
}

fn new_eval_token() -> String {
  format!(
    "{:x}{:x}",
    std::time::SystemTime::now()
      .duration_since(std::time::UNIX_EPOCH)
      .map(|value| value.as_nanos())
      .unwrap_or(0),
    std::process::id()
  )
}

async fn eval_wait_title(
  webview: &tauri::Webview,
  token: String,
  script: String,
) -> Result<String, String> {
  let (tx, rx) = tokio::sync::oneshot::channel();
  pending_evals()
    .lock()
    .map_err(|_| "执行通道被占用".to_string())?
    .insert(token.clone(), tx);
  if let Err(err) = webview.eval(&script) {
    let _ = take_eval(&token);
    return Err(err.to_string());
  }
  match tokio::time::timeout(Duration::from_secs(10), rx).await {
    Ok(Ok(payload)) => Ok(payload),
    Ok(Err(_)) => Err("执行结果丢失".into()),
    Err(_) => {
      let _ = take_eval(&token);
      Err("执行超时".into())
    }
  }
}

#[tauri::command]
pub async fn browser_eval(app: AppHandle, id: String, script: String) -> Result<String, String> {
  let script = script.trim();
  if script.is_empty() {
    return Err("脚本不能为空".into());
  }
  if script.len() > 40_000 {
    return Err("脚本过长".into());
  }
  let webview = find_browser(&app, &id)?;
  let token = new_eval_token();
  let prepared = prepare_eval_script(script);
  // 作业页 CSP 会拦 eval()。WK 注入的脚本直接当表达式跑，结果先放 window，标题只当信号。
  let mut wrapped = String::from("(function(){\n  var prev = document.title;\n  try {\n    var value = ");
  wrapped.push_str(&prepared);
  wrapped.push_str(";\n    window.__ZE_EVAL_MAP__ = window.__ZE_EVAL_MAP__ || {};\n    window.__ZE_EVAL_MAP__[\"");
  wrapped.push_str(&token);
  wrapped.push_str("\"] = { buf: JSON.stringify(value === undefined ? null : value), off: 0 };\n    document.title = \"ZRRESULT:");
  wrapped.push_str(&token);
  wrapped.push_str(":__READY__\";\n  } catch (e) {\n    window.__ZE_EVAL_MAP__ = window.__ZE_EVAL_MAP__ || {};\n    window.__ZE_EVAL_MAP__[\"");
  wrapped.push_str(&token);
  wrapped.push_str("\"] = { buf: JSON.stringify({__error: String(e && e.message || e)}), off: 0 };\n    document.title = \"ZRRESULT:");
  wrapped.push_str(&token);
  wrapped.push_str(":__READY__\";\n  }\n  setTimeout(function(){ document.title = prev; }, 30);\n})();");
  let first = eval_wait_title(&webview, token.clone(), wrapped).await?;
  if first != "__READY__" {
    return Ok(first);
  }
  let mut out = String::new();
  for _ in 0..200 {
    let chunk_token = new_eval_token();
    let chunk_js = format!(
      r#"(function(){{
  var prev = document.title;
  var slot = (window.__ZE_EVAL_MAP__ || {{}})["{src}"];
  var s = slot ? String(slot.buf || '') : '';
  var off = slot ? (slot.off | 0) : 0;
  var chunk = s.slice(off, off + 360);
  if (slot) slot.off = off + chunk.length;
  document.title = "ZRRESULT:{chunk_token}:" + JSON.stringify({{c: chunk, d: !slot || slot.off >= s.length}});
  setTimeout(function(){{ document.title = prev; }}, 20);
}})();"#,
      src = token,
      chunk_token = chunk_token
    );
    let raw = eval_wait_title(&webview, chunk_token, chunk_js).await?;
    let parsed: serde_json::Value =
      serde_json::from_str(&raw).map_err(|_| "读取执行结果失败".to_string())?;
    if let Some(chunk) = parsed.get("c").and_then(|v| v.as_str()) {
      out.push_str(chunk);
    }
    if parsed.get("d").and_then(|v| v.as_bool()).unwrap_or(false) {
      let _ = webview.eval(&format!(
        r#"(function(){{ try {{ if (window.__ZE_EVAL_MAP__) delete window.__ZE_EVAL_MAP__["{token}"]; }} catch (e) {{}} }})();"#
      ));
      return Ok(out);
    }
  }
  Err("执行结果过长".into())
}
