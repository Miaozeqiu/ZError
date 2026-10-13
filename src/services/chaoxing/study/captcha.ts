import { asObject, evalBrowserViewMainNow, waitMs } from '../../browser/eval'
import { resolveHwImage } from '../homework/homeworkImages'
import { locatorsForCaptcha } from '../locators'
import { clickHomeworkBox, fillHomeworkBox } from '../homework/act'
import {
  READ_CAPTCHA,
  READ_CAPTCHA_SRC,
} from './cdpScripts'

export const CAPTCHA_HINT = '学习通弹出图片验证码（9010）。看图读出 4 位字母或数字，填进输入框并提交，然后继续刷课。不要问用户。'

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
  const typed = await fillHomeworkBox(id, locatorsForCaptcha('input'), value).catch(() => ({ ok: false }))
  if (!typed.ok) return { ok: false, error: String((typed as { error?: string }).error || '没填上验证码') }
  await clickHomeworkBox(id, locatorsForCaptcha('submit')).catch(() => null)
  await waitMs(900)
  const still = await readChaoxingCaptcha(id)
  return { ok: !still, code: value, still }
}

export const refreshChaoxingCaptcha = async (id: string) => {
  await clickHomeworkBox(id, locatorsForCaptcha('img')).catch(() => null)
  await waitMs(450)
}
