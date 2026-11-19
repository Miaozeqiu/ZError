import { runLoginCommands } from './fixtures/loginCommands'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { loginChaoxing } from '../../src/services/agent/tools/websiteLogin'
import { assembleRoleTools } from '../../src/services/agent/subagent/tools'

const { accountOf } = vi.hoisted(() => ({ accountOf: vi.fn() }))
vi.mock('../../src/services/agent/tools/websiteLoginObservation', () => ({
  loginObserver: (call: Function, id: string) => (captureCaptcha = false) =>
    call(id, 'login_observe', captureCaptcha ? { captureCaptcha } : undefined),
}))

vi.mock('../../src/services/agent/websiteScripts', () => ({ runWebsiteWorkflow: runLoginCommands }))

vi.mock('../../src/services/agent/websiteRepository', async original => ({
  ...await original<typeof import('../../src/services/agent/websiteRepository')>(),
  websiteToolsForHost: (host: string) => host === 'chaoxing.com'
    ? [{ type: 'function', function: { name: 'browser_login_chaoxing' } }]
    : host === 'zjooc.cn' ? ['browser_login_zjooc', 'browser_play_zjooc'].map(name => ({ type: 'function', function: { name } })) : [],
}))
vi.mock('../../src/services/agent/siteAccounts', () => ({
  siteAccountOf: accountOf, siteAccountsReady: Promise.resolve(),
}))

const credentials = {
  account: '{{secret:site/chaoxing/account}}',
  password: '{{secret:site/chaoxing/password}}',
}
const CHAOXING_LOGIN_URL = 'https://passport2.chaoxing.com/login?fid=&newversion=true&refer=https%3A%2F%2Fi.chaoxing.com'
const form = { kind: 'form', url: CHAOXING_LOGIN_URL, frameId: 'top', loaderId: 'login-doc', modern: true }
const space = { kind: 'space', url: 'https://i.mooc.chaoxing.com/space/index' }
const challenge = { ...form, kind: 'challenge' }

const context = (...observations: Record<string, unknown>[]) => {
  let index = 0
  const callProtocol = vi.fn(async (_id: string, op: string, _args?: Record<string, unknown>) =>
    op === 'login_observe' ? observations[Math.min(index++, observations.length - 1)]! : { ok: true, filled: true, dispatched: true })
  return {
    browserId: 'tab', args: {}, callProtocol, navigateBrowserView: vi.fn(async () => undefined),
    actOnceOnBrowser: vi.fn(async () => ({ dispatched: true })), wait: async () => undefined,
  }
}
const fills = (ctx: ReturnType<typeof context>) => ctx.callProtocol.mock.calls.filter(([, op]) => op === 'fill_secret')

describe('learning platform login tool', () => {
  beforeEach(() => accountOf.mockReset().mockReturnValue(credentials))

  it('is listed for an empty browser for the parent Agent and is absent from read-only exploration', () => {
    const names = (role: 'parent' | 'explore') => assembleRoleTools({ url: 'about:blank', role, startupHost: 'chaoxing.com' }).map(tool => tool.function.name)
    expect(names('parent')).toContain('browser_login_chaoxing')
    expect(names('explore')).not.toContain('browser_login_chaoxing')
  })

  it('preserves an existing login without accessing or filling credentials', async () => {
    const ctx = context(space)
    expect(JSON.parse(await loginChaoxing(ctx))).toMatchObject({ loggedIn: true, alreadyLoggedIn: true, url: space.url })
    expect(accountOf).not.toHaveBeenCalled()
    expect(fills(ctx)).toEqual([])
    expect(ctx.navigateBrowserView).not.toHaveBeenCalled()
  })

  it('opens the new login page, fills opaque references in the pinned document and confirms the redirect', async () => {
    const ctx = context({ kind: 'other', url: 'about:blank' },
      { ...form, modern: false, url: 'https://passport2.chaoxing.com/login' }, form, form, space)
    expect(JSON.parse(await loginChaoxing(ctx))).toMatchObject({ ok: true, loggedIn: true, alreadyLoggedIn: false, url: space.url })
    expect(ctx.navigateBrowserView.mock.calls).toEqual([['tab', 'https://i.chaoxing.com/'], ['tab', CHAOXING_LOGIN_URL]])
    expect(fills(ctx)).toEqual([
      ['tab', 'fill_secret', { locator: { by: 'css', value: 'input#phone', frameId: 'top', loaderId: 'login-doc' }, secret_ref: credentials.account }],
      ['tab', 'fill_secret', { locator: { by: 'css', value: 'input#pwd[type="password"]', frameId: 'top', loaderId: 'login-doc' }, secret_ref: credentials.password }],
    ])
    expect(ctx.actOnceOnBrowser).toHaveBeenCalledExactlyOnceWith('tab', { by: 'css', value: '#loginBtn', frameId: 'top', loaderId: 'login-doc' }, 'click')
  })

  it('submits through the WebView2 login action when the native probe supports it', async () => {
    const nativeForm = { ...form, supportsLoginAction: true }
    const ctx = context(nativeForm, nativeForm, space)
    expect(JSON.parse(await loginChaoxing(ctx))).toMatchObject({ ok: true, loggedIn: true })
    expect(ctx.callProtocol).toHaveBeenCalledWith('tab', 'login_action', {
      action: 'click', site: 'chaoxing', url: form.url, selector: '#loginBtn', locator: { by: 'css', value: '#loginBtn', frameId: 'top', loaderId: 'login-doc' },
    })
    expect(ctx.actOnceOnBrowser).not.toHaveBeenCalled()
  })

  it('leaves verification to the user before or after a single login attempt', async () => {
    const existing = context(challenge)
    expect(JSON.parse(await loginChaoxing(existing))).toMatchObject({ ok: false, userActionRequired: true })
    expect(fills(existing)).toEqual([])
    expect(existing.actOnceOnBrowser).not.toHaveBeenCalled()

    const triggered = context(form, form, challenge)
    expect(JSON.parse(await loginChaoxing(triggered))).toMatchObject({ ok: false, userActionRequired: true })
    expect(triggered.actOnceOnBrowser).toHaveBeenCalledTimes(1)
  })

  it('does not fill a missing credential, or submit into a changed document', async () => {
    accountOf.mockReturnValueOnce({ account: credentials.account })
    const missing = context(form)
    expect(JSON.parse(await loginChaoxing(missing))).toMatchObject({ ok: false, credentialsRequired: true })
    expect(fills(missing)).toEqual([])

    const stale = context(form, { ...form, loaderId: 'new-document' })
    expect(JSON.parse(await loginChaoxing(stale))).toMatchObject({ ok: false, reason: 'stale' })
    expect(stale.actOnceOnBrowser).not.toHaveBeenCalled()
  })

  it('does not resubmit rejected credentials or claim success from an unverified page', async () => {
    const rejected = context(form, form, { ...form, rejected: true })
    expect(JSON.parse(await loginChaoxing(rejected))).toMatchObject({ ok: false, loginRejected: true })
    expect(rejected.actOnceOnBrowser).toHaveBeenCalledTimes(1)

    const uncertain = context(form, form, { kind: 'other', url: 'https://example.test/' })
    expect(JSON.parse(await loginChaoxing(uncertain))).toMatchObject({ ok: false, clickDispatched: true })
    expect(uncertain.actOnceOnBrowser).toHaveBeenCalledTimes(1)
  })
})
