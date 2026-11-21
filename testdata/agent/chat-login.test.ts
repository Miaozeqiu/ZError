// @vitest-environment jsdom
import { createApp, h, nextTick } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import AgentLoginForm from '../../src/components/agent/AgentLoginForm.vue'
import { cancelChatLogin, chatLoginRequests, requestChatLogin, submitChatLogin } from '../../src/services/agent/chatLogin'
import { scopedWebsiteHost } from '../../src/services/agent/websiteRuntime/scopedHost'

const io = vi.hoisted(() => ({ invoke: vi.fn(), page: vi.fn(), account: vi.fn(), capabilities: vi.fn(), documents: vi.fn() }))
vi.mock('../../src/services/browser/documents', async original => ({
  ...await original<typeof import('../../src/services/browser/documents')>(), browserDocuments: io.documents,
}))
vi.mock('@tauri-apps/api/core', async original => ({ ...await original<typeof import('@tauri-apps/api/core')>(), invoke: io.invoke }))
vi.mock('../../src/services/browser/appBrowser', () => ({ getBrowserState: io.page }))
vi.mock('../../src/services/browser/capabilities', () => ({ browserCapabilities: io.capabilities }))
vi.mock('../../src/services/security/secureStore', async original => ({ ...await original<typeof import('../../src/services/security/secureStore')>(), isNativeSecureStore: () => true }))
vi.mock('../../src/services/agent/siteAccounts', () => ({ siteAccountOf: io.account, refreshSiteAccounts: async () => {}, siteAccountsReady: Promise.resolve() }))

const origin = 'https://passport2.chaoxing.com'
const refs = { account: '{{secret:site/chaoxing/account}}', password: '{{secret:site/chaoxing/password}}' }
beforeEach(() => {
  io.page.mockReset().mockResolvedValue({ url: origin + '/login' })
  io.account.mockReset().mockReturnValue(null)
  io.invoke.mockReset()
  io.capabilities.mockReset().mockResolvedValue({ secureFill: true })
})
const pending = async () => {
  await vi.waitFor(() => expect(chatLoginRequests.has('chat')).toBe(true))
  return chatLoginRequests.get('chat')!
}

it('continues a login from the chat form and sends only references to the browser tool', async () => {
  const target = { frameId: 'top', loaderId: 'doc', url: origin + '/login' }
  io.documents.mockResolvedValue({ documents: [target] })
  const protocol = vi.fn(async (_name: string, _args: Record<string,unknown>) => ({ ok: true, filled: true }))
  const scoped = scopedWebsiteHost({ host: 'chaoxing.com', browserId: 'tab', signal: new AbortController().signal,
    pause: () => {}, resume: () => {}, ctx: { sessionId:'chat', invokeHostTool: protocol } as any })
  const run = (async () => {
    const grant = await scoped.execute('credentials.request', { document: target })
    for (const field of ['account','password']) await scoped.execute('credentials.fill', { document: target, selector: '#' + field, credential_id: grant.credential_id, field })
    return { ok: true }
  })()
  const request = await pending()
  const root = document.createElement('div')
  const app = createApp({ render: () => h(AgentLoginForm, { request }) })
  app.mount(root)
  try {
    const [account, password] = root.querySelectorAll('input')
    account.value = 'private-account'
    password.value = ' private-password! '
    expect(password.type).toBe('password')
    expect(root.textContent).toContain(origin)
    io.invoke.mockImplementation(async command => {
      if (command === 'secure_save_chat_login') io.account.mockReturnValue(refs)
    })
    root.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }))
    expect(await run).toEqual({ ok: true })
    await nextTick()
    expect(io.invoke).toHaveBeenCalledWith('secure_save_chat_login', { site: 'chaoxing', loginOrigin: origin, account: 'private-account', password: ' private-password! ' })
    expect(protocol.mock.calls.filter(([, args]) => args.action === 'fill_secret').map(([, args]) => args.secret_ref)).toEqual(Object.values(refs))
    expect(JSON.stringify([protocol.mock.calls, request, await run])).not.toMatch(/private-account|private-password/)
    expect(chatLoginRequests.size).toBe(0)
  } finally { app.unmount(); scoped.dispose() }
})

it('replaces a rejected password using the generic credential form without exposing values', async () => {
  io.account.mockReturnValue(refs)
  const receipt = requestChatLogin('chat', 'tab', undefined, { expectedOrigin: origin, replacingRejectedCredentials: true })
  const request = await pending()
  expect(request).toMatchObject({ origin, replacingRejectedCredentials: true, canReuseAccount: true })
  await submitChatLogin(request, '', 'replacement password ')
  expect(await receipt).toEqual({ ok: true, references: refs })
  expect(io.invoke).toHaveBeenCalledWith('secure_save_chat_login', { site: 'chaoxing', loginOrigin: origin, account: refs.account, password: 'replacement password ' })
  expect(JSON.stringify([request, await receipt])).not.toContain('replacement password')
  expect(chatLoginRequests.size).toBe(0)
})

it('reuses existing references and keeps cancellation, navigation and abort out of the vault', async () => {
  io.account.mockReturnValue(refs)
  expect(await requestChatLogin('chat', 'tab')).toEqual({ ok: true, references: refs })
  io.account.mockReturnValue(null)
  const first = requestChatLogin('chat', 'tab')
  cancelChatLogin((await pending()).id)
  expect(await first).toMatchObject({ ok: false, denied: true })
  const second = requestChatLogin('chat', 'tab')
  const request = await pending()
  io.page.mockResolvedValue({ url: 'https://another.example/login' })
  await submitChatLogin(request, 'private-account', 'private-password')
  expect(await second).toMatchObject({ ok: false })
  const abort = new AbortController()
  const third = requestChatLogin('chat', 'tab', abort.signal)
  const stale = await pending()
  abort.abort()
  await expect(third).rejects.toMatchObject({ name: 'AbortError' })
  await submitChatLogin(stale, 'private-account', 'private-password')
  expect(io.invoke.mock.calls.some(([command]) => command === 'secure_save_chat_login')).toBe(false)
  expect(chatLoginRequests.size).toBe(0)
})

it('allows the native WebView credential form and rejects hosts without secure fill', async () => {
  const receipt = requestChatLogin('chat', 'tab')
  cancelChatLogin((await pending()).id)
  expect(await receipt).toMatchObject({ denied: true })
  io.capabilities.mockResolvedValue({ secureFill: false })
  expect(await requestChatLogin('chat', 'tab')).toMatchObject({ ok: false, error: expect.stringContaining('不支持安全填写') })
  expect(chatLoginRequests.size).toBe(0)
  expect(io.invoke).not.toHaveBeenCalled()
})

it('安全表单绑定目标文档，相同网址刷新后也不能保存或填写旧表单', async () => {
  const document = { frameId: 'form', loaderId: 'one', url: origin + '/login' }
  io.capabilities.mockResolvedValue({ secureFill: true, secureFillInFrames: true })
  io.documents.mockResolvedValue({ documents: [document] })
  const receipt = requestChatLogin('chat', 'tab', undefined, { expectedOrigin: origin, targetDocument: { host: 'chaoxing.com', document } })
  const form = await pending()
  io.documents.mockResolvedValue({ documents: [{ ...document, loaderId: 'new-document' }] })
  await submitChatLogin(form, 'private-account', 'private-password')
  expect(await receipt).toMatchObject({ ok: false, error: expect.stringContaining('登录页面已切换') })
  expect(io.invoke.mock.calls.some(([name]) => name === 'secure_save_chat_login')).toBe(false)
})

it('不支持子页面安全填写的引擎不会先要求用户输入凭据', async () => {
  const root = { frameId: 'root', loaderId: 'one', url: origin + '/login' }
  const child = { ...root, frameId: 'child', loaderId: 'two' }
  io.capabilities.mockResolvedValue({ secureFill: true, secureFillInFrames: false })
  io.documents.mockResolvedValue({ documents: [root, child] })
  expect(await requestChatLogin('chat', 'tab', undefined, { targetDocument: { host: 'chaoxing.com', document: child } })).toMatchObject({ ok: false, error: expect.stringContaining('子页面') })
  expect(chatLoginRequests.size).toBe(0)
})
