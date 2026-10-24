import { asObject, waitMs } from '../eval'
import { callProtocol } from '../protocol'
import { buildLocateBoxScript, isRetryableReason, locatorsToTry } from './locate'
import {
  ACT_MISS_TIMEOUT_MS,
  ACT_POLL_MS,
  ACT_TIMEOUT_MS,
  locatorScriptArg,
  normalizeLocator,
  type ActOp,
  type ActReason,
  type ActResult,
  type BrowserLocator,
} from './types'

const REASON_TEXT: Record<ActReason, string> = {
  not_found: '没有找到元素',
  hidden: '元素不可见',
  covered: '元素被挡住',
  disabled: '元素已禁用',
  readonly: '输入框不可编辑',
  unstable: '元素还在动',
  ambiguous: '匹配到多个元素',
  timeout: '等待超时',
  invalid: '缺少定位条件',
}

const asResult = (raw: unknown): ActResult => {
  const row = asObject(raw)
  const reason = String(row.reason || '') as ActReason
  const candidates = Array.isArray(row.candidates)
    ? row.candidates.map((item) => {
      const it = asObject(item)
      return { text: String(it.text || ''), reason: it.reason as ActReason | undefined }
    }).filter((item) => item.text)
    : undefined
  const retry = row.retry == null ? isRetryableReason(reason || 'not_found') : row.retry !== false
  return {
    ok: Boolean(row.ok),
    error: row.error ? String(row.error) : undefined,
    reason: reason || undefined,
    text: row.text ? String(row.text) : undefined,
    cover: row.cover ? String(row.cover) : undefined,
    candidates,
    retry,
    box: row.box ? String(row.box) : undefined,
    frameId: row.frameId ? String(row.frameId) : undefined,
    loaderId: row.loaderId ? String(row.loaderId) : undefined,
    password: row.password === true,
    filled: row.filled == null ? undefined : Boolean(row.filled),
    length: row.length == null ? undefined : Number(row.length) || 0,
  }
}

const finish = (result: ActResult, locator: BrowserLocator): ActResult => {
  if (result.ok) {
    return {
      ok: true,
      text: result.text,
      frameId: result.frameId,
      loaderId: result.loaderId,
      password: result.password,
      filled: result.filled,
      length: result.length,
    }
  }
  const reason = result.reason || 'not_found'
  const hint = result.cover ? `，挡住的是「${result.cover}」` : ''
  const names = (result.candidates || []).map((item) => item.text).filter(Boolean)
  const also = names.length ? `。候选：${names.join('、')}` : ''
  const where = locator.by === 'role' && locator.name
    ? `${locator.value}「${locator.name}」`
    : locator.name
      ? `输入框「${locator.name}」`
      : locator.by === 'text'
        ? `「${locator.value}」`
        : locator.value
  return {
    ok: false,
    reason,
    error: `${result.error || REASON_TEXT[reason] || '操作失败'}：${where}${hint}${also}`,
    cover: result.cover,
    candidates: result.candidates,
    text: result.text,
  }
}

const locateOnce = async (id: string, locators: BrowserLocator[]) => {
  const list = locators.map(locatorScriptArg).filter((item) => item.value)
  const locator = list.length === 1 ? list[0] : list
  try {
    const found = asObject(await callProtocol(id, 'find', { locator }))
    const result = asResult(found)
    const ready = Boolean(found.ok && found.x != null && found.y != null)
    return { found, result, ready }
  } catch (err) {
    const message = String(err || '')
    if (!/不是 Chromium|not found/i.test(message)) throw err
    const script = buildLocateBoxScript(list[0] || { by: 'css', value: '' })
    const found = asObject(await callProtocol(id, 'locate', { script }))
    const result = asResult(found)
    const ready = Boolean(found.ok && found.x != null && found.y != null)
    return { found, result, ready }
  }
}

const FIND_WAIT_MISSING = /browser_cdp_find_wait|不是 Chromium/i

const packHit = (found: Record<string, unknown>) => {
  const result = asResult(found)
  const ready = Boolean(found.ok && found.x != null && found.y != null)
  return { found, result, ready }
}

const locateWait = async (id: string, locators: BrowserLocator[], timeoutMs: number) => {
  const list = locators.map(locatorScriptArg).filter((item) => item.value)
  const locator = list.length === 1 ? list[0] : list
  const found = asObject(await callProtocol(id, 'find_wait', { locator, timeoutMs }))
  return packHit(found)
}

const fireBox = async (id: string, op: ActOp, found: Record<string, unknown>, text?: string) => {
  const x = Number(found.x)
  const y = Number(found.y)
  const session = found.session ? String(found.session) : undefined
  if (op === 'fill') {
    const backend = Number(found.backend)
    if (Number.isFinite(backend) && backend > 0) {
      return asObject(await callProtocol(id, 'fill_node', { backend, session, text: text ?? '' }))
    }
    // 没有节点身份时不能用全局焦点猜测输入目标。
    return { ok: false, reason: 'invalid', error: '输入目标缺少节点身份，请重新读取页面' }
  }
  const click = op === 'dblclick'
    ? { button: 'left', clickCount: 2 }
    : op === 'rightclick'
      ? { button: 'right', clickCount: 1 }
      : { button: 'left', clickCount: 1 }
  const backend = Number(found.backend)
  if (Number.isFinite(backend) && backend > 0) {
    const hit = asObject(await callProtocol(id, 'click_node', { backend, session, ...click }).catch(error => ({ ok: false, error: String(error) })))
    if (hit.ok) return hit
    // 定位时的 x/y 可能是别的候选滚过之后留下的，不能拿来再点一次。
    return asResult({
      ...hit,
      reason: hit.reason || 'unstable',
      retry: false,
      text: hit.text || found.text,
    })
  }
  return asObject(await Promise.race([
    callProtocol(id, 'click_at', { x, y, session, ...click }),
    waitMs(900).then(() => ({ ok: false, error: '点击超时' })),
  ]))
}

const fireReady = async (
  id: string,
  op: ActOp,
  found: Record<string, unknown>,
  text: string | undefined,
  fallback: string,
) => {
  const cdp = await fireBox(id, op, found, text)
  if (cdp.ok) {
    return finish({
      ok: true,
      text: op === 'fill' ? (cdp.password ? undefined : String(cdp.text ?? '')) : String(cdp.text || found.text || fallback),
      frameId: found.frameId ? String(found.frameId) : undefined,
      loaderId: found.loaderId ? String(found.loaderId) : undefined,
      password: cdp.password === true,
      filled: op === 'fill' ? true : undefined,
      length: cdp.length == null ? undefined : Number(cdp.length) || 0,
    }, { by: 'css', value: fallback })
  }
  return asResult({
    ...cdp,
    reason: cdp.reason || 'unstable',
    retry: cdp.retry !== false,
    text: cdp.text || found.text,
  })
}

const actByPolling = async (
  id: string,
  op: ActOp,
  tried: BrowserLocator[],
  locator: BrowserLocator,
  text: string | undefined,
  timeout: number,
): Promise<ActResult> => {
  const started = Date.now()
  let last: ActResult = { ok: false, reason: 'not_found', retry: true }
  while (Date.now() - started < timeout) {
    try {
      const hit = await locateOnce(id, tried)
      last = hit.result
      if (hit.ready) {
        const next = await fireReady(id, op, hit.found, text, locator.value)
        if (next.ok) return next
        if (next.retry === false) return finish(next, locator)
        last = next
      } else if (!last.retry) {
        return finish(last, locator)
      }
    } catch (err) {
      last = { ok: false, reason: 'not_found', retry: true, error: String(err) }
    }
    if (!isRetryableReason(last.reason || 'not_found')) return finish(last, locator)
    await waitMs(ACT_POLL_MS)
  }
  if (last.reason && last.reason !== 'unstable' && last.reason !== 'timeout') {
    return finish(last, locator)
  }
  return finish({ ok: false, reason: 'timeout', error: REASON_TEXT.timeout, cover: last.cover, candidates: last.candidates }, locator)
}

export const actOnBrowser = async (
  id: string,
  input: { op: ActOp; locator?: BrowserLocator; locators?: BrowserLocator[]; text?: string; timeout?: number },
): Promise<ActResult> => {
  const tried = (input.locators?.length
    ? input.locators.map(normalizeLocator).filter((item) => item.value)
    : locatorsToTry(normalizeLocator(input.locator || { by: 'css', value: '' })))
  const locator = tried[0] || normalizeLocator({ by: 'css', value: '' })
  if (!tried.length) return { ok: false, reason: 'invalid', error: '缺少定位条件' }
  const timeout = Math.min(20000, Math.max(400, input.timeout ?? ACT_TIMEOUT_MS))
  try {
    // 先扫一遍：完全没有就短等；别为一开始就不存在的文案空等满 8 秒
    const probe = await locateOnce(id, tried)
    if (probe.ready) {
      const first = await fireReady(id, input.op, probe.found, input.text, locator.value)
      if (first.ok) return first
      if (first.retry === false) return finish(first, locator)
      const again = await locateWait(id, tried, Math.min(4000, timeout))
      if (again.ready) {
        const second = await fireReady(id, input.op, again.found, input.text, locator.value)
        if (second.ok) return second
        return finish(second, locator)
      }
      return finish(again.result.reason ? again.result : first, locator)
    }
    const reason = probe.result.reason || 'not_found'
    if (reason === 'ambiguous' || reason === 'disabled' || reason === 'invalid' || reason === 'readonly') {
      return finish(probe.result, locator)
    }
    const waitMs = reason === 'not_found'
      ? Math.min(ACT_MISS_TIMEOUT_MS, timeout)
      : timeout
    const hit = await locateWait(id, tried, waitMs)
    if (hit.ready) {
      const first = await fireReady(id, input.op, hit.found, input.text, locator.value)
      if (first.ok) return first
      return finish(first, locator)
    }
    if (!hit.result.retry) return finish(hit.result, locator)
    return finish(hit.result.reason ? hit.result : probe.result, locator)
  } catch (err) {
    if (!FIND_WAIT_MISSING.test(String(err))) {
      return finish({ ok: false, reason: 'not_found', retry: true, error: String(err) }, locator)
    }
    return actByPolling(id, input.op, tried, locator, input.text, Math.min(ACT_MISS_TIMEOUT_MS, timeout))
  }
}

export const probeOnBrowser = async (id: string, locator: BrowserLocator): Promise<ActResult> => {
  const value = String(locator.value || '').trim()
  if (!value) return { ok: false, reason: 'invalid', error: '缺少定位条件' }
  try {
    const hit = await locateOnce(id, [{ ...locator, value }])
    return hit.result
  } catch (err) {
    return { ok: false, reason: 'not_found', retry: true, error: String(err) }
  }
}

export const clickByLocator = (id: string, locator: BrowserLocator, timeout?: number) => (
  actOnBrowser(id, { op: 'click', locator, timeout })
)

/** 幂等选项操作。发送一次点击后只读状态，不能在不确定时再次切换。 */
export const setCheckedByLocator = async (id: string, locator: BrowserLocator, checked: boolean) => {
  const locators = [normalizeLocator(locator)]
  let hit = await locateOnce(id, locators)
  // 仅在投递点击之前等滚动/遮挡稳定；点击一旦投递，就只读状态而不补点。
  if (!hit.ready && hit.result.retry && ['unstable', 'covered', 'hidden'].includes(hit.result.reason || '')) {
    hit = await locateWait(id, locators, 2000)
  }
  if (!hit.ready) return finish(hit.result, locator)
  const backend = Number(hit.found.backend)
  if (!Number.isFinite(backend) || backend <= 0) return { ok: false, error: '选项缺少节点身份，请重新读取页面' }
  return asObject(await callProtocol(id, 'set_checked', { backend, session: hit.found.session, checked }))
}

export const fillByLocator = (id: string, locator: BrowserLocator, text: string, timeout?: number) => (
  actOnBrowser(id, { op: 'fill', locator, text, timeout })
)

export const clickByLocators = (id: string, locators: BrowserLocator[], timeout?: number) => (
  actOnBrowser(id, { op: 'click', locators, timeout })
)

export const fillByLocators = (id: string, locators: BrowserLocator[], text: string, timeout?: number) => (
  actOnBrowser(id, { op: 'fill', locators, text, timeout })
)
