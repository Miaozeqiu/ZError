import { beforeEach, describe, expect, it, vi } from 'vitest'

const invoke = vi.fn()

vi.mock('@tauri-apps/api/core', () => ({ invoke }))
vi.mock('../../src/services/browser/eval', async () => {
  const actual = await vi.importActual<typeof import('../../src/services/browser/eval')>('../../src/services/browser/eval')
  return { ...actual, waitMs: async () => {} }
})

describe('actOnBrowser', () => {
  beforeEach(() => {
    invoke.mockReset()
  })

  it('已找到时先 find 再点，不空等 find_wait', async () => {
    const { actOnBrowser } = await import('../../src/services/browser/engine/act')
    invoke.mockImplementation(async (cmd: string, payload?: { op?: string }) => {
      if (cmd !== 'browser_protocol') throw new Error(`unexpected ${cmd}`)
      if (payload?.op === 'find') return { ok: true, x: 12, y: 34, text: '播放' }
      if (payload?.op === 'click_at') return { ok: true, text: '播放' }
      throw new Error(`unexpected ${payload?.op}`)
    })
    const result = await actOnBrowser('b1', { op: 'click', locator: { by: 'css', value: '.playButton' } })
    expect(result.ok).toBe(true)
    expect(result.text).toBe('播放')
    expect(invoke.mock.calls.filter((row) => row[1]?.op === 'find')).toHaveLength(1)
    expect(invoke.mock.calls.filter((row) => row[1]?.op === 'find_wait')).toHaveLength(0)
  })

  it('一开始就没有时短等，不拖满长超时', async () => {
    const { actOnBrowser, ACT_MISS_TIMEOUT_MS } = await import('../../src/services/browser/engine')
    invoke.mockImplementation(async (cmd: string, payload?: { op?: string; timeoutMs?: number }) => {
      if (cmd !== 'browser_protocol') throw new Error(`unexpected ${cmd}`)
      if (payload?.op === 'find') return { ok: false, reason: 'not_found' }
      if (payload?.op === 'find_wait') {
        expect(Number(payload.timeoutMs)).toBeLessThanOrEqual(ACT_MISS_TIMEOUT_MS)
        return { ok: false, reason: 'not_found' }
      }
      throw new Error(`unexpected ${payload?.op}`)
    })
    const result = await actOnBrowser('b1', {
      op: 'click',
      locator: { by: 'text', value: '用户名' },
      timeout: 8000,
    })
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('not_found')
    expect(invoke.mock.calls.filter((row) => row[1]?.op === 'find').length).toBeGreaterThan(0)
    expect(invoke.mock.calls.filter((row) => row[1]?.op === 'find_wait')).toHaveLength(1)
  })

  it('命令缺失时走轮询 find', async () => {
    const { actOnBrowser } = await import('../../src/services/browser/engine/act')
    invoke.mockImplementation(async (cmd: string, payload?: { op?: string }) => {
      if (cmd !== 'browser_protocol') throw new Error(`unexpected ${cmd}`)
      if (payload?.op === 'find_wait') throw new Error('Command browser_cdp_find_wait not found')
      if (payload?.op === 'find') return { ok: true, x: 8, y: 9, text: '确定' }
      if (payload?.op === 'click_at') return { ok: true, text: '确定' }
      throw new Error(`unexpected ${payload?.op}`)
    })
    const result = await actOnBrowser('b1', {
      op: 'click',
      locator: { by: 'text', value: '确定' },
      timeout: 400,
    })
    expect(result.ok).toBe(true)
    expect(invoke.mock.calls.filter((row) => row[1]?.op === 'find').length).toBeGreaterThan(0)
  })
})
