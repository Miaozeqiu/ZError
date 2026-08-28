export type ChaoxingChapterSnap = {
  url?: string
  page?: string
  current?: string
  unfinished?: string[]
  unfinishedCount?: number
  firstUnfinished?: string
  onUnfinished?: boolean
  progress?: { done: number; total: number } | null
  chapters?: Array<{
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
  }>
  hint?: string
  via?: string
  ts?: number
  live?: boolean
  needInstall?: boolean
}

export type ChaoxingVideoInfo = {
  page?: string
  chapterId?: string
  step?: string
  quiz?: boolean
  captcha?: boolean
  jobDone?: boolean | null
  current?: string
  next?: string
  unfinished?: string[]
  moreVideos?: boolean
  videoCount?: number
  videoIndex?: number
  steps?: Array<{ label: string; video?: boolean; quiz?: boolean; doc?: boolean; active?: boolean; jobDone?: boolean | null }>
  video?: {
    paused: boolean
    ended: boolean
    current: number
    duration: number
  } | null
  hint?: string
}

export type ChaoxingVideoTick = {
  current: number
  duration: number
  paused: boolean
  ended: boolean
  ready?: number
  src?: string
  ts?: number
  hasVideo?: boolean
}
