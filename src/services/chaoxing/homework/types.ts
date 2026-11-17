export type HomeworkOption = {
  letter: string
  text: string
  selected?: boolean
  image?: string
  images?: string[]
  imageKeys?: string[]
}

export type HomeworkQuestion = {
  id: string
  index: number
  type?: string
  typeName?: string
  stem: string
  images?: string[]
  options?: HomeworkOption[]
  imageKeys?: string[]
  filled?: boolean
  imageCount?: number
  needsVision?: boolean
  readBy?: string
}

export type HomeworkCard = {
  page?: string
  url?: string
  works?: Array<{ title: string; status: string; score?: string; due?: string; href?: string }>
  pending?: Array<{ title: string; status: string }>
  pendingCount?: number
  questions?: HomeworkQuestion[]
  questionCount?: number
  questionTotal?: number
  truncated?: boolean
  filledCount?: number
  hint?: string
  title?: string
  next?: 'list' | 'open' | 'inspect' | 'fill' | 'save' | 'submit' | 'done'
  canSave?: boolean
  canSubmit?: boolean
  ok?: boolean
  error?: string
  skippedVision?: boolean
}

/** @deprecated 用 HomeworkCard */
export type ChaoxingHomeworkInfo = HomeworkCard

export type HomeworkLiveState = {
  ts?: number
  count?: number
  states?: Array<{ index: number; selected?: string; filled?: boolean }>
}
