import { invoke } from '@tauri-apps/api/core'
import { shallowReactive } from 'vue'
import { getBrowserState } from '../browser/appBrowser'
import { browserDocuments, sameBrowserDocument, type BrowserDocument } from '../browser/documents'
import { browserCapabilities } from '../browser/capabilities'
import { isNativeSecureStore } from '../security/secureStore'
import { refreshSiteAccounts, siteAccountOf, siteAccountsReady } from './siteAccounts'
import { loadWebsiteIdentities, websiteAccountId, websiteIdentityForHost } from './websiteIdentity'

export type ChatLoginRequest = {
  id: string; sessionId: string; site: string; name: string; origin: string; browserId: string
  replacingRejectedCredentials?: boolean
  canReuseAccount?: boolean
  targetDocument?: { host: string; document: BrowserDocument }
}
type Receipt = { ok: true; references: { account: string; password: string } } | { ok: false; error: string; denied?: boolean }
export const chatLoginRequests = shallowReactive(new Map<string, ChatLoginRequest>())
export const pendingWebsiteVerification = shallowReactive(new Set<string>())
const waiters = new Map<string, (receipt: Receipt) => void>()
const submitting = new Set<string>()
const failed = (error: string): Receipt => ({ ok: false, error })
const saved = (site: string): Extract<Receipt, { ok: true }> | undefined => {
  const row = siteAccountOf(site)
  if (row?.account === `{{secret:site/${site}/account}}` && row.password === `{{secret:site/${site}/password}}`) {
    return { ok: true, references: { account: row.account, password: row.password } }
  }
}
const pageOrigin = async (browserId: string, target?: ChatLoginRequest['targetDocument']) => {
  const page = target ? (await browserDocuments(browserId, target.host)).documents.find(row => sameBrowserDocument(row, target.document))
    : await getBrowserState(browserId).catch(() => null)
  if (!page || !URL.canParse(page.url)) return ''
  const url = new URL(page.url)
  return url.protocol === 'https:' && !url.username && !url.password ? url.origin : ''
}

export async function requestChatLogin(
  sessionId: string,
  browserId: string,
  signal?: AbortSignal,
  { expectedOrigin, replacingRejectedCredentials = false, targetDocument }: { expectedOrigin?: string; replacingRejectedCredentials?: boolean; targetDocument?: ChatLoginRequest['targetDocument'] } = {},
): Promise<Receipt> {
  if (!isNativeSecureStore()) return failed('当前浏览器不支持安全填写，请在网站登录页手动登录。')
  const capabilities = await browserCapabilities()
  if (!capabilities.secureFill) return failed('当前浏览器不支持安全填写，请在网站登录页手动登录。')
  if (targetDocument && !capabilities.secureFillInFrames) {
    const pages = await browserDocuments(browserId, targetDocument.host)
    if (pages.documents[0].frameId !== targetDocument.document.frameId) return failed('当前浏览器暂不支持在子页面安全填写凭据，请直接打开登录页。')
  }
  await Promise.all([loadWebsiteIdentities(), siteAccountsReady])
  const origin = await pageOrigin(browserId, targetDocument)
  const identity = websiteIdentityForHost(origin)
  if (!identity || !origin || (expectedOrigin && origin !== expectedOrigin)) return failed('请先打开目标网站的 HTTPS 登录页。')
  const site = websiteAccountId(origin)
  signal?.throwIfAborted()
  const existing = saved(site)
  if (existing && !replacingRejectedCredentials) return existing
  if (chatLoginRequests.has(sessionId)) return failed('当前对话已有登录表单，请等待用户填写。')
  const request = {
    id: crypto.randomUUID(), sessionId, browserId, origin, site, name: identity.name,
    replacingRejectedCredentials, canReuseAccount: replacingRejectedCredentials && Boolean(existing),
    ...(targetDocument ? { targetDocument } : {}),
  }
  return new Promise<Receipt>((resolve, reject) => {
    const clear = () => {
      signal?.removeEventListener('abort', abort)
      waiters.delete(request.id)
      chatLoginRequests.delete(sessionId)
    }
    const abort = () => { clear(); reject(new DOMException('已停止', 'AbortError')) }
    waiters.set(request.id, receipt => { clear(); resolve(receipt) })
    signal?.addEventListener('abort', abort, { once: true })
    chatLoginRequests.set(sessionId, request)
  })
}

export function cancelChatLogin(id: string) {
  waiters.get(id)?.({ ok: false, denied: true, error: '用户已取消填写账号密码。' })
}

// Called only by the local chat form. The waiter receives references, never the form values.
export async function submitChatLogin(request: ChatLoginRequest, account: string, password: string) {
  const { id, origin, site } = request
  if (!password || !waiters.has(id) || submitting.has(id)) return
  submitting.add(id)
  try {
    if (await pageOrigin(request.browserId, request.targetDocument) !== origin) {
      waiters.get(id)?.(failed('登录页面已切换，请在目标登录页重新请求。'))
      return
    }
    if (!waiters.has(id)) return
    const accountValue = account.trim() ? account : request.canReuseAccount ? saved(site)?.references.account : undefined
    if (!accountValue) throw new Error('请输入网站账号')
    await invoke('secure_save_chat_login', { site, loginOrigin: origin, account: accountValue, password })
    await refreshSiteAccounts()
    const receipt = saved(site)
    if (!receipt) throw new Error('安全存储未返回本站凭据引用')
    waiters.get(id)?.(receipt)
  } finally { submitting.delete(id) }
}
