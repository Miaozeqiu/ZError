import { runLoginCommands } from './fixtures/loginCommands'
// @vitest-environment jsdom
import { createApp, h, nextTick } from 'vue'
import { beforeEach, expect, it, vi } from 'vitest'
import AgentLoginForm from '../../src/components/agent/AgentLoginForm.vue'
import { cancelChatLogin, chatLoginRequests, requestChatLogin, submitChatLogin } from '../../src/services/agent/chatLogin'
import { handleLoginTool } from '../../src/services/agent/tools/websiteLogin'

const io = vi.hoisted(() => ({ invoke: vi.fn(), page: vi.fn(), account: vi.fn() }))
vi.mock('../../src/services/agent/tools/websiteLoginObservation', () => ({
  loginObserver: (call: Function, id: string) => (captureCaptcha = false) =>
    call(id, 'login_observe', captureCaptcha ? { captureCaptcha } : undefined),
}))

vi.mock('../../src/services/agent/websiteScripts', () => ({ runWebsiteWorkflow: runLoginCommands }))

vi.mock('@tauri-apps/api/core', async original => ({ ...await original<typeof import('@tauri-apps/api/core')>(), invoke: io.invoke }))
vi.mock('../../src/services/browser/appBrowser', () => ({ getBrowserState: io.page }))
vi.mock('../../src/services/browser/eval', async original => ({ ...await original<typeof import('../../src/services/browser/eval')>(), isCefEngine: async () => true }))
vi.mock('../../src/services/security/secureStore', async original => ({ ...await original<typeof import('../../src/services/security/secureStore')>(), isNativeSecureStore: () => true }))
vi.mock('../../src/services/agent/siteAccounts', () => ({ siteAccountOf: io.account, refreshSiteAccounts: async () => {}, siteAccountsReady: Promise.resolve() }))

const origin = 'https://passport2.chaoxing.com'
const refs = { account: '{{secret:site/chaoxing/account}}', password: '{{secret:site/chaoxing/password}}' }
beforeEach(() => {
  io.page.mockReset().mockResolvedValue({ url: origin + '/login' })
  io.account.mockReset().mockReturnValue(null)
  io.invoke.mockReset()
})
const pending = async () => {
  await vi.waitFor(() => expect(chatLoginRequests.has('chat')).toBe(true))
  return chatLoginRequests.get('chat')!
}

it('continues a login from the chat form and sends only references to the browser tool', async () => {
  const form = { kind: 'form', url: origin + '/login?newversion=true', modern: true, frameId: 'top', loaderId: 'doc' }
  let clicked = false
  const protocol = vi.fn(async (_id: string, op: string, _args?: unknown) => {
    if (op === 'fill_secret') return { ok: true, filled: true }
    return clicked ? { kind: 'space', url: 'https://i.chaoxing.com/' } : form
  })
  const run = handleLoginTool({ name: 'browser_login_chaoxing', args: {}, browserId: 'tab', sessionId: 'chat',
    navigateBrowserView: vi.fn(), callProtocol: protocol, wait: async () => {}, actOnceOnBrowser: async () => { clicked = true; return { dispatched: true } } })
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
    expect(JSON.parse(await run)).toMatchObject({ ok: true, loggedIn: true })
    await nextTick()
    expect(io.invoke).toHaveBeenCalledWith('secure_save_chat_login', { site: 'chaoxing', loginOrigin: origin, account: 'private-account', password: ' private-password! ' })
    expect(protocol.mock.calls.filter(([, op]) => op === 'fill_secret').map(([, , args]) => (args as any).secret_ref)).toEqual(Object.values(refs))
    expect(JSON.stringify([protocol.mock.calls, request, await run])).not.toMatch(/private-account|private-password/)
    expect(chatLoginRequests.size).toBe(0)
  } finally { app.unmount() }
})

it('replaces a rejected ZJOOC password in the same verification flow', async () => {
  const loginOrigin = 'https://background.zjooc.cn'
  const url = loginOrigin + '/gxptLogin'
  const oldForm = { kind: 'form', url, challenge: true, frameId: 'top', loaderId: 'old-doc' }
  const rejected = { ...oldForm, kind: 'rejected', rejection: 'credentials' }
  const newForm = { ...oldForm, loaderId: 'new-doc' }
  const states = [
    oldForm, rejected, rejected,
    { kind: 'other', url: 'about:blank', loaderId: 'transient-doc' },
    rejected, newForm, newForm, newForm, { kind: 'space', url: 'https://www.zjooc.cn/' },
  ]
  const account = '{{secret:site/zjooc/account}}'
  io.account.mockReturnValue({ account, password: '{{secret:site/zjooc/password}}' })
  io.page.mockResolvedValue({ url })
  const protocol = vi.fn(async (_id: string, op: string, _args?: unknown) =>
    op === 'login_observe' ? states.shift()! : { ok: true, filled: true })
  const navigateBrowserView = vi.fn()
  const actOnceOnBrowser = vi.fn()
  const run = handleLoginTool({ name: 'browser_login_zjooc', args: { wait_for_verification: true },
    browserId: 'tab', sessionId: 'chat', navigateBrowserView, callProtocol: protocol,
    wait: async () => {}, actOnceOnBrowser })
  const request = await pending()
  expect(request).toMatchObject({ origin: loginOrigin, replacingRejectedCredentials: true, canReuseAccount: true })
  expect(navigateBrowserView).not.toHaveBeenCalled()
  expect(protocol.mock.calls.every(([, op]) => op === 'login_observe')).toBe(true)
  await submitChatLogin(request, '', 'replacement password ')
  expect(JSON.parse(await run)).toMatchObject({ loggedIn: true })
  expect(io.invoke).toHaveBeenCalledWith('secure_save_chat_login', { site: 'zjooc', loginOrigin, account, password: 'replacement password ' })
  expect(navigateBrowserView).toHaveBeenCalledExactlyOnceWith('tab', url)
  expect(protocol.mock.calls.filter(([, op]) => op === 'fill_secret').map(([, , args]) => args))
    .toEqual(['account', 'password'].map(field => ({
      secret_ref: `{{secret:site/zjooc/${field}}}`,
      locator: expect.objectContaining({ loaderId: 'new-doc' }),
    })))
  expect(actOnceOnBrowser).not.toHaveBeenCalled()
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
