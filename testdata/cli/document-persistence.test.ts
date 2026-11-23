import { describe, expect, it, vi } from 'vitest'
import { createDocumentPersistence, mergeDocument, replaceDocument } from '../../src/services/security/documentPersistence'

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r }); return { promise, resolve } }

describe('GUI and CLI share durable document ownership', () => {
  it('accepts native object-key reordering without looping or enqueueing extra writes', async () => {
    const state = { z: 1, nested: { b: 2, a: 1 }, a: 0 }
    const write = vi.fn(async (value: typeof state) => {
      if (write.mock.calls.length > 2) throw new Error('save loop')
      return JSON.parse(JSON.stringify(value, (_key, row) => row && typeof row === 'object' && !Array.isArray(row) ? Object.fromEntries(Object.keys(row).sort().map(key => [key, row[key]])) : row))
    })
    const owner = createDocumentPersistence({ ready: async () => {}, writable: () => true, read: () => state, apply: value => replaceDocument(state, value), write })
    await owner.commit(draft => { draft.z = 3 }); await owner.save()
    expect(write).toHaveBeenCalledOnce()
    expect(state.z).toBe(3)
  })
  function fixture() {
    const state = { theme: 'auto', retries: 2, search: { apiKey: '{{secret:old}}', provider: 'exa' } }
    const gate = deferred()
    let stored = clone(state)
    const write = vi.fn(async (value: typeof state) => {
      if (write.mock.calls.length === 1) await gate.promise
      stored = clone(value)
      return clone(value)
    })
    const owner = createDocumentPersistence({ ready: async () => {}, writable: () => true, read: () => state, apply: value => replaceDocument(state, value), write })
    return { state, gate, write, owner, stored: () => stored }
  }
  it('keeps concurrent GUI fields and drains older queued autosaves using fresh snapshots', async () => {
    const f = fixture()
    const cli = f.owner.commit(draft => { draft.theme = 'dark' })
    await vi.waitFor(() => expect(f.write).toHaveBeenCalledOnce())
    expect(f.state.theme).toBe('auto')
    f.state.retries = 8
    const autosave = f.owner.save()
    f.state.search.provider = 'tavily'
    const later = f.owner.save()
    f.gate.resolve()
    await Promise.all([cli, autosave, later])
    expect(f.stored()).toEqual({ theme: 'dark', retries: 8, search: { apiKey: '{{secret:old}}', provider: 'tavily' } })
    expect(f.state).toEqual(f.stored())
    expect(f.write).toHaveBeenCalledTimes(2)
  })
  it('lets a later GUI edit to the same field win over a pending CLI write', async () => {
    const f = fixture()
    const cli = f.owner.commit(draft => { draft.theme = 'dark' })
    await vi.waitFor(() => expect(f.write).toHaveBeenCalledOnce())
    f.state.theme = 'light'
    f.gate.resolve()
    expect((await cli).theme).toBe('light')
    expect(f.stored().theme).toBe('light')
  })
  it('rolls forward other UI changes after a rejected write without applying the failed CLI mutation', async () => {
    const f = fixture()
    f.write.mockRejectedValueOnce(new Error('vault locked'))
    await expect(f.owner.commit(draft => { draft.theme = 'dark' })).rejects.toThrow('vault locked')
    expect(f.state.theme).toBe('auto')
    f.state.retries = 5; f.gate.resolve()
    await f.owner.commit(draft => { draft.theme = 'light' })
    expect(f.stored()).toMatchObject({ theme: 'light', retries: 5 })
  })
  it('does not write unread documents or execute expired queued mutations', async () => {
    const write = vi.fn()
    const locked = createDocumentPersistence({ ready: async () => {}, writable: () => false, read: () => ({ a: 1 }), apply: () => {}, write })
    await expect(locked.commit(draft => { draft.a = 2 })).rejects.toThrow('尚未成功读取')
    expect(write).not.toHaveBeenCalled()
    const f = fixture()
    const first = f.owner.commit(draft => { draft.retries = 4 })
    await vi.waitFor(() => expect(f.write).toHaveBeenCalledOnce())
    const expired = f.owner.commit(async () => { throw new Error('request expired') })
    f.gate.resolve(); await first
    await expect(expired).rejects.toThrow('request expired')
    expect(f.write).toHaveBeenCalledTimes(1)
  })
  it('normalizes secrets without resurrecting GUI-deleted models or discarding newly added ones', () => {
    const base = { platforms: [{ id: 'p', apiKey: 'raw', models: [{ id: 'a', enabled: true }, { id: 'b', enabled: true }] }] }
    const current = { platforms: [{ id: 'p', apiKey: 'raw', models: [{ id: 'a', enabled: false }, { id: 'c', enabled: true }] }] }
    const saved = { platforms: [{ id: 'p', apiKey: '{{secret:p}}', models: [{ id: 'a', enabled: true }, { id: 'b', enabled: true }] }] }
    expect(mergeDocument(current, base, saved)).toEqual({ platforms: [{ id: 'p', apiKey: '{{secret:p}}', models: [{ id: 'a', enabled: false }, { id: 'c', enabled: true }] }] })
    expect(base.platforms[0].apiKey).toBe('raw')
  })
  it('keeps a newer credential when native normalization returns the older credential reference', () => {
    expect(mergeDocument({ password: 'newer' }, { password: 'old' }, { password: '{{secret:old}}' })).toEqual({ password: 'newer' })
  })
  it('queues native account revocation with autosave so removed credentials are not reintroduced', async () => {
    const f = fixture()
    const revocation = f.owner.exclusive(async () => { await f.gate.promise; f.state.search.apiKey = '' })
    f.state.retries = 9
    const pendingSave = f.owner.save()
    f.gate.resolve(); await Promise.all([revocation, pendingSave])
    expect(f.stored()).toMatchObject({ retries: 9, search: { apiKey: '' } })
  })
})
