import { asObject, evalBrowserViewMainNow, waitMs } from '../../browser/eval'
import { resolveHwImage } from '../homework/homeworkImages'
import { clickHomeworkBox, fillHomeworkBox } from '../homework/act'
import {
  LOCATE_CAPTCHA_IMG,
  LOCATE_CAPTCHA_INPUT,
  LOCATE_CAPTCHA_SUBMIT,
  READ_CAPTCHA,
  READ_CAPTCHA_SRC,
} from './cdpScripts'

export const CAPTCHA_HINT = '学习通弹出图片验证码（9010）。看图读出 4 位字母或数字，调用 browser_captcha 填上并提交，然后继续刷课。不要问用户。'

export const readChaoxingCaptcha = async (id: string) => {
  const hit = asObject(await evalBrowserViewMainNow(id, READ_CAPTCHA()).catch(() => null))
  return Boolean(hit.captcha)
}

export const readChaoxingCaptchaImage = async (id: string) => {
  const shot = asObject(await evalBrowserViewMainNow(id, READ_CAPTCHA_SRC()).catch(() => null))
  const src = String(shot.src || '')
  const image = src ? await resolveHwImage(src) : ''
  return {
    captcha: true,
    image: image.startsWith('data:image/') ? image : '',
    src,
  }
}

export const fillChaoxingCaptcha = async (id: string, code: string) => {
  const value = String(code || '').replace(/\s+/g, '')
  if (!/^[0-9a-zA-Z]{4}$/.test(value)) return { ok: false, error: '验证码必须是 4 位字母或数字' }
  const typed = await fillHomeworkBox(id, LOCATE_CAPTCHA_INPUT(), value).catch(() => ({ ok: false }))
  if (!typed.ok) return { ok: false, error: String((typed as { error?: string }).error || '没填上验证码') }
  await clickHomeworkBox(id, LOCATE_CAPTCHA_SUBMIT()).catch(() => null)
  await waitMs(900)
  const still = await readChaoxingCaptcha(id)
  return { ok: !still, code: value, still }
}

export const refreshChaoxingCaptcha = async (id: string) => {
  await clickHomeworkBox(id, LOCATE_CAPTCHA_IMG()).catch(() => null)
  await waitMs(450)
}
