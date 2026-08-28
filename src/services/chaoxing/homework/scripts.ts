import { SAME_ORIGIN_FRAMES } from '../../browser/eval'

/** 只认真正的题框，不要把 .TiMu 包裹层或侧栏答题卡算进去。 */
const HW_QUESTION_HELPERS = `
function __hwQuestionBoxes(doc){
  if (!doc || !doc.querySelectorAll) return [];
  var raw = doc.querySelectorAll('.questionLi');
  if (!raw.length) raw = doc.querySelectorAll('.singleQuesId');
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var el = raw[i];
    var inner = null;
    try { inner = el.querySelector('.questionLi, .singleQuesId'); } catch (e) {}
    if (inner && inner !== el) continue;
    out.push(el);
  }
  return out;
}
function __hwPickedOf(box){
  var picked = '';
  if (!box || !box.querySelectorAll) return picked;
  var rows = box.querySelectorAll('.stem_answer .answerBg, .answerBg');
  if (!rows.length) rows = box.querySelectorAll('.answer_item');
  for (var i = 0; i < rows.length && i < 8; i++) {
    var row = rows[i];
    if (row.querySelector && row.querySelector('.answerBg')) continue;
    var num = row.querySelector ? row.querySelector('.num_option') : null;
    var on = (row.getAttribute && row.getAttribute('aria-checked') === 'true')
      || (num && /(^|\\s)check_answer(\\s|$)/.test(String(num.className || '')));
    if (!on) continue;
    var letter = String((num && num.getAttribute('data')) || '').toUpperCase();
    if (!/^[A-H]$/.test(letter)) {
      var aria = String((row.getAttribute && row.getAttribute('aria-label')) || '');
      letter = ((aria.match(/^([A-H])/) || [])[1] || '');
    }
    if (/^[A-H]$/.test(letter) && picked.indexOf(letter) < 0) picked += letter;
  }
  return picked;
}
`

const hwFrameScript = (iife: string) =>
  `(function(){\n${SAME_ORIGIN_FRAMES}\n${HW_QUESTION_HELPERS}\nreturn ${iife.trim()};\n})()`

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
  ${SAME_ORIGIN_FRAMES}
  function txt(el){ return String((el && (el.textContent || '')) || '').replace(/\\s+/g, ' ').trim(); }
  ${HW_QUESTION_HELPERS}
  function findBoxes(){
    var frames = __sameFrames(window, 0);
    for (var f = 0; f < frames.length; f++) {
      try {
        var found = __hwQuestionBoxes(frames[f].document);
        if (found.length) return found;
      } catch (e) {}
    }
    return [];
  }
  var boxes = findBoxes();
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
  return { questions: qs, images: imgs.length };
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

export const READ_HW_FILL_STATE = hwFrameScript(`(function(){
  var frames = __sameFrames(window, 0);
  var best = [];
  for (var f = 0; f < frames.length; f++) {
    var doc = null;
    try { doc = frames[f].document; } catch (e) { continue; }
    if (!doc) continue;
    var boxes = __hwQuestionBoxes(doc);
    if (!boxes.length) continue;
    var out = [];
    for (var i = 0; i < boxes.length && i < 40; i++) {
      var selected = __hwPickedOf(boxes[i]);
      var filled = Boolean(selected);
      if (!filled) {
        var ins = boxes[i].querySelectorAll('input[type="text"], textarea');
        for (var k = 0; k < ins.length; k++) {
          if (String(ins[k].value || '').trim()) { filled = true; break; }
        }
      }
      out.push({ index: i + 1, selected: selected, filled: filled });
    }
    if (out.length > best.length) best = out;
  }
  return { states: best };
})()`)

/** 挂在学习通 addChoice 上，选项变化时只加脏标记，不改 DOM。 */
export const INSTALL_HW_LIVE_HOOK = hwFrameScript(`(function(){
  var root = window;
  if (root.__ZE_HW_LIVE__) {
    return { ok: true, already: true, dirty: root.__ZE_HW_DIRTY__ || 0, hooked: !!root.__ZE_HW_HOOKED__ };
  }
  root.__ZE_HW_LIVE__ = 1;
  root.__ZE_HW_DIRTY__ = 1;
  var mark = function(){ root.__ZE_HW_DIRTY__ = (root.__ZE_HW_DIRTY__ || 0) + 1; };
  var wrapFn = function(win, name){
    try {
      var fn = win[name];
      if (typeof fn !== 'function' || fn.__zeHw) return false;
      var wrapped = function(){
        var ret = fn.apply(this, arguments);
        mark();
        return ret;
      };
      wrapped.__zeHw = 1;
      win[name] = wrapped;
      return true;
    } catch (e) { return false; }
  };
  var hookWin = function(win){
    var hooked = wrapFn(win, 'addChoice') || wrapFn(win, 'addChoiceKeyDown');
    try {
      if (win.document && !win.__ZE_HW_CLICK__) {
        win.__ZE_HW_CLICK__ = 1;
        win.document.addEventListener('click', function(ev){
          var t = ev.target;
          if (!t || !t.closest) return;
          if (t.closest('.answerBg, .num_option, .answer_item, .workTextWrap')) mark();
        }, true);
      }
    } catch (e2) {}
    return hooked;
  };
  var frames = __sameFrames(window, 0);
  var hooked = 0;
  for (var i = 0; i < frames.length; i++) {
    if (hookWin(frames[i])) hooked += 1;
  }
  root.__ZE_HW_HOOKED__ = hooked;
  return { ok: true, already: false, dirty: root.__ZE_HW_DIRTY__, hooked: hooked, frames: frames.length };
})()`)

export const READ_HW_DIRTY = `(function(){ return { n: window.__ZE_HW_DIRTY__ || 0, hooked: window.__ZE_HW_HOOKED__ || 0 }; })()`

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

export const READ_HW_PICKED = (index: number) => hwFrameScript(`(function(){
  var at = ${Math.max(0, index - 1)};
  var frames = __sameFrames(window, 0);
  for (var f = 0; f < frames.length; f++) {
    var doc = null;
    try { doc = frames[f].document; } catch (e) { continue; }
    if (!doc) continue;
    var boxes = __hwQuestionBoxes(doc);
    var box = boxes[at];
    if (!box) continue;
    return { picked: __hwPickedOf(box), found: true };
  }
  return { picked: '', found: false };
})()`)

export const DIAGNOSE_HW_FRAMES = hwFrameScript(`(function(){
  var frames = __sameFrames(window, 0);
  var out = [];
  for (var i = 0; i < frames.length && out.length < 8; i++) {
    var win = frames[i];
    try {
      var boxes = __hwQuestionBoxes(win.document);
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
})()`)

export const PICK_HW_IN_FRAMES = (index: number, letter: string) => hwFrameScript(`(function(){
  var want = ${JSON.stringify(letter)};
  var index = ${Math.max(1, index)};
  var frames = __sameFrames(window, 0);
  var fire = function(el){
    if (!el) return false;
    try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
    if (typeof el.click === 'function') { try { el.click(); return true; } catch (e5) {} }
    try {
      var view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
      el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: view }));
      return true;
    } catch (e6) {}
    return false;
  };
  var tried = [];
  for (var i = 0; i < frames.length; i++) {
    var win = frames[i];
    var doc = null;
    try { doc = win.document; } catch (e) { continue; }
    if (!doc) continue;
    var boxes = __hwQuestionBoxes(doc);
    if (!boxes.length) {
      tried.push({ frame: i, boxes: 0 });
      continue;
    }
    var box = boxes[index - 1];
    if (!box) {
      tried.push({ frame: i, boxes: boxes.length, missingBox: true });
      continue;
    }
    var before = __hwPickedOf(box);
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
    }
    var after = __hwPickedOf(box);
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
    if (clicked) {
      return { ok: true, reason: '已点击 ' + want + '（frame=' + i + ', via=' + via + '）', picked: after, tried: tried };
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
})()`)
