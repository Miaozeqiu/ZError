import { beforeEach, describe, expect, it, vi } from 'vitest'

const crackFont = vi.fn()
vi.mock('../../src/services/agent/fontDecrypt/bitmap', () => ({
  crackFont,
  decryptText: (text: string, map: Record<string, string>) => [...text].map(c => map[c] ?? c).join(''),
}))
import { decodeChaoxingProbe } from '../../src/services/agent/fontDecrypt/chaoxing'

describe('学习通混淆字体', () => {
  beforeEach(() => crackFont.mockReset())
  const probe = { font: ['AA=='], entries: [{ index: 0, text: '甲乙' }], truncated: false }
  it('只返回高置信度匹配，并保留原始顺序', async () => {
    crackFont.mockResolvedValue({ map: { 甲: '逻', 乙: '辑' }, details: [{ margin: 0.8 }, { margin: 0.7 }] })
    await expect(decodeChaoxingProbe(probe)).resolves.toEqual([{ index: 0, text: '逻辑' }])
  })
  it('对低置信度或未匹配的结果拒绝当作可靠文字', async () => {
    crackFont.mockResolvedValue({ map: { 甲: '逻' }, details: [{ margin: 0.1 }] })
    await expect(decodeChaoxingProbe(probe)).rejects.toThrow('置信度不足')
    crackFont.mockResolvedValue({ map: {}, details: [] })
    await expect(decodeChaoxingProbe(probe)).rejects.toThrow('置信度不足')
  })
  it('拒绝截断的字体或页面数据', async () => {
    await expect(decodeChaoxingProbe({ ...probe, truncated: true })).rejects.toThrow('不完整')
    await expect(decodeChaoxingProbe({ ...probe, font: ['broken…'] })).rejects.toThrow('无效')
    expect(crackFont).not.toHaveBeenCalled()
  })
})
