import { beforeEach, describe, expect, it, vi } from 'vitest'
const f = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn(), invoke: vi.fn() }))
vi.mock('../../src/services/security/secureStore', () => ({ readSecureDocument: f.read, writeSecureDocument: f.write, isNativeSecureStore: () => true, isSecretReference: () => true }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: f.invoke }))
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v))
const settle = async () => { const { nextTick } = await import('vue'); await nextTick(); await Promise.resolve() }
describe('actual GUI configuration owners', () => {
  beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); f.read.mockResolvedValue(null); f.write.mockImplementation(async (_name, value) => clone(value)); f.invoke.mockResolvedValue(undefined) })
  it('GUI autosave and CLI commit cannot overwrite each other after delayed IO', async () => {
    const { settingsManager } = await import('../../src/services/app/settings'); await settingsManager.ready
    let release!: () => void
    f.write.mockImplementationOnce(async (_name, value) => { await new Promise<void>(r => { release = r }); return clone(value) })
    const pending = settingsManager.commit(draft => { draft.theme = 'dark' })
    await vi.waitFor(() => expect(f.write).toHaveBeenCalled())
    settingsManager.set('modelRetryCount', 8)
    await settle(); release(); await pending; await settingsManager.save()
    expect(settingsManager.getSettings()).toMatchObject({ theme: 'dark', modelRetryCount: 8 })
    expect(f.write.mock.calls.at(-1)?.[1]).toMatchObject({ theme: 'dark', modelRetryCount: 8 })
  })
  it('model edits made through GUI survive a concurrent CLI model commit', async () => {
    const { modelConfigManager: manager } = await import('../../src/services/model/configManager'); await manager.ready
    let release!: () => void
    f.write.mockImplementationOnce(async (_name, value) => { await new Promise<void>(r => { release = r }); return clone(value) })
    const pending = manager.commit(draft => { draft.globalSettings.timeout = 45000 })
    await vi.waitFor(() => expect(f.write).toHaveBeenCalled())
    manager.getSettings().globalSettings.retryCount = 4
    await settle(); release(); await pending
    expect(f.write.mock.calls.at(-1)?.[1].globalSettings).toMatchObject({ timeout: 45000, retryCount: 4 })
  })
  it('native credential revocation stays serialized with pending UI saves', async () => {
    const accounts = await import('../../src/services/agent/siteAccounts'); await accounts.siteAccountsReady
    await accounts.commitSiteAccounts(draft => { draft['example.com'] = { account: '{{secret:a}}', password: '{{secret:p}}', note: '', updatedAt: 1 } })
    let release!: () => void
    f.invoke.mockImplementationOnce(async () => { await new Promise<void>(r => { release = r }) })
    const removed = accounts.removeWebsiteAccounts('example.com')
    await vi.waitFor(() => expect(f.invoke).toHaveBeenCalled())
    accounts.rememberSiteAccount('other.example', { account: 'user', password: 'new' })
    release(); await removed; await settle()
    await accounts.commitSiteAccounts(() => {})
    expect(f.invoke).toHaveBeenCalledWith('secure_remove_site_accounts', expect.objectContaining({ ids: expect.arrayContaining(['example.com']) }))
    expect(f.write.mock.calls.at(-1)?.[1]).not.toHaveProperty('example.com')
    expect(f.write.mock.calls.at(-1)?.[1]).toHaveProperty('other.example')
  })
})
