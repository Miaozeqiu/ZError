/** 平台适配：对外稳定角色 / Agent 操作，对内按平台换实现。 */

export type PlatformRole = 'login' | 'study' | 'homework' | 'captcha'

export type PlatformId = string

export type StudyPlayOptions = {
  videoIndex?: number
  label?: string
  skipTabClick?: boolean
}

export type HomeworkAction =
  | 'list'
  | 'open'
  | 'inspect'
  | 'fill'
  | 'guess'
  | 'save'
  | 'submit'

export type HomeworkToolArgs = {
  action: HomeworkAction
  title?: string
  answers?: unknown
}

/** Agent / UI 共用的稳定能力面；具体 DOM 解析由各平台实现。 */
export type PlatformAdapter = {
  id: PlatformId
  name: string
  /** 匹配主机 / 站点 */
  matchHost: (url: string) => boolean

  roleOf: (url: string) => PlatformRole | null
  isPlayerUrl: (url: string) => boolean
  isCourseUrl: (url: string) => boolean
  isHomeworkDoUrl: (url: string) => boolean
  isHomeworkListUrl: (url: string) => boolean
  isHomeworkUrl: (url: string) => boolean
  isChapterWorkUrl: (url: string) => boolean
  canUseHomeworkTools: (url: string) => boolean
  isStudyUrl: (url: string) => boolean
  isLoginUrl: (url: string) => boolean

  /** 章节目录 / 未完成 */
  openChapters: (browserId: string) => Promise<unknown>
  /** 点播 */
  playVideo: (browserId: string, options?: StudyPlayOptions) => Promise<Record<string, unknown>>
  /** 读当前视频快照 */
  readVideo: (browserId: string) => Promise<Record<string, unknown> | null>
  /** 下一任务点 / 下一节 */
  openNext: (browserId: string) => Promise<Record<string, unknown>>
  videoIsPlaying: (snap: Record<string, unknown> | null | undefined) => boolean
  startWatch: (
    browserId: string,
    sessionId: string,
    snap: Record<string, unknown> | null | undefined,
    options?: { resume?: boolean },
  ) => void
  videoWatchFor: (browserId: string) => { status?: string; title?: string } | null | undefined
  startChapterParser?: (browserId: string) => void | Promise<void>

  /** 作业 / 章节测验题卡 */
  runHomework: (browserId: string, args: HomeworkToolArgs) => Promise<unknown>

  /** 图片验证码 */
  fillCaptcha: (browserId: string, code: string) => Promise<Record<string, unknown>>
  clearPendingCaptcha?: (sessionId: string) => void
  runAfterCaptcha?: <T,>(
    sessionId: string,
    browserId: string,
    run: () => Promise<T>,
  ) => Promise<T>

  /** 抽象层展示名（短） */
  roleLabel: (role: PlatformRole) => string
  /** Agent 工具提示里用的平台名 */
  skillHint?: string
}
