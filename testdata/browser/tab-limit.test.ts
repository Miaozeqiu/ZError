import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ evaluations: 0 }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: async () => ({ url: 'https://example.test/next' }) }))
vi.mock('../../src/services/browser/appBrowser', () => ({
  readBrowserPage: async () => ({ url: 'https://example.test/next', snapshot: '- link "详情"', title: '详情' }),
}))
vi.mock('../../src/services/browser/eval', () => ({
  asObject: (value: unknown) => value,
  evalBrowserView: async (_id: string, script: string) => script.includes('readyState')
    ? { ready: ++mocks.evaluations > 1, url: 'https://example.test/next' }
    : '',
  evalBrowserViewInFrame: async () => null,
  evalBrowserViewMainIdle: async () => null,
  waitMs: async () => {},
}))
vi.mock('../../src/services/browser/protocol', () => ({ callProtocol: async () => ({}) }))
vi.mock('../../src/services/browser/engine/act', () => ({ probeOnBrowser: async () => ({ ok: false }) }))
vi.mock('../../src/services/browser/engine/refs', () => ({ resolveRefLocator: async () => null }))

import { observeAfterClick } from '../../src/services/browser/engine/wait'
import {
  browserTabLimitNotice,
  browserTabLimitSequence,
  clearBrowserTabLimitNotice,
  recordBrowserTabLimit,
} from '../../src/services/browser/tabLimits'

describe('标签页上限反馈', () => {
  beforeEach(() => {
    mocks.evaluations = 0
    vi.stubGlobal('window', globalThis)
    clearBrowserTabLimitNotice('session')
  })
  afterEach(() => vi.unstubAllGlobals())

  it('点击送达但该标签弹出的新页被拒时，向 Agent 返回明确错误', async () => {
    const before = browserTabLimitSequence()
    recordBrowserTabLimit('popup', 'source-tab', 'session')
    const result = await observeAfterClick('source-tab', { ok: true, text: '打开详情' }, 'https://example.test/list', undefined, before)
    expect(browserTabLimitNotice.value?.message).toContain('16')
    expect(result).toMatchObject({ ok: false, reason: 'tab_limit', clickDispatched: true })
    expect(result.hint).toContain('避免重复提交')
  })

  it('旧提示、手动新建或其他标签的弹窗不会让当前点击误报失败', async () => {
    recordBrowserTabLimit('popup', 'source-tab', 'session')
    const before = browserTabLimitSequence()
    recordBrowserTabLimit('manual', '', 'session')
    recordBrowserTabLimit('popup', 'other-tab', 'other-session')
    const result = await observeAfterClick('source-tab', { ok: true, text: '展开' }, 'https://example.test/list', undefined, before)
    expect(result.ok).toBe(true)
    clearBrowserTabLimitNotice('session')
    expect(browserTabLimitNotice.value?.sessionId).toBe('other-session')
    clearBrowserTabLimitNotice('other-session')
    expect(browserTabLimitNotice.value).toBeNull()
  })
})
