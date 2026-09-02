import { studyScript } from '../../agent/skillRuntime'

/** 刷课解析器脚本来自 Skill `parsers/study/`，这里只做调用。 */
export const CHAOXING_STUDY_INSPECT = () => studyScript('inspect')
export const CHAOXING_CHAPTER_INSTALL = () => studyScript('install')
export const CHAOXING_CHAPTER_REFRESH = () => studyScript('refresh')
export const CHAOXING_PARSE_CHAPTERS = CHAOXING_CHAPTER_INSTALL
export const CHAOXING_LIST_CHAPTERS = CHAOXING_CHAPTER_INSTALL
export const CHAOXING_CLICK_CHAPTER_TAB = () => studyScript('clickTab')
export const CHAOXING_OPEN_CHAPTER = () => studyScript('openChapter')
export const CHAOXING_PLAY_SCRIPT = () => studyScript('play')
export const CHAOXING_CLICK_VIDEO_TAB = () => studyScript('clickVideoTab')
export const CHAOXING_CLICK_STEP = () => studyScript('clickStep')
export const CHAOXING_NEXT_STEP = () => studyScript('nextStep')
export const CHAOXING_VIDEO_HOOK = () => studyScript('videoHook')
export const CHAOXING_VIDEO_TICK = () => studyScript('videoTick')
export const CHAOXING_CHAPTER_JOB_TICK = () => studyScript('jobTick')
export const CHAOXING_CHAPTER_HOOK = () => studyScript('hook')
export const CHAOXING_CHAPTER_TICK = () => studyScript('tick')
export const CHAOXING_CAPTCHA_CHECK = () => studyScript('captchaCheck')
export const CHAOXING_CAPTCHA_IMAGE = () => studyScript('captchaImage')
export const CHAOXING_CAPTCHA_REFRESH = () => studyScript('captchaRefresh')
export const CHAOXING_CAPTCHA_FILL = () => studyScript('captchaFill')
