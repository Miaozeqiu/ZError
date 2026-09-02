// 共用：同域 iframe 遍历、点击。新站点先改选择器，不要另写一套 walk。
function frames(win, depth) {
  var out = [win];
  if ((depth || 0) > 4) return out;
  try {
    var list = win.document.querySelectorAll('iframe');
    for (var i = 0; i < list.length; i++) {
      try {
        var child = list[i].contentWindow;
        if (child && child.document) out = out.concat(frames(child, (depth || 0) + 1));
      } catch (e) {}
    }
  } catch (e) {}
  return out;
}

function clickEl(el) {
  if (!el) return;
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e) {}
  var view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: view }));
  if (typeof el.click === 'function') el.click();
}
