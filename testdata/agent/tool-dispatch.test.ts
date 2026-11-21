import { siteNavigationFor } from '../../src/services/browser/siteCapabilities'
import { describe, expect, it, vi } from 'vitest'
import { BROWSER_PRIMITIVE_TOOLS } from '../../src/services/agent/toolDefs/browserPrimitiveTools'
import { dispatchBrowserTool } from '../../src/services/agent/browserTools'

/** 这些名字在 executeChatTool 里分发，不进四个浏览器处理器。 */
const handledOutside = new Set([
  'browser_site_graph',
  'browser_workflows',
  'browser_todo',
  'browser_task',
  'read_agent_skill',
  'read_agent_skill_file',
  'list_agent_skills',
  'write_agent_skill_file',
  'reset_agent_skill_file',
])

const mockCtx = (name: string) => {
  const base: Record<string, unknown> = {
    name,
    navigation: siteNavigationFor('https://example.com'),
    args: name === 'browser_wait' ? { until: 'idle', seconds: 1 } : {},
    browserId: 'b1',
    sessionId: 's1',
    role: 'parent',
    policy: { permissionMode: 'ask' },
    loop: { url: 'https://example.com/page', evalPolicy: 'read', recipe: '' },
    wait: async () => {},
    getBrowserState: async () => ({ url: 'https://example.com/page', title: '例' }),
    listAppBrowsers: () => [],
    graphUrlOf: async (_id: string, url: string) => url,
    graphNodeId: () => '',
    isShellNode: () => false,
    notePageProbe: () => 0,
    readBrowserPage: async () => ({
      url: 'https://example.com/page',
      snapshot: '- button "打开" [ref=e1]',
      refs: [{ id: 'e1' }],
    }),
    currentUrl: async () => 'https://example.com/page',
    liveHref: async () => 'https://example.com/page',
    peekAppBrowserUrl: () => 'https://example.com/page',
    emptyPageSnaps: new Map(),
    SPACE_HINT: '空间',
    COURSE_HW_HINT: '',
    siteGraphNodeForUrl: () => null,
    browserTaskIntent: () => '',
    pageHostOf: () => 'example.com',
    pageHostMatches: () => true,
  }
  return new Proxy(base, {
    get(target, key, receiver) {
      if (typeof key === 'string' && !(key in target)) {
        return async () => ({ ok: true, url: 'https://example.com/page', snapshot: '', refs: [] })
      }
      return Reflect.get(target, key, receiver)
    },
  })
}


describe('浏览器工具都能分发', () => {
  it('导航交给浏览器后立即通知工作区，失败时不通知', async () => {
    const url = 'https://example.com/next'
    const navigate = vi.fn().mockResolvedValue(undefined)
    const onNavigation = vi.fn()
    const ctx = Object.assign(mockCtx('browser_navigate'), {
      args: { url },
      resolveChaoxingLoginUrl: (target: string) => target,
      navigateBrowserView: navigate,
      evalBrowserView: async () => url,
      onNavigation,
      wait: async () => { expect(onNavigation).toHaveBeenCalledOnce() },
    })
    expect(JSON.parse(await dispatchBrowserTool(ctx))).toMatchObject({ ok: true, url })
    expect(navigate).toHaveBeenCalledWith('b1', url)
    expect(onNavigation).toHaveBeenCalledOnce()

    onNavigation.mockClear()
    navigate.mockRejectedValueOnce(new Error('无法打开网页'))
    await expect(dispatchBrowserTool(ctx)).rejects.toThrow('无法打开网页')
    expect(onNavigation).not.toHaveBeenCalled()
  })

  it('注册过的 browser_* 不会回未知工具', async () => {
    const names = [...BROWSER_PRIMITIVE_TOOLS.map((tool) => tool.function.name)]
      .filter((name) => name.startsWith('browser_') && !handledOutside.has(name))
    const unknown: string[] = []
    for (const name of names) {
      try {
        const raw = await dispatchBrowserTool(mockCtx(name))
        if (raw.includes('未知浏览器工具')) unknown.push(name)
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        if (message.includes('未知浏览器工具')) unknown.push(name)
      }
    }
    expect(unknown).toEqual([])
    expect(names).toContain('browser_get_state')
  })
})
