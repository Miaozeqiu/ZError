import { describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ invoke: vi.fn(), listen: vi.fn(), dispatch: vi.fn() }))
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke }))
vi.mock('@tauri-apps/api/event', () => ({ listen: mocks.listen }))
vi.mock('../../src/services/cli/commands', () => ({ dispatchCli: mocks.dispatch }))
vi.mock('../../src/services/security/secureStore', () => ({ redactNative: async () => 'redacted error' }))
import { startCliRuntime } from '../../src/services/cli/runtime'

describe('CLI main-webview bridge', () => {
  it('claims requests once, returns errors and disposes the listener', async () => {
    mocks.invoke.mockReset(); mocks.dispatch.mockReset()
    let listener!: (event: { payload: { id: string } }) => void
    const unlisten = vi.fn()
    mocks.listen.mockImplementation(async (_name, fn) => { listener = fn; return unlisten })
    mocks.invoke.mockImplementation(async name => name === 'cli_connect' ? { generation: 'g' } : name === 'cli_take' ? { method: 'status', params: {} } : undefined)
    mocks.dispatch.mockRejectedValue(new Error('sensitive'))
    const stop = await startCliRuntime()
    listener({ payload: { id: '1' } }); listener({ payload: { id: '1' } })
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith('cli_complete', { id: '1', generation: 'g', result: { ok: false, code: 'operation_failed', error: 'redacted error' } }))
    expect(mocks.dispatch).toHaveBeenCalledTimes(1)
    stop(); listener({ payload: { id: '2' } })
    expect(unlisten).toHaveBeenCalledOnce()
    expect(mocks.dispatch).toHaveBeenCalledTimes(1)
  })
})
