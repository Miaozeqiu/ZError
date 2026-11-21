import { initializeChatRuntime } from './chatLoop'

let dispose: (() => void) | null = null
/** The app owns background work; workspace mounting only owns UI subscriptions. */
export function startAgentRuntime() {
  if (dispose) return dispose
  const stop = initializeChatRuntime()
  const cleanup = () => {
    if (dispose !== cleanup) return
    stop(); dispose = null
  }
  dispose = cleanup
  return dispose
}
