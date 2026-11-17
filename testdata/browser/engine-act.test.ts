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

  it.each([
    { text: 'abc', password: false },
    { text: '', password: false },
    { text: 'secret', password: true },
  ])('填写与验证固定在定位结果的 session，支持清空和密码脱敏：%j', async ({ text, password }) => {
    const { fillByLocator } = await import('../../src/services/browser/engine/act')
    invoke.mockImplementation(async (_cmd: string, payload: any) => {
      if (payload.op === 'find') return { ok: true, x: 10, y: 20, backend: 42, session: 'quiz-session', frameId: 'quiz', loaderId: 'doc' }
      if (payload.op === 'fill_node') {
        expect(payload.args).toEqual({ backend: 42, session: 'quiz-session', text })
        return { ok: true, filled: true, length: text.length, password, text: password ? undefined : text }
      }
      throw new Error(`unexpected ${payload.op}`)
    })
    const result = await fillByLocator('b1', { by: 'css', value: '#answer', frameId: 'quiz', loaderId: 'doc' }, text)
    expect(result).toMatchObject({ ok: true, filled: true, length: text.length, frameId: 'quiz' })
    if (password) expect(JSON.stringify(result)).not.toContain(text)
    expect(invoke.mock.calls.map(row => row[1].op)).toEqual(['find', 'fill_node'])
  })

  it('已更换文档的引用终止，不重试到别的框', async () => {
    const { clickByLocator } = await import('../../src/services/browser/engine/act')
    invoke.mockResolvedValue({ ok: false, reason: 'invalid', error: '目标 frame 文档已更换，请重新读取页面快照' })
    const result = await clickByLocator('b1', { by: 'text', value: '提交', frameId: 'quiz', loaderId: 'old' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('文档已更换')
    expect(invoke).toHaveBeenCalledTimes(1)
  })
  it('节点文档归属错误要求刷新快照，不作为布局抖动重试或暴露长 CSS 路径', async () => {
    const { clickByLocator } = await import('../../src/services/browser/engine/act')
    invoke.mockImplementation(async (_cmd, payload) => {
      if (payload.op === 'find') return { ok: true, x: 20, y: 20, backend: 42, session: 'course-session' }
      if (payload.op === 'click_node') throw new Error('{"code":-32000,"message":"Node with given id does not belong to the document"}')
      throw new Error(`unexpected retry ${payload.op}`)
    })
    const result = await clickByLocator('b', { by: 'css', value: 'html:nth-of-type(1) > body > div', frameId: 'course', loaderId: 'old-doc' })
    expect(result).toMatchObject({ ok: false, reason: 'invalid', requiresRefresh: true, retry: false })
    expect(result.error).toContain('旧 ref 不再可用')
    expect(result.error).not.toContain('nth-of-type')
    expect(invoke.mock.calls.map(call => call[1].op)).toEqual(['find', 'click_node'])
  })
  it('从定位到实际点击始终携带 frame 和 loader 身份，供原生投递前复核', async () => {
    const { clickByLocator } = await import('../../src/services/browser/engine/act')
    invoke.mockImplementation(async (_cmd, payload) => {
      if (payload.op === 'find') return { ok: true, x: 20, y: 20, backend: 42, session: 'course-session', frameId: 'course-frame', loaderId: 'course-doc' }
      if (payload.op === 'click_node') {
        expect(payload.args).toMatchObject({ backend: 42, session: 'course-session', frameId: 'course-frame', loaderId: 'course-doc' })
        return { ok: true }
      }
      throw new Error(`unexpected op ${payload.op}`)
    })
    expect((await clickByLocator('b', { by: 'css', value: '.chapter-title' })).ok).toBe(true)
  })
})

describe('uncertain clicks', () => {
  it('waits for pre-click layout stability without issuing a duplicate click', async () => {
    invoke.mockReset()
    invoke.mockImplementation(async (_cmd, payload) => {
      if (payload.op === 'find') return { ok: false, reason: 'unstable', retry: true }
      if (payload.op === 'find_wait') return { ok: true, x: 20, y: 20, backend: 123, session: 'frame-session' }
      if (payload.op === 'set_checked') return { ok: true, checked: true }
      throw new Error(`unexpected op: ${payload.op}`)
    })
    const { setCheckedByLocator } = await import('../../src/services/browser/engine/act')
    expect((await setCheckedByLocator('b', { by: 'css', value: 'label', nth: 2 }, true)).ok).toBe(true)
    expect(invoke.mock.calls.filter(call => call[1].op === 'set_checked')).toHaveLength(1)
  })
  it('does not click twice after an unconfirmed option state', async () => {
    invoke.mockReset()
    invoke.mockImplementation(async (_cmd, payload) => {
      if (payload.op === 'find') return { ok: true, x: 20, y: 20, backend: 123, session: 'frame-session' }
      if (payload.op === 'click_node') return { ok: false, error: '选项状态未改变' }
      throw new Error(`unexpected retry: ${payload.op}`)
    })
    const { actOnBrowser } = await import('../../src/services/browser/engine/act')
    const result = await actOnBrowser('b', { op: 'click', locator: { by: 'css', value: '.el-checkbox', nth: 1 } })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('选项状态未改变')
    expect(invoke.mock.calls.filter(call => call[1].op === 'click_node')).toHaveLength(1)
    expect(invoke.mock.calls.filter(call => call[1].op === 'find_wait')).toHaveLength(0)
  })
})
