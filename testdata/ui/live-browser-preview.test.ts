// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, ref, type App } from 'vue'
const test = vi.hoisted(() => ({
  selected: undefined as any, expanded: undefined as any, sessionId: undefined as any,
  bounds: vi.fn(), show: vi.fn(), hide: vi.fn(), ensure: vi.fn(), control: vi.fn(), screenshot: vi.fn(),
}))
vi.mock('../../src/services/agent/chatStore', () => ({
  activeChat: { __v_isRef: true, value: { id: 'chat-1', messages: [] } }, activeChatId: { __v_isRef: true, get value() { return test.sessionId.value } },
  createChat: () => ({ id: 'chat-1' }), patchSession: vi.fn(),
}))
vi.mock('../../src/services/agent/agentBrowser', () => ({
  agentBrowserExpanded: { __v_isRef: true, get value() { return test.expanded.value }, set value(value) { test.expanded.value = value } },
  currentAgentBrowser: { __v_isRef: true, get value() { return test.selected.value } }, currentAgentBrowsers: { __v_isRef: true, value: [] },
  bindChatBrowser: vi.fn(), browserIdsForChat: () => [], ensureAgentBrowser: test.ensure,
  refreshAgentBrowsers: vi.fn(), startAgentBrowserWorkspace: async () => {},
}))
vi.mock('../../src/services/browser/appBrowser', () => ({
  browserAudioMuted: { __v_isRef: true, value: {} }, browserHomeUrl: () => 'about:blank', hostnameOf: (url: string) => url,
  closeBrowserView: vi.fn(), createAppBrowser: vi.fn(), goBackBrowserView: vi.fn(), goForwardBrowserView: vi.fn(),
  hideAllBrowserViews: test.hide, isBrowserHome: () => false, listenBrowserLoad: async () => () => {},
  navigateBrowserView: vi.fn(), normalizeBrowserUrl: (url: string) => url, patchAppBrowser: vi.fn(), reloadBrowserView: vi.fn(),
  removeAppBrowser: vi.fn(), screenshotBrowserView: test.screenshot, setBrowserAudioMuted: vi.fn(),
  setBrowserBounds: test.bounds, setBrowserZoom: vi.fn(), showBrowserView: test.show,
  hostBounds: (element: HTMLElement | null) => !element ? null : element.classList.contains('browser-preview-screen')
    ? { x: 900, y: 100, width: 224, height: 140 } : { x: 80, y: 44, width: 1200, height: 700 },
}))
vi.mock('../../src/services/app/environmentDetector', () => ({ isTauriEnvironment: () => true }))
vi.mock('../../src/services/browser/control', () => ({ setBrowserControl: test.control, userControlsBrowser: () => false }))
vi.mock('../../src/services/agent/cursorBridge', () => ({ startCursorBridge: vi.fn() }))
vi.mock('../../src/views/agentChat/AgentTaskHistory.vue', () => ({ default: { render: () => null } }))
vi.mock('../../src/components/browser/BrowserAgentWatchBar.vue', () => ({ default: { render: () => null } }))
import Pane from '../../src/views/agentChat/AgentBrowserPane.vue'
let app: App | undefined, root: HTMLElement
const props = reactive({ active: true, obscured: false })
const settle = async () => {
  for (let n = 0; n < 20; n++) await nextTick()
  // Vue finishes enter transitions after two animation frames even in jsdom.
  await new Promise(resolve => setTimeout(resolve, 50))
  for (let n = 0; n < 10; n++) await nextTick()
}
const mount = async () => {
  root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(Pane, props) }); app.mount(root)
  await settle()
}
beforeEach(() => {
  vi.clearAllMocks()
  test.selected = ref({ id: 'tab-1', title: '测试网页', url: 'https://example.test', zoom: 1 })
  test.expanded = ref(false); test.sessionId = ref('chat-1')
  test.bounds.mockResolvedValue(undefined); test.show.mockResolvedValue(undefined); test.hide.mockResolvedValue(undefined)
  test.ensure.mockImplementation(async () => test.selected.value?.id)
  props.active = true; props.obscured = false
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
})
afterEach(() => { app?.unmount(); app = undefined; root?.remove(); vi.unstubAllGlobals() })
describe('live native browser miniature', () => {
  it('shows the real browser in preview bounds without screenshots or transferring control', async () => {
    await mount()
    expect(test.bounds).toHaveBeenLastCalledWith('tab-1', { x: 900, y: 100, width: 224, height: 140, preview: true })
    expect(test.show).toHaveBeenCalledWith('tab-1')
    expect(document.querySelector('.browser-preview img')).toBeNull()
    expect(test.screenshot).not.toHaveBeenCalled()
    expect(test.control).not.toHaveBeenCalled()
  })

  it('expands and collapses the same live tab, clearing fullscreen anchors for the miniature', async () => {
    await mount()
    root.querySelector<HTMLButtonElement>('.browser-preview')!.click(); await settle()
    expect(test.expanded.value).toBe(true)
    expect(test.bounds).toHaveBeenLastCalledWith('tab-1', expect.objectContaining({ width: 1200, preview: false, layout: expect.any(Object) }))
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await settle()
    expect(test.expanded.value).toBe(false)
    expect(test.bounds).toHaveBeenLastCalledWith('tab-1', { x: 900, y: 100, width: 224, height: 140, preview: true })
    expect(test.show).toHaveBeenCalledTimes(1)
    expect(test.control).not.toHaveBeenCalled()
    expect(test.screenshot).not.toHaveBeenCalled()
  })

  it('hides the native layer behind dialogs and switches to the selected chat browser', async () => {
    await mount()
    props.obscured = true; await settle()
    expect(test.hide).toHaveBeenCalled()
    const shownBefore = test.show.mock.calls.length
    test.selected.value = { id: 'tab-2', url: 'https://other.test' }; await settle()
    expect(test.show.mock.calls.length).toBe(shownBefore)
    props.obscured = false; await settle()
    expect(test.bounds).toHaveBeenLastCalledWith('tab-2', expect.objectContaining({ preview: true }))
    expect(test.show).toHaveBeenLastCalledWith('tab-2')
  })

  it('does not show a late native view after a dialog has covered the miniature', async () => {
    let release: () => void = () => {}
    test.bounds.mockImplementationOnce(() => new Promise<void>(resolve => { release = resolve }))
    await mount()
    props.obscured = true; await settle()
    release(); await settle()
    expect(test.show).not.toHaveBeenCalled()
    expect(test.hide).toHaveBeenCalled()
  })

  it('waits for the sidebar entrance before displaying the native page at its final coordinates', async () => {
    props.active = false
    await mount()
    expect(test.show).not.toHaveBeenCalled()
    props.active = true
    await nextTick()
    expect(test.show).not.toHaveBeenCalled()
    await settle()
    expect(test.bounds).toHaveBeenLastCalledWith('tab-1', expect.objectContaining({ preview: true, x: 900 }))
    expect(test.show).toHaveBeenLastCalledWith('tab-1')
  })

  it('does not create a browser merely by showing an empty miniature', async () => {
    test.selected.value = null
    await mount()
    expect(test.ensure).not.toHaveBeenCalled()
    expect(test.show).not.toHaveBeenCalled()
    expect(root.textContent).toContain('浏览器待命')
  })
})
