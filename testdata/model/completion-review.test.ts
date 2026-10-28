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
vi.mock('../../src/services/security/secureFetch', () => ({ secureFetch: mock.fetch }))
import { runTextModel } from '../../src/services/model/runner'
import { createLearningCompletionCheck } from '../../src/services/agent/siteLearningReview'
import { createTaskCompletionCheck } from '../../src/services/agent/taskCompletion'

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
    expect(lastInput.messages.some((message: any) => message.role === 'user' && message.content.includes('sites/zjooc.cn/SKILL.md'))).toBe(true)
    expect(check.deferred).toBe(true)
  })
  it('普通聊天一次完成，不额外请求模型', async () => {
    const check = createLearningCompletionCheck(() => ({ url: '', steps: [], enabled: true }))
    mock.fetch.mockResolvedValue({ status: 200, content: '你好' })
    expect(await runTextModel('你好', undefined, { maxRounds: 8, beforeComplete: check.beforeComplete })).toBe('你好')
    expect(mock.fetch).toHaveBeenCalledOnce()
  })
  it('通用请求超时不假定用户在识别题目', async () => {
    const error = new Error('request timed out'); error.name = 'TimeoutError'
    mock.fetch.mockRejectedValue(error)
    await expect(runTextModel('整理这份文件')).rejects.toThrow('本次响应未完成')
    expect(mock.fetch).toHaveBeenCalledOnce()
  })
  it('文件工具重复查询时提示利用已有结果，不注入播放下一节或禁止询问用户的指令', async () => {
    const call = (id: string) => ({ tool_calls: [{ id, function: { name: 'get_file_info', arguments: '{}' } }] })
    mock.fetch.mockResolvedValueOnce(call('first')).mockResolvedValueOnce(call('again')).mockResolvedValueOnce({ content: '已根据文件信息完成整理。' })
    await runTextModel('整理这份文件', undefined, { maxRounds: 4, tools: [{}], executeTool: async () => '文件共有 10 行' })
    const messages = JSON.parse(mock.fetch.mock.calls[2][1].body).messages
    const hint = messages.find((message: any) => message.role === 'system' && message.content.includes('相同的只读查询'))?.content
    expect(hint).toBeTruthy()
    expect(hint).not.toMatch(/播放|下一节|不要停下来问用户/)
  })
  it('最后一轮预算耗尽时如实标记暂未检查，不产生超预算请求', async () => {
    const steps = ['browser_navigate', 'browser_click'].map((name, index) => ({ id: String(index), name, status: 'done' }))
    const check = createLearningCompletionCheck(() => ({ url: 'https://zjooc.cn/work', steps, enabled: true }))
    mock.fetch.mockResolvedValue({ status: 200, content: '网页任务已完成' })
    await runTextModel('完成任务', undefined, { maxRounds: 1, beforeComplete: check.beforeComplete })
    expect(mock.fetch).toHaveBeenCalledOnce()
    expect(check.deferred).toBe(true)
  })
  it('任务未完成而模型轮次耗尽时抛出未完成状态，不接受普通文字作为成功结果', async () => {
    const todos = [{ id: 'pending', text: '核对最终结果', status: 'pending' as const }]
    const check = createTaskCompletionCheck(() => ({ todos, steps: [] }))
    mock.fetch.mockResolvedValue({ content: '之后再继续。' })
    await expect(runTextModel('完成任务', undefined, { maxRounds: 1, beforeComplete: check.beforeComplete }))
      .rejects.toThrow(/任务尚未完成.*次数上限/)
    expect(mock.fetch).toHaveBeenCalledOnce()
    expect(todos[0].status).toBe('pending')
    expect(check.outcome).toBe('incomplete')
  })
})
