import { beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), write: vi.fn(), settings: { theme: 'auto', modelRetryCount: 2, network: { serverPort: 3000, enableLanAccess: false } } }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('../../src/services/security/secureStore', () => ({ redactNative: async (v: unknown) => v, writeSecureDocument: mocks.write }))
vi.mock('../../src/services/app/settings', async () => {
  const { createDocumentPersistence, replaceDocument } = await import('../../src/services/security/documentPersistence')
  const owner = createDocumentPersistence({ ready: async () => {}, writable: () => true, read: () => mocks.settings, apply: value => replaceDocument(mocks.settings, value), write: value => mocks.write('app_settings', value) })
  return { settingsManager: { ready: Promise.resolve(), getSettings: () => mocks.settings, commit: owner.commit } }
})
import { cliHandlers, dispatchCli } from '../../src/services/cli/commands'
import { CLI_METHODS } from '../../src/services/cli/contracts'

describe('typed CLI registry', () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.settings.theme = 'auto'; mocks.settings.modelRetryCount = 2; mocks.write.mockImplementation(async (_name, value) => value); mocks.invoke.mockResolvedValue([]) })
  it('registers exactly every advertised method', () => expect(Object.keys(cliHandlers).sort()).toEqual(Object.keys(CLI_METHODS).sort()))
  it('preserves UI edits made while CLI storage is pending', async () => {
    let finish!: () => void
    mocks.write.mockImplementationOnce(async (_name, value) => { await new Promise<void>(r => { finish = r }); return value })
    const pending = dispatchCli('config.set', { key: 'theme', value: 'dark' })
    await vi.waitFor(() => expect(mocks.write).toHaveBeenCalled())
    expect(mocks.settings.theme).toBe('auto')
    mocks.settings.modelRetryCount = 6
    finish(); await pending
    expect(mocks.settings).toMatchObject({ theme: 'dark', modelRetryCount: 6 })
    expect(mocks.write.mock.calls.at(-1)?.[1]).toMatchObject({ theme: 'dark', modelRetryCount: 6 })
  })
  it('does not apply an unpersisted setting and recovers from failure', async () => {
    mocks.write.mockRejectedValueOnce(new Error('vault locked'))
    await expect(dispatchCli('config.set', { key: 'theme', value: 'dark' })).rejects.toThrow('vault locked')
    expect(mocks.settings.theme).toBe('auto')
    await expect(dispatchCli('config.set', { key: 'theme', value: 'dark' })).resolves.toMatchObject({ saved: true })
  })
  it('rejects invalid requests before invoking native operations', async () => {
    await expect(dispatchCli('questions.delete', { id: 1 })).rejects.toThrow()
    await expect(dispatchCli('unknown', {})).rejects.toThrow()
    expect(mocks.invoke).not.toHaveBeenCalled()
  })
  it('rechecks request lifetime inside a queued settings mutation', async () => {
    let checks = 0
    await expect(dispatchCli('config.set', { key: 'theme', value: 'dark' }, async () => { if (++checks > 1) throw new Error('expired') })).rejects.toThrow('expired')
    expect(mocks.write).not.toHaveBeenCalled()
  })
  it('forwards bounded searches and database errors', async () => {
    await dispatchCli('questions.search', { keyword: 'ethics', page: 2, pageSize: 15 })
    expect(mocks.invoke).toHaveBeenCalledWith('search_questions_page', expect.objectContaining({ keyword: 'ethics', page: 2, pageSize: 15 }))
    mocks.invoke.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(dispatchCli('folders.list', {})).rejects.toThrow('database unavailable')
  })
})
