import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import locatorSource from '../../src-tauri/src/webview2_input.js?raw'

const invoke = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn(async () => () => {}) }))

beforeEach(() => {
  vi.resetModules()
  invoke.mockReset().mockImplementation(async (command, args) => {
    if (command === 'browser_capabilities') return { cdpInput: true, pageScriptActions: true }
    if (command === 'browser_protocol' && args.op === 'native_input') return { ok: true, dispatched: true }
    throw new Error('Unexpected script fallback')
  })
})
afterEach(() => vi.restoreAllMocks())

it('routes Windows clicks and typing through native input even when script snapshots remain enabled', async () => {
  const { clickByLocator, fillByLocator } = await import('../../src/services/browser/engine/act')
  expect(await clickByLocator('win', { by: 'role', value: 'button', name: '登录' })).toMatchObject({ ok: true })
  expect(await fillByLocator('win', { by: 'css', value: '#account' }, '中文')).toMatchObject({ ok: true })
  expect(invoke.mock.calls.filter(([command]) => command === 'browser_eval')).toHaveLength(0)
  expect(invoke.mock.calls.filter(([command]) => command === 'browser_protocol').map(([,args]) => args.args.op)).toEqual(['click', 'fill'])
})

it('does not retry or execute a page script after an uncertain native write', async () => {
  invoke.mockImplementation(async command => {
    if (command === 'browser_capabilities') return { cdpInput: true, pageScriptActions: true }
    throw new Error('CDP response timed out')
  })
  const { clickByLocator } = await import('../../src/services/browser/engine/act')
  expect(await clickByLocator('win', { by: 'css', value: '#submit' })).toMatchObject({ ok: false, retry: false })
  expect(invoke.mock.calls.filter(([command]) => command === 'browser_protocol')).toHaveLength(1)
  expect(invoke.mock.calls.some(([command]) => command === 'browser_eval')).toBe(false)
})

it('fixed locator probes refuse ambiguous matches and select an explicit ordinal without clicking', () => {
  const dom = new JSDOM('<button>进入学习</button><button>进入学习</button>', { runScripts: 'dangerously' })
  try {
    dom.window.HTMLElement.prototype.getClientRects = function () { return [{ width: 10, height: 10 }] as any }
    let clicks = 0
    dom.window.document.addEventListener('click', () => clicks++)
    const locate = dom.window.eval(locatorSource)
    expect(locate({ by: 'role', value: 'button', name: '进入学习' })).toMatchObject({ reason: 'ambiguous' })
    expect(locate({ by: 'role', value: 'button', name: '进入学习', nth: 2 })).toBe(dom.window.document.querySelectorAll('button')[1])
    expect(clicks).toBe(0)
  } finally { dom.window.close() }
})
