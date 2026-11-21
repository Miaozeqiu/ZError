import { describe, it, expect, vi } from 'vitest'
import { createWebsiteServiceBroker, type WebsiteServiceDependencies } from '../../src/services/agent/websiteRuntime/serviceBroker'
import { createPackageStateStore } from '../../src/services/agent/websiteRuntime/packageState'
const fixture = () => {
  let identity: ReturnType<WebsiteServiceDependencies['identity']> = { principal: 'user-1', token: 'fixture-private-token', revision: 1 }
  const deps: WebsiteServiceDependencies = { signal: new AbortController().signal, identity: () => identity,
    login: vi.fn(async () => true), request: vi.fn(async () => Response.json({ data: { items: Array.from({ length: 60 }, (_, id) => ({ id })), token: identity?.token } })),
    search: vi.fn(async () => [{ id: 1, answer: '示例' }]), generate: vi.fn(async () => '["A"]'), publish: vi.fn(async () => {}),
    readStates: vi.fn(async () => []), readState: vi.fn(async () => null), writeState: vi.fn(async () => {}), pause: vi.fn(), resume: vi.fn() }
  return { deps, setIdentity: (value: typeof identity) => { identity = value } }
}
describe('通用服务能力隔离', () => {
  it('凭据仅在宿主注入，响应按 JSON 路径分页，反射凭据被去除', async () => {
    const { deps } = fixture(), broker = createWebsiteServiceBroker(deps)
    const grant = await broker.execute('service.session', { service: 'account' })
    expect(JSON.stringify(grant)).not.toContain('fixture-private-token')
    const response = await broker.execute('service.request', { session_id: grant.session_id, method: 'GET', path: '/fixture', token_location: 'query', token_name: 'token', query: [{ name: 'id', value: 'paper-1' }] })
    expect(deps.request).toHaveBeenCalledWith('/fixture?id=paper-1&token=fixture-private-token', expect.objectContaining({ redirect: 'error' }))
    expect(await broker.execute('service.read', { session_id: grant.session_id, request_id: response.request_id, pointer: '/data/items', offset: 32, limit: 8 })).toMatchObject({ total: 60, items: Array.from({ length: 8 }, (_, n) => ({ id: 32 + n })), next_offset: 40 })
    expect(await broker.execute('service.read', { session_id: grant.session_id, request_id: response.request_id, pointer: '/data/token' })).toMatchObject({ value: '[credential]' })
    broker.dispose()
    await expect(broker.execute('service.check', { session_id: grant.session_id })).rejects.toThrow('释放')
  })
  it('拒绝跨来源、重复凭据注入、重定向和账号切换后的继续写入', async () => {
    const { deps, setIdentity } = fixture(), broker = createWebsiteServiceBroker(deps)
    const { session_id } = await broker.execute('service.session', { service: 'account' })
    for (const path of ['https://foreign.example', '//foreign.example', '/\\foreign.example', '/x?token=bad']) {
      await expect(broker.execute('service.request', { session_id, path, method: 'GET', token_location: 'header' })).rejects.toThrow()
    }
    expect(deps.request).not.toHaveBeenCalled()
    setIdentity({ principal: 'user-2', token: 'other', revision: 2 })
    await expect(broker.execute('service.check', { session_id })).rejects.toThrow('账号已变化')
  })
  it('实际 401 才能触发重新登录，取消登录不继续网络或填答', async () => {
    const { deps } = fixture(), broker = createWebsiteServiceBroker(deps)
    const { session_id } = await broker.execute('service.session', { service: 'account' })
    await expect(broker.execute('service.session', { service: 'account', interactive: true, replace: true })).rejects.toThrow('失效')
    const other = await broker.execute('service.session', { service: 'account' })
    vi.mocked(deps.request).mockResolvedValueOnce(Response.json({ error: 'expired' }, { status: 401 }))
    expect(await broker.execute('service.request', { session_id, path: '/fixture', method: 'GET', token_location: 'header' })).toMatchObject({ authenticationRejected: true })
    await expect(broker.execute('service.check', { session_id })).rejects.toThrow('失效')
    await expect(broker.execute('service.check', { session_id: other.session_id })).rejects.toThrow('失效')
    expect(await broker.execute('service.session', { service: 'account' })).toMatchObject({ authenticated: false, authenticationRejected: true })
    vi.mocked(deps.login).mockResolvedValueOnce(false)
    expect(await broker.execute('service.session', { service: 'account', interactive: true, replace: true })).toMatchObject({ denied: true })
    expect(deps.pause).toHaveBeenCalledOnce(); expect(deps.resume).toHaveBeenCalledOnce()
  })
  it('后台事件不弹登录、不调用模型，完整请求正文可分块组装', async () => {
    const { deps } = fixture(), broker = createWebsiteServiceBroker(deps, true)
    await expect(broker.execute('service.session', { service: 'account', interactive: true })).rejects.toThrow('后台')
    await expect(broker.execute('model.generate', { prompt: 'x', system: 'x' })).rejects.toThrow('后台')
    const { payload_id } = await broker.execute('payload.create', { json: '{"data":{"rows":[]}}' })
    await broker.execute('payload.append', { payload_id, pointer: '/data/rows', json: '[{"id":1}]' })
    const { session_id } = await broker.execute('service.session', { service: 'account' })
    await broker.execute('service.request', { session_id, method: 'POST', path: '/fixture', token_location: 'header', payload_id })
    expect(deps.request).toHaveBeenCalledWith('/fixture', expect.objectContaining({ body: '{"data":{"rows":[{"id":1}]}}' }))
    expect(deps.login).not.toHaveBeenCalled(); expect(deps.generate).not.toHaveBeenCalled()
  })
  it('状态按来源和账号隔离，损坏存储禁止覆盖', async () => {
    let saved: any = null
    const write = vi.fn(async value => { saved = value })
    const state = createPackageStateStore({ read: async () => saved, write })
    await state.write('site\nsource', 'user-1', 'paper/1', '{"answer":"A"}')
    expect(await state.read('site\nsource', 'user-2', 'paper/1')).toBe(null)
    expect(await state.read('other\nsource', 'user-1', 'paper/1')).toBe(null)
    expect(await state.read('site\nsource', 'user-1', 'paper/1')).toBe('{"answer":"A"}')
    saved = { version: 99, entries: [] }; write.mockClear()
    await expect(state.write('site\nsource', 'user-1', 'paper/1', 'null')).rejects.toThrow('未覆盖')
    expect(write).not.toHaveBeenCalled()
  })
  it('包含引号和反斜线的凭据也不能通过响应键值泄露', async () => {
    const { deps, setIdentity } = fixture(), token = 'sensitive"\\value'
    setIdentity({ principal: 'user-1', revision: 2, token })
    vi.mocked(deps.request).mockResolvedValueOnce(Response.json({ [token]: token, nested: [encodeURIComponent(token)] }))
    const broker = createWebsiteServiceBroker(deps), { session_id } = await broker.execute('service.session', { service: 'account' })
    const response = await broker.execute('service.request', { session_id, path: '/fixture', method: 'GET', token_location: 'header' })
    expect(await broker.execute('service.read', { session_id, request_id: response.request_id, pointer: '' })).toMatchObject({ value: { '[credential]': '[credential]', nested: ['[credential]'] } })
  })
  it('完整上传在宿主组装，缺块、重复块和超限正文都不发送', async () => {
    const { deps } = fixture(), broker = createWebsiteServiceBroker(deps)
    const { session_id } = await broker.execute('service.session', { service: 'account' })
    const args = { session_id, keys: ['paper/1', 'paper/2'], json: '{"rows":[]}', pointer: '/rows', source_pointer: '/subjects' }
    vi.mocked(deps.readStates).mockResolvedValueOnce(['{"subjects":[{"id":1}]}', '{"subjects":[{"id":2}]}'])
    const { payload_id, count } = await broker.execute('payload.from_state', args)
    expect(count).toBe(2)
    await broker.execute('service.request', { session_id, path: '/fixture', method: 'POST', token_location: 'header', payload_id })
    expect(deps.request).toHaveBeenCalledWith('/fixture', expect.objectContaining({ body: '{"rows":[{"id":1},{"id":2}]}' }))
    vi.mocked(deps.request).mockClear()
    vi.mocked(deps.readStates).mockResolvedValueOnce(['{"subjects":[]}', null])
    await expect(broker.execute('payload.from_state', args)).rejects.toThrow('不完整')
    await expect(broker.execute('payload.from_state', { ...args, keys: ['paper/1', 'paper/1'] })).rejects.toThrow('重复')
    vi.mocked(deps.readStates).mockResolvedValueOnce([JSON.stringify({ subjects: ['x'.repeat(6 * 1024 * 1024)] }), '{"subjects":[]}'])
    await expect(broker.execute('payload.from_state', args)).rejects.toThrow('超过限制')
    expect(deps.request).not.toHaveBeenCalled()
  })
  it('取消页面任务会关闭正在读取的响应流', async () => {
    const { deps } = fixture(), control = new AbortController(), cancel = vi.fn()
    deps.signal = control.signal
    vi.mocked(deps.request).mockResolvedValueOnce(new Response(new ReadableStream({ cancel })))
    const broker = createWebsiteServiceBroker(deps), { session_id } = await broker.execute('service.session', { service: 'account' })
    const pending = broker.execute('service.request', { session_id, path: '/fixture', method: 'GET', token_location: 'header' })
    const failure = expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(deps.request).toHaveBeenCalled())
    control.abort()
    await failure
    expect(cancel).toHaveBeenCalledOnce()
  })
})
