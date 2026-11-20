// @vitest-environment jsdom
vi.mock('../../src/services/model/providers', () => ({ createBuiltinProvider: () => null }))
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  vision: false, disabledTools: new Set<string>(), read: vi.fn(), write: vi.fn(), redact: vi.fn(), subjects: vi.fn(), run: vi.fn(), claim: vi.fn(), fetch: vi.fn(), tick: vi.fn(), watchRead: vi.fn(), bind: vi.fn(), flush: vi.fn(), drop: vi.fn(), stopWatch: vi.fn(), execute: vi.fn(), recoverPause: vi.fn(), pageUrl: vi.fn(),
}))
vi.mock('../../src/services/security/secureStore', () => ({
  readSecureDocument: api.read, writeSecureDocument: api.write, redactNative: api.redact,
}))
vi.mock('../../src/services/app/database', () => ({ databaseService: { listStudySubjects: api.subjects } }))
vi.mock('../../src/services/browser/appBrowser', () => ({ peekAppBrowserUrl: api.pageUrl }))
vi.mock('../../src/services/agent/agentBrowser', () => ({
  ensureAgentBrowser: async () => 'watched-video',
  requestAgentBrowserReveal: vi.fn(), releaseChatBrowsers: vi.fn(),
}))
vi.mock('../../src/services/browser/control', async () => {
  const state: Record<string, any> = (await import('vue')).reactive({})
  return { browserControlState: state, claimBrowserForNewMessage: api.claim, browserControlRevision: () => 0,
    controlForSession: (id: string) => state[id], userControlsBrowser: (id: string) => state[id]?.owner === 'user' }
})
vi.mock('../../src/services/model/config', () => ({
  modelHasVision: () => api.vision,
  modelConfigManager: { ready: Promise.resolve(), getPlatformApiKey: () => 'test-key', getSelectedAgentModel: () => ({ id: 'test-model' }),
    getSelectedTextModel: () => ({ id: 'test-model' }),
    getSettings: () => ({ platforms: [{ id: 'test', apiKey: 'test-key', baseUrl: 'https://model.test', models: [{ id: 'test-model' }] }] }) },
}))
vi.mock('../../src/services/model/protocol', () => ({ resolveRuntimeModelId: () => 'test-model',
  resolveExecutableModelJsCode: () => "async function processModel(input, config, fetch, signal) { return fetch('https://model.test', {signal, body: JSON.stringify({ tools: input.tools, messages: input.messages })}); }" }))
vi.mock('../../src/services/security/secureFetch', () => ({ secureFetch: api.fetch }))
vi.mock('../../src/services/study/graphStream', () => ({ studyGraphStream: { value: null }, finishStudyGraphStream: vi.fn() }))
vi.mock('../../src/services/study/timelineSummary', () => ({ finalizeStudySessionSummary: vi.fn() }))
vi.mock('../../src/services/agent/agentProfiles', () => ({ getActiveAgentProfile: () => ({}) }))
vi.mock('../../src/services/agent/agentSkills', () => ({ getEnabledSkillCatalog: () => [] }))
vi.mock('../../src/services/agent/browserLoop', () => ({ formatBrowserLiveContext: () => '' }))
vi.mock('../../src/services/agent/browserTask', () => ({ rememberBrowserTaskIntent: vi.fn(), clearBrowserTaskIntent: vi.fn() }))
vi.mock('../../src/services/platform', () => ({ bindAllWatchAgents: api.bind, flushAllWatchAfterTurn: api.flush, dropAllWatchQueues: api.drop }))
vi.mock('../../src/services/platform/panelAccess', async () => ({
  packAgentPanel: () => null,
  videoWatchFor: api.watchRead,
  chapterStateFor: () => null,
}))
vi.mock('../../src/services/platform/watchBind', () => ({ flushAllWatchAfterTurn: api.flush }))
vi.mock('../../src/services/agent/activity', () => ({ describeActivity: (name: string) => ({ label: name }) }))
vi.mock('../../src/services/agent/import', () => ({ parseQuestions: () => [] }))
vi.mock('../../src/utils/question/quizPractice', () => ({ getQuizCards: () => [], parseQuizCards: () => [], resolveQuizTitle: () => '', saveQuizTitle: vi.fn() }))
vi.mock('../../src/services/agent/executeChatTool', () => ({ executeChatTool: async ({ call, ctx }: any) => {
  if (api.execute.getMockImplementation()) return api.execute(call, ctx)
  if (['browser_watch', 'browser_complete_chapter', 'browser_start_chapter_tasks'].includes(call.name)) {
    const { startChaoxingWatch } = await import('../../src/services/chaoxing/browser/watch')
    startChaoxingWatch('watched-video', ctx.sessionId, { current: 10, duration: 7200, paused: false, mid: 'm2' },
      call.name === 'browser_watch' ? undefined : { recoverPause: api.recoverPause })
    return JSON.stringify({ ok: true, watching: true })
  }
  const status = JSON.parse(call.arguments).status
  return JSON.stringify({ ok: true, status, finished: status !== 'watching', awaitingVideo: status === 'watching' })
} }))
vi.mock('../../src/services/chaoxing/browser/playback', () => ({ ensureStudyWatch: vi.fn(), liveStudyPlayback: () => ({ playing: false }) }))
vi.mock('../../src/services/agent/chatWatch', () => ({ stopWatchFor: api.stopWatch }))
vi.mock('../../src/services/agent/agentApproval', async importOriginal => ({ ...await importOriginal<typeof import('../../src/services/agent/agentApproval')>(), cancelApprovalsForSession: vi.fn() }))

vi.mock('../../src/services/agent/subagent/owner', () => ({ abortChildrenOf: vi.fn() }))
vi.mock('../../src/services/agent/chatStudy', () => ({
  browserStatePrefix: async () => '', studyStatePrefix: async () => '', lastUserText: () => '',
  loadLiveExploreRefs: vi.fn(), maybeCompactContext: vi.fn(), modelUserContent: (text: string) => text,
  scheduleStudyProgressEval: vi.fn(), clearStudyEvalCooldown: vi.fn(), shouldAutoEvalStudy: () => ({ yes: false }), toMultimodalUserContent: vi.fn(),
}))
vi.mock('../../src/services/agent/context', () => ({
  contextSummaryPrompt: () => '', splitCompactedHistory: () => ({ kept: [] }),
}))
vi.mock('../../src/services/agent/debugLog', () => ({ clipAgentDebug: (text: string) => text, logAgentDebug: vi.fn(), writeBrowserTranscript: vi.fn(), writeDebugDump: vi.fn() }))
vi.mock('../../src/services/agent/tools', async () => {
  const { BROWSER_PRIMITIVE_TOOLS } = await import('../../src/services/agent/toolDefs/browserPrimitiveTools')
  const { websiteToolNames } = await import('../../src/services/agent/websiteToolDefinitions')
  return { assembleAgentTools: () => [...BROWSER_PRIMITIVE_TOOLS,
    ...websiteToolNames.map(name => ({ type: 'function', function: { name } }))], availableAgentTools: (tools: any[]) => tools.filter(tool => !api.disabledTools.has(tool.function.name)) }
})
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
  api.vision = false; api.disabledTools.clear()
  api.read.mockReturnValue(hydration.promise)
  api.write.mockResolvedValue(undefined)
  api.redact.mockImplementation(async value => value)
  api.subjects.mockResolvedValue([])
  api.claim.mockResolvedValue(false)
  api.pageUrl.mockReturnValue('')
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
  it('sends deferred schemas only after discovery and executes with the original handler', async () => {
    await init()
    const schemas: string[][] = []
    const replies = [
      tool('load_agent_tools', 'discover', { names: ['browser_find'] }),
      tool('browser_find', 'find', { query: '课程' }),
      { content: '已核对。' },
    ]
    api.fetch.mockImplementation(async (_url, options) => {
      schemas.push(JSON.parse(options.body).tools.map((t: any) => t.function.name))
      return replies.shift()
    })
    const pending = send('查找课程文字')
    await vi.advanceTimersByTimeAsync(0); await pending
    expect(schemas[0]).toContain('load_agent_tools')
    expect(schemas[0]).not.toContain('browser_find')
    expect(schemas[1]).toContain('browser_find')
    expect(api.execute.mock.calls.map(([call]) => call.name)).toEqual(['browser_find'])
  })
  it.each([
    { ok: true, loggedIn: false, challenge: 'image_captcha', captcha_id: 'retry-image' },
    { ok: false, loggedIn: false, reason: 'invalid', error: '验证码错误' },
    { ok: false, loggedIn: true, reason: 'invalid', error: '登录失败' },
  ])('restores discovery after confirmed captcha login, retaining restrictions for receipt %j', async retry => {
    hydration.resolve(null); await store.chatStoreReady
    store.createChat({ browserId: 'watched-video' })
    api.vision = true
    const image = 'data:image/png;base64,' + 'a'.repeat(64)
    let loginCalls = 0
    api.execute.mockImplementation(async (call) => {
      if (call.name === 'browser_login_zjooc') {
        loginCalls++
        if (loginCalls === 1) return JSON.stringify({ ok: true, loggedIn: false, challenge: 'image_captcha', captcha_id: 'initial-image', captchaImage: image })
        if (loginCalls === 2) return JSON.stringify(retry)
        // A settings change during login must remain effective after the tool directory is restored.
        api.disabledTools.add('browser_scroll')
        return '{"ok":true,"loggedIn":true}'
      }
      if (call.name === 'browser_finish') return '{"ok":true,"finished":true,"status":"done"}'
      return '{"ok":true,"snapshot":"课程已找到"}'
    })
    const schemas: any[][] = []
    const contexts: string[] = []
    const replies = [
      tool('browser_login_zjooc', 'captcha-retry', { captcha_id: 'initial-image', captcha_code: '12345' }),
      tool('browser_login_zjooc', 'captcha-success', { captcha_id: 'retry-image', captcha_code: '54321' }),
      tool('load_agent_tools', 'after-login-load', { names: ['browser_find'] }),
      tool('browser_find', 'after-login-find', { query: '课程' }),
      { content: '已登录并核对课程。' },
    ]
    api.fetch.mockImplementation(async (_url, options) => {
      const request = JSON.parse(options.body)
      schemas.push(request.tools)
      contexts.push(JSON.stringify(request.messages))
      return replies.shift()
    })
    const pending = send('登录在浙学')
    await vi.advanceTimersByTimeAsync(0); await pending
    expect(schemas).toHaveLength(5)
    for (const round of schemas.slice(0, 2)) {
      expect(new Set(round.map(tool => tool.function.name))).toEqual(new Set(['browser_login_zjooc', 'browser_finish']))
    }
    const restored = schemas[2].map(tool => tool.function.name)
    expect(restored).toContain('load_agent_tools')
    expect(restored).not.toContain('browser_find')
    const directory = schemas[2].find(tool => tool.function.name === 'load_agent_tools')
    expect(directory.function.parameters.properties.names.items.enum).not.toContain('browser_scroll')
    expect(contexts[2]).toContain('【登录已确认】')
    expect(schemas[3].map(tool => tool.function.name)).toContain('browser_find')
    const message = store.activeChat.value!.messages.at(-1)!
    expect(message).toMatchObject({ status: 'done' })
    expect(message.steps.find(step => step.id === 'after-login-load')).toMatchObject({ status: 'done' })
    expect(message.steps.find(step => step.id === 'after-login-find')).toMatchObject({ status: 'done' })
    expect(api.execute.mock.calls.filter(([call]) => call.name === 'browser_find')).toHaveLength(1)
  })
  it('accepts the first final reply after a verified login through the normal finish gate', async () => {
    hydration.resolve(null); await store.chatStoreReady
    store.createChat({ browserId: 'watched-video' })
    api.vision = true
    const image = 'data:image/png;base64,' + 'a'.repeat(64)
    api.execute.mockResolvedValueOnce(JSON.stringify({ ok: true, loggedIn: false, challenge: 'image_captcha', captcha_id: 'initial', captchaImage: image }))
      .mockResolvedValueOnce('{"ok":true,"loggedIn":true}')
      .mockResolvedValueOnce('{"ok":true,"finished":true,"status":"done"}')
    api.fetch.mockResolvedValueOnce(tool('browser_login_zjooc', 'login', { captcha_id: 'initial', captcha_code: '12345' }))
      .mockResolvedValueOnce({ content: '已登录。' })
    const pending = send('登录在浙学')
    await vi.advanceTimersByTimeAsync(0); await pending
    expect(store.activeChat.value!.messages.at(-1)).toMatchObject({ taskOutcome: 'completed', content: '已登录。' })
    expect(api.execute.mock.calls.map(([call]) => call.name)).toEqual(['browser_login_zjooc', 'browser_login_zjooc', 'browser_finish'])
    expect(api.fetch).toHaveBeenCalledTimes(2)
  })
  it('删除会话和触及列表上限时释放会话的题目列表与工具计数', async () => {
    const session = await init()
    const { rememberListed, listedQuestionsOf } = await import('../../src/services/agent/toolShared')
    const { noteToolRoundForTodo, toolRoundsWithoutTodoOf } = await import('../../src/services/agent/browserTodo')
    const { noteFailAttempt, failCountOf } = await import('../../src/services/agent/failGate')
    const seed = (id: string) => {
      rememberListed(id, [{ id: 42 }])
      noteToolRoundForTodo(id, false, false)
      noteFailAttempt(id, 'browser_click', {}, false)
    }
    seed(session.id)
    expect(listedQuestionsOf(session.id)).toHaveLength(1)
    store.removeChat(session.id)
    expect(api.stopWatch).toHaveBeenCalledWith('task-browser')
    await vi.advanceTimersByTimeAsync(0)
    expect(listedQuestionsOf(session.id)).toHaveLength(0)
    expect(toolRoundsWithoutTodoOf(session.id)).toBe(0)
    expect(failCountOf(session.id, 'browser_click', {})).toBe(0)
    const old = store.createChat()
    seed(old.id)
    for (let index = 0; index < 40; index++) {
      await vi.advanceTimersByTimeAsync(1)
      store.createChat()
    }
    await vi.advanceTimersByTimeAsync(0)
    expect(store.sessions.value.some(item => item.id === old.id)).toBe(false)
    expect(listedQuestionsOf(old.id)).toHaveLength(0)
    expect(toolRoundsWithoutTodoOf(old.id)).toBe(0)
  })
  it('completion storage failure is reported as failed and a new turn can recover the original run', async () => {
    await init()
    api.write.mockImplementation(async (_name, payload) => {
      if (payload.some((session: any) => session.messages?.some((message: any) => message.run?.status === 'completed'))) throw new Error('completion storage unavailable')
    })
    api.fetch.mockResolvedValueOnce({ content: '第一轮结果' })
    const first = send('原始核对任务')
    await vi.advanceTimersByTimeAsync(0); await first
    const failed = store.activeChat.value!.messages.at(-1)!
    expect(failed).toMatchObject({ status: 'failed', run: { status: 'failed' } })
    expect(failed.error).toContain('completion storage unavailable')
    await vi.advanceTimersByTimeAsync(1)
    api.write.mockResolvedValue(undefined)
    api.execute.mockResolvedValue('{"ok":true,"snapshot":"当前页面已核对"}')
    api.fetch.mockResolvedValueOnce(tool('browser_get_page', 'recovery-page'))
      .mockResolvedValueOnce({ content: '已核对当前页面' })
    const resumed = send('继续')
    await vi.advanceTimersByTimeAsync(0); await resumed
    expect(store.activeChat.value!.messages.at(-1)!).toMatchObject({ status: 'done', run: { status: 'completed', recoveredFrom: failed.run!.id, goalMessageId: failed.run!.goalMessageId } })
  })
  it('stores full redacted tool text in the encrypted document while keeping the UI result bounded and parseable', async () => {
    await init()
    const raw = JSON.stringify({ ok: true, content: '题'.repeat(25000) + '完整题目末尾' })
    api.execute.mockResolvedValue(raw)
    api.fetch.mockResolvedValueOnce(tool('browser_get_page', 'large-page')).mockResolvedValueOnce({ content: '已读取' })
    const pending = send('读取资料')
    await vi.advanceTimersByTimeAsync(0); await pending
    const message = store.activeChat.value!.messages.at(-1)!
    expect(message.transcript!.find(item => item.tool_call_id === 'large-page')?.content).toBe(raw)
    const preview = JSON.parse(message.steps.find(step => step.id === 'large-page')!.result!)
    expect(preview).toMatchObject({ truncated: true, history_ref: 'large-page' })
    await store.flushChatCheckpoint()
    const payload = api.write.mock.calls.at(-1)![1]
    expect(payload[0].messages.at(-1).transcript.find((item: any) => item.tool_call_id === 'large-page').content).toBe(raw)
  })
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
    .mockResolvedValueOnce(skipFinish ? { content: '监控已挂好，之后会继续。' } : tool('browser_finish', 'waiting-call', { status: 'watching', summary: '已挂监控，等待视频结束' }))
    .mockResolvedValueOnce(tool('browser_finish', 'done-call', { status: 'done', summary: '视频与剩余任务已核对' }))
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
  it('finishes an explicit login request with confirmed host receipts before requesting a model', async () => {
    hydration.resolve(null); await store.chatStoreReady
    store.createChat({ browserId: 'watched-video' })
    api.execute.mockImplementation(async (call) => call.name === 'browser_login_chaoxing'
      ? '{"ok":true,"loggedIn":true}'
      : '{"ok":true,"status":"done","finished":true}')
    const pending = send('登录下学习通')
    await vi.advanceTimersByTimeAsync(0)
    await pending
    const message = store.activeChat.value!.messages.at(-1)!
    expect(message).toMatchObject({ status: 'done', content: '学习通已登录。', run: { status: 'completed', usage: { requests: 0 } } })
    expect(api.execute.mock.calls.map(([call]) => call.name)).toEqual(['browser_login_chaoxing', 'browser_finish'])
    expect(api.fetch).not.toHaveBeenCalled()
  })

  it('starts a named chapter workflow directly without a planning or todo round', async () => {
    hydration.resolve(null); await store.chatStoreReady
    store.createChat({ browserId: 'watched-video' })
    api.pageUrl.mockReturnValue('https://i.chaoxing.com/base')
    api.execute.mockImplementation(async (call) => call.name === 'browser_start_chapter_tasks'
      ? '{"ok":true,"status":"course_complete","courseComplete":true,"completed":44}'
      : '{"ok":true,"status":"done","finished":true}')
    const pending = send('完成下 推理社 的章节')
    await vi.advanceTimersByTimeAsync(0)
    await pending
    expect(JSON.parse(api.execute.mock.calls[0][0].arguments)).toEqual({ course_name: '推理社' })
    expect(api.execute.mock.calls.map(([call]) => call.name)).toEqual(['browser_start_chapter_tasks', 'browser_finish'])
    expect(api.fetch).not.toHaveBeenCalled()
  })

  it('keeps a long video task pending without extra model calls or model timeout, then continues in the same assistant message', async () => {
    const run = await start()
    let returned = false; void run.pending.then(() => { returned = true })
    await vi.advanceTimersByTimeAsync(20 * 60 * 1000)
    expect(returned).toBe(false)
    expect(api.fetch).toHaveBeenCalledTimes(2)
    expect(api.fetch.mock.calls[0][1].signal.aborted).toBe(false)
    expect(store.activeChat.value!.messages.at(-1)!).toMatchObject({ status: 'streaming', awaitingVideo: true, waiting: false, run: { status: 'waiting_video', usage: { requests: 2 } } })
    await endVideo(); await run.pending
    expect(store.activeChat.value!.messages).toHaveLength(2)
    expect(store.activeChat.value!.messages.at(-1)!).toMatchObject({ id: run.assistantId, status: 'done', awaitingVideo: false, run: { status: 'completed' } })
    expect(api.fetch).toHaveBeenCalledTimes(4)
    expect(store.activeChat.value!.messages.at(-1)!.content).toContain('后续任务已核对完毕')
  })
  it.each(['browser_complete_chapter', 'browser_start_chapter_tasks'])('%s waits inside the tool and resumes without an extra model call', async (name) => {
    hydration.resolve(null); await store.chatStoreReady
    store.createChat({ browserId: 'watched-video' })
    api.fetch.mockResolvedValueOnce(tool(name, 'chapter-watch', { chapter_key: '3:4:5' }))
      .mockResolvedValueOnce(tool('browser_finish', 'chapter-done', { status: 'done', summary: '任务点已经核对' }))
      .mockResolvedValueOnce({ content: '视频任务已完成。' })
    const pending = send('完成当前章节')
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => expect(store.activeChat.value!.messages.at(-1)).toMatchObject({ awaitingVideo: true, run: { status: 'waiting_video' } }))
    expect(api.fetch).toHaveBeenCalledOnce()
    const { dispatchTickEvent } = await import('../../src/services/browser/pushEvents')
    const tick = { current: 24, duration: 7200, paused: true, ended: false, mid: 'm2', visible: true, hasVideo: true }
    api.recoverPause.mockResolvedValueOnce({ ...tick, paused: false })
    dispatchTickEvent({ id: 'watched-video', tick })
    await vi.advanceTimersByTimeAsync(1600)
    expect(api.recoverPause).toHaveBeenCalledOnce()
    expect(api.fetch).toHaveBeenCalledOnce()
    expect(api.watchRead('watched-video')).toMatchObject({ status: 'watching', paused: false })
    await endVideo()
    await pending
    const message = store.activeChat.value!.messages.at(-1)!
    expect(message.status).toBe('done')
    expect(JSON.parse(message.steps.find(step => step.id === 'chapter-watch')!.result!)).toMatchObject({ status: 'video_event', watching: false })
    expect(api.fetch).toHaveBeenCalledTimes(3)
  })

  it('resumes the previously verified video locally before the first model request', async () => {
    hydration.resolve(null); await store.chatStoreReady
    const session = store.createChat({ browserId: 'watched-video' })
    api.pageUrl.mockReturnValue('https://mooc1.chaoxing.com/mycourse/studentstudy?courseId=3&clazzid=4&chapterId=5')
    const { newRun } = await import('../../src/services/agent/core/run')
    const now = Date.now()
    const op = { id: 'old-play', tool: 'browser_click', browserId: 'watched-video', state: 'dispatched' as const, at: now - 50, sequence: 5 }
    const previous = {
      id: 'old', role: 'assistant' as const, status: 'stopped' as const, content: '',
      run: { ...newRun('old'), browserId: 'watched-video', status: 'interrupted' as const, operations: [op], goalMessageId: 'goal' },
      steps: [
        { id: 'page', kind: 'tool' as const, name: 'browser_get_page', label: '', status: 'done' as const, startedAt: now - 100,
          result: JSON.stringify({ snapshot: '- button "播放视频" [ref=e7]' }) },
        { id: 'click', kind: 'tool' as const, name: 'browser_click', label: '', status: 'done' as const, startedAt: now - 60, finishedAt: now - 40,
          arguments: '{"ref":"e7"}', result: '{"ok":true}' },
        { id: 'watch', kind: 'tool' as const, name: 'browser_watch', label: '', status: 'done' as const, startedAt: now - 30,
          result: '{"watching":true,"video":{"mid":"m2"}}' },
      ],
    }
    store.patchSession(session.id, current => ({ ...current, messages: [
      { id: 'goal', role: 'user', content: '完成当前章节', status: 'done', steps: [] }, previous,
    ] }))
    api.execute.mockImplementation(async (call, ctx) => {
      if (call.name === 'browser_review_chapter') return '{"ok":true,"chapterKey":"3:4:5","videoMid":"m2","videoJobDone":false}'
      if (call.name === 'browser_complete_chapter') {
        const { startChaoxingWatch } = await import('../../src/services/chaoxing/browser/watch')
        startChaoxingWatch('watched-video', ctx.sessionId, { current: 10, duration: 7200, paused: false, mid: 'm2' })
        return '{"ok":true,"watching":true,"videoMid":"m2"}'
      }
      return '{"ok":true,"status":"done","finished":true}'
    })
    api.fetch.mockResolvedValueOnce(tool('browser_finish', 'done-local', { status: 'done', summary: '原视频已完成' }))
      .mockResolvedValueOnce({ content: '原视频已完成。' })
    const pending = send('继续')
    await vi.advanceTimersByTimeAsync(0)
    await vi.waitFor(() => expect(store.activeChat.value!.messages.at(-1)).toMatchObject({ awaitingVideo: true }))
    expect(api.fetch).not.toHaveBeenCalled()
    expect(api.execute.mock.calls.map(call => call[0].name)).toEqual(['browser_review_chapter', 'browser_complete_chapter'])
    expect(JSON.parse(api.execute.mock.calls[1][0].arguments)).toMatchObject({ video_mid: 'm2', chapter_key: '3:4:5' })
    const verification = store.activeChat.value!.messages.at(-1)!.steps.find(step => step.name === 'browser_verify_operation')
    expect(JSON.parse(verification?.arguments || '{}')).toMatchObject({ operation_id: 'old-play', outcome: 'completed' })
    expect(JSON.parse(verification?.result || '{}')).toMatchObject({ ok: true, outcome: 'completed' })
    await endVideo()
    await pending
    expect(api.fetch).toHaveBeenCalledTimes(2)
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
    expect(store.activeChat.value!.messages.at(-1)!).toMatchObject({ status: 'stopped', awaitingVideo: false, run: { status: 'interrupted' } })
    await endVideo()
    expect(api.fetch).toHaveBeenCalledTimes(2)
  })
  it('wakes the same task with an explicit failure when its monitor disappears', async () => {
    const run = await start()
    api.fetch.mockReset().mockResolvedValueOnce(tool('browser_finish', 'blocked-call', { status: 'blocked', summary: '监控已丢失，需要用户核对' }))
      .mockResolvedValue({ content: '监控登记丢失，当前任务受阻。' })
    const { stopChaoxingWatch } = await import('../../src/services/chaoxing/browser/watch')
    stopChaoxingWatch('watched-video')
    await vi.advanceTimersByTimeAsync(0); await run.pending
    expect(store.activeChat.value!.messages).toHaveLength(2)
    expect(store.activeChat.value!.messages.at(-1)!.content).toContain('当前任务受阻')
  })
})
