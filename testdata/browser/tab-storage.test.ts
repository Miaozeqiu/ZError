// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn(async () => undefined) }))
import { closeBrowserView, createAppBrowser, listAppBrowsers } from '../../src/services/browser/appBrowser'

beforeEach(() => { localStorage.clear(); vi.clearAllMocks() })

it('持久化弹窗来源，用于关闭后返回正确入口', () => {
  const main = createAppBrowser({ url: 'https://example.com/course' })
  const popup = createAppBrowser({ url: 'https://example.com/detail', openerId: main.id })
  expect(listAppBrowsers().find(tab => tab.id === popup.id)?.openerId).toBe(main.id)
})

it('Agent 关闭附带本轮操作权，UI 关闭保留原有行为', async () => {
  await closeBrowserView('agent-tab', 7)
  expect(invoke).toHaveBeenLastCalledWith('browser_close', { id: 'agent-tab', expectedEpoch: 7 })
  await closeBrowserView('ui-tab')
  expect(invoke).toHaveBeenLastCalledWith('browser_close', { id: 'ui-tab' })
})
