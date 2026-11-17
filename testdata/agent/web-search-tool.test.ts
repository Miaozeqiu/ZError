import { describe, expect, it } from 'vitest'
import { assembleBrowserTools, availableAgentTools, CHAT_TOOLS } from '../../src/services/agent/tools'
import { searchToolHandlers } from '../../src/services/agent/toolHandlers/search'

describe('普通 Agent 联网搜索工具', () => {
  it('关闭搜索时普通和浏览器会话都不提供搜索工具，重新启用后恢复', () => {
    for (const tools of [CHAT_TOOLS, assembleBrowserTools({ role: 'parent' })]) {
      expect(availableAgentTools(tools, { enabled: false }).some(t => t.function.name === 'web_search')).toBe(false)
      expect(availableAgentTools(tools, { enabled: true }).some(t => t.function.name === 'web_search')).toBe(true)
    }
  })
  it('加入普通对话工具表', () => {
    const tool = CHAT_TOOLS.find((item) => item.function.name === 'web_search')
    expect(tool?.function.parameters.required).toEqual(['query'])
  })

  it('浏览器主 Agent 也能看到搜索工具', () => {
    expect(assembleBrowserTools({ role: 'parent', url: 'https://exa.ai' })
      .some((tool) => tool.function.name === 'web_search')).toBe(true)
  })

  it('空关键词不发起搜索', async () => {
    const result = await searchToolHandlers.web_search({
      call: { id: 'test', name: 'web_search', arguments: '{}' },
      args: {},
      ctx: { abort: new AbortController().signal } as any,
    })
    expect(JSON.parse(result)).toEqual({ error: '搜索关键词不能为空' })
  })
})
