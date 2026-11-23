/** Agent 对话共用的活动预览和工具步骤类型。 */
export type ImportTaskStepStatus = 'running' | 'done' | 'failed'
export type ImportTaskStepKind = 'model' | 'tool'

export interface ImportStepPreview {
  question: string
  options?: string
  answer: string
  question_type?: string
  question_id?: number
  explanation?: string
  importance?: number
  mastery?: number
  difficulty?: number
}

export interface ImportTaskStep {
  id: string
  kind: ImportTaskStepKind
  name: string
  label: string
  target?: string
  title?: string
  detail?: string
  preview?: ImportStepPreview[]
  previewCount?: number
  status: ImportTaskStepStatus
  startedAt: number
  finishedAt?: number
  /** 发给模型的原始参数 JSON，跨轮回放 tool_calls 用 */
  arguments?: string
  /** 工具返回正文，跨轮回放 role=tool 用 */
  result?: string
  /** 工具开始时助手正文长度，用于对话里按时间线插入，而不是全部堆在顶部 */
  atContentLength?: number
  jobId?: string
  children?: ImportTaskStep[]
}
