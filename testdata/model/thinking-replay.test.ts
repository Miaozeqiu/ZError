import { beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ fetch: vi.fn(), model: { id: 'thinking-test', modelId: 'thinking-test', apiProtocol: 'anthropic', enableThinking: true } }))
vi.mock('../../src/services/model/config', () => ({
  modelHasVision: () => false,
  modelConfigManager: { getSelectedTextModel: () => api.model, getSelectedAgentModel: () => api.model,
    getSettings: () => ({ platforms: [{ id: 'test', apiProtocol: api.model.apiProtocol, apiKey: 'test-key', baseUrl: 'https://model.test', models: [api.model] }] }) },
}))
vi.mock('../../src/services/security/secureFetch', () => ({ secureFetch: api.fetch }))
vi.mock('../../src/services/security/secureStore', () => ({ redactNative: async (value: unknown) => value }))
vi.mock('../../src/services/app/settings', () => ({ settingsManager: { get: () => 40 } }))
vi.mock('../../src/services/agent/debugLog', () => ({ logAgentDebug: vi.fn() }))
import { runTextModel } from '../../src/services/model/runner'
import { redactReplayMessages } from '../../src/services/model/replayState'

const json = (body: unknown) => ({ ok: true, status: 200, body: null, text: async () => JSON.stringify(body) })
const thinking = (text: string, signature: string) => ({ type: 'thinking', thinking: text, signature })
const tool = { type: 'tool_use', id: 'call-1', name: 'browser_get_page', input: {} }
const content = (text: string) => ({ type: 'text', text })
const request = (at: number) => JSON.parse(api.fetch.mock.calls[at][1].body)
beforeEach(() => { api.fetch.mockReset(); api.model.apiProtocol = 'anthropic' })

describe('actual model runner and protocol thinking replay', () => {
  it('preserves thinking and signatures after tools AND after a plain reply rejected by the completion guard', async () => {
    api.fetch.mockResolvedValueOnce(json({ content: [thinking('opaque-thought-1', 'signature-1'), tool] }))
      .mockResolvedValueOnce(json({ content: [thinking('opaque-thought-2', 'signature-2'), content('先汇报当前进展。')] }))
      .mockResolvedValueOnce(json({ content: [thinking('opaque-thought-3', 'signature-3'), content('完成核对。')] }))
    let stops = 0
    const transcript = vi.fn(), display = vi.fn()
    expect(await runTextModel('完成任务', display, { maxRounds: 4, tools: [{}], executeTool: async () => '页面已读取',
      beforeComplete: () => stops++ === 0 ? '继续核对剩余步骤' : undefined, onTurnTranscript: transcript })).toBe('完成核对。')
    expect(request(1).messages.find((message: any) => message.role === 'assistant').content[0]).toEqual(thinking('opaque-thought-1', 'signature-1'))
    const third = request(2).messages
    const assistants = third.filter((message: any) => message.role === 'assistant')
    expect(assistants[1].content[0]).toEqual(thinking('opaque-thought-2', 'signature-2'))
    expect(third.at(-1).role).toBe('user')
    expect(JSON.stringify(third.at(-1).content)).toContain('宿主任务续接反馈')
    expect(JSON.stringify(display.mock.calls)).not.toMatch(/opaque-thought|signature-/)
    expect(JSON.stringify(transcript.mock.calls)).not.toMatch(/opaque-thought|signature-/)
    expect(JSON.stringify(transcript.mock.calls)).toContain('call-1')
  })
  it('reconstructs streamed thinking/signature deltas and preserves encrypted redacted blocks', async () => {
    const events = [
      { type: 'content_block_start', index: 0, content_block: thinking('', '') },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'part-a' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '-b' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-' } },
      { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'complete' } },
      { type: 'content_block_start', index: 1, content_block: { type: 'redacted_thinking', data: 'opaque-encrypted' } },
      { type: 'content_block_start', index: 2, content_block: tool },
      { type: 'message_stop' },
    ]
    api.fetch.mockResolvedValueOnce(new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } }))
      .mockResolvedValueOnce(json({ content: [thinking('end', 'sig-end'), content('完成。')] }))
    await runTextModel('执行', undefined, { maxRounds: 3, tools: [{}], executeTool: async () => 'ok' })
    expect(request(1).messages.find((message: any) => message.role === 'assistant').content.slice(0, 2)).toEqual([
      thinking('part-a-b', 'sig-complete'), { type: 'redacted_thinking', data: 'opaque-encrypted' },
    ])
  })
  it('passes OpenAI-compatible reasoning_content back on the next tool round', async () => {
    api.model.apiProtocol = 'openai-chat'
    api.fetch.mockResolvedValueOnce(json({ choices: [{ message: { content: '', reasoning_content: 'reasoning-for-tool', tool_calls: [{ id: 'chat-call', function: { name: 'browser_get_page', arguments: '{}' } }] } }] }))
      .mockResolvedValueOnce(json({ choices: [{ message: { content: '完成', reasoning_content: 'final-reasoning' } }] }))
    await runTextModel('执行', undefined, { maxRounds: 3, tools: [{}], executeTool: async () => 'ok' })
    expect(request(1).messages.find((message: any) => message.role === 'assistant').reasoning_content).toBe('reasoning-for-tool')
  })
  it('uses old unsigned tool history as background instead of inventing invalid thinking blocks', async () => {
    api.fetch.mockResolvedValueOnce(json({ content: [thinking('current', 'current-sig'), content('回复')] }))
    await runTextModel('继续核对', undefined, { history: [
      { role: 'assistant', content: '', tool_calls: [{ id: 'old', function: { name: 'browser_get_page', arguments: '{}' } }] },
      { role: 'tool', name: 'browser_get_page', tool_call_id: 'old', content: '旧页面信息' },
    ] })
    expect(request(0).messages.some((message: any) => message.role === 'assistant')).toBe(false)
    expect(JSON.stringify(request(0).messages)).toContain('旧页面信息')
  })
})

describe('sensitive reasoning protocol state', () => {
  it('keeps opaque signatures intact when ordinary string replacement would corrupt them', async () => {
    const messages = [{ role: 'assistant', content: '', thinking_blocks: [thinking('safe text', 'opaque-match')] }]
    const clean = await redactReplayMessages(messages, async items => JSON.parse(JSON.stringify(items).replaceAll('opaque-match', 'replaced')))
    expect(clean[0].thinking_blocks[0].signature).toBe('opaque-match')
  })
  it('does not replay thinking that contains a registered plaintext secret', async () => {
    const messages = [{ role: 'assistant', content: '已登记变量', reasoning_content: 'raw-secret', thinking_blocks: [thinking('raw-secret', 'sig')] }]
    const clean = await redactReplayMessages(messages, async items => JSON.parse(JSON.stringify(items).replaceAll('raw-secret', '{{secret:password}}')))
    expect(clean[0].role).toBe('user')
    expect(JSON.stringify(clean)).not.toContain('raw-secret')
    expect(clean[0].thinking_blocks).toBeUndefined()
  })
})
