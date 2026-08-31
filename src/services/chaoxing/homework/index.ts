/** 学习通作业：读题、填空、点选、和网页同步。页面注入脚本仍在 browserSkills/chaoxingHomework。 */
export type { ChaoxingHomeworkInfo, HomeworkLiveState, HomeworkQuestion, HomeworkOption } from './types'
export { applyHomeworkLiveState, installHomeworkLiveSync, readHomeworkLiveState, startHomeworkLiveSync, stopHomeworkLiveSync } from './live'
export { pickHomeworkOption } from './pick'
export { inspectChaoxingHomework, openChaoxingHomeworkItem, openChaoxingHomeworkList } from './inspect'
export { fillChaoxingHomework, guessChaoxingHomework, saveChaoxingHomework, submitChaoxingHomework } from './fill'
export { runChaoxingChapterQuiz } from './chapterQuiz'
export type { ChapterQuizRunResult } from './chapterQuiz'
