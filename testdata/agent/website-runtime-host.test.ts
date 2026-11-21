import { describe, expect, it, vi } from 'vitest'
import { createHostToolRunner } from '../../src/services/agent/chapterResume'
import { createRunController } from '../../src/services/agent/core/controller'
import { newRun, type RunCheckpoint } from '../../src/services/agent/core/run'
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
