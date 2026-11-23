import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentChatSession } from '../../src/services/agent/chatTypes'
const f = vi.hoisted(() => ({ sessions: new Map<string, AgentChatSession>(), patch: vi.fn(), subject: vi.fn(), schedule: vi.fn(), ensure: vi.fn(), folders: vi.fn(), attachment: vi.fn() }))
vi.mock('../../src/services/agent/chatStore', () => ({ liveSession: (id: string) => f.sessions.get(id), patchSession: (id: string, change: (s: AgentChatSession) => AgentChatSession) => f.sessions.set(id, change(f.sessions.get(id)!)), patchMessage: f.patch, setChatStudySubject: f.subject, sessionFolders: f.folders, sessionAttachment: f.attachment }))
vi.mock('../../src/services/agent/chatStudy', () => ({ scheduleStudyProgressEval: f.schedule }))
vi.mock('../../src/services/agent/agentBrowser', () => ({ ensureAgentBrowser: f.ensure }))
import { createChatToolContext } from '../../src/services/agent/chatToolContextFactory'
const base = () => ({ call: { id: 'call', name: 'browser_todo', arguments: '{"action":"get"}' }, sessionId: 'child', assistantId: 'message', abort: new AbortController().signal })
function session(id: string): AgentChatSession { return { id, title: id, messages: [{ id: 'message', role: 'assistant', content: '', status: 'streaming', steps: [] }], todos: [{ id: 'todo', text: 'task', status: 'pending' }], createdAt: 1, updatedAt: 1, browserId: `${id}-tab` } }
describe('model turns and CLI tools share context ownership', () => {
  beforeEach(() => { vi.clearAllMocks(); f.sessions.clear(); f.sessions.set('child', session('child')); f.sessions.set('parent', session('parent')); f.ensure.mockResolvedValue('parent-tab') })
  it('binds browser, credentials scope, study effects and todos to the parent session', async () => {
    const ctx = await createChatToolContext({ ...base(), parentSessionId: 'parent', parentAssistantId: 'parent-message', expectedBrowserId: 'parent-tab' })
    expect(ctx.browserId()).toBe('parent-tab')
    await ctx.ensureBrowser!(); expect(f.ensure).toHaveBeenCalledWith('parent')
    ctx.setStudySubject(17); expect(f.subject).toHaveBeenCalledWith(17, 'parent')
    ctx.scheduleEval({ subjectId: 17, stepId: 'step' }); expect(f.schedule).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 'parent', messageId: 'parent-message', force: true }))
    ctx.setTodos!([]); expect(f.patch).toHaveBeenCalledWith('parent', 'parent-message', { todos: [] })
    expect(f.sessions.get('child')!.todos).toHaveLength(1)
  })
  it('does not reuse an old browser target after switching tabs', async () => {
    const ctx = await createChatToolContext({ ...base(), expectedBrowserId: 'old-tab' })
    await expect(ctx.ensureBrowser!()).rejects.toThrow('当前标签页已改变')
  })
  it('rejects cancelled or deleted sessions and preserves live todo lookup', async () => {
    const abort = new AbortController(); abort.abort()
    await expect(createChatToolContext({ ...base(), abort: abort.signal })).rejects.toThrow('已停止')
    await expect(createChatToolContext({ ...base(), sessionId: 'removed' })).rejects.toThrow('对话已删除')
    const ctx = await createChatToolContext(base())
    expect(ctx.getTodos!()).toHaveLength(1)
    f.sessions.get('child')!.messages[0].todos = []
    expect(ctx.getTodos!()).toEqual([])
  })
})
