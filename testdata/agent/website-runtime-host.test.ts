import { describe, expect, it, vi } from 'vitest'
import { createHostToolRunner } from '../../src/services/agent/hostToolRunner'
import { createRunController } from '../../src/services/agent/core/controller'
import { DEFAULT_RUN_LIMITS, newRun, type RunCheckpoint } from '../../src/services/agent/core/run'
import { WEBSITE_HOST_TOOLS } from '../../src/services/agent/websiteRuntime/hostTools'
import { executeWebsitePackage, type WebsiteHost } from '../../src/services/agent/websiteRuntime/execute'
import { runtimeBinding, runtimeFixture } from './fixtures/websiteRuntime'

const primitive = { type: 'function' as const, function: { name: 'browser_click', parameters: {
  type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'], additionalProperties: false,
} } }
const makeRuntime = () => {
  const runtime = runtimeFixture("var ZErrorSitePackage = { *create() { yield {op:'browser.click',args:{ref:'e1'}}; return {title:'完成一步'}; } };")
  runtime.tools[0].commands = ['browser.click']
  return runtime
}

describe('网站包经过正式宿主操作路径', () => {
  it('原生查询回执直接建立观察，服务分页不能冒充页面观察', async () => {
    let state = newRun('native-observation')
    const controller = createRunController({ run: state, changed: value => { state = value }, checkpoint: async () => {}, browserId: () => 'tab', signal: new AbortController().signal })
    try {
      const read = async (id: string, action: string) => JSON.parse(await controller.execute({ id, name: 'browser_package_read', arguments: JSON.stringify({ action }) }, async () => '{"ok":true,"nodes":[{"text":"网页数据"}]}'))
      expect(await read('service', 'service')).not.toHaveProperty('observation_id')
      expect(await read('query', 'query')).toMatchObject({ observation_id: 'query', observed_browser_id: 'tab' })
      expect(state.observation?.id).toBe('query')
      expect(await read('media', 'media_read')).toMatchObject({ observation_id: 'media' })
    } finally { controller.dispose() }
  })
  it('内部读题不写入模型历史或界面步骤，预算只计算外层工具，内部写入仍有独立审计编号', async () => {
    let state = newRun('bounded-paper')
    const checkpoint = vi.fn(async () => undefined)
    const controller = createRunController({ run: state, changed: value => { state = value }, checkpoint,
      limits: { ...DEFAULT_RUN_LIMITS, tools: 1 }, browserId: () => 'tab', signal: new AbortController().signal })
    const onEvent = vi.fn(), onTurnTranscript = vi.fn()
    const effect = vi.fn(async () => JSON.stringify({ ok: true, content: '内部整卷数据'.repeat(1000) }))
    const invoke = createHostToolRunner({ tools: WEBSITE_HOST_TOOLS, onEvent, onTurnTranscript,
      executeTool: call => controller.execute(call, effect) }, 'private-host')
    try {
      const result = await controller.execute({ id: 'answer', name: 'browser_site_academy__auto_answer', arguments: '{}' }, async () => {
        for (let index = 0; index < 8; index++) await invoke('browser_package_read', { host: 'academy.example', action: 'service' })
        for (let index = 0; index < 2; index++) await invoke('browser_package_act', { host: 'academy.example', action: 'click' })
        return JSON.stringify({ ok: true, result: { items: [{ status: 'verified' }] } })
      })
      expect(result).not.toContain('内部整卷数据')
      expect(onEvent).not.toHaveBeenCalled(); expect(onTurnTranscript).not.toHaveBeenCalled()
      expect(effect).toHaveBeenCalledTimes(10)
      expect(state.usage).toMatchObject({ tools: 1, hostCommands: 10 })
      expect(state.operations).toHaveLength(2)
      expect(new Set(state.operations.map(op => op.id)).size).toBe(2)
      expect(state.operations.every(op => op.state === 'dispatched')).toBe(true)
      expect(checkpoint).toHaveBeenCalledTimes(4)
      await expect(controller.execute({ id: 'over', name: 'browser_get_page', arguments: '{}' }, effect)).rejects.toThrow('执行预算')
    } finally { controller.dispose() }
  })
  it('内部命令仍执行原生副作用前检查，写入检查点失败不会点击', async () => {
    const effect = vi.fn(async () => '{"ok":true}')
    const controller = createRunController({ run: newRun('private-guard'), changed: () => undefined,
      checkpoint: async () => { throw new Error('checkpoint unavailable') }, browserId: () => 'tab', signal: new AbortController().signal })
    const invoke = createHostToolRunner({ tools: WEBSITE_HOST_TOOLS, executeTool: call => controller.execute(call, effect) }, 'private-guard')
    try {
      await expect(invoke('browser_package_act', { host: 'academy.example', action: 'click' })).rejects.toThrow('checkpoint unavailable')
      expect(effect).not.toHaveBeenCalled()
    } finally { controller.dispose() }
  })
  it('命令使用实时目录并在副作用发生前保存操作记录；包返回不等于任务完成', async () => {
    let state: RunCheckpoint = newRun('package-run')
    const checkpoint = vi.fn(async () => undefined)
    const controller = createRunController({ run: state, changed: value => { state = value }, checkpoint,
      browserId: () => 'tab', signal: new AbortController().signal })
    controller.state('running')
    const events: unknown[] = [], transcripts: unknown[] = []
    const effect = vi.fn(async () => {
      expect(checkpoint).toHaveBeenCalledOnce()
      expect(state.operations).toMatchObject([{ tool: 'browser_click', state: 'pending', browserId: 'tab' }])
      return JSON.stringify({ ok: true })
    })
    const invoke = createHostToolRunner({ tools: [], liveTools: async () => [primitive],
      executeTool: call => controller.execute(call, effect),
      onEvent: event => { events.push(event) }, onTurnTranscript: items => { transcripts.push(...items) },
    }, 'turn')
    const io: WebsiteHost = { signal: new AbortController().signal, browserId: 'tab', readOnly: () => false, isActive: () => true,
      currentUrl: async () => 'https://academy.example/', invoke, delay: async () => undefined, waitForPage: async () => ({}) }
    try {
      await expect(controller.execute({ id: 'outer', name: 'browser_site_academy__read_catalog', arguments: '{}' }, async () =>
        JSON.stringify(await executeWebsitePackage(runtimeBinding(makeRuntime()), {}, io)))).resolves.toContain('完成一步')
      expect(effect).toHaveBeenCalledOnce()
      expect(events).toMatchObject([{ type: 'tool_start', name: 'browser_click' }, { type: 'tool_end', name: 'browser_click' }])
      expect(transcripts).toHaveLength(2)
      expect(state.status).toBe('running')
      expect(state.operations[0]).toMatchObject({ tool: 'browser_click', state: 'dispatched' })
    } finally { controller.dispose() }
  })

  it('不确定操作阻止新点击，写入失败时也不执行页面动作', async () => {
    for (const uncertain of [true, false]) {
      const run = newRun('guard')
      if (uncertain) run.operations.push({ id: 'old', tool: 'browser_click', browserId: 'tab', state: 'uncertain', at: 1, sequence: 1 })
      const effect = vi.fn(async () => '{}')
      const controller = createRunController({ run, changed: () => undefined, browserId: () => 'tab',
        checkpoint: async () => { throw new Error('checkpoint unavailable') }, signal: new AbortController().signal })
      const invoke = createHostToolRunner({ tools: [primitive], executeTool: call => controller.execute(call, effect) }, 'guard-turn')
      try {
        if (uncertain) expect(await invoke('browser_click', { ref: 'e1' })).toMatchObject({ ok: false, reason: 'verification_required' })
        else await expect(invoke('browser_click', { ref: 'e1' })).rejects.toThrow('checkpoint unavailable')
        expect(effect).not.toHaveBeenCalled()
      } finally { controller.dispose() }
    }
  })
})
