// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({} as Record<string, any>))
vi.mock('../../src/services/agent/chatStore', async () => {
  const { ref, computed } = await import('vue')
  const sessions = ref<any[]>([])
  let restore!: () => void
  const chatStoreReady = new Promise<void>(resolve => { restore = () => { sessions.value.push({ id: 'old-empty', browserId: 'same-browser', messages: [] }, { id: 'real-task', title: '课程任务', browserId: 'same-browser', messages: [{ role: 'assistant', content: '监控中' }] }); resolve() } })
  state.sessions = sessions; state.restore = restore
  return { sessions, chatStoreReady, activeChat: computed(() => sessions.value[0]),
    createChat: (init: any) => { const session = { id: 'empty-legacy', messages: [], ...init }; sessions.value.push(session); return session },
    liveSession: (id: string) => sessions.value.find(session => session.id === id),
    patchSession: (id: string, mutate: any) => { const session = sessions.value.find(session => session.id === id); Object.assign(session, mutate(session)) },
  }
})
vi.mock('../../src/services/browser/control', () => ({ listenBrowserControl: async () => () => {}, registerBrowserControl: vi.fn() }))
vi.mock('../../src/services/browser/appBrowser', () => ({
  listAppBrowsers: () => [{ id: 'same-browser', title: '已有课程', url: 'https://example.com/video' }],
  listenBrowserState: async () => () => {}, listenBrowserOpened: async () => () => {},
  browserHomeUrl: () => '', createAppBrowser: vi.fn(), openBrowserView: vi.fn(), patchAppBrowser: vi.fn(),
  closeBrowserView: vi.fn(), removeAppBrowser: vi.fn(), setSelectedBrowserId: vi.fn(),
}))
import { startAgentBrowserWorkspace } from '../../src/services/agent/agentBrowser'

describe('browser ownership after asynchronous history restoration', () => {
  it('waits for saved chats and removes only duplicate bindings, retaining both chat records', async () => {
    const starting = startAgentBrowserWorkspace()
    await Promise.resolve()
    expect(state.sessions.value).toHaveLength(0)
    state.restore()
    await starting
    expect(state.sessions.value.map((session: any) => session.id)).toEqual(['old-empty', 'real-task'])
    const owners = state.sessions.value.filter((session: any) => session.browserId === 'same-browser')
    expect(owners.map((session: any) => session.id)).toEqual(['real-task'])
    expect(state.sessions.value.find((session: any) => session.id === 'real-task').messages[0].content).toBe('监控中')
  })
})
