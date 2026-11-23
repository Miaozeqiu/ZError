import { describe, expect, it, vi } from 'vitest'
import type { AgentChatMessage, AgentChatSession } from '../../src/services/agent/chatTypes'
import { taskSnapshot } from '../../src/services/cli/tasks'
const state = vi.hoisted(() => ({ current: undefined as AgentChatSession | undefined, stop: vi.fn() }))
vi.mock('../../src/services/agent/chatStore', () => ({ chatStoreReady: Promise.resolve(), liveSession: () => state.current, stopChat: state.stop }))
import { agentHandlers } from '../../src/services/cli/handlers/agent'
const context = { assertActive: async () => {} }
const message = (id: string, status: AgentChatMessage['status']): AgentChatMessage => ({ id, status, role: 'assistant', content: id, steps: [] })
const session = (...messages: AgentChatMessage[]): AgentChatSession => ({ id: 'session', title: 'task', messages, createdAt: 1, updatedAt: 1, todos: [] })
describe('task identity across consecutive messages', () => {
  it('returns completed A while B is running in the same conversation', () => {
    const current = session(message('a', 'done'), message('b', 'streaming'))
    expect(taskSnapshot(current, 'a', true)).toMatchObject({ messageId: 'a', busy: false, status: 'done', messages: [{ id: 'a' }] })
    expect(taskSnapshot(current, 'b')).toMatchObject({ messageId: 'b', busy: true })
  })
  it('does not let a later success mask an earlier failure or stop', () => {
    for (const status of ['failed', 'stopped'] as const) expect(taskSnapshot(session(message('a', status), message('b', 'done')), 'a')).toMatchObject({ status, busy: false })
  })
  it('does not fall back when the requested message has been removed', () => {
    expect(() => taskSnapshot(session(message('b', 'done')), 'a')).toThrow('指定的任务消息不存在')
  })
  it('does not stop B when a stop for completed A arrives late', async () => {
    state.stop.mockClear(); state.current = session(message('a', 'done'), message('b', 'streaming'))
    await agentHandlers['agent.stop']({ id: 'session', messageId: 'a' }, context)
    expect(state.stop).not.toHaveBeenCalled()
    await agentHandlers['agent.stop']({ id: 'session', messageId: 'b' }, context)
    expect(state.stop).toHaveBeenCalledWith('session')
  })
  it('treats blocked/incomplete outcomes as distinct terminal results', () => {
    const a = message('a', 'done'); a.taskOutcome = 'blocked'
    expect(taskSnapshot(session(a), 'a').status).toBe('blocked')
    a.taskOutcome = 'incomplete'
    expect(taskSnapshot(session(a), 'a').status).toBe('incomplete')
  })
})
