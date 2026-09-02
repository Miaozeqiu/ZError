// 作业 · live：实时监听
function live() {
    var count = function(sel){ return document.querySelectorAll(sel).length; };
      var boxes = document.querySelectorAll('.questionLi');
      if (!boxes.length) boxes = document.querySelectorAll('.singleQuesId');
      if (!boxes.length) boxes = document.querySelectorAll('.mark_item');
      var rows = [];
      for (var i = 0; i < boxes.length && rows.length < 16; i++) {
        rows.push({
          i: i + 1,
          t: String(boxes[i].innerText || '').replace(/\s+/g, ' ').slice(0, 90),
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
        text: ((document.body && document.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 500)
      };
  }

function liveHook() {
    return (function(){
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
    })();
  }

function dirty() {
    return { n: window.__ZE_HW_DIRTY__ || 0, hooked: window.__ZE_HW_HOOKED__ || 0 };
  }

function fillState() {
    return (function(){
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
    })();
  }
