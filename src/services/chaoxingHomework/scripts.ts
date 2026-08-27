import { SAME_ORIGIN_FRAMES } from '../browserEval'

export const READ_HOMEWORK_SNAPS = `(function(){
  var extras = window.__ZE_FRAME_SNAPS__ || [];
  var out = [];
  for (var i = 0; i < extras.length && out.length < 8; i++) {
    var item = extras[i] || {};
    var questions = item.questions || [];
    var works = item.works || [];
    out.push({
      href: String(item.href || '').slice(0, 400),
      kind: String(item.kind || ''),
      title: String(item.title || '').slice(0, 80),
      text: (questions.length || works.length) ? '' : String(item.text || '').slice(0, 5000),
      works: works.slice(0, 20),
      questions: questions.slice(0, 40)
    });
  }
  return {
    url: location.href || '',
    title: String(document.title || ''),
    text: ((document.body && document.body.innerText) || '').slice(0, 4000),
    extras: out,
    asked: typeof window.__ZE_ASK_FRAMES__ === 'function'
  };
})()`

export const READ_HOMEWORK_IMAGES = `(function(){
  function abs(img){
    var s = String((img && (img.getAttribute('data-original') || img.getAttribute('src') || img.src)) || '');
    if (!s || s.indexOf('data:') === 0) return '';
    if (/logo|avatar|pixel|spacer|blank.gif|radio|check/i.test(s)) return '';
    if (s.indexOf('//') === 0) s = 'https:' + s;
    if (s.indexOf('http://') === 0) s = 'https://' + s.slice(7);
    if (s.charAt(0) === '/') s = (location.origin || 'https://mooc1.chaoxing.com') + s;
    return s.length > 800 ? '' : s;
  }
  function imgs(el){
    if (!el) return [];
    var out = [], list = el.querySelectorAll('img');
    for (var i = 0; i < list.length && out.length < 8; i++) {
      var s = abs(list[i]);
      if (s && out.indexOf(s) < 0) out.push(s);
    }
    return out;
  }
  var boxes = document.querySelectorAll('.questionLi');
  if (!boxes.length) boxes = document.querySelectorAll('.singleQuesId');
  var out = [];
  for (var q = 0; q < boxes.length && out.length < 40; q++) {
    var box = boxes[q];
    var h3 = box.querySelector('h3.mark_name, h3');
    var wraps = box.querySelectorAll('.stem_answer .answerBg, .answerBg');
    var options = [];
    for (var o = 0; o < wraps.length && options.length < 8; o++) {
      var pics = imgs(wraps[o].querySelector('.answer_p') || wraps[o]);
      options.push({ letter: String.fromCharCode(65 + o), text: '', image: pics[0] || '', images: pics });
    }
    var stemImgs = imgs(h3);
    out.push({ index: q + 1, images: stemImgs, options: options, imageCount: stemImgs.length });
  }
  return out;
})()`

export const STASH_HOMEWORK = `(function(){
  function txt(el){ return String((el && (el.textContent || '')) || '').replace(/\\s+/g, ' ').trim(); }
  var boxes = document.querySelectorAll('.questionLi');
  if (!boxes.length) boxes = document.querySelectorAll('.singleQuesId');
  var qs = [];
  var imgs = [];
  function absSrc(src){
    src = String(src || '');
    if (!src || src.indexOf('data:') === 0) return '';
    if (src.indexOf('//') === 0) src = 'https:' + src;
    if (src.indexOf('http://') === 0) src = 'https://' + src.slice(7);
    if (src.charAt(0) === '/') src = (location.origin || 'https://mooc1.chaoxing.com') + src;
    return src;
  }
  function takeImgs(el, q, role, letter){
    if (!el) return { keys: [], srcs: [] };
    var keys = [], srcs = [];
    var list = el.querySelectorAll('img');
    for (var i = 0; i < list.length && keys.length < 6; i++) {
      var img = list[i];
      var src = absSrc(img.getAttribute('data-original') || img.getAttribute('src') || img.src || '');
      if (!src) continue;
      if (/logo|avatar|pixel|spacer|blank.gif|radio|check/i.test(src)) continue;
      var key = 'q' + q + '-' + role + (letter || '') + '-' + keys.length;
      keys.push(key);
      srcs.push(src);
      imgs.push({ key: key, el: img, src: src });
    }
    return { keys: keys, srcs: srcs };
  }
  for (var q = 0; q < boxes.length && qs.length < 40; q++) {
    var box = boxes[q];
    var h3 = box.querySelector('h3.mark_name, h3');
    var typeName = String(box.getAttribute('typename') || box.getAttribute('typeName') || '').trim();
    if (!typeName) typeName = txt(box.querySelector('.colorShallow')).replace(/[（()）]/g, '') || '单选题';
    var stem = txt(h3).replace(/^\\d+[.、．\\s]*/, '').replace(/[（(]\\s*(单选题|多选题|判断题|填空题|简答题|问答题|计算题|论述题|不定项)\\s*[）)]/g, '').trim();
    var wraps = box.querySelectorAll('.stem_answer .answerBg, .answerBg');
    var opts = [];
    for (var o = 0; o < wraps.length && opts.length < 8; o++) {
      var w = wraps[o];
      var letterEl = w.querySelector('.num_option');
      var body = w.querySelector('.answer_p');
      var letter = String((letterEl && letterEl.getAttribute('data')) || '').trim().toUpperCase();
      var aria = String(w.getAttribute('aria-label') || '');
      if (!/^[A-H]$/.test(letter)) letter = (aria.match(/^([A-H])/) || [])[1] || String.fromCharCode(65 + opts.length);
      var text = txt(body);
      if (!text) {
        var am = aria.match(/^[A-H]\\s*(.*?)选择$/);
        text = am ? String(am[1] || '').trim() : '';
      }
      var optPics = takeImgs(body || w, q + 1, 'o', letter);
      opts.push({
        letter: letter,
        text: text.slice(0, 120),
        selected: /check_answer/.test(String((letterEl && letterEl.className) || '')) || w.getAttribute('aria-checked') === 'true',
        imageKeys: optPics.keys,
        images: optPics.srcs
      });
    }
    var stemPics = takeImgs(h3, q + 1, 's', '');
    if (!stem && stemPics.srcs.length) stem = '( )';
    qs.push({
      id: String(box.getAttribute('data') || q + 1),
      index: q + 1,
      type: /多选/.test(typeName) ? 'multi' : /填空/.test(typeName) ? 'blank' : /判断/.test(typeName) ? 'judge' : 'single',
      typeName: typeName,
      stem: stem.slice(0, 200),
      imageKeys: stemPics.keys,
      images: stemPics.srcs,
      options: opts,
      filled: opts.some(function(item){ return item.selected; })
    });
  }
  window.__ZE_HW_CARD__ = qs;
  window.__ZE_HW_IMGELS__ = imgs;
  return { questions: qs.length, images: imgs.length };
})()`

export const START_HW_IMG = (index: number) => `(function(){
  var item = (window.__ZE_HW_IMGELS__ || [])[${Number(index) || 0}];
  window.__ZE_HW_IMGOFF__ = 0;
  var fallback = String((item && item.src) || '');
  if (fallback.indexOf('http://') === 0) fallback = 'https://' + fallback.slice(7);
  if (!item || !item.el) {
    window.__ZE_HW_IMGONE__ = { key: String((item && item.key) || ''), data: fallback, wait: 0 };
    return { wait: 0, n: fallback.length };
  }
  window.__ZE_HW_IMGONE__ = { key: item.key, data: '', wait: 1 };
  var img = item.el;
  var finish = function(data){
    window.__ZE_HW_IMGONE__ = { key: item.key, data: String(data || fallback || ''), wait: 0 };
  };
  var toJpeg = function(source){
    var w = source.naturalWidth || source.width || 0;
    var h = source.naturalHeight || source.height || 0;
    if (!w || !h) return '';
    var scale = Math.min(1, 240 / w, 72 / h);
    var c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(w * scale));
    c.height = Math.max(1, Math.round(h * scale));
    var ctx = c.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(source, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.62);
  };
  try {
    var direct = toJpeg(img);
    if (direct) { finish(direct); return { wait: 0, n: direct.length }; }
  } catch (e1) {}
  var src = String(img.currentSrc || img.src || img.getAttribute('data-original') || fallback || '');
  if (src.indexOf('http://') === 0) src = 'https://' + src.slice(7);
  if (!src) { finish(fallback); return { wait: 0, n: fallback.length }; }
  fetch(src, { credentials: 'omit', cache: 'force-cache' }).then(function(res){ return res.blob(); }).then(function(blob){
    var url = URL.createObjectURL(blob);
    var im = new Image();
    im.onload = function(){
      try { finish(toJpeg(im)); } catch (e2) {
        var fr = new FileReader();
        fr.onload = function(){ finish(String(fr.result || fallback)); };
        fr.onerror = function(){ finish(fallback); };
        fr.readAsDataURL(blob);
      }
      URL.revokeObjectURL(url);
    };
    im.onerror = function(){ URL.revokeObjectURL(url); finish(fallback); };
    im.src = url;
  }).catch(function(){ finish(fallback); });
  return { wait: 1, n: 0 };
})()`

export const READ_HW_IMG_META = `(function(){
  var row = window.__ZE_HW_IMGONE__ || {};
  return { wait: !!row.wait, key: String(row.key || ''), n: String(row.data || '').length };
})()`

export const READ_HW_IMG_CHUNK = `(function(){
  var row = window.__ZE_HW_IMGONE__ || {};
  if (row.wait) return { wait: 1, c: '', d: false };
  var s = String(row.data || '');
  var off = window.__ZE_HW_IMGOFF__ | 0;
  var chunk = s.slice(off, off + 300);
  window.__ZE_HW_IMGOFF__ = off + chunk.length;
  return { wait: 0, key: String(row.key || ''), c: chunk, d: off + chunk.length >= s.length };
})()`

export const READ_HOMEWORK_BOXES = `(function(){
  function txt(el){
    if (!el) return '';
    return String(el.textContent || el.innerText || '').replace(/\\s+/g, ' ').trim();
  }
  function abs(img){
    var s = String((img && (img.getAttribute('data-original') || img.getAttribute('src') || img.src)) || '');
    if (!s || s.indexOf('data:') === 0) return '';
    if (/logo|avatar|pixel|spacer|blank.gif|radio|check/i.test(s)) return '';
    if (s.indexOf('//') === 0) s = 'https:' + s;
    if (s.indexOf('http://') === 0) s = 'https://' + s.slice(7);
    if (s.charAt(0) === '/') s = (location.origin || 'https://mooc1.chaoxing.com') + s;
    return s.length > 800 ? '' : s;
  }
  function imgs(el){
    if (!el) return [];
    var out = [], list = el.querySelectorAll('img');
    for (var i = 0; i < list.length && out.length < 6; i++) {
      var s = abs(list[i]);
      if (s && out.indexOf(s) < 0) out.push(s);
    }
    return out;
  }
  var boxes = document.querySelectorAll('.questionLi');
  if (!boxes.length) boxes = document.querySelectorAll('.singleQuesId');
  var out = [];
  for (var q = 0; q < boxes.length && out.length < 40; q++) {
    var box = boxes[q];
    var h3 = box.querySelector('h3.mark_name, h3');
    var typeName = String(box.getAttribute('typename') || box.getAttribute('typeName') || '').trim();
    if (!typeName) typeName = txt(box.querySelector('.colorShallow')).replace(/[（()）]/g, '') || '单选题';
    var stem = txt(h3).replace(/^\\d+[.、．\\s]*/, '').replace(/[（(]\\s*(单选题|多选题|判断题|填空题|简答题|问答题|计算题|论述题|不定项)\\s*[）)]/g, '').trim();
    var wraps = box.querySelectorAll('.stem_answer .answerBg, .answerBg');
    var opts = [];
    for (var o = 0; o < wraps.length && opts.length < 8; o++) {
      var w = wraps[o];
      var letterEl = w.querySelector('.num_option');
      var body = w.querySelector('.answer_p');
      var letter = String((letterEl && letterEl.getAttribute('data')) || '').trim().toUpperCase();
      var aria = String(w.getAttribute('aria-label') || '');
      if (!/^[A-H]$/.test(letter)) letter = (aria.match(/^([A-H])/) || [])[1] || String.fromCharCode(65 + opts.length);
      var text = txt(body);
      if (!text) {
        var am = aria.match(/^[A-H]\\s*(.*?)选择$/);
        text = am ? String(am[1] || '').trim() : '';
      }
      var pics = imgs(body || w);
      opts.push({
        letter: letter,
        text: text.slice(0, 120),
        image: pics[0] || '',
        images: pics,
        selected: /check_answer/.test(String((letterEl && letterEl.className) || '')) || w.getAttribute('aria-checked') === 'true'
      });
    }
    var stemImgs = imgs(h3);
    out.push({
      id: String(box.getAttribute('data') || q + 1),
      index: q + 1,
      type: /多选/.test(typeName) ? 'multi' : /填空/.test(typeName) ? 'blank' : /判断/.test(typeName) ? 'judge' : 'single',
      typeName: typeName,
      stem: stem.slice(0, 200),
      images: stemImgs,
      options: opts,
      filled: opts.some(function(item){ return item.selected; }),
      imageCount: stemImgs.length + opts.reduce(function(n, item){ return n + (item.images || []).length; }, 0)
    });
  }
  return out;
})()`

export const READ_HOMEWORK_LIVE = `(function(){
  var count = function(sel){ return document.querySelectorAll(sel).length; };
  var boxes = document.querySelectorAll('.questionLi');
  if (!boxes.length) boxes = document.querySelectorAll('.singleQuesId');
  if (!boxes.length) boxes = document.querySelectorAll('.mark_item');
  var rows = [];
  for (var i = 0; i < boxes.length && rows.length < 16; i++) {
    rows.push({
      i: i + 1,
      t: String(boxes[i].innerText || '').replace(/\\s+/g, ' ').slice(0, 90),
      n: boxes[i].querySelectorAll('img').length
    });
  }
  var extras = window.__ZE_FRAME_SNAPS__ || [];
  var title = String(document.title || '');
  if (title.indexOf('ZRRESULT:') === 0) title = '';
  return {
    url: location.href || '',
    title: title.slice(0, 80),
    asked: typeof window.__ZE_ASK_FRAMES__ === 'function',
    extras: extras.length,
    extraQs: extras.reduce(function(n, item){ return Math.max(n, ((item && item.questions) || []).length); }, 0),
    counts: {
      questionLi: count('.questionLi'),
      singleQuesId: count('.singleQuesId'),
      markItem: count('.mark_item'),
      TiMu: count('.TiMu'),
      img: count('img')
    },
    rows: rows,
    text: ((document.body && document.body.innerText) || '').replace(/\\s+/g, ' ').slice(0, 500)
  };
})()`

export const READ_HW_FILL_STATE = `(function(){
  var boxes = document.querySelectorAll('.questionLi, .singleQuesId, .TiMu');
  var out = [];
  for (var i = 0; i < boxes.length && i < 40; i++) {
    var box = boxes[i];
    var selected = '';
    var nodes = box.querySelectorAll('.num_option, [class*="num_option"]');
    for (var n = 0; n < nodes.length; n++) {
      var el = nodes[n];
      var on = /check_answer|checked|active|selected/.test(String(el.className || ''))
        || el.getAttribute('aria-checked') === 'true'
        || (el.parentElement && /check_answer|checked/.test(String(el.parentElement.className || '')));
      if (on) selected += String(el.getAttribute('data') || String.fromCharCode(65 + n)).toUpperCase();
    }
    var filled = Boolean(selected);
    if (!filled) {
      var ins = box.querySelectorAll('input[type="text"], textarea');
      for (var k = 0; k < ins.length; k++) {
        if (String(ins[k].value || '').trim()) { filled = true; break; }
      }
    }
    out.push({ index: i + 1, selected: selected, filled: filled });
  }
  return { states: out };
})()`

// fill 点不上时抓题框现场：选项结构、onclick、选中类名，落盘到 cx-fill-debug.json
export const DEBUG_HW_BOX = (index: number) => `(function(){
  var boxes = document.querySelectorAll('.questionLi');
  if (!boxes.length) boxes = document.querySelectorAll('.singleQuesId');
  var box = boxes[${Math.max(0, index - 1)}];
  if (!box) return { found: false, boxes: boxes.length };
  var opts = box.querySelectorAll('.answerBg, .answer_item');
  var rows = [];
  for (var i = 0; i < opts.length && i < 8; i++) {
    var el = opts[i];
    var num = el.querySelector ? el.querySelector('.num_option, [class*="num_option"]') : null;
    rows.push({
      cls: String(el.className || ''),
      numData: num ? String(num.getAttribute('data') || '') : '',
      numCls: num ? String(num.className || '') : '',
      onclick: String(el.getAttribute('onclick') || ''),
      html: String(el.outerHTML || '').slice(0, 500)
    });
  }
  return {
    found: true,
    id: String(box.getAttribute('data') || box.id || ''),
    cls: String(box.className || '').slice(0, 120),
    addChoice: typeof window.addChoice,
    jquery: typeof window.jQuery,
    opts: rows
  };
})()`

export const READ_HW_PICKED = (index: number) => `(function(){
  var boxes = document.querySelectorAll('.questionLi');
  if (!boxes.length) boxes = document.querySelectorAll('.singleQuesId');
  var box = boxes[${Math.max(0, index - 1)}];
  if (!box) return { picked: '', found: false };
  var nodes = box.querySelectorAll('.num_option, [class*="num_option"]');
  var picked = '';
  for (var i = 0; i < nodes.length; i++) {
    var el = nodes[i];
    var on = /check_answer|checked|active|selected/.test(String(el.className || ''))
      || el.getAttribute('aria-checked') === 'true'
      || (el.parentElement && el.parentElement.getAttribute('aria-checked') === 'true');
    if (on) picked += String(el.getAttribute('data') || String.fromCharCode(65 + i)).toUpperCase();
  }
  return { picked: picked, found: true };
})()`

export const DIAGNOSE_HW_FRAMES = `${SAME_ORIGIN_FRAMES}
(function(){
  var frames = __sameFrames(window, 0);
  var out = [];
  for (var i = 0; i < frames.length && out.length < 8; i++) {
    var win = frames[i];
    try {
      var doc = win.document;
      var boxes = doc.querySelectorAll('.questionLi, .singleQuesId');
      out.push({
        i: i,
        href: String((win.location && win.location.href) || '').slice(0, 140),
        questionLi: boxes.length,
        addChoice: typeof win.addChoice,
        jquery: typeof win.jQuery,
        asked: typeof win.__ZE_ASK_FRAMES__ === 'function',
        bound: Boolean(win.__ZE_HW_BOUND__),
        stateCount: win.__ZE_HW_STATE__ && win.__ZE_HW_STATE__.states ? win.__ZE_HW_STATE__.states.length : 0
      });
    } catch (e) {
      out.push({ i: i, error: String(e) });
    }
  }
  var iframes = [];
  try {
    var list = document.querySelectorAll('iframe');
    for (var f = 0; f < list.length && iframes.length < 8; f++) {
      var src = '';
      try { src = String(list[f].src || ''); } catch (e2) {}
      iframes.push({ src: src.slice(0, 140) });
    }
  } catch (e3) {}
  return {
    href: location.href || '',
    asked: typeof window.__ZE_ASK_FRAMES__ === 'function',
    bound: Boolean(window.__ZE_HW_BOUND__),
    addChoice: typeof window.addChoice,
    frames: out,
    iframes: iframes
  };
})()`

export const PICK_HW_IN_FRAMES = (index: number, letter: string) => `${SAME_ORIGIN_FRAMES}
(function(){
  var want = ${JSON.stringify(letter)};
  var index = ${Math.max(1, index)};
  var frames = __sameFrames(window, 0);
  var fire = function(el){
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    var view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
    var rect = { left: 0, top: 0, width: 0, height: 0 };
    try { rect = el.getBoundingClientRect(); } catch (e2) {}
    var x = rect.left + (rect.width || 2) / 2;
    var y = rect.top + (rect.height || 2) / 2;
    try { el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: view, clientX: x, clientY: y })); } catch (e3) {}
    try { el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: view, clientX: x, clientY: y })); } catch (e4) {}
    if (typeof el.click === 'function') { try { el.click(); return true; } catch (e5) {} }
    try { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: view, clientX: x, clientY: y })); return true; } catch (e6) {}
    return false;
  };
  var selectedOf = function(box){
    var picked = '';
    var nodes = box.querySelectorAll('.num_option, [class*="num_option"]');
    for (var n = 0; n < nodes.length; n++) {
      var el = nodes[n];
      var on = /check_answer|checked|active|selected/.test(String(el.className || ''))
        || el.getAttribute('aria-checked') === 'true'
        || (el.parentElement && /check_answer|checked/.test(String(el.parentElement.className || '')));
      if (on) picked += String(el.getAttribute('data') || String.fromCharCode(65 + n)).toUpperCase();
    }
    return picked;
  };
  var tried = [];
  for (var i = 0; i < frames.length; i++) {
    var win = frames[i];
    var doc = null;
    try { doc = win.document; } catch (e) { continue; }
    if (!doc) continue;
    var boxes = doc.querySelectorAll('.questionLi, .singleQuesId, .TiMu');
    if (!boxes.length) {
      tried.push({ frame: i, boxes: 0 });
      continue;
    }
    var box = boxes[index - 1];
    if (!box) {
      tried.push({ frame: i, boxes: boxes.length, missingBox: true });
      continue;
    }
    var before = selectedOf(box);
    var rows = box.querySelectorAll('.stem_answer .answerBg, .answerBg, .answer_item');
    var hit = null;
    var opts = [];
    for (var r = 0; r < rows.length && r < 8; r++) {
      var row = rows[r];
      var num = row.querySelector ? row.querySelector('.num_option, [class*="num_option"]') : null;
      var data = String((num && num.getAttribute('data')) || row.getAttribute('data') || '').toUpperCase();
      var tx = String(row.innerText || '').replace(/\\s+/g, ' ').trim();
      var letter = /^[A-H]$/.test(data) ? data : ((tx.match(/^([A-H])/) || [])[1] || String.fromCharCode(65 + r));
      opts.push({
        letter: letter,
        onclick: String(row.getAttribute('onclick') || '').slice(0, 80),
        cls: String(row.className || '').slice(0, 80),
        numCls: num ? String(num.className || '').slice(0, 60) : ''
      });
      if (letter === want) hit = row;
    }
    var clicked = false;
    var via = '';
    if (hit) {
      clicked = fire(hit);
      via = 'answerBg';
      if (selectedOf(box).indexOf(want) < 0) {
        var numEl = hit.querySelector && hit.querySelector('.num_option');
        if (numEl) { fire(numEl); via = 'num_option'; }
      }
    }
    if (selectedOf(box).indexOf(want) < 0 && typeof win.addChoice === 'function' && hit) {
      try { win.addChoice(hit); via = 'addChoice'; clicked = true; } catch (eAdd) {
        tried.push({ frame: i, addChoiceError: String(eAdd) });
      }
    }
    var after = selectedOf(box);
    tried.push({
      frame: i,
      boxes: boxes.length,
      addChoice: typeof win.addChoice,
      before: before,
      after: after,
      clicked: clicked,
      via: via,
      opts: opts
    });
    if (after.indexOf(want) >= 0) {
      return { ok: true, reason: '已选中 ' + want + '（frame=' + i + ', via=' + via + '）', picked: after, tried: tried };
    }
  }
  return {
    ok: false,
    reason: tried.length
      ? '各 frame 都没点上 ' + want + '：' + tried.map(function(t){
          return 'f' + t.frame + '(boxes=' + t.boxes + (t.missingBox ? ',无此题' : '') + ',before=' + (t.before || '-') + ',after=' + (t.after || '-') + ',via=' + (t.via || '-') + ')';
        }).join('；')
      : '所有同源 frame 都没有 .questionLi',
    picked: '',
    tried: tried
  };
})()`
