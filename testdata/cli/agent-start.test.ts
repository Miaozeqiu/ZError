import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentChatSession } from '../../src/services/agent/chatTypes'
const f = vi.hoisted(() => ({ current: undefined as AgentChatSession | undefined, send: vi.fn(), patch: vi.fn(), aborts: new Map(), selected: vi.fn() }))
vi.mock('../../src/services/agent/chatStore', () => ({ chatStoreReady: Promise.resolve(), liveSession: () => f.current, chatAborts: f.aborts, patchMessage: f.patch }))
vi.mock('../../src/services/model/configManager', () => ({ modelConfigManager: { ready: Promise.resolve(), getSelectedAgentModel: f.selected } }))
vi.mock('../../src/services/agent/chatLoop', () => ({ sendChatMessage: f.send }))
vi.mock('../../src/services/security/secureStore', () => ({ redactNative: async () => 'redacted failure' }))
import { agentHandlers } from '../../src/services/cli/handlers/agent'
const context = { assertActive: async () => {} }
describe('Agent acceptance uses a durable message identity', () => {
  beforeEach(() => { vi.clearAllMocks(); f.aborts.clear(); f.selected.mockReturnValue({ id: 'model' }); f.current = { id: 's', title: 'session', messages: [], todos: [], createdAt: 1, updatedAt: 1 } })
  it('returns the created message ID and binds asynchronous failure to that message, not its successor', async () => {
    let reject!: (e: Error) => void
    f.send.mockImplementation((_text, _files, options) => {
      f.current!.messages.push({ id: options.assistantId, role: 'assistant', content: '', status: 'streaming', steps: [] })
      return new Promise((_resolve, fail) => { reject = fail })
    })
    const accepted = await agentHandlers['agent.run']({ sessionId: 's', text: 'test' }, context)
    expect(accepted).toMatchObject({ id: 's', messageId: f.current!.messages[0].id, accepted: true })
    f.current!.messages.push({ id: 'successor', role: 'assistant', content: '', status: 'streaming', steps: [] })
    reject(new Error('raw error'))
    await vi.waitFor(() => expect(f.patch).toHaveBeenCalledWith('s', accepted.messageId, { status: 'failed', error: 'redacted failure' }))
  })
  it('does not accept a task if the shared chat entry did not create its message', async () => {
    f.send.mockResolvedValue(undefined)
    await expect(agentHandlers['agent.run']({ sessionId: 's', text: 'test' }, context)).rejects.toThrow('没有创建任务消息')
  })
  it('rechecks GUI busy state immediately before sending, and rejects an empty session ID', async () => {
    await expect(agentHandlers['agent.run']({ sessionId: '', text: 'test' }, context)).rejects.toThrow('sessionId 不能为空')
    await expect(agentHandlers['agent.run']({ sessionId: 's', text: 'test' }, { assertActive: async () => { f.current!.messages.push({ id: 'ui', role: 'assistant', content: '', status: 'streaming', steps: [] }) } })).rejects.toThrow('对话正在运行')
    expect(f.send).not.toHaveBeenCalled()
  })
})
