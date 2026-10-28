// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
const store = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }))
vi.mock('../../src/services/security/secureStore', () => ({ readSecureDocument: store.read, writeSecureDocument: store.write, isSecretReference: (value: unknown) => typeof value === 'string' && value.startsWith('{{secret:') }))
const row = (id: string) => ({ account: `{{secret:site/${id}/account}}`, password: `{{secret:site/${id}/password}}`, note: '', updatedAt: 1 })
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); store.write.mockImplementation(async (_name, value) => value) })
describe('website encrypted storage lifecycle', () => {
  it('hydrates references and persists edits through the secure backend, leaving localStorage empty', async () => {
    store.read.mockResolvedValue({ chaoxing: row('chaoxing'), 'example.com': row('example.com') })
    const mod = await import('../../src/services/agent/siteAccounts')
    await mod.siteAccountsReady
    mod.rememberSiteAccount('example.com', { password: 'new-synthetic-password' })
    await vi.waitFor(() => expect(store.write).toHaveBeenCalled())
    const saved = store.write.mock.calls.at(-1)![1]
    expect(saved.chaoxing).toEqual(row('chaoxing'))
    expect(saved['example.com'].password).toBe('new-synthetic-password')
    expect(mod.siteAccountsPrompt('https://example.com')).not.toContain('new-synthetic-password')
    expect(localStorage.length).toBe(0)
  })
  it('preserves user changes made while the native storage is still unlocking', async () => {
    let release!: (value: any) => void
    store.read.mockReturnValue(new Promise(resolve => { release = resolve }))
    const mod = await import('../../src/services/agent/siteAccounts')
    mod.forgetSiteAccount('chaoxing')
    mod.rememberSiteAccount('example.com', row('new-account'))
    release({ chaoxing: row('chaoxing'), 'example.com': row('old-account'), zjooc: row('zjooc') })
    await mod.siteAccountsReady
    expect(mod.siteAccountOf('chaoxing')).toBeNull()
    expect(mod.siteAccountOf('example.com')?.account).toBe(row('new-account').account)
    expect(mod.siteAccountOf('zjooc')?.account).toBe(row('zjooc').account)
    await vi.waitFor(() => expect(store.write).toHaveBeenCalled())
  })
  it('does not overwrite unread stored accounts after an unlock failure', async () => {
    store.read.mockRejectedValue(new Error('locked'))
    const mod = await import('../../src/services/agent/siteAccounts')
    await mod.siteAccountsReady
    mod.rememberSiteAccount('example.com', { account: 'unsaved', password: 'unsaved-secret' })
    await vi.waitFor(() => expect(mod.siteAccountsState.saveError).toContain('安全保存'))
    expect(store.write).not.toHaveBeenCalled()
  })
})
