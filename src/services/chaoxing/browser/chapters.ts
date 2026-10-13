/** 章节卡入口。匹配 chapterMatch、写入/轮询 chapterSync、点播放 chapterPlay。 */
export type { ChapterItem, ChapterJobItem, ChapterParseState, ChapterVideoProgress } from './chapterTypes'
export {
  catalogIndex,
  isCatalogSectionTitle,
  liveJobsBelongHere,
  sameChapterJob,
  stickyJobDone,
  studyNeedsFullJobRead,
  titlesMatch,
} from './chapterMatch'
export {
  applySnap,
  applyVideo,
  publishPlayerJobs,
  browserChapterStates,
  chapterStateFor,
  findChapterInPanel,
  ingestChapterSnap,
  isChaoxingCourseUrl,
  parseChaoxingChapters,
  resyncChaoxingStudy,
  startChaoxingChapterParser,
  stopChaoxingChapterParser,
  syncChaoxingChapterUrl,
} from './chapterSync'
export {
  openChapterFromCard,
  playChapterFromCard,
  playChapterJobFromCard,
  refreshChapterCard,
  waitForChapterState,
} from './chapterPlay'
