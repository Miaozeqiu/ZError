import { invoke } from '@tauri-apps/api/core'
import { READ_PAGE_DOM } from './pageDom'

const asObject = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

/** Rust `browser_protocol` 唯一 invoke。engine / 业务都走这里。 */
export const callProtocol = async (
  id: string,
  op: string,
  args: Record<string, unknown> = {},
) => asObject(await invoke('browser_protocol', { id: String(id || ''), op, args }))

/** 应用内唯一入口。业务代码不要直接 invoke browser_cdp_*。Agent 看不到这一层。 */
export type FrameHint = string

export type LocateQuery =
  | { by: 'text'; value: string; nth?: number; frame?: string; exact?: boolean }
  | { by: 'css'; value: string; nth?: number; frame?: string; exact?: boolean }

const locatorOf = (at: LocateQuery) => ({
  by: at.by,
  value: at.value,
  nth: at.nth,
  frame: at.frame,
  exact: at.exact,
})

export type Act =
  | { op: 'click'; at: LocateQuery }
  | { op: 'click'; x: number; y: number }
  | { op: 'dblclick'; at: LocateQuery }
  | { op: 'rightclick'; at: LocateQuery }
  | { op: 'type'; text: string; at?: LocateQuery }
  | { op: 'press'; key: string }
  | { op: 'scroll'; amount: number }
  | { op: 'hover'; at: LocateQuery }
  | { op: 'check'; at: LocateQuery }
  | { op: 'uncheck'; at: LocateQuery }
  | { op: 'select'; at: LocateQuery; value: string }

export type CookieInput = {
  name: string
  value: string
  url?: string
  domain?: string
  path?: string
  httpOnly?: boolean
  secure?: boolean
  sameSite?: 'Strict' | 'Lax' | 'None'
}

export const normalizeCookieInput = (raw: unknown): CookieInput | null => {
  const row = asObject(raw)
  const name = String(row.name || '').trim()
  if (!name) return null
  const sameSite = String(row.sameSite || '')
  return {
    name,
    value: String(row.value ?? ''),
    url: row.url ? String(row.url) : undefined,
    domain: row.domain ? String(row.domain) : undefined,
    path: row.path ? String(row.path) : undefined,
    httpOnly: row.httpOnly == null ? undefined : Boolean(row.httpOnly),
    secure: row.secure == null ? undefined : Boolean(row.secure),
    sameSite: sameSite === 'Strict' || sameSite === 'Lax' || sameSite === 'None' ? sameSite : undefined,
  }
}

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
    const { evalBrowserView } = await import('./eval')
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
  const { probeOnBrowser } = await import('./engine')
  const hit = await probeOnBrowser(id, {
    by: query.by,
    value: query.value,
    nth: query.nth,
    frame: query.frame,
    exact: query.exact,
  })
  return { found: Boolean(hit.ok), text: hit.text, error: hit.error }
}

export const act = async (id: string, action: Act): Promise<ActResult> => {
  try {
    const { actOnBrowser, clickByLocator, fillByLocator } = await import('./engine')
    const { controlOnBrowser } = await import('./engine/control')
    if (action.op === 'click' && 'x' in action && !('at' in action)) {
      const cdp = await callProtocol(id, 'click_at', { x: Number(action.x) || 0, y: Number(action.y) || 0 })
      return { ok: Boolean(cdp.ok), text: String(cdp.text || ''), error: cdp.error ? String(cdp.error) : undefined }
    }
    if (action.op === 'click' && 'at' in action) {
      const acted = await clickByLocator(id, locatorOf(action.at))
      return { ok: Boolean(acted.ok), text: acted.text, error: acted.error }
    }
    if (action.op === 'type') {
      if (action.at) {
        const acted = await fillByLocator(id, locatorOf(action.at), action.text)
        return { ok: Boolean(acted.ok), filled: acted.filled, text: acted.text, error: acted.error }
      }
      const cdp = await callProtocol(id, 'type_focused', { text: action.text })
      return {
        ok: Boolean(cdp.ok) && cdp.filled !== false,
        filled: cdp.filled !== false,
        text: String(cdp.text || action.text),
        error: cdp.error ? String(cdp.error) : undefined,
      }
    }
    if (action.op === 'press') {
      const cdp = await callProtocol(id, 'press', { key: action.key })
      return { ok: Boolean(cdp.ok), text: String(cdp.text || action.key), error: cdp.error ? String(cdp.error) : undefined }
    }
    if (action.op === 'scroll') {
      const cdp = await callProtocol(id, 'scroll', { amount: action.amount })
      return { ok: Boolean(cdp.ok), error: cdp.error ? String(cdp.error) : undefined }
    }
    if (action.op === 'hover') {
      const at = action.at
      const cdp = await callProtocol(id, 'hover', {
        text: at.by === 'text' ? at.value : undefined,
        selector: at.by === 'css' ? at.value : undefined,
      })
      return { ok: Boolean(cdp.ok), text: String(cdp.text || ''), error: cdp.error ? String(cdp.error) : undefined }
    }
    if (action.op === 'dblclick' || action.op === 'rightclick') {
      const acted = await actOnBrowser(id, {
        op: action.op,
        locator: locatorOf(action.at),
      })
      return { ok: Boolean(acted.ok), text: acted.text, error: acted.error }
    }
    if (action.op === 'check' || action.op === 'uncheck' || action.op === 'select') {
      const acted = await controlOnBrowser(id, {
        op: action.op,
        locator: locatorOf(action.at),
        value: action.op === 'select' ? action.value : undefined,
      })
      return { ok: Boolean(acted.ok), text: acted.text, error: acted.error }
    }
    return { ok: false, error: '不支持的动作' }
  } catch (error) {
    return { ok: false, error: String((error as Error)?.message || error || '操作失败') }
  }
}

export const wait = async (
  id: string,
  input: {
    url?: string
    text?: string
    selector?: string
    ref?: string
    fn?: string
    response?: string
    frame?: string
    timeout?: number
  },
) => {
  const { waitForBrowser } = await import('./engine')
  return waitForBrowser(id, input)
}

export const waitForFunction = async (
  ...args: Parameters<typeof import('./engine').waitForFunction>
) => {
  const { waitForFunction: run } = await import('./engine')
  return run(...args)
}

export const waitForResponse = async (
  ...args: Parameters<typeof import('./engine').waitForResponse>
) => {
  const { waitForResponse: run } = await import('./engine')
  return run(...args)
}

export const setCookies = async (id: string, list: CookieInput[], url?: string) => {
  const cookies = list.map(normalizeCookieInput).filter((item): item is CookieInput => Boolean(item))
  if (!cookies.length) return { ok: false, saved: 0, error: '没有可写的 cookie' }
  try {
    const raw = await callProtocol(id, 'cookies', { action: 'set', cookies, url: url || null })
    return {
      ok: raw.ok !== false,
      saved: Number(raw.saved) || 0,
      error: raw.error ? String(raw.error) : undefined,
    }
  } catch (error) {
    return { ok: false, saved: 0, error: String((error as Error)?.message || error || '写入 cookie 失败') }
  }
}

export const clearCookies = async (
  id: string,
  filter?: { name?: string; url?: string; domain?: string },
) => {
  try {
    const raw = await callProtocol(id, 'cookies', {
      action: 'clear',
      url: filter?.url || null,
      name: filter?.name || null,
      domain: filter?.domain || null,
    })
    return {
      ok: raw.ok !== false,
      cleared: Number(raw.cleared) || 0,
      error: raw.error ? String(raw.error) : undefined,
    }
  } catch (error) {
    return { ok: false, cleared: 0, error: String((error as Error)?.message || error || '清除 cookie 失败') }
  }
}

export const cookies = async (id: string, url?: string) => {
  try {
    const raw = await callProtocol(id, 'cookies', { action: 'list', url: url || null })
    const list = Array.isArray(raw.cookies)
      ? raw.cookies.map((item) => asObject(item)).filter((item) => item.name)
      : []
    return {
      ok: raw.ok !== false,
      url: String(raw.url || url || ''),
      header: String(raw.header || ''),
      cookies: list,
      error: raw.error ? String(raw.error) : undefined,
    }
  } catch (error) {
    return {
      ok: false,
      url: String(url || ''),
      header: '',
      cookies: [] as Record<string, unknown>[],
      error: String((error as Error)?.message || error || '读取 cookie 失败'),
    }
  }
}

/** 默认只跑顶层。指定 frame 进那一框；all 才扫各帧，给调试用。 */
export const evaluate = async (
  id: string,
  script: string,
  opts?: { frame?: string; all?: boolean },
) => {
  const { evalBrowserFrames, evalBrowserViewInFrame, evalBrowserViewMain } = await import('./eval')
  const frame = String(opts?.frame || '').trim()
  if (opts?.all) return evalBrowserFrames(id, script)
  if (frame) return evalBrowserViewInFrame(id, script, frame)
  return evalBrowserViewMain(id, script)
}
