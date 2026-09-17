import { invoke } from '@tauri-apps/api/core'
import { asObject, waitMs } from '../eval'
import { buildLocateBoxScript, isRetryableReason, locatorsToTry } from './locate'
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
    filled: row.filled == null ? undefined : Boolean(row.filled),
    length: row.length == null ? undefined : Number(row.length) || 0,
  }
}

const finish = (result: ActResult, locator: BrowserLocator): ActResult => {
  if (result.ok) {
    return {
      ok: true,
      text: result.text,
      filled: result.filled,
      length: result.length,
    }
  }
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

const locateOnce = async (id: string, locator: BrowserLocator) => {
  const script = buildLocateBoxScript(locator)
  const found = asObject(await invoke('browser_cdp_locate', { id, script }))
  const result = asResult(found)
  const ready = Boolean(found.ok && found.x != null && found.y != null)
  return { script, found, result, ready }
}

const fireBox = async (id: string, op: ActOp, script: string, text?: string) => {
  if (op === 'fill') {
    return asObject(await invoke('browser_cdp_fill_box', { id, script, text: text || '' }))
  }
  return asObject(await invoke('browser_cdp_click_box', { id, script }))
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
  const tried = locatorsToTry(locator)
  const timeout = Math.min(20000, Math.max(400, input.timeout ?? ACT_TIMEOUT_MS))
  const started = Date.now()
  let last: ActResult = { ok: false, reason: 'not_found', retry: true }
  while (Date.now() - started < timeout) {
    let retryRound = false
    for (const loc of tried) {
      try {
        const hit = await locateOnce(id, loc)
        last = hit.result
        if (hit.ready) {
          const cdp = await fireBox(id, input.op, hit.script, input.text)
          if (cdp.ok) {
            return finish({
              ok: true,
              text: String(cdp.text || hit.found.text || loc.value),
              filled: input.op === 'fill' ? true : undefined,
              length: cdp.length == null ? undefined : Number(cdp.length) || 0,
            }, locator)
          }
          last = asResult({
            ...cdp,
            reason: cdp.reason || 'unstable',
            retry: true,
            text: cdp.text || hit.found.text,
          })
          retryRound = true
          continue
        }
        if (!last.retry) {
          if (tried.length > 1 && (last.reason === 'not_found' || last.reason === 'ambiguous')) continue
          return finish(last, locator)
        }
        retryRound = true
      } catch (err) {
        last = { ok: false, reason: 'not_found', retry: true, error: String(err) }
        retryRound = true
      }
    }
    if (!retryRound) return finish(last, locator)
    await waitMs(ACT_POLL_MS)
  }
  if (last.reason && last.reason !== 'unstable' && last.reason !== 'timeout' && !isRetryableReason(last.reason)) {
    return finish(last, locator)
  }
  if (last.reason && last.reason !== 'unstable' && last.reason !== 'not_found' && last.reason !== 'timeout') {
    return finish(last, locator)
  }
  return finish({ ok: false, reason: 'timeout', error: REASON_TEXT.timeout, cover: last.cover, candidates: last.candidates }, locator)
}

export const probeOnBrowser = async (id: string, locator: BrowserLocator): Promise<ActResult> => {
  const value = String(locator.value || '').trim()
  if (!value) return { ok: false, reason: 'invalid', error: '缺少定位条件' }
  try {
    const hit = await locateOnce(id, { ...locator, value })
    return hit.result
  } catch (err) {
    return { ok: false, reason: 'not_found', retry: true, error: String(err) }
  }
}

export const clickByLocator = (id: string, locator: BrowserLocator, timeout?: number) => (
  actOnBrowser(id, { op: 'click', locator, timeout })
)

export const fillByLocator = (id: string, locator: BrowserLocator, text: string, timeout?: number) => (
  actOnBrowser(id, { op: 'fill', locator, text, timeout })
)
