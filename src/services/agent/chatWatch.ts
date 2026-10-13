import { stopNativeWatch } from '../browser/videoWatch'
import { stopChaoxingWatch } from '../chaoxing/browser/watch'

export const stopWatchFor = (browserId?: string, opts?: { keep?: boolean }) => {
  stopChaoxingWatch(browserId, opts)
  stopNativeWatch(browserId, opts)
}
