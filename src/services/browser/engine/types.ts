export type BrowserLocatorBy = 'css' | 'text' | 'role' | 'label'

export type BrowserLocator = {
  by: BrowserLocatorBy
  value: string
  name?: string
  exact?: boolean
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
  filled?: boolean
  length?: number
  url?: string
  navigated?: boolean
  hint?: string
}

export type ActOp = 'click' | 'fill' | 'ready'

/** 先轮询 locate，可点后再 CDP 真鼠标。not_found/hidden/covered/unstable 重试；ambiguous/disabled 立刻失败。 */
export const ACT_TIMEOUT_MS = 8000
export const ACT_POLL_MS = 120
