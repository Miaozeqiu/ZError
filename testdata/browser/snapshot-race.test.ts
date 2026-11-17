import { describe, expect, it, vi } from 'vitest'

const { callProtocol } = vi.hoisted(() => ({ callProtocol: vi.fn() }))
vi.mock('../../src/services/browser/protocol', () => ({ callProtocol }))

import { readBrowserPage } from '../../src/services/browser/appBrowser'
import { beginPageSnap, cachedPageSnap, invalidatePageSnap } from '../../src/services/browser/engine/pageSnap'
import { locatorFromCache } from '../../src/services/browser/engine/refs'

describe('快照与引用缓存一致性', () => {
  it('较早的快照晚到时不能覆盖最新快照的引用，也不能把过期引用返回给 Agent', async () => {
    const id = 'snapshot-race'
    invalidatePageSnap(id)
    let resolveOld!: (value: unknown) => void
    callProtocol.mockReset()
    callProtocol.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    callProtocol.mockResolvedValueOnce({ url: 'https://example.com', snapshot: '- button "视频" [ref=e2]',
      refs: [{ id: 'e2', role: 'button', name: '视频', locator: { by: 'css', value: '#new' } }] })
    const old = readBrowserPage(id, { gen: beginPageSnap(id) })
    await vi.waitFor(() => expect(callProtocol).toHaveBeenCalledTimes(1))
    await readBrowserPage(id, { gen: beginPageSnap(id) })
    resolveOld({ url: 'https://example.com', snapshot: '- button "旧" [ref=e1]',
      refs: [{ id: 'e1', role: 'button', name: '旧', locator: { by: 'css', value: '#old' } }] })
    expect(await old).toMatchObject({ snapshot: '', refs: [], error: '页面快照已过期，请重新读取。' })
    expect(cachedPageSnap(id)?.snapshot).toContain('e2')
    expect(locatorFromCache(id, 'e2')?.value).toBe('#new')
    expect(locatorFromCache(id, 'e1')).toBeNull()
  })

  it('普通读取晚于新读取返回时不会替换新引用', async () => {
    const id = 'ordinary-snapshot-race'
    invalidatePageSnap(id)
    let resolveOld!: (value: unknown) => void
    callProtocol.mockReset()
    callProtocol.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    callProtocol.mockResolvedValueOnce({ snapshot: '- button "新" [ref=e4]',
      refs: [{ id: 'e4', role: 'button', name: '新', locator: { by: 'css', value: '#new' } }] })
    const old = readBrowserPage(id)
    await vi.waitFor(() => expect(callProtocol).toHaveBeenCalledTimes(1))
    await readBrowserPage(id)
    resolveOld({ snapshot: '- button "旧" [ref=e3]',
      refs: [{ id: 'e3', role: 'button', name: '旧', locator: { by: 'css', value: '#old' } }] })
    expect(await old).toMatchObject({ snapshot: '', error: '页面快照已过期，请重新读取。' })
    expect(locatorFromCache(id, 'e4')?.value).toBe('#new')
    expect(locatorFromCache(id, 'e3')).toBeNull()
  })

  it('用户接管使快照失效后，未完成的普通读取不能重新写入引用', async () => {
    const id = 'snapshot-after-handoff'
    invalidatePageSnap(id)
    let resolveOld!: (value: unknown) => void
    callProtocol.mockReset()
    callProtocol.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve }))
    const old = readBrowserPage(id)
    await vi.waitFor(() => expect(callProtocol).toHaveBeenCalledTimes(1))
    invalidatePageSnap(id)
    resolveOld({ snapshot: '- button "旧" [ref=e5]',
      refs: [{ id: 'e5', role: 'button', name: '旧', locator: { by: 'css', value: '#old' } }] })
    expect(await old).toMatchObject({ snapshot: '', error: '页面快照已过期，请重新读取。' })
    expect(cachedPageSnap(id)).toBeNull()
    expect(locatorFromCache(id, 'e5')).toBeNull()
  })
})
