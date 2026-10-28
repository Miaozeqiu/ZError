// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, ref, type App } from 'vue'
const native = vi.hoisted(() => ({ ensure: vi.fn(), hide: vi.fn(), show: vi.fn(), bounds: vi.fn(), close: vi.fn(), control: vi.fn(), rect: { x: 300, y: 100, width: 800, height: 450 } }))
const state = vi.hoisted(() => ({} as Record<string, any>))
vi.mock('../../src/services/agent/chatStore', async () => {
  const { ref } = await import('vue')
  state.activeId = ref('chat-one')
  state.chat = ref({ id: 'chat-one', browserId: 'tab-one', messages: [] })
  return { activeChat: state.chat, activeChatId: state.activeId, createChat: vi.fn(), patchSession: vi.fn() }
})
vi.mock('../../src/services/agent/agentBrowser', async () => {
  const { ref } = await import('vue')
  state.expanded = ref(false)
  state.tab = ref({ id: 'tab-one', title: '测试网页', url: 'https://example.com', zoom: 1 })
  return {
    agentBrowserExpanded: state.expanded, currentAgentBrowser: state.tab, currentAgentBrowsers: ref([state.tab.value]),
    ensureAgentBrowser: native.ensure, startAgentBrowserWorkspace: vi.fn().mockResolvedValue(undefined),
    bindChatBrowser: vi.fn(), browserIdsForChat: vi.fn(), refreshAgentBrowsers: vi.fn(),
  }
})
vi.mock('../../src/services/browser/appBrowser', async () => {
  const { ref } = await import('vue')
  return {
    browserAudioMuted: ref({}), browserHomeUrl: () => 'about:blank', closeBrowserView: native.close,
    createAppBrowser: vi.fn(), goBackBrowserView: vi.fn(), goForwardBrowserView: vi.fn(),
    hideAllBrowserViews: native.hide, hostBounds: () => ({ ...native.rect }),
    hostnameOf: () => 'example.com', isBrowserHome: () => false, listenBrowserLoad: vi.fn().mockResolvedValue(() => undefined),
    navigateBrowserView: vi.fn(), normalizeBrowserUrl: (url: string) => url, patchAppBrowser: vi.fn(),
    reloadBrowserView: vi.fn(), removeAppBrowser: vi.fn(), screenshotBrowserView: vi.fn().mockResolvedValue({ image: 'data:image/png;base64,AA==' }),
    setBrowserAudioMuted: vi.fn(), setBrowserBounds: native.bounds, setBrowserZoom: vi.fn(), showBrowserView: native.show,
  }
})
vi.mock('../../src/services/app/environmentDetector', () => ({ isTauriEnvironment: () => true }))
vi.mock('../../src/services/browser/control', async () => {
  const { ref } = await import('vue')
  state.userControl = ref(false)
  return { userControlsBrowser: () => state.userControl.value, setBrowserControl: native.control }
})
vi.mock('../../src/components/browser/BrowserAgentWatchBar.vue', () => ({ default: { render: () => null } }))
vi.mock('../../src/services/agent/cursorBridge', () => ({ startCursorBridge: vi.fn() }))
import AgentBrowserPane from '../../src/views/agentChat/AgentBrowserPane.vue'

describe('浏览器小窗原生视图生命周期', () => {
  let app: App | undefined
  let root: HTMLDivElement
  const props = reactive({ active: true, obscured: false })
  const mount = async () => {
    root = document.createElement('div')
    document.body.append(root)
    app = createApp({ render: () => h(AgentBrowserPane, props) })
    app.mount(root)
    await nextTick()
  }
  const clickToggle = () => (document.querySelector('[aria-controls="agent-browser-screen"]') as HTMLButtonElement).click()
  beforeEach(() => {
    vi.clearAllMocks()
    native.ensure.mockResolvedValue('tab-one')
    native.hide.mockResolvedValue(undefined)
    native.show.mockResolvedValue(undefined)
    native.bounds.mockResolvedValue(undefined)
    native.control.mockResolvedValue(undefined)
    state.userControl.value = false
    native.rect = { x: 300, y: 100, width: 800, height: 450 }
    state.expanded.value = false
    state.activeId.value = 'chat-one'
    state.tab.value = { id: 'tab-one', title: '测试网页', url: 'https://example.com', zoom: 1 }
    props.active = true; props.obscured = false
    vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => window.setTimeout(fn, 0))
    vi.stubGlobal('cancelAnimationFrame', (id: number) => window.clearTimeout(id))
  })
  afterEach(() => { app?.unmount(); app = undefined; root?.remove(); vi.unstubAllGlobals() })

  it('展开后显示浏览器，收起后恢复实时预览且不关闭', async () => {
    await mount()
    expect(root.querySelector('.browser-preview')).not.toBeNull()
    expect(native.ensure).not.toHaveBeenCalled()
    clickToggle()
    await vi.waitFor(() => expect(native.show).toHaveBeenCalledWith('tab-one'))
    expect(document.body.querySelector('.agent-browser-pane.is-expanded')?.parentElement).toBe(document.body)
    expect(document.body.textContent).toContain('仅观看')
    expect(document.body.textContent).toContain('取得控制权')
    expect(native.bounds).toHaveBeenCalledWith('tab-one', expect.objectContaining({ width: 800, height: 450 }))
    native.hide.mockClear()
    clickToggle()
    await vi.waitFor(() => expect(state.expanded.value).toBe(false))
    await vi.waitFor(() => expect(native.bounds).toHaveBeenLastCalledWith('tab-one', expect.objectContaining({ preview: true })))
    expect(native.close).not.toHaveBeenCalled()
  })

  it('展开动画期间不提前显示原生层，结束后使用最终位置', async () => {
    await mount()
    clickToggle()
    await nextTick()
    expect(native.show).not.toHaveBeenCalled()
    expect(native.bounds).not.toHaveBeenCalled()
    const end = new Event('animationend', { bubbles: true })
    Object.defineProperty(end, 'animationName', { value: 'browser-screen-open-scoped' })
    document.querySelector('.browser-screen')!.dispatchEvent(end)
    await vi.waitFor(() => expect(native.show).toHaveBeenCalledWith('tab-one'))
    expect(native.bounds).toHaveBeenCalledWith('tab-one', expect.objectContaining(native.rect))
  })

  it('展开动画未结束就收起，只显示收起状态的实时预览', async () => {
    await mount()
    clickToggle()
    await nextTick()
    clickToggle()
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 350))
    expect(state.expanded.value).toBe(false)
    await vi.waitFor(() => expect(native.bounds).toHaveBeenLastCalledWith('tab-one', expect.objectContaining({ preview: true })))
    expect(native.bounds.mock.calls.every(([, bounds]) => bounds.preview === true)).toBe(true)
  })

  it('离开 Agent 页和弹窗遮挡时隐藏原生层，返回时恢复', async () => {
    state.expanded.value = true
    await mount()
    await vi.waitFor(() => expect(native.show).toHaveBeenCalled())
    native.hide.mockClear()
    props.active = false
    await vi.waitFor(() => expect(native.hide).toHaveBeenCalled())
    props.active = true
    await vi.waitFor(() => expect(native.show.mock.calls.length).toBeGreaterThan(1))
    native.hide.mockClear()
    props.obscured = true
    await vi.waitFor(() => expect(native.hide).toHaveBeenCalled())
  })

  it('交还控制权立即更新显示，切换失败后恢复实际状态', async () => {
    state.expanded.value = true
    state.userControl.value = true
    let reject!: (error: Error) => void
    native.control.mockImplementationOnce(() => new Promise((_, fail) => { reject = fail }))
    await mount()
    await vi.waitFor(() => expect(native.show).toHaveBeenCalled())
    const stop = document.querySelector('.browser-stop-control') as HTMLButtonElement
    stop.click()
    await nextTick()
    expect(native.control).toHaveBeenCalledWith('tab-one', 'chat-one', 'agent')
    expect(document.querySelector('.browser-control-pill')?.textContent).toContain('仅观看')
    expect(document.querySelector('.browser-control-pill')?.textContent).not.toMatch(/正在切换|正在停止/)
    reject(new Error('切换失败'))
    await vi.waitFor(() => expect(document.querySelector('.browser-control-status')?.textContent).toContain('你正在控制'))
    expect(document.querySelector('.browser-stop-control')?.textContent).toBe('停止')
    expect(document.querySelector('.browser-error')?.textContent).toContain('切换失败')
  })

  it('连续缩放只更新尺寸，不重复打开、显示或进入加载态，最终使用最新尺寸', async () => {
    state.expanded.value = true
    await mount()
    await vi.waitFor(() => expect(native.show).toHaveBeenCalledOnce())
    let finish!: () => void
    native.bounds.mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
    native.rect.width = 900
    window.dispatchEvent(new Event('resize'))
    await vi.waitFor(() => expect(native.bounds).toHaveBeenLastCalledWith('tab-one', expect.objectContaining({ width: 900 })))
    expect(document.querySelector('.browser-opening')).toBeNull()
    native.rect.width = 1100
    window.dispatchEvent(new Event('resize'))
    finish()
    await vi.waitFor(() => expect(native.bounds).toHaveBeenLastCalledWith('tab-one', expect.objectContaining({ width: 1100,
      layout: expect.objectContaining({ paddingRatio: 0.07, compactBreakpoint: 760 }),
    })))
    expect(native.ensure).toHaveBeenCalledOnce()
    expect(native.show).toHaveBeenCalledOnce()
  })

  it('创建过程收起小窗，晚到结果只能用于收起状态的预览', async () => {
    let resolve!: (id: string) => void
    native.ensure.mockImplementationOnce(() => new Promise<string>(done => { resolve = done }))
    await mount()
    clickToggle()
    await vi.waitFor(() => expect(native.ensure).toHaveBeenCalled())
    native.hide.mockClear()
    clickToggle()
    await nextTick()
    resolve('tab-one')
    await vi.waitFor(() => expect(native.bounds).toHaveBeenLastCalledWith('tab-one', expect.objectContaining({ preview: true })))
    expect(native.bounds.mock.calls.every(([, bounds]) => bounds.preview === true)).toBe(true)
    expect(state.expanded.value).toBe(false)
  })

  it('同步窗口位置时切换对话，不把上一份对话的网页显示回来', async () => {
    let finishBounds!: () => void
    native.bounds.mockImplementationOnce(() => new Promise<void>(done => { finishBounds = done }))
    await mount()
    clickToggle()
    await vi.waitFor(() => expect(native.bounds).toHaveBeenCalled())
    state.activeId.value = 'chat-two'
    state.tab.value = { id: 'tab-two', title: '另一个网页', url: 'https://example.org', zoom: 1 }
    native.ensure.mockResolvedValue('tab-two')
    await nextTick()
    finishBounds()
    await vi.waitFor(() => expect(native.show).toHaveBeenCalledWith('tab-two'))
    expect(native.show).not.toHaveBeenCalledWith('tab-one')
  })
})
