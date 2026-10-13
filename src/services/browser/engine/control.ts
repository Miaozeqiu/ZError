import { asObject } from '../eval'
import { callProtocol } from '../protocol'
import { clickByLocator } from './act'
import { buildLocatedActionScript } from './locate'
import { normalizeLocator, type BrowserLocator } from './types'

export type ControlOp = 'check' | 'uncheck' | 'select'

const CONTROL_BODY = (op: ControlOp, value: string) => `var wantOp = ${JSON.stringify(op)};
  var wantVal = ${JSON.stringify(value)};
  var label = __zeLabel(el).slice(0, 80);
  var tag = String(el.tagName || '').toLowerCase();
  var type = '';
  try { type = String(el.type || '').toLowerCase(); } catch (eT) {}
  if (wantOp === 'check' || wantOp === 'uncheck') {
    var should = wantOp === 'check';
    var box = el;
    if (tag === 'label') {
      try { box = el.control || el.querySelector('input[type="checkbox"], input[type="radio"]') || el; } catch (eL) {}
    }
    var boxType = '';
    try { boxType = String(box.type || '').toLowerCase(); } catch (eB) {}
    if (boxType !== 'checkbox' && boxType !== 'radio') {
      return __zeFail('invalid', { retry: false, text: label, error: '不是复选框或单选框' });
    }
    if (!!box.checked === should) return { ok: true, text: label, checked: !!box.checked };
    try { box.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (eS) {}
    box.checked = should;
    try { box.dispatchEvent(new Event('input', { bubbles: true })); } catch (eI) {}
    try { box.dispatchEvent(new Event('change', { bubbles: true })); } catch (eC) {}
    return { ok: !!box.checked === should, text: label, checked: !!box.checked };
  }
  if (tag !== 'select') {
    return __zeFail('invalid', { retry: false, text: label, error: '不是下拉框' });
  }
  var opts = el.options || [];
  var hit = -1;
  for (var i = 0; i < opts.length; i++) {
    var ov = String(opts[i].value || '');
    var ot = String(opts[i].text || opts[i].label || '').replace(/\\s+/g, ' ').trim();
    if (ov === wantVal || ot === wantVal) { hit = i; break; }
  }
  if (hit < 0) return { ok: false, reason: 'not_found', retry: false, text: label, error: '没有这个选项：' + wantVal };
  el.selectedIndex = hit;
  try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (eI2) {}
  try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (eC2) {}
  return { ok: true, text: String(opts[hit].text || wantVal), value: String(opts[hit].value || '') };`

export const buildControlScript = (locator: BrowserLocator, op: ControlOp, value = '') => (
  buildLocatedActionScript(locator, CONTROL_BODY(op, value))
)

export const controlOnBrowser = async (
  id: string,
  input: { op: ControlOp; locator: BrowserLocator; value?: string },
) => {
  const locator = normalizeLocator(input.locator)
  if (!locator.value) return { ok: false, reason: 'invalid' as const, error: '缺少定位条件' }
  if (input.op === 'check' || input.op === 'uncheck') {
    const acted = await clickByLocator(id, locator)
    return {
      ok: Boolean(acted.ok),
      error: acted.error,
      text: acted.text,
      reason: acted.reason,
    }
  }
  try {
    const raw = asObject(await callProtocol(id, 'locate', {
      script: buildControlScript(locator, input.op, input.value || ''),
    }))
    return {
      ok: Boolean(raw.ok),
      error: raw.error ? String(raw.error) : undefined,
      text: raw.text ? String(raw.text) : undefined,
      reason: raw.reason ? String(raw.reason) : undefined,
      checked: raw.checked == null ? undefined : Boolean(raw.checked),
      value: raw.value == null ? undefined : String(raw.value),
    }
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error || '控件操作失败') }
  }
}
