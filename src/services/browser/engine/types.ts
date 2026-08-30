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
}

export type ActOp = 'click' | 'fill' | 'ready'

export const ACT_TIMEOUT_MS = 8000
export const ACT_POLL_MS = 120
