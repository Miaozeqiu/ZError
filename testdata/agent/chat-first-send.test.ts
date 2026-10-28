// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(), redact: vi.fn(), subjects: vi.fn(), run: vi.fn(), claim: vi.fn(),
}))
vi.mock('../../src/services/security/secureStore', () => ({
  readSecureDocument: api.read, writeSecureDocument: api.write, redactNative: api.redact,
}))
vi.mock('../../src/services/app/database', () => ({ databaseService: { listStudySubjects: api.subjects } }))
vi.mock('../../src/services/browser/appBrowser', () => ({ peekAppBrowserUrl: () => '' }))
vi.mock('../../src/services/browser/control', async () => ({ browserControlState: (await import('vue')).reactive({}), claimBrowserForNewMessage: api.claim }))
vi.mock('../../src/services/model/runner', () => ({ isModelStopped: () => false }))
vi.mock('../../src/services/model/config', () => ({ modelConfigManager: { ready: Promise.resolve(), getSettings: () => ({ platforms: [] }) } }))
vi.mock('../../src/services/study/graphStream', () => ({ studyGraphStream: { value: null }, finishStudyGraphStream: vi.fn() }))
vi.mock('../../src/services/study/timelineSummary', () => ({ finalizeStudySessionSummary: vi.fn() }))
vi.mock('../../src/services/agent/agentProfiles', () => ({ getActiveAgentProfile: () => ({}) }))
vi.mock('../../src/services/agent/agentSkills', () => ({ getEnabledSkillCatalog: () => [] }))
vi.mock('../../src/services/agent/browserLoop', () => ({ formatBrowserLiveContext: () => '' }))
vi.mock('../../src/services/agent/browserTask', () => ({ rememberBrowserTaskIntent: vi.fn() }))
vi.mock('../../src/services/platform', () => ({ bindAllWatchAgents: vi.fn(), flushAllWatchAfterTurn: vi.fn(), dropAllWatchQueues: vi.fn() }))
vi.mock('../../src/services/platform/panelAccess', () => ({ packAgentPanel: vi.fn() }))
vi.mock('../../src/services/chaoxing/browser/playback', () => ({ ensureStudyWatch: vi.fn(), liveStudyPlayback: () => ({ playing: false }) }))
vi.mock('../../src/services/agent/chatWatch', () => ({ stopWatchFor: vi.fn() }))
vi.mock('../../src/services/agent/agentApproval', () => ({ cancelApprovalsForSession: vi.fn() }))
vi.mock('../../src/services/agent/agentWait', () => ({ wakeAgentWait: vi.fn() }))
vi.mock('../../src/services/agent/subagent/owner', () => ({ abortChildrenOf: vi.fn() }))
vi.mock('../../src/services/agent/chatStudy', () => ({
  browserStatePrefix: async () => '', studyStatePrefix: async () => '', lastUserText: () => '',
  loadLiveExploreRefs: vi.fn(), maybeCompactContext: vi.fn(), modelUserContent: (text: string) => text,
  scheduleStudyProgressEval: vi.fn(), shouldAutoEvalStudy: () => ({ yes: false }), toMultimodalUserContent: vi.fn(),
}))
vi.mock('../../src/services/agent/context', () => ({
  contextSummaryPrompt: () => '', splitCompactedHistory: () => ({ kept: [] }),
}))
vi.mock('../../src/services/agent/debugLog', () => ({ clipAgentDebug: (text: string) => text, logAgentDebug: vi.fn(), writeBrowserTranscript: vi.fn() }))
vi.mock('../../src/services/agent/modelHistory', () => ({ buildModelHistory: () => [], clipToolText: (text: string) => text, clipTranscript: (items: unknown) => items }))
vi.mock('../../src/services/agent/subagent/runtime', () => ({ runAgentTurnLoop: api.run }))
vi.mock('../../src/services/agent/tools', () => ({ assembleAgentTools: () => [], availableAgentTools: () => [] }))
vi.mock('../../src/services/app/settings', () => ({ useSettings: () => ({ settings: {} }) }))

const deferred = <T>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
let hydration: ReturnType<typeof deferred<any>>
let store: typeof import('../../src/services/agent/chatStore')
let send: typeof import('../../src/services/agent/chatLoop')['sendChatMessage']

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers()
  hydration = deferred()
  api.read.mockReturnValue(hydration.promise)
  api.write.mockResolvedValue(undefined)
  api.redact.mockImplementation(async value => value)
  api.subjects.mockResolvedValue([])
  api.claim.mockResolvedValue(false)
  api.run.mockResolvedValue({ text: '回复', aborted: false })
  store = await import('../../src/services/agent/chatStore')
  send = (await import('../../src/services/agent/chatLoop')).sendChatMessage
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

describe('first message preparation', () => {
  it('定期保存仍在运行的对话和工具记录，避免长任务中断后丢失整轮', async () => {
    hydration.resolve(null); await store.chatStoreReady
    const model = deferred<any>()
    api.run.mockReturnValue(model.promise)
    const pending = send('继续课程')
    await vi.advanceTimersByTimeAsync(0)
    const session = store.activeChat.value!
    const reply = session.messages[1]
    store.patchMessage(session.id, reply.id, { content: '视频播放中' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(api.write).toHaveBeenCalledWith('agent_chats', expect.arrayContaining([
      expect.objectContaining({ messages: expect.arrayContaining([
        expect.objectContaining({ status: 'streaming', content: '视频播放中' }),
      ]) }),
    ]))
    model.resolve({ text: '完成', aborted: false }); await pending
  })
  it('distinguishes user browser takeover from normal generation completion', async () => {
    hydration.resolve(null); await store.chatStoreReady
    const model = deferred<any>()
    api.run.mockReturnValue(model.promise)
    const pending = send('监控视频')
    await vi.advanceTimersByTimeAsync(0)
    const id = store.activeId.value!
    const { browserControlState } = await import('../../src/services/browser/control')
    browserControlState[id] = { sessionId: id, owner: 'user', epoch: 1, revision: 1 }
    expect(store.activeChat.value?.messages[1]).toMatchObject({ status: 'stopped', stopReason: 'browser-takeover' })
    model.resolve({ text: '', aborted: true }); await pending
    expect(store.activeChat.value?.messages[1].stopReason).toBe('browser-takeover')
  })
  it('shows the message immediately and keeps the active streaming turn when old history finishes loading', async () => {
    const model = deferred<any>()
    api.run.mockReturnValue(model.promise)
    const pending = send('第一条问题')
    const current = store.activeChat.value!
    expect(current.messages.map(message => message.role)).toEqual(['user', 'assistant'])
    expect(current.messages[0].content).toBe('第一条问题')
    expect(current.messages[1]).toMatchObject({ status: 'streaming', waiting: true })
    expect(api.redact).not.toHaveBeenCalled()
    expect(api.subjects).not.toHaveBeenCalled()
    expect(api.run).not.toHaveBeenCalled()
    hydration.resolve([{ id: 'older', title: '旧对话', messages: [{ id: 'old-reply', status: 'streaming', steps: [] }] }])
    await vi.advanceTimersByTimeAsync(0)
    expect(store.activeId.value).toBe(current.id)
    expect(store.liveSession(current.id)?.messages[1].status).toBe('streaming')
    expect(store.liveSession('older')?.messages[0].status).toBe('failed')
    expect(api.run).toHaveBeenCalledOnce()
    model.resolve({ text: '回复', aborted: false })
    await pending
  })

  it('can stop during history loading without ever starting redaction, database queries or the model', async () => {
    const pending = send('先显示这条消息')
    store.stopChat()
    await vi.advanceTimersByTimeAsync(0)
    await pending
    expect(store.activeChat.value?.messages[1].status).toBe('stopped')
    expect(api.redact).not.toHaveBeenCalled()
    expect(api.subjects).not.toHaveBeenCalled()
    expect(api.run).not.toHaveBeenCalled()
    hydration.resolve(null)
    await vi.advanceTimersByTimeAsync(0)
    expect(api.run).not.toHaveBeenCalled()
  })

  it('waits for native redaction, rejects duplicate sends, and ignores a late subject match after stopping', async () => {
    hydration.resolve(null); await store.chatStoreReady
    const redaction = deferred<string>(), subjects = deferred<any[]>()
    api.redact.mockReturnValue(redaction.promise)
    api.subjects.mockReturnValue(subjects.promise)
    const pending = send('测试科目 synthetic-private')
    await send('重复点击发送')
    expect(store.activeChat.value?.messages).toHaveLength(2)
    await vi.advanceTimersByTimeAsync(0)
    expect(api.run).not.toHaveBeenCalled()
    expect(api.subjects).not.toHaveBeenCalled()
    redaction.resolve('测试科目 {{secret:site/example/password}}')
    await vi.advanceTimersByTimeAsync(0)
    expect(store.activeChat.value?.messages[0].content).not.toContain('synthetic-private')
    store.stopChat(); await pending
    subjects.resolve([{ id: 7, name: '测试科目' }])
    await vi.advanceTimersByTimeAsync(0)
    expect(store.activeChat.value?.studySubjectId).toBeUndefined()
    expect(api.run).not.toHaveBeenCalled()
  })

  it('passes only redacted text to the model and retains automatic subject selection', async () => {
    hydration.resolve(null); await store.chatStoreReady
    api.redact.mockResolvedValue('测试科目 {{secret:site/example/password}}')
    api.subjects.mockResolvedValue([{ id: 7, name: '测试科目' }])
    const pending = send('测试科目 synthetic-private')
    await vi.advanceTimersByTimeAsync(0); await pending
    expect(store.activeChat.value?.studySubjectId).toBe(7)
    expect(api.run.mock.calls[0][0]).toMatchObject({ streamSubjectId: 7 })
    expect(api.run.mock.calls[0][0].modelPrompt).toContain('{{secret:site/example/password}}')
    expect(api.run.mock.calls[0][0].modelPrompt).not.toContain('synthetic-private')
  })

  it('shows initialization failures in the chat and never bypasses failed native redaction', async () => {
    hydration.resolve(null); await store.chatStoreReady
    api.redact.mockRejectedValue(new Error('安全存储暂不可用'))
    const pending = send('问题')
    await vi.advanceTimersByTimeAsync(0); await pending
    expect(store.activeChat.value?.messages[1]).toMatchObject({ status: 'failed', error: '安全存储暂不可用' })
    expect(api.subjects).not.toHaveBeenCalled()
    expect(api.run).not.toHaveBeenCalled()
  })
})
