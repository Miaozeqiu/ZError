// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, reactive, type App } from 'vue'

const clipboard = vi.hoisted(() => ({ native: vi.fn(), web: vi.fn() }))
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeText: clipboard.native }))
vi.mock('../../src/services/browser/abstractions', async () => {
  const { ref } = await import('vue')
  return { abstractionMenuOpen: ref(false), BROWSER_ABSTRACTIONS: [], currentBrowserUrl: ref(''), lastSiteCard: ref(null) }
})
import Graph from '../../src/components/browser/BrowserSiteGraphPanel.vue'
import data from '../../src/services/agent/skills/bundled/chaoxing/site-graph.json'
let app: App
let root: HTMLDivElement
let view: HTMLElement
let graphData: typeof data
const camera = () => root.querySelector<HTMLElement>('.graph-camera')!
const map = () => root.querySelector<HTMLElement>('.graph-map')!
const geometry = () => ({ x: parseFloat(camera().style.left), y: parseFloat(camera().style.top), scale: Number(map().style.zoom) * (map().style.transform === 'none' ? 1 : Number(map().style.transform.slice(6, -1))) })
const wheel = async (deltaY: number) => {
  view.dispatchEvent(new WheelEvent('wheel', { clientX: 350, clientY: 240, deltaY, bubbles: true, cancelable: true }))
  await nextTick()
}
const pointer = async (name: string, x: number, y: number, target: Element = view) => {
  const event = new MouseEvent(name, { button: 0, clientX: x, clientY: y, bubbles: true })
  Object.defineProperty(event, 'pointerId', { value: 1 })
  target.dispatchEvent(event); await nextTick()
}
const selectNode = async (index = 0) => {
  const node = root.querySelectorAll('.graph-node')[index]
  await pointer('pointerdown', 350, 240, node)
  await pointer('pointerup', 350, 240, node)
}
beforeEach(async () => {
  clipboard.native.mockReset().mockResolvedValue(undefined)
  clipboard.web.mockReset().mockResolvedValue(undefined)
  Object.defineProperty(navigator, 'clipboard', { value: { writeText: clipboard.web }, configurable: true })
  graphData = reactive(structuredClone(data))
  graphData.nodes[0].path = 'https://example.test/auth/login?redirect=%2Fstudent%2Fcourse'
  graphData.nodes[0].summary = '使用校园账号登录。验证身份后进入课程。'
  graphData.nodes[0].sketch!.caption = graphData.nodes[0].path
  Object.defineProperty(document, 'elementFromPoint', { value: vi.fn(() => null), configurable: true })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  // Real layout is verified separately in WKWebView; jsdom supplies only viewport dimensions.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(700)
  root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(Graph, { preview: true, data: graphData }) }); app.mount(root)
  await nextTick(); await nextTick(); await nextTick()
  view = root.querySelector('.graph-scroll')!
  view.setPointerCapture = vi.fn()
})
afterEach(() => { app.unmount(); root.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(document, 'elementFromPoint'); Reflect.deleteProperty(navigator, 'clipboard') })

describe('website graph layout zoom', () => {
  it('keeps the world point under the cursor fixed through enlargement, reduction and limits', async () => {
    const start = geometry()
    const world = { x: (350 - start.x) / start.scale, y: (240 - start.y) / start.scale }
    for (const delta of [...Array(80).fill(-100), ...Array(130).fill(100)]) {
      await wheel(delta)
      const current = geometry()
      expect(world.x * current.scale + current.x).toBeCloseTo(350, 7)
      expect(world.y * current.scale + current.y).toBeCloseTo(240, 7)
      expect(current.scale).toBeGreaterThanOrEqual(.22)
      expect(current.scale).toBeLessThanOrEqual(6)
      expect(Number(map().style.zoom)).toBeGreaterThanOrEqual(2)
      const downsample = map().style.transform === 'none' ? 1 : Number(map().style.transform.slice(6, -1))
      expect(downsample).toBeLessThanOrEqual(1)
    }
    expect(geometry().scale).toBe(.22)
    for (let i = 0; i < 80; i++) await wheel(-100)
    expect(geometry().scale).toBe(6)
    const before = geometry()
    await wheel(0)
    expect(geometry()).toEqual(before)
  })

  it('pans in viewport pixels at high zoom and selects the real card without losing SVG wires', async () => {
    for (let i = 0; i < 80; i++) await wheel(-100)
    const before = geometry()
    await pointer('pointerdown', 350, 240)
    await pointer('pointermove', 390, 265)
    await pointer('pointerup', 390, 265)
    expect(geometry()).toEqual({ x: before.x + 40, y: before.y + 25, scale: 6 })
    const node = root.querySelector('.graph-node')!
    await pointer('pointerdown', 390, 265, node)
    await pointer('pointerup', 390, 265, node)
    expect(root.querySelector('.graph-detail')).not.toBeNull()
    expect(root.querySelectorAll('.graph-wires path.graph-wire').length).toBeGreaterThan(0)
    expect(map().style.transform).toBe('none')
    expect(parseFloat(camera().style.width)).toBe(parseFloat(map().style.width) * 6)
  })
})


describe('graph page descriptions and address details', () => {
  it('hides routes in the overview, retains original data and copies the selected address', async () => {
    expect(map().textContent).toContain('使用校园账号登录')
    expect(map().textContent).not.toContain(graphData.nodes[0].path)
    expect(map().querySelector('.doc-path')).toBeNull()
    expect(map().textContent).not.toContain('/visit/interaction')
    expect(map().textContent).not.toContain('knowledge/cards')
    expect(root.querySelector('.graph-detail')).toBeNull()
    await selectNode()
    expect(root.querySelector('.graph-detail-path')!.textContent).toBe(graphData.nodes[0].path)
    root.querySelector<HTMLButtonElement>('.graph-detail-copy')!.click()
    await vi.waitFor(() => expect(root.querySelector('.graph-detail-copy')!.textContent).toContain('已复制'))
    expect(clipboard.native).toHaveBeenCalledWith(graphData.nodes[0].path)
    expect(clipboard.web).not.toHaveBeenCalled()
    expect(graphData.nodes[0].path).toBe('https://example.test/auth/login?redirect=%2Fstudent%2Fcourse')
    await selectNode(1)
    expect(root.querySelector('.graph-detail-copy')!.textContent).toContain('复制地址')
    expect(root.querySelector('.graph-detail-copy')!.textContent).not.toContain('已复制')
  })

  it('falls back to web clipboard and reports a failure without claiming success', async () => {
    clipboard.native.mockRejectedValue(new Error('Native clipboard unavailable'))
    await selectNode()
    root.querySelector<HTMLButtonElement>('.graph-detail-copy')!.click()
    await vi.waitFor(() => expect(root.querySelector('.graph-detail-copy')!.textContent).toContain('已复制'))
    expect(clipboard.web).toHaveBeenCalledWith(graphData.nodes[0].path)
    clipboard.web.mockRejectedValue(new Error('Permission denied'))
    root.querySelector<HTMLButtonElement>('.graph-detail-copy')!.click()
    await vi.waitFor(() => expect(root.querySelector('.graph-copy-error')!.textContent).toContain('复制失败'))
    expect(root.querySelector('.graph-detail-copy')!.textContent).not.toContain('已复制')
    expect(root.querySelector('.graph-detail-path')!.textContent).toBe(graphData.nodes[0].path)
  })

  it('uses a plain description when a page has no summary, keeping route templates in details', async () => {
    graphData.nodes[0].summary = 'ckplayer 原生 video（blob src）'
    await nextTick()
    expect(map().querySelector('.stage span')!.textContent).toBe('查看页面内容')
    graphData.nodes[0].summary = ''
    graphData.nodes[0].path = '/course/study/<courseId>/plan'
    await nextTick(); await nextTick()
    expect(map().querySelector('.stage span')!.textContent).toBe('查看页面内容')
    expect(map().textContent).not.toContain('<courseId>')
    await selectNode()
    expect(root.querySelector('.graph-detail-path')!.textContent).toBe('/course/study/<courseId>/plan')
  })
})
