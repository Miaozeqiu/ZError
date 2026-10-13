/* 页内推送钩子。Rust 用 include_str! 载入，把 __ZE_BINDING__ 换成本进程随机绑定名。
 * 只做三件事：video 进度、作业点选、同源 iframe 递归安装。状态全放闭包 / WeakMap，不往元素上挂属性。 */
(function () {
  var NAME = '__ZE_BINDING__';
  var GUARD = NAME + 'i';
  // 守卫挂在 document 而不是 window：iframe 从初始 about:blank 同源导航到真实地址时 Chromium 复用同一个
  // window，document-start 脚本会跑两次。挂 window 的话第二次直接退出，第一份闭包里捏着的却是已经
  // 作废的旧 document，播放器帧里的 <video> 永远没人绑，一个 tick 都推不出来。
  if (document[GUARD]) return;
  try {
    Object.defineProperty(document, GUARD, { value: 1, enumerable: false, configurable: true });
  } catch (eG) {
    document[GUARD] = 1;
  }

  var bound = new WeakSet();
  var hwDocs = new WeakSet();
  var observed = new WeakSet();
  var lastSent = new WeakMap();

  function emit(payload) {
    var fn = window[NAME];
    if (typeof fn !== 'function') {
      try { fn = window.top && window.top[NAME]; } catch (e) {}
    }
    if (typeof fn !== 'function') return;
    try { fn(JSON.stringify(payload)); } catch (e2) {}
  }

  function midOf(v) {
    try {
      var w = v && v.ownerDocument && v.ownerDocument.defaultView;
      for (var g = 0; w && g < 8; g++) {
        var fe = null;
        try { fe = w.frameElement; } catch (e) {}
        if (fe) {
          var attr = '';
          try { attr = String(fe.getAttribute('mid') || fe.getAttribute('data-mid') || ''); } catch (eA) {}
          if (attr) return attr;
        }
        var src = '';
        try { src = String((fe && (fe.src || fe.getAttribute('src'))) || (w.location && w.location.href) || ''); } catch (e2) {}
        var mm = src.match(/[?&]mid=([^&]+)/i);
        if (mm) return decodeURIComponent(mm[1] || '');
        try {
          if (!w.parent || w === w.top) break;
          w = w.parent;
        } catch (e3) { break; }
      }
    } catch (e4) {}
    return '';
  }

  function durOf(v) {
    var n = Number(v && v.duration);
    if (isFinite(n) && n > 1) return n;
    var w = v && v.ownerDocument && v.ownerDocument.defaultView;
    if (!w) return 0;
    n = Number(w.duration);
    if (isFinite(n) && n > 1) return n;
    try {
      var vjs = w.videojs;
      var players = vjs && vjs.getPlayers && vjs.getPlayers();
      if (players) {
        for (var k in players) {
          var d = Number(players[k] && players[k].duration && players[k].duration());
          if (isFinite(d) && d > 1) return d;
        }
      }
    } catch (eV) {}
    return 0;
  }

  function visibleOf(v) {
    try {
      var r = v.getBoundingClientRect();
      return Boolean(r && r.width >= 2 && r.height >= 2);
    } catch (e) { return false; }
  }

  function tickOf(v) {
    var current = 0, ready = 0, src = '', paused = true, ended = false;
    try { current = Number(v.currentTime) || 0; } catch (e0) {}
    try { ready = Number(v.readyState) || 0; } catch (e1) {}
    try { src = String(v.currentSrc || v.src || ''); } catch (e2) {}
    try { paused = v.paused !== false; } catch (e3) {}
    try { ended = Boolean(v.ended); } catch (e4) {}
    var duration = durOf(v);
    return {
      kind: 'video',
      current: current,
      duration: duration,
      paused: paused,
      ended: ended,
      ready: ready,
      src: src,
      mid: midOf(v),
      visible: visibleOf(v),
      hasVideo: Boolean(ended || duration > 1 || current > 0.2 || src)
    };
  }

  function bindVideo(v) {
    if (!v || bound.has(v)) return;
    bound.add(v);
    function send(force) {
      var now = Date.now();
      if (!force && now - (lastSent.get(v) || 0) < 1000) return;
      lastSent.set(v, now);
      emit(tickOf(v));
    }
    var hard = ['play', 'pause', 'ended', 'seeking', 'loadedmetadata'];
    for (var i = 0; i < hard.length; i++) {
      try { v.addEventListener(hard[i], function () { send(true); }, true); } catch (e) {}
    }
    try { v.addEventListener('timeupdate', function () { send(false); }, true); } catch (e2) {}
    send(true);
  }

  function hwTarget(t) {
    if (!t || !t.closest) return false;
    try {
      return Boolean(t.closest('.questionLi, .singleQuesId, .TiMu, input, textarea, select, .answerBg, .num_option'));
    } catch (e) { return false; }
  }

  function letterOf(el) {
    if (!el) return '';
    var d = String((el.getAttribute && (el.getAttribute('data') || el.getAttribute('data-letter'))) || '').toUpperCase();
    if (/^[A-H]$/.test(d)) return d;
    var t = String(el.textContent || '').replace(/\s+/g, ' ').trim();
    var m = t.match(/^([A-Ha-h])/);
    return m ? m[1].toUpperCase() : '';
  }
  function selectedOf(el) {
    if (!el) return false;
    if (el.checked) return true;
    var cls = String(el.className || '');
    if (/check_answer|checked|active|selected|cur|choice_answer/.test(cls)) return true;
    if (el.getAttribute && el.getAttribute('aria-checked') === 'true') return true;
    try { if (el.querySelector && el.querySelector('input:checked')) return true; } catch (e) {}
    return false;
  }
  function pickedOf(box) {
    var picked = '';
    var nodes = [];
    try { nodes = box.querySelectorAll('.num_option, .answerBg, .answer_item, li[role], input[type=radio], input[type=checkbox]'); } catch (e) {}
    for (var i = 0; i < nodes.length; i++) {
      if (!selectedOf(nodes[i])) continue;
      var host = nodes[i];
      try { host = nodes[i].closest('li, .answerBg, .answer_item, label') || nodes[i]; } catch (e2) {}
      var L = letterOf(nodes[i]) || letterOf(host);
      if (L && picked.indexOf(L) < 0) picked += L;
    }
    return picked;
  }
  function readFill(doc) {
    var boxes = [];
    try { boxes = doc.querySelectorAll('.questionLi, .singleQuesId, .TiMu, .mark_item'); } catch (e) {}
    var states = [];
    for (var i = 0; i < boxes.length && i < 40; i++) {
      var picked = pickedOf(boxes[i]);
      var filled = picked.length > 0;
      if (!filled) {
        var ins = [];
        try { ins = boxes[i].querySelectorAll('input[type="text"], textarea'); } catch (eI) {}
        for (var k = 0; k < ins.length; k++) {
          if (String(ins[k].value || '').trim()) { filled = true; break; }
        }
      }
      states.push({ index: i + 1, selected: picked, filled: filled });
    }
    return states;
  }
  function collectHw() {
    var states = [];
    function walk(doc, depth) {
      if (!doc || depth > 3) return;
      var rows = readFill(doc);
      for (var i = 0; i < rows.length; i++) states.push(rows[i]);
      var frames = [];
      try { frames = doc.querySelectorAll('iframe'); } catch (e) {}
      for (var f = 0; f < frames.length; f++) {
        var child = null;
        try { child = frames[f].contentDocument; } catch (e2) {}
        if (child) walk(child, depth + 1);
      }
    }
    walk(document, 0);
    for (var j = 0; j < states.length; j++) states[j].index = j + 1;
    return states;
  }

  var hwQueued = 0;
  function pingHw() {
    if (hwQueued) return;
    hwQueued = 1;
    setTimeout(function () {
      hwQueued = 0;
      emit({ kind: 'hw', changed: true, states: collectHw() });
    }, 0);
  }

  function bindHw(doc) {
    if (!doc || hwDocs.has(doc)) return;
    hwDocs.add(doc);
    var ping = pingHw;
    try { doc.addEventListener('click', function (ev) { if (hwTarget(ev && ev.target)) ping(); }, true); } catch (e0) {}
    try { doc.addEventListener('change', ping, true); } catch (e1) {}
    try { doc.addEventListener('input', ping, true); } catch (e2) {}
  }

  function scan(doc, depth) {
    if (!doc || depth > 2) return;
    var vids = [];
    try { vids = doc.querySelectorAll('video'); } catch (e) {}
    for (var i = 0; i < vids.length; i++) bindVideo(vids[i]);
    bindHw(doc);
    var frames = [];
    try { frames = doc.querySelectorAll('iframe'); } catch (eF) {}
    for (var f = 0; f < frames.length; f++) {
      var child = null;
      try { child = frames[f].contentDocument; } catch (eC) {}
      if (child) boot(child, depth + 1);
    }
  }

  function observe(doc, depth) {
    if (!doc.documentElement) return false;
    try {
      var dirty = 0;
      var mo = new MutationObserver(function () {
        if (dirty) return;
        dirty = 1;
        setTimeout(function () { dirty = 0; scan(doc, depth); }, 200);
      });
      mo.observe(doc.documentElement, { childList: true, subtree: true });
    } catch (eM) {}
    return true;
  }

  function boot(doc, depth) {
    if (!doc) return;
    scan(doc, depth);
    if (observed.has(doc)) return;
    observed.add(doc);
    // 观察器兜底：document-start 时挂上的观察器在 document.open()/write 重建文档后会失效，
    // 实测 ananas 播放器帧里 videojs 建出来的 <video> 观察器一次都没报。慢扫一遍很便宜（已绑的在 WeakSet 里）。
    if (depth === 0) {
      var slow = setInterval(function () {
        var w = null;
        try { w = doc.defaultView; } catch (eW) {}
        // 文档被换掉（导航 / document.open）就停，新文档有自己那份钩子
        if (!w || w.document !== doc) { clearInterval(slow); return; }
        scan(doc, depth);
      }, 1500);
    }
    if (observe(doc, depth)) return;
    // addScriptToEvaluateOnNewDocument 跑在 <html> 建好之前：documentElement 还是 null，
    // 这时挂不上观察器，后来 videojs 建的 <video> 就永远没人绑，页面一个 tick 都推不出来。
    // 等 <html> 出现再挂，DOMContentLoaded / load 再各扫一遍兜底。
    var tries = 0;
    var timer = setInterval(function () {
      tries += 1;
      if (observe(doc, depth) || tries > 200) {
        clearInterval(timer);
        scan(doc, depth);
      }
    }, 50);
    try { doc.addEventListener('DOMContentLoaded', function () { scan(doc, depth); }, true); } catch (eD) {}
    try {
      var w = doc.defaultView;
      if (w) w.addEventListener('load', function () { scan(doc, depth); }, true);
    } catch (eL) {}
  }

  boot(document, 0);
})();
