import { describe, expect, it, vi } from 'vitest'
vi.mock('../../src/services/model/config', () => ({ fetchRemoteModelsCatalog: vi.fn().mockResolvedValue({}) }))
import { findQuestionImageMatches } from '../../src/utils/question/questionImage'
import { createImageQuestionPreparer, restorePreparedImageAnswer } from '../../src/utils/answer/imageQuestion'
import { buildMultimodalContentFromPlaceholders } from '../../src/utils/answer/imagePlaceholders'
const IMG1 = 'data:image/png;base64,AAA'
const IMG2 = 'data:image/png;base64,BBB'
const URL1 = 'https://a.test/render?id=1'
const URL2 = 'https://a.test/second.png'

describe('local OCS-compatible image preparation', () => {
  it('uses title-first URL identities, preserves multiline options and downloads repeated URLs only once', async () => {
    const source = { title: `观察${URL1}。`, options: `A. ${URL2}\n补充说明\nB. ${URL1}` }
    const original = structuredClone(source)
    const load = vi.fn(async (url: string) => url === URL1 ? IMG1 : IMG2)
    const preparer = createImageQuestionPreparer(findQuestionImageMatches, load)
    const first = preparer.prepare(source)
    expect(preparer.prepare(source)).toBe(first)
    const prepared = await first
    expect(prepared.title).toBe('观察[图片1]。')
    expect(prepared.options).toBe('A. [图片2]\n补充说明\nB. [图片1]')
    expect(prepared.imageUrls).toEqual([URL1, URL2])
    expect(prepared.images).toEqual([IMG1, IMG2])
    expect(load).toHaveBeenCalledTimes(2)
    expect(source).toEqual(original)
    expect(restorePreparedImageAnswer('[图片2]\n补充说明###[图片1]', prepared))
      .toBe(`${URL2}\n补充说明###${URL1}`)
  })
  it('does not let asynchronous download completion change numbering', async () => {
    const pending: Array<(image: string) => void> = []
    const preparer = createImageQuestionPreparer(findQuestionImageMatches, () => new Promise(resolve => pending.push(resolve)))
    const task = preparer.prepare({ title: URL1, options: URL2 })
    pending[1](IMG2); pending[0](IMG1)
    expect((await task).images).toEqual([IMG1, IMG2])
  })
  it('uses supplied OCS images without downloading or re-enumerating their identities', async () => {
    const find = vi.fn(); const load = vi.fn()
    const prepared = await createImageQuestionPreparer(find, load).prepare({ title: '[图片2]', options: 'A. [图片1]', images: [IMG1, IMG2] })
    expect(prepared.source).toBe('ocs')
    expect(prepared.images).toEqual([IMG1, IMG2])
    expect(find).not.toHaveBeenCalled(); expect(load).not.toHaveBeenCalled()
    expect(restorePreparedImageAnswer('[图片1]', prepared)).toBe('[图片1]')
  })
  it('fails the whole preparation when any required picture cannot be downloaded', async () => {
    const preparer = createImageQuestionPreparer(findQuestionImageMatches, async url => {
      if (url === URL1) throw new Error('denied')
      return IMG2
    })
    await expect(preparer.prepare({ title: URL1, options: URL2 })).rejects.toThrow('无法完整识别题目')
  })
  it('rejects non-image data and unknown answer image numbers', async () => {
    const invalid = createImageQuestionPreparer(findQuestionImageMatches, async () => 'data:text/html;base64,AAA')
    await expect(invalid.prepare({ title: URL1, options: '' })).rejects.toThrow('转换失败')
    const prepared = await createImageQuestionPreparer(findQuestionImageMatches, async () => IMG1).prepare({ title: URL1, options: '' })
    expect(() => restorePreparedImageAnswer('[图片0]', prepared)).toThrow('不存在')
    expect(() => restorePreparedImageAnswer('[图片2]', prepared)).toThrow('不存在')
  })
  it('keeps ordinary text unchanged and leaves answer examples as text', async () => {
    const load = vi.fn()
    const prepared = await createImageQuestionPreparer(findQuestionImageMatches, load).prepare({ title: '普通题干', options: 'A. 第一行\n第二行\nB. 另一项' })
    expect(prepared.images).toEqual([])
    expect(load).not.toHaveBeenCalled()
    expect(prepared.options).toContain('第一行\n第二行')
    const parts = buildMultimodalContentFromPlaceholders(prepared.title, prepared.images, '\nANSWER: [图片1]')
    expect(parts).toEqual([{ type: 'text', text: '普通题干\nANSWER: [图片1]' }])
  })
  it('can release a failed preparation before a manual retry', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce(IMG1)
    const preparer = createImageQuestionPreparer(findQuestionImageMatches, load)
    const source = { title: URL1, options: '' }
    await expect(preparer.prepare(source)).rejects.toThrow()
    preparer.clear(source)
    expect((await preparer.prepare(source)).images).toEqual([IMG1])
  })
})
