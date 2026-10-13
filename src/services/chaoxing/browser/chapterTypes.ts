/** 章节卡类型。状态在 chapters.ts，写入在 chapterIngest.ts。 */
export type ChapterItem = {
  title: string
  index?: string
  depth?: number
  parent?: string
  kind?: 'chapter' | 'section'
  jobs: number
  unfinished: boolean
  active?: boolean
  href?: string
  studyHref?: string
  chapterId?: string
}

export type ChapterVideoProgress = {
  current: number
  duration: number
  percent: number
  paused: boolean
  ended: boolean
  title: string
  updatedAt: number
}

export type ChapterJobItem = {
  mid: string
  jobid: string
  label: string
  kind: 'video' | 'quiz' | 'doc' | 'other'
  jobDone: boolean
  unfinished: boolean
  active: boolean
  /** 仅当前播放中的视频任务带进度 */
  current?: number
  duration?: number
  percent?: number
  paused?: boolean
}

export type ChapterParseState = {
  browserId: string
  url: string
  page: string
  kind: 'course' | 'player'
  current: string
  currentTitle: string
  unfinished: string[]
  unfinishedCount: number
  chapters: ChapterItem[]
  progress: { done: number; total: number } | null
  video: ChapterVideoProgress | null
  jobs: ChapterJobItem[]
  jobChapterId?: string
  /** 刚切章：直播页任务点对上这个节名之前，不要沿用上一节 jobs */
  expectChapterTitle?: string
  status: 'reading' | 'ready' | 'empty'
  updatedAt: number
}
