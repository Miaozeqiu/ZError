import {
  CHAOXING_CAPTCHA_CHECK,
  CHAOXING_CAPTCHA_FILL,
  CHAOXING_CAPTCHA_IMAGE,
  CHAOXING_CAPTCHA_REFRESH,
} from '../../browser/skills/chaoxingStudy'
import { asObject, evalBrowserView, waitMs } from '../../browser/eval'

export const CAPTCHA_HINT = '学习通弹出图片验证码（9010）。看图读出 4 位字母或数字，调用 browser_chaoxing_captcha 填上并提交，然后继续刷课。不要问用户。'

export const readChaoxingCaptcha = async (id: string) => {
  const hit = asObject(await evalBrowserView(id, CHAOXING_CAPTCHA_CHECK).catch(() => null))
  return Boolean(hit.captcha)
}

export const readChaoxingCaptchaImage = async (id: string) => {
  let shot = asObject(await evalBrowserView(id, CHAOXING_CAPTCHA_IMAGE).catch(() => null))
  if (!shot.image && shot.pending) {
    await waitMs(500)
    shot = asObject(await evalBrowserView(id, `(function(){ return window.__ZE_CAPTCHA_IMG__ || ${CHAOXING_CAPTCHA_IMAGE}; })()`).catch(() => null))
  }
  const image = String(shot.image || '')
  return {
    captcha: true,
    image: image.startsWith('data:image/') ? image : '',
    src: String(shot.src || ''),
  }
}

export const fillChaoxingCaptcha = async (id: string, code: string) => {
  const filled = asObject(await evalBrowserView(id, `${CHAOXING_CAPTCHA_FILL}(${JSON.stringify(String(code || '').trim())})`).catch(() => null))
  if (!filled.ok) return { ok: false, error: String(filled.error || '没填上验证码') }
  await waitMs(900)
  const still = await readChaoxingCaptcha(id)
  return { ok: !still, code: String(filled.code || code), still }
}

export const refreshChaoxingCaptcha = async (id: string) => {
  await evalBrowserView(id, CHAOXING_CAPTCHA_REFRESH).catch(() => null)
  await waitMs(450)
}