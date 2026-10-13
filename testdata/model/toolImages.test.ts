import { describe, expect, it } from 'vitest'
import {
  takeToolImages,
  visionAttachCaption,
  visionAttachParts,
  visionDetailOf,
} from '../../src/services/model/toolImages'

const png = (fill: string, size: number) => `data:image/png;base64,${fill.repeat(Math.ceil(size / fill.length)).slice(0, size)}`
const jpeg = (size: number) => `data:image/jpeg;base64,${'A'.repeat(size)}`

describe('takeToolImages', () => {
  it('抽出顶层截图，正文改成 [attached]', () => {
    const image = jpeg(1200)
    const taken = takeToolImages(JSON.stringify({ ok: true, image, url: 'https://zjooc.cn/login' }))
    expect(taken.images).toEqual([image])
    const body = JSON.parse(taken.text)
    expect(body.image).toBe('[attached]')
    expect(body.bytes).toBe(image.length)
    expect(body.url).toBe('https://zjooc.cn/login')
  })

  it('eval 里的验证码 src 也当成图', () => {
    const src = png('iVBOR', 490)
    const taken = takeToolImages(JSON.stringify({ ok: true, src, width: 105, height: 42 }))
    expect(taken.images).toEqual([src])
    expect(JSON.parse(taken.text).src).toBe('[attached]')
  })

  it('小图排在整页前面', () => {
    const captcha = png('abcd', 490)
    const page = jpeg(120_000)
    const taken = takeToolImages(JSON.stringify({
      ok: true,
      image: page,
      images: [captcha],
    }))
    expect(taken.images[0]).toBe(captcha)
    expect(taken.images[1]).toBe(page)
    expect(taken.images).toHaveLength(2)
  })

  it('不要把嵌套的超大 data:image 都塞进来', () => {
    const nested = jpeg(220_000)
    const taken = takeToolImages(JSON.stringify({ ok: true, src: nested }))
    expect(taken.images).toEqual([])
    expect(taken.text).toContain('data:image/jpeg')
  })
})

describe('vision attach', () => {
  it('小图用 high，整页用 low', () => {
    expect(visionDetailOf(png('x', 490))).toBe('high')
    expect(visionDetailOf(jpeg(125_000))).toBe('low')
  })

  it('有小图时让模型先认验证码', () => {
    const parts = visionAttachParts([png('x', 490), jpeg(125_000)])
    expect(parts[0]).toMatchObject({ type: 'image_url', image_url: { detail: 'high' } })
    expect(parts[1]).toMatchObject({ type: 'image_url', image_url: { detail: 'low' } })
    expect(visionAttachCaption([png('x', 490), jpeg(125_000)])).toMatch(/验证码原图/)
  })

  it('单独一张整页截图不说成验证码', () => {
    expect(visionAttachCaption([jpeg(74_000)])).toMatch(/工具返回的图/)
    expect(visionAttachCaption([jpeg(74_000)])).not.toMatch(/验证码/)
    expect(visionAttachCaption([png('x', 490)])).not.toMatch(/验证码/)
  })
})
