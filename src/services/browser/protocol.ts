import { invoke } from '@tauri-apps/api/core'
import { asObject, evalBrowserView } from './eval'
import { clickByLocator, fillByLocator, probeOnBrowser } from './engine'
import { READ_PAGE_DOM } from './pageDom'

/** 应用内唯一入口。业务代码不要直接 invoke browser_cdp_*。Agent 看不到这一层。 */
export type FrameHint = 'page' | 'homework' | 'catalog' | 'video' | 'any'

export type LocateQuery =
  | { by: 'text'; value: string }
  | { by: 'css'; value: string }
  | { by: 'script'; value: string }

export type Act =
  | { op: 'click'; at: LocateQuery }
  | { op: 'click'; x: number; y: number }
  | { op: 'type'; text: string; at?: LocateQuery }
  | { op: 'press'; key: string }
  | { op: 'scroll'; amount: number }
  | { op: 'hover'; at: LocateQuery }

export type ReadResult = {
  ok: boolean
  url?: string
  title?: string
  html?: string
  json?: unknown
  error?: string
  [key: string]: unknown
}

export type LocateResult = {
  found: boolean
  x?: number
  y?: number
  text?: string
  error?: string
}

export type ActResult = {
  ok: boolean
  error?: string
  filled?: boolean
  text?: string
}

type ReadScript = () => string

const readScripts: Partial<Record<FrameHint, ReadScript>> = {}

export const bindReadScript = (hint: FrameHint, fn: ReadScript) => {
  readScripts[hint] = fn
}

const scriptOf = (hint: FrameHint) => readScripts[hint]?.() || READ_PAGE_DOM()

export const read = async (id: string, hint: FrameHint): Promise<ReadResult> => {
  try {
    const raw = asObject(await evalBrowserView(id, scriptOf(hint)))
    if (raw.ok === false) {
      return { ok: false, error: String(raw.error || '读取失败'), ...raw }
    }
    return { ok: true, ...raw }
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error || '读取失败') }
  }
}

export const locate = async (id: string, query: LocateQuery): Promise<LocateResult> => {
  if (query.by === 'script') {
    try {
      const raw = asObject(await evalBrowserView(id, query.value))
      const found = Boolean(raw.found || (raw.x != null && raw.y != null))
      return {
        found,
        x: raw.x == null ? undefined : Number(raw.x),
        y: raw.y == null ? undefined : Number(raw.y),
        text: raw.text == null ? undefined : String(raw.text),
        error: raw.error == null ? undefined : String(raw.error),
      }
    } catch (error) {
      return { found: false, error: String((error as Error)?.message || error || '定位失败') }
    }
  }
  const hit = await probeOnBrowser(id, { by: query.by, value: query.value })
  return { found: Boolean(hit.ok), text: hit.text, error: hit.error }
}

export const act = async (id: string, action: Act): Promise<ActResult> => {
  try {
    if (action.op === 'click' && 'x' in action && !('at' in action)) {
      const script = `(function(){ return { found: true, x: ${Number(action.x) || 0}, y: ${Number(action.y) || 0}, space: 'page' }; })()`
      const cdp = asObject(await invoke('browser_cdp_click_box', { id, script }))
      return { ok: Boolean(cdp.ok), text: String(cdp.text || ''), error: cdp.error ? String(cdp.error) : undefined }
    }
    if (action.op === 'click' && 'at' in action) {
      if (action.at.by === 'script') {
        const cdp = asObject(await invoke('browser_cdp_click_box', { id, script: action.at.value }))
        return { ok: Boolean(cdp.ok), text: String(cdp.text || ''), error: cdp.error ? String(cdp.error) : undefined }
      }
      const acted = await clickByLocator(id, { by: action.at.by, value: action.at.value })
      return { ok: Boolean(acted.ok), text: acted.text, error: acted.error }
    }
    if (action.op === 'type') {
      if (action.at?.by === 'script') {
        const cdp = asObject(await invoke('browser_cdp_fill_box', { id, script: action.at.value, text: action.text }))
        return {
          ok: Boolean(cdp.ok) && cdp.filled !== false,
          filled: cdp.filled !== false,
          text: String(cdp.text || action.text),
          error: cdp.error ? String(cdp.error) : undefined,
        }
      }
      if (action.at) {
        const acted = await fillByLocator(id, { by: action.at.by, value: action.at.value }, action.text)
        return { ok: Boolean(acted.ok), filled: acted.filled, text: acted.text, error: acted.error }
      }
      return { ok: false, error: 'type 缺少定位' }
    }
    if (action.op === 'press') {
      const cdp = asObject(await invoke('browser_cdp_press', { id, key: action.key }))
      return { ok: Boolean(cdp.ok), text: String(cdp.text || action.key), error: cdp.error ? String(cdp.error) : undefined }
    }
    if (action.op === 'scroll') {
      const cdp = asObject(await invoke('browser_cdp_scroll', { id, amount: action.amount }))
      return { ok: Boolean(cdp.ok), error: cdp.error ? String(cdp.error) : undefined }
    }
    if (action.op === 'hover') {
      const at = action.at
      const cdp = asObject(await invoke('browser_cdp_hover', {
        id,
        text: at.by === 'text' ? at.value : undefined,
        selector: at.by === 'css' ? at.value : undefined,
      }))
      return { ok: Boolean(cdp.ok), text: String(cdp.text || ''), error: cdp.error ? String(cdp.error) : undefined }
    }
    return { ok: false, error: '不支持的动作' }
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error || '操作失败') }
  }
}
