import {
  fillChaoxingCaptcha,
  readChaoxingCaptcha,
  readChaoxingCaptchaImage,
  refreshChaoxingCaptcha,
} from './appBrowser'
import { runTextModel } from './modelRunner'

const parseCaptchaCode = (text: string) => {
  const compact = String(text || '').replace(/[^0-9a-zA-Z]/g, '')
  const match = compact.match(/[0-9a-zA-Z]{4}/)
  return match?.[0] || ''
}

export const solveChaoxingCaptcha = async (browserId: string) => {
  if (!(await readChaoxingCaptcha(browserId))) {
    return { ok: true, skipped: true as const }
  }
  let lastImage = ''
  let lastError = '没认出验证码'
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0) {
      await refreshChaoxingCaptcha(browserId)
    }
    const shot = await readChaoxingCaptchaImage(browserId)
    lastImage = shot.image || lastImage
    if (!shot.image) {
      lastError = '没读到验证码图片'
      continue
    }
    let raw = ''
    try {
      raw = await runTextModel('看图读出验证码', undefined, {
        useVisionModel: true,
        timeoutMs: 25000,
        systemPrompt: '你只识别图片验证码。只回复恰好 4 个字母或数字，不要标点，不要解释。',
        userContent: [
          { type: 'image_url', image_url: { url: shot.image, detail: 'high' } },
          { type: 'text', text: '这是学习通 4 位图片验证码。只回复这 4 个字符。' },
        ],
      })
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      continue
    }
    const code = parseCaptchaCode(raw)
    if (!code) {
      lastError = `模型没给出 4 位验证码：${String(raw || '').slice(0, 40)}`
      continue
    }
    const filled = await fillChaoxingCaptcha(browserId, code)
    if (filled.ok) return { ok: true, code, skipped: false as const }
    lastError = filled.error || '提交后验证码还在'
  }
  const shot = await readChaoxingCaptchaImage(browserId).catch(() => ({ image: lastImage }))
  return { ok: false, error: lastError, image: shot.image || lastImage, skipped: false as const }
}
