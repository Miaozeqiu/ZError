/** 学习通刷课：章节、播放、验证码。目录本地解析，动作走 CDP。 */
export type { ChaoxingChapterSnap, ChaoxingVideoInfo, ChaoxingVideoTick } from './types'
export type { OpenChapterHint } from './chapters'
export { dumpChaoxingParseHtml } from './dump'
export { lastStudyParser, noteStudyParser } from './debug'
export {
  fillChaoxingCaptcha,
  readChaoxingCaptcha,
  readChaoxingCaptchaImage,
  refreshChaoxingCaptcha,
  CAPTCHA_HINT,
} from './captcha'
export {
  CHAPTER_PARSER_ENABLED,
  installChaoxingChapterHook,
  openChaoxingChapter,
  openChaoxingChapters,
  openNextChaoxingChapter,
  openNextChaoxingStep,
  parseChaoxingChapters,
  readChaoxingChapterSnap,
  readChaoxingChapterTick,
  liveStudyHref,
  waitForStudentStudyPage,
  waitForStudyPlayerReady,
  studyChaoxingUnfinished,
} from './chapters'
export {
  installChaoxingVideoHook,
  playChaoxingVideo,
  tapChaoxingPlay,
  pinChaoxingPlayMid,
  pauseChaoxingVideo,
  clickChaoxingStep,
  readChaoxingChapterJobTick,
  asVideoTick,
  readChaoxingVideo,
  readChaoxingVideoTick,
  videoIsPlaying,
  videoTickHasPlayer,
} from './video'
