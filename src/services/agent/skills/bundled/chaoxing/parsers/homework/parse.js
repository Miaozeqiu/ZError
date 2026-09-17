// 作业 · parse：题面、名单、页类。认盒/选项在 helpers.js。
var HW_QUESTION_CAP = 80;

function __hwStem(box){
    var el = box.querySelector('h3.mark_name, h3 .mark_name, h3, .Zy_TItle, .mark_name, .qtTitle, .question-title, .stem, .quesTitle');
    var text = __hwRichText(el);
    if (!text) text = __hwClean((el && (el.innerText || el.textContent)) || '');
    text = text.replace(/^\d+[.、．\s]*/, '').replace(/[（(]\s*(单选题|多选题|填空题|判断题|简答题)\s*[）)]/g, '').trim();
    if (/^[（(][\s\u00a0\u3000]*[）)]$/.test(text)) text = '';
    if (!text) {
      var raw = __hwClean(box.innerText || '');
      text = (raw.split(/A[.、．\s]/)[0] || raw).replace(/^\d+[.、．\s]*/, '').trim();
    }
    return (text.split(/(?=[A-H][.、．\s])/)[0] || text).trim().slice(0, 400);
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
    var id = String(box.getAttribute('data') || box.getAttribute('questionid') || box.getAttribute('data-questionid') || box.id || ('hw-' + (index + 1)));
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
    var qIndex = index + 1;
    var stemBody = stem
      .replace(/^\d+\s*[.、．)）]\s*/, '')
      .replace(/^\d+(?=[（(]|单选|多选|填空|判断|简答)/, '')
      .replace(/^[（(]\s*(单选题|多选题|填空题|判断题|简答题|计算题|论述题|单选|多选|填空|判断)\s*[)）]\s*/, '')
      .trim();
    var stemEl = box.querySelector('h3.mark_name, h3, .mark_name, .Zy_TItle, .qtTitle, .question-title, .stem, .quesTitle');
    var imageUrls = __hwImgUrls(stemEl);
    if (!imageUrls.length) {
      var taken = {};
      for (var oi = 0; oi < options.length; oi++) {
        var pics = options[oi].images || [];
        for (var pi = 0; pi < pics.length; pi++) taken[pics[pi]] = 1;
      }
      var all = __hwImgUrls(box);
      for (var g = 0; g < all.length; g++) {
        if (!taken[all[g]]) imageUrls.push(all[g]);
      }
    }
    var imageCount = imageUrls.length;
    for (var oc = 0; oc < options.length; oc++) imageCount += (options[oc].images || []).length;
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
    for (var i = 0; i < boxes.length && out.length < HW_QUESTION_CAP; i++) {
      var q = __hwParseBox(boxes[i], i);
      if (q.stem || q.options.length || q.imageCount) out.push(q);
    }
    out.total = boxes.length;
    out.truncated = boxes.length > out.length;
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

function __hwIsStatus(s){
    return /^(待做|未做|未完成|未交|未提交|待交|待批阅|已完成|已批阅|已交)$/.test(String(s || '').trim());
  }

function __hwNormStatus(s){
    var t = String(s || '');
    if (/待批阅/.test(t)) return '待批阅';
    if (/已完成|已批阅|已交/.test(t) && !/未交|未提交|待交/.test(t)) return '已完成';
    if (/待做|未做|未完成|未交|未提交|待交/.test(t)) return '待做';
    return '';
  }

function __hwIsWorkTitle(s){
    s = __hwClean(s);
    if (!s || s.length < 2 || s.length > 80) return false;
    if (__hwIsStatus(s)) return false;
    if (/^作业$|^测验$|^考试$|^章节$|^任务$|^讨论$|^资料$|^错题集$|^学习记录$|^默认班级$/.test(s)) return false;
    if (/截止日期|作业列表|开始时间|剩余\d|小时|分钟|课程门户/.test(s)) return false;
    return true;
  }

function __hwParseWorkLine(line){
    line = __hwClean(line);
    var m = line.match(/^(.*?)(?:\s*[;；|]\s*|\s+)(待做|未做|未完成|未交|未提交|待交|待批阅|已完成|已批阅|已交)\s*$/);
    if (m && __hwIsWorkTitle(m[1])) return { title: __hwClean(m[1]), status: m[2] };
    return null;
  }

function __hwParseWorksFromText(text, href){
    var out = [];
    var seen = {};
    var add = function(title, status){
      title = __hwClean(title).replace(/^[（(]\d+[）)]\s*/, '');
      if (!__hwIsWorkTitle(title) || seen[title]) return;
      seen[title] = 1;
      out.push({ title: title, status: __hwNormStatus(status) || '待做', score: '', due: '', href: href || '' });
    };
    var lines = String(text || '').split(/\n+/).map(__hwClean).filter(Boolean);
    for (var j = 0; j < lines.length && out.length < 40; j++) {
      var one = __hwParseWorkLine(lines[j]);
      if (one) { add(one.title, one.status); continue; }
      if (!__hwIsStatus(lines[j])) continue;
      for (var k = j - 1; k >= 0 && k >= j - 3; k--) {
        if (__hwIsWorkTitle(lines[k])) { add(lines[k], lines[j]); break; }
      }
    }
    return out;
  }

function __hwParseWorks(doc, href){
    href = String(href || '');
    if (/\/mycourse\/studentstudy|\/mycourse\/stu/.test(href) && !/\/work\//.test(href)) {
      return [];
    }
    var out = [];
    var seen = {};
    var add = function(title, status, score, due, link){
      title = __hwClean(title).replace(/^[（(]\d+[）)]\s*/, '');
      if (!__hwIsWorkTitle(title) || seen[title]) return;
      seen[title] = 1;
      var st = __hwNormStatus(status);
      if (!st) st = __hwNormStatus(title) || '待做';
      out.push({ title: title, status: st, score: __hwClean(score), due: __hwClean(due), href: __hwClean(link) });
    };
    var cards = doc.querySelectorAll('.workLi, .bottomList li, .listLi, .work-item, [class*="workItem"], [class*="work-item"]');
    for (var c = 0; c < cards.length && out.length < 40; c++) {
      var card = cards[c];
      var nameEl = card.querySelector('.titTxt a, .titTxt, .workName a, .workName, .work-title, h2, h3, a');
      var title = (nameEl && (nameEl.getAttribute('title') || nameEl.innerText || nameEl.textContent)) || '';
      var block = String(card.innerText || card.textContent || '');
      var status = __hwNormStatus(block);
      var score = (block.match(/\d+(?:\.\d+)?\s*分/) || [])[0] || '';
      var due = (block.match(/\d{4}[-./]\d{1,2}[-./]\d{1,2}[^\n]{0,12}/) || [])[0] || '';
      var a = card.querySelector('a[href*="work"], a[href*="Work"], a[onclick*="work"], a');
      var link = (a && (a.href || a.getAttribute('href'))) || href;
      if (/^javascript:/i.test(String(link || ''))) link = href || '';
      add(title, status, score, due, link);
    }
    var links = doc.querySelectorAll('a[href*="work"], a[href*="Work"], a[onclick*="work"], a[onclick*="Work"], .titTxt a, .workName a, .work-title, .bottomList a');
    for (var i = 0; i < links.length && out.length < 40; i++) {
      var el = links[i];
      var linkTitle = el.getAttribute('title') || el.innerText || el.textContent || '';
      var wrap = el.closest ? (el.closest('li, .workLi, .work-item, tr, .listLi') || el.parentElement) : el.parentElement;
      var wrapText = (wrap && (wrap.innerText || wrap.textContent)) || '';
      var hrefRaw = el.href || el.getAttribute('href') || href;
      if (/^javascript:/i.test(String(hrefRaw || '')) || /看不清|看不清题/.test(__hwClean(linkTitle))) continue;
      add(linkTitle, __hwNormStatus(wrapText), (wrapText.match(/\d+(?:\.\d+)?\s*分/) || [])[0] || '', (wrapText.match(/\d{4}[-./]\d{1,2}[-./]\d{1,2}[^\n]{0,12}/) || [])[0] || '', hrefRaw);
    }
    if (!out.length) {
      var bodyText = String((doc.body && (doc.body.innerText || doc.body.textContent)) || '');
      var fromText = __hwParseWorksFromText(bodyText, href);
      for (var t = 0; t < fromText.length; t++) add(fromText[t].title, fromText[t].status, '', '', href);
      if (!out.length && /暂无作业|没有作业/.test(bodyText)) return [];
    }
    return out;
  }

function __hwPageOf(href, text, questions, works){
    href = String(href || '');
    text = String(text || '');
    if (questions.length) return /view|已批阅|正确答案/.test(href + text) ? 'view' : 'do';
    if (/\/mycourse\/studentstudy|\/mycourse\/stu/.test(href) && !/\/work\//.test(href)) {
      return /作业/.test(text) ? 'course' : 'other';
    }
    if (works.length || /作业列表|work\/list|mooc2\/work/.test(href + text)) return 'list';
    if (/\/mycourse\/stu/.test(href) && /作业/.test(text)) return 'course';
    return 'other';
  }
