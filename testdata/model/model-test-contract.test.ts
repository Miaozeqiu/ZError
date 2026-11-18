// @vitest-environment jsdom
import { ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AIModel, AIPlatform } from '../../src/services/model/config'
import { bindModelTest, type ModelTestState } from '../../src/views/settings/ModelSettings/testModel'

const network = vi.hoisted(() => ({ fetch: vi.fn() }))
vi.mock('../../src/services/security/secureFetch', () => ({ secureFetch: network.fetch }))

const model: AIModel = {
  id: 'test',
  displayName: 'Test',
  platformId: 'test-platform',
  apiProtocol: 'openai-chat',
  category: 'text',
  hasVision: false,
  enabled: true,
  maxTokens: 1024,
  temperature: 0.2,
  topP: 1,
}

const create = () => {
  const state: ModelTestState = {
    selectedPlatform: ref<AIPlatform>({
      id: model.platformId,
      name: 'Test',
      displayName: 'Test',
      apiProtocol: 'openai-chat',
      baseUrl: 'https://model.test',
      apiKey: 'synthetic',
      enabled: true,
      models: [model],
    }),
    testingModelId: ref(null),
    testAbortController: ref(null),
    currentTestResult: ref(null),
    currentTestError: ref(''),
    testMetrics: ref(null),
    streamingResponse: ref(''),
    streamingReasoning: ref(''),
    showTestDialog: ref(true),
  }
  return { state, api: bindModelTest(state) }
}

const reply = (message: Record<string, unknown>) => new Response(
  JSON.stringify({ choices: [{ message }] }),
  { headers: { 'Content-Type': 'application/json' } }
)

const getRequestBody = () => JSON.parse(network.fetch.mock.calls[0][1].body)

beforeEach(() => network.fetch.mockReset())
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('automatic model test', () => {
  it('sends a plain text request for a text model', async () => {
    const fetchImage = vi.fn()
    vi.stubGlobal('fetch', fetchImage)
    network.fetch.mockResolvedValueOnce(reply({ content: '你好' }))

    const { state, api } = create()
    await api.testModel(model)

    expect(fetchImage).not.toHaveBeenCalled()
    expect(network.fetch).toHaveBeenCalledTimes(1)
    expect(getRequestBody().messages[0].content).toEqual(expect.any(String))
    expect(getRequestBody()).not.toHaveProperty('tools')
    expect(state.currentTestResult.value).toMatchObject({ success: true, modelType: 'text', response: '你好' })
    expect(state.testMetrics.value?.firstTokenLatency).toBeUndefined()
    expect(state.testMetrics.value?.tokenRate).toBeUndefined()
  })

  it('sends the test image with the question when the model has vision', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      blob: async () => new Blob(['image fixture'], { type: 'image/png' }),
    }))
    network.fetch.mockResolvedValueOnce(reply({ content: '图片答案' }))

    const { state, api } = create()
    await api.testModel({ ...model, hasVision: true })

    expect(network.fetch).toHaveBeenCalledTimes(1)
    expect(getRequestBody().messages[0].content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2UgZml4dHVyZQ==', detail: 'low' } },
      { type: 'text', text: '请解答题目中的问题' },
    ])
    expect(getRequestBody()).not.toHaveProperty('tools')
    expect(state.currentTestResult.value).toMatchObject({ success: true, modelType: 'vision', response: '图片答案' })
  })

  it('does not run or follow up on a tool-only response', async () => {
    network.fetch.mockResolvedValueOnce(reply({
      tool_calls: [{ id: 'call', function: { name: 'encrypt_string', arguments: '{"text":"hello"}' } }],
    }))

    const { state, api } = create()
    await api.testModel(model)

    expect(network.fetch).toHaveBeenCalledTimes(1)
    expect(state.currentTestResult.value).toBeNull()
    expect(state.currentTestError.value).toContain('未返回任何输出内容')
  })

  it('reports timing and throughput before the stream ends, then uses provider metrics', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'performance'] })
    let streamController!: ReadableStreamDefaultController<Uint8Array>
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller },
    })
    const send = (event: Record<string, unknown>) => {
      streamController.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`))
    }
    network.fetch.mockResolvedValueOnce(new Response(stream, { headers: { 'Content-Type': 'text/event-stream' } }))

    const { state, api } = create()
    const running = api.testModel(model)
    await vi.advanceTimersByTimeAsync(500)
    expect(state.testMetrics.value).toMatchObject({ phase: 'waiting', elapsedMs: 500 })

    send({ choices: [{ delta: { reasoning_content: '分析' } }] })
    await vi.advanceTimersByTimeAsync(0)
    expect(state.testMetrics.value).toMatchObject({
      phase: 'streaming', firstTokenLatency: 500, outputTokens: 2, outputTokensEstimated: true,
    })

    await vi.advanceTimersByTimeAsync(500)
    send({ choices: [{ delta: { content: '测试通过' } }], usage: { total_tokens: 100 } })
    await vi.advanceTimersByTimeAsync(250)
    expect(state.currentTestResult.value).toBeNull()
    expect(state.testMetrics.value).toMatchObject({
      firstTokenLatency: 500, outputTokens: 6, tokenRate: 8, tokenRateEstimated: true,
    })

    send({ choices: [], usage: { completion_tokens: 10, tokens_per_second: 12 } })
    send({ choices: [{ finish_reason: 'stop' }] })
    streamController.close()
    await running
    expect(state.currentTestResult.value).toMatchObject({ success: true, response: '测试通过' })
    expect(state.testMetrics.value).toMatchObject({
      elapsedMs: 1250, outputTokens: 10, outputTokensEstimated: false, tokenRate: 12, tokenRateEstimated: false,
    })
    await vi.advanceTimersByTimeAsync(500)
    expect(state.testMetrics.value?.elapsedMs).toBe(1250)
  })
})
