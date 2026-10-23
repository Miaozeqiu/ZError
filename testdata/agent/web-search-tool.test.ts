import { describe, expect, it } from 'vitest'
import { CHAT_TOOLS } from '../../src/services/agent/tools'
import { searchToolHandlers } from '../../src/services/agent/toolHandlers/search'

describe('普通 Agent 联网搜索工具', () => {
  it('加入普通对话工具表', () => {
    const tool = CHAT_TOOLS.find((item) => item.function.name === 'web_search')
    expect(tool?.function.parameters.required).toEqual(['query'])
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
