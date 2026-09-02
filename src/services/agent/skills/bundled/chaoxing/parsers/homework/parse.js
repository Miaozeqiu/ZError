// 作业 · parse：题盒、选项、题面
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
        || (num && /(^|\s)check_answer(\s|$)/.test(String(num.className || '')));
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

function __hwClean(s){ return String(s || '').replace(/[\n\r\t]+/g, ' ').replace(/  +/g, ' ').trim(); }

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
    var m = __hwClean(text).match(/^([A-Ha-h])(?:[.、．\s)]|$)/);
    return m ? m[1].toUpperCase() : '';
  }

function __hwBoxes(doc){
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
        letter = (aria.match(/^([A-H])s/) || [])[1] || '';
      }
      var text = __hwClean(bodyEl ? bodyEl.innerText : (el.getAttribute('data') || el.innerText || el.textContent || ''));
      if (!/^[A-H]$/.test(letter)) letter = __hwLetter(text) || __hwClean(el.getAttribute('data') || '').slice(0, 1).toUpperCase();
      if (!/^[A-H]$/.test(letter) && /正确|对/.test(text)) letter = 'A';
      if (!/^[A-H]$/.test(letter) && /错误|错/.test(text)) letter = 'B';
      if (!/^[A-H]$/.test(letter)) letter = String.fromCharCode(65 + out.length);
      text = text.replace(/^[A-H][.、．)s]*/, '').slice(0, 120);
      if (!text && !bodyEl) continue;
      if (out.some(function(item){ return item.letter === letter; })) continue;
      out.push({ letter: letter, text: text || '', selected: __hwIsSelected(letterEl || el) });
    }
    return out;
  }

function __hwStem(box){
    var el = box.querySelector('h3.mark_name, h3 .mark_name, h3, .Zy_TItle, .mark_name, .qtTitle, .question-title, .stem, .quesTitle');
    var text = __hwClean((el && (el.innerText || el.textContent)) || '');
    text = text.replace(/^d+[.、．s]*/, '').replace(/[（(]s*(单选题|多选题|填空题|判断题|简答题)s*[）)]/g, '').replace(/(s*)/g, ' ').trim();
    if (!text) {
      var raw = __hwClean(box.innerText || '');
      text = (raw.split(/A[.、．s]/)[0] || raw).replace(/^d+[.、．s]*/, '').trim();
    }
    return text.split(/(?=[A-H][.、．s])/)[0]?.trim() || text.slice(0, 400);
  }

function __hwImgs(box){
    var out = [];
    var imgs = box.querySelectorAll('img');
    for (var i = 0; i < imgs.length && out.length < 10; i++) {
      var img = imgs[i];
      var src = String(img.src || img.getAttribute('src') || '');
      var w = img.naturalWidth || img.width || 0;
      var h = img.naturalHeight || img.height || 0;
      if (!src || /icon|logo|radio|check|btn|avatar|pixel|blank\.gif|spacer|\.svg(\?|$)/i.test(src)) continue;
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
    var idxHit = stem.match(/^\s*(\d+)/);
    var qIndex = Number(idxHit && idxHit[1]) || (index + 1);
    var stemBody = stem
      .replace(/^\d+\s*[.、．)）]\s*/, '')
      .replace(/^\d+(?=[（(]|单选|多选|填空|判断|简答)/, '')
      .replace(/^[（(]\s*(单选题|多选题|填空题|判断题|简答题|计算题|论述题|单选|多选|填空|判断)\s*[)）]\s*/, '')
      .trim();
    var imgs = __hwImgs(box);
    var imageUrls = [];
    for (var g = 0; g < imgs.length && imageUrls.length < 6; g++) {
      var src = String(imgs[g].src || imgs[g].getAttribute('src') || '');
      if (src) imageUrls.push(src);
    }
    var imageCount = imgs.length;
    var optText = options.map(function(item){ return item.text; }).join('');
    var needsVision = imageCount > 0 || stemBody.length < 12 || /（图像）|\(图像\)|公式图/.test(stemBody + optText);
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
    var blocks = String(text || '').split(/\n(?=\d+\.\s*[（(])/);
    for (var i = 0; i < blocks.length && out.length < 40; i++) {
      var lines = blocks[i].split('\n').map(__hwClean).filter(Boolean);
      if (!lines.length || !/^\d+\./.test(lines[0])) continue;
      var typeName = (lines[0].match(/[（(]([^）)]+)[）)]/) || [])[1] || '单选';
      var opts = [];
      var stem = [];
      for (var L = 1; L < lines.length; L++) {
        var m = lines[L].match(/^([A-H])(?:[.、．)]\s*)?(.*)$/);
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
      title = __hwClean(title).replace(/^[（(]\d+[）)]\s*/, '');
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
      var score = (block.match(/\d+(?:\.\d+)?\s*分/) || [])[0] || '';
      var due = (block.match(/\d{4}[-./]\d{1,2}[-./]\d{1,2}[^\n]{0,12}/) || [])[0] || '';
      add(title, status, score, due, a.href || a.getAttribute('href') || href);
    }
    if (!out.length) {
      var text = __hwClean((doc.body && doc.body.innerText) || '');
      var lines = String((doc.body && doc.body.innerText) || '').split('\n').map(__hwClean).filter(Boolean);
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
    if (works.length || /作业列表|work\/list|mooc2\/work/.test(href + text)) return 'list';
    if (/\/mycourse\/stu/.test(href) && /作业/.test(text)) return 'course';
    return 'other';
  }
