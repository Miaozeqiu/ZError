import { invoke } from '@tauri-apps/api/core'
import { browserAutomationArgs } from './control'
import { FRAME_SCOPE } from './engine/frame'
import { VIRTUAL_MOUSE_JS } from './engine/virtualMouse'

/** 同源 iframe 遍历 + 点击/取链，注入到页面 eval 里复用。 */
export const SAME_ORIGIN_FRAMES = `${import.meta.env.DEV ? VIRTUAL_MOUSE_JS : ''}
${FRAME_SCOPE}
function __sameFrames(win, depth){
  var out = [win];
  if ((depth || 0) >= 4) return out;
  try {
    var list = win.document.querySelectorAll('iframe');
    for (var i = 0; i < list.length; i++) {
      try {
        var child = list[i].contentWindow;
        var href = '';
        try { href = String((child && child.location && child.location.href) || ''); } catch (eH) {}
        var emptyBlank = href === 'about:blank' || /^(?:about:|javascript:)/i.test(href);
        if (emptyBlank) {
          var filled = false;
          try { filled = !!(child.document && child.document.body && child.document.body.childElementCount); } catch (eB) {}
          if (!filled) continue;
        }
        if (child && child.document && child.document.readyState !== 'loading') {
          out = out.concat(__sameFrames(child, (depth || 0) + 1));
        }
      } catch (e) {}
    }
  } catch (e) {}
  return out;
}
function __visibleEl(el){
  if (!el) return false;
  try {
    var r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return false;
    var st = (el.ownerDocument.defaultView || window).getComputedStyle(el);
    if (!st || st.visibility === 'hidden' || st.display === 'none' || Number(st.opacity) === 0) return false;
  } catch (e) {}
  return true;
}
function __findEl(sel){
  var frames = __sameFrames(window, 0);
  var fallback = null;
  for (var i = 0; i < frames.length; i++) {
    try {
      var nodes = frames[i].document.querySelectorAll(sel);
      for (var j = 0; j < nodes.length; j++) {
        if (__visibleEl(nodes[j])) return nodes[j];
        if (!fallback) fallback = nodes[j];
      }
    } catch (e) {}
  }
  return fallback;
}
function __fillEl(el, text){
  if (!el) return { ok: false, filled: false, length: 0 };
  var want = String(text == null ? '' : text);
  try { el.scrollIntoView({ block: 'center', inline: 'nearest' }); } catch (e0) {}
  try { __zeMouseOn(el, 'type', ''); } catch (eM) {}
  try { el.click(); } catch (e1) {}
  try { el.focus(); } catch (e2) {}
  try { if (typeof el.select === 'function') el.select(); } catch (e3) {}
  var apply = function(value){
    if (el.isContentEditable) { el.textContent = value; return; }
    var proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    var desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
    try { el._value = value; } catch (eV) {}
  };
  apply('');
  try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e4) {}
  apply(want);
  try {
    el.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, composed: true, data: want, inputType: 'insertFromPaste' }));
  } catch (e5) {
    try { el.dispatchEvent(new Event('input', { bubbles: true })); } catch (e6) {}
  }
  try { el.dispatchEvent(new Event('change', { bubbles: true })); } catch (e7) {}
  var got = el.isContentEditable ? String(el.textContent || '') : String(el.value || '');
  var pwd = false;
  try { pwd = String(el.type || '').toLowerCase() === 'password'; } catch (e8) {}
  var filled = !want || got.length > 0;
  return { ok: filled, filled: filled, length: got.length, password: pwd, text: pwd ? '' : got.slice(0, 80) };
}
function __clickEl(el){
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
  try { __zeMouseOn(el, 'click', ''); } catch (eM) {}
  var view = (el.ownerDocument && el.ownerDocument.defaultView) || window;
  var rect = { left: 0, top: 0, width: 2, height: 2 };
  try { rect = el.getBoundingClientRect(); } catch (eR) {}
  var x = rect.left + rect.width / 2;
  var y = rect.top + rect.height / 2;
  var hit = el;
  try {
    var at = view.document.elementFromPoint(x, y);
    if (at && !(at.closest && at.closest('#__ze_mouse_root'))) hit = at;
  } catch (eP) {}
  var a = hit.closest ? hit.closest('a') : null;
  var target = a || hit;
  var fire = function(node, type, Ctor){
    try { node.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, view: view, clientX: x, clientY: y, button: 0 })); } catch (eF) {}
  };
  if (typeof PointerEvent === 'function') fire(target, 'pointerdown', PointerEvent);
  fire(target, 'mousedown', MouseEvent);
  if (typeof PointerEvent === 'function') fire(target, 'pointerup', PointerEvent);
  fire(target, 'mouseup', MouseEvent);
  fire(target, 'click', MouseEvent);
  if (typeof target.click === 'function') {
    try { target.click(); } catch (eC) {}
  }
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

const TOP_LEVEL_WORD = /^(return|const|let|var|function|class|if|for|while|do|switch|try|throw)$/

/** 深度 0 上的 return / const / let / 分号才是语句。函数里面的 return 不算。 */
export const hasTopLevelStatement = (script: string) => {
  const source = String(script || '')
  let depth = 0
  let quote = ''
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (quote) {
      if (ch === '\\') {
        i += 1
        continue
      }
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === '\'' || ch === '`') {
      quote = ch
      continue
    }
    if (ch === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && source[i + 1] === '*') {
      i += 2
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) i += 1
      i += 1
      continue
    }
    if (ch === '(' || ch === '{' || ch === '[') {
      depth += 1
      continue
    }
    if (ch === ')' || ch === '}' || ch === ']') {
      depth = Math.max(0, depth - 1)
      continue
    }
    if (depth !== 0) continue
    if (ch === ';') return true
    if (/[A-Za-z_$]/.test(ch)) {
      const word = source.slice(i).match(/^[A-Za-z_$][\w$]*/)?.[0] || ''
      if (TOP_LEVEL_WORD.test(word)) return true
      i += Math.max(0, word.length - 1)
    }
  }
  return false
}

/** 顶层 `return` 在 CDP 里是语法错误，包成 IIFE；单表达式也包一层保证可返回。 */
export const wrapEvalExpression = (script: string) => {
  const trimmed = script.trim()
  if (!trimmed) return trimmed
  if (
    trimmed.startsWith('(function')
    || trimmed.startsWith('(()=>')
    || trimmed.startsWith('(() =>')
    || trimmed.startsWith('(async')
  ) {
    return trimmed
  }
  if (hasTopLevelStatement(trimmed)) {
    return `(function(){\n${trimmed}\n})()`
  }
  return `(function(){ return (${trimmed}); })()`
}

const videoEvalNoted = new Set<string>()

/** 脚本在读播放器，而快照里已经有 video 行时，提示一次。 */
export const videoSnapshotNote = (browserId: string, script: string, snapshot: string) => {
  const id = String(browserId || '').trim() || '_'
  if (videoEvalNoted.has(id)) return ''
  if (!/currentTime|\bpaused\b|\.duration\b|readyState/.test(String(script || ''))) return ''
  if (!/^\s*- video\b/m.test(String(snapshot || ''))) return ''
  videoEvalNoted.add(id)
  return '快照里已有 video 行。'
}

/** 语法错带上列号附近的原文，并指向快照里已经有的状态。 */
export const explainEvalError = (message: string, script: string) => {
  const raw = String(message || '')
  if (!raw) return raw
  if (raw.includes('video 行')) return raw
  const lower = raw.toLowerCase()
  const syntax = lower.includes('syntaxerror') || lower.includes('unexpected token') || lower.includes('illegal return')
  if (!syntax) return raw
  let column = 0
  try {
    const parsed = JSON.parse(raw) as { columnNumber?: number }
    column = Number(parsed.columnNumber) || 0
  } catch {
    const match = raw.match(/column(?:Number)?"?\s*[:=]\s*(\d+)/i)
    column = match ? Number(match[1]) : 0
  }
  const chars = Array.from(String(script || ''))
  let place = '脚本里'
  if (column > 0 && chars.length) {
    const idx = Math.min(column, chars.length - 1)
    const near = chars.slice(Math.max(0, idx - 10), Math.min(chars.length, idx + 10)).join('')
    place = near ? `第 ${column} 列附近「${near}」` : `第 ${column} 列`
  }
  const desc = raw.includes('SyntaxError') ? raw.replace(/^\{[\s\S]*"description":"([^"]+)".*$/, '$1') : raw
  const head = desc.startsWith('SyntaxError') || desc.startsWith('脚本') ? desc.slice(0, 120) : `脚本语法错：${desc.slice(0, 80)}`
  return `${head}。错在${place}。多数信息在 get_page 的 video 行、[done] 标记里。`
}

/** browser_eval 是 `var value = SCRIPT`，前面不能直接写 function 声明。 */
export const frameScript = (iife: string) =>
  `(function(){\n${SAME_ORIGIN_FRAMES}\nreturn ${iife.trim()};\n})()`

/** 把「helpers + 尾部 IIFE」收成单表达式，避免 prepare_eval 误判。 */
export const withSameFrames = (bodyIife: string) => frameScript(bodyIife.trim())

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

/** 每 page session 一条 in-flight evaluate。act 排队；probe 拿不到锁就丢。 */
type EvalWaiter = { resolve: (got: boolean) => void }

const evalBusy = new Set<string>()
const evalWaiters = new Map<string, EvalWaiter[]>()

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    for (const list of evalWaiters.values()) {
      for (const item of list) item.resolve(true)
    }
    evalBusy.clear()
    evalWaiters.clear()
  })
}

const evalKey = (id: string) => String(id || '').trim() || '_'

const takeEval = (key: string) => {
  if (evalBusy.has(key)) return false
  evalBusy.add(key)
  return true
}

const releaseEval = (key: string) => {
  evalBusy.delete(key)
  const list = evalWaiters.get(key)
  if (!list?.length) {
    evalWaiters.delete(key)
    return
  }
  if (!takeEval(key)) return
  const next = list.shift()
  if (!list.length) evalWaiters.delete(key)
  next?.resolve(true)
}

const waitEval = (key: string, timeoutMs?: number) =>
  new Promise<boolean>((resolve) => {
    const item: EvalWaiter = { resolve }
    const list = evalWaiters.get(key) || []
    list.push(item)
    evalWaiters.set(key, list)
    if (timeoutMs == null || timeoutMs <= 0) return
    window.setTimeout(() => {
      const cur = evalWaiters.get(key)
      const idx = cur?.indexOf(item) ?? -1
      if (idx < 0) return
      cur!.splice(idx, 1)
      if (!cur!.length) evalWaiters.delete(key)
      resolve(false)
    }, timeoutMs)
  })

const acquireEval = async (key: string, timeoutMs?: number) => {
  if (takeEval(key)) return true
  return waitEval(key, timeoutMs)
}

export const isEvalActBusy = (id: string) => evalBusy.has(evalKey(id))

export const withIdleEval = async <T>(fn: () => Promise<T>): Promise<T> => {
  // 后台轮询用：占线时跳过这一轮，不要把全局 eval 都标成 idle。
  return fn()
}

let engineKind: string | null = null

export const browserEngine = async () => {
  if (engineKind) return engineKind
  try {
    engineKind = String(await invoke<string>('browser_engine') || 'webview')
  } catch {
    engineKind = 'webview'
  }
  return engineKind
}

export const isCefEngine = async () => (await browserEngine()) === 'cef'

const runEvalScript = async (id: string, script: string) => {
  const raw = await invoke<string>('browser_eval', { id, script: wrapEvalExpression(script), ...browserAutomationArgs(id) })
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

export const evalBrowserViewIdle = async (id: string, script: string) => {
  const key = evalKey(id)
  if (!takeEval(key)) return null
  try {
    return await runEvalScript(id, script)
  } finally {
    releaseEval(key)
  }
}

export const evalBrowserView = async (id: string, script: string) => {
  const key = evalKey(id)
  if (!await acquireEval(key, 2500)) {
    throw new Error('页面正忙，eval 排队超时')
  }
  try {
    return await runEvalScript(id, script)
  } finally {
    releaseEval(key)
  }
}

const runEvalMain = async (id: string, script: string) => {
  const raw = await invoke<string>('browser_eval_main', { id, script: wrapEvalExpression(script), ...browserAutomationArgs(id) })
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

/** 在指定 frame 的独立 CDP 上下文执行，支持同进程跨域与 OOPIF。 */
export const evalBrowserViewInFrame = async (id: string, script: string, frame: string) => {
  const want = String(frame || '').trim()
  if (!want) return evalBrowserViewMain(id, script)
  const { callProtocol } = await import('./protocol')
  const raw = await callProtocol(id, 'frame_eval', { frame: want, script: wrapEvalExpression(script) })
  if (raw.ok === false) throw new Error(String(raw.error || '目标 frame 读取失败'))
  return raw.result
}

/** 只在顶层 page 执行。脚本自己 walk iframe（任务点/播放器），避免 CDP 扫每一帧。 */
export const evalBrowserViewMain = async (id: string, script: string) => {
  const key = evalKey(id)
  if (!await acquireEval(key, 1600)) {
    throw new Error('页面正忙，eval 排队超时')
  }
  try {
    return await runEvalMain(id, script)
  } finally {
    releaseEval(key)
  }
}

/** 顶层短脚本：有空位就打，占线就丢。 */
export const evalBrowserViewMainNow = async (id: string, script: string) => {
  const key = evalKey(id)
  if (!takeEval(key)) return null
  try {
    return await runEvalMain(id, script)
  } finally {
    releaseEval(key)
  }
}

/** 顶层探测：占线就跳过，不要再排队把播放器卡死。 */
export const evalBrowserViewMainIdle = async (id: string, script: string) => {
  const key = evalKey(id)
  if (!takeEval(key)) return null
  try {
    return await runEvalMain(id, script)
  } finally {
    releaseEval(key)
  }
}

const clipEvalValue = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return '[…]'
  if (typeof value === 'string') {
    return value.length > 12_000 ? `${value.slice(0, 12_000)}…(截断 ${value.length})` : value
  }
  if (Array.isArray(value)) {
    const max = 40
    const items = value.slice(0, max).map((item) => clipEvalValue(item, depth + 1))
    if (value.length > max) items.push(`…另有 ${value.length - max} 项`)
    return items
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    let n = 0
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (n >= 40) {
        out.__more = '…'
        break
      }
      out[key] = clipEvalValue(item, depth + 1)
      n += 1
    }
    return out
  }
  return value
}

/** Agent 专用：多帧 CDP 结果。内部解析器继续用 evalBrowserView（取 best）。 */
export const evalBrowserFrames = async (id: string, script: string) => {
  const key = evalKey(id)
  if (!await acquireEval(key, 2500)) {
    throw new Error('页面正忙，eval 排队超时')
  }
  try {
    const raw = asObject(await invoke('browser_eval_frames', {
      id,
      ...browserAutomationArgs(id),
      script: wrapEvalExpression(script),
    }))
    const frames = (Array.isArray(raw.frames) ? raw.frames : []).map((item) => {
      const row = asObject(item)
      return {
        url: String(row.url || ''),
        result: clipEvalValue(row.result),
        error: row.error == null ? null : String(row.error),
      }
    })
    return {
      frames,
      result: clipEvalValue(raw.result),
      hint: String(raw.hint || '脚本已在各 frame 内执行；不要写 iframe.contentDocument。'),
      error: raw.error ? String(raw.error) : undefined,
    }
  } finally {
    releaseEval(key)
  }
}

export const clickFrameText = async (id: string, text: string) => {
  const want = String(text || '').trim()
  if (!want) return { ok: false, text: '', href: '' }
  try {
    const { callProtocol } = await import('./protocol')
    const cdp = asObject(await callProtocol(id, 'click', { text: want }))
    if (cdp.ok) {
      return { ok: true, text: String(cdp.text || want), href: String(cdp.href || '') }
    }
    return { ok: false, text: String(cdp.text || want), href: String(cdp.href || '') }
  } catch {
    return { ok: false, text: want, href: '' }
  }
}

/** 内核已是 CEF：iframe 由 CDP eval_all_frames 进，不再往顶层堆快照。 */
export const askFrames = async (_id: string, _op = 'snap', _extra?: Record<string, string>) => {}
