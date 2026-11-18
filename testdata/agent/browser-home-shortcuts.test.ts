import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { beforeEach, expect, it, vi } from 'vitest'
import { handleBrowserHomeShortcuts } from '../../src/services/agent/tools/browserHomeShortcuts'

const mocks = vi.hoisted(() => ({ eval: vi.fn(), navigate: vi.fn() }))
vi.mock('../../src/services/browser/appBrowser', () => ({
  browserHomeUrl: () => 'http://localhost:1420/browser-home.html',
  navigateBrowserView: mocks.navigate,
}))
vi.mock('../../src/services/browser/eval', () => ({ evalBrowserViewMain: mocks.eval }))
vi.mock('../../src/services/platform/panelAccess', () => ({ videoWatchFor: () => null }))

const html = readFileSync(new URL('../../public/browser-home.html', import.meta.url), 'utf8')
const launcher = readFileSync(new URL('../../public/browser-home/launcher.js', import.meta.url), 'utf8')
const homeUrl = 'http://localhost:1420/browser-home.html'
function page(store?: Storage) {
  const { window } = new JSDOM(html, { url: homeUrl, runScripts: 'outside-only' })
  if (store) for (const key of Object.keys(store)) window.localStorage.setItem(key, store.getItem(key)!)
  window.eval(launcher)
  return window
}
const run = (args: Record<string, unknown>) =>
  handleBrowserHomeShortcuts({ browserId: 'tab', args, wait: async () => {} }).then(JSON.parse)

beforeEach(() => vi.resetAllMocks())

it('changes the real launcher and preserves edits, removed defaults and legacy drag order after reopening', async () => {
  const original = new JSDOM('', { url: homeUrl }).window.localStorage
  original.setItem('zerror.browser-home.order', JSON.stringify(['https://retired.example.org/', 'https://chatgpt.com/', 'https://www.doubao.com/']))
  let window = page(original)
  expect(window.localStorage.getItem('zerror.browser-home.order')).toBeNull()
  expect(JSON.parse(window.localStorage.getItem('zerror.browser-home.shortcut-order')!)).toEqual(['chatgpt', 'doubao'])
  mocks.eval.mockImplementation(async (_tab, script) => window.eval(script))
  const readLinks = () => [...window.document.querySelectorAll<HTMLAnchorElement>('.grid .site')]
  expect(readLinks().slice(0, 2).map(link => link.dataset.shortcutId)).toEqual(['chatgpt', 'doubao'])
  readLinks()[1].dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true }))
  expect(readLinks().slice(0, 2).map(link => link.dataset.shortcutId)).toEqual(['doubao', 'chatgpt'])
  const added = await run({ action: 'add', name: '课程资料', url: 'https://docs.example.org/course' })
  expect(added).toMatchObject({ ok: true, shortcut: { name: '课程资料' } })
  expect(await run({ action: 'add', name: '课程资料', url: 'https://docs.example.org/course' })).toMatchObject({ ok: true, unchanged: true })
  expect(await run({ action: 'update', target: 'ChatGPT', name: '问答', url: 'https://chatgpt.com/projects' })).toMatchObject({ ok: true })
  expect(await run({ action: 'remove', target: '智慧树' })).toMatchObject({ ok: true })
  expect(await run({ action: 'remove', target: added.shortcut.id })).toMatchObject({ ok: true })
  window = page(window.localStorage)
  expect(readLinks()[0].dataset.shortcutId).toBe('doubao')
  expect(readLinks()[1]).toMatchObject({ href: 'https://chatgpt.com/projects' })
  expect(readLinks()[1].querySelector('.name')?.textContent).toBe('问答')
  expect(readLinks()[1].querySelector('img')).not.toBeNull()
  expect(readLinks().some(link => link.dataset.shortcutId === 'zhihuishu')).toBe(false)
  expect(readLinks()).toHaveLength(7)
  expect(mocks.navigate).not.toHaveBeenCalled()
})

it('rejects executable URLs and leaves ambiguous shortcuts untouched', async () => {
  const window = page()
  mocks.eval.mockImplementation(async (_tab, script) => window.eval(script))
  expect(await run({ action: 'add', name: '危险网址', url: 'javascript:alert(1)' })).toMatchObject({ ok: false })
  expect(await run({ action: 'update', target: 'ChatGPT', url: 'https://user:pass@example.com/' })).toMatchObject({ ok: false })
  expect(await run({ action: 'add', name: 'ChatGPT', url: 'https://example.com/' })).toMatchObject({ ok: true })
  // Use two custom entries with the same name to exercise exact-name ambiguity.
  await run({ action: 'add', name: '资料', url: 'https://example.com/a' })
  await run({ action: 'add', name: '资料', url: 'https://example.com/b' })
  expect(await run({ action: 'remove', target: '资料' })).toMatchObject({ ok: false, reason: 'ambiguous' })
  expect((await run({ action: 'list' })).shortcuts).toHaveLength(11)
})

it('applies edits only after opening the trusted home and never redispatches an ambiguous write', async () => {
  const external = new JSDOM('', { url: 'https://example.com/browser-home.html', runScripts: 'outside-only' }).window
  const forged = vi.fn(() => ({ ok: true }))
  external.__zerrorHomeShortcuts = forged
  let current = external
  mocks.navigate.mockImplementation(async () => { current = page() })
  mocks.eval.mockImplementation(async (_tab, script) => current.eval(script))
  expect(await run({ action: 'list' })).toMatchObject({ ok: true })
  expect(forged).not.toHaveBeenCalled()
  expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith('tab', 'zerror://home')
  mocks.eval.mockClear().mockResolvedValueOnce({ ok: true }).mockRejectedValueOnce(new Error('通道断开'))
  expect(await run({ action: 'remove', target: 'ChatGPT' })).toMatchObject({ ok: false, clickDispatched: true })
  expect(mocks.eval).toHaveBeenCalledTimes(2)
})

it('keeps grouped shortcuts editable by the Agent and restores folder contents after reopening', async () => {
  let window = page()
  mocks.eval.mockImplementation(async (_tab, script) => window.eval(script))
  window.localStorage.setItem('zerror.browser-home.layout', JSON.stringify({
    root: ['folder-study'], folders: [{ id: 'folder-study', name: '学习', items: ['chatgpt', 'deepseek', 'zerror'] }],
  }))
  function click(selector: string) { window.document.querySelector<HTMLElement>(selector)!.click() }
  expect((await run({ action: 'list' })).shortcuts.filter((site: { folder?: string }) => site.folder === '学习'))
    .toMatchObject([{ id: 'chatgpt' }, { id: 'deepseek' }])
  await run({ action: 'update', target: 'deepseek', name: '研究助手' })
  window = page(window.localStorage)
  click('.folder')
  expect(window.document.querySelector('h1 input')).toMatchObject({ value: '学习' })
  await run({ action: 'remove', target: 'chatgpt' })
  expect(window.document.querySelector('.folder')).toBeNull()
  expect(window.document.querySelector('.grid .name')?.textContent).toBe('研究助手')
  expect(JSON.parse(window.localStorage.getItem('zerror.browser-home.layout')!).folders).toEqual([])
  await run({ action: 'remove', target: 'deepseek' })
  expect(window.document.querySelector('h1')?.textContent).toBe('导航')
  expect(window.document.querySelector('.folder')).toBeNull()
  expect(window.document.querySelectorAll('.grid .site')).toHaveLength(6)
})

it('dissolves a saved single-site folder in its original home slot', () => {
  const store = page().localStorage
  store.setItem('zerror.browser-home.layout', JSON.stringify({
    root: ['gemini', 'folder-old', 'doubao'],
    folders: [{ id: 'folder-old', name: '旧分类', items: ['chatgpt', 'chatgpt'] }],
  }))
  const window = page(store)
  expect(window.document.querySelector('.folder')).toBeNull()
  expect([...window.document.querySelectorAll<HTMLElement>('.grid .site')].slice(0, 3)
    .map(site => site.dataset.shortcutId)).toEqual(['gemini', 'chatgpt', 'doubao'])
  expect(JSON.parse(window.localStorage.getItem('zerror.browser-home.layout')!).folders).toEqual([])
})
