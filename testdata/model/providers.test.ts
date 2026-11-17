import { describe, expect, it, vi } from 'vitest'
import { createBuiltinProvider } from '../../src/services/model/providers'
import { buildPresetProcessModelJsCode } from '../../src/services/model/protocol'
import type { AIModel } from '../../src/services/model/configTypes'
const model = (apiProtocol: AIModel['apiProtocol']) => ({ id: 'demo', modelId: 'demo', apiProtocol, temperature: 0.2, maxTokens: 200 } as AIModel)
const config = { baseUrl: 'https://provider.test/v1/', apiKey: 'synthetic', maxTokens: 200, temperature: 0.2 }
const input = { stream: false, messages: [{ role: 'system', content: 'rules' }, { role: 'user', content: 'hello' }], tools: [{ type: 'function', function: { name: 'read', parameters: { type: 'object' } } }] }
const payloads = {
  'openai-chat': { choices: [{ message: { content: 'hello', tool_calls: [{ id: 'call', function: { name: 'read', arguments: '{}' } }] } }], usage: { completion_tokens: 2 } },
  'openai-response': { output: [{ type: 'message', content: [{ type: 'output_text', text: 'hello' }] }, { type: 'function_call', call_id: 'call', name: 'read', arguments: '{}' }], usage: { output_tokens: 2 } },
  anthropic: { content: [{ type: 'text', text: 'hello' }, { type: 'tool_use', id: 'call', name: 'read', input: {} }], usage: { output_tokens: 2 } },
}
const collect = async (value: any) => { const out: any[] = []; for await (const chunk of value) out.push(chunk); return out }
const sse = (data: string, split = 11) => new Response(new ReadableStream({ start(controller) {
  const bytes = new TextEncoder().encode(data)
  for (let at = 0; at < bytes.length; at += split) controller.enqueue(bytes.slice(at, at + split))
  controller.close()
} }), { headers: { 'Content-Type': 'text/event-stream' } })
describe('compiled provider contracts', () => {
  it.each(['openai-chat', 'openai-response', 'anthropic'] as const)('%s matches the previous request and normalized output without executing generated JS', async protocol => {
    const fetch = vi.fn(async () => new Response(JSON.stringify(payloads[protocol])))
    const adapter = createBuiltinProvider(model(protocol), { apiProtocol: protocol })!
    const actual = await adapter(input, config, fetch, new AbortController().signal)
    const sent = fetch.mock.calls.map(args => args)
    fetch.mockClear()
    // Only the test evaluates the old implementation to verify wire compatibility.
    const legacy = new Function(buildPresetProcessModelJsCode({ protocol, modelId: 'demo' }) + '; return processModel')()
    const expected = await legacy(input, config, fetch, new AbortController().signal)
    expect(actual).toEqual(expected)
    expect(sent[0][0]).toBe(fetch.mock.calls[0][0])
    const actualBody = JSON.parse(sent[0][1].body as string)
    const oldBody = JSON.parse(fetch.mock.calls[0][1].body as string)
    // Model tuning fields are supplied via config, as in production.
    expect(actualBody).toEqual(oldBody)
  })
  it('reads split UTF-8, CRLF frames, usage and function deltas', async () => {
    const data = [
      { choices: [{ delta: { content: '中文' } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'read', arguments: '{' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] } }] },
      { usage: { completion_tokens: 5 } },
    ].map(payload => 'data: ' + JSON.stringify(payload) + '\r\n\r\n').join('') + 'data: [DONE]\r\n\r\n'
    const adapter = createBuiltinProvider(model('openai-chat'), {})!
    const chunks = await collect(await adapter({ ...input, stream: true }, config, async () => sse(data, 1), new AbortController().signal))
    expect(chunks.map(chunk => chunk.content || '').join('')).toBe('中文')
    expect(chunks[1].tool_calls[0].function.name).toBe('read')
    expect(chunks.at(-1).usage.completion_tokens).toBe(5)
  })
  it('does not report streamed failure or truncated response as successful empty text', async () => {
    const adapter = createBuiltinProvider(model('openai-response'), {})!
    for (const payload of [{ type: 'response.failed', response: { error: { message: 'failed' } } }, { type: 'response.incomplete', response: { incomplete_details: { reason: 'max_tokens' } } }]) {
      await expect(collect(await adapter({ ...input, stream: true }, config, async () => sse('data: ' + JSON.stringify(payload) + '\n\n'), new AbortController().signal))).rejects.toThrow('响应失败')
    }
  })
  it('custom code is explicit; missing custom code uses the built-in Chat adapter', () => {
    expect(createBuiltinProvider({ ...model('custom'), jsCode: 'return 1' }, {})).toBeNull()
    expect(createBuiltinProvider(model('custom'), {})).toBeTypeOf('function')
  })
  it.each(['length', 'content_filter'])('distinguishes %s from other incomplete responses without executing partial tools', async reason => {
    const adapter = createBuiltinProvider(model('openai-chat'), {})!
    const payload = { choices: [{ message: { tool_calls: [{ id: 'partial', function: { name: 'read', arguments: '{' } }] }, finish_reason: reason }] }
    const expected = reason === 'length' ? '200 token，length' : 'content_filter'
    await expect(adapter(input, config, async () => new Response(JSON.stringify(payload)), new AbortController().signal)).rejects.toThrow(expected)
    const streamPayload = { choices: [{ delta: {}, finish_reason: reason }] }
    await expect(collect(await adapter({ ...input, stream: true }, config, async () => sse('data: ' + JSON.stringify(streamPayload) + '\n\n'), new AbortController().signal))).rejects.toThrow(expected)
  })
  it('passes cancellation and HTTP failures through the same adapter path as the Agent', async () => {
    const adapter = createBuiltinProvider(model('anthropic'), {})!
    const abort = new AbortController(); abort.abort()
    await expect(adapter(input, config, async (_, init) => { expect(init.signal).toBe(abort.signal); throw new DOMException('stopped', 'AbortError') }, abort.signal)).rejects.toThrow('stopped')
    await expect(adapter(input, config, async () => new Response('{"error":{"message":"bad key"}}', { status: 401 }), new AbortController().signal)).rejects.toThrow('HTTP 401')
  })
})

it('rejects an apparently clean EOF that lacks the provider completion receipt', async () => {
  const adapter = createBuiltinProvider(model('openai-chat'), {})!
  await expect(collect(await adapter({ ...input, stream: true }, config, async () => sse('data: {"choices":[{"delta":{"content":"partial"}}]}\n\n'), new AbortController().signal))).rejects.toThrow('提前结束')
})
