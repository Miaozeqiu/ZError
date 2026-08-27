import { invoke } from '@tauri-apps/api/core'

/** 同源 iframe 遍历 + 点击/取链，注入到页面 eval 里复用。 */
export const SAME_ORIGIN_FRAMES = `function __sameFrames(win, depth){
  var out = [win];
  if ((depth || 0) > 4) return out;
  try {
    var list = win.document.querySelectorAll('iframe');
    for (var i = 0; i < list.length; i++) {
      try {
        var child = list[i].contentWindow;
        if (child && child.document) out = out.concat(__sameFrames(child, (depth || 0) + 1));
      } catch (e) {}
    }
  } catch (e) {}
  return out;
}
function __findEl(sel){
  var frames = __sameFrames(window, 0);
  for (var i = 0; i < frames.length; i++) {
    try {
      var el = frames[i].document.querySelector(sel);
      if (el) return el;
    } catch (e) {}
  }
  return null;
}
function __clickEl(el){
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  var view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
  el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: view }));
  if (typeof el.click === 'function') el.click();
}
function __navHref(el){
  if (!el) return '';
  var a = el.tagName === 'A' ? el : (el.closest ? el.closest('a') : null);
  if (!a) return '';
  var href = '';
  try { href = String(a.href || a.getAttribute('href') || ''); } catch (e) { href = String(a.getAttribute('href') || ''); }
  if (!href || href === '#' || href.indexOf('javascript:') === 0) return '';
  return href;
}
`

export const waitMs = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))

export const asObject = (value: unknown): Record<string, unknown> => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>
    } catch {
      // ignore
    }
  }
  return {}
}

export const evalBrowserView = async (id: string, script: string) => {
  const raw = await invoke<string>('browser_eval', { id, script })
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object' && '__error' in parsed) {
      throw new Error(String((parsed as { __error: unknown }).__error || '脚本执行失败'))
    }
    return parsed
  } catch (error) {
    if (error instanceof SyntaxError) return raw
    throw error
  }
}

export const askFrames = async (id: string, op = 'snap', extra?: Record<string, string>) => {
  await evalBrowserView(id, `(function(){
    if (typeof window.__ZE_ASK_FRAMES__ === 'function') {
      window.__ZE_ASK_FRAMES__(${JSON.stringify(op)}, ${JSON.stringify(extra || {})});
      return true;
    }
    return false;
  })()`).catch(() => false)
  const wait = op === 'hwstate' || op === 'hwpick' ? 80 : op === 'click' ? 350 : op === 'snap' ? 700 : 450
  await waitMs(wait)
}
