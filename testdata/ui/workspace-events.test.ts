// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installWorkspaceEventBuffer, listenWorkspaceEvent } from '../../src/services/ui/workspaceEvents'
const cleanup: Array<() => void> = []
afterEach(() => { for (const stop of cleanup.splice(0).reverse()) stop() })
describe('lazy workspace commands', () => {
  it('delivers the latest pending command once after the workspace mounts', () => {
    cleanup.push(installWorkspaceEventBuffer())
    window.dispatchEvent(new CustomEvent('prefill-agent-composer', { detail: { text: 'first' } }))
    window.dispatchEvent(new CustomEvent('prefill-agent-composer', { detail: { text: 'latest' } }))
    const receive = vi.fn()
    cleanup.push(listenWorkspaceEvent('agent', 'prefill-agent-composer', receive))
    expect(receive).toHaveBeenCalledTimes(1)
    expect((receive.mock.calls[0][0] as CustomEvent).detail.text).toBe('latest')
  })
  it('keeps each workspace subscription independent when one is still unloaded', () => {
    cleanup.push(installWorkspaceEventBuffer())
    const study = vi.fn(), agent = vi.fn()
    cleanup.push(listenWorkspaceEvent('study', 'open-study-graph', study))
    window.dispatchEvent(new CustomEvent('open-study-graph', { detail: { subjectId: 12 } }))
    expect(study).toHaveBeenCalledTimes(1)
    cleanup.push(listenWorkspaceEvent('agent', 'open-study-graph', agent))
    expect(agent).toHaveBeenCalledTimes(1)
    expect(study).toHaveBeenCalledTimes(1)
  })
  it('cleans up an unloaded workspace without losing later commands', () => {
    cleanup.push(installWorkspaceEventBuffer())
    const old = vi.fn(), current = vi.fn()
    const stop = listenWorkspaceEvent('settings', 'open-model-settings', old)
    stop()
    window.dispatchEvent(new Event('open-model-settings'))
    expect(old).not.toHaveBeenCalled()
    cleanup.push(listenWorkspaceEvent('settings', 'open-model-settings', current))
    expect(current).toHaveBeenCalledTimes(1)
  })
})
