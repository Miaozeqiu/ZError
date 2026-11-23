// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(), redact: vi.fn(), subjects: vi.fn(), run: vi.fn(), claim: vi.fn(), context: vi.fn((text: string) => text),
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
  loadLiveExploreRefs: vi.fn(), maybeCompactContext: vi.fn(), modelUserContent: api.context,
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
  it('首页文件导入无需预选文件夹，交由 Agent 根据本地目录归类', async () => {
    hydration.resolve(null); await store.chatStoreReady
    const { startFileImportChat } = await import('../../src/services/agent/chatStarters')
    const pending = startFileImportChat({ filePath: '/tmp/学习强国初赛题库.docx' })
    await vi.advanceTimersByTimeAsync(0); await pending
    expect(store.activeChat.value?.attachments).toEqual([
      expect.objectContaining({ kind: 'file', fileName: '学习强国初赛题库.docx', folderId: undefined }),
    ])
    expect(api.run).toHaveBeenCalledWith(expect.objectContaining({
      modelPrompt: expect.stringContaining('导入本地题库'),
    }))
    expect(api.context).toHaveBeenCalledWith(expect.stringContaining('自行选择合适的位置创建文件夹'), expect.anything())
  })

  it('prefills a graph request for the selected subject without creating or sending a chat', async () => {
    hydration.resolve(null); await store.chatStoreReady
    const { draftStudyGraphChat } = await import('../../src/services/agent/chatStarters')
    const navigate = vi.fn()
    const prefill = vi.fn()
    window.addEventListener('navigate-tab', navigate)
    window.addEventListener('prefill-agent-composer', prefill)
    try {
      draftStudyGraphChat({ subjectId: 7, subjectName: '劳动经济学' })
      expect(navigate.mock.calls[0][0].detail).toBe('agent')
      expect(prefill.mock.calls[0][0].detail).toBe('请绘制或完善「劳动经济学」的知识图谱。')
      expect(store.newChatSelected.value).toBe(true)
      expect(store.activeChat.value).toMatchObject({ studySubjectId: 7, messages: [] })
      expect(store.chatSessions.value).toHaveLength(0)
      expect(api.run).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener('navigate-tab', navigate)
      window.removeEventListener('prefill-agent-composer', prefill)
    }
    const pending = send('请只补充劳动需求这一章。')
    await vi.advanceTimersByTimeAsync(0)
    await pending
    expect(api.run).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      streamSubjectId: 7, modelPrompt: expect.stringContaining('请只补充劳动需求这一章。'),
    }))
  })

  it('passes an attached image into the Agent model input', async () => {
    hydration.resolve(null); await store.chatStoreReady
    const imageUrl = 'data:image/png;base64,aW1hZ2U='
    const pending = send('请看我附上的图片。', [{
      kind: 'image', filePath: 'image:test', fileName: '截图.png', imageUrl,
    }])
    await vi.advanceTimersByTimeAsync(0); await pending
    expect(api.run.mock.calls[0][0].userContent).toEqual([
      { type: 'image_url', image_url: { url: imageUrl, detail: 'high' } },
      { type: 'text', text: expect.stringContaining('请看我附上的图片。') },
    ])
  })

  it('sends an option quote by itself with its question and preserves the card target', async () => {
    hydration.resolve(null); await store.chatStoreReady
    const quote = {
      messageId: 'quiz-message', stepId: 'quiz-step', uid: 'q-1',
      question: '哪一项正确？', key: 'B', text: '选项正文',
    }
    const pending = send('', undefined, { quizOptionQuotes: [quote] })
    expect(store.activeChat.value?.messages[0]).toMatchObject({ content: '', quizOptionQuotes: [quote] })
    await vi.advanceTimersByTimeAsync(0); await pending
    expect(api.run.mock.calls[0][0].modelPrompt).toContain('引用题目：哪一项正确？\n选项 B：选项正文')
    expect(store.activeChat.value?.messages[0].modelContent).toContain('选项 B：选项正文')
  })

  it('keeps the blank chat selected across hydration and saves it only after the first message', async () => {
    store.selectChat(null)
    const draftId = store.activeChatId.value
    hydration.resolve([{ id: 'older', title: '旧对话', messages: [] }])
    await store.chatStoreReady
    store.setChatStudySubject(7)
    await send('   ')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(store.newChatSelected.value).toBe(true)
    expect(store.chatSessions.value.map(session => session.id)).toEqual(['older'])
    expect(api.write).not.toHaveBeenCalled()

    store.selectChat('older')
    expect(store.newChatSelected.value).toBe(false)
    store.selectChat(null)
    expect(store.activeChatId.value).toBe(draftId)
    const pending = send('第一条消息')
    expect(store.newChatSelected.value).toBe(false)
    expect(store.activeChat.value).toMatchObject({ id: draftId, title: '第一条消息', studySubjectId: 7 })
    expect(store.chatSessions.value.map(session => session.id)).toEqual([draftId, 'older'])
    expect(store.liveSession('older')?.messages).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(0)
    await pending
  })

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

it('rehydrates an interrupted video checkpoint without restarting timers, and restores its original goal on explicit continuation', async () => {
  const run = { version: 1, id: 'old-run', goalMessageId: 'goal', status: 'waiting_video', updatedAt: 1, needsObservation: false, operations: [], trace: [], sequence: 0, usage: { requests: 2, inputTokens: 100, outputTokens: 10, tools: 2, failures: 0 } }
  hydration.resolve([{ id: 'old', title: 'old', createdAt: 1, updatedAt: 1, messages: [
    { id: 'goal', role: 'user', status: 'done', content: '完成第一至第三章，包括测验', steps: [] },
    { id: 'answer', role: 'assistant', status: 'streaming', awaitingVideo: true, waiting: true, content: '等待视频', steps: [], run },
  ] }])
  await store.chatStoreReady
  const previous = store.liveSession('old')!.messages[1]
  expect(previous).toMatchObject({ status: 'failed', awaitingVideo: false, waiting: false, run: { status: 'interrupted', needsObservation: true } })
  const pending = send('继续', undefined, { sessionId: 'old' })
  await vi.advanceTimersByTimeAsync(0); await pending
  expect(api.run).toHaveBeenCalledOnce()
  const args = api.run.mock.calls[0][0]
  expect(args.systemPrompt).toContain('完成第一至第三章，包括测验')
  expect(args.systemPrompt).toContain('不能复用旧 ref')
})

it('does not resurrect an older failed task when the latest run has already completed', async () => {
  const base = { version: 1, updatedAt: 1, needsObservation: false, operations: [], trace: [], sequence: 0, usage: { requests: 0, inputTokens: 0, outputTokens: 0, tools: 0, failures: 0 } }
  hydration.resolve([{ id: 'old', title: 'old', createdAt: 1, updatedAt: 1, messages: [
    { id: 'failed', role: 'assistant', status: 'failed', content: 'failed', steps: [], run: { ...base, id: 'failed-run', status: 'failed' } },
    { id: 'done', role: 'assistant', status: 'done', content: 'done', steps: [], run: { ...base, id: 'completed-run', status: 'completed' } },
  ] }])
  await store.chatStoreReady
  const pending = send('继续', undefined, { sessionId: 'old' })
  await vi.advanceTimersByTimeAsync(0); await pending
  expect(api.run.mock.calls[0][0].systemPrompt).not.toContain('任务恢复检查点')
})

it('短句导入仍携带当前对话已有附件引用，不要求用户再次提供文件',async()=>{
  hydration.resolve(null);await store.chatStoreReady
  const attachment={kind:'file' as const,fileName:'题库.docx',filePath:'/tmp/题库.docx'}
  const session=store.createChat({attachments:[attachment]})
  const pending=send('导入下',undefined,{sessionId:session.id})
  await vi.advanceTimersByTimeAsync(0);await pending
  // 真实上下文构建将既有附件继续交给 modelUserContent；不依赖历史消息是否被压缩。
  expect(api.context).toHaveBeenCalledWith('导入下',expect.arrayContaining([expect.objectContaining({filePath:'/tmp/题库.docx'})]))
})
