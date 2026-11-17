/** 学习通面板层：章节卡、进度条、监测。UI 读这里的 state，不要从 study 直接改 Vue ref。 */

export {
  browserChapterStates,
  chapterStateFor,
  startChaoxingChapterParser,
  stopChaoxingChapterParser,
  syncChaoxingChapterUrl,
  resyncChaoxingStudy,
  openChapterFromCard,
  playChapterFromCard,
  playChapterJobFromCard,
  refreshChapterCard,
  waitForChapterState,
} from './chapters'
export type { ChapterItem, ChapterJobItem, ChapterParseState } from './chapters'

export {
  ensurePanelStudy,
  nextPanelStudy,
  openPanelChapter,
  packAgentPanel,
  playPanelStudy,
  readPanelStudy,
} from './panelStudy'

export {
  startChaoxingWatch,
  stopChaoxingWatch,
  videoWatchFor,
  agentWatchBusy,
  formatVideoClock,
  watchSessionFastPath,
} from './watch'

export { ensureStudyWatch, liveStudyPlayback } from './playback'
export { bindChaoxingWatchAgent, dropWatchQueue, flushWatchAfterTurn } from './watchAgent'
