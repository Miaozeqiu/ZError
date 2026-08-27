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
  }
}
