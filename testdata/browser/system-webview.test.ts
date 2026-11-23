import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }))
let dom: JSDOM

const layout = (win: any) => {
  win.HTMLElement.prototype.getBoundingClientRect = function () {
    return { x: 10, y: 10, left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30, toJSON() {} }
  }
  win.HTMLElement.prototype.scrollIntoView = () => {}
  const style = win.document.createElement('style')
  style.textContent = '* { opacity: 1; visibility: visible; }'
  win.document.head.appendChild(style)
}
beforeEach(() => {
  vi.resetModules(); invoke.mockReset()
  dom = new JSDOM('<title>系统浏览器</title><body><button id="action">测试按钮</button><input id="entry"><input id="box" type="checkbox"></body>',
    { url: 'https://fixture.example/', runScripts: 'dangerously', pretendToBeVisual: true })
  layout(dom.window)
  invoke.mockImplementation(async (command, args) => {
    if (command === 'browser_capabilities') return { snapshotViaScript: true, pageScriptActions: true }
    if (command === 'browser_eval') return JSON.stringify(dom.window.eval(args.script))
    if (command === 'browser_state') return { id: args.id, url: dom.window.location.href }
    throw new Error(`未使用的原生操作：${command}`)
  })
})
afterEach(() => { dom.window.close(); vi.restoreAllMocks() })

it('系统 WebView 的页面快照包含控件和可用引用，沿用调用者的控制代次', async () => {
  const { readBrowserPage } = await import('../../src/services/browser/appBrowser')
  const page = await readBrowserPage('system', { controlEpoch: 7 })
  expect(page.error).toBeUndefined()
  expect(page.snapshot).toContain('测试按钮')
  expect(page.refs.length).toBeGreaterThan(0)
  expect(invoke.mock.calls.filter(([name]) => name === 'browser_eval')[0][1]).toMatchObject({ expectedEpoch: 7 })
  expect(invoke.mock.calls.some(([name]) => name === 'browser_protocol')).toBe(false)
})

it('点击只派发一次，填写保留中文和引号并触发页面事件', async () => {
  const { clickByLocator, fillByLocator } = await import('../../src/services/browser/engine/act')
  let clicks = 0, changes = 0
  dom.window.document.querySelector('#action')!.addEventListener('click', () => clicks++)
  dom.window.document.querySelector('#entry')!.addEventListener('input', () => changes++)
  expect(await clickByLocator('system', { by: 'text', value: '测试按钮' })).toMatchObject({ ok: true })
  expect(clicks).toBe(1)
  expect(await fillByLocator('system', { by: 'css', value: '#entry' }, '中文 "value"')).toMatchObject({ ok: true, filled: true })
  expect((dom.window.document.querySelector('#entry') as HTMLInputElement).value).toBe('中文 "value"')
  expect(changes).toBe(1)
})

it('未登记的手动密码也不进入快照名称、引用或填写回执', async () => {
  const input = dom.window.document.createElement('input')
  input.type = 'password'; input.id = 'password'; input.value = 'private-manual-value'
  dom.window.document.body.appendChild(input)
  const { readBrowserPage } = await import('../../src/services/browser/appBrowser')
  const { fillByLocator } = await import('../../src/services/browser/engine/act')
  expect(JSON.stringify(await readBrowserPage('system'))).not.toContain('private-manual-value')
  const result = await fillByLocator('system', { by: 'css', value: '#password' }, 'new-private-value')
  expect(result).toMatchObject({ ok: true, password: true, length: 17 })
  expect(JSON.stringify(result)).not.toContain('private-value')
})

it('同名控件需要明确序号，不会擅自点击第一个', async () => {
  const { clickByLocator } = await import('../../src/services/browser/engine/act')
  dom.window.document.body.innerHTML = '<button>重复</button><button>重复</button>'
  let selected = 0
  dom.window.document.querySelectorAll('button').forEach((el, index) => el.addEventListener('click', () => selected = index + 1))
  expect(await clickByLocator('system', { by: 'text', value: '重复' })).toMatchObject({ ok: false, reason: 'ambiguous' })
  expect(selected).toBe(0)
  expect(await clickByLocator('system', { by: 'text', value: '重复', nth: 2 })).toMatchObject({ ok: true })
  expect(selected).toBe(2)
})

it('限定同源 iframe，不会因顶层有同名按钮而误点', async () => {
  const { clickByLocator } = await import('../../src/services/browser/engine/act')
  const frame = dom.window.document.createElement('iframe'); frame.id = 'child'
  dom.window.document.body.appendChild(frame)
  frame.contentDocument!.body.innerHTML = '<button>测试按钮</button>'
  layout(frame.contentWindow)
  await new Promise(resolve => setTimeout(resolve, 0))
  let top = 0, child = 0
  dom.window.document.querySelector('#action')!.addEventListener('click', () => top++)
  frame.contentDocument!.querySelector('button')!.addEventListener('click', () => child++)
  expect(await clickByLocator('system', { by: 'text', value: '测试按钮', frame: 'child' })).toMatchObject({ ok: true })
  expect(top).toBe(0); expect(child).toBe(1)
})

it('复选框设置保持幂等，不支持的操作不能变成左键点击', async () => {
  const { setCheckedByLocator, actOnBrowser } = await import('../../src/services/browser/engine/act')
  expect(await setCheckedByLocator('system', { by: 'css', value: '#box' }, true)).toMatchObject({ ok: true, checked: true })
  expect(await setCheckedByLocator('system', { by: 'css', value: '#box' }, true)).toMatchObject({ ok: true, checked: true })
  let clicks = 0; dom.window.document.querySelector('#action')!.addEventListener('click', () => clicks++)
  expect(await actOnBrowser('system', { op: 'rightclick', locator: { by: 'css', value: '#action' } })).toMatchObject({ ok: false })
  expect(clicks).toBe(0)
})

it('读取和写入通道失败都保留错误，不伪造空快照或重放写入', async () => {
  const { readBrowserPage } = await import('../../src/services/browser/appBrowser')
  const { clickByLocator } = await import('../../src/services/browser/engine/act')
  let evaluations = 0
  invoke.mockImplementation(async command => {
    if (command === 'browser_capabilities') return { snapshotViaScript: true, pageScriptActions: true }
    if (command === 'browser_state') return { url: 'https://fixture.example/' }
    if (command === 'browser_eval') { evaluations++; throw new Error('受保护页面禁止脚本读取') }
    throw new Error(command)
  })
  expect(await readBrowserPage('system')).toMatchObject({ error: '受保护页面禁止脚本读取' })
  expect(await clickByLocator('system', { by: 'css', value: '#action' })).toMatchObject({ ok: false, error: expect.stringContaining('受保护页面') })
  expect(evaluations).toBe(2)
})

it('CEF 继续使用原生快照，通道错误不触发脚本降级', async () => {
  invoke.mockImplementation(async command => {
    if (command === 'browser_capabilities') return { snapshotViaScript: false, pageScriptActions: false }
    if (command === 'browser_protocol') throw new Error('原生通道断开')
    if (command === 'browser_state') return { url: 'https://fixture.example/' }
    throw new Error(command)
  })
  const { readBrowserPage } = await import('../../src/services/browser/appBrowser')
  expect(await readBrowserPage('cef')).toMatchObject({ error: '原生通道断开' })
  expect(invoke.mock.calls.some(([name]) => name === 'browser_eval')).toBe(false)
})
