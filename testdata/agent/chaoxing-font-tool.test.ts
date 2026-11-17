import { describe, expect, it, vi } from 'vitest'
const decode = vi.hoisted(() => vi.fn())
vi.mock('../../src/services/agent/fontDecrypt/chaoxing', () => ({ CHAOXING_FONT_PROBE: 'probe', decodeChaoxingProbe: decode }))
import { handlePageTools } from '../../src/services/agent/tools/page'
import { assembleRoleTools } from '../../src/services/agent/subagent/tools'

describe('混淆字体浏览器工具', () => {
  it('提供给主 Agent 和探索 Agent', () => {
    for (const role of ['parent', 'explore'] as const) {
      expect(assembleRoleTools({ role }).map(t => t.function.name)).toContain('browser_decode_chaoxing_font')
    }
  })
  it('解码成功时返回对应框的文本', async () => {
    decode.mockResolvedValueOnce([{ index: 0, text: '题目' }])
    const result = await handlePageTools({ name: 'browser_decode_chaoxing_font', args: {}, browserId: 'b',
      evalBrowserFrames: async () => ({ frames: [{ url: 'https://example.test', result: {} }] }) })
    expect(JSON.parse(result!)).toMatchObject({ ok: true, frames: [{ entries: [{ text: '题目' }] }] })
  })
  it('解码不可靠时返回截图而不是猜测', async () => {
    decode.mockRejectedValueOnce(new Error('置信度不足'))
    const result = await handlePageTools({ name: 'browser_decode_chaoxing_font', args: {}, browserId: 'b',
      evalBrowserFrames: async () => ({ frames: [{ result: {} }] }), screenshotBrowserView: async () => ({ image: 'data:image/png;base64,abc' }) })
    expect(JSON.parse(result!)).toMatchObject({ ok: false, reason: '置信度不足', image: 'data:image/png;base64,abc' })
  })
})
