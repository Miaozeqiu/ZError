import { expect, it, vi } from 'vitest'

const upstream = vi.hoisted(() => ({
  fetch: vi.fn(),
  model: { id: 'catalog-model', modelId: 'upstream-model', apiProtocol: 'openai-chat' as const, maxTokens: 4096, maxTokensOverride: 16384 },
  key: '{{secret:platform/query-test}}',
}))

vi.mock('../../src/services/questionServer/deps', () => ({
  settingsApi: { settings: { modelResponseTimeout: 5 } },
  modelApi: { getPlatformApiKey: (platform: { apiKey: string }) => platform.apiKey, platforms: { value: [{
    id: 'test', baseUrl: 'https://model.test/v1', apiKey: upstream.key, apiProtocol: 'openai-chat',
    customHeaders: { 'X-Project': 'question-bank' }, models: [upstream.model],
  }] } },
}))
vi.mock('../../src/services/questionServer/backend', () => ({ sendModelProgressToBackend: vi.fn() }))
vi.mock('../../src/services/security/secureFetch', () => ({ secureFetch: upstream.fetch }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: () => { throw new Error('旧网络通道无法解析密钥引用') } }))

import type { AIModel } from '../../src/services/model/configTypes'
import { callModelWithStreaming } from '../../src/services/questionServer/invoke'

it('uses secure authorization and the catalog output limit for /query even with a legacy override', async () => {
  upstream.fetch.mockImplementation(async (_url, init: RequestInit) => {
    const headers = new Headers(init.headers)
    if (headers.get('authorization') !== `Bearer ${upstream.key}`) return new Response('API Key 无效', { status: 401 })
    expect(headers.get('x-project')).toBe('question-bank')
    expect(JSON.parse(String(init.body)).max_tokens).toBe(4096)
    return Response.json({ choices: [{ message: { content: '题库回答' }, finish_reason: 'stop' }] })
  })

  await expect(callModelWithStreaming(upstream.model as AIModel, '测试题', 'query-test')).resolves.toBe('题库回答')
  expect(upstream.fetch).toHaveBeenCalledOnce()
  expect(upstream.fetch.mock.calls[0][0]).toBe('https://model.test/v1/chat/completions')
})
