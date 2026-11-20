import { initializeChatRuntime } from './chatLoop'
import { ensureSiteHooks } from '../platform'

let dispose: (() => void) | null = null
/** The app owns background work; workspace mounting only owns UI subscriptions. */
export function startAgentRuntime() {
  if (dispose) return dispose
  const stopSites = ensureSiteHooks()
  const stop = initializeChatRuntime()
  const cleanup = () => {
    if (dispose !== cleanup) return
    stop(); stopSites(); dispose = null
  }
  dispose = cleanup
  return dispose
}
