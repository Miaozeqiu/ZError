// 作业 · answer：填答案、提交
function fill(raw) {
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
        var parts = String(value || '').split(/[;；\n]/).map(function(s){ return s.trim(); }).filter(Boolean);
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
  }

function submit() {
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
  }

function pickedPage() {
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
  }

function pickInFramesPage() {
    var want = letter;
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
          var tx = String(row.innerText || '').replace(/\s+/g, ' ').trim();
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
  }

function debugBoxPage() {
    var boxes = document.querySelectorAll('.questionLi');
      if (!boxes.length) boxes = document.querySelectorAll('.singleQuesId');
      var box = boxes[at];
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
  }
