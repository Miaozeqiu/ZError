import { describe, expect, it, vi } from 'vitest'
import { handlePageTools } from '../../src/services/agent/tools/page'
import { handleActTools } from '../../src/services/agent/tools/act'
import { locatorFromCache, rememberPageRefs } from '../../src/services/browser/engine/refs'

describe('浏览器工具的观测与执行边界', () => {
  it('截图不会刷新并暗中作废模型已知 ref', async () => {
    rememberPageRefs('shot-tab', [{ id: 'e10', role: 'button', name: '提交', locator: { by: 'role', value: 'button', name: '提交', backend: 17 } }])
    const read = vi.fn(async () => { throw new Error('截图不应采集快照') })
    const result = JSON.parse((await handlePageTools({
      name: 'browser_screenshot', browserId: 'shot-tab',
      getBrowserState: async () => ({ url: 'https://example.com' }),
      collectPageCaptchaHits: async () => [], screenshotBrowserView: async () => ({ image: 'data:image/png;base64,AA' }),
      materializeCaptchaImages: async () => ({ images: [], maxlength: 0 }), captchaScreenshotHint: () => '',
      readBrowserPage: read,
    }))!)
    expect(result.ok).toBe(true)
    expect(read).not.toHaveBeenCalled()
    expect(locatorFromCache('shot-tab', 'e10')?.backend).toBe(17)
  })

  it('按键仅发送一次，并返回动作后的观测', async () => {
    const protocol = vi.fn(async () => ({ ok: true }))
    const result = JSON.parse((await handleActTools({
      name: 'browser_press', args: { key: 'Enter' }, browserId: 'search-tab',
      currentUrl: async () => 'https://example.com', callProtocol: protocol, asObject: (v: unknown) => v,
      observeAfterClick: async (_id: string, result: object) => ({ ...result, snapshot: '搜索结果' }),
    }))!)
    expect(protocol).toHaveBeenCalledExactlyOnceWith('search-tab', 'press', { key: 'Enter' })
    expect(result.snapshot).toBe('搜索结果')
  })
})
