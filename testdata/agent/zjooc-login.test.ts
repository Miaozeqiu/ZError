import { describe, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { readFileSync } from 'node:fs'
import { pendingWebsiteVerification } from '../../src/services/agent/chatLogin'
import { loginZjooc } from '../../src/services/agent/tools/zjoocLogin'
import { chaoxingStartup } from '../../src/services/agent/chaoxingStartup'
import { assembleRoleTools } from '../../src/services/agent/subagent/tools'

const { siteAccountOf } = vi.hoisted(() => ({ siteAccountOf: vi.fn() }))
vi.mock('../../src/services/agent/siteAccounts', () => ({ siteAccountsReady: Promise.resolve(), siteAccountOf }))
const url = 'https://background.zjooc.cn/gxptLogin'
const form = { kind: 'form', url, challenge: true, frameId: 'main', loaderId: 'doc' }
const account = { account: '{{secret:site/zjooc/account}}', password: '{{secret:site/zjooc/password}}' }
const context = (...states: Record<string, unknown>[]) => {
  let step = 0
  return {
    args: {}, browserId: 'tab', wait: async () => {}, navigateBrowserView: vi.fn(async () => {}),
    actOnceOnBrowser: vi.fn(async () => ({ dispatched: true, ok: true, filled: true })),
    callProtocol: vi.fn(async (_id: string, op: string, _args?: Record<string, unknown>) => op === 'zjooc_login_state'
      ? states[Math.min(step++, states.length - 1)] : { ok: true, filled: true }),
  }
}

describe('在浙学登录', () => {
  it('routes an explicit login from an empty tab, including tool discovery and role restrictions', () => {
    expect(chaoxingStartup('帮我登录下在浙学', 'about:blank')).toEqual({ name: 'browser_login_zjooc', args: {} })
    for (const role of ['parent', 'execute', 'explore'] as const) {
      const offered = assembleRoleTools({ role }).some(t => t.function.name === 'browser_login_zjooc')
      expect(offered).toBe(role !== 'explore')
    }
  })
  it('hands off the same challenge after secure fills without submitting', async () => {
    siteAccountOf.mockReturnValue(account)
    const captchaImage = 'data:image/png;base64,example-image'
    const ctx = context({ kind: 'other' }, { kind: 'guest', url: 'https://www.zjooc.cn/', frameId: 'main', loaderId: 'home' }, form, { ...form, captchaImage })
    expect(JSON.parse(await loginZjooc(ctx))).toMatchObject({ userActionRequired: true, challenge: 'image_captcha', captchaImage })
    expect(ctx.callProtocol).toHaveBeenLastCalledWith('tab', 'zjooc_login_state', { captureCaptcha: true })
    expect(ctx.navigateBrowserView).toHaveBeenCalledTimes(1)
    expect(ctx.callProtocol.mock.calls.filter(([,op]) => op === 'fill_secret').map(([, , args]) => args))
      .toEqual(Object.values(account).map(reference => ({ secret_ref: reference, locator: expect.objectContaining({ frameId: 'main', loaderId: 'doc' }) })))
    expect(ctx.actOnceOnBrowser).toHaveBeenCalledExactlyOnceWith('tab', { by: 'text', exact: true, value: '请登录', frameId: 'main', loaderId: 'home' }, 'click')
  })
  it('waits in the current chat and confirms login without filling credentials again', async () => {
    const ctx = context(form, { ...form, kind: 'rejected' }, { kind: 'space', url: 'https://www.zjooc.cn/' })
    const sessionId = 'zjooc-verification'
    const result = await loginZjooc({
      ...ctx, sessionId, args: { wait_for_verification: true },
      wait: async ms => { if (ms === 2000) expect(pendingWebsiteVerification.has(sessionId)).toBe(true) },
    })
    expect(JSON.parse(result)).toMatchObject({ ok: true, loggedIn: true })
    expect(ctx.callProtocol.mock.calls.every(([, op]) => op === 'zjooc_login_state')).toBe(true)
    expect(ctx.actOnceOnBrowser).not.toHaveBeenCalled()
    expect(pendingWebsiteVerification.has(sessionId)).toBe(false)
  })
  it('fills the recognized captcha and submits once with the saved credentials', async () => {
    siteAccountOf.mockReturnValue(account)
    const captured = { ...form, captchaImage: 'data:image/png;base64,captured-image' }
    const signal = new AbortController().signal
    const initial = JSON.parse(await loginZjooc({ ...context(form, captured), signal }))
    expect(initial).toMatchObject({ ok: true, loggedIn: false, challenge: 'image_captcha' })
    const { captcha_id } = initial
    expect(captcha_id).toEqual(expect.any(String))
    const ctx = context(captured, captured, { kind: 'space', url: 'https://www.zjooc.cn/' })
    const args = { captcha_id, captcha_code: 'Ab123' }
    expect(JSON.parse(await loginZjooc({ ...ctx, signal, args }))).toMatchObject({ loggedIn: true })
    const identity = { by: 'css', frameId: 'main', loaderId: 'doc' }
    expect(ctx.actOnceOnBrowser.mock.calls).toEqual([
      ['tab', { ...identity, value: '.login_box .forms.code input[name=captchaCode]' }, 'fill', 'Ab123'],
      ['tab', { ...identity, value: '.login_box button.dologin' }, 'click'],
    ])
    const replay = context(captured)
    expect(JSON.parse(await loginZjooc({ ...replay, signal, args }))).toMatchObject({ reason: 'stale' })
    expect(replay.actOnceOnBrowser).not.toHaveBeenCalled()
  })

  it('leaves a changed captcha untouched', async () => {
    siteAccountOf.mockReturnValue(account)
    const signal = new AbortController().signal
    const { captcha_id } = JSON.parse(await loginZjooc({
      ...context(form, { ...form, captchaImage: 'data:image/png;base64,first-image' }), signal,
    }))
    const ctx = context({ ...form, captchaImage: 'data:image/png;base64,changed-image' })
    const result = await loginZjooc({ ...ctx, signal, args: { captcha_id, captcha_code: 'Ab123' } })
    expect(JSON.parse(result)).toMatchObject({ reason: 'stale' })
    expect(ctx.actOnceOnBrowser).not.toHaveBeenCalled()
  })

  it('preserves an authenticated page and rejects unrelated form URLs or changed documents', async () => {
    siteAccountOf.mockClear().mockReturnValue(account)
    const logged = context({ kind: 'space', url: 'https://www.zjooc.cn/' })
    expect(JSON.parse(await loginZjooc(logged))).toMatchObject({ loggedIn: true })
    expect(logged.navigateBrowserView).not.toHaveBeenCalled()
    expect(siteAccountOf).not.toHaveBeenCalled()
    const foreign = context({ ...form, url: 'https://background.zjooc.cn.example.org/gxptLogin' })
    expect(JSON.parse(await loginZjooc(foreign)).ok).toBe(false)
    expect(siteAccountOf).not.toHaveBeenCalled()
    expect(JSON.parse(await loginZjooc(context(form, { ...form, loaderId: 'new' })))).not.toHaveProperty('challenge')
    siteAccountOf.mockReturnValue(null)
    expect(JSON.parse(await loginZjooc(context(form)))).toMatchObject({ credentialsRequired: true })
  })
  it('reports the visible challenge without returning entered values', () => {
    const script = readFileSync(new URL('../../src-tauri/src/cef/zjooc_login_state.js', import.meta.url), 'utf8')
    const dom = new JSDOM('<div class="login_box"><input id="login_name" type="text"><input id="password" type="password" value="private"><div class="forms code"><input name="captchaCode"><img alt="点击刷新"></div><button class="dologin">登录</button></div>', { url, runScripts: 'outside-only' })
    Object.defineProperty(dom.window.Element.prototype, 'getClientRects', { value: () => [{}] })
    expect(dom.window.eval(script + '(false)')).toEqual({ kind: 'form', challenge: true })
    const image = dom.window.document.querySelector('img')!
    Object.defineProperties(image, {
      complete: { value: true },
      naturalWidth: { value: 120 },
      naturalHeight: { value: 40 },
    })
    const drawImage = vi.fn()
    const captchaImage = 'data:image/png;base64,example-image'
    Object.defineProperties(dom.window.HTMLCanvasElement.prototype, {
      getContext: { value: () => ({ drawImage }) },
      toDataURL: { value: () => captchaImage },
    })
    expect(dom.window.eval(script + '(true)')).toEqual({ kind: 'form', challenge: true, captchaImage })
    expect(drawImage).toHaveBeenCalledExactlyOnceWith(image, 0, 0)
    const error = dom.window.document.createElement('div')
    error.id = 'error_msg'
    dom.window.document.body.append(error)
    error.textContent = '用户名或密码错误'
    expect(dom.window.eval(script + '(true)')).toEqual({ kind: 'rejected', rejection: 'credentials' })
    error.textContent = '验证码已过期'
    expect(dom.window.eval(script + '(true)')).toEqual({ kind: 'rejected', rejection: 'captcha' })
    error.textContent = '登录失败'
    expect(dom.window.eval(script + '(true)')).toEqual({ kind: 'rejected', rejection: 'unknown' })
    expect(drawImage).toHaveBeenCalledOnce()
    dom.reconfigure({ url: 'https://unrelated.example/gxptLogin' })
    expect(dom.window.eval(script + '(true)')).toEqual({ kind: 'other' })
    dom.window.close()
  })
})
