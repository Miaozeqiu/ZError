import { describe, expect, it, vi } from 'vitest'
vi.mock('../../src/services/browser/engine', () => ({ observedJson: async (_id: string, body: unknown) => JSON.stringify(body) }))
import { handleActTools } from '../../src/services/agent/tools/act'
import { cssSelectorFromArgs, looksLikeCssSelector } from '../../src/services/browser/engine/refs'

const base = () => ({
  browserId: 'frames-b', sessionId: 'frames-s', loop: {}, policy: { permissionMode: 'explore' },
  currentUrl: async () => 'https://example.com', graphUrlOf: async () => '', graphNodeId: () => '', isShellNode: () => false,
  cssSelectorFromArgs, looksLikeCssSelector, rememberLoginTyped: vi.fn(),
  observeAfterClick: async (_id: string, body: unknown) => body, formatMissRefsHint: () => '',
})

describe('Agent frame 动作', () => {
  it('重复 ID 仍保留指定 frame/nth，不走全局快捷路径', async () => {
    const click = vi.fn(async () => ({ ok: true }))
    const quick = vi.fn()
    await handleActTools({ ...base(), name: 'browser_click', args: { selector: '#submit', frame: 'quiz', nth: 2 },
      clickByLocator: click, clickBrowserElement: quick })
    expect(click).toHaveBeenCalledWith('frames-b', { by: 'css', value: '#submit', frame: 'quiz', nth: 2 })
    expect(quick).not.toHaveBeenCalled()
  })

  it('快照 backend 过期时重新定位，并保留文档身份', async () => {
    const locator = { by: 'role', value: 'button', name: '播放', backend: 123, frameId: 'video', loaderId: 'doc-1' }
    const click = vi.fn(async () => ({ ok: true }))
    const protocol = vi.fn()
    await handleActTools({ ...base(), name: 'browser_click', args: { ref: 'e3' },
      resolveRefLocator: async () => locator, clickByLocator: click, callProtocol: protocol })
    expect(click).toHaveBeenCalledWith('frames-b', expect.objectContaining({ frameId: 'video', loaderId: 'doc-1' }))
    expect(protocol).not.toHaveBeenCalled()
  })

  it('填写使用目标节点回执，不再跨框查同名输入框', async () => {
    const written = { ok: true, filled: true, length: 3, text: 'abc' }
    const fill = vi.fn(async () => written)
    const readOtherFrame = vi.fn(async () => ({ filled: false }))
    const result = await handleActTools({ ...base(), name: 'browser_type', args: { selector: '#answer', frame: 'quiz', text: 'abc' },
      fillByLocator: fill, evalBrowserView: readOtherFrame, typedResult: (body: unknown) => JSON.stringify(body) })
    expect(fill).toHaveBeenCalledWith('frames-b', expect.objectContaining({ frame: 'quiz' }), 'abc')
    expect(JSON.parse(result!).filled).toBe(true)
    expect(readOtherFrame).not.toHaveBeenCalled()
  })
})
