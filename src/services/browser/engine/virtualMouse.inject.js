function __zeMouseTop(){
  try { return window.top || window; } catch (e) { return window; }
}
function __zeMousePoint(el){
  var r = { left: 0, top: 0, width: 2, height: 2 };
  try { r = el.getBoundingClientRect(); } catch (e0) {}
  var x = r.left + r.width / 2;
  var y = r.top + r.height / 2;
  var win = (el.ownerDocument && el.ownerDocument.defaultView) || window;
  var top = __zeMouseTop();
  while (win && win !== top) {
    var frame = null;
    try { frame = win.frameElement; } catch (e1) { break; }
    if (!frame) break;
    var fr = { left: 0, top: 0 };
    try { fr = frame.getBoundingClientRect(); } catch (e2) {}
    x += fr.left;
    y += fr.top;
    try { win = win.parent; } catch (e3) { break; }
  }
  return { x: x, y: y };
}
function __zeEnsureMouse(){
  var top = __zeMouseTop();
  if (top.__ZE_MOUSE__ && top.document.getElementById('__ze_mouse_root')) return top.__ZE_MOUSE__;
  var doc = top.document;
  var root = doc.getElementById('__ze_mouse_root');
  if (!root) {
    root = doc.createElement('div');
    root.id = '__ze_mouse_root';
    root.setAttribute('aria-hidden', 'true');
    var style = doc.createElement('style');
    style.textContent = '#__ze_mouse_root{position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none !important;overflow:visible;}'
      + '#__ze_mouse_root *{pointer-events:none !important;}'
      + '#__ze_mouse_root .ze-m{position:absolute;left:0;top:0;width:18px;height:24px;margin:0;transform:translate3d(72px,96px,0) scale(1);transform-origin:1px 1px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.28));will-change:transform;}'
      + '#__ze_mouse_root .ze-ring{position:absolute;left:0;top:0;width:22px;height:22px;margin:-11px 0 0 -11px;border-radius:50%;border:2px solid rgba(0,0,0,.42);opacity:0;pointer-events:none;}'
      + '#__ze_mouse_root .ze-ring.is-on{animation:ze-mouse-ring .42s ease-out;}'
      + '#__ze_mouse_root .ze-chip{position:absolute;left:0;top:0;padding:3px 7px;border-radius:6px;background:rgba(22,22,24,.88);color:#fff;font:11px/1.2 -apple-system,BlinkMacSystemFont,sans-serif;letter-spacing:.01em;opacity:0;transform:translate(16px,-8px);white-space:nowrap;max-width:160px;overflow:hidden;text-overflow:ellipsis;}'
      + '#__ze_mouse_root .ze-chip.is-on{opacity:1;}'
      + '@keyframes ze-mouse-ring{0%{transform:scale(.35);opacity:.45}100%{transform:scale(1.7);opacity:0}}';
    root.appendChild(style);
    var ringEl = doc.createElement('div');
    ringEl.className = 'ze-ring';
    var chipEl = doc.createElement('div');
    chipEl.className = 'ze-chip';
    var curEl = doc.createElement('div');
    curEl.className = 'ze-m';
    curEl.innerHTML = '<svg width="18" height="24" viewBox="0 0 18 24" fill="none"><path d="M1.2 1.2v16.2l4.4-3.7 3.1 7.4 2.5-1.1-3.1-7.3h6.3L1.2 1.2z" fill="#fff" stroke="#111" stroke-width="1.15" stroke-linejoin="round"/></svg>';
    root.appendChild(ringEl);
    root.appendChild(chipEl);
    root.appendChild(curEl);
    (doc.documentElement || doc.body).appendChild(root);
  }
  var cur = root.querySelector('.ze-m');
  var ring = root.querySelector('.ze-ring');
  var chip = root.querySelector('.ze-chip');
  var x = 72;
  var y = 96;
  var tx = 72;
  var ty = 96;
  var raf = 0;
  var reduced = false;
  try { reduced = !!(top.matchMedia && top.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e4) {}
  var apply = function(scale){
    var s = scale == null ? 1 : scale;
    cur.style.transform = 'translate3d(' + x + 'px,' + y + 'px,0) scale(' + s + ')';
    ring.style.left = x + 'px';
    ring.style.top = y + 'px';
    chip.style.left = x + 'px';
    chip.style.top = y + 'px';
  };
  var tick = function(){
    var dx = tx - x;
    var dy = ty - y;
    if (reduced || (dx * dx + dy * dy) < 0.4) {
      x = tx;
      y = ty;
      raf = 0;
      apply(1);
      return;
    }
    x += dx * 0.22;
    y += dy * 0.22;
    apply(1);
    raf = top.requestAnimationFrame(tick);
  };
  var move = function(nx, ny){
    tx = nx;
    ty = ny;
    if (reduced || !top.requestAnimationFrame) { x = nx; y = ny; apply(1); return; }
    if (!raf) raf = top.requestAnimationFrame(tick);
  };
  var pulse = function(){
    ring.classList.remove('is-on');
    void ring.offsetWidth;
    ring.classList.add('is-on');
    cur.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(.88)';
    top.setTimeout(function(){ apply(1); }, 90);
  };
  var say = function(text){
    var t = String(text || '').replace(/\s+/g, ' ').trim();
    if (!t || t.length > 18) { chip.classList.remove('is-on'); chip.textContent = ''; return; }
    chip.textContent = t;
    chip.classList.add('is-on');
    top.setTimeout(function(){ chip.classList.remove('is-on'); }, 900);
  };
  var api = {
    act: function(kind, nx, ny, label){
      root.style.visibility = 'visible';
      move(Number(nx) || 0, Number(ny) || 0);
      if (kind === 'click' || kind === 'type') pulse();
      say(label || (kind === 'type' ? '输入' : kind === 'scroll' ? '滚动' : ''));
    },
    cover: function(on){
      root.style.visibility = on ? 'visible' : 'hidden';
    }
  };
  top.__ZE_MOUSE__ = api;
  apply(1);
  return api;
}
function __zeMouseOn(el, kind, label){
  if (!el) return;
  try {
    var p = __zeMousePoint(el);
    __zeEnsureMouse().act(kind || 'click', p.x, p.y, label || '');
  } catch (e) {}
}
