// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ sessions: [] as any[], invoke: vi.fn(), persist: vi.fn(), refresh: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: state.invoke }))
vi.mock('../../src/services/agent/chatStore', () => ({ sessions: { get value() { return state.sessions } }, liveSession: (id: string) => state.sessions.find(row => row.id === id), persistSoon: state.persist }))
vi.mock('../../src/services/agent/siteAccounts', () => ({ refreshSiteAccounts: state.refresh }))
vi.mock('../../src/services/agent/websiteIdentity', () => ({ websiteAccountId: (site: string) => site === 'authserver.open.ha.cn' ? 'menhu.haou.edu.cn' : site }))
const context = () => ({ sessionId: 'test', assistantId: 'assistant', abort: new AbortController().signal } as any)
let tool: typeof import('../../src/services/agent/credentialTools').protectCredentials
let redaction: typeof import('../../src/services/security/secretRedaction')
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks()
  Object.defineProperty(window, '__TAURI_INTERNALS__', { value: {}, configurable: true })
  redaction = await import('../../src/services/security/secretRedaction')
  tool = (await import('../../src/services/agent/credentialTools')).protectCredentials
  state.invoke.mockImplementation(async (name, args) => {
    if (name === 'secure_register') return { references: Object.fromEntries(Object.keys(args.fields).map(field => [field, `{{secret:site/${args.site}/${field}}}`])) }
    if (name === 'secure_redact') return redaction.redactObject(args.value)
    return { ok: true }
  })
  state.sessions = [{ id: 'test', title: '账号 demo-user 登录', contextSummary: { text: '密码为 special "\\ 密码!' }, messages: [
    { id: 'source', role: 'user', content: '请用账号 demo-user 和密码 special "\\ 密码! 登录', steps: [] },
    { id: 'assistant', role: 'assistant', content: '使用 demo-user', steps: [{ arguments: JSON.stringify({ text: 'special "\\ 密码!' }), result: 'demo-user' }] },
  ] }]
})
describe('model-directed credential protection', () => {
  it('registers exact user-provided values and rewrites all history copies without changing session identity', async () => {
    const original = state.sessions[0]
    const result = JSON.parse(await tool({ args: { source_message_id: 'source', site: 'authserver.open.ha.cn', account: 'demo-user', password: 'special "\\ 密码!' }, ctx: context(), call: {} as any }))
    expect(result.ok).toBe(true)
    expect(result.references.password).toBe('{{secret:site/menhu.haou.edu.cn/password}}')
    expect(state.sessions[0]).toBe(original)
    expect(JSON.stringify(state.sessions)).not.toContain('demo-user')
    expect(JSON.stringify(state.sessions)).not.toContain('special')
    expect(JSON.parse(state.sessions[0].messages[1].steps[0].arguments).text).toBe(result.references.password)
    expect(JSON.stringify(result)).not.toContain('special')
    expect(state.persist).toHaveBeenCalledWith(true)
  })
  it('rejects invented values and assistant/web content as a credential source', async () => {
    for (const args of [{ source_message_id: 'assistant', password: 'demo-user' }, { source_message_id: 'source', password: 'not-in-original' }]) {
      const result = JSON.parse(await tool({ args, ctx: context(), call: {} as any }))
      expect(result.ok).toBe(false)
    }
    expect(state.invoke).not.toHaveBeenCalled()
  })
  it('does not replace history or claim success when secure persistence fails', async () => {
    state.invoke.mockRejectedValue(new Error('Keychain locked'))
    await expect(tool({ args: { site: 'zjooc', password: 'special "\\ 密码!' }, ctx: context(), call: {} as any })).rejects.toThrow('Keychain locked')
    expect(state.sessions[0].messages[0].content).toContain('special')
    expect(state.persist).not.toHaveBeenCalled()
  })
  it('stores unidentified website credentials as unbound, non-fillable references', async () => {
    const result = JSON.parse(await tool({ args: { account: 'demo-user' }, ctx: context(), call: {} as any }))
    expect(result.references.account).toBe('{{secret:site/pending-test/account}}')
    expect(result.hint).toContain('关联')
  })
})
