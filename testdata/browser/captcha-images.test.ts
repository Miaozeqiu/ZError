import { describe, expect, it } from 'vitest'
import {
  captchaScreenshotHint,
  COLLECT_CAPTCHA_IMAGES,
  cropRectOnImage,
  parseCaptchaHits,
} from '../../src/services/browser/captchaImages'

describe('验证码采集脚本', () => {
  it('按文案、#ccc、data:image 和 maxlength 认图', () => {
    expect(COLLECT_CAPTCHA_IMAGES).toMatch(/验证码/)
    expect(COLLECT_CAPTCHA_IMAGES).toMatch(/#ccc/)
    expect(COLLECT_CAPTCHA_IMAGES).toMatch(/data:image/)
    expect(COLLECT_CAPTCHA_IMAGES).toMatch(/maxlength/)
    expect(COLLECT_CAPTCHA_IMAGES).toMatch(/__sameFrames/)
    expect(COLLECT_CAPTCHA_IMAGES).not.toMatch(/contentDocument/)
  })
})

describe('parseCaptchaHits', () => {
  it('丢掉空图，保留 maxlength', () => {
    const hits = parseCaptchaHits({
      viewport: { width: 800, height: 600 },
      items: [{
        image: 'data:image/png;base64,abc',
        src: 'data:image/png;base64,abc',
        width: 105,
        height: 42,
        box: { x: 120, y: 80, width: 83, height: 40 },
        maxlength: 5,
      }],
    })
    expect(hits).toHaveLength(1)
    expect(hits[0].width).toBe(105)
    expect(hits[0].maxlength).toBe(5)
    expect(hits[0].viewport).toEqual({ width: 800, height: 600 })
  })
})

describe('cropRectOnImage', () => {
  it('按视口比例裁到截图像素', () => {
    const rect = cropRectOnImage(1600, 800, 800, 400, { x: 100, y: 50, width: 80, height: 40 }, 0)
    expect(rect).toEqual({ x: 200, y: 100, w: 160, h: 80 })
  })

  it('整页那么大的盒子不当验证码', () => {
    expect(cropRectOnImage(800, 600, 800, 600, { x: 0, y: 0, width: 700, height: 500 })).toBeNull()
  })
})

describe('captchaScreenshotHint', () => {
  it('有图才提示位数', () => {
    expect(captchaScreenshotHint(0, 5)).toBeUndefined()
    expect(captchaScreenshotHint(1, 5)).toMatch(/约 5 位/)
  })
})
