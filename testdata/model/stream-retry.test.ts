import { beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ fetch: vi.fn(), model: { id: 'stream-test', maxTokens: 4096, enableThinking: false } }))
vi.mock('../../src/services/model/providers', () => ({ createBuiltinProvider: () => null }))
vi.mock('../../src/services/model/config', () => ({ modelHasVision: () => true, modelConfigManager: {
  ready: Promise.resolve(), getSelectedTextModel: () => api.model, getSelectedAgentModel: () => api.model,
  getSettings: () => ({ platforms: [{ apiKey: 'synthetic', baseUrl: 'https://model.test', models: [api.model] }] }),
} }))
vi.mock('../../src/services/model/protocol', () => ({ resolveRuntimeModelId: () => 'stream-test',
  resolveExecutableModelJsCode: () => "async function processModel(input,config,fetch,signal){const result=await fetch('https://model.test',{method:'POST',signal,body:JSON.stringify(input)});if(result.bodyError)throw new Error('NetworkError: 读取服务响应失败');return result}" }))
vi.mock('../../src/services/security/secureFetch', () => ({ secureFetch: api.fetch }))
vi.mock('../../src/services/agent/debugLog', () => ({ logAgentDebug: vi.fn() }))
vi.mock('../../src/services/app/settings', () => ({ settingsManager: { get: () => 0 } }))
import { runTextModel } from '../../src/services/model/runner'
beforeEach(() => { api.fetch.mockReset() })
const network = () => new Error('NetworkError: 读取服务响应失败')

it('retries only the interrupted response, discarding partial calls and keeping a prior dispatched click exactly once', async () => {
  const requests: any[] = [], events: any[] = []
  const execute = vi.fn(async () => '{"ok":true,"receipt":"selected"}')
  api.fetch.mockImplementation(async (_url, init) => {
    requests.push(JSON.parse(init.body))
    if (requests.length === 1) return { tool_calls: [{ id: 'click-once', function: { name: 'click', arguments: '{}' } }] }
    if (requests.length === 2) return (async function* () {
      yield { content: ' \n' }
      yield { reasoning_content: '检查当前回执' }
      yield { tool_calls: [{ index: 0, id: 'never-dispatch', function: { name: 'click', arguments: '{' } }] }
      throw network()
    })()
    return { content: '已核对，未重复点击' }
  })
  expect(await runTextModel('核对选择', undefined, { executeTool: execute, maxRounds: 2, onEvent: event => events.push(event) })).toContain('未重复点击')
  expect(execute).toHaveBeenCalledOnce()
  expect(execute.mock.calls[0][0].id).toBe('click-once')
  expect(requests[2]).toEqual(requests[1])
  expect(events.filter(event => event.type === 'request')).toHaveLength(3)
  expect(events.filter(event => event.type === 'usage').length).toBe(3)
})

it.each(['visible', 'incomplete', 'cancelled'])('does not retry a %s response', async kind => {
  const abort = new AbortController()
  api.fetch.mockResolvedValue((async function* () {
    if (kind === 'visible') yield { content: '已显示的部分回答' }
    if (kind === 'cancelled') abort.abort()
    throw kind === 'incomplete' ? new Error('模型流式连接提前结束，未收到完整结束回执。') : network()
  })())
  await expect(runTextModel('读取', undefined, { signal: abort.signal })).rejects.toThrow()
  expect(api.fetch).toHaveBeenCalledOnce()
})

it('bounds repeated stream failures to two retries and accounts for partial output', async () => {
  const events: any[] = []
  api.fetch.mockImplementation(async () => (async function* () { yield { reasoning_content: '部分输出' }; throw network() })())
  await expect(runTextModel('读取', undefined, { onEvent: event => events.push(event) })).rejects.toThrow('NetworkError')
  expect(api.fetch).toHaveBeenCalledTimes(3)
  expect(events.filter(event => event.type === 'usage')).toHaveLength(3)
  expect(events.filter(event => event.type === 'usage').every(event => event.outputTokens > 0)).toBe(true)
})

it('recovers a body-read error before the provider exposes an iterable', async () => {
  api.fetch.mockResolvedValueOnce({ bodyError: true }).mockResolvedValueOnce({ content: '已恢复' })
  expect(await runTextModel('读取')).toBe('已恢复')
  expect(api.fetch).toHaveBeenCalledTimes(2)
})

it('shares the two-retry allowance between provider body reads and stream reads', async () => {
  api.fetch.mockResolvedValueOnce({ bodyError: true })
    .mockResolvedValueOnce((async function* () { yield { reasoning_content: '片段' }; throw network() })())
    .mockResolvedValueOnce({ bodyError: true })
  await expect(runTextModel('读取')).rejects.toThrow('NetworkError')
  expect(api.fetch).toHaveBeenCalledTimes(3)
})
