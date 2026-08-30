import { asObject, clickFrameText, evalBrowserView, waitMs } from '../eval'
import { ENGINE_ACT_SCRIPT } from './script'
import {
  ACT_POLL_MS,
  ACT_TIMEOUT_MS,
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
  return {
    ok: Boolean(row.ok),
    error: row.error ? String(row.error) : undefined,
    reason: reason || undefined,
    text: row.text ? String(row.text) : undefined,
    cover: row.cover ? String(row.cover) : undefined,
    candidates,
    retry: row.retry !== false,
    box: row.box ? String(row.box) : undefined,
  }
}

const finish = (result: ActResult, locator: BrowserLocator): ActResult => {
  if (result.ok) return { ok: true, text: result.text }
  const reason = result.reason || 'not_found'
  const hint = result.cover ? `，挡住的是「${result.cover}」` : ''
  const names = (result.candidates || []).map((item) => item.text).filter(Boolean)
  const also = names.length ? `。候选：${names.join('、')}` : ''
  const where = locator.by === 'text' ? `「${locator.value}」` : locator.value
  return {
    ok: false,
    reason,
    error: `${result.error || REASON_TEXT[reason] || '操作失败'}：${where}${hint}${also}`,
    cover: result.cover,
    candidates: result.candidates,
    text: result.text,
  }
}

export const actOnBrowser = async (
  id: string,
  input: { op: ActOp; locator: BrowserLocator; text?: string; timeout?: number },
): Promise<ActResult> => {
  const locator = {
    by: input.locator.by,
    value: String(input.locator.value || '').trim(),
    name: input.locator.name,
    exact: input.locator.exact,
  }
  if (!locator.value) return { ok: false, reason: 'invalid', error: '缺少定位条件' }
  const timeout = Math.min(20000, Math.max(400, input.timeout ?? ACT_TIMEOUT_MS))
  const started = Date.now()
  let last: ActResult = { ok: false, reason: 'not_found', retry: true }
  let askedFrames = false
  while (Date.now() - started < timeout) {
    last = asResult(await evalBrowserView(id, ENGINE_ACT_SCRIPT({
      op: input.op,
      locator,
      text: input.text,
    })).catch((err) => ({ ok: false, reason: 'not_found', retry: true, error: String(err) })))
    if (last.ok) return finish(last, locator)
    if (!last.retry) return finish(last, locator)
    if (
      !askedFrames
      && input.op === 'click'
      && locator.by === 'text'
      && (last.reason === 'not_found' || last.reason === 'hidden')
    ) {
      askedFrames = true
      const crossed = await clickFrameText(id, locator.value)
      if (crossed.ok) return finish({ ok: true, text: locator.value }, locator)
    }
    await waitMs(ACT_POLL_MS)
  }
  if (!askedFrames && input.op === 'click' && locator.by === 'text') {
    const crossed = await clickFrameText(id, locator.value)
    if (crossed.ok) return finish({ ok: true, text: locator.value }, locator)
  }
  if (last.reason && last.reason !== 'unstable') return finish(last, locator)
  return finish({ ok: false, reason: 'timeout', error: REASON_TEXT.timeout, cover: last.cover, candidates: last.candidates }, locator)
}

export const probeOnBrowser = async (id: string, locator: BrowserLocator): Promise<ActResult> => (
  asResult(await evalBrowserView(id, ENGINE_ACT_SCRIPT({
    op: 'ready',
    locator,
  })).catch((err) => ({ ok: false, reason: 'not_found', retry: true, error: String(err) })))
)

export const clickByLocator = (id: string, locator: BrowserLocator, timeout?: number) => (
  actOnBrowser(id, { op: 'click', locator, timeout })
)

export const fillByLocator = (id: string, locator: BrowserLocator, text: string, timeout?: number) => (
  actOnBrowser(id, { op: 'fill', locator, text, timeout })
)
