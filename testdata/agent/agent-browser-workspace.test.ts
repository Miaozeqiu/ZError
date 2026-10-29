// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
const native = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), opened: undefined as undefined | ((event: { payload: any }) => void) }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: native.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: native.listen }))
vi.mock('../../src/services/browser/appBrowser', () => {
  let serial = 0
  const list = () => JSON.parse(localStorage.getItem('test-tabs') || '[]')
  return {
    listAppBrowsers: list,
    browserHomeUrl: () => 'https://app.local/browser-home.html',
    isBrowserHome: (url: string) => !url || url.endsWith('browser-home.html'),
    closeBrowserView: vi.fn().mockResolvedValue(undefined),
    removeAppBrowser: (id: string) => localStorage.setItem('test-tabs', JSON.stringify(list().filter((tab: any) => tab.id !== id))),
    createAppBrowser: (input: any) => {
      const tab = { id: `tab-${++serial}`, ...input }
      localStorage.setItem('test-tabs', JSON.stringify([...list(), tab]))
      return tab
    },
    patchAppBrowser: (id: string, patch: any) => localStorage.setItem('test-tabs', JSON.stringify(list().map((tab: any) => tab.id === id ? { ...tab, ...patch } : tab))),
    setSelectedBrowserId: vi.fn(),
    openBrowserView: (id: string, url: string, bounds: any, hidden: boolean) => native.invoke('browser_open', { id, url, ...bounds, hidden }),
    listenBrowserState: (handler: any) => native.listen('app-browser-state', (event: any) => handler(event.payload)),
    listenBrowserOpened: (handler: any) => native.listen('app-browser-opened', (event: any) => handler(event.payload)),
  }
})

vi.mock('../../src/services/platform', () => ({ dropAllWatchQueues: vi.fn() }))
vi.mock('../../src/services/agent/chatWatch', () => ({ stopWatchFor: vi.fn() }))
vi.mock('../../src/services/agent/agentWait', () => ({ wakeAgentWait: vi.fn() }))
vi.mock('../../src/services/agent/debugLog', () => ({ writeBrowserTranscript: vi.fn() }))
import { activeChat, activeId, chatAborts, chatSessions, createChat, ensureBrowserChat, sessions } from '../../src/services/agent/chatStore'
import { applyBrowserControl, browserControlState, setBrowserControl } from '../../src/services/browser/control'
import { createAppBrowser, listAppBrowsers } from '../../src/services/browser/appBrowser'
import { browserTabLimitNotice, MAX_BROWSER_TABS } from '../../src/services/browser/tabLimits'
import {
  agentBrowserExpanded, bindChatBrowser, browserIdsForChat, currentAgentBrowsers,
  ensureAgentBrowser, startAgentBrowserWorkspace,
} from '../../src/services/agent/agentBrowser'
import { assembleAgentTools, availableAgentTools } from '../../src/services/agent/tools'
import { buildAgentSystemPrompt } from '../../src/services/agent/prompts'

describe('统一 Agent 浏览器工作区', () => {
  beforeEach(() => {
    localStorage.clear()
    for (const key of Object.keys(browserControlState)) delete browserControlState[key]
    chatAborts.clear()
    sessions.value = []
    activeId.value = null
    native.invoke.mockReset().mockResolvedValue(undefined)
    native.listen.mockImplementation(async (name, handler) => {
      if (name === 'app-browser-opened') native.opened = handler
      return () => undefined
    })
  })

  it.each(['native', 'button'])('%s 接管立即停止当前回合，交还不续跑且不影响其它对话', async source => {
    const chat = createChat()
    const other = createChat()
    for (const item of [chat, other]) {
      sessions.value.find(session => session.id === item.id)!.messages.push({
        id: `reply-${item.id}`, role: 'assistant', status: 'streaming', waiting: true, content: '', steps: [],
      })
    }
    const abort = new AbortController()
    const otherAbort = new AbortController()
    chatAborts.set(chat.id, abort)
    chatAborts.set(other.id, otherAbort)
    const user = { sessionId: chat.id, owner: 'user' as const, epoch: 1 }
    if (source === 'native') applyBrowserControl(user)
    else {
      native.invoke.mockResolvedValueOnce(user)
      const switching = setBrowserControl('tab-test', chat.id, 'user')
      expect(abort.signal.aborted).toBe(true) // 不等待原生 IPC 返回
      await switching
    }
    expect(abort.signal.aborted).toBe(true)
    expect(chatAborts.has(chat.id)).toBe(false)
    const reply = sessions.value.find(session => session.id === chat.id)!.messages.at(-1)!
    expect(reply).toMatchObject({ status: 'stopped', waiting: false })
    expect(otherAbort.signal.aborted).toBe(false)
    applyBrowserControl({ sessionId: chat.id, owner: 'agent', epoch: 2 })
    expect(reply.status).toBe('stopped')
    expect(chatAborts.has(chat.id)).toBe(false)
  })

  it('普通对话拥有网页操作和题库工具，搜索和 Skill 无重复声明', () => {
    const tools = assembleAgentTools()
    const names = tools.map(tool => tool.function.name)
    expect(names).toEqual(expect.arrayContaining(['browser_navigate', 'browser_get_page', 'browser_click', 'browser_set_checked', 'browser_finish', 'present_quiz', 'web_search', 'read_agent_skill']))
    expect(new Set(names).size).toBe(names.length)
    expect(availableAgentTools(tools, { enabled: false }).some(tool => tool.function.name === 'web_search')).toBe(false)
    expect(buildAgentSystemPrompt()).toContain('需要网页时直接调用 browser_navigate')
  })

  it('打开浏览器前不创建标签；首次调用后台创建，后续复用且不展开小窗', async () => {
    const chat = createChat()
    expect(listAppBrowsers()).toHaveLength(0)
    const [id, same] = await Promise.all([ensureAgentBrowser(chat.id), ensureAgentBrowser(chat.id)])
    expect(id).toBe(same)
    expect(activeChat.value?.browserId).toBe(id)
    expect(agentBrowserExpanded.value).toBe(false)
    expect(native.invoke.mock.calls.filter(call => call[0] === 'browser_open')).toHaveLength(1)
    expect(native.invoke).toHaveBeenCalledWith('browser_open', expect.objectContaining({ id, hidden: true }))
    await ensureAgentBrowser(chat.id)
    expect(native.invoke.mock.calls.filter(call => call[0] === 'browser_open')).toHaveLength(1)
  })

  it('切换对话不会复用另一个对话的网页，后台工具不会改变前台对话', async () => {
    const first = createChat()
    const firstId = await ensureAgentBrowser(first.id)
    const second = createChat()
    const secondId = await ensureAgentBrowser(second.id)
    expect(firstId).not.toBe(secondId)
    await ensureAgentBrowser(first.id)
    expect(activeChat.value?.id).toBe(second.id)
    expect(currentAgentBrowsers.value.map(tab => tab.id)).toEqual([secondId])
    expect(browserIdsForChat(sessions.value.find(chat => chat.id === first.id))).toEqual([firstId])
  })

  it('打开失败后可以重试，保留同一标签和对话记录', async () => {
    const chat = createChat()
    native.invoke.mockRejectedValueOnce(new Error('启动失败'))
    await expect(ensureAgentBrowser(chat.id)).rejects.toThrow('启动失败')
    const id = activeChat.value?.browserId
    expect(await ensureAgentBrowser(chat.id)).toBe(id)
    expect(listAppBrowsers()).toHaveLength(1)
  })

  it('旧浏览器对话出现在统一列表，切换标签时不会删除其他对话', () => {
    const first = createChat({ title: '网页一', browserId: 'old-one' })
    const second = createChat({ title: '网页二', browserId: 'old-two' })
    bindChatBrowser(first.id, 'popup')
    expect(ensureBrowserChat({ browserId: 'popup' })?.id).toBe(first.id)
    expect(chatSessions.value.map(chat => chat.id)).toEqual([second.id, first.id])
    expect(sessions.value.find(chat => chat.id === second.id)?.title).toBe('网页二')
  })

  it('弹出新标签归属发起它的后台对话，不抢前台对话', async () => {
    const owner = createChat()
    const openerId = await ensureAgentBrowser(owner.id)
    const front = createChat()
    await startAgentBrowserWorkspace()
    native.opened?.({ payload: { id: 'popup-background', url: 'https://example.com/popup', openerId } })
    await Promise.resolve()
    expect(activeChat.value?.id).toBe(front.id)
    expect(sessions.value.find(chat => chat.id === owner.id)?.browserId).toBe('popup-background')
    expect(browserIdsForChat(sessions.value.find(chat => chat.id === owner.id))).toEqual([openerId, 'popup-background'])
  })

  it('标签上限按来源对话计算，拒绝满额弹窗后不影响另一个对话', async () => {
    const owner = createChat()
    const openerId = await ensureAgentBrowser(owner.id)
    for (let index = 1; index < MAX_BROWSER_TABS; index++) {
      const tab = createAppBrowser({ url: `https://example.com/${index}` })
      bindChatBrowser(owner.id, tab.id)
    }
    const front = createChat()
    const frontId = await ensureAgentBrowser(front.id)
    await startAgentBrowserWorkspace()

    native.opened?.({ payload: { id: 'popup-over-limit', url: 'https://example.com/blocked', openerId } })
    expect(listAppBrowsers().some(tab => tab.id === 'popup-over-limit')).toBe(false)
    expect(browserIdsForChat(sessions.value.find(chat => chat.id === owner.id))).toHaveLength(MAX_BROWSER_TABS)
    expect(browserTabLimitNotice.value).toMatchObject({ code: 'tab_limit', source: 'popup', openerId, sessionId: owner.id })
    expect(activeChat.value?.id).toBe(front.id)

    native.opened?.({ payload: { id: 'popup-other-session', url: 'https://example.com/allowed', openerId: frontId } })
    await Promise.resolve()
    expect(browserIdsForChat(sessions.value.find(chat => chat.id === front.id))).toEqual([frontId, 'popup-other-session'])
    expect(listAppBrowsers()).toHaveLength(MAX_BROWSER_TABS + 2)
  })
})
