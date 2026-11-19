import type { BrowserLocator } from '../../browser/engine'
import { CHAOXING_LOGIN_URL } from '../../browser/skills/chaoxingLogin'
import { chaoxingUrl } from '../../platform/chaoxing/studentCourses'
import { isSecretReference } from '../../security/secureStore'
import { runWebsiteScript } from '../websiteScripts'
import { siteAccountOf, siteAccountsReady } from '../siteAccounts'
import type { handleWebsiteCourseTools } from './websiteCourses'

type Context = Pick<Parameters<typeof handleWebsiteCourseTools>[0],
  'args' | 'browserId' | 'role' | 'navigateBrowserView' | 'syncPeekedUrl' | 'onNavigation' | 'wait'> & {
    callProtocol: (id: string, op: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>
    actOnceOnBrowser: (id: string, locator: BrowserLocator, op: 'click' | 'fill', text?: string) =>
      Promise<{ dispatched: boolean; ok?: boolean; filled?: boolean }>
  }

export const actOnLoginPage = async (
  ctx: Context, useNative: boolean, locator: BrowserLocator, action: 'click' | 'fill', text?: string,
) => {
  if (!useNative) return text === undefined
    ? ctx.actOnceOnBrowser(ctx.browserId, locator, action)
    : ctx.actOnceOnBrowser(ctx.browserId, locator, action, text)
  const result = await ctx.callProtocol(ctx.browserId, 'login_action', { locator, action, ...(text === undefined ? {} : { text }) })
  return { dispatched: result.dispatched === true, ok: result.ok === true, filled: result.filled === true }
}

const site = 'chaoxing'
const space = 'https://i.chaoxing.com/'

export async function loginChaoxing(ctx: Context): Promise<string> {
  const id = ctx.browserId
  const fail = (reason: string, error: string, extra = {}) => JSON.stringify({ ok: false, reason, error, ...extra })
  if (ctx.role === 'explore' || Object.keys(ctx.args).length) {
    return fail('invalid', '学习通登录工具无需参数，凭据由软件从该网站的安全设置中读取。')
  }

  const read = async () => {
    await ctx.wait(0)
    const state = await ctx.callProtocol(id, 'chaoxing_login_state')
    const url = typeof state.url === 'string' ? chaoxingUrl(state.url) : null
    const frameId = typeof state.frameId === 'string' ? state.frameId : ''
    const loaderId = typeof state.loaderId === 'string' ? state.loaderId : ''
    return { kind: state.kind, modern: state.modern === true, rejected: state.rejected === true, url, frameId, loaderId,
      supportsLoginAction: state.supportsLoginAction === true }
  }
  type State = Awaited<ReturnType<typeof read>>
  const done = (state: State, alreadyLoggedIn: boolean) => {
    const url = state.url!
    ctx.syncPeekedUrl?.(id, url.href)
    return JSON.stringify({ ok: true, loggedIn: true, alreadyLoggedIn, url: url.origin + url.pathname })
  }
  const challenge = () => fail('verification_required', '学习通要求人工验证。请在浏览器完成验证码或滑块，并完成登录后继续。', { userActionRequired: true })
  const navigate = async (url: string) => {
    await ctx.wait(0)
    await ctx.navigateBrowserView(id, url)
    ctx.onNavigation?.()
  }
  const onPassport = (state: State) => state.url?.hostname === 'passport2.chaoxing.com'
  const inSpace = (state: State) => state.kind === 'space'
    && (state.url?.hostname === 'i.chaoxing.com' || state.url?.hostname === 'i.mooc.chaoxing.com')
  const plan = async (state: State) => (await runWebsiteScript('chaoxing.com', site, 'login', {
    kind: state.kind, host: state.url?.hostname || '', modern: state.modern, frameReady: Boolean(state.frameId && state.loaderId),
  }, proposal => {
    if (typeof proposal !== 'string' || !['logged_in', 'verify', 'open_space', 'open_form', 'fill', 'wait'].includes(proposal)) {
      throw new Error('学习通登录脚本返回了未知操作。')
    }
    return proposal
  }, { reuseForMs: 30_000 })).result
  let submitted = false
  try {
    let state = await read()
    if (state.kind === 'unsupported') {
      return fail('invalid', '当前浏览器不支持自动安全填写。请在浏览器手动登录学习通。', { userActionRequired: true })
    }
    let action = await plan(state)
    if (action === 'logged_in' && inSpace(state)) return done(state, true)
    if (state.kind === 'challenge') return challenge()
    let openedLogin = false
    if (action === 'open_space' && !onPassport(state) && state.kind !== 'loading') await navigate(space)
    for (let attempt = 0; attempt < 20; attempt++) {
      if (action === 'logged_in' && inSpace(state)) return done(state, true)
      if (state.kind === 'challenge') return challenge()
      if (action === 'fill' && onPassport(state) && state.kind === 'form' && state.modern && state.frameId && state.loaderId) break
      if (action === 'open_form' && !openedLogin && onPassport(state) && (state.kind === 'passport' || (state.kind === 'form' && !state.modern))) {
        await navigate(CHAOXING_LOGIN_URL)
        openedLogin = true
      }
      await ctx.wait(250)
      state = await read()
      action = await plan(state)
    }
    if (action !== 'fill' || !onPassport(state) || state.kind !== 'form' || !state.modern || !state.frameId || !state.loaderId) {
      return fail('verification_required', '未确认学习通登录表单或已登录空间。请核对浏览器当前页面。')
    }

    await siteAccountsReady
    const account = siteAccountOf(site)
    if (!isSecretReference(account?.account) || !isSecretReference(account?.password)) {
      return fail('invalid', '学习通账号或密码未配置。请在软件的学习通网站设置中填写，或在浏览器手动登录。', { credentialsRequired: true })
    }
    const locator = (value: string): BrowserLocator => ({
      by: 'css', value, frameId: state.frameId, loaderId: state.loaderId,
    })
    for (const [selector, reference] of [['input#phone', account.account], ['input#pwd[type="password"]', account.password]]) {
      await ctx.wait(0)
      const filled = await ctx.callProtocol(id, 'fill_secret', { locator: locator(selector), secret_ref: reference })
      if (filled.ok !== true || filled.filled !== true) return fail('stale', '学习通表单未能完成安全填写。请核对当前页面与网站账号设置。')
    }
    const beforeClick = await read()
    if (beforeClick.kind === 'challenge') return challenge()
    if (!onPassport(beforeClick) || beforeClick.kind !== 'form'
      || beforeClick.frameId !== state.frameId || beforeClick.loaderId !== state.loaderId) {
      return fail('stale', '登录表单已变化，未点击登录。请核对当前页面。')
    }
    await ctx.wait(0)
    const click = await actOnLoginPage(ctx, beforeClick.supportsLoginAction, locator('#loginBtn'), 'click')
    if (!click.dispatched) return fail('stale', '未能点击学习通登录按钮，请核对页面。')
    submitted = true
    ctx.onNavigation?.()
    for (let attempt = 0; attempt < 24; attempt++) {
      await ctx.wait(250)
      const result = await read()
      if (inSpace(result)) return done(result, false)
      if (result.kind === 'challenge') return challenge()
      if (onPassport(result) && result.rejected && (attempt >= 3 || !beforeClick.rejected)) {
        return fail('invalid', '学习通登录表单返回错误。请检查网站账号和密码，或在浏览器查看提示。', { loginRejected: true })
      }
    }
    return fail('verification_required', '已尝试登录，尚未确认进入学习通空间。请先检查当前页面。', { clickDispatched: true })
  } catch (error) {
    if ((error instanceof DOMException && error.name === 'AbortError') || String(error).includes('BROWSER_USER_CONTROL')) throw error
    return fail('verification_required', '暂时无法完成学习通登录。请核对浏览器当前页面与安全凭据设置。', { clickDispatched: submitted })
  }
}

export async function handleLoginTool(ctx: Context & { name: string; sessionId: string; signal?: AbortSignal }): Promise<string> {
  const { requestChatLogin } = await import('../chatLogin')
  if (ctx.name === 'browser_request_credentials') {
    if (ctx.role === 'explore' || Object.keys(ctx.args).length) return JSON.stringify({ ok: false, error: '请在登录页执行此工具，无需参数。' })
    return JSON.stringify(await requestChatLogin(ctx.sessionId, ctx.browserId, ctx.signal))
  }
  if (ctx.name === 'browser_login_zjooc') {
    const { loginZjooc } = await import('./zjoocLogin')
    let result = await loginZjooc(ctx)
    while (true) {
      const { credentialsRequired, credentialsRejected } = JSON.parse(result)
      if (!credentialsRequired) return result
      const receipt = await requestChatLogin(ctx.sessionId, ctx.browserId, ctx.signal, {
        expectedOrigin: 'https://background.zjooc.cn',
        replacingRejectedCredentials: credentialsRejected === true,
      })
      if (!receipt.ok) return JSON.stringify(receipt)
      result = await loginZjooc({ ...ctx, args: {} }, credentialsRejected === true)
      if (ctx.args.wait_for_verification === true && JSON.parse(result).challenge === 'image_captcha') {
        result = await loginZjooc(ctx)
      }
    }
  }
  const result = await loginChaoxing(ctx)
  if (!JSON.parse(result).credentialsRequired) return result
  const receipt = await requestChatLogin(ctx.sessionId, ctx.browserId, ctx.signal, { expectedOrigin: 'https://passport2.chaoxing.com' })
  return receipt.ok ? loginChaoxing(ctx) : JSON.stringify(receipt)
}
