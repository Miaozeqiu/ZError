import type { SearchTrace } from '../searchService'

export interface MultiModelResponse {
  modelId: string
  modelName: string
  platformName: string
  response: string
  reasoningContent?: string
  streamingReasoning?: string
  isLoading: boolean
}

export interface RequestLog {
  id: string
  timestamp: number
  method: string
  path: string
  status?: number
  ip: string
  userAgent: string
  responseTime?: number
  requestBody?: string
  responseBody?: string
  headers?: Record<string, string>
  stage?: string
  modelResponse?: string
  reasoningContent?: string
  streamingReasoning?: string
  isModelCalling?: boolean
  modelInfo?: {
    platformName: string
    modelName: string
    modelId: string
  }
  multiModelResponses?: MultiModelResponse[]
  searchTraces?: SearchTrace[]
  urlQuestion?: {
    title: string
    options: string
    questionType?: string
    imageUrl: string | null
    analyzing: boolean
    analysisResult: string | null
    analysisError: string
    streamingResponse: string
    streamingReasoning: string
    reasoningContent: string
    renderedHtml?: string
    /** OCS >= 5.1.0 图片题优化：base64 数组，与题干 [图片N] 占位符同序；存在时无需下载 URL */
    images?: string[]
  }
}

export type SameQuestionCandidate = {
  id: number
  question: string
  options?: string | null
}

export type SameQuestionCheckPayload = {
  title: string
  options?: string | null
  candidates: SameQuestionCandidate[]
}
