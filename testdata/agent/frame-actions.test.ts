import { describe, expect, it, vi } from 'vitest'
vi.mock('../../src/services/browser/engine', () => ({ observedJson: async (_id: string, body: unknown) => JSON.stringify(body) }))
import { handleActTools } from '../../src/services/agent/tools/act'
import { cssSelectorFromArgs, looksLikeCssSelector } from '../../src/services/browser/engine/refs'
import { locatorFromCache, rememberPageRefs } from '../../src/services/browser/engine/refs'
import { cachedPageSnap, rememberPageSnap } from '../../src/services/browser/engine/pageSnap'

const base = () => ({
  browserId: 'frames-b', sessionId: 'frames-s', loop: {}, policy: { permissionMode: 'explore' },
  currentUrl: async () => 'https://example.com', graphUrlOf: async () => '', graphNodeId: () => '', isShellNode: () => false,
  cssSelectorFromArgs, looksLikeCssSelector, rememberLoginTyped: vi.fn(),
  observeAfterClick: async (_id: string, body: unknown) => body, formatMissRefsHint: () => '',
})

describe('Agent frame 动作', () => {
  it.each(['browser_click', 'browser_click_text'])('文案点击 %s 优先使用快照中的唯一 DOM 控件，不要求它同时出现在 AX 树', async name => {
    const locator = { by: 'css', value: '.chapter-title', frame: 'frame_content-zj', frameId: 'course-frame', loaderId: 'course-doc' }
    const click = vi.fn(async () => ({ ok: true }))
    const result = await handleActTools({ ...base(), name, args: { text: '1.1 国家安全学课程绪论', frame: 'frame_content-zj' },
      listCachedPageRefs: () => [{ id: 'e447', name: '1.1 国家安全学课程绪论', locator }], clickByLocator: click })
    expect(JSON.parse(result!).ok).toBe(true)
    expect(click).toHaveBeenCalledWith('frames-b', locator)
  })
  it('节点不属于文档时清除旧 ref 和快照，不带旧 frame 重新读取失败现场', async () => {
    const locator = { by: 'css' as const, value: '.chapter-title', frameId: 'old-frame', loaderId: 'old-doc' }
    rememberPageRefs('frames-b', [{ id: 'e447', role: 'button', name: '章节', locator }])
    rememberPageSnap('frames-b', { url: 'https://example.com', title: '旧页', snapshot: 'old snapshot', refs: [] })
    const observe = vi.fn(async (_id, result) => result)
    await handleActTools({ ...base(), name: 'browser_click', args: { ref: 'e447' },
      resolveRefLocator: async () => locator,
      clickByLocator: async () => ({ ok: false, requiresRefresh: true, reason: 'invalid', error: '文档已变化' }),
      observeAfterClick: observe })
    expect(locatorFromCache('frames-b', 'e447')).toBeNull()
    expect(cachedPageSnap('frames-b')).toBeNull()
    expect(observe.mock.calls[0][3]).toBeUndefined()
  })
  it('脚本保留快照的精确 frame 和文档身份，优先于模糊提示', async () => {
    const evaluate = vi.fn(async () => ({ paused: false }))
    const result = await handleActTools({ ...base(), name: 'browser_eval',
      args: { script: 'document.title', frame: 'video', frameId: 'video-frame-2', loaderId: 'doc-2' },
      inspectEvalScript: () => null, isSpaceListTopUrl: () => false, evaluate })
    expect(evaluate).toHaveBeenCalledWith('frames-b', 'document.title', { frameId: 'video-frame-2', loaderId: 'doc-2' })
    expect(JSON.parse(result!).ok).toBe(true)
  })

  it('frame 失效后带回新快照的提示，不退回顶层执行或原样重试', async () => {
    const evaluate = vi.fn(async () => { throw new Error('目标 frame 不存在或不唯一，请使用快照中的 frameId') })
    const result = await handleActTools({ ...base(), name: 'browser_eval', args: { script: 'document.title', frame: 'video' },
      inspectEvalScript: () => null, isSpaceListTopUrl: () => false, evaluate,
      listCachedPageRefs: () => [{ locator: { frameId: 'fresh-video', loaderId: 'fresh-doc', frame: 'video' } }] })
    expect(JSON.parse(result!)).toMatchObject({ ok: false, requiresRefresh: true })
    expect(JSON.parse(result!).hint).toContain('frameId 和 loaderId')
    expect(JSON.parse(result!).frames).toEqual([{ frameId: 'fresh-video', loaderId: 'fresh-doc', frame: 'video' }])
    expect(evaluate).toHaveBeenCalledOnce()
  })

  it('拒绝同时指定全帧和精确 frame，避免静默扫描其它视频', async () => {
    const evaluate = vi.fn()
    const result = await handleActTools({ ...base(), name: 'browser_eval',
      args: { script: 'document.title', all: true, frameId: 'video-frame-2' },
      inspectEvalScript: () => null, isSpaceListTopUrl: () => false, evaluate })
    expect(JSON.parse(result!).ok).toBe(false)
    expect(evaluate).not.toHaveBeenCalled()
  })

  it('敏感变量保留 iframe 节点身份，只交给原生安全填写通道', async () => {
    const locator = { by: 'role', value: 'textbox', backend: 123, frameId: 'login-frame', loaderId: 'doc-1' }
    const protocol = vi.fn(async () => ({ ok: true, filled: true }))
    const fill = vi.fn()
    const result = await handleActTools({ ...base(), name: 'browser_type', args: { ref: 'e3', secret_ref: '{{secret:site/zjooc/password}}' },
      resolveRefLocator: async () => locator, callProtocol: protocol, fillByLocator: fill })
    expect(protocol).toHaveBeenCalledWith('frames-b', 'fill_secret', { locator: expect.objectContaining(locator), secret_ref: '{{secret:site/zjooc/password}}' })
    expect(fill).not.toHaveBeenCalled()
    expect(JSON.parse(result!)).toEqual({ ok: true, filled: true })
  })
  it('拒绝将变量当普通文字填写，或与明文混填', async () => {
    const protocol = vi.fn(), fill = vi.fn()
    for (const args of [{ selector: '#pwd', text: '{{secret:site/zjooc/password}}' }, { selector: '#pwd', text: 'literal', secret_ref: '{{secret:site/zjooc/password}}' }]) {
      const result = await handleActTools({ ...base(), name: 'browser_type', args, callProtocol: protocol, fillByLocator: fill })
      expect(JSON.parse(result!).ok).toBe(false)
    }
    expect(protocol).not.toHaveBeenCalled(); expect(fill).not.toHaveBeenCalled()
  })
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
