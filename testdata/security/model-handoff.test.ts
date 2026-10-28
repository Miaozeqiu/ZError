import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ fetch: vi.fn(), model: { id: 'secure-model' } }))
vi.mock('../../src/services/model/config', () => ({ modelConfigManager: {
  ready: Promise.resolve(), getSelectedTextModel: () => state.model, getSelectedAgentModel: () => state.model,
  getSettings: () => ({ platforms: [{ apiKey: 'synthetic-key', baseUrl: 'https://model.test', models: [state.model] }] }),
}, modelHasVision: () => false }))
vi.mock('../../src/services/model/protocol', () => ({ resolveRuntimeModelId: () => 'secure-model',
  resolveExecutableModelJsCode: () => "async function processModel(input,config,fetch,signal){return fetch('https://model.test',{method:'POST',signal,body:JSON.stringify(input)})}",
}))
vi.mock('../../src/services/app/settings', () => ({ settingsManager: { get: () => 0 } }))
vi.mock('../../src/services/security/secureFetch', () => ({ secureFetch: state.fetch }))
vi.mock('../../src/services/agent/debugLog', () => ({ logAgentDebug: vi.fn() }))
let runner: typeof import('../../src/services/model/runner')
let redactor: typeof import('../../src/services/security/secretRedaction')
beforeEach(async () => { vi.resetModules(); state.fetch.mockReset(); runner = await import('../../src/services/model/runner'); redactor = await import('../../src/services/security/secretRedaction') })
describe('credential handoff in the real model loop', () => {
  it('waits for registration before sibling tools and removes plaintext from the very next model request', async () => {
    const password = 'synthetic-Special "\\密 码!'
    const reference = '{{secret:site/zjooc/password}}'
    const requests: any[] = [], ran: string[] = []
    let release!: () => void
    const barrier = new Promise<void>(resolve => { release = resolve })
    state.fetch.mockImplementation(async (_url, init) => {
      requests.push(JSON.parse(init.body))
      return requests.length === 1 ? { status: 200, tool_calls: [
        { id: 'fill', function: { name: 'browser_type', arguments: JSON.stringify({ ref: 'e2', secret_ref: reference }) } },
        { id: 'protect', function: { name: 'protect_credentials', arguments: JSON.stringify({ site: 'zjooc', password }) } },
      ] } : { status: 200, content: '已通过变量填写' }
    })
    const transcript = vi.fn()
    const pending = runner.runTextModel(`请使用密码 ${password} 登录`, undefined, {
      maxRounds: 4, onTurnTranscript: transcript,
      executeTool: async call => {
        ran.push(call.name)
        if (call.name === 'protect_credentials') {
          await barrier; redactor.rememberRedaction(password, reference)
          return JSON.stringify({ ok: true, references: { password: reference } })
        }
        expect(JSON.parse(call.arguments).secret_ref).toBe(reference)
        return '{"ok":true,"filled":true}'
      },
    })
    await vi.waitFor(() => expect(ran).toEqual(['protect_credentials']))
    expect(requests[0].messages.at(-1).content).toContain(password)
    release()
    expect(await pending).toBe('已通过变量填写')
    expect(ran).toEqual(['protect_credentials', 'browser_type'])
    expect(requests).toHaveLength(2)
    expect(JSON.stringify(requests[1])).not.toContain('synthetic-Special')
    expect(requests[1].messages.find((row: any) => row.role === 'user').content).toContain(reference)
    expect(JSON.stringify(transcript.mock.calls)).not.toContain('synthetic-Special')
  })
})
