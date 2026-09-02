// 作业 · capture：截图
function capture(index) {
    var at = Math.max(0, Number(index || 1) - 1);
      window.__ZE_HW_LOCAL_SHOTS__ = window.__ZE_HW_LOCAL_SHOTS__ || {};
      var boxes = __hwBoxes(document);
      var box = boxes[at];
      if (!box) return { ok: false, error: '没有第' + (at + 1) + '题' };
      try { box.scrollIntoView({ block: 'center' }); } catch (e) {}
      var slot = window.__ZE_HW_LOCAL_SHOTS__[at];
      if (slot && slot.ready) return { ok: true, ready: true, index: at + 1, len: String(slot.data || '').length };
      if (window.__ZE_HW_CAPTURING__ === at) return { ok: true, pending: true, index: at + 1 };
      window.__ZE_HW_CAPTURING__ = at;
      __hwShotBox(box, function(data){
        window.__ZE_HW_LOCAL_SHOTS__[at] = { ready: true, data: data || '' };
        window.__ZE_HW_CAPTURING__ = null;
      });
      return { ok: true, pending: true, index: at + 1, imageCount: __hwImgs(box).length };
  }

function stash() {
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
        var stem = txt(h3).replace(/^\d+[.、．\s]*/, '').replace(/[（(]\s*(单选题|多选题|判断题|填空题|简答题|问答题|计算题|论述题|不定项)\s*[）)]/g, '').trim();
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
            var am = aria.match(/^[A-H]\s*(.*?)选择$/);
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
  }

function startImgPage() {
    var item = (window.__ZE_HW_IMGELS__ || [])[index];
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
  }

function imgMeta() {
    var row = window.__ZE_HW_IMGONE__ || {};
      return { wait: !!row.wait, key: String(row.key || ''), n: String(row.data || '').length };
  }

function imgChunk() {
    var row = window.__ZE_HW_IMGONE__ || {};
      if (row.wait) return { wait: 1, c: '', d: false };
      var s = String(row.data || '');
      var off = window.__ZE_HW_IMGOFF__ | 0;
      var chunk = s.slice(off, off + 300);
      window.__ZE_HW_IMGOFF__ = off + chunk.length;
      return { wait: 0, key: String(row.key || ''), c: chunk, d: off + chunk.length >= s.length };
  }
