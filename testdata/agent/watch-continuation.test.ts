// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  read: vi.fn(), write: vi.fn(), redact: vi.fn(), subjects: vi.fn(), run: vi.fn(), claim: vi.fn(), fetch: vi.fn(), tick: vi.fn(), watchRead: vi.fn(), bind: vi.fn(), flush: vi.fn(), drop: vi.fn(), stopWatch: vi.fn(), execute: vi.fn(),
}))
vi.mock('../../src/services/security/secureStore', () => ({
  readSecureDocument: api.read, writeSecureDocument: api.write, redactNative: api.redact,
}))
vi.mock('../../src/services/app/database', () => ({ databaseService: { listStudySubjects: api.subjects } }))
vi.mock('../../src/services/browser/appBrowser', () => ({ peekAppBrowserUrl: () => '' }))
vi.mock('../../src/services/browser/control', async () => {
  const state: Record<string, any> = (await import('vue')).reactive({})
  return { browserControlState: state, claimBrowserForNewMessage: api.claim, browserControlRevision: () => 0,
    controlForSession: (id: string) => state[id], userControlsBrowser: (id: string) => state[id]?.owner === 'user' }
})
vi.mock('../../src/services/model/config', () => ({
  modelHasVision: () => false,
  modelConfigManager: { ready: Promise.resolve(), getSelectedAgentModel: () => ({ id: 'test-model' }),
    getSelectedTextModel: () => ({ id: 'test-model' }),
    getSettings: () => ({ platforms: [{ id: 'test', apiKey: 'test-key', baseUrl: 'https://model.test', models: [{ id: 'test-model' }] }] }) },
}))
vi.mock('../../src/services/model/protocol', () => ({ resolveRuntimeModelId: () => 'test-model',
  resolveExecutableModelJsCode: () => "async function processModel(input, config, fetch, signal) { return fetch('https://model.test', {signal}); }" }))
vi.mock('../../src/services/security/secureFetch', () => ({ secureFetch: api.fetch }))
vi.mock('../../src/services/study/graphStream', () => ({ studyGraphStream: { value: null }, finishStudyGraphStream: vi.fn() }))
vi.mock('../../src/services/study/timelineSummary', () => ({ finalizeStudySessionSummary: vi.fn() }))
vi.mock('../../src/services/agent/agentProfiles', () => ({ getActiveAgentProfile: () => ({}) }))
vi.mock('../../src/services/agent/agentSkills', () => ({ getEnabledSkillCatalog: () => [] }))
vi.mock('../../src/services/agent/browserLoop', () => ({ formatBrowserLiveContext: () => '' }))
vi.mock('../../src/services/agent/browserTask', () => ({ rememberBrowserTaskIntent: vi.fn() }))
vi.mock('../../src/services/platform', () => ({ bindAllWatchAgents: api.bind, flushAllWatchAfterTurn: api.flush, dropAllWatchQueues: api.drop }))
vi.mock('../../src/services/platform/panelAccess', async () => ({
  packAgentPanel: () => null,
  videoWatchFor: api.watchRead,
  chapterStateFor: () => null,
}))
vi.mock('../../src/services/platform/watchBind', () => ({ flushAllWatchAfterTurn: api.flush }))
vi.mock('../../src/services/agent/activity', () => ({ describeActivity: (name: string) => ({ label: name }) }))
vi.mock('../../src/services/agent/import', () => ({ parseQuestions: () => [] }))
vi.mock('../../src/services/agent/siteLearningReview', () => ({ createLearningCompletionCheck: () => ({ deferred: false, beforeComplete: () => undefined }) }))
vi.mock('../../src/utils/question/quizPractice', () => ({ getQuizCards: () => [], parseQuizCards: () => [], resolveQuizTitle: () => '', saveQuizTitle: vi.fn() }))
vi.mock('../../src/services/agent/executeChatTool', () => ({ executeChatTool: async ({ call, ctx }: any) => {
  if (api.execute.getMockImplementation()) return api.execute(call, ctx)
  if (call.name === 'browser_watch') {
    const { startChaoxingWatch } = await import('../../src/services/chaoxing/browser/watch')
    startChaoxingWatch('watched-video', ctx.sessionId, { current: 10, duration: 7200, paused: false, mid: 'm2' })
    return JSON.stringify({ ok: true, watching: true })
  }
  const status = JSON.parse(call.arguments).status
  return JSON.stringify({ ok: true, status, finished: status !== 'watching', awaitingVideo: status === 'watching' })
} }))
vi.mock('../../src/services/chaoxing/browser/playback', () => ({ ensureStudyWatch: vi.fn(), liveStudyPlayback: () => ({ playing: false }) }))
vi.mock('../../src/services/agent/chatWatch', () => ({ stopWatchFor: api.stopWatch }))
vi.mock('../../src/services/agent/agentApproval', () => ({ cancelApprovalsForSession: vi.fn() }))

vi.mock('../../src/services/agent/subagent/owner', () => ({ abortChildrenOf: vi.fn() }))
vi.mock('../../src/services/agent/chatStudy', () => ({
  browserStatePrefix: async () => '', studyStatePrefix: async () => '', lastUserText: () => '',
  loadLiveExploreRefs: vi.fn(), maybeCompactContext: vi.fn(), modelUserContent: (text: string) => text,
  scheduleStudyProgressEval: vi.fn(), shouldAutoEvalStudy: () => ({ yes: false }), toMultimodalUserContent: vi.fn(),
}))
vi.mock('../../src/services/agent/context', () => ({
  contextSummaryPrompt: () => '', splitCompactedHistory: () => ({ kept: [] }),
}))
vi.mock('../../src/services/agent/debugLog', () => ({ clipAgentDebug: (text: string) => text, logAgentDebug: vi.fn(), writeBrowserTranscript: vi.fn(), writeDebugDump: vi.fn() }))
vi.mock('../../src/services/agent/modelHistory', () => ({ TOOL_ARGS_KEEP: 12000, TOOL_RESULT_KEEP: 24000, buildModelHistory: () => [], clipToolText: (text: string) => text, clipTranscript: (items: unknown) => items }))
vi.mock('../../src/services/agent/tools', () => ({ assembleAgentTools: () => [], availableAgentTools: () => [] }))
vi.mock('../../src/services/app/settings', () => ({ useSettings: () => ({ settings: {} }), settingsManager: { get: () => 0 } }))

vi.mock('../../src/services/chaoxing/study', () => ({
  installChaoxingVideoHook: async () => null, readChaoxingCaptcha: async () => false,
  readChaoxingVideoTick: api.tick,
  videoTickHasPlayer: (tick: any) => Boolean(tick && tick.duration > 0),
}))
vi.mock('../../src/services/chaoxing/study/video', () => ({ readChaoxingVideo: async () => null, videoIsPlaying: () => false }))
vi.mock('../../src/services/chaoxing/browser/panelStudy', () => ({ packAgentPanel: () => null, playPanelStudy: vi.fn() }))
vi.mock('../../src/services/chaoxing/browser/chapters', () => ({ chapterStateFor: () => null }))
vi.mock('../../src/services/chaoxing/browser/captcha', () => ({ solveChaoxingCaptcha: vi.fn() }))
vi.mock('../../src/services/browser/engine', () => ({ isWaitTruthy: () => false, waitForResponse: async () => null }))
vi.mock('../../src/services/browser/eval', () => ({ asObject: (value: any) => value || {}, withIdleEval: async (job: any) => job() }))
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
  api.fetch.mockReset(); api.execute.mockReset(); api.tick.mockResolvedValue(null)
  store = await import('../../src/services/agent/chatStore')
  const agent = await import('../../src/services/chaoxing/browser/watchAgent')
  const watch = await import('../../src/services/chaoxing/browser/watch')
  api.bind.mockImplementation(agent.bindChaoxingWatchAgent)
  api.flush.mockImplementation(agent.flushWatchAfterTurn)
  api.drop.mockImplementation(agent.dropWatchQueue)
  api.stopWatch.mockImplementation(watch.stopChaoxingWatch)
  api.watchRead.mockImplementation(watch.videoWatchFor)
  send = (await import('../../src/services/agent/chatLoop')).sendChatMessage
})

describe('same task completion through the real chat loop and model runner', () => {
  const init = async () => {
    hydration.resolve(null); await store.chatStoreReady
    const session = store.createChat({ browserId: 'task-browser' })
    api.execute.mockImplementation(async (call: any, ctx: any) => {
      const args = JSON.parse(call.arguments)
      if (call.name === 'browser_todo') {
        const { applyBrowserTodo } = await import('../../src/services/agent/browserTodo')
        const result = applyBrowserTodo(ctx.getTodos(), args)
        if (result.ok) ctx.setTodos(result.todos)
        return JSON.stringify(result)
      }
      if (call.name === 'browser_finish') {
        if (args.status === 'done' && ctx.getTodos().some((item: any) => item.status === 'pending')) {
          return JSON.stringify({ ok: false, finished: false, error: '清单未完成' })
        }
        return JSON.stringify({ ok: true, finished: true, status: args.status, summary: args.summary })
      }
      return JSON.stringify({ ok: true, text: '页面显示已提交' })
    })
    return session
  }
  it('keeps progress text in the same message, resumes pending steps and requires a receipt even after all boxes are checked', async () => {
    await init()
    api.fetch.mockResolvedValueOnce(tool('browser_todo', 'plan', { action: 'set', items: ['提交并核对回执'] }))
      .mockResolvedValueOnce({ content: '我先汇报到这里，后面再继续。' })
      .mockResolvedValueOnce(tool('browser_get_page', 'verify'))
      .mockResolvedValueOnce(tool('browser_todo', 'check', { action: 'check', index: 1 }))
      .mockResolvedValueOnce({ content: '清单已勾选。' })
      .mockResolvedValueOnce(tool('browser_finish', 'receipt', { status: 'done', summary: '页面已确认提交成功' }))
      .mockResolvedValueOnce({ content: '任务已完成。' })
    const pending = send('执行并确认提交成功')
    await vi.advanceTimersByTimeAsync(0); await pending
    expect(api.fetch).toHaveBeenCalledTimes(7)
    expect(store.activeChat.value!.messages).toHaveLength(2)
    const message = store.activeChat.value!.messages.at(-1)!
    expect(message).toMatchObject({ status: 'done', taskOutcome: 'completed', waiting: false })
    expect(message.content).toContain('先汇报')
    expect(message.content).toContain('任务已完成')
    expect(message.todos).toMatchObject([{ status: 'done' }])
  })
  it('cannot bypass a rejected finish with a plain reply, but can report a real blocker without clearing the plan', async () => {
    await init()
    api.fetch.mockResolvedValueOnce(tool('browser_todo', 'plan', { action: 'set', items: ['提交并核对回执'] }))
      .mockResolvedValueOnce(tool('browser_finish', 'rejected', { status: 'done', summary: '做完了' }))
      .mockResolvedValueOnce({ content: '先结束本次处理。' })
      .mockResolvedValueOnce(tool('browser_finish', 'blocked', { status: 'blocked', summary: '需要用户完成验证码' }))
      .mockResolvedValueOnce({ content: '需要你完成验证码，提交尚未完成。' })
    const pending = send('提交并核对')
    await vi.advanceTimersByTimeAsync(0); await pending
    expect(api.fetch).toHaveBeenCalledTimes(5)
    expect(store.activeChat.value!.messages.at(-1)!).toMatchObject({ status: 'done', taskOutcome: 'blocked', todos: [{ status: 'pending' }] })
  })
  it('stops repeated non-actionable final replies as incomplete instead of showing success or using all 80 rounds', async () => {
    await init()
    api.fetch.mockResolvedValueOnce(tool('browser_todo', 'plan', { action: 'set', items: ['核对最终结果'] }))
      .mockResolvedValue({ content: '稍后我会继续。' })
    const pending = send('完成任务')
    await vi.advanceTimersByTimeAsync(0); await pending
    expect(api.fetch).toHaveBeenCalledTimes(4)
    expect(store.activeChat.value!.messages.at(-1)!).toMatchObject({ status: 'failed', taskOutcome: 'incomplete', waiting: false, todos: [{ status: 'pending' }] })
    expect(store.activeChat.value!.messages.at(-1)!.error).toContain('未继续执行')
  })
  it('does not attach an old unfinished plan to a new ordinary question', async () => {
    const session = await init()
    store.patchSession(session.id, current => ({ ...current, todos: [{ id: 'old', text: '上一轮未完成', status: 'pending' }] }))
    api.fetch.mockResolvedValueOnce({ content: '你好。' })
    const pending = send('你好')
    await vi.advanceTimersByTimeAsync(0); await pending
    expect(api.fetch).toHaveBeenCalledOnce()
    expect(store.activeChat.value!.messages.at(-1)!).toMatchObject({ status: 'done' })
    expect(store.activeChat.value!.messages.at(-1)!.taskOutcome).toBeUndefined()
    expect(store.activeChat.value!.todos?.[0].status).toBe('pending')
  })
  it('can explicitly update an old plan when resuming, making its remaining steps part of this turn', async () => {
    const session = await init()
    store.patchSession(session.id, current => ({ ...current, todos: [
      { id: 'saved', text: '保存', status: 'pending' }, { id: 'verify', text: '确认提交回执', status: 'pending' },
    ] }))
    api.fetch.mockResolvedValueOnce(tool('browser_todo', 'adopt', { action: 'check', id: 'saved' }))
      .mockResolvedValueOnce({ content: '现在已保存。' })
      .mockResolvedValueOnce(tool('browser_finish', 'blocked', { status: 'blocked', summary: '需要用户确认提交范围' }))
      .mockResolvedValueOnce({ content: '已保存，提交核对仍待处理。' })
    const pending = send('继续上次的任务')
    await vi.advanceTimersByTimeAsync(0); await pending
    expect(api.fetch).toHaveBeenCalledTimes(4)
    expect(store.activeChat.value!.messages.at(-1)!).toMatchObject({ taskOutcome: 'blocked', todos: [
      { id: 'saved', status: 'done' }, { id: 'verify', status: 'pending' },
    ] })
  })
  it('preserves the unfinished plan and marks failure when the next model request returns no result', async () => {
    await init()
    api.fetch.mockResolvedValueOnce(tool('browser_todo', 'plan', { action: 'set', items: ['核对最终结果'] }))
      .mockResolvedValueOnce(null)
    const pending = send('完成任务')
    await vi.advanceTimersByTimeAsync(0); await pending
    expect(api.fetch).toHaveBeenCalledTimes(2)
    expect(store.activeChat.value!.messages.at(-1)!).toMatchObject({ status: 'failed', taskOutcome: 'incomplete', waiting: false,
      todos: [{ status: 'pending' }] })
    expect(store.activeChat.value!.messages.at(-1)!.error).toContain('模型没有返回结果')
  })
})
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers() })

const tool = (name: string, id: string, args: unknown = {}) => ({
  content: '', tool_calls: [{ id, function: { name, arguments: JSON.stringify(args) } }],
})
const start = async (skipFinish = false) => {
  hydration.resolve(null); await store.chatStoreReady
  const created = store.createChat({ browserId: 'watched-video' })
  const at = Date.now()
  api.tick.mockImplementation(async () => ({ hasVideo: true, current: 10 + (Date.now() - at) / 1000,
    duration: 7200, paused: false, ended: false, mid: 'm2', visible: true }))
  api.fetch.mockResolvedValueOnce(tool('browser_watch', 'watch-call'))
    .mockResolvedValueOnce(skipFinish ? { content: '监控已挂好，之后会继续。' } : tool('browser_finish', 'waiting-call', { status: 'watching' }))
    .mockResolvedValueOnce(tool('browser_finish', 'done-call', { status: 'done' }))
    .mockResolvedValue({ content: '视频已完成，后续任务已核对完毕。' })
  const pending = send('完成视频任务')
  await vi.advanceTimersByTimeAsync(0)
  await vi.waitFor(() => expect(store.activeChat.value!.messages.at(-1)!.awaitingVideo, JSON.stringify(store.activeChat.value!.messages.at(-1))).toBe(true))
  return { pending, id: created.id, assistantId: store.activeChat.value!.messages.at(-1)!.id }
}
const endVideo = async () => {
  const { dispatchTickEvent } = await import('../../src/services/browser/pushEvents')
  dispatchTickEvent({ id: 'watched-video', tick: { current: 7200, duration: 7200, paused: true, ended: true, mid: 'm2', visible: true, hasVideo: true, src: 'video' } })
  await vi.advanceTimersByTimeAsync(0)
}

describe('same task video waiting with the actual model runner and watch event chain', () => {
  it('keeps a long video task pending without extra model calls or model timeout, then continues in the same assistant message', async () => {
    const run = await start()
    let returned = false; void run.pending.then(() => { returned = true })
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000)
    expect(returned).toBe(false)
    expect(api.fetch).toHaveBeenCalledTimes(2)
    expect(api.fetch.mock.calls[0][1].signal.aborted).toBe(false)
    expect(store.activeChat.value!.messages.at(-1)!).toMatchObject({ status: 'streaming', awaitingVideo: true, waiting: false })
    await endVideo(); await run.pending
    expect(store.activeChat.value!.messages).toHaveLength(2)
    expect(store.activeChat.value!.messages.at(-1)!).toMatchObject({ id: run.assistantId, status: 'done', awaitingVideo: false })
    expect(api.fetch).toHaveBeenCalledTimes(4)
    expect(store.activeChat.value!.messages.at(-1)!.content).toContain('后续任务已核对完毕')
  })
  it('prevents a plain final reply from ending the task while its video is still monitored', async () => {
    const run = await start(true)
    expect(store.activeChat.value!.messages.at(-1)!.status).toBe('streaming')
    await vi.advanceTimersByTimeAsync(10_000)
    expect(api.fetch).toHaveBeenCalledTimes(2)
    await endVideo(); await run.pending
    expect(store.activeChat.value!.messages).toHaveLength(2)
    expect(store.activeChat.value!.messages.at(-1)!.status).toBe('done')
  })
  it('cancels event waiting immediately and never resumes the model after explicit stop', async () => {
    const run = await start()
    store.stopChat(run.id)
    await run.pending
    expect(api.fetch.mock.calls[0][1].signal.aborted).toBe(true)
    expect(store.activeChat.value!.messages.at(-1)!).toMatchObject({ status: 'stopped', awaitingVideo: false })
    await endVideo()
    expect(api.fetch).toHaveBeenCalledTimes(2)
  })
  it('wakes the same task with an explicit failure when its monitor disappears', async () => {
    const run = await start()
    api.fetch.mockReset().mockResolvedValueOnce(tool('browser_finish', 'blocked-call', { status: 'blocked' }))
      .mockResolvedValue({ content: '监控登记丢失，当前任务受阻。' })
    const { stopChaoxingWatch } = await import('../../src/services/chaoxing/browser/watch')
    stopChaoxingWatch('watched-video')
    await vi.advanceTimersByTimeAsync(0); await run.pending
    expect(store.activeChat.value!.messages).toHaveLength(2)
    expect(store.activeChat.value!.messages.at(-1)!.content).toContain('当前任务受阻')
  })
})
