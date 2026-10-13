// 作业 · locate / invoke：用 helpers 的同一套实体，返回盒子或调用页内 API。
function locate(handle){
  handle = handle || {};
  var kind = handle.kind;
  if (kind === 'option') return locateOption(handle.index, handle.letter);
  if (kind === 'blank') return locateBlank(handle.index, handle.slot);
  if (kind === 'question') return locateQuestion(handle.index);
  if (kind === 'control') return locateControl(handle.name);
  if (kind === 'work') return locateWork(handle.title);
  return { found: false };
}

function invoke(handle){
  handle = handle || {};
  var kind = handle.kind;
  if (kind === 'option') return invokePick(handle.index, handle.letter);
  if (kind === 'control' && handle.name === 'save') return invokeSave();
  if (kind === 'control' && handle.name === 'submit') return invokeSubmit();
  if (kind === 'control' && handle.name === 'confirm') return invokeConfirm();
  return { ok: false, reason: 'no-invoke' };
}

function locateQuestion(index){
  var at = Math.max(0, Number(index || 1) - 1);
  var box = hwBoxes()[at];
  var pos = boxOf(box);
  if (!pos) return { found: false, boxes: hwBoxes().length };
  return { found: true, x: pos.x, y: pos.y, space: pos.space, text: String(index || at + 1) };
}

function locateOption(index, letter){
  var at = Math.max(0, Number(index || 1) - 1);
  var want = String(letter || '').toUpperCase().replace(/[^A-H]/g, '').slice(0, 1);
  if (!want) return { found: false };
  var box = hwBoxes()[at];
  if (!box) return { found: false, boxes: hwBoxes().length };
  var hit = __hwFindOption(box, want);
  if (!hit) return { found: false, nodes: __hwChoiceNodes(box).length };
  var pos = boxOf(hit.el);
  if (!pos) return { found: false, reason: 'no-box' };
  var cls = String((hit.letterEl || hit.el).className || '');
  return { found: true, x: pos.x, y: pos.y, space: pos.space, text: hit.letter, selected: /check_answer|checked|active|selected/.test(cls) };
}

function locateBlank(index, slot){
  var at = Math.max(0, Number(index || 1) - 1);
  var box = hwBoxes()[at];
  if (!box) return { found: false };
  var el = __hwFindBlank(box, slot);
  var pos = boxOf(el);
  if (!pos) return { found: false };
  return { found: true, x: pos.x, y: pos.y, space: pos.space, text: 'blank' };
}

function locateControl(name){
  var docs = [typeof hwRoot === 'function' ? hwRoot() : document, document];
  try { if (window.top && window.top.document) docs.push(window.top.document); } catch (e) {}
  for (var d = 0; d < docs.length; d++) {
    var el = __hwFindControl(docs[d], name);
    var pos = boxOf(el);
    if (pos) return { found: true, x: pos.x, y: pos.y, space: pos.space, text: name };
  }
  return { found: false };
}

function locateWork(title){
  var want = __hwClean(title);
  if (!want) return { found: false };
  var doc = typeof hwRoot === 'function' ? hwRoot() : document;
  var links = doc.querySelectorAll('a, .titTxt, .workName, .work-title');
  for (var i = 0; i < links.length; i++) {
    var el = links[i];
    var text = __hwClean(el.getAttribute && (el.getAttribute('title') || '') || el.innerText || el.textContent || '');
    if (!text || text.indexOf(want) < 0 && want.indexOf(text) < 0) continue;
    var pos = boxOf(el);
    if (pos) return { found: true, x: pos.x, y: pos.y, space: pos.space, text: text };
  }
  return { found: false };
}

function invokePick(index, letter){
  var at = Math.max(0, Number(index || 1) - 1);
  var want = String(letter || '').toUpperCase().replace(/[^A-H]/g, '').slice(0, 1);
  if (!want) return { ok: false, reason: 'no-letter' };
  var doc = hwRoot();
  var boxes = __hwBoxes(doc);
  var box = boxes[at];
  if (!box) return { ok: false, reason: 'no-box', boxes: boxes.length };
  var hit = __hwFindOption(box, want);
  if (!hit) return { ok: false, reason: 'no-option', nodes: __hwChoiceNodes(box).length, questionLi: boxes.length };
  var clickEl = hit.el;
  try { clickEl.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
  var win = doc.defaultView || window;
  try {
    if (typeof win.addChoice === 'function') { win.addChoice(clickEl); return { ok: true, found: true, via: 'addChoice', text: hit.letter, questionLi: boxes.length }; }
  } catch (e2) {}
  try {
    if (typeof addChoice === 'function') { addChoice(clickEl); return { ok: true, found: true, via: 'addChoice', text: hit.letter, questionLi: boxes.length }; }
  } catch (e3) {}
  try {
    clickEl.click();
    return { ok: true, found: true, via: 'click', text: hit.letter, questionLi: boxes.length };
  } catch (e4) {
    return { ok: false, reason: String(e4 && e4.message || e4 || 'click-fail'), text: hit.letter };
  }
}

function invokeSave(){
  var doc = hwRoot();
  var win = (doc && doc.defaultView) || window;
  try {
    if (typeof win.noSubmit === 'function') { win.noSubmit(); return { ok: true, via: 'noSubmit' }; }
  } catch (e) {}
  try {
    if (typeof win.saveWork === 'function') { win.saveWork(); return { ok: true, via: 'saveWork' }; }
  } catch (e2) {}
  var btn = __hwFindControl(doc, 'save');
  if (btn) {
    try { btn.click(); return { ok: true, via: 'click' }; } catch (e3) {}
  }
  return { ok: false, reason: 'no-save' };
}

function invokeSubmit(){
  var doc = hwRoot();
  var win = (doc && doc.defaultView) || window;
  try {
    if (typeof win.btnBlueSubmit === 'function') { win.btnBlueSubmit(); return { ok: true, via: 'btnBlueSubmit' }; }
  } catch (e) {}
  var btn = __hwFindControl(doc, 'submit');
  if (btn) {
    try { btn.click(); return { ok: true, via: 'click' }; } catch (e2) {}
  }
  return { ok: false, reason: 'no-submit' };
}

function invokeConfirm(){
  var docs = [hwRoot(), document];
  try { if (window.top && window.top.document) docs.push(window.top.document); } catch (e) {}
  for (var d = 0; d < docs.length; d++) {
    var btn = __hwFindControl(docs[d], 'confirm');
    if (!btn) continue;
    try { btn.click(); return { ok: true, via: 'confirm' }; } catch (e2) {}
  }
  return { ok: false, reason: 'no-confirm' };
}

function readDom(){
  var doc = hwRoot();
  var win = doc.defaultView;
  var href = '';
  try { href = (win && win.location && win.location.href) || location.href || ''; } catch (e) { href = location.href || ''; }
  var q = hwQCount(doc);
  var html = '';
  try { html = doc.documentElement ? doc.documentElement.outerHTML : ''; } catch (e4) {}
  if (!q && html.length > 400000) html = html.slice(0, 400000);
  return {
    ok: true,
    url: href,
    title: String((doc.title || document.title || '')).replace(/^ZRRESULT:.*/, '').slice(0, 80),
    questionLi: q,
    workLi: hwIsWorkHref(href) ? Math.max(1, doc.querySelectorAll('.workLi, .bottomList li').length) : 0,
    catalogLi: 0,
    html: html
  };
}

function readLive(){
  var doc = hwRoot();
  var boxes = __hwBoxes(doc);
  var rows = [];
  for (var i = 0; i < boxes.length && rows.length < 16; i++) {
    rows.push({
      i: i + 1,
      t: String(boxes[i].innerText || '').replace(/\s+/g, ' ').slice(0, 90),
      n: boxes[i].querySelectorAll('img').length
    });
  }
  var win = doc.defaultView;
  var href = '';
  try { href = (win && win.location && win.location.href) || location.href || ''; } catch (e) { href = location.href || ''; }
  return {
    url: href,
    title: String((doc.title || document.title || '')).replace(/^ZRRESULT:.*/, '').slice(0, 80),
    counts: {
      questionLi: doc.querySelectorAll('.questionLi').length,
      singleQuesId: doc.querySelectorAll('.singleQuesId').length,
      markItem: doc.querySelectorAll('.mark_item').length,
      TiMu: doc.querySelectorAll('.TiMu').length,
      img: doc.querySelectorAll('img').length
    },
    rows: rows,
    text: ((doc.body && doc.body.innerText) || '').replace(/\s+/g, ' ').slice(0, 500)
  };
}

function probe(){
  var doc = hwRoot();
  var href = hwHref(doc) || (function(){ try { return location.href || ''; } catch (e) { return ''; } })();
  var topHref = '';
  try { topHref = String((window.top && window.top.location && window.top.location.href) || location.href || ''); } catch (e) {
    try { topHref = location.href || ''; } catch (e2) {}
  }
  var inView = false;
  try {
    var win = doc && doc.defaultView;
    var frame = win && win.frameElement;
    var r = frame ? frame.getBoundingClientRect() : (doc.body && doc.body.getBoundingClientRect());
    var topWin = window.top || window;
    var vh = topWin.innerHeight || 800;
    var vw = topWin.innerWidth || 1200;
    inView = !!(r && r.height > 80 && r.bottom > 80 && r.top < vh - 80 && r.right > 40 && r.left < vw - 40);
  } catch (e3) {}
  return {
    ok: true,
    url: href,
    topUrl: topHref,
    questionLi: hwQCount(doc),
    work: hwIsWorkHref(href),
    topStudy: /studentstudy/i.test(topHref),
    inView: inView
  };
}

function readFillState(){
  var boxes = hwBoxes();
  var states = [];
  for (var i = 0; i < boxes.length && i < 40; i++) {
    var picked = __hwPickedOf(boxes[i]);
    var filled = picked.length > 0;
    if (!filled) {
      var ins = boxes[i].querySelectorAll('input[type="text"], textarea');
      for (var k = 0; k < ins.length; k++) {
        if (String(ins[k].value || '').trim()) { filled = true; break; }
      }
    }
    states.push({ index: i + 1, selected: picked, filled: filled });
  }
  return { states: states };
}

function readPicked(index){
  var at = Math.max(0, Number(index || 1) - 1);
  var box = hwBoxes()[at];
  if (!box) return { found: false, picked: '' };
  return { found: true, picked: __hwPickedOf(box) };
}

function debugBox(index){
  var at = Math.max(0, Number(index || 1) - 1);
  var boxes = hwBoxes();
  var box = boxes[at];
  if (!box) return { found: false, boxes: boxes.length };
  var opts = __hwChoiceNodes(box);
  var rows = [];
  for (var i = 0; i < opts.length && i < 8; i++) {
    var el = opts[i];
    var got = __hwLetterOf(el, i);
    rows.push({
      cls: String(el.className || ''),
      numData: got.letterEl ? String(got.letterEl.getAttribute('data') || '') : '',
      numCls: got.letterEl ? String(got.letterEl.className || '') : '',
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
