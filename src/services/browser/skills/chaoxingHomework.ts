const hwJs = `
function __hwClean(s){ return String(s || '').replace(/[\\n\\r\\t]+/g, ' ').replace(/  +/g, ' ').trim(); }
function __hwClick(el){
  if (!el) return false;
  try { el.scrollIntoView({ block: 'center' }); } catch (e) {}
  var view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
  var rect = { left: 0, top: 0, width: 0, height: 0 };
  try { rect = el.getBoundingClientRect(); } catch (e) {}
  var x = rect.left + (rect.width || 2) / 2;
  var y = rect.top + (rect.height || 2) / 2;
  var fire = function(type, Ctor){
    try {
      el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: view, clientX: x, clientY: y }));
    } catch (e) {}
  };
  if (typeof PointerEvent === 'function') { fire('pointerdown', PointerEvent); }
  fire('mousedown', MouseEvent);
  if (typeof PointerEvent === 'function') { fire('pointerup', PointerEvent); }
  fire('mouseup', MouseEvent);
  // 只能触发一次 click：学习通选项再点一次是「取消选择」，双击等于没点
  if (typeof el.click === 'function') {
    try { el.click(); return true; } catch (e) {}
  }
  fire('click', MouseEvent);
  return true;
}
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
  var m = __hwClean(text).match(/^([A-Ha-h])(?:[.、．\\s)]|$)/);
  return m ? m[1].toUpperCase() : '';
}
function __hwBoxes(doc){
  if (!doc || !doc.querySelectorAll) return [];
  var prefer = doc.querySelectorAll('.questionLi, .singleQuesId, .mark_item');
  if (prefer.length) return Array.prototype.slice.call(prefer);
  var timu = doc.querySelectorAll('.TiMu');
  if (timu.length) return Array.prototype.slice.call(timu);
  return [];
}
function __hwChoiceNodes(box){
  if (!box || !box.querySelectorAll) return [];
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
    var p = el.parentElement;
    if (p && /check_answer|checked|active|selected/.test(String(p.className || ''))) return true;
  } catch (e) {}
  return false;
}
function __hwOptions(box){
  var out = [];
  var nodes = __hwChoiceNodes(box);
  for (var i = 0; i < nodes.length && out.length < 12; i++) {
    var el = nodes[i];
    var bodyEl = el.querySelector ? el.querySelector('.answer_p') : null;
    var letterEl = el.querySelector ? el.querySelector('.num_option, [class*="num_option"]') : null;
    var letter = String((letterEl && letterEl.getAttribute('data')) || '').trim().toUpperCase();
    if (!/^[A-H]$/.test(letter)) {
      var aria = String(el.getAttribute && el.getAttribute('aria-label') || '');
      letter = (aria.match(/^([A-H])\s/) || [])[1] || '';
    }
    var text = __hwClean(bodyEl ? bodyEl.innerText : (el.getAttribute('data') || el.innerText || el.textContent || ''));
    if (!/^[A-H]$/.test(letter)) letter = __hwLetter(text) || __hwClean(el.getAttribute('data') || '').slice(0, 1).toUpperCase();
    if (!/^[A-H]$/.test(letter) && /正确|对/.test(text)) letter = 'A';
    if (!/^[A-H]$/.test(letter) && /错误|错/.test(text)) letter = 'B';
    if (!/^[A-H]$/.test(letter)) letter = String.fromCharCode(65 + out.length);
    text = text.replace(/^[A-H][.、．)\s]*/, '').slice(0, 120);
    if (!text && !bodyEl) continue;
    if (out.some(function(item){ return item.letter === letter; })) continue;
    out.push({ letter: letter, text: text || '', selected: __hwIsSelected(letterEl || el) });
  }
  return out;
}
function __hwStem(box){
  var el = box.querySelector('h3.mark_name, h3 .mark_name, h3, .Zy_TItle, .mark_name, .qtTitle, .question-title, .stem, .quesTitle');
  var text = __hwClean((el && (el.innerText || el.textContent)) || '');
  text = text.replace(/^\d+[.、．\s]*/, '').replace(/[（(]\s*(单选题|多选题|填空题|判断题|简答题)\s*[）)]/g, '').replace(/\(\s*\)/g, ' ').trim();
  if (!text) {
    var raw = __hwClean(box.innerText || '');
    text = (raw.split(/A[.、．\s]/)[0] || raw).replace(/^\d+[.、．\s]*/, '').trim();
  }
  return text.split(/(?=[A-H][.、．\s])/)[0]?.trim() || text.slice(0, 400);
}
function __hwImgs(box){
  var out = [];
  var imgs = box.querySelectorAll('img');
  for (var i = 0; i < imgs.length && out.length < 10; i++) {
    var img = imgs[i];
    var src = String(img.src || img.getAttribute('src') || '');
    var w = img.naturalWidth || img.width || 0;
    var h = img.naturalHeight || img.height || 0;
    if (!src || /icon|logo|radio|check|btn|avatar|pixel|blank\\.gif|spacer|\\.svg(\\?|$)/i.test(src)) continue;
    if (w && h && (w < 16 || h < 16)) continue;
    out.push(img);
  }
  return out;
}
function __hwShotBox(box, done){
  var list = __hwImgs(box);
  if (!list.length) { done(''); return; }
  var blobs = new Array(list.length);
  var ready = 0;
  var finish = function(){
    var pads = [];
    var maxW = 0;
    var totalH = 0;
    for (var i = 0; i < blobs.length; i++) {
      var im = blobs[i];
      if (!im || !(im.width || im.naturalWidth)) continue;
      var iw = im.naturalWidth || im.width;
      var ih = im.naturalHeight || im.height;
      var scale = Math.min(1, 720 / Math.max(iw, 1));
      var dw = Math.max(1, Math.round(iw * scale));
      var dh = Math.max(1, Math.round(ih * scale));
      pads.push({ im: im, dw: dw, dh: dh });
      maxW = Math.max(maxW, dw);
      totalH += dh + 8;
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
  var go = function(i, el){
    blobs[i] = el;
    ready += 1;
    if (ready >= list.length) finish();
  };
  for (var n = 0; n < list.length; n++) {
    (function(idx, img){
      var loadData = function(url){
        var im = new Image();
        im.onload = function(){ go(idx, im); };
        im.onerror = function(){ go(idx, null); };
        im.src = url;
      };
      try {
        var c = document.createElement('canvas');
        c.width = img.naturalWidth || img.width || 1;
        c.height = img.naturalHeight || img.height || 1;
        var ctx = c.getContext('2d');
        ctx.drawImage(img, 0, 0);
        loadData(c.toDataURL('image/jpeg', 0.85));
        return;
      } catch (e) {}
      fetch(img.src, { credentials: 'include', cache: 'force-cache' }).then(function(res){ return res.blob(); }).then(function(blob){
        var reader = new FileReader();
        reader.onload = function(){ loadData(String(reader.result || '')); };
        reader.onerror = function(){ go(idx, null); };
        reader.readAsDataURL(blob);
      }).catch(function(){ go(idx, img.complete ? img : null); });
    })(n, list[n]);
  }
}
function __hwParseBox(box, index){
  var id = String(box.getAttribute('data') || box.getAttribute('questionid') || box.getAttribute('data-questionid') || box.id || index + 1);
  var typeName = box.getAttribute('typeName') || box.getAttribute('typename') || '';
  var typeCode = '';
  try {
    var tm = box.classList && box.classList.contains('TiMu') ? box : box.querySelector('.TiMu');
    typeCode = String((tm && tm.getAttribute('data')) || '');
  } catch (e) {}
  if (!typeName) {
    var tag = box.querySelector('.newZy_TItle, .Zy_type, .colorShallow, .qType');
    typeName = __hwClean(tag && (tag.innerText || tag.textContent) || '');
  }
  var type = __hwTypeName(typeName, typeCode);
  var options = type === 'blank' || type === 'text' ? [] : __hwOptions(box);
  var filled = options.some(function(item){ return item.selected; });
  if (!filled) {
    var inputs = box.querySelectorAll('input[type="text"], textarea');
    for (var i = 0; i < inputs.length; i++) {
      if (__hwClean(inputs[i].value)) { filled = true; break; }
    }
  }
  var stem = __hwStem(box);
  var idxHit = stem.match(/^\\s*(\\d+)/);
  var qIndex = Number(idxHit && idxHit[1]) || (index + 1);
  var stemBody = stem
    .replace(/^\\d+\\s*[.、．)）]\\s*/, '')
    .replace(/^\\d+(?=[（(]|单选|多选|填空|判断|简答)/, '')
    .replace(/^[（(]\\s*(单选题|多选题|填空题|判断题|简答题|计算题|论述题|单选|多选|填空|判断)\\s*[)）]\\s*/, '')
    .trim();
  var imgs = __hwImgs(box);
  var imageUrls = [];
  for (var g = 0; g < imgs.length && imageUrls.length < 6; g++) {
    var src = String(imgs[g].src || imgs[g].getAttribute('src') || '');
    if (src) imageUrls.push(src);
  }
  var imageCount = imgs.length;
  var optText = options.map(function(item){ return item.text; }).join('');
  var needsVision = imageCount > 0 || stemBody.length < 12 || /（图像）|\\(图像\\)|公式图/.test(stemBody + optText);
  return {
    id: id,
    index: qIndex,
    type: type,
    typeName: __hwClean(typeName) || type,
    stem: stemBody.slice(0, 400),
    images: imageUrls,
    options: options,
    filled: filled,
    imageCount: imageCount,
    needsVision: needsVision,
  };
}
function __hwParseQuestions(doc){
  var boxes = __hwBoxes(doc);
  var out = [];
  for (var i = 0; i < boxes.length && out.length < 40; i++) {
    var q = __hwParseBox(boxes[i], i);
    if (q.stem || q.options.length || q.imageCount) out.push(q);
  }
  return out;
}
function __hwParseText(text){
  var out = [];
  var blocks = String(text || '').split(/\\n(?=\\d+\\.\\s*[（(])/);
  for (var i = 0; i < blocks.length && out.length < 40; i++) {
    var lines = blocks[i].split('\\n').map(__hwClean).filter(Boolean);
    if (!lines.length || !/^\\d+\\./.test(lines[0])) continue;
    var typeName = (lines[0].match(/[（(]([^）)]+)[）)]/) || [])[1] || '单选';
    var opts = [];
    var stem = [];
    for (var L = 1; L < lines.length; L++) {
      var m = lines[L].match(/^([A-H])(?:[.、．)]\\s*)?(.*)$/);
      if (m && (m[2] || opts.length || /^[A-H]$/.test(lines[L]))) {
        opts.push({ letter: m[1], text: (m[2] || '').slice(0, 80), selected: false });
      } else if (!opts.length) stem.push(lines[L]);
    }
    out.push({
      id: String(out.length + 1),
      index: out.length + 1,
      type: __hwTypeName(typeName, ''),
      typeName: typeName,
      stem: stem.join(' ').slice(0, 180),
      options: opts,
      filled: false,
      imageCount: 0,
      needsVision: stem.join('').length < 8 || opts.filter(function(o){ return o.text; }).length < 2,
    });
  }
  return out;
}
function __hwParseWorks(doc, href){
  var out = [];
  var seen = {};
  var add = function(title, status, score, due, link){
    title = __hwClean(title).replace(/^[（(]\\d+[）)]\\s*/, '');
    if (!title || title.length < 2 || title.length > 80 || seen[title]) return;
    if (/^作业$|^测验$|^考试$|^章节$/.test(title)) return;
    seen[title] = 1;
    var st = __hwClean(status);
    if (!st) st = /已完成|已批阅/.test(title) ? '已完成' : /待批阅/.test(title) ? '待批阅' : '待做';
    out.push({ title: title, status: st, score: __hwClean(score), due: __hwClean(due), href: __hwClean(link) });
  };
  var links = doc.querySelectorAll('a[href*="work"], a[href*="Work"], a[onclick*="work"], .titTxt a, .workName a, .work-title, .bottomList a');
  for (var i = 0; i < links.length && out.length < 40; i++) {
    var a = links[i];
    var title = a.getAttribute('title') || a.innerText || a.textContent || '';
    var wrap = a.closest ? (a.closest('li, .workLi, .work-item, tr, .listLi') || a.parentElement) : a.parentElement;
    var block = __hwClean((wrap && (wrap.innerText || wrap.textContent)) || '');
    var status = '';
    if (/待做|未做|未完成/.test(block)) status = '待做';
    else if (/待批阅/.test(block)) status = '待批阅';
    else if (/已完成|已批阅|已交/.test(block)) status = '已完成';
    var score = (block.match(/\\d+(?:\\.\\d+)?\\s*分/) || [])[0] || '';
    var due = (block.match(/\\d{4}[-./]\\d{1,2}[-./]\\d{1,2}[^\\n]{0,12}/) || [])[0] || '';
    add(title, status, score, due, a.href || a.getAttribute('href') || href);
  }
  if (!out.length) {
    var text = __hwClean((doc.body && doc.body.innerText) || '');
    var lines = String((doc.body && doc.body.innerText) || '').split('\\n').map(__hwClean).filter(Boolean);
    for (var j = 0; j < lines.length && out.length < 40; j++) {
      var line = lines[j];
      var next = lines[j + 1] || '';
      if (/待做|未做|待批阅|已完成|已批阅/.test(next) && line.length >= 2 && line.length <= 60 && !/截止日期|作业列表|开始时间/.test(line)) {
        add(line, next, '', '', href);
      }
    }
    if (!out.length && /暂无作业|没有作业/.test(text)) return [];
  }
  return out;
}
function __hwPageOf(href, text, questions, works){
  href = String(href || '');
  text = String(text || '');
  if (questions.length) return /view|已批阅|正确答案/.test(href + text) ? 'view' : 'do';
  if (works.length || /作业列表|work\\/list|mooc2\\/work/.test(href + text)) return 'list';
  if (/\\/mycourse\\/stu/.test(href) && /作业/.test(text)) return 'course';
  return 'other';
}
`

export const CHAOXING_CLICK_HOMEWORK_TAB = `(function(){
  ${hwJs}
  var sels = ['a[data-url*="work"]', '[data-url*="work"]', 'a[data-url*="/work/"]', 'a[href*="pageHeader=8"]'];
  for (var s = 0; s < sels.length; s++) {
    var el = document.querySelector(sels[s]);
    if (!el) continue;
    __hwClick(el);
    return { ok: true, via: sels[s] };
  }
  var nodes = document.querySelectorAll('a, [role="tab"], li, span, div');
  for (var i = 0; i < nodes.length; i++) {
    var t = __hwClean(nodes[i].getAttribute('title') || nodes[i].textContent || '');
    if (t === '作业') {
      __hwClick(nodes[i]);
      return { ok: true, via: 'text' };
    }
  }
  return { ok: false, error: '没有作业标签' };
})()`

export const CHAOXING_HOMEWORK_INSPECT = `(function(){
  ${hwJs}
  var href = location.href || '';
  var topText = ((document.body && document.body.innerText) || '');
  var questions = __hwParseQuestions(document);
  var works = __hwParseWorks(document, href);
  try {
    var extras = window.__ZE_FRAME_SNAPS__ || [];
    for (var e = 0; e < extras.length; e++) {
      var item = extras[e] || {};
      var extraText = String(item.text || '');
      var extraHref = String(item.href || '');
      if (item.works && item.works.length && item.works.length > works.length) works = item.works;
      if (item.questions && item.questions.length && item.questions.length > questions.length) questions = item.questions;
      if (!works.length && /作业|待做|待批阅|已完成/.test(extraText)) {
        var fake = document.implementation.createHTMLDocument('hw');
        fake.body.textContent = extraText;
        var parsed = __hwParseWorks(fake, extraHref);
        if (parsed.length) works = parsed;
      }
      if (!questions.length && /【单选|【多选|【填空|【判断|选择题|填空题/.test(extraText)) {
        // 跨域答题页只有正文时，至少带回题干行
        var lines = extraText.split('\\n').map(__hwClean).filter(function(line){ return line.length > 6 && line.length < 200; });
        for (var li = 0; li < lines.length && questions.length < 40; li++) {
          if (/^\\d+[.、]|【单选|【多选|【填空|【判断|【简答/.test(lines[li])) {
            questions.push({ id: String(questions.length + 1), index: questions.length + 1, type: __hwTypeName(lines[li], ''), typeName: '', stem: lines[li].slice(0, 400), options: [], filled: false });
          }
        }
      }
    }
  } catch (err) {}
  if (!questions.length) questions = __hwParseText(topText);
  var page = __hwPageOf(href, topText, questions, works);
  var pending = works.filter(function(item){ return item.status === '待做' || item.status === '未做' || item.status === '未完成'; });
  var title = __hwClean((topText.match(/作业[^\\n]{0,40}/) || [])[0] || '');
  if (title.length > 40) title = title.slice(0, 40);
  var compact = questions.map(function(q){
    return {
      id: q.id,
      index: q.index,
      type: q.type,
      typeName: q.typeName,
      stem: String(q.stem || '').slice(0, 400),
      images: (q.images || []).slice(0, 6),
      options: (q.options || []).slice(0, 8).map(function(o){ return { letter: o.letter, text: String(o.text || '').slice(0, 80), selected: !!o.selected, image: o.image || '', images: o.images || [] }; }),
      filled: !!q.filled,
      imageCount: q.imageCount || 0,
      needsVision: !!q.needsVision,
    };
  });
  return {
    ok: true,
    page: page,
    title: title,
    url: href,
    works: works.slice(0, 20),
    pending: pending.slice(0, 20),
    pendingCount: pending.length,
    questions: compact,
    questionCount: compact.length,
    filledCount: compact.filter(function(q){ return q.filled; }).length,
    hint: page === 'list'
      ? (pending.length ? ('待做 ' + pending.length + ' 份：' + pending.map(function(w){ return w.title; }).join('、') + '。调用 browser_chaoxing_homework action=open，title 填作业名。') : (works.length ? '没有待做作业。' : '作业列表还没读到。先点「作业」再 list。'))
      : page === 'do'
        ? ('已读到 ' + questions.length + ' 道题。公式/题目图会自动用视觉模型读成文字。自己作答后 browser_chaoxing_homework action=fill。')
        : page === 'view'
          ? '这是已交/查看页，不要再提交。'
          : '不在作业页。先打开课程再点「作业」。',
  };
})()`

export const CHAOXING_HOMEWORK_CAPTURE = `(function(index){
  ${hwJs}
  index = Number(index || 0);
  window.__ZE_HW_LOCAL_SHOTS__ = window.__ZE_HW_LOCAL_SHOTS__ || {};
  var boxes = __hwBoxes(document);
  var box = boxes[index];
  if (!box) return { ok: false, error: '没有第' + (index + 1) + '题' };
  try { box.scrollIntoView({ block: 'center' }); } catch (e) {}
  var slot = window.__ZE_HW_LOCAL_SHOTS__[index];
  if (slot && slot.ready) return { ok: true, ready: true, index: index, len: String(slot.data || '').length };
  if (window.__ZE_HW_CAPTURING__ === index) return { ok: true, pending: true, index: index };
  window.__ZE_HW_CAPTURING__ = index;
  __hwShotBox(box, function(data){
    window.__ZE_HW_LOCAL_SHOTS__[index] = { ready: true, data: data || '' };
    window.__ZE_HW_CAPTURING__ = null;
  });
  return { ok: true, pending: true, index: index, imageCount: __hwImgs(box).length };
})`

export const CHAOXING_HOMEWORK_FILL = `(function(raw){
  ${hwJs}
  var answers = raw;
  if (typeof raw === 'string') {
    try { answers = JSON.parse(raw); } catch (e) { return { ok: false, error: 'answers 不是 JSON' }; }
  }
  if (!Array.isArray(answers) || !answers.length) return { ok: false, error: '缺少 answers' };
  var boxes = __hwBoxes(document);
  var filled = [];
  var missed = [];
  var findBox = function(item){
    var wantId = String(item.id || item.questionId || '');
    var wantIndex = Number(item.index || 0);
    for (var i = 0; i < boxes.length; i++) {
      var id = String(boxes[i].getAttribute('data') || boxes[i].getAttribute('questionid') || boxes[i].getAttribute('data-questionid') || boxes[i].id || '');
      if (wantId && id && id === wantId) return boxes[i];
    }
    if (wantIndex > 0 && boxes[wantIndex - 1]) return boxes[wantIndex - 1];
    return null;
  };
  var clickLetter = function(box, letters){
    var want = String(letters || '').toUpperCase().replace(/[^A-H对错正确错误是否]/g, '');
    var nodes = __hwChoiceNodes(box);
    var ok = false;
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var letterEl = el.querySelector ? el.querySelector('.num_option, [class*="num_option"]') : null;
      var text = __hwClean((el.textContent || el.getAttribute('data') || el.innerText || ''));
      var letter = String((letterEl && letterEl.getAttribute('data')) || '').trim().toUpperCase();
      if (!/^[A-H]$/.test(letter)) letter = __hwLetter(text) || __hwClean(el.getAttribute('data') || '').slice(0, 1).toUpperCase();
      if (!/^[A-H]$/.test(letter)) letter = String.fromCharCode(65 + i);
      if (/正确|对/.test(text) && /A|正确|对/.test(want)) letter = letter || 'A';
      if (/错误|错/.test(text) && /B|错误|错/.test(want)) letter = letter || 'B';
      if (letter && want.indexOf(letter) >= 0) {
        // 已选中的绝不再点：再点一次就是取消选择
        if (__hwIsSelected(letterEl || el)) { ok = true; continue; }
        // 点整行（answerBg 上挂着 onclick="addChoice(this)"），一次就够
        __hwClick(el);
        if (!__hwIsSelected(letterEl || el) && letterEl) __hwClick(letterEl);
        if (!__hwIsSelected(letterEl || el)) {
          var input = el.querySelector && el.querySelector('input');
          if (input && !input.checked) __hwClick(input);
        }
        ok = true;
      }
    }
    return ok;
  };
  var clickGlobal = function(index, letters){
    var want = String(letters || '').toUpperCase().replace(/[^A-H]/g, '');
    if (!want || index < 1) return false;
    var all = document.querySelectorAll('span[class*="choice"], .num_option');
    if (all.length < index * 2) return false;
    var per = Math.round(all.length / Math.max(__hwBoxes(document).length, 1)) || 4;
    var ok = false;
    for (var w = 0; w < want.length; w++) {
      var off = want.charCodeAt(w) - 65;
      if (off < 0 || off > 7) continue;
      var el = all[(index - 1) * per + off];
      if (!el) continue;
      if (__hwIsSelected(el) && want.length === 1) { ok = true; continue; }
      __hwClick(el);
      ok = true;
    }
    return ok;
  };
  var fillBlank = function(box, value){
    var parts = String(value || '').split(/[;；\\n]/).map(function(s){ return s.trim(); }).filter(Boolean);
    var inputs = box.querySelectorAll('input[type="text"], input.blank, input.blankInput, .blank input, textarea');
    var n = 0;
    for (var i = 0; i < inputs.length; i++) {
      var v = parts[i] || (i === 0 ? parts.join('；') : '');
      if (!v) continue;
      inputs[i].focus();
      inputs[i].value = v;
      inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
      inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
      n += 1;
    }
    if (!n && window.UE) {
      try {
        var areas = box.querySelectorAll('textarea[id], textarea[name]');
        for (var u = 0; u < areas.length; u++) {
          var ed = window.UE.getEditor(areas[u].id || areas[u].name);
          if (ed && ed.setContent) { ed.setContent(String(value || '')); n += 1; }
        }
      } catch (e) {}
    }
    return n > 0;
  };
  var isPicked = function(box, want){
    if (!want) return false;
    var nodes = __hwChoiceNodes(box);
    var picked = '';
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      var letterEl = el.querySelector ? el.querySelector('.num_option, [class*="num_option"]') : null;
      var letter = String((letterEl && letterEl.getAttribute('data')) || '').trim().toUpperCase();
      if (!/^[A-H]$/.test(letter)) letter = __hwLetter(__hwClean(el.getAttribute('data') || el.innerText || '')) || String.fromCharCode(65 + i);
      if (__hwIsSelected(letterEl || el)) picked += letter;
    }
    for (var w = 0; w < want.length; w++) {
      if (picked.indexOf(want.charAt(w)) < 0) return false;
    }
    return true;
  };
  for (var a = 0; a < answers.length; a++) {
    var item = answers[a] || {};
    var box = findBox(item);
    var ans = String(item.answer || item.value || '').trim();
    if (!box) {
      if (clickGlobal(Number(item.index || a + 1), ans)) filled.push(String(item.id || item.index || a + 1));
      else missed.push(String(item.id || item.index || a + 1));
      continue;
    }
    var type = __hwTypeName(item.type || item.typeName || '', '');
    var ok = false;
    var want = ans.toUpperCase().replace(/[^A-H]/g, '');
    if (type === 'blank' || type === 'text' || (!item.type && !/[A-H]/.test(ans) && ans.length > 2)) ok = fillBlank(box, ans);
    else if (!want) {
      // 判断题的 正确/错误 写法
      ok = clickLetter(box, ans) || clickGlobal(Number(item.index || a + 1), ans) || fillBlank(box, ans);
    } else {
      // 页面的 addChoice(this) 参数是选项元素本身，不能传 id/字母；直接单击选项行触发它
      ok = isPicked(box, want);
      if (!ok) { clickLetter(box, ans); ok = isPicked(box, want); }
      if (!ok) { clickGlobal(Number(item.index || a + 1), ans); ok = isPicked(box, want); }
    }
    if (ok) filled.push(String(item.id || item.index || a + 1));
    else missed.push(String(item.id || item.index || a + 1));
  }
  return { ok: filled.length > 0, filled: filled, missed: missed, filledCount: filled.length };
})`

export const CHAOXING_HOMEWORK_SUBMIT = `(function(){
  ${hwJs}
  if (typeof window.btnBlueSubmit === 'function') {
    try { window.btnBlueSubmit(); return { ok: true, via: 'btnBlueSubmit' }; } catch (e) {}
  }
  var btn = document.querySelector('#submitBtn, .Btn_blue, .Btn_blue_1, input[value="提交"], button[onclick*="Submit"], .workSubmit');
  if (btn) { __hwClick(btn); return { ok: true, via: 'button' }; }
  var nodes = document.querySelectorAll('a, button, input, span, div');
  for (var i = 0; i < nodes.length; i++) {
    var t = __hwClean(nodes[i].value || nodes[i].innerText || nodes[i].textContent || '');
    if (t === '提交' || t === '交卷' || t === '提交作业') {
      __hwClick(nodes[i]);
      return { ok: true, via: 'text' };
    }
  }
  return { ok: false, error: '没有提交按钮' };
})()`

export const CHAOXING_HOMEWORK_PROMPT = `
学习通作业只在题卡 browser_chaoxing_homework 上作答，禁止 browser_eval / click / get_page / type 碰作业页（会被直接挡回）。题卡和网页自动双向同步：fill 会同步到网页，网页勾选状态会自动回流到题卡。
- list 看待做；open(title) 打开一份；inspect 读题卡；然后一题一题作答：答出第 1 道就立刻 fill 第 1 道，看到返回里 filled 变了再做下一道。不要把全部答案攒到最后一次 fill。
- inspect 返回的 questions 就是题目卡：id/index/type/stem/options/filled。公式图已读成文字。不要说看不清，不要问用户截图。
- 题干或选项还没读出的题（hint 会点名）先跳过，答完其他题再 inspect 一次，抽象层会自动补读。绝不允许在没读出题目时猜答案。
- fill 的 answers 数组一次只放一项：index 或 id、type、answer。单选/判断填 A，多选填 AC，填空多空用分号。已选中的不要再点，fill 会跳过。
- 看 next 字段做事：list / open / inspect / fill / save / submit / done。不要停下来问「要不要开始」。
- 已完成/待批阅不要再交。不要出练习题。刷课时没说写作业不要抢答测验。
`
