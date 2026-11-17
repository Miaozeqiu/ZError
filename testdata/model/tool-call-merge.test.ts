import { describe, expect, it } from 'vitest'
import { mergeToolCalls } from '../../src/services/model/toolCallMerge'

const feed = (parts: string[], mode: 'delta' | 'snapshot') => {
  const calls: Array<{ function: { arguments: string } }> = []
  for (const part of parts) {
    mergeToolCalls(calls, [{
      id: 'c1',
      index: 0,
      function: { name: 'browser_eval', arguments: part },
    }], mode)
  }
  return calls[0]?.function.arguments || ''
}

describe('流式工具参数', () => {
  it('delta 分片里单独的 { 会接上，不丢', () => {
    const full = '{"script": "(function(){var a=1;})()"}'
    const parts = ['{"script": "(function()', '{', 'var a=1;', '}', ')()"}']
    expect(feed(parts, 'delta')).toBe(full)
  })

  it('嵌套 items 的 { 也不会丢', () => {
    const full = '{"action":"set","items":[{"label":"a","kind":"video"}]}'
    const parts = ['{"action":"set","items":[', '{', '"label":"a","kind":"video"}]}']
    expect(feed(parts, 'delta')).toBe(full)
  })

  it('连续两个 { 都留下', () => {
    expect(feed(['{', '{'], 'delta')).toBe('{{')
  })

  it('占位 {} 换成后面的增量', () => {
    expect(feed(['{}', '{"a":1}'], 'delta')).toBe('{"a":1}')
  })

  it('snapshot 用更长的累计全文', () => {
    expect(feed(['{"a":1}', '{"a":1,"b":2}'], 'snapshot')).toBe('{"a":1,"b":2}')
  })
})
