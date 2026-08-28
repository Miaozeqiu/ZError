import { computed, ref } from 'vue'
import { MODEL_REQUEST_CANCELLED_MESSAGE } from './errors'
import { buildRenderedHtml } from './visionImage'
import type { RequestLog } from './types'

export const MAX_REQUEST_LOGS = 100

export const requestLogs = ref<RequestLog[]>([])
export const selectedLog = ref<RequestLog | null>(null)
export const showLogDetails = ref(false)
export const slideInActive = ref(false)

export const heartbeatIntervals = new Map<string, number>()
export const activeModelAbortControllers = new Map<string, Set<AbortController>>()
export const cancelledRequestIds = new Set<string>()
export const finalModelResponseState = new Map<string, 'success' | 'error'>()
export const processedRequestIds = new Set<string>()
export const activeUrlAnalysisRequestIds = new Set<string>()

export const filteredRequestLogs = computed(() => {
  return requestLogs.value.filter(log => {
    if (log.headers && Object.keys(log.headers).length > 0) return true
    if (log.requestBody || log.responseBody || log.modelResponse) return true
    return false
  })
})

export const registerAbortController = (requestId: string, abortController: AbortController) => {
  const controllers = activeModelAbortControllers.get(requestId) ?? new Set<AbortController>()
  controllers.add(abortController)
  activeModelAbortControllers.set(requestId, controllers)
}

export const unregisterAbortController = (requestId: string, abortController: AbortController) => {
  const controllers = activeModelAbortControllers.get(requestId)
  if (!controllers) return
  controllers.delete(abortController)
  if (controllers.size === 0) {
    activeModelAbortControllers.delete(requestId)
  }
}

export const clearRequestHeartbeat = (requestId: string) => {
  const timerId = heartbeatIntervals.get(requestId)
  if (typeof timerId === 'number') {
    window.clearInterval(timerId)
    heartbeatIntervals.delete(requestId)
  }
}

/** 清空单条日志上的大字段，便于 GC（即使别处仍短暂持有引用） */
export const releaseRequestLogPayload = (log: RequestLog) => {
  log.requestBody = ''
  log.responseBody = undefined
  log.modelResponse = undefined
  log.streamingReasoning = undefined
  log.reasoningContent = undefined
  log.multiModelResponses = undefined
  log.modelInfo = undefined
  log.headers = {}
  if (log.urlQuestion) {
    log.urlQuestion.renderedHtml = undefined
    log.urlQuestion.streamingResponse = ''
    log.urlQuestion.streamingReasoning = ''
    log.urlQuestion.reasoningContent = ''
    log.urlQuestion.analysisResult = null
    log.urlQuestion.analysisError = ''
  }
}

export const isRequestInFlight = (requestId: string) =>
  activeModelAbortControllers.has(requestId) || activeUrlAnalysisRequestIds.has(requestId)

/** 裁剪/清空时同步释放 requestId 相关的侧边状态，避免 Map/Set 只增不减 */
export const evictRequestSideState = (requestIds: Iterable<string>, { force = false } = {}) => {
  const idSet = requestIds instanceof Set ? requestIds : new Set(requestIds)
  for (const requestId of idSet) {
    const inFlight = isRequestInFlight(requestId)
    if (force || !inFlight) {
      clearRequestHeartbeat(requestId)
      finalModelResponseState.delete(requestId)
      processedRequestIds.delete(requestId)
      cancelledRequestIds.delete(requestId)
      activeUrlAnalysisRequestIds.delete(requestId)
    }
    if (force && inFlight) {
      const controllers = activeModelAbortControllers.get(requestId)
      if (controllers) {
        controllers.forEach((controller) => {
          try { controller.abort() } catch { /* ignore */ }
        })
        activeModelAbortControllers.delete(requestId)
      }
      clearRequestHeartbeat(requestId)
      finalModelResponseState.delete(requestId)
      processedRequestIds.delete(requestId)
      cancelledRequestIds.delete(requestId)
      activeUrlAnalysisRequestIds.delete(requestId)
    }
  }
  if (selectedLog.value && idSet.has(selectedLog.value.id)) {
    releaseRequestLogPayload(selectedLog.value)
    selectedLog.value = null
    showLogDetails.value = false
    slideInActive.value = false
  }
}

export const trimRequestLogs = () => {
  if (requestLogs.value.length <= MAX_REQUEST_LOGS) return
  const kept = requestLogs.value.slice(0, MAX_REQUEST_LOGS)
  const evicted = requestLogs.value.slice(MAX_REQUEST_LOGS)
  for (const log of evicted) releaseRequestLogPayload(log)
  evictRequestSideState(evicted.map((log) => log.id))
  requestLogs.value = kept
}

export const clearAllRequestRuntimeState = () => {
  const allIds = new Set<string>([
    ...requestLogs.value.map((log) => log.id),
    ...heartbeatIntervals.keys(),
    ...activeModelAbortControllers.keys(),
    ...cancelledRequestIds,
    ...finalModelResponseState.keys(),
    ...processedRequestIds,
    ...activeUrlAnalysisRequestIds,
  ])
  if (selectedLog.value) allIds.add(selectedLog.value.id)
  for (const log of requestLogs.value) releaseRequestLogPayload(log)
  if (selectedLog.value) releaseRequestLogPayload(selectedLog.value)
  evictRequestSideState(allIds, { force: true })
  activeModelAbortControllers.clear()
  cancelledRequestIds.clear()
  finalModelResponseState.clear()
  processedRequestIds.clear()
  activeUrlAnalysisRequestIds.clear()
  for (const id of [...heartbeatIntervals.keys()]) clearRequestHeartbeat(id)
  requestLogs.value = []
  selectedLog.value = null
  showLogDetails.value = false
  slideInActive.value = false
}

export const isRequestCancelled = (requestId: string) => cancelledRequestIds.has(requestId)

export const markRequestAsCancelled = (requestId: string, message = MODEL_REQUEST_CANCELLED_MESSAGE) => {
  const log = requestLogs.value.find(entry => entry.id === requestId)
  if (!log) return

  log.isModelCalling = false
  log.streamingReasoning = ''
  log.stage = 'completed'
  log.status = log.status ?? 499
  log.responseTime = log.responseTime ?? Math.max(Date.now() - log.timestamp, 0)

  if (!log.responseBody) {
    log.responseBody = message
  }

  if (!log.modelResponse || log.modelResponse.startsWith('错误:')) {
    log.modelResponse = message
  }

  if (log.multiModelResponses?.length) {
    log.multiModelResponses.forEach((entry) => {
      entry.isLoading = false
      entry.streamingReasoning = ''
      if (!entry.response || entry.response.startsWith('错误:')) {
        entry.response = message
      }
    })
  }

  if (log.urlQuestion) {
    const partialAnalysisResult = (log.urlQuestion.analysisResult || log.urlQuestion.streamingResponse || '').trim()
    const partialReasoning = (log.urlQuestion.reasoningContent || log.urlQuestion.streamingReasoning || '').trim()

    log.urlQuestion.analyzing = false
    log.urlQuestion.streamingResponse = ''
    log.urlQuestion.streamingReasoning = ''

    if (partialAnalysisResult || partialReasoning) {
      log.urlQuestion.analysisResult = partialAnalysisResult || log.urlQuestion.analysisResult
      log.urlQuestion.reasoningContent = partialReasoning
      log.urlQuestion.analysisError = ''
    } else {
      log.urlQuestion.analysisError = message
    }
  }
}

export const cancelAllInFlightModelRequests = (message = MODEL_REQUEST_CANCELLED_MESSAGE) => {
  const requestIds = new Set<string>([
    ...activeModelAbortControllers.keys(),
    ...heartbeatIntervals.keys(),
    ...activeUrlAnalysisRequestIds,
  ])

  requestIds.forEach((requestId) => {
    cancelledRequestIds.add(requestId)
    clearRequestHeartbeat(requestId)
    markRequestAsCancelled(requestId, message)
  })

  activeModelAbortControllers.forEach((controllers) => {
    controllers.forEach((controller) => controller.abort())
  })
  activeModelAbortControllers.clear()
}

// 请求记录管理方法
export const addRequestLog = (log: Omit<RequestLog, 'id'>) => {
  const newLog: RequestLog = {
    ...log,
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9)
  }
  requestLogs.value.unshift(newLog) // 新记录添加到顶部
  trimRequestLogs()
}


export const updateStreamingResponse = (requestId: string, content: string) => {
  const logIndex = requestLogs.value.findIndex(log => log.id === requestId)
  if (logIndex !== -1) {
    requestLogs.value[logIndex].modelResponse = content
  }
}

// 更新流式思考过程显示
export const updateStreamingReasoning = (requestId: string, reasoning: string) => {
  const logIndex = requestLogs.value.findIndex(log => log.id === requestId)
  if (logIndex !== -1) {
    requestLogs.value[logIndex].streamingReasoning = reasoning
  }
}

// 更新多模型模式下某个模型的流式响应
export const updateMultiModelStreamingResponse = (requestId: string, modelId: string, content: string) => {
  const log = requestLogs.value.find(l => l.id === requestId)
  if (!log || !log.multiModelResponses) return
  const entry = log.multiModelResponses.find(r => r.modelId === modelId)
  if (entry) entry.response = content
}

// 更新多模型模式下某个模型的流式思考过程
export const updateMultiModelStreamingReasoning = (requestId: string, modelId: string, reasoning: string) => {
  const log = requestLogs.value.find(l => l.id === requestId)
  if (!log || !log.multiModelResponses) return
  const entry = log.multiModelResponses.find(r => r.modelId === modelId)
  if (entry) {
    entry.streamingReasoning = reasoning
  }
}

export const finalizeMultiModelReasoning = (requestId: string, modelId: string) => {
  const log = requestLogs.value.find(l => l.id === requestId)
  if (!log || !log.multiModelResponses) return
  const entry = log.multiModelResponses.find(r => r.modelId === modelId)
  if (!entry) return

  const finalReasoning = (entry.reasoningContent || entry.streamingReasoning || '').trim()
  entry.reasoningContent = finalReasoning
  entry.streamingReasoning = ''
}


export const applyLocalRequestCompletion = (
  requestId: string,
  status: number,
  responseBody?: string
) => {
  const log = requestLogs.value.find(l => l.id === requestId)
  if (!log) return
  // 仅在仍为「处理中」时本地收口；SSE/Tauri 权威状态可覆盖
  if (!log.status) {
    log.status = status
    log.stage = 'completed'
    log.responseTime = log.responseTime ?? Math.max(Date.now() - log.timestamp, 0)
  } else if (log.status !== status) {
    log.status = status
  }
  if (responseBody && !log.responseBody) {
    log.responseBody = responseBody
  }
  log.isModelCalling = false
}


export const applyRequestLogCompletePayload = (payload: {
  id?: string
  status?: number
  response_time?: number
  response_body?: string
  stage?: string
}) => {
  const id = String(payload?.id || '')
  if (!id) return
  const existingLog = requestLogs.value.find(log => log.id === id)
  if (!existingLog) return
  if (typeof payload.status === 'number') existingLog.status = payload.status
  if (typeof payload.response_time === 'number') existingLog.responseTime = payload.response_time
  if (typeof payload.response_body === 'string') existingLog.responseBody = payload.response_body
  existingLog.stage = payload.stage || 'completed'
  existingLog.isModelCalling = false
}


// 更新请求详情中的模型响应
export const updateRequestDetailsWithModelResponse = (requestId: string, content: string) => {
  console.log('更新请求详情中的模型响应:', { requestId, content })

  // 找到对应的请求记录并更新模型响应
  const logIndex = requestLogs.value.findIndex(log => log.id === requestId)
  if (logIndex !== -1) {
    const log = requestLogs.value[logIndex]
    log.modelResponse = content
    log.isModelCalling = false

    if (log.multiModelResponses?.length === 1) {
      log.multiModelResponses[0].response = content
      log.multiModelResponses[0].isLoading = false
    }

    console.log('请求记录已更新:', log)
  }
}

// 更新请求详情中的思考过程（最终）
export const updateRequestDetailsWithModelReasoning = (requestId: string, reasoning: string) => {
  console.log('更新请求详情中的模型思考过程:', { requestId, reasoning })
  const logIndex = requestLogs.value.findIndex(log => log.id === requestId)
  if (logIndex !== -1) {
    const log = requestLogs.value[logIndex]
    log.reasoningContent = reasoning
    log.streamingReasoning = ''

    if (log.multiModelResponses?.length === 1) {
      log.multiModelResponses[0].reasoningContent = reasoning
      log.multiModelResponses[0].streamingReasoning = ''
      log.multiModelResponses[0].isLoading = false
    }

    console.log('请求记录思考过程已更新:', log)
  }
}


export const showRequestDetails = (log: RequestLog) => {
  const alreadyOpen = showLogDetails.value && slideInActive.value
  selectedLog.value = log
  if (alreadyOpen) return
  showLogDetails.value = true
  slideInActive.value = false
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      slideInActive.value = true
    })
  })
}

export const closeRequestDetails = () => {
  slideInActive.value = false
  setTimeout(() => {
    showLogDetails.value = false
    selectedLog.value = null
  }, 300)
}

export const injectUrlQuestionIfNeeded = (log: RequestLog) => {
  if (log.urlQuestion) return
  if (!log.requestBody) return
  try {
    const rb = JSON.parse(log.requestBody)
    const title: string = rb.title || ''
    const options: string = rb.options || ''
    if (/https?:\/\//.test(title) || /https?:\/\//.test(options)) {
      log.urlQuestion = {
        title,
        options,
        questionType: rb.type || rb.questionType || '',
        imageUrl: null,
        analyzing: false,
        analysisResult: null,
        analysisError: '',
        streamingResponse: '',
        streamingReasoning: '',
        reasoningContent: '',
        renderedHtml: undefined
      }
      buildRenderedHtml(title, options).then(html => {
        if (log.urlQuestion) log.urlQuestion.renderedHtml = html
      })
    }
  } catch { /* 解析失败忽略 */ }
}
