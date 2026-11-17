// 作业 · helpers：认题盒/选项/按钮。parse 和 locate 都只用这一份。
function hwQCount(doc){
  if (!doc || !doc.querySelectorAll) return 0;
  try {
    return doc.querySelectorAll('.questionLi, .singleQuesId, .TiMu, .mark_item').length;
  } catch (e) { return 0; }
}

function hwHref(doc){
  try {
    var win = doc && doc.defaultView;
    return String((win && win.location && win.location.href) || '');
  } catch (e) { return ''; }
}

function hwIsWorkHref(href){
  return /doHomeWork|work\/do|workPreview|mooc-ans\/work|\/work\/phonetic|selectWork/.test(String(href || ''));
}

function hwFindDoc(doc, depth){
  if (!doc || (depth || 0) > 8) return null;
  var best = null;
  var bestScore = -1;
  function consider(hit){
    if (!hit) return;
    var n = hwQCount(hit);
    var href = hwHref(hit);
    var score = n * 100 + (hwIsWorkHref(href) ? 30 : 0);
    if (score > bestScore) { bestScore = score; best = hit; }
  }
  consider(doc);
  var list = [];
  try { list = doc.querySelectorAll('iframe'); } catch (e2) { return best; }
  for (var i = 0; i < list.length; i++) {
    var child = null;
    try { child = list[i].contentDocument; } catch (e3) {}
    if (!child) continue;
    consider(hwFindDoc(child, (depth || 0) + 1) || child);
  }
  return best;
}

function hwRoot(){
  return hwFindDoc(document, 0) || document;
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

function __hwClean(s){ return String(s || '').replace(/[\n\r\t]+/g, ' ').replace(/  +/g, ' ').trim(); }

function __hwTypeName(raw, code){
  var t = __hwClean(raw);
  if (/单选/.test(t) || code === '0') return 'single';
  if (/多选/.test(t) || code === '1') return 'multi';
  if (/填空/.test(t) || code === '2') return 'blank';
  if (/判断/.test(t) || code === '3') return 'judge';
  if (/简答|论述|计算|解答/.test(t) || code === '4' || code === '5') return 'text';
  return t ? 'other' : (code ? 'other' : 'unknown');
}

function __hwLetter(text){
  var m = __hwClean(text).match(/^([A-Ha-h])(?:[.、．\s)]|$)/);
  return m ? m[1].toUpperCase() : '';
}

function __hwBoxes(doc){
  if (!doc || !doc.querySelectorAll) {
    if (typeof hwRoot === 'function') doc = hwRoot();
    else if (typeof document !== 'undefined') doc = document;
  }
  if (!doc || !doc.querySelectorAll) return [];
  var raw = doc.querySelectorAll('.questionLi');
  if (!raw.length) raw = doc.querySelectorAll('.singleQuesId');
  if (!raw.length) raw = doc.querySelectorAll('.TiMu');
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

function hwBoxes(){ return __hwBoxes(typeof hwRoot === 'function' ? hwRoot() : document); }

function __hwChoiceNodes(box){
  if (!box || !box.querySelectorAll) return [];
  var lis = box.querySelectorAll('ul.Zy_ulTop li, li[onclick*="addChoice"], li[role="radio"], li[role="checkbox"]');
  if (lis.length) return Array.prototype.slice.call(lis);
  var wraps = box.querySelectorAll('.stem_answer .answerBg, .stem_answer .answer_item, .answerBg, .answer_item');
  if (wraps.length) return Array.prototype.slice.call(wraps);
  var nodes = box.querySelectorAll('span[class*="choice"], .num_option, a.checkDiv, .check_answer');
  if (nodes.length) return Array.prototype.slice.call(nodes);
  var legacy = box.querySelectorAll('.workTextWrap, .options li');
  var out = [];
  for (var i = 0; i < legacy.length; i++) {
    var kids = legacy[i].querySelectorAll('span, a, label');
    if (kids.length) {
      for (var k = 0; k < kids.length; k++) out.push(kids[k]);
    } else out.push(legacy[i]);
  }
  return out;
}

function __hwIsSelected(el){
  if (!el) return false;
  var cls = String(el.className || '');
  if (/check_answer|checked|active|selected|cur|choice_answer/.test(cls)) return true;
  if (el.getAttribute && el.getAttribute('aria-checked') === 'true') return true;
  try {
    if (el.querySelector && el.querySelector('input:checked')) return true;
    var num = el.querySelector && el.querySelector('.num_option, [class*="num_option"]');
    if (num && /check_answer|checked|active|selected/.test(String(num.className || ''))) return true;
    var p = el.parentElement;
    if (p && /check_answer|checked|active|selected/.test(String(p.className || ''))) return true;
  } catch (e) {}
  return false;
}

function __hwLetterOf(el, fallbackIndex){
  var letterEl = (el.matches && el.matches('.num_option, [class*="num_option"]'))
    ? el
    : (el.querySelector ? el.querySelector('.num_option, [class*="num_option"]') : null);
  var letter = String((letterEl && letterEl.getAttribute('data')) || '').trim().toUpperCase();
  if (!/^[A-H]$/.test(letter)) {
    var aria = String(el.getAttribute && el.getAttribute('aria-label') || '');
    letter = ((aria.match(/^([A-Ha-h])/) || [])[1] || '').toUpperCase();
  }
  if (!/^[A-H]$/.test(letter)) {
    var text = String(el.textContent || el.getAttribute && el.getAttribute('data') || '').replace(/\s+/g, ' ').trim();
    letter = __hwLetter(text) || __hwClean(el.getAttribute && el.getAttribute('data') || '').slice(0, 1).toUpperCase();
  }
  if (!/^[A-H]$/.test(letter) && fallbackIndex != null) letter = String.fromCharCode(65 + fallbackIndex);
  return { letter: letter, letterEl: letterEl };
}

function __hwClickTarget(el){
  if (el && el.matches && el.matches('.num_option') && el.closest) {
    return el.closest('li[onclick], li.font-cxsecret, li[role], .answerBg, .answer_item') || el;
  }
  return el;
}

function __hwFindOption(box, want){
  want = String(want || '').toUpperCase().replace(/[^A-H]/g, '').slice(0, 1);
  if (!box || !want) return null;
  var nodes = __hwChoiceNodes(box);
  for (var i = 0; i < nodes.length && i < 8; i++) {
    var el = nodes[i];
    var got = __hwLetterOf(el, i);
    var text = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    var letter = got.letter;
    if (/正确|对/.test(text) && want === 'A') letter = 'A';
    if (/错误|错/.test(text) && want === 'B') letter = 'B';
    if (letter !== want) continue;
    return { el: __hwClickTarget(el), letter: letter, letterEl: got.letterEl };
  }
  return null;
}

function __hwFindBlank(box, slot){
  if (!box || !box.querySelectorAll) return null;
  var inputs = box.querySelectorAll('input[type="text"], input.blank, input.blankInput, .blank input, textarea');
  var at = Math.max(0, Number(slot) || 0);
  return inputs[at] || inputs[0] || null;
}

function __hwTextBtn(doc, names){
  var nodes = doc.querySelectorAll('a, button, span, input');
  var want = Array.isArray(names) ? names : [names];
  for (var i = 0; i < nodes.length; i++) {
    var t = String(nodes[i].value || nodes[i].innerText || nodes[i].textContent || '').replace(/\s+/g, ' ').trim();
    for (var n = 0; n < want.length; n++) {
      if (t === want[n]) return nodes[i];
    }
  }
  return null;
}

function __hwFindControl(doc, name){
  if (!doc || !doc.querySelector) return null;
  if (name === 'save') {
    return doc.querySelector('a.btnSave, #tempsave, a[onclick*="noSubmit"]') || __hwTextBtn(doc, '暂时保存');
  }
  if (name === 'submit') {
    return doc.querySelector('a.btnSubmit, a[onclick*="btnBlueSubmit"], #submitBtn, .Btn_blue_1, input[value="提交"], .workSubmit')
      || __hwTextBtn(doc, ['提交', '交卷', '提交作业']);
  }
  if (name === 'confirm') {
    return doc.querySelector('#popok, #confirmSubWin .jb_btn, #confirmSubWin .btnBlue')
      || __hwTextBtn(doc, ['确定', '确认提交', '确认']);
  }
  if (name === 'homework-tab') {
    var sels = [
      '[title="作业"]',
      '[aria-label="作业"]',
      'a[href*="pageHeader=8"]',
      '[onclick*="pageHeader=8"]',
      '[data-url*="work"]',
      'a[data-url*="/work/"]',
      '[data-id="8"]',
      '[data-header="8"]'
    ];
    for (var s = 0; s < sels.length; s++) {
      var el = doc.querySelector(sels[s]);
      if (el) return el;
    }
  }
  return null;
}

function __hwFormulaOf(img){
  var raw = String((img && img.getAttribute && img.getAttribute('data')) || '');
  if (!raw) return '';
  try {
    var json = JSON.parse(decodeURIComponent(raw));
    return __hwClean(json.formula || json.latex || '');
  } catch (e) {
    return '';
  }
}

function __hwImgSrc(img){
  if (!img) return '';
  var raw = String(img.getAttribute && (img.getAttribute('data-original') || img.getAttribute('data-src') || img.getAttribute('src')) || img.src || '');
  if (!raw) return '';
  if (raw.indexOf('//') === 0) raw = 'https:' + raw;
  if (raw.indexOf('http://') === 0) raw = 'https://' + raw.slice(7);
  if (raw.charAt(0) === '/') {
    var origin = 'https://mooc1.chaoxing.com';
    try {
      var doc = img.ownerDocument || document;
      var base = String((doc && doc.baseURI) || '');
      if (base) origin = new URL(base).origin;
      else origin = ((doc && doc.defaultView) || window).location.origin || origin;
    } catch (e) {}
    raw = origin + raw;
  }
  return raw;
}

function __hwSkipImgSrc(src){
  src = String(src || '');
  if (!src) return true;
  if (/\/(?:icon|logo|avatar)(?:[-_./]|$)|pixel|blank\.gif|spacer|1x1|radio[-_]|check(?:box|ed)?[-_.]|btn[-_]/i.test(src)) return true;
  if (/\.svg(\?|$)/i.test(src) && !/latex|formula|ananas/i.test(src)) return true;
  return false;
}

function __hwImgs(box){
  var out = [];
  if (!box || !box.querySelectorAll) return out;
  var imgs = box.querySelectorAll('img');
  for (var i = 0; i < imgs.length && out.length < 12; i++) {
    var img = imgs[i];
    var src = __hwImgSrc(img);
    var w = img.naturalWidth || img.width || 0;
    var h = img.naturalHeight || img.height || 0;
    if (__hwSkipImgSrc(src)) continue;
    if (w && h && (w < 8 || h < 8) && !__hwFormulaOf(img) && !/latex|formula|ananas|star3/i.test(src)) continue;
    out.push(img);
  }
  return out;
}

function __hwImgUrls(el){
  return __hwImgs(el).map(__hwImgSrc).filter(Boolean);
}

function __hwRichText(el){
  if (!el) return '';
  var parts = [];
  var walk = function(node){
    if (!node) return;
    if (node.nodeType === 3) {
      var t = __hwClean(node.textContent);
      if (t) parts.push(t);
      return;
    }
    if (node.nodeType !== 1) return;
    if (String(node.tagName || '').toUpperCase() === 'IMG') {
      var f = __hwFormulaOf(node);
      if (f) {
        parts.push('$' + f + '$');
        return;
      }
      var alt = __hwClean((node.getAttribute && (node.getAttribute('alt') || node.getAttribute('title'))) || '');
      parts.push(alt || '\uFFFC');
      return;
    }
    var kids = node.childNodes || [];
    for (var i = 0; i < kids.length; i++) walk(kids[i]);
  };
  walk(el);
  return __hwClean(parts.join(' ')).replace(/\uFFFC/g, '').replace(/  +/g, ' ').trim();
}

function __hwOptions(box){
  var out = [];
  var nodes = __hwChoiceNodes(box);
  for (var i = 0; i < nodes.length && out.length < 12; i++) {
    var el = nodes[i];
    var bodyEl = el.querySelector
      ? (el.querySelector('.answer_p, a.fl.after, a.after, .fl.after') || null)
      : null;
    var got = __hwLetterOf(el, out.length);
    var letter = got.letter;
    var host = bodyEl || el;
    var images = __hwImgUrls(host);
    if (!images.length && el !== host) images = __hwImgUrls(el);
    var text = __hwRichText(host) || __hwClean(host.innerText || host.textContent || '');
    if (!/^[A-H]$/.test(letter)) letter = __hwLetter(text) || letter;
    if (!/^[A-H]$/.test(letter)) letter = String.fromCharCode(65 + out.length);
    text = text.replace(/^[A-H][.、．)\s]*/, '').slice(0, 240);
    if (!text && !images.length && !bodyEl && !got.letterEl) continue;
    if (out.some(function(item){ return item.letter === letter; })) continue;
    out.push({
      letter: letter,
      text: text || '',
      selected: __hwIsSelected(got.letterEl || el),
      image: images[0] || '',
      images: images,
    });
  }
  return out;
}

function __hwPickedOf(box){
  var picked = '';
  var opts = __hwOptions(box);
  for (var i = 0; i < opts.length; i++) {
    if (opts[i].selected && picked.indexOf(opts[i].letter) < 0) picked += opts[i].letter;
  }
  return picked;
}

function __hwActions(doc){
  if (!doc || !doc.querySelector) return { canSave: false, canSubmit: false };
  var save = !!(doc.querySelector('.btnSave, #tempsave, a[onclick*="noSubmit"]'));
  var submit = !!(doc.querySelector('.btnSubmit, a[onclick*="btnBlueSubmit"], #submitBtn'));
  return { canSave: save, canSubmit: submit };
}
