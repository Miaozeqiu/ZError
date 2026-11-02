import { beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ fetch: vi.fn(), resolvedModels: [] as any[], model: { id: 'test-model', contextWindow: 8192, maxTokens: 1024, enableThinking: false } }))
vi.mock('../../src/services/model/providers', () => ({ createBuiltinProvider: () => null }))
vi.mock('../../src/services/model/config', () => ({ modelHasVision: () => true, modelConfigManager: {
  ready: Promise.resolve(), getSelectedTextModel: () => api.model, getSelectedAgentModel: () => api.model,
  getSelectedVisionModel: () => api.model,
  getSettings: () => ({ platforms: [{ apiKey: 'test-key', baseUrl: 'https://model.test', models: [api.model] }] }),
} }))
vi.mock('../../src/services/model/protocol', () => ({ resolveRuntimeModelId: () => 'test-model',
  resolveExecutableModelJsCode: model => { api.resolvedModels.push(model); return "async function processModel(input,config,fetch,signal){return fetch('https://model.test',{method:'POST',signal,body:JSON.stringify(input)})}" } }))
vi.mock('../../src/services/security/secureFetch', () => ({ secureFetch: api.fetch }))
vi.mock('../../src/services/agent/debugLog', () => ({ logAgentDebug: vi.fn() }))
vi.mock('../../src/services/app/settings', () => ({ settingsManager: { get: () => 0 } }))
import { runTextModel } from '../../src/services/model/runner'
import { SUMMARY_SYSTEM } from '../../src/services/model/contextSummary'
import { estimateContextTokens, resolveContextBudget } from '../../src/services/model/contextBudget'
beforeEach(() => { api.fetch.mockReset(); api.resolvedModels.length = 0; api.model.contextWindow = 8192; api.model.enableThinking = false })
const tool = (id: string) => ({ status: 200, tool_calls: [{ id, function: { name: 'chapter_step', arguments: JSON.stringify({ id }) } }] })
const assertPairs = (messages: any[]) => {
  const pending = new Set<string>()
  for (const message of messages) {
    if (message.role === 'assistant') for (const call of message.tool_calls || []) { JSON.parse(call.function.arguments); pending.add(call.id) }
    if (message.role === 'tool') { expect(pending.has(message.tool_call_id)).toBe(true); pending.delete(message.tool_call_id) }
  }
  expect(pending.size).toBe(0)
}
describe('context maintenance in the actual model loop', () => {
  it('compacts background replay for thinking models while preserving actual user instructions', async () => {
    api.model.enableThinking = true
    let summaries = 0
    api.fetch.mockImplementation(async (_url, init) => {
      const request = JSON.parse(init.body)
      if (request.messages[0]?.content === SUMMARY_SYSTEM) { summaries++; return { status: 200, content: '旧工具记录已归档，实际用户要求仅保存。' } }
      expect(estimateContextTokens(request)).toBeLessThanOrEqual(resolveContextBudget(api.model).inputLimit)
      expect(request.messages.some((message: any) => message.content === '仅保存，禁止提交')).toBe(true)
      expect(JSON.stringify(request)).not.toContain('__agentHistory')
      return { status: 200, content: '已核对，未提交' }
    })
    const history = [{ role: 'user', content: '仅保存，禁止提交' }, ...Array.from({ length: 8 }, (_, index) => [
      { role: 'assistant', tool_calls: [{ id: 'past-' + index, type: 'function', function: { name: 'read', arguments: '{}' } }] },
      { role: 'tool', name: 'read', tool_call_id: 'past-' + index, content: '历史资料'.repeat(400) },
    ]).flat()]
    expect(await runTextModel('继续核对', undefined, { history, executeTool: vi.fn() })).toBe('已核对，未提交')
    expect(summaries).toBeGreaterThan(0)
    expect(api.resolvedModels[0].enableThinking).toBe(true)
    expect(api.resolvedModels.slice(1).every(model => model.enableThinking === false)).toBe(true)
    expect(api.model.enableThinking).toBe(true)
  })
  it('bounds a large legacy thinking transcript before wrapping its tools as background text', async () => {
    api.model.enableThinking = true
    const history = Array.from({ length: 50 }, (_, index) => [
      { role: 'assistant', tool_calls: [{ id: 'legacy-' + index, type: 'function', function: { name: 'read_data', arguments: '{}' } }] },
      { role: 'tool', name: 'read_data', tool_call_id: 'legacy-' + index, content: '历史资料'.repeat(1250) },
    ]).flat()
    let summaries = 0
    api.fetch.mockImplementation(async (_url, init) => {
      const request = JSON.parse(init.body)
      expect(estimateContextTokens(request)).toBeLessThanOrEqual(resolveContextBudget(api.model).inputLimit)
      if (request.messages[0]?.content === SUMMARY_SYSTEM) { summaries++; return { status: 200, content: '旧数据保留历史引用，需要时再读取。' } }
      return { status: 200, content: '继续处理当前任务' }
    })
    expect(await runTextModel('处理当前任务', undefined, { history, compactBrowserContext: true, executeTool: vi.fn() })).toBe('继续处理当前任务')
    expect(summaries).toBeGreaterThan(0)
    expect(summaries).toBeLessThan(32)
    expect(history.at(-1)!.content).toHaveLength(5000)
  })
  it('runs 24 chapter steps across several compactions without losing user constraints or repeating operations', async () => {
    const requests: any[] = [], archived: any[] = [], events: any[] = [], calls: string[] = []
    const goal = '完成全部24章的视频和测验；提交前核对回执，不能跳过测验。'
    let turn = 0, summaries = 0
    api.fetch.mockImplementation(async (_url, init) => {
      const request = JSON.parse(init.body)
      expect(estimateContextTokens(request)).toBeLessThanOrEqual(resolveContextBudget(api.model).inputLimit)
      if (request.messages[0]?.content === SUMMARY_SYSTEM) {
        summaries++; return { status: 200, content: '【目标】完成视频及测验。【进度】以宿主清单为准；不要重放已执行操作。【失败】无。' }
      }
      requests.push(request)
      expect(request.messages.some((message: any) => message.content === goal)).toBe(true)
      assertPairs(request.messages)
      return turn++ < 24 ? tool('chapter-' + turn) : { status: 200, content: '已完成全部步骤并核对。' }
    })
    const text = await runTextModel(goal, undefined, { maxRounds: 40,
      executeTool: async call => { calls.push(call.id); return JSON.stringify({ ok: true, receipt: call.id, text: '章节资料'.repeat(500) + '尾部核对信息' }) },
      onTurnTranscript: items => archived.push(...items), onEvent: event => events.push(event),
    })
    expect(text).toContain('已完成')
    expect(calls).toHaveLength(24); expect(new Set(calls).size).toBe(24)
    expect(summaries).toBeGreaterThan(1)
    expect(events.filter(event => event.type === 'context_compacted').length).toBeGreaterThan(1)
    expect(archived.filter(item => item.role === 'tool')).toHaveLength(24)
    expect(archived.filter(item => item.role === 'tool').every(item => item.content.endsWith('尾部核对信息"}'))).toBe(true)
    expect(events.filter(event => event.type === 'request')).toHaveLength(requests.length + summaries)
  })
  it('does not send a request that cannot fit, even with no history available to summarise', async () => {
    await expect(runTextModel('题'.repeat(10000), undefined, { executeTool: vi.fn() })).rejects.toThrow('超过模型可用上下文')
    expect(api.fetch).not.toHaveBeenCalled()
  })
  it('leaves history headroom above large pinned instructions and tool definitions', async () => {
    api.model.contextWindow = 65536
    let main = 0
    api.fetch.mockImplementation(async (_url, init) => {
      const request = JSON.parse(init.body)
      expect(request.messages[0]?.content).not.toBe(SUMMARY_SYSTEM)
      expect(estimateContextTokens(request)).toBeLessThanOrEqual(resolveContextBudget(api.model).inputLimit)
      return ++main <= 2 ? tool('step-' + main) : { status: 200, content: '已核对' }
    })
    const execute = vi.fn(async () => '观察'.repeat(500))
    expect(await runTextModel('继续核对', undefined, {
      systemPrompt: '固定规则'.repeat(1250),
      tools: [{ type: 'function', function: { name: 'chapter_step', description: '固定工具说明'.repeat(4167) } }],
      history: [{ role: 'assistant', content: '历史'.repeat(3000) }], executeTool: execute, maxRounds: 3,
    })).toBe('已核对')
    expect(main).toBe(3); expect(execute).toHaveBeenCalledTimes(2)
  })
  it('requires meaningful growth after compaction even when the retained latest batch is large', async () => {
    api.model.contextWindow = 65536
    let main = 0, summaries = 0
    const events: any[] = []
    api.fetch.mockImplementation(async (_url, init) => {
      const request = JSON.parse(init.body)
      expect(estimateContextTokens(request)).toBeLessThanOrEqual(resolveContextBudget(api.model).inputLimit)
      if (request.messages[0]?.content === SUMMARY_SYSTEM) { summaries++; return { status: 200, content: '旧记录已归档，保留当前记录。' } }
      return ++main <= 3 ? tool('step-' + main) : { status: 200, content: '已核对' }
    })
    const execute = vi.fn(async () => '观察'.repeat(500))
    expect(await runTextModel('继续核对', undefined, {
      systemPrompt: '固定规则'.repeat(1250),
      tools: [{ type: 'function', function: { name: 'chapter_step', description: '固定工具说明'.repeat(4167) } }],
      history: [{ role: 'assistant', content: '旧'.repeat(18000) }, { role: 'user', content: '保留用户要求' }, { role: 'assistant', content: '当前观察'.repeat(2500) }],
      executeTool: execute, maxRounds: 4, onEvent: event => events.push(event),
    })).toBe('已核对')
    expect(main).toBe(4); expect(execute).toHaveBeenCalledTimes(3)
    expect(summaries).toBe(3) // All 18k characters enter three bounded archive requests.
    expect(events.filter(event => event.type === 'context_compacted')).toHaveLength(1)
  })
  it.each([6200, 8000])('defers a truncated soft summary only when the intact %i-token record still fits', async size => {
    let summaries = 0, main = 0
    const execute = vi.fn(async () => '{"ok":true}')
    api.fetch.mockImplementation(async (_url, init) => {
      const request = JSON.parse(init.body)
      if (request.messages[0]?.content === SUMMARY_SYSTEM) {
        summaries++; throw Object.assign(new Error('summary output limit'), { name: 'ModelOutputLimitError' })
      }
      expect(estimateContextTokens(request)).toBeLessThanOrEqual(resolveContextBudget(api.model).inputLimit)
      return ++main === 1 ? tool('only-once') : { status: 200, content: '已核对' }
    })
    const history = [{ role: 'assistant', content: '旧'.repeat(size) }, { role: 'user', content: '仍需核对' }, { role: 'assistant', content: '当前记录' }]
    const task = runTextModel('继续', undefined, { history, executeTool: execute, maxRounds: 3 })
    if (size === 6200) {
      expect(await task).toBe('已核对'); expect(main).toBe(2); expect(execute).toHaveBeenCalledOnce()
    } else {
      await expect(task).rejects.toThrow('summary output limit'); expect(main).toBe(0); expect(execute).not.toHaveBeenCalled()
    }
    expect(summaries).toBe(1)
    expect(history[0].content).toHaveLength(size)
  })
  it('recovers once from provider context overflow without replaying an already executed action', async () => {
    const executed = vi.fn(async () => '{"ok":true,"receipt":"已保存"}')
    let main = 0, summary = 0
    api.fetch.mockImplementation(async (_url, init) => {
      const request = JSON.parse(init.body)
      if (request.messages[0]?.content === SUMMARY_SYSTEM) { summary++; return { status: 200, content: 'call-1 已保存，保留回执，不重复保存' } }
      main++
      if (main === 1) return tool('call-1')
      if (main === 2) throw new Error('context_length_exceeded: maximum context length')
      return { status: 200, content: '已核对保存结果' }
    })
    // A completed old batch provides a safe compaction boundary before the latest batch.
    const history = [
      { role: 'assistant', tool_calls: [{ id: 'old', type: 'function', function: { name: 'read', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'old', name: 'read', content: '旧资料'.repeat(100) },
    ]
    expect(await runTextModel('保存并核对', undefined, { history, maxRounds: 5, executeTool: executed })).toContain('已核对')
    expect(executed).toHaveBeenCalledOnce(); expect(summary).toBe(1)
    expect(main).toBe(3)
  })
  it('does not repeatedly compact and retry if the provider still rejects the context', async () => {
    let main = 0
    api.fetch.mockImplementation(async (_url, init) => {
      const request = JSON.parse(init.body)
      if (request.messages[0]?.content === SUMMARY_SYSTEM) return { status: 200, content: '旧资料已归档' }
      main++; throw new Error('context_length_exceeded')
    })
    const history = [
      { role: 'assistant', content: '旧资料'.repeat(500) }, { role: 'user', content: '中间要求' }, { role: 'assistant', content: '保留近况' },
    ]
    await expect(runTextModel('继续核对', undefined, { history, maxRounds: 5, executeTool: vi.fn() })).rejects.toThrow('context_length_exceeded')
    expect(main).toBe(2)
  })
})
