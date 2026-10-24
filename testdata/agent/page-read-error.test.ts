import { describe, expect, it, vi } from 'vitest'
import { handleNavTools } from '../../src/services/agent/tools/nav'

const base = () => ({
  name: 'browser_get_page', args: {}, browserId: 'tab', sessionId: 'session',
  currentUrl: async () => 'https://example.com', graphUrlOf: async () => 'https://example.com',
  graphNodeId: () => '', notePageProbe: () => 1,
  emptyPageSnaps: new Map<string, number>(),
})

describe('页面读取通道错误', () => {
  it('保留绑定错误，不伪装成页面还在加载，也不触发空页面恢复', async () => {
    const ctx = base()
    ctx.emptyPageSnaps.set('tab', 2)
    const error = '当前标签页的 CDP 会话绑定失败'
    const rebind = vi.fn()
    const result = JSON.parse((await handleNavTools({ ...ctx,
      readBrowserPage: async () => ({ url: 'https://example.com', snapshot: '', refs: [], error }),
      callProtocol: rebind,
    }))!)
    expect(result).toEqual({ ok: false, url: 'https://example.com', error })
    expect(result.empty).toBeUndefined()
    expect(rebind).not.toHaveBeenCalled()
    expect(ctx.emptyPageSnaps.has('tab')).toBe(false)
  })

  it('重连后发生通道错误也明确返回失败', async () => {
    const ctx = base()
    ctx.emptyPageSnaps.set('tab', 1)
    const read = vi.fn().mockResolvedValueOnce({ snapshot: '', refs: [] })
      .mockResolvedValueOnce({ error: '原生标签页不可用' })
    const result = JSON.parse((await handleNavTools({ ...ctx,
      readBrowserPage: read, getBrowserState: async () => ({ url: 'https://example.com' }),
      callProtocol: async () => ({}),
    }))!)
    expect(result).toEqual({ ok: false, url: 'https://example.com', error: '原生标签页不可用' })
    expect(result.hint).toBeUndefined()
  })
})
