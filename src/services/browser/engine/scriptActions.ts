import { asObject, evalBrowserView, waitMs } from '../eval'
import { buildLocatedActionScript, isRetryableReason } from './locate'
import { ACT_POLL_MS, type ActOp, type BrowserLocator } from './types'

const script = (locator: BrowserLocator, op: ActOp, text = '') => buildLocatedActionScript(locator, `
  var ready = __zeReady(el, loc);
  if (!ready.ok) return ready;
  var op = ${JSON.stringify(op)}, text = ${JSON.stringify(text)};
  if (op === 'ready') return ready;
  if (op === 'fill') {
    var tag = String(el.tagName || '').toLowerCase();
    var inputType = String(el.type || '').toLowerCase();
    if (el.readOnly || el.disabled || (tag === 'input' && /^(checkbox|radio|file|hidden|button|submit|reset|image|range|color)$/.test(inputType))
      || (!el.isContentEditable && tag !== 'input' && tag !== 'textarea'))
      return __zeFail('readonly', {retry:false});
    var view = el.ownerDocument.defaultView;
    el.focus();
    if (el.isContentEditable) el.textContent = text;
    else {
      var prototype = tag === 'textarea' ? view.HTMLTextAreaElement.prototype : view.HTMLInputElement.prototype;
      var setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
      setter.call(el, text);
    }
    el.dispatchEvent(new view.Event('input', {bubbles:true}));
    el.dispatchEvent(new view.Event('change', {bubbles:true}));
    var actual = String(el.isContentEditable ? el.textContent : el.value);
    var password = String(el.type || '').toLowerCase() === 'password';
    return {ok:actual===text, filled:actual===text, length:actual.length, password:password, text:password?'':actual};
  }
  el.focus(); el.click();
  return {ok:true, text:__zeLabel(el).slice(0,80)};
`)

/** 系统 WebView 使用已有的固定 DOM 算法；只轮询只读探测，写入最多投递一次。 */
export const pageScriptAction = async (id: string, op: ActOp, locators: BrowserLocator[], text?: string, timeout = 1500) => {
  if (!['click', 'fill', 'ready'].includes(op) || locators.some(row => row.backend || row.frameId || row.loaderId)) {
    return { ok: false, reason: 'invalid', retry: false, error: '当前引擎不支持此操作或节点身份，请重新读取页面' }
  }
  const deadline = Date.now() + timeout
  let last: Record<string, unknown> = { ok: false, reason: 'not_found' }
  do {
    for (const locator of locators) {
      last = asObject(await evalBrowserView(id, script(locator, 'ready')))
      if (last.ok) {
        if (op === 'ready') return last
        // 写入异常可能意味着动作已执行，交给调用方读取状态，不在这里重试。
        return asObject(await evalBrowserView(id, script(locator, op, text)))
      }
      if (!isRetryableReason(String(last.reason || 'not_found'))) return last
    }
    if (Date.now() >= deadline) break
    await waitMs(ACT_POLL_MS)
  } while (Date.now() < deadline)
  return last
}
