import { afterEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ fetch: vi.fn(), model: { id: 'review-model' } }))
vi.mock('../../src/services/model/config', () => ({
  modelConfigManager: {
    getSelectedTextModel: () => mock.model, getSelectedAgentModel: () => mock.model,
    getSettings: () => ({ platforms: [{ apiKey: 'test-key', baseUrl: 'https://model.test', models: [mock.model] }] }),
  }, modelHasVision: () => false,
}))
vi.mock('../../src/services/model/protocol', () => ({
  resolveRuntimeModelId: () => 'review-model',
  resolveExecutableModelJsCode: () => "async function processModel(input, config, fetch, abortSignal) { return fetch('https://model.test', {signal:abortSignal, body:JSON.stringify(input)}); }",
}))
vi.mock('../../src/services/app/settings', () => ({ settingsManager: { get: () => 0 } }))
vi.mock('../../src/services/agent/debugLog', () => ({ logAgentDebug: vi.fn() }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: mock.fetch }))
import { runTextModel } from '../../src/services/model/runner'
import { createLearningCompletionCheck } from '../../src/services/agent/siteLearningReview'

describe('真实模型 runner 的经验收尾检查', () => {
  afterEach(() => mock.fetch.mockReset())
  it('直接口头结束时触发生产检查，最多补两轮并保留原始回答', async () => {
    const steps = ['browser_navigate', 'browser_click'].map((name, index) => ({ id: String(index), name, status: 'done' }))
    const check = createLearningCompletionCheck(() => ({ url: 'https://zjooc.cn/work', steps, enabled: true }))
    mock.fetch.mockResolvedValue({ status: 200, content: '网页任务已完成' })
    const text = await runTextModel('完成任务', undefined, { maxRounds: 8, beforeComplete: check.beforeComplete })
    expect(text).toBe('网页任务已完成')
    expect(mock.fetch).toHaveBeenCalledTimes(3)
    const lastInput = JSON.parse(mock.fetch.mock.calls[2][1].body)
    expect(lastInput.messages.some((message: any) => message.role === 'system' && message.content.includes('sites/zjooc.cn/SKILL.md'))).toBe(true)
    expect(check.deferred).toBe(true)
  })
  it('普通聊天一次完成，不额外请求模型', async () => {
    const check = createLearningCompletionCheck(() => ({ url: '', steps: [], enabled: true }))
    mock.fetch.mockResolvedValue({ status: 200, content: '你好' })
    expect(await runTextModel('你好', undefined, { maxRounds: 8, beforeComplete: check.beforeComplete })).toBe('你好')
    expect(mock.fetch).toHaveBeenCalledOnce()
  })
  it('最后一轮预算耗尽时如实标记暂未检查，不产生超预算请求', async () => {
    const steps = ['browser_navigate', 'browser_click'].map((name, index) => ({ id: String(index), name, status: 'done' }))
    const check = createLearningCompletionCheck(() => ({ url: 'https://zjooc.cn/work', steps, enabled: true }))
    mock.fetch.mockResolvedValue({ status: 200, content: '网页任务已完成' })
    await runTextModel('完成任务', undefined, { maxRounds: 1, beforeComplete: check.beforeComplete })
    expect(mock.fetch).toHaveBeenCalledOnce()
    expect(check.deferred).toBe(true)
  })
})
