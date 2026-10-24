import { afterEach, describe, expect, it, vi } from 'vitest'
const { read, evaluate, invoke } = vi.hoisted(() => ({ read: vi.fn(), evaluate: vi.fn(), invoke: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('../../src/services/browser/appBrowser', () => ({ readBrowserPage: read }))
vi.mock('../../src/services/browser/eval', async () => ({
  ...await vi.importActual('../../src/services/browser/eval'), evalBrowserView: evaluate, waitMs: async () => {},
}))
import { attachActionSnapshot, observeAfterClick } from '../../src/services/browser/engine/wait'
import { rememberPageSnap } from '../../src/services/browser/engine/pageSnap'

afterEach(() => vi.restoreAllMocks())
const prepare = () => {
  let now = 1000
  vi.spyOn(Date, 'now').mockImplementation(() => now += 150)
  invoke.mockResolvedValue({ url: 'https://example.com' })
  evaluate.mockImplementation(async (_id: string, script: string) => script.includes('activeElement') ? '' : { ready: true, url: 'https://example.com' })
  rememberPageSnap('observation', { url: 'https://example.com', title: '', snapshot: '- checkbox "A" [ref=e1] [checked=false]', refs: [] })
}

describe('动作回执的实际观测', () => {
  it('重新编号但内容相同，不能报告 DOM 已改变', async () => {
    prepare()
    read.mockResolvedValue({ url: 'https://example.com', snapshot: '- checkbox "A" [ref=e999] [checked=false]' })
    expect((await observeAfterClick('observation', { ok: true }, 'https://example.com')).domChanged).toBe(false)
  })
  it('checked 的真实变化仍能被识别', async () => {
    prepare()
    read.mockResolvedValue({ url: 'https://example.com', snapshot: '- checkbox "A" [ref=e999] [checked=true]' })
    expect((await observeAfterClick('observation', { ok: true }, 'https://example.com')).domChanged).toBe(true)
  })
  it('动作成功但读取失败，两种结果分开报告', async () => {
    prepare()
    read.mockResolvedValue({ error: 'CDP 绑定失败' })
    expect(await attachActionSnapshot('observation', { ok: true })).toMatchObject({ ok: true, snapshotError: 'CDP 绑定失败', snapshotStale: true })
  })
})
