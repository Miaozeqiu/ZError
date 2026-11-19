import { siteAccountOf, siteAccountsReady } from '../siteAccounts'
import { runWebsiteScript } from '../websiteScripts'
import { pendingWebsiteVerification } from '../chatLogin'
import { actOnLoginPage, type loginChaoxing } from './websiteLogin'

const home = 'https://www.zjooc.cn'
const passport = 'https://background.zjooc.cn/gxptLogin'
const captchaInput = '.login_box .forms.code input[name=captchaCode]'
type Context = Parameters<typeof loginChaoxing>[0] & { sessionId?: string; signal?: AbortSignal }
const captchaChallenges = new WeakMap<AbortSignal, {
  id: string; browserId: string; frameId: string; loaderId: string; image: string
}>()

export async function loginZjooc(ctx: Context, restartAfterRejection = false): Promise<string> {
  const id = ctx.browserId
  const blocked = (reason: string, error: string, extra = {}) =>
    JSON.stringify({ ok: false, reason, error, ...extra })
  const manual = (message: string, extra = {}) => blocked('verification_required', message, { userActionRequired: true, ...extra })
  const wrongCredentials = () => blocked('invalid', '在浙学提示账号或密码有误，请在对话中重新填写。', {
    credentialsRequired: true, credentialsRejected: true,
  })
  const waitForVerification = ctx.args.wait_for_verification === true
  const { captcha_code: code, captcha_id: captchaId } = ctx.args
  const submitCaptcha = code !== undefined || captchaId !== undefined
  const captchaAnswer = typeof code === 'string' ? code : ''
  if (ctx.role === 'explore' || Object.keys(ctx.args).some(key => !['wait_for_verification', 'captcha_code', 'captcha_id'].includes(key))
    || (ctx.args.wait_for_verification !== undefined && typeof ctx.args.wait_for_verification !== 'boolean')) {
    return blocked('invalid', '在浙学登录工具只接受验证码、图片标识或等待验证参数。')
  }
  if (submitCaptcha && (waitForVerification || typeof captchaId !== 'string' || !/^[a-z0-9]{5}$/i.test(captchaAnswer))) {
    return blocked('invalid', '请根据当前图片传入 captcha_id 和 5 位字母或数字的 captcha_code。')
  }

  const navigate = async (url: string) => {
    await ctx.wait(0)
    await ctx.navigateBrowserView(id, url)
    ctx.onNavigation?.()
  }
  const read = async (captureCaptcha = false) => {
    await ctx.wait(0)
    const state = await ctx.callProtocol(id, 'zjooc_login_state', captureCaptcha ? { captureCaptcha } : undefined)
    const url = URL.canParse(String(state.url)) ? new URL(String(state.url)) : null
    return {
      captchaImage: typeof state.captchaImage === 'string' && state.captchaImage.startsWith('data:image/png;base64,')
        && state.captchaImage.length <= 400_000 ? state.captchaImage : undefined,
      kind: state.kind, rejection: state.rejection, challenge: state.challenge === true, url,
      atForm: !!url && url.origin + url.pathname === passport,
      supportsLoginAction: state.supportsLoginAction === true,
      frameId: typeof state.frameId === 'string' ? state.frameId : '',
      loaderId: typeof state.loaderId === 'string' ? state.loaderId : '',
    }
  }

  type State = Awaited<ReturnType<typeof read>>
  const inSpace = (state: State) => state.kind === 'space' && state.url?.origin === home
  const inLoginFlow = (state: State) => state.atForm || state.url?.origin === home || state.kind === 'loading'
  const done = (state: State) => {
    const url = state.url!
    ctx.syncPeekedUrl?.(id, url.href)
    return JSON.stringify({ ok: true, loggedIn: true, url: url.origin + url.pathname })
  }
  let submitted = false

  try {
    let state = await read(submitCaptcha)
    if (submitCaptcha) {
      if (inSpace(state)) return done(state)
      const pending = ctx.signal && captchaChallenges.get(ctx.signal)
      if (!ctx.signal || !pending || pending.id !== captchaId || pending.browserId !== id) {
        return blocked('stale', '验证码图片已失效，请重新获取当前登录页的验证码。')
      }
      const matchesChallenge = (page: State) => page.atForm && page.kind === 'form' && page.challenge
        && page.frameId === pending.frameId && page.loaderId === pending.loaderId && page.captchaImage === pending.image
      captchaChallenges.delete(ctx.signal)
      if (!matchesChallenge(state)) return blocked('stale', '网页验证码已更换，请重新获取验证码后再提交。')

      const locator = (value: string) => ({
        by: 'css' as const, value, frameId: pending.frameId, loaderId: pending.loaderId,
      })
      await ctx.wait(0)
      const filled = await actOnLoginPage(ctx, state.supportsLoginAction, locator(captchaInput), 'fill', captchaAnswer)
      if (filled.ok !== true || filled.filled !== true) return manual('未能填写在浙学验证码，请检查登录表单。')
      if (!matchesChallenge(await read(true))) return blocked('stale', '填写时验证码发生变化，请重新获取图片。')
      await ctx.wait(0)
      const click = await actOnLoginPage(ctx, state.supportsLoginAction, locator('.login_box button.dologin'), 'click')
      if (!click.dispatched) return manual('未能点击在浙学登录按钮，请核对页面。')
      submitted = true
      ctx.onNavigation?.()
      for (let poll = 0; poll < 32; poll++) {
        await ctx.wait(375)
        state = await read()
        if (inSpace(state)) return done(state)
        if (!state.atForm) continue
        if (state.kind === 'reset') return manual('在浙学要求修改密码，请在网页上处理。')
        if (state.rejection === 'credentials') return wrongCredentials()
        if (state.rejection === 'captcha') return manual('在浙学拒绝了验证码，请在网页刷新验证码后再验证。')
        if (state.kind === 'rejected') return manual('在浙学返回登录错误，请查看网页提示。')
      }
      return manual('登录已提交，尚未确认账号已登录。请先核对当前网页。', { clickDispatched: true })
    }
    if (waitForVerification) {
      if (inSpace(state)) return done(state)
      if (!ctx.sessionId || (!state.atForm && state.url?.origin !== home)) return manual('请打开在浙学登录页，再等待验证。')
      const sessionId = ctx.sessionId
      if (pendingWebsiteVerification.has(sessionId)) return blocked('invalid', '正在等待本次在浙学验证。')
      pendingWebsiteVerification.add(sessionId)
      try {
        for (let poll = 0; poll < 90; poll++) {
          if (state.atForm && state.kind === 'reset') return manual('在浙学要求修改密码，请在当前页面处理。')
          if (state.atForm && state.rejection === 'credentials') return wrongCredentials()
          if (!inLoginFlow(state)) {
            return manual('登录页已切换，请重新核对在浙学登录状态。')
          }
          await ctx.wait(2000)
          state = await read()
          if (inSpace(state)) {
            ctx.onNavigation?.()
            return done(state)
          }
        }
        return manual('等待在浙学验证超时。完成网页登录后，可再次核对登录状态。')
      } finally {
        pendingWebsiteVerification.delete(sessionId)
      }
    }
    if (state.kind === 'unsupported') {
      if (!state.atForm) await navigate(home)
      return manual('当前浏览器需要你在在浙学页面手动登录。')
    }
    let rejectedLoader = ''
    const reopeningPassport = restartAfterRejection && state.atForm && state.rejection === 'credentials'
    if (reopeningPassport) {
      rejectedLoader = state.loaderId
      await navigate(passport)
      state = await read()
    } else if (!state.atForm && state.url?.origin !== home) {
      await navigate(home)
      state = await read()
    }
    const plan = async (state: State) => (await runWebsiteScript('zjooc.cn', 'zjooc', 'login', {
      kind: state.kind, atForm: state.atForm, atHome: state.url?.origin === home,
      frameReady: Boolean(state.frameId && state.loaderId), rejection: state.rejection,
    }, proposal => {
      if (typeof proposal !== 'string' || !['logged_in', 'reset_password', 'credentials', 'captcha', 'rejected', 'fill', 'open_form', 'wait'].includes(proposal)) {
        throw new Error('在浙学登录脚本返回了未知操作。')
      }
      return proposal
    }, { reuseForMs: 30_000 })).result
    let openedLogin = false
    let action = 'wait'
    for (let poll = 0; poll < 40; poll++) {
      action = await plan(state)
      if (action === 'logged_in' && inSpace(state)) return done(state)
      if (reopeningPassport && (!state.atForm || state.loaderId === rejectedLoader)) {
        await ctx.wait(250)
        state = await read()
        continue
      }
      if (state.atForm && state.kind === 'reset') return manual('在浙学要求修改密码。请在当前页面处理后继续。')
      if (state.atForm && state.kind === 'rejected') {
        if (state.rejection === 'credentials') return wrongCredentials()
        if (state.rejection === 'captcha') return manual('在浙学提示验证码有误或已失效，请在网页刷新验证码后重试。')
        return manual('在浙学显示登录错误。请在当前页面核对提示并处理。')
      }
      if (action === 'fill' && state.atForm && state.kind === 'form' && state.frameId && state.loaderId) break
      if (action === 'open_form' && !openedLogin && state.kind === 'guest' && state.url?.origin === home && state.frameId && state.loaderId) {
        openedLogin = true
        const click = await actOnLoginPage(ctx, state.supportsLoginAction, {
          by: 'text', value: '请登录', exact: true, frameId: state.frameId, loaderId: state.loaderId,
        }, 'click')
        if (!click.dispatched) return manual('未能打开在浙学登录页，请核对官网上的「请登录」入口。')
        ctx.onNavigation?.()
      }
      await ctx.wait(250)
      state = await read()
    }
    if (action !== 'fill' || !state.atForm || state.kind !== 'form' || !state.frameId || !state.loaderId || state.loaderId === rejectedLoader) {
      if (reopeningPassport) return blocked('stale', '凭据已更新，但新的在浙学登录页还没就绪。重新打开登录页后再取验证码。')
      return manual('尚未确认在浙学的登录表单或个人中心，请核对当前页面。')
    }

    await siteAccountsReady
    const credentials = siteAccountOf('zjooc')
    if (credentials?.account !== '{{secret:site/zjooc/account}}' || credentials.password !== '{{secret:site/zjooc/password}}') {
      return blocked('invalid', '请在网站设置中保存「在浙学」的账号和密码，或在当前页面手动登录。', { credentialsRequired: true })
    }
    for (const [selector, reference] of [
      ['.login_box input#login_name[type=text]', credentials.account],
      ['.login_box input#password[type=password]', credentials.password],
    ]) {
      await ctx.wait(0)
      const locator = { by: 'css', value: selector, frameId: state.frameId, loaderId: state.loaderId }
      const filled = await ctx.callProtocol(id, 'fill_secret', { locator, secret_ref: reference })
      if (filled.ok !== true || filled.filled !== true) return manual('在浙学表单未能完成安全填写，请核对当前页面。')
    }
    const current = await read(true)
    if (!current.atForm || current.kind !== 'form' || current.frameId !== state.frameId || current.loaderId !== state.loaderId) {
      return manual('在浙学登录页已变化，请核对当前页面。')
    }
    let imageId: string | undefined
    if (current.challenge && current.captchaImage && ctx.signal) {
      imageId = crypto.randomUUID()
      captchaChallenges.set(ctx.signal, {
        id: imageId, browserId: id, frameId: current.frameId, loaderId: current.loaderId, image: current.captchaImage,
      })
    }
    if (imageId) return JSON.stringify({
      ok: true, loggedIn: false, challenge: 'image_captcha', captchaImage: current.captchaImage, captcha_id: imageId,
      hint: '已取得当前验证码图片。传 captcha_id 和识别出的 5 位 captcha_code 才会提交登录。看不清时用 wait_for_verification=true 等待用户验证。',
    })
    if (current.challenge) return manual('请在浏览器完成在浙学验证码并点击登录。', {
      challenge: 'image_captcha', captchaImage: current.captchaImage,
      hint: '调用 browser_login_zjooc(wait_for_verification=true) 等待用户在网页验证并登录。',
    })
    return manual('已填写在浙学账号和密码，请核对当前页面并点击登录。')
  } catch (error) {
    if ((error instanceof DOMException && error.name === 'AbortError') || String(error).includes('BROWSER_USER_CONTROL')) throw error
    return manual('暂时无法确认在浙学登录状态，请核对当前页面。', submitted ? { clickDispatched: true } : {})
  }
}
