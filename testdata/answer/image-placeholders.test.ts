import { describe, expect, it } from 'vitest'
import {
  buildHtmlFromPlaceholders,
  buildMultimodalContentFromPlaceholders,
} from '../../src/utils/answer/imagePlaceholders'
import {
  buildImageAnswerRule,
  buildUrlOptionMapForMode,
  resolveUrlAnswer,
} from '../../src/utils/answer/urlQuestion'

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

describe('buildImageAnswerRule（OCS [图片N] 约定）', () => {
  it('填空/简答要求答案图片输出 [图片N]', () => {
    const rule = buildImageAnswerRule('open')
    expect(rule).toContain('[图片N]')
    expect(rule).toContain('ANSWER: [图片1]###[图片2]')
  })

  it('选择题仍要求输出选项编号', () => {
    const rule = buildImageAnswerRule('single')
    expect(rule).toContain('选项编号')
    expect(rule).not.toContain('只输出对应的 [图片N]')
  })
})

describe('图片选项的答案映射', () => {
  it('选择题选到图片选项时返回 [图片N] 占位符', () => {
    const map = buildUrlOptionMapForMode('single', 'A. [图片1]\nB. [图片2]')
    expect(resolveUrlAnswer('ANSWER: B', map, 'single')).toBe('[图片2]')
  })

  it('开放题直接输出 [图片N] 时原样透传', () => {
    expect(resolveUrlAnswer('ANSWER: [图片1]', new Map(), 'open')).toBe('[图片1]')
  })
})
