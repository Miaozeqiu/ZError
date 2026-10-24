// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
const mock = vi.hoisted(() => ({ fetch: vi.fn(), model: { id: 'test-model' } }))
vi.mock('../../src/services/model/config', () => ({
  modelConfigManager: {
    getSelectedTextModel: () => mock.model, getSelectedAgentModel: () => mock.model,
    getSettings: () => ({ platforms: [{ apiKey: 'test-key', baseUrl: 'https://model.test', models: [mock.model] }] }),
  }, modelHasVision: () => false,
}))
vi.mock('../../src/services/model/protocol', () => ({
  resolveRuntimeModelId: () => 'test-model',
  resolveExecutableModelJsCode: () => "async function processModel(input, config, fetch, abortSignal) { return fetch('https://model.test', {signal:abortSignal}); }",
}))
vi.mock('../../src/services/app/settings', () => ({ settingsManager: { get: () => 0 } }))
vi.mock('../../src/services/agent/debugLog', () => ({ logAgentDebug: vi.fn() }))
vi.mock('@tauri-apps/plugin-http', () => ({ fetch: mock.fetch }))
vi.mock('../../src/services/browser/appBrowser', () => ({ readBrowserPage: vi.fn() }))
import { runTextModel } from '../../src/services/model/runner'
import { applyBrowserControl, browserControlState } from '../../src/services/browser/control'
import { createBrowserControlGate } from '../../src/services/agent/browserControlGate'

describe('浏览器人工接管的模型等待预算', () => {
  afterEach(() => {
    vi.useRealTimers(); mock.fetch.mockReset()
    for (const key of Object.keys(browserControlState)) delete browserControlState[key]
  })
  it('用户接管浏览器时真实 runner 仍然请求模型并返回普通回复', async () => {
    applyBrowserControl({ sessionId: 'chat', owner: 'user', epoch: 1 })
    const gate = createBrowserControlGate('chat', new AbortController().signal)
    const read = vi.fn()
    mock.fetch.mockResolvedValue({ status: 200, content: '连接正常' })
    expect(await runTextModel('连接测试', undefined, {
      liveContext: () => gate.liveContext(read),
    })).toBe('连接正常')
    expect(mock.fetch).toHaveBeenCalledOnce()
    expect(read).not.toHaveBeenCalled()
  })
  it('长时间人工操作不触发模型响应超时，交还后正常请求并解除订阅', async () => {
    vi.useFakeTimers()
    mock.fetch.mockResolvedValue({ status: 200, content: '继续完成任务' })
    let pause!: (paused: boolean) => void
    let finishContext!: (value: string) => void
    const off = vi.fn()
    const run = runTextModel('继续', undefined, {
      timeoutMs: 5000,
      liveContext: () => new Promise<string>(resolve => { finishContext = resolve }),
      subscribePause: callback => { pause = callback; callback(true); return off },
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(pause).toBeTypeOf('function')
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000)
    expect(mock.fetch).not.toHaveBeenCalled()
    pause(false)
    finishContext('新页面状态')
    expect(await run).toBe('继续完成任务')
    expect(mock.fetch.mock.calls[0][1].signal.aborted).toBe(false)
    expect(off).toHaveBeenCalledOnce()
  })
})
