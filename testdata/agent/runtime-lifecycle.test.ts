import { describe, expect, it, vi } from 'vitest'
const stopWatch = vi.hoisted(() => vi.fn())
const initialize = vi.hoisted(() => vi.fn(() => stopWatch))
vi.mock('../../src/services/agent/chatLoop', () => ({ initializeChatRuntime: initialize }))
import { startAgentRuntime } from '../../src/services/agent/runtime'
it('the app owns one runtime and obsolete cleanup cannot stop a later lifecycle', () => {
  const oldStop = startAgentRuntime()
  expect(startAgentRuntime()).toBe(oldStop)
  expect(initialize).toHaveBeenCalledOnce()
  oldStop(); oldStop()
  expect(stopWatch).toHaveBeenCalledOnce()
  const stop = startAgentRuntime()
  oldStop()
  expect(stopWatch).toHaveBeenCalledOnce()
  stop()
  expect(stopWatch).toHaveBeenCalledTimes(2)
})
