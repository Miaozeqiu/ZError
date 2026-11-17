/** Agent wait 读面板的窄门。不要 import chaoxing/browser；也不要从这里再进 adapter（watchAgent ↔ agentWait 会成环）。 */
import { nativeWatchBusy, nativeWatchFor } from '../browser/videoWatch'
import {
  agentWatchBusy as chaoxingWatchBusy,
  videoWatchFor as chaoxingWatchFor,
} from '../chaoxing/browser/watch'

export { chapterStateFor, ingestChapterSnap } from '../chaoxing/browser/chapters'
export { ensurePanelStudy, packAgentPanel, readPanelStudy } from '../chaoxing/browser/panelStudy'
export { formatVideoClock, watchSessionFastPath } from '../chaoxing/browser/watch'

/** 学习通 Agent watch 优先；没有则用通用原生 <video> 监测。空白面板监测不算。 */
export const videoWatchFor = (browserId?: string) => (
  chaoxingWatchFor(browserId) || nativeWatchFor(browserId)
)

export const agentWatchBusy = (browserId?: string) => (
  chaoxingWatchBusy(browserId) || nativeWatchBusy(browserId)
)
