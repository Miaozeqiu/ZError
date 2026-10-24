/** 用户接管时终止当前回合；交还后仅允许新回合操作；不同对话互不影响。 */
import { reactive } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { invalidatePageSnap } from './engine/pageSnap'
import { rememberPageRefs } from './engine/refs'

export type BrowserControlState = { sessionId: string; owner: 'agent' | 'user'; epoch: number; revision: number }
export const browserControlState = reactive<Record<string, BrowserControlState>>({})
export const controlForSession = (sessionId: string) => browserControlState[sessionId]
export const browserControlRevision = (sessionId: string) => controlForSession(sessionId)?.revision || 0
export const userControlsBrowser = (sessionId: string) => controlForSession(sessionId)?.owner === 'user'
type NativeControl = Omit<BrowserControlState, 'revision'>
const registered = new Map<string, Set<string>>()
const resuming = new Set<string>()
const controlRequests = new Map<string, symbol>()
const messageClaims = new Map<string, symbol>()
const operationEpoch = new Map<string, number>()
export const browserAutomationEpoch = (id: string) => operationEpoch.get(id)
export const browserAutomationArgs = (id: string) => {
  const expectedEpoch = browserAutomationEpoch(id)
  return expectedEpoch == null ? {} : { expectedEpoch }
}
export const withBrowserAutomation = async <T>(id: string, epoch: number, job: () => Promise<T>) => {
  const previous = operationEpoch.get(id)
  operationEpoch.set(id, epoch)
  try { return await job() } finally {
    if (previous == null) operationEpoch.delete(id); else operationEpoch.set(id, previous)
  }
}
const invalidate = (sessionId: string) => {
  for (const id of registered.get(sessionId) || []) { invalidatePageSnap(id); rememberPageRefs(id, []) }
}

export const applyBrowserControl = (next: NativeControl | undefined) => {
  if (!next?.sessionId || (next.owner !== 'agent' && next.owner !== 'user')) return
  if (next.owner === 'agent' && resuming.has(next.sessionId)) return
  const prev = controlForSession(next.sessionId)
  if (prev && (next.epoch < prev.epoch || (next.epoch === prev.epoch && prev.owner === 'user' && next.owner === 'agent'))) return
  if (prev?.epoch === next.epoch && prev.owner === next.owner) return
  browserControlState[next.sessionId] = { ...next, revision: prev ? prev.revision + 1 : next.owner === 'user' ? 1 : 0 }
  if (next.owner === 'user') invalidate(next.sessionId)
}

export const registerBrowserControl = async (id: string, sessionId: string) => {
  const tabs = registered.get(sessionId) || new Set<string>()
  tabs.add(id); registered.set(sessionId, tabs)
  applyBrowserControl(await invoke<NativeControl>('browser_control_register', { id, sessionId }))
}
export const setBrowserControl = async (id: string, sessionId: string, owner: 'agent' | 'user') => {
  const request = Symbol()
  controlRequests.set(sessionId, request)
  let handoffEpoch: number | undefined
  if (owner === 'user' && !userControlsBrowser(sessionId)) {
    // 工具入口先暂停，不能等 IPC 往返结束才阻止排队中的操作。
    const prev = controlForSession(sessionId)
    browserControlState[sessionId] = { sessionId, owner, epoch: prev?.epoch || 0, revision: (prev?.revision || 0) + 1 }
    invalidate(sessionId)
  }
  if (owner === 'agent') resuming.add(sessionId)
  try {
    const state = await invoke<NativeControl>('browser_control_set', { id, owner })
    if (!state) throw new Error('浏览器操作权切换失败，请重启应用后重试')
    handoffEpoch = state.epoch
    if (owner === 'agent') {
      invalidate(sessionId)
      const { readBrowserPage } = await import('./appBrowser')
      const page = await readBrowserPage(id, { controlEpoch: state.epoch })
      if ('error' in page && page.error) throw new Error(String(page.error))
    }
    resuming.delete(sessionId)
    applyBrowserControl(state)
    return state
  } catch (error) {
    resuming.delete(sessionId)
    if (owner === 'agent' && controlRequests.get(sessionId) === request
      && (handoffEpoch == null || (controlForSession(sessionId)?.epoch || 0) <= handoffEpoch)) {
      const state = await invoke<NativeControl>('browser_control_set', { id, owner: 'user' }).catch(() => undefined)
      applyBrowserControl(state)
    }
    throw error
  }
}
export const listenBrowserControl = () => listen<NativeControl>('app-browser-control', event => applyBrowserControl(event.payload))

/** 只有用户主动发起新回合才交还当前对话的浏览器；不复活已取消的回合。 */
export const claimBrowserForNewMessage = async (input: {
  sessionId: string; browserId?: string; kind?: 'watch'; signal: AbortSignal
}) => {
  if (input.signal.aborted) throw new DOMException('已停止', 'AbortError')
  if (input.kind === 'watch' || !input.browserId) return false
  const request = Symbol()
  messageClaims.set(input.sessionId, request)
  if (!userControlsBrowser(input.sessionId)) return false
  let claimed: NativeControl
  try { claimed = await setBrowserControl(input.browserId, input.sessionId, 'agent') }
  catch (error) {
    if (input.signal.aborted || String(error).includes('BROWSER_USER_CONTROL')) throw new DOMException('用户已终止或重新接管浏览器', 'AbortError')
    throw error
  }
  if (input.signal.aborted) {
    if (messageClaims.get(input.sessionId) === request && !userControlsBrowser(input.sessionId)
      && controlForSession(input.sessionId)?.epoch === claimed.epoch) {
      await setBrowserControl(input.browserId, input.sessionId, 'user')
    }
    throw new DOMException('已停止', 'AbortError')
  }
  if (userControlsBrowser(input.sessionId)) throw new DOMException('用户已重新接管浏览器', 'AbortError')
  return true
}
