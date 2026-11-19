import type { BrowserLocator } from '../../browser/engine'
import { isSecretReference } from '../../security/secureStore'
import { pendingWebsiteVerification, requestChatLogin } from '../chatLogin'
import { siteAccountOf, siteAccountsReady } from '../siteAccounts'
import { runWebsiteWorkflow } from '../websiteScripts'
import type { handleWebsiteCourseTools } from './websiteCourses'
import { loginObserver } from './websiteLoginObservation'

type Context = Pick<Parameters<typeof handleWebsiteCourseTools>[0],
  'args' | 'browserId' | 'role' | 'navigateBrowserView' | 'syncPeekedUrl' | 'onNavigation' | 'wait'> & {
    callProtocol: (id: string, op: string, args?: Record<string, unknown>) => Promise<Record<string, unknown>>
    actOnceOnBrowser: (id: string, locator: BrowserLocator, op: 'click' | 'fill', text?: string) =>
      Promise<{ dispatched: boolean; ok?: boolean; filled?: boolean }>
    sessionId?: string
    signal?: AbortSignal
  }

type SiteLogin = { host: string; site: string; credentialOrigin: string }
const chaoxing: SiteLogin = { host: 'chaoxing.com', site: 'chaoxing', credentialOrigin: 'https://passport2.chaoxing.com' }
const zjooc: SiteLogin = { host: 'zjooc.cn', site: 'zjooc', credentialOrigin: 'https://background.zjooc.cn' }
const captchaChallenges = new WeakMap<AbortSignal, {
  id: string; browserId: string; site: string; url: string; frameId: string; loaderId: string; image: string
}>()

function sameSite(url: string, host: string): URL | undefined {
  if (!URL.canParse(url)) return
  const parsed = new URL(url)
  if (parsed.protocol === 'https:' && !parsed.port && !parsed.username && !parsed.password
    && (parsed.hostname === host || parsed.hostname.endsWith('.' + host))) return parsed
}

const selector = (value: unknown) => typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : ''
type LoginResult = {
  ok: boolean; reason?: string; error?: string; credentialsRequired?: boolean; credentialsRejected?: boolean
  challenge?: 'image_captcha'; [field: string]: unknown
}
const fail = (reason: string, error: string, extra: Partial<LoginResult> = {}): LoginResult => ({ ok: false, reason, error, ...extra })

async function runLogin(ctx: Context, profile: SiteLogin, restart: boolean): Promise<LoginResult> {
  const { host, site, credentialOrigin } = profile
  const { args, browserId, signal, sessionId } = ctx
  const verify = args.wait_for_verification === true
  const captchaCode = typeof args.captcha_code === 'string' ? args.captcha_code : ''
  const captchaId = typeof args.captcha_id === 'string' ? args.captcha_id : ''
  const submittingCaptcha = args.captcha_code !== undefined || args.captcha_id !== undefined
  const allowed = ['wait_for_verification', 'captcha_code', 'captcha_id']
  if (ctx.role === 'explore' || Object.keys(args).some(key => !allowed.includes(key))
    || (args.wait_for_verification !== undefined && typeof args.wait_for_verification !== 'boolean')
    || (submittingCaptcha && (verify || !captchaId || !/^[a-z0-9]{5}$/i.test(captchaCode)))) {
    return fail('invalid', '登录参数无效，请重新读取登录页。')
  }
  if (verify && (!sessionId || pendingWebsiteVerification.has(sessionId))) {
    return fail('invalid', '请在当前对话中等待网站登录验证。')
  }
  const observe = loginObserver(ctx.callProtocol, browserId, host)
  type Observation = Awaited<ReturnType<typeof observe>>
  let state: Observation = {}
  let fillingAttempted = false
  let filled = false
  let clicked = false
  let form: { url: string; frameId: string; loaderId: string } | undefined
  let issued: { captcha_id: string; captchaImage: string } | undefined
  let credentialsRequired = false
  let rejected = false
  const read = async (capture: boolean, run: (input: unknown) => unknown) => {
    state = await observe(capture, run)
    const url = sameSite(String(state.url ?? ''), host)
    const image = typeof state.captchaImage === 'string' && state.captchaImage.startsWith('data:image/png;base64,')
      && state.captchaImage.length <= 400_000 ? state.captchaImage : undefined
    return {
      kind: state.kind, rejection: state.rejection, rejected: state.rejected, challenge: state.challenge,
      origin: url?.origin, path: url?.pathname, modern: state.modern === true,
      document: typeof state.frameId === 'string' && typeof state.loaderId === 'string' ? state.loaderId : '',
      imageAvailable: Boolean(image),
    }
  }
  const identity = () => {
    const { url, frameId, loaderId } = state
    return typeof url === 'string' && typeof frameId === 'string' && frameId && typeof loaderId === 'string' && loaderId
      ? { url, frameId, loaderId } : undefined
  }
  const current = (pin = form) => pin && pin.url === state.url && pin.frameId === state.frameId && pin.loaderId === state.loaderId
  const sameForm = () => state.kind === 'form' && sameSite(String(state.url ?? ''), host)?.origin === credentialOrigin
  const locator = (value: string, pin: NonNullable<typeof form>): BrowserLocator => ({
    by: 'css', value, frameId: pin.frameId, loaderId: pin.loaderId,
  })
  const act = async (target: string, action: 'click' | 'fill', pin: NonNullable<typeof form>, text?: string, label?: string) => {
    const where = label ? { ...locator(label, pin), by: 'text' as const, exact: true } : locator(target, pin)
    await ctx.wait(0)
    if (!state.supportsLoginAction) {
      return text === undefined ? ctx.actOnceOnBrowser(browserId, where, action) : ctx.actOnceOnBrowser(browserId, where, action, text)
    }
    return ctx.callProtocol(browserId, 'login_action', {
      site, url: pin.url, locator: where, selector: target, action,
      ...(text === undefined ? {} : { text }), ...(label === undefined ? {} : { label }),
    })
  }
  if (verify) pendingWebsiteVerification.add(sessionId!)
  try {
    const output = await runWebsiteWorkflow(host, site, 'login', { verify, submittingCaptcha, restart }, async (raw, run) => {
      await ctx.wait(0)
      signal?.throwIfAborted()
      const command = raw as Record<string, unknown> | null
      switch (command?.op) {
        case 'read': {
          const delay = typeof command.delay === 'number' ? command.delay : 0
          if (!Number.isSafeInteger(delay) || delay < 0 || delay > 2000) throw new Error('登录流程等待时间无效')
          if (delay) await ctx.wait(delay)
          return read(command.capture === true && (filled || submittingCaptcha), run)
        }
        case 'navigate': {
          if (verify || submittingCaptcha || fillingAttempted || clicked) return false
          const url = sameSite(String(command.url ?? ''), host)
          if (!url) return false
          await ctx.navigateBrowserView(browserId, url.href)
          ctx.onNavigation?.()
          state = {}
          return true
        }
        case 'open_form': {
          const pin = identity()
          const target = selector(command.selector)
          const label = typeof command.label === 'string' && command.label.length <= 80 ? command.label : undefined
          if (!pin || !target || verify || submittingCaptcha || fillingAttempted || state.kind !== 'guest') return false
          const receipt = await act(target, 'click', pin, undefined, label)
          if (receipt.dispatched) {
            ctx.onNavigation?.()
            state = {}
          }
          return receipt.dispatched === true
        }
        case 'fill_credentials': {
          const account = selector(command.account)
          const password = selector(command.password)
          form = identity()
          if (!account || !password || !form || !sameForm() || verify || submittingCaptcha || fillingAttempted || clicked) return 'stale'
          fillingAttempted = true
          await siteAccountsReady
          const credentials = siteAccountOf(site)
          if (!isSecretReference(credentials?.account) || !isSecretReference(credentials?.password)) {
            credentialsRequired = true
            return 'missing'
          }
          for (const [target, reference] of [[account, credentials.account], [password, credentials.password]]) {
            await ctx.wait(0)
            const receipt = await ctx.callProtocol(browserId, 'fill_secret', { locator: locator(target, form), secret_ref: reference })
            if (receipt.ok !== true || receipt.filled !== true) return 'stale'
          }
          filled = true
          return 'filled'
        }
        case 'issue_captcha': {
          if (issued || !filled || !sameForm() || !current() || !signal || !form || state.challenge !== true
            || typeof state.captchaImage !== 'string' || !state.captchaImage.startsWith('data:image/png;base64,')
            || state.captchaImage.length > 400_000) return false
          const id = crypto.randomUUID()
          captchaChallenges.set(signal, { ...form, id, browserId, site, image: state.captchaImage })
          issued = { captcha_id: id, captchaImage: state.captchaImage }
          return true
        }
        case 'submit': {
          const button = selector(command.button)
          if (!button || verify || clicked || !sameForm()) return false
          if (submittingCaptcha) {
            const challenge = signal && captchaChallenges.get(signal)
            if (!signal || !challenge || challenge.id !== captchaId || challenge.browserId !== browserId
              || challenge.site !== site || !current(challenge) || state.challenge !== true || challenge.image !== state.captchaImage
              || !selector(command.captcha)) return false
            captchaChallenges.delete(signal)
            form = challenge
            const receipt = await act(selector(command.captcha), 'fill', challenge, captchaCode)
            if (receipt.ok !== true || receipt.filled !== true) return false
            await read(true, run)
            if (!sameForm() || !current(challenge) || challenge.image !== state.captchaImage) return false
          }
          if (!form || !current() || (!submittingCaptcha && (!filled || state.challenge === true))) return false
          const receipt = await act(button, 'click', form)
          clicked = receipt.dispatched === true
          if (clicked) ctx.onNavigation?.()
          return clicked
        }
        case 'reject_credentials':
          rejected = sameSite(String(state.url ?? ''), host)?.origin === credentialOrigin && state.rejection === 'credentials'
          credentialsRequired = rejected
          return rejected
        default:
          throw new Error('网站登录脚本请求了未知操作')
      }
    })
    const result = output as Record<string, unknown> | null
    if (result?.status === 'logged_in' && state.kind === 'space') {
      const url = sameSite(String(state.url ?? ''), host)
      if (url) {
        ctx.syncPeekedUrl?.(browserId, url.href)
        if (verify) ctx.onNavigation?.()
        return { ok: true, loggedIn: true, alreadyLoggedIn: !clicked, url: url.origin + url.pathname }
      }
    }
    if (result?.status === 'captcha' && issued) return {
      ok: true, loggedIn: false, challenge: 'image_captcha', ...issued,
      hint: '识别当前图片并传入 captcha_id 和 5 位 captcha_code。看不清时可等待用户验证。',
    }
    const message = typeof result?.message === 'string' && result.message.length <= 300 ? result.message : '请在浏览器核对登录状态。'
    if (credentialsRequired) return fail('invalid', message, { credentialsRequired: true, credentialsRejected: rejected })
    return fail(result?.status === 'stale' ? 'stale' : result?.status === 'rejected' ? 'invalid' : 'verification_required', message, {
      ...(result?.status === 'rejected' ? { loginRejected: true } : {}),
      ...(result?.status === 'captcha' ? { challenge: 'image_captcha', captchaImage: state.captchaImage } : {}),
      ...(clicked ? { clickDispatched: true } : {}), userActionRequired: true,
    })
  } catch (error) {
    if ((error instanceof DOMException && error.name === 'AbortError') || String(error).includes('BROWSER_USER_CONTROL')) throw error
    return fail('verification_required', '登录流程未能继续，请核对浏览器页面和网站经验版本。', { clickDispatched: clicked, userActionRequired: true })
  } finally {
    if (verify) pendingWebsiteVerification.delete(sessionId!)
  }
}

export const loginChaoxing = async (ctx: Context) => JSON.stringify(await runLogin(ctx, chaoxing, false))
export const loginZjooc = async (ctx: Context) => JSON.stringify(await runLogin(ctx, zjooc, false))

export async function handleLoginTool(ctx: Context & { name: string; sessionId: string }): Promise<string> {
  if (ctx.name === 'browser_request_credentials') {
    if (ctx.role === 'explore' || Object.keys(ctx.args).length) return JSON.stringify(fail('invalid', '请在登录页执行此工具，无需参数。'))
    return JSON.stringify(await requestChatLogin(ctx.sessionId, ctx.browserId, ctx.signal))
  }
  const profile = ctx.name === 'browser_login_zjooc' ? zjooc : chaoxing
  let result = await runLogin(ctx, profile, false)
  while (result.credentialsRequired) {
    const receipt = await requestChatLogin(ctx.sessionId, ctx.browserId, ctx.signal, {
      expectedOrigin: profile.credentialOrigin,
      replacingRejectedCredentials: result.credentialsRejected === true,
    })
    if (!receipt.ok) return JSON.stringify(receipt)
    result = await runLogin({ ...ctx, args: {} }, profile, result.credentialsRejected === true)
    if (ctx.args.wait_for_verification === true && result.challenge === 'image_captcha') {
      result = await runLogin({ ...ctx, args: { wait_for_verification: true } }, profile, false)
    }
  }
  return JSON.stringify(result)
}
