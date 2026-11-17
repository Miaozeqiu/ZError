// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({ invoke: vi.fn(), read: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: api.invoke }))
vi.mock('../../src/services/browser/appBrowser', () => ({ readBrowserPage: api.read }))
import {
  applyBrowserControl, browserControlState, controlForSession, registerBrowserControl,
  setBrowserControl, userControlsBrowser, claimBrowserForNewMessage,
} from '../../src/services/browser/control'
import { createBrowserControlGate } from '../../src/services/agent/browserControlGate'

const event = (owner: 'user' | 'agent', epoch: number) => ({ sessionId: 'test-control', owner, epoch })
describe('用户与 Agent 的浏览器操作权', () => {
  beforeEach(() => {
    for (const key of Object.keys(browserControlState)) delete browserControlState[key]
    api.invoke.mockReset()
    api.read.mockReset().mockResolvedValue({ snapshot: '- button 新页面 [ref=e10]' })
  })
  it('用户发送新消息自动交还当前浏览器，先读最新页面再执行', async () => {
    applyBrowserControl(event('user', 1))
    api.invoke.mockResolvedValueOnce(event('agent', 2))
    expect(await claimBrowserForNewMessage({ sessionId: 'test-control', browserId: 'test-tab', signal: new AbortController().signal })).toBe(true)
    expect(api.invoke).toHaveBeenCalledWith('browser_control_set', { id: 'test-tab', owner: 'agent' })
    expect(api.read).toHaveBeenCalledWith('test-tab', { controlEpoch: 2 })
    expect(userControlsBrowser('test-control')).toBe(false)
  })
  it('监控消息、其它对话和没有浏览器的消息都不会夺回控制权', async () => {
    applyBrowserControl(event('user', 1))
    const signal = new AbortController().signal
    expect(await claimBrowserForNewMessage({ sessionId: 'test-control', browserId: 'tab', kind: 'watch', signal })).toBe(false)
    expect(await claimBrowserForNewMessage({ sessionId: 'other-chat', browserId: 'other-tab', signal })).toBe(false)
    expect(await claimBrowserForNewMessage({ sessionId: 'test-control', signal })).toBe(false)
    expect(api.invoke).not.toHaveBeenCalled()
    expect(userControlsBrowser('test-control')).toBe(true)
  })
  it('交还过程中取消新消息，完成后的权限不会留给 Agent', async () => {
    applyBrowserControl(event('user', 1))
    let finish!: (value: unknown) => void
    api.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    api.invoke.mockResolvedValueOnce(event('agent', 2)).mockResolvedValueOnce(event('user', 3))
    const abort = new AbortController()
    const result = claimBrowserForNewMessage({ sessionId: 'test-control', browserId: 'tab', signal: abort.signal })
    const assertion = expect(result).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(api.read).toHaveBeenCalled())
    abort.abort()
    finish({ snapshot: '最新页面' })
    await assertion
    expect(userControlsBrowser('test-control')).toBe(true)
    expect(api.invoke).toHaveBeenLastCalledWith('browser_control_set', { id: 'tab', owner: 'user' })
  })
  it.each(['success', 'failure'])('旧消息交还的迟到 %s 不得撤销更新消息的操作权', async outcome => {
    applyBrowserControl(event('user', 1))
    let finish!: () => void
    api.read.mockImplementationOnce(() => new Promise((resolve, reject) => {
      finish = () => outcome === 'success' ? resolve({ snapshot: '旧页面' }) : reject(new Error('旧快照读取失败'))
    }))
    api.invoke.mockResolvedValueOnce(event('agent', 2)).mockResolvedValueOnce(event('agent', 4))
    const abort = new AbortController()
    const first = claimBrowserForNewMessage({ sessionId: 'test-control', browserId: 'tab', signal: abort.signal })
    const assertion = expect(first).rejects.toMatchObject({ name: 'AbortError' })
    await vi.waitFor(() => expect(api.read).toHaveBeenCalledOnce())
    abort.abort()
    await claimBrowserForNewMessage({ sessionId: 'test-control', browserId: 'tab', signal: new AbortController().signal })
    finish()
    await assertion
    expect(controlForSession('test-control')).toMatchObject({ owner: 'agent', epoch: 4 })
    expect(api.invoke).toHaveBeenCalledTimes(2)
  })
  it('旧的 Agent 状态事件不能误解除用户接管', () => {
    applyBrowserControl(event('agent', 0))
    applyBrowserControl(event('user', 1))
    applyBrowserControl(event('agent', 0))
    expect(userControlsBrowser('test-control')).toBe(true)
  })
  it('交还时先重新读取页面，原生提前发出的 agent 事件不会放行等待者', async () => {
    api.invoke.mockResolvedValueOnce(event('agent', 0))
    await registerBrowserControl('test-tab', 'test-control')
    applyBrowserControl(event('user', 1))
    let finish!: (value: unknown) => void
    api.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    api.invoke.mockImplementationOnce(async () => {
      applyBrowserControl(event('agent', 2))
      return event('agent', 2)
    })
    const returning = setBrowserControl('test-tab', 'test-control', 'agent')
    await vi.waitFor(() => expect(api.read).toHaveBeenCalled())
    expect(userControlsBrowser('test-control')).toBe(true)
    expect(api.read).toHaveBeenCalledWith('test-tab', { controlEpoch: 2 })
    finish({ snapshot: '- button 新页面 [ref=e10]' })
    await returning
    expect(userControlsBrowser('test-control')).toBe(false)
  })
  it('刷新失败继续由用户控制，不放行 Agent', async () => {
    applyBrowserControl(event('user', 1))
    api.invoke.mockResolvedValueOnce(event('agent', 2)).mockResolvedValueOnce(event('user', 3))
    api.read.mockResolvedValueOnce({ error: '页面暂未就绪' })
    await expect(setBrowserControl('test-tab', 'test-control', 'agent')).rejects.toThrow('页面暂未就绪')
    expect(userControlsBrowser('test-control')).toBe(true)
    expect(controlForSession('test-control')?.epoch).toBe(3)
  })
  it('接管后立即取消浏览器工具，交还后拒绝旧点击', async () => {
    applyBrowserControl(event('agent', 0))
    const gate = createBrowserControlGate('test-control', new AbortController().signal)
    await gate.liveContext(() => '旧页面')
    applyBrowserControl(event('user', 1))
    const execute = vi.fn().mockResolvedValue('clicked')
    await expect(gate.runTool({ id: 'call', name: 'browser_click', arguments: '{"ref":"e1"}' }, execute)).rejects.toMatchObject({ name: 'ModelStoppedError' })
    expect(execute).not.toHaveBeenCalled()
    applyBrowserControl(event('agent', 2))
    expect(JSON.parse(await gate.runTool({ id: 'old', name: 'browser_click', arguments: '{}' }, execute))).toMatchObject({ userTakeover: true, requiresRefresh: true })
    expect(execute).not.toHaveBeenCalled()
    await gate.liveContext(() => '新页面')
    expect(await gate.runTool({ id: 'new-call', name: 'browser_get_page', arguments: '{}' }, execute)).toBe('clicked')
    expect(execute).toHaveBeenCalledWith(2)
  })
  it('两份对话的控制权互不影响', async () => {
    applyBrowserControl(event('user', 1))
    const gate = createBrowserControlGate('other-chat', new AbortController().signal)
    expect(await gate.liveContext(() => '正常页面')).toBe('正常页面')
  })
  it('接管状态中新发起的普通聊天可执行，浏览器工具立即终止', async () => {
    applyBrowserControl(event('user', 1))
    const abort = new AbortController()
    const gate = createBrowserControlGate('test-control', abort.signal)
    const read = vi.fn()
    expect(await gate.liveContext(read)).toContain('浏览器由用户控制')
    expect(read).not.toHaveBeenCalled()
    const execute = vi.fn().mockResolvedValue('搜索成功')
    expect(await gate.runTool({ id: 'search', name: 'web_search', arguments: '{}' }, execute)).toBe('搜索成功')
    execute.mockClear()
    await expect(gate.runTool({ id: 'click', name: 'browser_click', arguments: '{}' }, execute)).rejects.toMatchObject({ name: 'ModelStoppedError' })
    expect(execute).not.toHaveBeenCalled()
  })
})
