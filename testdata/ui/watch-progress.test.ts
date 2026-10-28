// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'
const state = vi.hoisted(() => ({} as { watches: Record<string, any> }))
vi.mock('../../src/services/platform/panelAccess', () => ({
  videoWatchFor: (id: string) => state.watches[id]?.sessionId ? state.watches[id] : null,
  agentWatchBusy: (id: string) => Boolean(state.watches[id]?.sessionId && ['watching', 'paused', 'stalled', 'captcha', 'quiz'].includes(state.watches[id].status)),
  formatVideoClock: (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`,
}))
vi.mock('../../src/services/browser/coursePlan', () => ({ coursePlanState: { byBrowser: {} }, coursePlanSummary: () => '' }))
vi.mock('../../src/services/agent/chat', () => ({ encodeFolderToken: () => '' }))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ readText: vi.fn(), writeText: vi.fn() }))
import BrowserAgentWatchBar from '../../src/components/browser/BrowserAgentWatchBar.vue'
import Composer from '../../src/views/agentChat/AgentChatComposer.vue'
let app: App, root: HTMLDivElement
const mount = (render: () => any) => {
  root = document.createElement('div'); document.body.append(root)
  app = createApp({ render }); app.mount(root)
}
const startWatch = (overrides = {}) => {
  state.watches['video-tab'] = { sessionId: 'chat-1', status: 'watching', title: '当前视频', current: 20, duration: 100, ...overrides }
  return state.watches['video-tab']
}
const progress = () => root.querySelector('[role="progressbar"]')
beforeEach(() => { state.watches = reactive({}) })
afterEach(() => { app?.unmount(); root?.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
describe('visible video watch progress', () => {
  it('updates elapsed time and progress while the model waits, and retains progress when paused', async () => {
    const live = startWatch()
    mount(() => h(BrowserAgentWatchBar, { browserId: 'video-tab' }))
    expect(root.textContent).toContain('监控中 · 当前视频 0:20 / 1:40')
    expect(progress()?.getAttribute('aria-valuenow')).toBe('20')
    live.current = 35; await nextTick()
    expect(progress()?.getAttribute('aria-valuenow')).toBe('35')
    live.status = 'paused'; await nextTick()
    expect(root.textContent).toContain('已暂停')
    expect(progress()?.getAttribute('aria-valuenow')).toBe('35')
    expect(root.textContent).not.toContain('已停止生成')
  })

  it('shows an indeterminate track until valid duration arrives, without inventing a percentage', async () => {
    const live = startWatch({ duration: 0 })
    mount(() => h(BrowserAgentWatchBar, { browserId: 'video-tab' }))
    expect(root.textContent).toContain('正在读取视频时长')
    expect(progress()?.classList.contains('is-indeterminate')).toBe(true)
    expect(progress()?.hasAttribute('aria-valuenow')).toBe(false)
    live.duration = Infinity; await nextTick()
    expect(progress()?.hasAttribute('aria-valuenow')).toBe(false)
    live.duration = 100; await nextTick()
    expect(progress()?.getAttribute('aria-valuenow')).toBe('20')
    expect(progress()?.classList.contains('is-indeterminate')).toBe(false)
  })

  it('reacts to registration, switching browser, and cancellation, without showing passive player observations as monitoring', async () => {
    const selected = reactive({ browserId: 'video-tab' })
    mount(() => h(BrowserAgentWatchBar, selected))
    expect(progress()).toBeNull()
    startWatch({ sessionId: '' }); await nextTick()
    expect(progress()).toBeNull()
    startWatch(); await nextTick()
    expect(progress()).not.toBeNull()
    selected.browserId = 'other-tab'; await nextTick()
    expect(progress()).toBeNull()
    selected.browserId = 'video-tab'; await nextTick()
    expect(progress()).not.toBeNull()
    delete state.watches['video-tab']; await nextTick()
    expect(progress()).toBeNull()
  })

  it('mounts status above the actual input and reports the whole overlay height when status/attachments change', async () => {
    let notifyResize: () => void = () => {}
    const disconnect = vi.fn()
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { notifyResize = callback }
      observe() {}
      disconnect = disconnect
    })
    let height = 108
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ height } as DOMRect))
    const sizes: number[] = []
    const props = reactive({
      draft: '', threadPinned: true, composerFiles: [], composerImages: [], sending: true,
      canSubmit: false, agentHasVision: false, agentModelLabel: '模型', composerPlaceholder: '发送消息',
      contextUsagePercent: 0, contextCompacting: false, contextUsageLabel: '', contextRingDash: '',
      contextUsageRows: [], contextTipNote: '', fileManagerLabel: '访达',
    })
    mount(() => h(Composer, { ...props, onHeightChange: (value: number) => sizes.push(value) }, {
      status: () => h(BrowserAgentWatchBar, { browserId: 'video-tab' }),
    }))
    const form = root.querySelector('form')!
    const status = form.querySelector('.composer-status')!
    const box = form.querySelector('.composer-box')!
    expect(status.nextElementSibling).toBe(box)
    expect(status.children.length).toBe(0)
    startWatch(); await nextTick()
    expect(status.querySelector('[role="progressbar"]')).not.toBeNull()
    expect(box.contains(progress())).toBe(false)
    height = 164; notifyResize()
    expect(sizes.at(-1)).toBe(164)
    props.sending = false; await nextTick()
    expect(progress()).not.toBeNull()
    height = 264; notifyResize()
    expect(sizes.at(-1)).toBe(264)
    delete state.watches['video-tab']; await nextTick()
    expect(status.children.length).toBe(0)
    height = 108; notifyResize()
    expect(sizes).toEqual([108, 164, 264, 108])
    app.unmount()
    expect(disconnect).toHaveBeenCalledOnce()
  })
})
