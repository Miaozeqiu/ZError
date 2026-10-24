export type BrowserLocatorBy = 'css' | 'text' | 'role' | 'label'

export type BrowserLocator = {
  by: BrowserLocatorBy
  value: string
  name?: string
  exact?: boolean
  /** 1-based。指定后不再因多个匹配报 ambiguous。 */
  nth?: number
  /** iframe 的 id / name / mid（全等），或 src、location 子串。 */
  frame?: string
  /** 快照时的 iframe 序号链，如 0/2/1。先按它找，对不上再退回 frame。 */
  frameId?: string
  loaderId?: string
  framePath?: string
  /** 快照上的角色。填写时只接受输入框，防止把章节按钮当账号框。 */
  role?: string
  /** 这一颗节点。有它时直接点它，不再按名字重新找。 */
  backend?: number
}

export const normalizeLocator = (locator: BrowserLocator): BrowserLocator => {
  const nth = Math.floor(Number(locator.nth) || 0)
  const frame = String(locator.frame || '').trim()
  const framePath = String(locator.framePath || '').trim()
  const name = String(locator.name || '').trim()
  return {
    by: locator.by,
    value: String(locator.value || '').trim(),
    name: name || undefined,
    exact: locator.exact ? true : undefined,
    nth: nth > 0 ? nth : undefined,
    frame: frame || undefined,
    framePath: framePath || undefined,
    frameId: locator.frameId || undefined,
    loaderId: locator.loaderId || undefined,
    role: String(locator.role || '').trim() || undefined,
    backend: Number(locator.backend) > 0 ? Number(locator.backend) : undefined,
  }
}

export const locatorScriptArg = (locator: BrowserLocator) => {
  const next = normalizeLocator(locator)
  return {
    by: next.by,
    value: next.value,
    name: next.name || '',
    exact: Boolean(next.exact),
    nth: next.nth || 0,
    frame: next.frame || '',
    framePath: next.framePath || '',
    ...(next.frameId ? { frameId: next.frameId } : {}),
    ...(next.loaderId ? { loaderId: next.loaderId } : {}),
    ...(next.backend ? { backend: next.backend } : {}),
  }
}

export type ActReason =
  | 'not_found'
  | 'hidden'
  | 'covered'
  | 'disabled'
  | 'readonly'
  | 'unstable'
  | 'ambiguous'
  | 'timeout'
  | 'invalid'

export type ActCandidate = {
  text: string
  reason?: ActReason
}

export type ActResult = {
  ok: boolean
  error?: string
  reason?: ActReason
  text?: string
  cover?: string
  candidates?: ActCandidate[]
  retry?: boolean
  box?: string
  password?: boolean
  filled?: boolean
  length?: number
  url?: string
  navigated?: boolean
  domChanged?: boolean
  focusChanged?: boolean
  hint?: string
  title?: string
  snapshot?: string
  frameId?: string
  loaderId?: string
  snapshotStale?: boolean
  snapshotError?: string
  snapshotTruncated?: boolean
}

export type ActOp = 'click' | 'fill' | 'ready' | 'dblclick' | 'rightclick'

/** 先轮询 locate，可点后再 CDP 真鼠标。not_found/hidden/covered/unstable 重试；ambiguous/disabled 立刻失败。 */
export const ACT_TIMEOUT_MS = 8000
/** 第一遍就 not_found 时只再等这么久（表单可能刚挂上），不要空等满 8 秒。 */
export const ACT_MISS_TIMEOUT_MS = 1500
export const ACT_POLL_MS = 120
