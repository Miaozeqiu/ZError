import { beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ documents: [] as any[], login: vi.fn() }))
vi.mock('../../src/services/agent/chatLogin', () => ({ requestChatLogin: api.login }))
vi.mock('../../src/services/browser/documents', async original => ({
  ...await original<typeof import('../../src/services/browser/documents')>(), browserDocuments: async () => ({ documents: api.documents }),
}))
import { scopedWebsiteHost } from '../../src/services/agent/websiteRuntime/scopedHost'
const document = { frameId: 'form', loaderId: 'one', url: 'https://academy.example/login' }
const references = { account: '{{secret:site/academy.example/account}}', password: '{{secret:site/academy.example/password}}' }
const makeHost = () => {
  const abort = new AbortController(), invoke = vi.fn(async (_name: string, _args: Record<string, unknown>) => ({ ok: true, filled: true }))
  const pause = vi.fn(), resume = vi.fn()
  const host = scopedWebsiteHost({ host: 'academy.example', browserId: 'tab', signal: abort.signal, pause, resume,
    ctx: { sessionId: 'chat', invokeHostTool: invoke } as any })
  return { ...host, abort, invoke, pause, resume }
}
beforeEach(() => { vi.clearAllMocks(); api.documents = [document]; api.login.mockResolvedValue({ ok: true, references }) })
describe('隔离凭据及文档宿主', () => {
  it('脚本只收到临时授权号，真实填写仍经过宿主工具和原生凭据接口', async () => {
    const host = makeHost()
    const receipt = await host.execute('credentials.request', { document, replaceRejected: true })
    expect(receipt).toMatchObject({ ok: true, credential_id: expect.any(String) })
    expect(JSON.stringify(receipt)).not.toContain('secret:')
    expect(api.login).toHaveBeenCalledWith('chat', 'tab', host.abort.signal, {
      expectedOrigin: 'https://academy.example', replacingRejectedCredentials: true,
      targetDocument: { host: 'academy.example', document },
    })
    const args = { document, selector: '#password', credential_id: receipt.credential_id, field: 'password' }
    await host.execute('credentials.fill', args)
    expect(host.invoke).toHaveBeenCalledExactlyOnceWith('browser_package_act', {
      host: 'academy.example', action: 'fill_secret', document, selector: '#password', secret_ref: references.password,
    })
    await expect(host.execute('credentials.fill', args)).rejects.toThrow('不能直接重放')
    expect(host.pause).toHaveBeenCalledOnce(); expect(host.resume).toHaveBeenCalledOnce()
  })
  it('同网址的新文档、伪造授权、用户取消及实例结束均不能继续填写', async () => {
    const host = makeHost()
    const receipt = await host.execute('credentials.request', { document })
    const args = { document, selector: '#account', credential_id: receipt.credential_id, field: 'account' }
    await expect(host.execute('credentials.fill', { ...args, credential_id: 'forged' })).rejects.toThrow('不匹配')
    api.documents = [{ ...document, loaderId: 'two' }]
    await expect(host.execute('credentials.fill', args)).rejects.toThrow('文档已更换')
    api.documents = [document]; host.dispose()
    await expect(host.execute('credentials.fill', args)).rejects.toThrow('已释放')
    api.login.mockResolvedValueOnce({ ok: false, denied: true, error: '用户取消' })
    const next = makeHost()
    expect(await next.execute('credentials.request', { document })).toMatchObject({ ok: false, denied: true })
    next.dispose()
    expect(host.invoke).not.toHaveBeenCalled()
  })
  it('媒体等待采用私有事件标识，取消时清理同一订阅', async () => {
    const host = makeHost()
    let finish!: (value: any) => void
    host.invoke.mockImplementation(async (_name, args) => args.action === 'media_wait' ? new Promise(resolve => { finish = resolve }) : { ok: true, filled: true })
    const pending = host.execute('media.wait', { document, selector: 'video', until: 'ended', timeoutMs: 30000 })
    expect(host.invoke.mock.calls[0][1]).toMatchObject({ action: 'media_wait', wait_id: expect.any(String) })
    host.abort.abort()
    const wait = host.invoke.mock.calls[0][1]
    expect(host.invoke.mock.calls[1][1]).toMatchObject({ action: 'media_cancel', wait_id: wait.wait_id })
    finish({ ok: true, event: 'cancelled' }); await pending
    expect(host.pause).toHaveBeenCalledOnce(); expect(host.resume).toHaveBeenCalledOnce()
  })
})
