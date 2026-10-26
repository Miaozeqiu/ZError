import { describe, expect, it } from 'vitest'
import {
  buildHtmlFromPlaceholders,
  buildMultimodalContentFromPlaceholders,
} from '../../src/utils/answer/imagePlaceholders'

const IMG1 = 'data:image/png;base64,AAA'
const IMG2 = 'data:image/png;base64,BBB'

describe('buildMultimodalContentFromPlaceholders', () => {
  it('按 [图片N] 顺序拆成文本与图片片段', () => {
    const parts = buildMultimodalContentFromPlaceholders('题干[图片1]，选项[图片2]', [IMG1, IMG2])
    expect(parts).toEqual([
      { type: 'text', text: '题干' },
      { type: 'image_url', image_url: { url: IMG1, detail: 'high' } },
      { type: 'text', text: '，选项' },
      { type: 'image_url', image_url: { url: IMG2, detail: 'high' } },
    ])
  })

  it('编号越界时保留占位符原文，不中断', () => {
    const parts = buildMultimodalContentFromPlaceholders('答案[图片3]', [IMG1])
    expect(parts).toEqual([{ type: 'text', text: '答案[图片3]' }])
  })

  it('没有占位符时返回单个文本片段', () => {
    const parts = buildMultimodalContentFromPlaceholders('纯文本题目', [IMG1])
    expect(parts).toEqual([{ type: 'text', text: '纯文本题目' }])
  })

  it('支持多位编号', () => {
    const images = Array.from({ length: 10 }, (_, i) => `data:image/png;base64,N${i + 1}`)
    const parts = buildMultimodalContentFromPlaceholders('[图片10]', images)
    expect(parts).toEqual([
      { type: 'image_url', image_url: { url: images[9], detail: 'high' } },
    ])
  })
})

describe('buildHtmlFromPlaceholders', () => {
  it('把占位符内联为 base64 图片并保留换行', () => {
    const html = buildHtmlFromPlaceholders('题干[图片1]', '', [IMG1])
    expect(html).toContain(`<img src="${IMG1}"`)
    expect(html).not.toContain('[图片1]')
  })

  it('选项追加在题干后面，缺图时保留占位符', () => {
    const html = buildHtmlFromPlaceholders('题干', 'A. 选项[图片2]', [IMG1])
    expect(html).toContain('选项：')
    expect(html).toContain('[图片2]')
    expect(html).toContain('<br/>')
  })
})
