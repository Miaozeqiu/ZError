import { describe, expect, it } from 'vitest'
import { compactAgentRequestMessages, estimateRequestTextTokens } from '../../src/services/model/agentRequestContext'

const page = (index: number) => ({ role: 'tool', name: 'browser_click', tool_call_id: `c${index}`, content: JSON.stringify({ ok: true, url: `https://example.test/${index}`, snapshot: `current ref=e${index}`, refs: [{ id: `e${index}`, locator: { secretInternal: true } }], frames: [{ id: 'frame1', url: 'https://example.test/child', snapshot: 'duplicate', refs: ['duplicate'] }], preferredFrame: { id: 'frame1', snapshot: 'duplicate' } }) })

describe('browser request context', () => {
  it('keeps recent snapshots, frame identity and all tool pairs while removing duplicate indexes', () => {
    const messages = Array.from({ length: 6 }, (_, index) => page(index))
    const original = JSON.stringify(messages)
    const next = compactAgentRequestMessages(messages)
    expect(next.map(item => item.tool_call_id)).toEqual(messages.map(item => item.tool_call_id))
    expect(JSON.parse(next[0].content)).toMatchObject({ ok: true, url: 'https://example.test/0', history: expect.any(String) })
    expect(JSON.parse(next[0].content).snapshot).toBeUndefined()
    const latest = JSON.parse(next[5].content)
    expect(latest.snapshot).toBe('current ref=e5')
    expect(latest.refs).toBeUndefined()
    expect(latest.frames).toEqual([{ id: 'frame1', url: 'https://example.test/child' }])
    expect(latest.preferredFrame).toEqual({ id: 'frame1' })
    expect(JSON.stringify(messages)).toBe(original)
  })

  it('replaces only old tool image batches and preserves genuine user images and the latest captcha batch', () => {
    const user = { role: 'user', content: [{ type: 'image_url', image_url: { url: 'original' } }] }
    const old = { role: 'user', content: [{ type: 'image_url', image_url: { url: 'old screenshot' } }] }
    const latest = { role: 'user', content: [{ type: 'image_url', image_url: { url: 'captcha' } }, { type: 'image_url', image_url: { url: 'page' } }] }
    const next = compactAgentRequestMessages([user, old, latest], new Set([old, latest]))
    expect(next[0]).toBe(user)
    expect(typeof next[1].content).toBe('string')
    expect(next[2]).toBe(latest)
    expect(Array.isArray(old.content)).toBe(true)
  })

  it('preserves errors, recent question content and user goals', () => {
    const messages = [
      { role: 'user', content: '完整用户目标' },
      ...Array.from({ length: 6 }, (_, index) => page(index)),
      { role: 'tool', name: 'browser_eval', content: JSON.stringify({ questions: ['题目内容'.repeat(800)] }), tool_call_id: 'q' },
    ]
    const next = compactAgentRequestMessages(messages)
    expect(next[0]).toEqual(messages[0])
    expect(next.at(-1)).toEqual(messages.at(-1))
    const errorPage = page(0)
    errorPage.content = JSON.stringify({ ok: false, error: '未找到目标', reason: 'hidden' })
    expect(JSON.parse(compactAgentRequestMessages([errorPage, ...messages])[0].content)).toMatchObject({ error: '未找到目标', reason: 'hidden' })
  })

  it('shrinks accumulated tool text before each request without dropping tool call ids', () => {
    const messages = Array.from({ length: 70 }, (_, index) => ({ ...page(index), content: JSON.stringify({ snapshot: '长页面内容'.repeat(2000), ok: true }) }))
    const before = JSON.stringify(messages)
    const next = compactAgentRequestMessages(messages)
    expect(JSON.stringify(next).length).toBeLessThan(before.length * .1)
    expect(next).toHaveLength(messages.length)
    expect(next[69].tool_call_id).toBe('c69')
    expect(estimateRequestTextTokens('中文abcd')).toBe(3)
  })
})
