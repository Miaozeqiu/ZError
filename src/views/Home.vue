<template>
  <div class="home-page">
    <HomeServerCard
      :server-running="serverRunning"
      :server-url="serverUrl"
      :is-toggling="isToggling"
      :network-open="networkOpen"
      @toggle-server="toggleServer"
      @open-ocs="openOCSConfig"
      @configure-port="configurePort"
      @open-model="openModelSelector"
      @toggle-network="toggleNetworkAccess"
      @open-folder="openFolderPicker"
    />

    <HomeRequestLogs
      :logs="filteredRequestLogs"
      :selected-id="selectedLog?.id"
      @select="showRequestDetails"
      @clear="clearLogs"
    />

    <HomeRequestDetails
      v-if="showLogDetails && selectedLog"
      :log="selectedLog"
      :slide-in="slideInActive"
      @close="closeRequestDetails"
      @retry-url-analysis="analyzeUrlQuestion"
    />

    <!-- 端口配置对话框 -->
    <PortConfigDialog :show="showPortDialog" :current-port="configuredPort" @close="showPortDialog = false"
      @confirm="handlePortConfirm" />

    <!-- 模型选择对话框 -->
    <ModelSelectorDialog :show="showModelSelector" :selected-text-model-ids="globalSelectedTextModels.map(m => m.id)"
      :selected-vision-model-id="globalSelectedVisionModel?.id || null"
      :selected-summary-model-ids="globalSelectedSummaryModels.map(m => m.id)" :available-models="availableModels"
      :platforms="platforms" @close="showModelSelector = false" @model-selected="selectModel" />

    <FolderPickerDialog :visible="showFolderPicker" :initial-folder-id="settings.questionSaveFolderId"
      @cancel="showFolderPicker = false" @confirm="handleFolderConfirm" />

  </div>

  <!-- OCS配置对话框 -->

  <OCSConfigDialog :visible="showOCSConfig" :current-port="configuredPort" @close="showOCSConfig = false"
    @test="testOCSConnection" />

  <ModelWarningDialog :visible="showNoModelDialog" @close="showNoModelDialog = false"
    @still-open="handleNoModelStillOpen" @select-model="handleNoModelSelect" />

  <!-- 后台自动渲染 URL 题目图片已移除，现直接使用原始 URL 渲染 img 标签 -->
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { useSettings } from '../services/app/settings'
import { useModelConfig } from '../services/model/config'
import type { AIModel } from '../services/model/config'
import { resolveExecutableModelJsCode, resolveRuntimeModelId } from '../services/model/protocol'
import { databaseService } from '../services/app/database'

import PortConfigDialog from './home/PortConfigDialog.vue'
import ModelSelectorDialog from './home/ModelSelectorDialog.vue'
import OCSConfigDialog from './home/OCSConfigDialog.vue'
import HomeServerCard from './home/HomeServerCard.vue'
import HomeRequestLogs from './home/HomeRequestLogs.vue'
import HomeRequestDetails from './home/HomeRequestDetails.vue'
import FolderPickerDialog from '../components/FolderPickerDialog.vue'
import ModelWarningDialog from './home/ModelWarningDialog.vue'
import type { MultiModelResponse, RequestLog } from './home/types'
import { isModelResponseErrorText } from './home/requestLogDisplay'
import {
  buildMultimodalContent,
  buildRenderedHtml,
  executeVisionModelWithAutoUpscale,
  prepareVisionRequestContent,
} from './home/visionImage'
import {
  buildUrlOptionMapForMode,
  buildUrlQuestionPromptParts,
  classifyUrlQuestionMode,
  resolveUrlAnswer,
} from '../utils/urlQuestion'
import { normalizeAnswerJsonContent } from '../utils/answerNormalize'
import { buildAnswerChatMessages } from '../utils/answerFewShot'



const emit = defineEmits(['navigate'])

// 使用设置管理器
const { settings, get, set, save } = useSettings()

// 使用模型配置管理器
const {
  settings: modelSettings,
  availableModels,
  selectedModel: globalSelectedModel,
  selectedTextModel: globalSelectedTextModel,
  selectedTextModels: globalSelectedTextModels,
  selectedSummaryModels: globalSelectedSummaryModels,
  selectedVisionModel: globalSelectedVisionModel,
  setSelectedModel,
  setSelectedTextModel,
  toggleSelectedTextModel,
  toggleSelectedSummaryModel,
  toggleSelectedVisionModel,
  platforms
} = useModelConfig()

import { serverRunning as globalServerRunning } from '../services/app/serverState'

// Server state
const serverRunning = ref(false)
watch(serverRunning, (val) => { globalServerRunning.value = val })
const isToggling = ref(false)
const serverUrl = ref('')

// 从设置中获取网络配置 - 使用响应式设置
const configuredPort = computed(() => settings.network.serverPort)
const networkOpen = computed(() => settings.network.enableLanAccess)

// 实际运行的服务器端口（可能与配置不同）
const serverPort = ref<number | null>(null)

// 端口配置对话框状态
const showPortDialog = ref(false)

// 模型选择对话框状态
const showModelSelector = ref(false)
const showNoModelDialog = ref(false)
const pendingStart = ref(false)

// OCS题库配置对话框状态
const showOCSConfig = ref(false)

const showFolderPicker = ref(false)
// 当前 URL 内容窗口的唯一 ID，用于隔离多窗口数据
const currentUrlWindowId = ref('')

const requestLogs = ref<RequestLog[]>([])
const selectedLog = ref<RequestLog | null>(null)
const showLogDetails = ref(false)
const slideInActive = ref(false)

// 接收来自顶层 App 的折叠触发器，并在切换顶层 tab 时收起详情面板
const props = defineProps<{ collapseTrigger?: number }>()
watch(() => props.collapseTrigger, () => {
  if (showLogDetails.value) {
    closeRequestDetails()
  }
})




// 过滤后的请求日志（排除无请求头内容的记录）
const filteredRequestLogs = computed(() => {
  return requestLogs.value.filter(log => {
    // 如果有请求头且不为空，则显示该记录
    if (log.headers && Object.keys(log.headers).length > 0) {
      return true
    }
    // 如果没有请求头但有其他重要内容（请求体、响应体、模型响应），也显示
    if (log.requestBody || log.responseBody || log.modelResponse) {
      return true
    }
    // 其他情况不显示
    return false
  })
})

let logUpdateInterval: NodeJS.Timeout | null = null
let sseEventSource: EventSource | null = null
// 维护每个请求的心跳定时器，确保在没有内容流入时也能向后端发送进度心跳
const heartbeatIntervals = new Map<string, number>()
const activeModelAbortControllers = new Map<string, Set<AbortController>>()
const cancelledRequestIds = new Set<string>()
const finalModelResponseState = new Map<string, 'success' | 'error'>()
const processedRequestIds = new Set<string>()
const activeUrlAnalysisRequestIds = new Set<string>()
const MAX_REQUEST_LOGS = 100
const MODEL_REQUEST_CANCELLED_MESSAGE = '服务已停止，已取消所有模型请求'

const createCancelledRequestError = (message = MODEL_REQUEST_CANCELLED_MESSAGE) => {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

/** 尽量从 Error / 字符串 / Tauri·fetch 抛出的普通对象里抽出可读报错 */
const formatModelCallError = (error: unknown, fallback = '模型调用失败'): string => {
  if (error == null || error === '') return fallback
  if (typeof error === 'string') {
    const text = error.trim()
    return text || fallback
  }
  if (error instanceof Error) {
    const parts: string[] = []
    if (error.message?.trim()) parts.push(error.message.trim())
    if (error.name && error.name !== 'Error') parts.push(`[${error.name}]`)
    const cause = (error as Error & { cause?: unknown }).cause
    if (cause != null) {
      const causeText = formatModelCallError(cause, '')
      if (causeText) parts.push(`原因: ${causeText}`)
    }
    return parts.join(' ').trim() || fallback
  }
  if (typeof error === 'object') {
    const o = error as Record<string, unknown>
    const pickString = (...keys: string[]) => {
      for (const key of keys) {
        const v = o[key]
        if (typeof v === 'string' && v.trim()) return v.trim()
      }
      return ''
    }
    const nested =
      (o.error && typeof o.error === 'object' ? formatModelCallError(o.error, '') : '') ||
      (o.data && typeof o.data === 'object' ? formatModelCallError(o.data, '') : '') ||
      (o.body && typeof o.body === 'object' ? formatModelCallError(o.body, '') : '')
    const msg = pickString('message', 'msg', 'error', 'statusText', 'reason', 'detail', 'description') || nested
    const status = o.status ?? o.statusCode ?? o.code
    if (msg) {
      return status != null && status !== '' ? `HTTP ${status}: ${msg}` : msg
    }
    if (typeof status === 'number' || typeof status === 'string') {
      return `HTTP ${status}`
    }
    try {
      const json = JSON.stringify(error)
      if (json && json !== '{}' && json !== 'null') {
        return json.length > 800 ? `${json.slice(0, 800)}…` : json
      }
    } catch { /* ignore */ }
  }
  try {
    const text = String(error).trim()
    if (text && text !== '[object Object]') return text
  } catch { /* ignore */ }
  return fallback
}

const isAbortLikeError = (error: unknown) => {
  if (error instanceof Error) {
    return error.name === 'AbortError'
      || error.name === 'TimeoutError'
      || /aborted|abort|cancelled|canceled|取消|超时|timeout/i.test(error.message)
  }
  return /aborted|abort|cancelled|canceled|取消|超时|timeout/i.test(formatModelCallError(error, ''))
}

const getModelRetryCount = () => {
  const n = Number(settings.modelRetryCount)
  if (!Number.isFinite(n) || n < 0) return 2
  return Math.min(10, Math.floor(n))
}

/** 用户取消不重试；超时 Abort 仍应重试 */
const shouldSkipModelRetry = (_error: unknown, requestId: string) => {
  return isRequestCancelled(requestId)
}

/**
 * 可配置重试：仅在调用方 enabled=true 时生效（单模型 / 总结 / 视觉）。
 * attempt 从 1 开始；maxAttempts = 1 + retryCount。
 */
const withModelRetry = async <T>(
  requestId: string,
  label: string,
  enabled: boolean,
  fn: (attempt: number, maxAttempts: number) => Promise<T>,
  onRetry?: (attempt: number, maxAttempts: number, error: unknown) => void
): Promise<T> => {
  const maxAttempts = enabled ? getModelRetryCount() + 1 : 1
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (isRequestCancelled(requestId)) throw createCancelledRequestError()
    try {
      return await fn(attempt, maxAttempts)
    } catch (error) {
      lastError = error
      if (shouldSkipModelRetry(error, requestId) || attempt >= maxAttempts) throw error
      console.warn(`[模型重试 ${attempt}/${maxAttempts}] ${label}:`, formatModelCallError(error))
      onRetry?.(attempt, maxAttempts, error)
      await new Promise((resolve) => setTimeout(resolve, Math.min(2000, 400 * attempt)))
    }
  }
  throw lastError
}

const registerAbortController = (requestId: string, abortController: AbortController) => {
  const controllers = activeModelAbortControllers.get(requestId) ?? new Set<AbortController>()
  controllers.add(abortController)
  activeModelAbortControllers.set(requestId, controllers)
}

const unregisterAbortController = (requestId: string, abortController: AbortController) => {
  const controllers = activeModelAbortControllers.get(requestId)
  if (!controllers) return
  controllers.delete(abortController)
  if (controllers.size === 0) {
    activeModelAbortControllers.delete(requestId)
  }
}

const clearRequestHeartbeat = (requestId: string) => {
  const timerId = heartbeatIntervals.get(requestId)
  if (typeof timerId === 'number') {
    window.clearInterval(timerId)
    heartbeatIntervals.delete(requestId)
  }
}

/** 清空单条日志上的大字段，便于 GC（即使别处仍短暂持有引用） */
const releaseRequestLogPayload = (log: RequestLog) => {
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

const isRequestInFlight = (requestId: string) =>
  activeModelAbortControllers.has(requestId) || activeUrlAnalysisRequestIds.has(requestId)

/** 裁剪/清空时同步释放 requestId 相关的侧边状态，避免 Map/Set 只增不减 */
const evictRequestSideState = (requestIds: Iterable<string>, { force = false } = {}) => {
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

const trimRequestLogs = () => {
  if (requestLogs.value.length <= MAX_REQUEST_LOGS) return
  const kept = requestLogs.value.slice(0, MAX_REQUEST_LOGS)
  const evicted = requestLogs.value.slice(MAX_REQUEST_LOGS)
  for (const log of evicted) releaseRequestLogPayload(log)
  evictRequestSideState(evicted.map((log) => log.id))
  requestLogs.value = kept
}

const clearAllRequestRuntimeState = () => {
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

const isRequestCancelled = (requestId: string) => cancelledRequestIds.has(requestId)

const markRequestAsCancelled = (requestId: string, message = MODEL_REQUEST_CANCELLED_MESSAGE) => {
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

const cancelAllInFlightModelRequests = (message = MODEL_REQUEST_CANCELLED_MESSAGE) => {
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
const addRequestLog = (log: Omit<RequestLog, 'id'>) => {
  const newLog: RequestLog = {
    ...log,
    id: Date.now().toString() + Math.random().toString(36).substr(2, 9)
  }
  requestLogs.value.unshift(newLog) // 新记录添加到顶部
  trimRequestLogs()
}

// 启动SSE连接
const startSSEConnection = () => {
  if (!serverRunning.value || !serverUrl.value) {
    return
  }

  // 关闭现有连接
  if (sseEventSource) {
    sseEventSource.close()
  }

  try {
    const sseUrl = serverUrl.value.replace('http://', 'http://').replace(':3000', ':3000') + '/api/logs/stream'
    console.log('连接SSE:', sseUrl)

    sseEventSource = new EventSource(sseUrl)

    // 监听所有类型的事件
    sseEventSource.onmessage = (event) => {
      console.log('收到SSE默认消息事件:', event.data)
      try {
        const logData = JSON.parse(event.data)
        console.log('解析后的日志数据:', logData)

        // 只处理 /query 路径的 GET 和 POST 请求
        if (logData.path !== '/query' || (logData.method !== 'POST' && logData.method !== 'GET')) {
          console.log('跳过非 query 请求:', logData.method, logData.path)
          return
        }

        // 处理分阶段的请求信息
        if (logData.stage === 'started') {
          // 请求开始阶段
          const newLog: RequestLog = {
            id: logData.id,
            timestamp: new Date(logData.timestamp).getTime(),
            method: logData.method,
            path: logData.path,
            status: undefined, // 开始阶段没有状态码
            ip: logData.ip || '127.0.0.1',
            userAgent: logData.user_agent || 'Unknown',
            responseTime: undefined, // 开始阶段没有响应时间
            requestBody: logData.request_body || '',
            responseBody: undefined, // 开始阶段没有响应体
            headers: logData.headers || {},
            stage: 'started'
          }

          console.log('创建的请求开始日志:', newLog)
          requestLogs.value.unshift(newLog)
          injectUrlQuestionIfNeeded(newLog)

        } else if (logData.stage === 'completed') {
          // 请求完成阶段，更新现有记录
          const existingLogIndex = requestLogs.value.findIndex(log => log.id === logData.id)

          if (existingLogIndex !== -1) {
            // 更新现有记录
            const existingLog = requestLogs.value[existingLogIndex]
            // 采用就地更新，保持对象引用，确保 selectedLog 同步
            existingLog.status = logData.status
            existingLog.responseTime = logData.response_time
            existingLog.responseBody = logData.response_body || ''
            existingLog.stage = 'completed'
            console.log('更新的请求完成日志:', existingLog)
          } else {
            // 如果没有找到开始记录，创建一个完整的记录
            const newLog: RequestLog = {
              id: logData.id,
              timestamp: new Date(logData.timestamp).getTime(),
              method: logData.method,
              path: logData.path,
              status: logData.status,
              ip: '127.0.0.1', // 完成阶段没有IP信息，使用默认值
              userAgent: 'Unknown', // 完成阶段没有User-Agent信息，使用默认值
              responseTime: logData.response_time,
              requestBody: '', // 完成阶段没有请求体信息
              responseBody: logData.response_body || '',
              headers: {}, // 完成阶段没有请求头信息
              stage: 'completed'
            }
            console.log('创建的请求完成日志（无开始记录）:', newLog)
            requestLogs.value.unshift(newLog)
          }
        }

        trimRequestLogs()

      } catch (error) {
        console.error('解析SSE日志数据失败:', error, '原始数据:', event.data)
      }
    }

    sseEventSource.addEventListener('log', (event) => {
      console.log('收到SSE日志事件:', event.data) // 添加调试日志
      try {
        const eventData = JSON.parse(event.data)
        console.log('解析后的事件数据:', eventData) // 添加调试日志

        // 检查是否是RequestLog类型的事件
        if (eventData.type === 'request_log') {
          const logData = eventData.RequestLog || eventData

          // 只处理 /query 路径的 GET 和 POST 请求
          if (logData.path !== '/query' || (logData.method !== 'POST' && logData.method !== 'GET')) {
            console.log('跳过非 query 请求:', logData.method, logData.path)
            return
          }

          // 处理分阶段的请求信息
          if (logData.stage === 'started') {
            // 请求开始阶段
            const newLog: RequestLog = {
              id: logData.id,
              timestamp: new Date(logData.timestamp).getTime(),
              method: logData.method,
              path: logData.path,
              status: undefined, // 开始阶段没有状态码
              ip: logData.ip || '127.0.0.1',
              userAgent: logData.user_agent || 'Unknown',
              responseTime: undefined, // 开始阶段没有响应时间
              requestBody: logData.request_body || '',
              responseBody: undefined, // 开始阶段没有响应体
              headers: logData.headers || {},
              stage: 'started'
            }

            console.log('创建的请求开始日志:', newLog)
            requestLogs.value.unshift(newLog)
            injectUrlQuestionIfNeeded(newLog)

          } else if (logData.stage === 'completed') {
            // 请求完成阶段，更新现有记录
            const existingLogIndex = requestLogs.value.findIndex(log => log.id === logData.id)

            if (existingLogIndex !== -1) {
              // 更新现有记录
              const existingLog = requestLogs.value[existingLogIndex]
              // 采用就地更新，保持对象引用，确保 selectedLog 同步
              existingLog.status = logData.status
              existingLog.responseTime = logData.response_time
              existingLog.responseBody = logData.response_body || ''
              existingLog.stage = 'completed'
              console.log('更新的请求完成日志:', existingLog)

              // 检查是否是URL检测响应，如果是则显示URL处理弹窗
              checkAndShowUrlDialog(existingLog)
            } else {
              // 如果没有找到开始记录，创建一个完整的记录
              const newLog: RequestLog = {
                id: logData.id,
                timestamp: new Date(logData.timestamp).getTime(),
                method: logData.method,
                path: logData.path,
                status: logData.status,
                ip: '127.0.0.1', // 完成阶段没有IP信息，使用默认值
                userAgent: 'Unknown', // 完成阶段没有User-Agent信息，使用默认值
                responseTime: logData.response_time,
                requestBody: '', // 完成阶段没有请求体信息
                responseBody: logData.response_body || '',
                headers: {}, // 完成阶段没有请求头信息
                stage: 'completed'
              }
              console.log('创建的请求完成日志（无开始记录）:', newLog)
              requestLogs.value.unshift(newLog)

              // 检查是否是URL检测响应，如果是则显示URL处理弹窗
              checkAndShowUrlDialog(newLog)
            }
          }

          trimRequestLogs()
        }

      } catch (error) {
        console.error('解析SSE日志数据失败:', error, '原始数据:', event.data)
      }
    })

    // 监听模型调用请求事件
    const handleModelCallRequestEvent = (event: MessageEvent | { data: string }) => {
      console.log('收到模型调用请求事件:', (event as MessageEvent).data)
      try {
        const eventData = JSON.parse((event as MessageEvent).data)
        const requestData = eventData.ModelCallRequest || eventData
        dispatchModelCallRequest(requestData.request_id, requestData.query)
      } catch (error) {
        console.error('解析模型调用请求数据失败:', error, '原始数据:', (event as MessageEvent).data)
      }
    }

    sseEventSource.addEventListener('model_call_request', handleModelCallRequestEvent as EventListener)

    // 监听模型调用响应事件
    sseEventSource.addEventListener('model_call_response', (event) => {
      console.log('收到模型调用响应事件:', event.data)
      try {
        const eventData = JSON.parse(event.data)
        const responseData = eventData.ModelCallResponse || eventData

        console.log('模型调用响应数据:', responseData)

        // 如果后端携带 reasoning_content，先更新思考过程，再更新最终结果
        const reasoning = getReasoningContentValue(responseData)
        if (reasoning) {
          updateRequestDetailsWithModelReasoning(responseData.request_id, reasoning)
        }
        updateRequestDetailsWithModelResponse(responseData.request_id, responseData.content)


      } catch (error) {
        console.error('解析模型调用响应数据失败:', error, '原始数据:', event.data)
      }
    })

    sseEventSource.addEventListener('open', () => {
      console.log('SSE连接已建立')
    })

    sseEventSource.addEventListener('message', (event) => {
      console.log('收到SSE通用消息事件:', event.data)
    })

    sseEventSource.addEventListener('error', (error) => {
      console.error('SSE连接错误:', error)
      console.log('SSE连接状态:', sseEventSource?.readyState)
      // 连接错误时，回退到轮询模式
      setTimeout(() => {
        if (serverRunning.value) {
          startLogPolling()
        }
      }, 5000)
    })
  } catch (error) {
    console.error('启动SSE连接失败:', error)
    // 回退到轮询模式
    startLogPolling()
  }
}

// 停止SSE连接
const stopSSEConnection = () => {
  if (sseEventSource) {
    sseEventSource.close()
    sseEventSource = null
    console.log('SSE连接已关闭')
  }
}

// 启动实时更新机制（轮询模式，作为SSE的备用方案）
const startLogPolling = () => {
  if (logUpdateInterval) {
    clearInterval(logUpdateInterval)
  }

  console.log('SSE连接失败，启动轮询模式作为备用方案')
  // 注意：这里不再调用fetchRequestLogs，因为我们已经使用SSE
  // 轮询模式主要用于在SSE连接失败时尝试重新建立SSE连接
  logUpdateInterval = setInterval(async () => {
    if (serverRunning.value) {
      // 尝试重新建立SSE连接
      if (!sseEventSource || sseEventSource.readyState === EventSource.CLOSED) {
        console.log('尝试重新建立SSE连接...')
        startSSEConnection()
      }
    }
  }, 10000) // 每10秒尝试重新连接一次
}

// 停止实时更新机制
const stopLogPolling = () => {
  if (logUpdateInterval) {
    clearInterval(logUpdateInterval)
    logUpdateInterval = null
  }
}

const clearLogs = async () => {
  if (!isTauri.value) {
    clearAllRequestRuntimeState()
    return
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('clear_request_logs')
    clearAllRequestRuntimeState()
    console.log('请求日志已清空')
  } catch (error) {
    console.error('清空请求日志失败:', error)
    clearAllRequestRuntimeState()
  }
}

// 获取请求日志（保留此函数用于手动刷新或初始化，但不在SSE模式下自动调用）
const fetchRequestLogs = async () => {
  if (!isTauri.value) {
    console.log('不在 Tauri 环境中，跳过获取请求日志')
    return
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const logs = await invoke('get_request_logs')

    // 转换日志格式以匹配前端接口
    const formattedLogs = (logs as any[]).map((log: any) => ({
      id: `${log.timestamp}-${Math.random().toString(36).substr(2, 9)}`,
      timestamp: new Date(log.timestamp).getTime(),
      method: log.method,
      path: log.path,
      status: log.status,
      ip: '127.0.0.1', // 后端暂时没有IP信息，使用默认值
      userAgent: 'Unknown', // 后端暂时没有User-Agent信息，使用默认值
      responseTime: log.response_time
    }))

    // 只在没有SSE连接时更新日志，避免重复
    if (!sseEventSource || sseEventSource.readyState !== EventSource.OPEN) {
      requestLogs.value = formattedLogs
      console.log('获取到请求日志:', requestLogs.value.length, '条')
    }
  } catch (error) {
    console.error('获取请求日志失败:', error)
  }
}

// 显示请求详情
const showRequestDetails = (log: RequestLog) => {
  const alreadyOpen = showLogDetails.value && slideInActive.value
  selectedLog.value = log

  // 已打开时只切换内容，避免关闭再滑入造成闪动
  if (alreadyOpen) {
    return
  }

  showLogDetails.value = true
  slideInActive.value = false
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      slideInActive.value = true
    })
  })
}

// 关闭请求详情
const closeRequestDetails = () => {
  slideInActive.value = false
  // 等待动画完成后再隐藏元素
  setTimeout(() => {
    showLogDetails.value = false
    selectedLog.value = null
  }, 300) // 与CSS动画时间一致
}

// 模拟添加一些示例数据（用于测试）
const addSampleLogs = () => {
  const sampleLogs = [
    {
      timestamp: Date.now() - 1000,
      method: 'GET',
      path: '/api/chat',
      status: 200,
      ip: '127.0.0.1',
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      responseTime: 245
    },
    {
      timestamp: Date.now() - 5000,
      method: 'POST',
      path: '/api/models',
      status: 201,
      ip: '192.168.1.100',
      userAgent: 'curl/7.68.0',
      responseTime: 89
    },
    {
      timestamp: Date.now() - 10000,
      method: 'GET',
      path: '/api/status',
      status: 404,
      ip: '127.0.0.1',
      userAgent: 'PostmanRuntime/7.29.0',
      responseTime: 12
    }
  ]

  sampleLogs.forEach(log => addRequestLog(log))
}

// 模型选择相关状态
const currentModel = ref<AIModel | null>(globalSelectedModel.value)

// 监听globalSelectedModel的变化，同步到currentModel
watch(globalSelectedModel, (newModel) => {
  console.log('globalSelectedModel变化:', newModel?.displayName || '无')
  currentModel.value = newModel
}, { immediate: true })

// 计算属性：获取平台名称
const getPlatformName = (platformId: string) => {
  const platform = platforms.value.find(p => p.id === platformId)
  return platform ? platform.displayName : '未知平台'
}

// Check if we're in Tauri environment - 简化检测逻辑
const isTauri = ref(false)

// 异步检测 Tauri 环境
const checkTauriEnvironment = async () => {
  try {
    // 尝试导入 Tauri API
    const { invoke } = await import('@tauri-apps/api/core')
    // 尝试调用一个简单的命令来确认 Tauri 可用
    await invoke('greet', { name: 'test' })
    isTauri.value = true
    console.log('Tauri 环境检测成功')
  } catch (error) {
    isTauri.value = false
    console.log('Tauri 环境检测失败:', error)
  }
}

// Server management functions
const getServerStatus = async () => {
  console.log('检查 Tauri 环境:', {
    isTauri: isTauri.value
  })

  if (!isTauri.value) {
    // Fallback for web environment
    console.log('不在 Tauri 环境中，使用默认状态')
    serverRunning.value = false
    serverUrl.value = ''
    serverPort.value = null
    return
  }

  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const status = await invoke('get_server_status')
    serverRunning.value = (status as any).running
    serverUrl.value = (status as any).url || ''
    serverPort.value = (status as any).port
  } catch (error) {
    console.error('Failed to get server status:', error)
    // Fallback to default state if Tauri API is not available
    serverRunning.value = false
    serverUrl.value = ''
    serverPort.value = null
  }
}

const startServer = async () => {
  if (!isTauri.value) {
    alert('此功能仅在 Tauri 应用中可用')
    return
  }

  try {
    isToggling.value = true
    const { invoke } = await import('@tauri-apps/api/core')

    // 使用设置中的网络配置，确保绑定地址根据enableLanAccess状态正确设置
    const networkConfig = get('network')
    const bindAddress = networkConfig.enableLanAccess ? '0.0.0.0' : '127.0.0.1'

    const result = await invoke('start_server', {
      port: networkConfig.serverPort,
      bindAddress: bindAddress
    })

    serverRunning.value = (result as any).running
    serverUrl.value = (result as any).url || ''

    // 服务器启动成功后，启动SSE连接接收实时日志
    if ((result as any).running) {
      startSSEConnection()
    }

    console.log('Server started successfully:', result)
  } catch (error) {
    console.error('Failed to start server:', error)
    alert('启动服务器失败: ' + error)
  } finally {
    isToggling.value = false
  }
}

const stopServer = async () => {
  if (!isTauri.value) {
    alert('此功能仅在 Tauri 应用中可用')
    return
  }

  try {
    isToggling.value = true
    cancelAllInFlightModelRequests()
    stopSSEConnection()
    stopLogPolling()
    const { invoke } = await import('@tauri-apps/api/core')
    const result = await invoke('stop_server')

    serverRunning.value = (result as any).running
    serverUrl.value = (result as any).url || ''
    serverPort.value = (result as any).port

    console.log('Server stopped successfully:', result)
  } catch (error) {
    console.error('Failed to stop server:', error)
    alert('停止服务器失败: ' + error)
  } finally {
    isToggling.value = false
  }
}

const toggleServer = async () => {
  if (isToggling.value) return

  if (serverRunning.value) {
    await stopServer()
  } else {
    if ((!globalSelectedTextModels.value || globalSelectedTextModels.value.length === 0) && !settings.suppressNoModelWarning) {
      pendingStart.value = true
      showNoModelDialog.value = true
      return
    }
    await startServer()
  }
}

const openServerUrl = () => {
  if (serverUrl.value) {
    window.open(serverUrl.value, '_blank')
  }
}

const configurePort = () => {
  showPortDialog.value = true
}

const openOCSConfig = () => {
  showOCSConfig.value = true
}

// 暴露到全局，允许其他组件(如步骤条)打开 OCS 弹窗
onMounted(() => {
  window.addEventListener('open-ocs-config', openOCSConfig)
})

onUnmounted(() => {
  window.removeEventListener('open-ocs-config', openOCSConfig)
})

const testOCSConnection = async () => {
  try {
    const testUrl = `http://localhost:${serverPort.value}/query`
    console.log('测试OCS连接:', testUrl)

    const response = await fetch(testUrl, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    })

    if (response.ok) {
      console.log('OCS连接测试成功')
      // 这里可以添加成功提示
    } else {
      console.error('OCS连接测试失败:', response.status)
      // 这里可以添加失败提示
    }
  } catch (error) {
    console.error('OCS连接测试错误:', error)
    // 这里可以添加错误提示
  }
}

const openModelSelector = () => {
  showModelSelector.value = true
}

const openFolderPicker = () => {
  showFolderPicker.value = true
}

const handleFolderConfirm = async (folderId: number, folderName: string, folderPath: string) => {
  showFolderPicker.value = false
  set('questionSaveDir', folderPath || folderName)
  set('questionSaveFolderId', folderId)
  await save()
}

const handlePortConfirm = async (newPort: number) => {
  const wasRunning = serverRunning.value

  // 如果服务器正在运行，先停止它
  if (wasRunning) {
    await stopServer()
  }

  // 保存到设置 - serverPort 现在是 computed，会自动响应设置变化
  set('network', {
    ...get('network'),
    serverPort: newPort
  })
  await save()

  // 如果之前服务器在运行，用新端口重新启动
  if (wasRunning) {
    await startServer()
  }

  showPortDialog.value = false
}

const toggleNetworkAccess = async () => {
  const newNetworkOpen = !networkOpen.value
  // 保存到设置
  set('network', {
    ...get('network'),
    enableLanAccess: newNetworkOpen,
    bindAddress: newNetworkOpen ? '0.0.0.0' : '127.0.0.1'
  })
  await save()
  const status = newNetworkOpen ? '开启' : '关闭'
  console.log(`局域网访问已${status}`)
}

// 模型选择相关方法
const selectModel = (model: any) => {
  const category = model.category || 'text'

  if (category === 'summary') {
    toggleSelectedSummaryModel(model.id)
  } else if (category === 'vision') {
    toggleSelectedVisionModel(model.id)
  } else {
    toggleSelectedTextModel(model.id)
  }
}

// 去除 markdown 代码块包裹（如 ```json\n...\n```）
const stripMarkdownCodeBlock = (content: string): string => {
  return content.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '')
}

/** 拼装多模型输出：成功内容或真实报错原文，不使用统一失败文案 */
const formatModelOutputs = (
  entries: Array<{ model: { displayName: string }; response: string }>
): string => {
  const usable = entries.filter(e => (e.response || '').trim())
  if (usable.length === 0) return ''
  if (usable.length === 1) return usable[0].response
  return usable.map(e => `[${e.model.displayName}]\n${e.response}`).join('\n\n')
}

const normalizeAnswerForComparison = (content: string): string => {
  return stripMarkdownCodeBlock(content || '')
    .replace(/\s+/g, ' ')
    .trim()
}

const getMostFrequentSuccessfulAnswer = (responses: string[]): string => {
  const answerStats = new Map<string, { count: number; firstIndex: number; original: string }>()

  responses.forEach((response, index) => {
    const original = stripMarkdownCodeBlock(response).trim()
    const key = normalizeAnswerForComparison(original)
    if (!key) return

    const existing = answerStats.get(key)
    if (existing) {
      existing.count += 1
      return
    }

    answerStats.set(key, {
      count: 1,
      firstIndex: index,
      original,
    })
  })

  let selected: { count: number; firstIndex: number; original: string } | null = null
  for (const stat of answerStats.values()) {
    if (
      !selected ||
      stat.count > selected.count ||
      (stat.count === selected.count && stat.firstIndex < selected.firstIndex)
    ) {
      selected = stat
    }
  }

  return selected?.original || ''
}

const getReasoningContentValue = (payload: any): string => {
  const candidates = [
    payload?.reasoning_content,
    payload?.reasoningContent,
    payload?.reasoning,
    payload?.delta?.reasoning_content,
    payload?.delta?.reasoningContent,
    payload?.delta?.reasoning,
    payload?.message?.reasoning_content,
    payload?.message?.reasoningContent,
    payload?.message?.reasoning,
    payload?.choices?.[0]?.delta?.reasoning_content,
    payload?.choices?.[0]?.delta?.reasoningContent,
    payload?.choices?.[0]?.delta?.reasoning,
    payload?.choices?.[0]?.message?.reasoning_content,
    payload?.choices?.[0]?.message?.reasoningContent,
    payload?.choices?.[0]?.message?.reasoning
  ]

  const reasoning = candidates.find(value => typeof value === 'string' && value.length > 0)
  return typeof reasoning === 'string' ? reasoning : ''
}

// 调用模型函数 - 支持流式显示
const callModelWithStreaming = async (

  model: AIModel,
  query: string,
  requestId: string,
  onChunk?: (content: string) => void,
  onReasoning?: (text: string) => void
) => {
  if (isRequestCancelled(requestId)) {
    throw createCancelledRequestError()
  }

  const runtimeModelId = resolveRuntimeModelId(model)
  // 获取模型所属的平台
  const platform = platforms.value.find(p => p.models.some(m => m.id === model.id))
  const executableCode = resolveExecutableModelJsCode(model, platform)

  if (!platform) {
    console.error('未找到模型所属平台 - 详细信息:')
    console.error('- 模型ID:', model.id)
    console.error('- 模型平台ID:', model.platformId)
    console.error('- 所有平台:', platforms.value.map(p => ({
      id: p.id,
      name: p.displayName,
      modelIds: p.models.map(m => m.id)
    })))
    throw new Error('未找到模型所属平台')
  }

  // 构建测试输入数据（普通答题注入典型例题多轮对话）
  const testInput: any = {
    messages: buildAnswerChatMessages(query),
    model: runtimeModelId,
    stream: true,
    tools: []
  }

  // 构建配置对象
  const config = {
    ...model,
    apiKey: platform.apiKey,
    baseUrl: platform.baseUrl,
    model: runtimeModelId,
    modelId: runtimeModelId
  }

  // 读取超时配置（秒转毫秒）
  const { settings: appSettings } = useSettings()
  const timeoutMs = (appSettings.modelResponseTimeout ?? 40) * 1000

  // AbortController 用于超时中断 fetch
  const abortController = new AbortController()
  registerAbortController(requestId, abortController)
  const timeoutHandle = setTimeout(() => {
    if (!isRequestCancelled(requestId)) {
      abortController.abort(new DOMException(`模型响应超时（${Math.round(timeoutMs / 1000)} 秒）`, 'TimeoutError'))
    } else {
      abortController.abort()
    }
  }, timeoutMs)

  const tauriHttp = await import('@tauri-apps/plugin-http')
  const { invoke } = await import('@tauri-apps/api/core')
  const tauriFetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    try {
      return await tauriHttp.fetch(input as any, {
        ...init,
        credentials: init.credentials ?? 'include',
        signal: init.signal ?? abortController.signal
      } as any)
    } catch (error) {
      if (isAbortLikeError(error)) throw error
      throw new Error(formatModelCallError(error, '网络请求失败'))
    }
  }

  // 执行JavaScript配置代码
  if (executableCode) {
    // 创建一个安全的执行环境
    let processModel

    if (executableCode.startsWith('async function') || executableCode.startsWith('function')) {
      const safeEval = new Function('input', 'config', 'fetch', 'abortSignal', `
        ${executableCode}
        return processModel;
      `)
      processModel = safeEval(testInput, config, tauriFetch, abortController.signal)
    } else {
      const wrapperFunction = new Function('input', 'config', 'fetch', 'abortSignal', `
        return (async function processModel(input, config) {
          ${executableCode}
        });
      `)
      processModel = wrapperFunction(testInput, config, tauriFetch, abortController.signal)
    }

    let keepaliveTimer: ReturnType<typeof setInterval> | null = null
    try {
      let fullResponse = ''
      let fullReasoning = ''
      let lastProgressSentAt = 0

      // 立即心跳，避免后台启动时 60s 内无任何 progress → 408
      void sendModelProgressToBackend(requestId, 'started')

      // 常驻 keepalive（不仅思考模型）：后台 WebView 节流时尽量维持后端活动时钟
      keepaliveTimer = setInterval(() => {
        sendModelProgressToBackend(requestId, fullResponse || 'keepalive')
      }, 2000)

      while (true) {
        // 执行模型调用
        const result = await processModel(testInput, config, tauriFetch, abortController.signal)

        if (result) {
          // 如果返回的是生成器或异步迭代器，进行流式处理
          if (result[Symbol.asyncIterator]) {
            let toolCalls: any[] = []

            for await (const chunk of result) {
              if (chunk.tool_calls) {
                for (const tc of chunk.tool_calls) {
                  const existing = toolCalls.find(t => t.id === tc.id)
                  if (existing) {
                    existing.function.arguments += (tc.function?.arguments || '')
                  } else {
                    toolCalls.push(tc)
                  }
                }
              }
              if (chunk.content) {
                fullResponse += chunk.content
                // 实时更新UI显示
                if (onChunk) {
                  onChunk(fullResponse)
                } else {
                  updateStreamingResponse(requestId, fullResponse)
                }
                const now = Date.now()
                if (now - lastProgressSentAt > 800) {
                  sendModelProgressToBackend(requestId, fullResponse)
                  lastProgressSentAt = now
                }
              }
              const rc = getReasoningContentValue(chunk)
              if (rc) {
                fullReasoning += rc
                if (onReasoning) {
                  onReasoning(fullReasoning)
                } else {
                  updateStreamingReasoning(requestId, fullReasoning)
                }
              }
            }

            if (toolCalls.length > 0) {
              testInput.messages.push({ role: 'assistant', content: '', tool_calls: toolCalls })

              for (const tc of toolCalls) {
                try {
                  fullResponse += `\n\n[正在调用工具: ${tc.function.name}...]\n`
                  if (onChunk) onChunk(fullResponse)
                  else updateStreamingResponse(requestId, fullResponse)

                  let toolResult = ''
                  toolResult = `Error: Unknown function ${tc.function.name}`

                  fullResponse += `[工具返回: ${toolResult}]\n\n`
                  if (onChunk) onChunk(fullResponse)
                  else updateStreamingResponse(requestId, fullResponse)

                  testInput.messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: toolResult })
                } catch (e: any) {
                  const errStr = `Error: ${e.message || String(e)}`
                  fullResponse += `[工具执行失败: ${errStr}]\n\n`
                  if (onChunk) onChunk(fullResponse)
                  else updateStreamingResponse(requestId, fullResponse)

                  testInput.messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: errStr })
                }
              }
              
              // tool calls processed, loop again
              continue;
            }

            if (fullReasoning) {
              if (onReasoning) {
                onReasoning(fullReasoning)
              } else {
                updateRequestDetailsWithModelReasoning(requestId, fullReasoning)
              }
            }
            return fullResponse
          } else {
            // 非流式响应，直接返回
            const response = typeof result === 'string'
              ? result
              : typeof result?.content === 'string'
                ? result.content
                : JSON.stringify(result)
            const reasoning = typeof result === 'string' ? '' : getReasoningContentValue(result)

            if (reasoning) {
              if (onReasoning) {
                onReasoning(reasoning)
              } else {
                updateStreamingReasoning(requestId, reasoning)
              }
            }
            if (onChunk) {
              onChunk(response)
            } else {
              updateStreamingResponse(requestId, response)
            }
            return response
          }

        } else {
          throw new Error('模型配置代码未返回有效结果')
        }
      }
    } catch (error) {
      if (isRequestCancelled(requestId)) {
        throw createCancelledRequestError()
      }
      if (isAbortLikeError(error)) {
        throw new Error(`模型响应超时（${Math.round(timeoutMs / 1000)} 秒）或连接被中断`)
      }
      throw new Error(formatModelCallError(error))
    } finally {
      clearTimeout(timeoutHandle)
      if (keepaliveTimer !== null) clearInterval(keepaliveTimer)
      unregisterAbortController(requestId, abortController)
    }
  } else {
    clearTimeout(timeoutHandle)
    unregisterAbortController(requestId, abortController)
    throw new Error('模型未配置可执行代码')
  }
}

// 更新流式响应显示
const updateStreamingResponse = (requestId: string, content: string) => {
  const logIndex = requestLogs.value.findIndex(log => log.id === requestId)
  if (logIndex !== -1) {
    requestLogs.value[logIndex].modelResponse = content
  }
}

// 更新流式思考过程显示
const updateStreamingReasoning = (requestId: string, reasoning: string) => {
  const logIndex = requestLogs.value.findIndex(log => log.id === requestId)
  if (logIndex !== -1) {
    requestLogs.value[logIndex].streamingReasoning = reasoning
  }
}

// 更新多模型模式下某个模型的流式响应
const updateMultiModelStreamingResponse = (requestId: string, modelId: string, content: string) => {
  const log = requestLogs.value.find(l => l.id === requestId)
  if (!log || !log.multiModelResponses) return
  const entry = log.multiModelResponses.find(r => r.modelId === modelId)
  if (entry) entry.response = content
}

// 更新多模型模式下某个模型的流式思考过程
const updateMultiModelStreamingReasoning = (requestId: string, modelId: string, reasoning: string) => {
  const log = requestLogs.value.find(l => l.id === requestId)
  if (!log || !log.multiModelResponses) return
  const entry = log.multiModelResponses.find(r => r.modelId === modelId)
  if (entry) {
    entry.streamingReasoning = reasoning
  }
}

const finalizeMultiModelReasoning = (requestId: string, modelId: string) => {
  const log = requestLogs.value.find(l => l.id === requestId)
  if (!log || !log.multiModelResponses) return
  const entry = log.multiModelResponses.find(r => r.modelId === modelId)
  if (!entry) return

  const finalReasoning = (entry.reasoningContent || entry.streamingReasoning || '').trim()
  entry.reasoningContent = finalReasoning
  entry.streamingReasoning = ''
}



// 调用模型函数
const callModel = async (model: AIModel, query: string) => {
  const runtimeModelId = resolveRuntimeModelId(model)
  const platform = platforms.value.find(p => p.models.some(m => m.id === model.id))
  const executableCode = resolveExecutableModelJsCode(model, platform)
  if (!platform) {
    throw new Error('未找到模型所属平台')
  }

  // 构建测试输入数据
  const testInput = {
    messages: [
      {
        role: 'user',
        content: query
      }
    ],
    model: runtimeModelId,
    stream: true
  }

  // 构建配置对象
  const config = {
    ...model,
    apiKey: platform.apiKey,
    baseUrl: platform.baseUrl,
    model: runtimeModelId,
    modelId: runtimeModelId
  }

  const tauriHttp = await import('@tauri-apps/plugin-http')
  const tauriFetch = (input: RequestInfo | URL, init: RequestInit = {}) =>
    tauriHttp.fetch(input as any, {
      ...init,
      credentials: init.credentials ?? 'include'
    } as any)

  // 执行JavaScript配置代码
  if (executableCode) {
    // 创建一个安全的执行环境
    let processModel

    if (executableCode.startsWith('async function') || executableCode.startsWith('function')) {
      // 如果是完整的函数声明，使用eval在安全环境中执行
      const safeEval = new Function('input', 'config', 'fetch', `
        ${executableCode}
        return processModel;
      `)
      processModel = safeEval(testInput, config, tauriFetch)
    } else {
      // 如果是函数体，包装为async函数
      const wrapperFunction = new Function('input', 'config', 'fetch', `
        return (async function processModel(input, config) {
          ${executableCode}
        });
      `)
      processModel = wrapperFunction(testInput, config, tauriFetch)
    }

    // 执行模型调用
    const result = await processModel(testInput, config, tauriFetch)

    if (result) {
      // 如果返回的是生成器或异步迭代器，收集结果
      if (result[Symbol.asyncIterator]) {
        let fullResponse = ''
        for await (const chunk of result) {
          if (chunk.content) {
            fullResponse += chunk.content
          }
        }
        return fullResponse
      } else {
        return result
      }
    } else {
      throw new Error('模型配置代码未返回有效结果')
    }
  } else {
    throw new Error('模型未配置可执行代码')
  }
}

// Lifecycle
let unlistenModelCallRequest: (() => void) | null = null
let unlistenRequestLogComplete: (() => void) | null = null

const applyRequestLogCompletePayload = (payload: {
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

const onVisibilityChange = () => {
  if (document.visibilityState !== 'visible') return
  // 回到前台：补发心跳 + 必要时重连 SSE，避免后台掉线后无法继续处理
  if (serverRunning.value) {
    if (!sseEventSource || sseEventSource.readyState === EventSource.CLOSED) {
      startSSEConnection()
    }
    for (const requestId of heartbeatIntervals.keys()) {
      void sendModelProgressToBackend(requestId, 'foreground-resume')
    }
  }
}

onMounted(async () => {
  // 初始化服务器端口为配置端口
  serverPort.value = configuredPort.value

  // 首先检测 Tauri 环境
  await checkTauriEnvironment()

  // 然后获取服务器状态
  setTimeout(async () => {
    await getServerStatus()
    // 获取服务器状态后，如果服务器正在运行，则启动SSE连接接收实时日志
    if (serverRunning.value) {
      startSSEConnection()
    }
  }, 100)

  // Tauri 事件双通道：后台时比 EventSource 更不易丢
  if (isTauri.value) {
    try {
      const { listen } = await import('@tauri-apps/api/event')
      unlistenModelCallRequest = await listen<{ request_id?: string; query?: string }>(
        'model-call-request',
        (event) => {
          const payload = event.payload || {}
          dispatchModelCallRequest(String(payload.request_id || ''), String(payload.query || ''))
        }
      )
      unlistenRequestLogComplete = await listen<{
        id?: string
        status?: number
        response_time?: number
        response_body?: string
        stage?: string
      }>('request-log-complete', (event) => {
        applyRequestLogCompletePayload(event.payload || {})
      })
    } catch (e) {
      console.warn('注册 Tauri 事件监听失败:', e)
    }
  }

  document.addEventListener('visibilitychange', onVisibilityChange)

  // 初始化当前选中的模型
  currentModel.value = globalSelectedModel.value

  // 如果不在Tauri环境中，添加示例请求记录（用于测试）
  if (!isTauri.value) {
    addSampleLogs()
  }
})

// 监听全局选中模型的变化，同步更新本地状态
watch(globalSelectedModel, (newModel) => {
  if (newModel) {
    currentModel.value = newModel
    console.log('全局模型已更新:', newModel.displayName)
  }
}, { immediate: false })

// 单个模型调用，独立日志条目，返回响应文本
const callSingleModelAPI = async (model: AIModel, query: string, logId: string): Promise<string> => {
  const logIndex = requestLogs.value.findIndex(log => log.id === logId)
  if (logIndex !== -1) {
    requestLogs.value[logIndex].isModelCalling = true
    requestLogs.value[logIndex].modelResponse = ''
    requestLogs.value[logIndex].streamingReasoning = ''
    requestLogs.value[logIndex].reasoningContent = ''
    const platform = platforms.value.find(p => p.models.some(m => m.id === model.id))
    if (platform) {
      requestLogs.value[logIndex].modelInfo = {
        platformName: platform.displayName,
        modelName: model.displayName,
        modelId: model.id
      }
    }
    if (serverRunning.value && serverUrl.value && !heartbeatIntervals.has(logId)) {
      const timerId = window.setInterval(() => {
        try {
          const currentContent = requestLogs.value[requestLogs.value.findIndex(l => l.id === logId)]?.modelResponse || ''
          sendModelProgressToBackend(logId, currentContent)
        } catch (e) { /* ignore */ }
      }, 1000)
      heartbeatIntervals.set(logId, timerId)
    }
  }

  try {
    // 单模型独立调用：允许按设置重试
    const response = await withModelRetry(
      logId,
      model.displayName,
      true,
      async (attempt, maxAttempts) => {
        const idx = requestLogs.value.findIndex(l => l.id === logId)
        if (idx !== -1 && attempt > 1) {
          requestLogs.value[idx].isModelCalling = true
          requestLogs.value[idx].modelResponse = `重试中（${attempt}/${maxAttempts}）…`
          requestLogs.value[idx].streamingReasoning = ''
        }
        return callModelWithStreaming(model, query, logId)
      }
    )
    const idx = requestLogs.value.findIndex(l => l.id === logId)
    if (idx !== -1) requestLogs.value[idx].isModelCalling = false
    clearRequestHeartbeat(logId)
    return response
  } catch (error) {
    if (isAbortLikeError(error) || isRequestCancelled(logId)) {
      clearRequestHeartbeat(logId)
      return MODEL_REQUEST_CANCELLED_MESSAGE
    }
    const errText = `错误: ${formatModelCallError(error)}`
    const idx = requestLogs.value.findIndex(l => l.id === logId)
    if (idx !== -1) {
      requestLogs.value[idx].modelResponse = errText
      requestLogs.value[idx].isModelCalling = false
    }
    clearRequestHeartbeat(logId)
    return errText
  }
}

// 调用模型API（支持多模型并发）
/** 按 requestId+阶段去重，避免 SSE/Tauri 双通道重复；同题判断与正式答题可相继执行 */
const inflightModelCallKeys = new Set<string>()

const modelCallPhase = (query: string) => {
  if (query.startsWith('__URL_QUESTION__:')) return 'url'
  if (query.startsWith('__SAME_QUESTION_CHECK__:')) return 'same'
  return 'answer'
}

/** SSE / Tauri 双通道入口 */
const dispatchModelCallRequest = (requestId: string, query: string) => {
  if (!requestId || typeof query !== 'string') return
  const phase = modelCallPhase(query)
  const key = `${requestId}:${phase}`
  console.log('模型调用请求数据:', { requestId, phase, query: query.slice(0, 120) })

  if (inflightModelCallKeys.has(key)) {
    console.warn('忽略重复的模型调用请求:', key)
    return
  }
  inflightModelCallKeys.add(key)

  const done = () => { inflightModelCallKeys.delete(key) }

  if (phase === 'url') {
    void handleUrlQuestionRequest(requestId, query.slice('__URL_QUESTION__:'.length)).finally(done)
    return
  }

  if (phase === 'same') {
    void handleSameQuestionCheckRequest(requestId, query.slice('__SAME_QUESTION_CHECK__:'.length)).finally(done)
    return
  }

  void callModelAPI(requestId, query).finally(done)
}

const callModelAPI = async (requestId: string, query: string) => {
  let finalOutput = ''
  console.log('开始调用模型API:', { requestId, query })
  // 允许同一 requestId 在同题判断后再次发送最终答题结果
  finalModelResponseState.delete(requestId)
  void sendModelProgressToBackend(requestId, 'dispatch')

  try {
    // 只有文本模型参与基础输出；视觉模型仅在 query 包含图片时才加入
    const hasImage = /https?:\/\/\S+\.(png|jpg|jpeg|gif|webp)/i.test(query) || query.includes('base64')
    const selectedModels = [...globalSelectedTextModels.value]
    if (hasImage && globalSelectedVisionModel.value) {
      selectedModels.push(globalSelectedVisionModel.value)
    }

    if (selectedModels.length === 0) {
      const logIndex = requestLogs.value.findIndex(log => log.id === requestId)
      const errorText = '错误: 未选择模型'
      if (logIndex !== -1) {
        requestLogs.value[logIndex].modelResponse = errorText
        requestLogs.value[logIndex].isModelCalling = false
      }
      await sendModelResponseToBackend(requestId, errorText, false)
      return
    }

    const logIndex = requestLogs.value.findIndex(l => l.id === requestId)

    // --- 阶段 1: 基础模型调用 (Base Model Phase) ---
    if (logIndex !== -1) {
      requestLogs.value[logIndex].isModelCalling = true
      requestLogs.value[logIndex].modelResponse = undefined
      requestLogs.value[logIndex].streamingReasoning = undefined
      requestLogs.value[logIndex].reasoningContent = undefined
      requestLogs.value[logIndex].modelInfo = undefined

      // 初始化多模型响应数组
      requestLogs.value[logIndex].multiModelResponses = selectedModels.map(model => {
        const platform = platforms.value.find(p => p.models.some(m => m.id === model.id))
        return {
          modelId: model.id,
          modelName: model.displayName,
          platformName: platform?.displayName || '未知平台',
          response: '',
          streamingReasoning: '',
          reasoningContent: '',
          isLoading: true
        } as MultiModelResponse
      })
    }

    // 启动心跳（缩短间隔，减轻后台 setInterval 节流影响）
    if (serverRunning.value && serverUrl.value && !heartbeatIntervals.has(requestId)) {
      const timerId = window.setInterval(() => {
        try {
          const log = requestLogs.value.find(l => l.id === requestId)
          if (log?.multiModelResponses) {
            const currentContent = log.multiModelResponses
              .map(r => `[${r.modelName}]\n${r.response}`).join('\n\n')
            sendModelProgressToBackend(requestId, currentContent || 'keepalive')
          } else {
            sendModelProgressToBackend(requestId, 'keepalive')
          }
        } catch (e) { /* ignore */ }
      }, 1000)
      heartbeatIntervals.set(requestId, timerId)
    }

    // 并发调用基础模型
    // 重试条件：仅有一个基础模型，或当前是视觉模型
    const visionModelId = globalSelectedVisionModel.value?.id
    const results: { model: AIModel; response: string; success: boolean }[] = []
    const modelPromises = selectedModels.map(async (model) => {
      const allowRetry = selectedModels.length === 1 || (!!visionModelId && model.id === visionModelId)
      try {
        const response = await withModelRetry(
          requestId,
          model.displayName,
          allowRetry,
          async (attempt, maxAttempts) => {
            const log = requestLogs.value.find(l => l.id === requestId)
            const entry = log?.multiModelResponses?.find(r => r.modelId === model.id)
            if (entry) {
              entry.isLoading = true
              if (attempt > 1) {
                entry.response = `重试中（${attempt}/${maxAttempts}）…`
                entry.streamingReasoning = ''
              }
            }
            return callModelWithStreaming(
              model,
              query,
              requestId,
              (content) => updateMultiModelStreamingResponse(requestId, model.id, stripMarkdownCodeBlock(content)),
              (reasoning) => updateMultiModelStreamingReasoning(requestId, model.id, reasoning)
            )
          },
          (attempt, maxAttempts) => {
            const log = requestLogs.value.find(l => l.id === requestId)
            const entry = log?.multiModelResponses?.find(r => r.modelId === model.id)
            if (entry) {
              entry.isLoading = true
              entry.response = `第 ${attempt} 次失败，准备重试（${attempt + 1}/${maxAttempts}）…`
            }
          }
        )
        const strippedResponse = stripMarkdownCodeBlock(response)
        const log = requestLogs.value.find(l => l.id === requestId)
        if (log?.multiModelResponses) {
          const entry = log.multiModelResponses.find(r => r.modelId === model.id)
          if (entry) { entry.isLoading = false; entry.response = strippedResponse }
        }
        finalizeMultiModelReasoning(requestId, model.id)
        return {
          model,
          response: strippedResponse,
          success: true
        }
      } catch (error) {
        if (isAbortLikeError(error) || isRequestCancelled(requestId)) {
          return null // cancelled
        }
        const errText = `错误: ${formatModelCallError(error)}`
        console.error(`[模型调用失败] ${model.displayName}:`, error)
        const log = requestLogs.value.find(l => l.id === requestId)
        if (log?.multiModelResponses) {
          const entry = log.multiModelResponses.find(r => r.modelId === model.id)
          if (entry) { entry.isLoading = false; entry.response = errText }
        }
        return {
          model,
          response: errText,
          success: false
        }
      }
    })

    // quorum: 使用 Promise.allSettled 等待所有完成，但通过 onChunk 已经逐步更新了 UI
    const settledResults = await Promise.allSettled(modelPromises)
    for (const settled of settledResults) {
      if (settled.status === 'fulfilled' && settled.value !== null) {
        results.push(settled.value)
      }
    }

    if (isRequestCancelled(requestId)) return

    // --- 阶段 2: 汇总与总结 (Summary Phase) ---
    const summaryModels = globalSelectedSummaryModels.value

    // 过滤掉失败的基础模型结果，只用成功的部分做总结和最终答案
    const successfulBaseEntries = results.filter(result => result.success)
    const successfulResults = successfulBaseEntries.map(entry => entry.response)
    const successfulModels = successfulBaseEntries.map(entry => entry.model)

    const baseCombinedResponse = successfulModels.length === 1
      ? successfulResults[0]
      : successfulModels.map((model, i) => `[${model.displayName}]\n${successfulResults[i]}`).join('\n\n')
    const majorityBaseAnswer = getMostFrequentSuccessfulAnswer(successfulResults)

    if (summaryModels.length > 0 && successfulResults.length > 0) {
      console.log('开始总结阶段:', summaryModels.map(m => m.displayName))

      // 在日志中添加总结模型的占位项（如果尚未在多模型数组中）
      const log = requestLogs.value.find(l => l.id === requestId)
      if (log) {
        if (!log.multiModelResponses) {
          log.multiModelResponses = []
        }

        // 避免重复添加（针对可能的并发重试）
        const existingIds = new Set(log.multiModelResponses.map(r => r.modelId))
        summaryModels.forEach(model => {
          const summaryKey = `summary:${model.id}`
          if (!existingIds.has(summaryKey)) {
            const platform = platforms.value.find(p => p.models.some(m => m.id === model.id))
            log.multiModelResponses!.push({
              modelId: summaryKey,
              modelName: `总结: ${model.displayName}`,
              platformName: platform?.displayName || '未知平台',
              response: '',
              streamingReasoning: '',
              reasoningContent: '',
              isLoading: true
            })
          }
        })
      }

      const summaryQuery = `你是一个总结专家。下面是用户的问题以及AI模型的回答。请根据回答内容，整理并总结出一个最准确、最全面的最终答案。

用户原始问题：
${query}

模型回答内容：
${baseCombinedResponse}

请直接给出最终总结答案：`

      const summaryResults = await Promise.all(
        summaryModels.map(async (model) => {
          const summaryKey = `summary:${model.id}`
          try {
            const response = await withModelRetry(
              requestId,
              `总结:${model.displayName}`,
              true,
              async (attempt, maxAttempts) => {
                const l = requestLogs.value.find(x => x.id === requestId)
                const entry = l?.multiModelResponses?.find(r => r.modelId === summaryKey)
                if (entry) {
                  entry.isLoading = true
                  if (attempt > 1) {
                    entry.response = `总结重试中（${attempt}/${maxAttempts}）…`
                    entry.streamingReasoning = ''
                  }
                }
                return callModelWithStreaming(
                  model,
                  summaryQuery,
                  requestId,
                  (content) => updateMultiModelStreamingResponse(requestId, summaryKey, stripMarkdownCodeBlock(content)),
                  (reasoning) => updateMultiModelStreamingReasoning(requestId, summaryKey, reasoning)
                )
              },
              (attempt, maxAttempts) => {
                const l = requestLogs.value.find(x => x.id === requestId)
                const entry = l?.multiModelResponses?.find(r => r.modelId === summaryKey)
                if (entry) {
                  entry.isLoading = true
                  entry.response = `总结第 ${attempt} 次失败，准备重试（${attempt + 1}/${maxAttempts}）…`
                }
              }
            )
            const strippedResponse = stripMarkdownCodeBlock(response)
            const l = requestLogs.value.find(l => l.id === requestId)
            if (l?.multiModelResponses) {
              const entry = l.multiModelResponses.find(r => r.modelId === summaryKey)
              if (entry) { entry.isLoading = false; entry.response = strippedResponse }
            }
            finalizeMultiModelReasoning(requestId, summaryKey)
            return {
              model,
              response: strippedResponse,
              success: true
            }

          } catch (error) {
            if (isAbortLikeError(error) || isRequestCancelled(requestId)) {
              throw createCancelledRequestError()
            }
            const errText = `错误: ${formatModelCallError(error, '总结失败')}`
            console.error(`[总结失败] ${model.displayName}:`, error)
            const l = requestLogs.value.find(l => l.id === requestId)
            if (l?.multiModelResponses) {
              const entry = l.multiModelResponses.find(r => r.modelId === summaryKey)
              if (entry) { entry.isLoading = false; entry.response = errText }
            }
            return {
              model,
              response: errText,
              success: false
            }
          }
        })
      )

      if (isRequestCancelled(requestId)) return

      const successfulSummaryEntries = summaryResults.filter(entry => entry.success)

      if (successfulSummaryEntries.length > 0) {
        finalOutput = formatModelOutputs(
          successfulSummaryEntries.map(entry => ({
            model: { displayName: `${entry.model.displayName} 总结` },
            response: entry.response
          }))
        )
      } else {
        // 总结全失败：优先用基础模型成功答案，否则展示总结/基础模型的真实报错
        finalOutput = majorityBaseAnswer
          || formatModelOutputs(summaryResults)
          || formatModelOutputs(results)
          || '错误: 未获得任何模型响应'
      }

      const finalReasoning = successfulSummaryEntries.length === 1
        ? getRequestReasoningForBackend(requestId, `summary:${successfulSummaryEntries[0].model.id}`)
        : successfulSummaryEntries.length === 0 && successfulModels.length === 1
          ? getRequestReasoningForBackend(requestId, successfulModels[0].id)
          : ''
      if (!isRequestCancelled(requestId)) {
        await sendModelResponseToBackend(
          requestId,
          finalOutput,
          successfulSummaryEntries.length > 0 || !!majorityBaseAnswer,
          finalReasoning
        )
      }
    } else {
      // 无总结模型：成功则返回成功内容；全部失败则返回各模型真实报错
      finalOutput = successfulModels.length > 0
        ? formatModelOutputs(successfulBaseEntries)
        : (formatModelOutputs(results) || '错误: 未获得任何模型响应')
      const finalReasoning = successfulModels.length === 1
        ? getRequestReasoningForBackend(requestId, successfulModels[0].id)
        : ''
      if (!isRequestCancelled(requestId)) {
        await sendModelResponseToBackend(
          requestId,
          finalOutput,
          successfulResults.length > 0,
          finalReasoning
        )
      }
    }
  } catch (error) {
    if (isAbortLikeError(error) || isRequestCancelled(requestId)) {
      return
    }

    const errorText = `错误: ${formatModelCallError(error)}`
    console.error('[模型调用失败]', error)
    const log = requestLogs.value.find(l => l.id === requestId)
    if (log) {
      log.modelResponse = errorText
      log.isModelCalling = false
    }

    if (serverRunning.value && serverUrl.value) {
      await sendModelResponseToBackend(requestId, errorText, false)
    }
  } finally {
    const finalLogIdx = requestLogs.value.findIndex(l => l.id === requestId)
    if (finalLogIdx !== -1) {
      requestLogs.value[finalLogIdx].isModelCalling = false
      if (finalOutput && !isRequestCancelled(requestId)) {
        requestLogs.value[finalLogIdx].modelResponse = finalOutput
      }
    }
    clearRequestHeartbeat(requestId)
    cancelledRequestIds.delete(requestId)
  }
}

const handleNoModelStillOpen = (dontRemind: boolean) => {
  if (dontRemind) {
    set('suppressNoModelWarning', true)
    save()
  }
  showNoModelDialog.value = false
  if (pendingStart.value) {
    pendingStart.value = false
    startServer()
  }
}
const handleNoModelSelect = (dontRemind: boolean) => {
  if (dontRemind) {
    set('suppressNoModelWarning', true)
    save()
  }
  showNoModelDialog.value = false
  showModelSelector.value = true
}

watch(globalSelectedTextModels, (newModels) => {
  if (newModels && newModels.length > 0 && pendingStart.value) {
    pendingStart.value = false
    startServer()
  }
})

const getRequestReasoningForBackend = (requestId: string, modelId?: string): string => {
  const log = requestLogs.value.find(entry => entry.id === requestId)
  if (!log) return ''

  if (modelId && log.multiModelResponses) {
    const target = log.multiModelResponses.find(entry => entry.modelId === modelId)
    return (target?.reasoningContent || target?.streamingReasoning || '').trim()
  }

  if (log.reasoningContent || log.streamingReasoning) {
    return (log.reasoningContent || log.streamingReasoning || '').trim()
  }

  if (log.multiModelResponses?.length === 1) {
    const onlyEntry = log.multiModelResponses[0]
    return (onlyEntry.reasoningContent || onlyEntry.streamingReasoning || '').trim()
  }

  return ''
}

const getRequestOptionsFromLog = (requestId: string): string => {
  const log = requestLogs.value.find(l => l.id === requestId)
  if (!log?.requestBody) return ''
  try {
    const parsed = JSON.parse(log.requestBody)
    return typeof parsed.options === 'string' ? parsed.options : ''
  } catch {
    return ''
  }
}

// 发送模型响应到后端
const applyLocalRequestCompletion = (
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

const isTimeoutLikeModelFailureText = (text: string) =>
  /timeout|超时|no new tokens|aborted|abort|cancelled|canceled|取消|服务已停止/i.test(text)

const sendModelResponseToBackend = async (requestId: string, content: string, isSuccess: boolean = true, reasoningContent = '') => {
  const existingState = finalModelResponseState.get(requestId)
  if (existingState === 'success') {
    console.warn('忽略重复的模型最终响应（已成功发送）:', { requestId, isSuccess })
    return
  }
  if (existingState === 'error' && !isSuccess) {
    console.warn('忽略重复的模型错误响应:', { requestId })
    return
  }

  // 去掉 A./B. 前缀，纯字母映射为选项正文，避免 OCS 收到带序号的答案
  const options = getRequestOptionsFromLog(requestId)
  const normalizedContent = isSuccess
    ? normalizeAnswerJsonContent(content, options)
    : content

  // 先停心跳，避免错误宽限期内仍被 keepalive 拖住观感
  clearRequestHeartbeat(requestId)

  try {
    const response = await fetch(`${serverUrl.value}/api/model/response`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        request_id: requestId,
        content: normalizedContent,
        reasoning_content: reasoningContent || undefined,
        is_success: isSuccess
      })
    })


    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }

    finalModelResponseState.set(requestId, isSuccess ? 'success' : 'error')
    if (isSuccess && normalizedContent !== content) {
      const log = requestLogs.value.find(l => l.id === requestId)
      if (log) log.modelResponse = normalizedContent
    }

    // 请求端可能已断开导致后端来不及推 completed；本地先收口状态，避免一直「处理中」
    const provisionalStatus = isSuccess
      ? 200
      : (isTimeoutLikeModelFailureText(normalizedContent) ? 408 : 500)
    applyLocalRequestCompletion(
      requestId,
      provisionalStatus,
      JSON.stringify({ code: isSuccess ? 1 : 0, message: normalizedContent })
    )

    console.log('模型响应已发送到后端:', { requestId, content: normalizedContent, reasoningContent, isSuccess })

    // 只有在成功调用模型时才存储AI响应到数据库
    if (isSuccess) {
      // 2024-05-21: 禁用前端存储以防止重复条目。
      // 后端 (server.rs) 在从前端接收到响应后已经执行了存储操作。
      // await storeAIResponseToDatabase(requestId, content)
      console.log('前端跳过存储AI响应 (已由后端处理):', { requestId })
    } else {
      console.log('AI调用失败，跳过保存到数据库:', { requestId, content })
    }

  } catch (error) {
    console.error('发送模型响应到后端失败:', error)
    // 即便上报失败，UI 也不应一直停在处理中
    applyLocalRequestCompletion(
      requestId,
      isSuccess ? 200 : (isTimeoutLikeModelFailureText(normalizedContent) ? 408 : 500),
      normalizedContent
    )
  }
}


// 发送模型进度到后端（用于流式输出期间的活跃心跳）
const sendModelProgressToBackend = async (requestId: string, content: string) => {
  try {
    const response = await fetch(`${serverUrl.value}/api/model/progress`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        request_id: requestId,
        content: content
      })
    })

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`)
    }
  } catch (error) {
    console.warn('发送模型进度到后端失败（忽略）:', error)
  }
}

// 存储AI响应到数据库
const storeAIResponseToDatabase = async (requestId: string, content: string) => {
  try {
    // 从请求日志中找到对应的请求，获取实际的title, options, type
    const logIndex = requestLogs.value.findIndex(log => log.id === requestId)
    let title = 'Unknown'
    let options = ''
    let type = ''

    if (logIndex !== -1) {
      const log = requestLogs.value[logIndex]
      // 从请求体中提取参数
      if (log.requestBody) {
        try {
          const parsed = JSON.parse(log.requestBody)
          title = parsed.title || 'Unknown'
          options = parsed.options || ''
          type = parsed.type || ''
        } catch (e) {
          console.error('解析请求体失败:', e)
        }
      }
    }

    // 从AI响应中提取答案（稳健处理混合文本）
    let extractedAnswer = content
    const cleanedContent = content
      .trim()
      .replace(/^```json\s*/, '')
      .replace(/^```\s*/, '')
      .replace(/\s*```$/, '')
      .trim()

    console.log('🔍 清理后的内容:', cleanedContent)

    const extractAnswerFromMixedContent = (text: string): string => {
      // 尝试直接解析为JSON
      try {
        const obj = JSON.parse(text)
        if (obj && typeof obj === 'object') {
          if (typeof obj.answer === 'string') {
            console.log('✅ 直接解析文本为JSON并提取到答案:', obj.answer)
            return obj.answer
          }
          if (typeof obj.anwser === 'string') {
            console.log('✅ 直接解析文本为JSON并提取到anwser(拼写错误):', obj.anwser)
            return obj.anwser
          }
        }
      } catch { }

      // 从末尾提取最后一个平衡的JSON对象
      const extractLastBalancedJson = (s: string): string | null => {
        let end = -1
        let depth = 0
        for (let i = s.length - 1; i >= 0; i--) {
          const ch = s[i]
          if (end === -1) {
            if (ch === '}') {
              end = i
              depth = 1
              continue
            }
          } else {
            if (ch === '}') {
              depth++
            } else if (ch === '{') {
              depth--
              if (depth === 0) {
                const candidate = s.slice(i, end + 1)
                return candidate
              }
            }
          }
        }
        return null
      }

      const jsonStr = extractLastBalancedJson(text)
      if (jsonStr) {
        console.log('🔎 发现末尾的JSON片段:', jsonStr)
        try {
          const obj = JSON.parse(jsonStr)
          if (typeof obj.answer === 'string') {
            console.log('✅ 从末尾JSON片段中提取到答案:', obj.answer)
            return obj.answer
          }
          if (typeof obj.anwser === 'string') {
            console.log('✅ 从末尾JSON片段中提取到anwser(拼写错误):', obj.anwser)
            return obj.anwser
          }
        } catch (e) {
          console.log('⚠️ 末尾JSON片段解析失败:', e)
        }
      }

      // 正则回退，直接在文本中匹配 answer 字段
      const regex = /\{\s*"(?:answer|anwser)"\s*:\s*"([^"]+)"[\s\S]*?\}/s
      const m = text.match(regex)
      if (m && m[1]) {
        console.log('✅ 通过正则从混合文本中捕获到答案:', m[1])
        return m[1]
      }

      console.log('⚠️ 未能提取到结构化答案，回退为原始内容')
      return text
    }

    extractedAnswer = extractAnswerFromMixedContent(cleanedContent).trim()

    if (!extractedAnswer) {
      console.warn('⚠️ AI最终处理结果答案为空，跳过保存题目', { requestId, title })
      return
    }

    // 尊重「AI回答添加到本地题库」设置（前端路径目前默认不调用，后端为主）
    if (!settings.autoAddToQuestionBank) {
      console.log('ℹ️ autoAddToQuestionBank=false，前端跳过入库:', { requestId, title })
      return
    }

    // 使用数据库服务存储AI响应
    await databaseService.addQuestion({
      content: title, // 使用实际的请求title
      options: options, // 使用请求中的options
      answer: extractedAnswer, // 使用解析后的答案
      question_type: type, // 使用请求中的type
      folderId: 0, // 存储到ID为0的文件夹
      isAi: 1 // 标记为AI生成的题目
    })

    console.log('✅ AI响应已成功存储到数据库:', { requestId, title, extractedAnswer, contentLength: extractedAnswer.length })

  } catch (error) {
    console.error('❌ 存储AI响应到数据库失败:', error)
  }
}

// 更新请求详情中的模型响应
const updateRequestDetailsWithModelResponse = (requestId: string, content: string) => {
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
const updateRequestDetailsWithModelReasoning = (requestId: string, reasoning: string) => {
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


type SameQuestionCandidate = {
  id: number
  question: string
  options?: string | null
}

type SameQuestionCheckPayload = {
  title: string
  options?: string | null
  candidates: SameQuestionCandidate[]
}

const buildSameQuestionCheckPrompt = (payload: SameQuestionCheckPayload): string => {
  const candidateLines = (payload.candidates || []).map((c, index) => {
    const optionsText = c.options ? `\n选项：${c.options}` : ''
    return `候选${index + 1}（id=${c.id}）：\n题干：${c.question}${optionsText}`
  }).join('\n\n')

  const optionsBlock = payload.options ? `\n【新题选项】\n${payload.options}\n` : ''

  return [
    '你是题目判重助手。请判断「新题目」是否与下列候选中的某一道是同一道题（允许措辞略有差异，但题意与考点必须一致）。',
    '只输出一个 JSON 对象，不要代码块，不要其他文字。',
    '若是同一题：{"same":true,"matched_id":<候选id>}',
    '若都不是：{"same":false}',
    '',
    '【新题目】',
    payload.title || '',
    optionsBlock,
    '【候选题目】',
    candidateLines || '（无候选）',
  ].join('\n')
}

const parseSameQuestionCheckResult = (raw: string): { same: boolean; matched_id?: number } => {
  const text = stripMarkdownCodeBlock(raw || '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < start) return { same: false }
  try {
    const parsed = JSON.parse(text.slice(start, end + 1))
    if (parsed?.same === true && (typeof parsed.matched_id === 'number' || typeof parsed.matched_id === 'string')) {
      const matchedId = Number(parsed.matched_id)
      if (Number.isFinite(matchedId)) {
        return { same: true, matched_id: matchedId }
      }
    }
  } catch {
    // ignore
  }
  return { same: false }
}

// 处理 AI 同题判断请求（单模型）
const handleSameQuestionCheckRequest = async (requestId: string, payloadJson: string) => {
  finalModelResponseState.delete(requestId)

  let payload: SameQuestionCheckPayload
  try {
    payload = JSON.parse(payloadJson)
  } catch (error) {
    console.error('解析同题判断 payload 失败:', error)
    await sendModelResponseToBackend(requestId, JSON.stringify({ same: false }), true)
    return
  }

  const model = globalSelectedTextModels.value[0] || globalSelectedTextModel.value
  if (!model) {
    console.warn('同题判断：未选择文本模型，回落为不同题')
    await sendModelResponseToBackend(requestId, JSON.stringify({ same: false }), true)
    return
  }

  const logIndex = requestLogs.value.findIndex(l => l.id === requestId)
  if (logIndex !== -1) {
    const platform = platforms.value.find(p => p.models.some(m => m.id === model.id))
    requestLogs.value[logIndex].isModelCalling = true
    requestLogs.value[logIndex].modelResponse = undefined
    requestLogs.value[logIndex].multiModelResponses = [{
      modelId: model.id,
      modelName: model.displayName,
      platformName: platform?.displayName || '未知平台',
      response: '',
      streamingReasoning: '',
      reasoningContent: '',
      isLoading: true
    }]
  }

  try {
    const prompt = buildSameQuestionCheckPrompt(payload)
    const response = await withModelRetry(
      requestId,
      `同题判断:${model.displayName}`,
      true,
      async (attempt, maxAttempts) => {
        const log = requestLogs.value.find(l => l.id === requestId)
        const entry = log?.multiModelResponses?.find(r => r.modelId === model.id)
        if (entry) {
          entry.isLoading = true
          if (attempt > 1) entry.response = `重试中（${attempt}/${maxAttempts}）…`
        }
        return callModelWithStreaming(
          model,
          prompt,
          requestId,
          (content) => updateMultiModelStreamingResponse(requestId, model.id, stripMarkdownCodeBlock(content))
        )
      }
    )
    const stripped = stripMarkdownCodeBlock(response)
    const result = parseSameQuestionCheckResult(stripped)
    const resultJson = JSON.stringify(result)

    const log = requestLogs.value.find(l => l.id === requestId)
    if (log?.multiModelResponses) {
      const entry = log.multiModelResponses.find(r => r.modelId === model.id)
      if (entry) {
        entry.isLoading = false
        entry.response = resultJson
      }
    }
    if (log) {
      log.isModelCalling = false
      log.modelResponse = resultJson
    }

    await sendModelResponseToBackend(requestId, resultJson, true)
  } catch (error) {
    console.error('同题判断失败:', error)
    const fallback = JSON.stringify({ same: false })
    const log = requestLogs.value.find(l => l.id === requestId)
    if (log) {
      log.isModelCalling = false
      log.modelResponse = fallback
      if (log.multiModelResponses?.[0]) {
        log.multiModelResponses[0].isLoading = false
        log.multiModelResponses[0].response = fallback
      }
    }
    await sendModelResponseToBackend(requestId, fallback, true)
  }
}

// 处理 URL 题目请求（由 SSE model_call_request 事件触发）
const handleUrlQuestionRequest = async (requestId: string, rawTitle: string) => {
  if (processedRequestIds.has(requestId)) return
  processedRequestIds.add(requestId)

  // 解析 title 和内嵌的 __OPTIONS__: 字段
  let title = rawTitle
  let originalOptions = ''
  const optionsMarker = '\n__OPTIONS__:'
  const optIdx = rawTitle.indexOf(optionsMarker)
  if (optIdx !== -1) {
    title = rawTitle.slice(0, optIdx)
    originalOptions = rawTitle.slice(optIdx + optionsMarker.length)
  }

  // 如果 query 里没有 options，从请求日志的 requestBody 中补充
  let questionType = ''
  if (!originalOptions) {
    const matchedLog = requestLogs.value.find(l => l.id === requestId)
    if (matchedLog?.requestBody) {
      try {
        const rb = JSON.parse(matchedLog.requestBody)
        originalOptions = rb.options || ''
        questionType = rb.type || rb.questionType || ''
      } catch (e) { }
    }
  } else {
    const matchedLog = requestLogs.value.find(l => l.id === requestId)
    if (matchedLog?.requestBody) {
      try {
        const rb = JSON.parse(matchedLog.requestBody)
        questionType = rb.type || rb.questionType || ''
      } catch (e) { }
    }
  }

  // 在对应 log 上标记为 URL 题目，在详情面板内处理
  // SSE model_call_request 可能比 started 日志事件更早到达，需要重试等待 log 出现
  const urlQuestionData: NonNullable<RequestLog['urlQuestion']> = {

    title,
    options: originalOptions,
    questionType,
    imageUrl: null as string | null,
    analyzing: false,
    analysisResult: null as string | null,
    analysisError: '',
    streamingResponse: '',
    streamingReasoning: '',
    reasoningContent: '',
    renderedHtml: undefined as string | undefined
  }


  const applyAndAnalyze = () => {
    const logIndex = requestLogs.value.findIndex(l => l.id === requestId)
    if (logIndex !== -1) {
      requestLogs.value[logIndex].urlQuestion = { ...urlQuestionData }
      // 异步生成 base64 渲染 HTML
      buildRenderedHtml(title, originalOptions).then(html => {
        const l = requestLogs.value.find(l => l.id === requestId)
        if (l?.urlQuestion) l.urlQuestion.renderedHtml = html
      })
      requestLogs.value[logIndex].isModelCalling = true

      // 直接触发视觉分析
      analyzeUrlQuestion(requestId)
    } else {
      // log 还未到达，100ms 后重试，最多重试 30 次（3 秒）
      let retries = 0
      const timer = setInterval(() => {
        retries++
        const idx = requestLogs.value.findIndex(l => l.id === requestId)
        if (idx !== -1) {
          clearInterval(timer)
          requestLogs.value[idx].urlQuestion = { ...urlQuestionData }
          buildRenderedHtml(title, originalOptions).then(html => {
            const l = requestLogs.value.find(l => l.id === requestId)
            if (l?.urlQuestion) l.urlQuestion.renderedHtml = html
          })
          requestLogs.value[idx].isModelCalling = true
          analyzeUrlQuestion(requestId)
        } else if (retries >= 30) {
          clearInterval(timer)
          console.warn('handleUrlQuestionRequest: log 未在 3 秒内出现，放弃:', requestId)
          void sendModelResponseToBackend(requestId, '错误: 未找到对应请求日志，无法处理 URL 题目', false)
        }
      }, 100)
    }
  }


  applyAndAnalyze()
}

// 检查并显示URL处理弹窗
const checkAndShowUrlDialog = async (log: RequestLog) => {
  try {
    // 检查是否已经处理过这个请求
    if (processedRequestIds.has(log.id)) {
      console.log('⚠️ 请求已处理过，跳过:', log.id)
      return
    }

    // 解析响应体
    if (log.responseBody) {
      const responseData = JSON.parse(log.responseBody)

      // 检查是否是URL检测响应
      if (responseData.code === 1 &&
        responseData.data &&
        (
          // data 是对象的情况
          (responseData.data.answer === '题目中含有URL，无法直接展示') ||
          // data 是数组的情况
          (Array.isArray(responseData.data) && responseData.data[0]?.answer === '题目中含有URL，无法直接展示')
        )) {

        // 标记请求为已处理
        processedRequestIds.add(log.id)

        // 从请求体中提取原始问题和选项
        let originalQuestion = ''
        let originalOptions = ''

        if (log.requestBody) {
          try {
            const requestData = JSON.parse(log.requestBody)
            originalQuestion = requestData.title || ''
            originalOptions = requestData.options || ''
          } catch (e) {
            console.error('解析请求体失败:', e)
          }
        }

        // 构建题目数据结构
        const questionData = {
          id: `question_${Date.now()}_${log.id}`, // 包含请求ID确保唯一性
          title: originalQuestion,
          options: originalOptions,
          timestamp: new Date().toLocaleString(),
          status: 'pending', // pending, processing, completed
          requestId: log.id, // 保存原始请求ID
          isNew: true // 标记为新题目
        }

        // 检查是否已有URL内容窗口打开
        const existingQuestions = getExistingQuestions()

        // 将新题目添加到列表开头，让最新题目显示在最上方
        existingQuestions.unshift(questionData)

        console.log('✅ 添加新题目到列表顶部:', {
          questionData,
          totalQuestions: existingQuestions.length
        })

        // 保存题目数据到本地存储（先保存，确保数据不丢失）
        saveQuestionsToStorage(existingQuestions)

        // 尝试检查窗口是否已存在
        let windowExists = false
        try {
          const { invoke } = await import('@tauri-apps/api/core')

          // 先尝试检查窗口是否存在
          try {
            const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')

            // 方法1: 尝试直接获取窗口实例
            let existingWindow = null
            try {
              // getByLabel 可能返回 Promise，需要正确处理
              const windowResult = WebviewWindow.getByLabel('url-content')
              console.log('🔍 getByLabel结果:', windowResult)
              console.log('🔍 窗口对象类型:', typeof windowResult)

              // 检查是否是 Promise
              if (windowResult && typeof windowResult.then === 'function') {
                console.log('🔍 getByLabel返回Promise，等待解析...')
                existingWindow = await windowResult
              } else {
                existingWindow = windowResult
              }

              console.log('🔍 解析后的窗口对象:', existingWindow)
              console.log('🔍 窗口对象属性:', Object.keys(existingWindow || {}))
            } catch (getLabelError) {
              console.log('🔍 getByLabel失败:', getLabelError)
            }

            if (existingWindow) {
              console.log('✅ 检测到已存在的URL内容窗口')

              // 检查窗口是否真的可用 - 使用更全面的方法
              let windowIsUsable = false
              try {
                console.log('🔍 开始检查窗口可用性')
                console.log('🔍 existingWindow.label:', existingWindow.label)
                console.log('🔍 existingWindow.label类型:', typeof existingWindow.label)

                // 方法1: 检查基本属性
                if (typeof existingWindow.label === 'string') {
                  console.log('✅ 窗口基本属性可用，标签:', existingWindow.label)

                  // 方法2: 尝试检查窗口状态（如果方法存在）
                  let statusChecked = false
                  try {
                    console.log('🔍 检查isVisible方法:', typeof existingWindow.isVisible)
                    if (existingWindow.isVisible) {
                      const isVisible = await existingWindow.isVisible()
                      console.log('✅ 窗口可见状态:', isVisible)
                      statusChecked = true
                    }
                  } catch (visibilityError) {
                    console.log('⚠️ 无法检查窗口可见性，但窗口可能仍然可用:', visibilityError)
                  }

                  // 方法3: 尝试检查窗口是否最小化（如果方法存在）
                  try {
                    console.log('🔍 检查isMinimized方法:', typeof existingWindow.isMinimized)
                    if (existingWindow.isMinimized) {
                      const isMinimized = await existingWindow.isMinimized()
                      console.log('✅ 窗口最小化状态:', isMinimized)
                      statusChecked = true
                    }
                  } catch (minimizedError) {
                    console.log('⚠️ 无法检查窗口最小化状态:', minimizedError)
                  }

                  // 如果基本属性可用，就认为窗口可用
                  windowIsUsable = true
                  console.log('✅ 窗口被认定为可用')
                } else {
                  console.log('❌ 窗口基本属性不可用，label:', existingWindow.label, '类型:', typeof existingWindow.label)
                }
              } catch (testError) {
                console.log('🔍 窗口可用性检查异常:', testError)
              }

              if (windowIsUsable) {
                windowExists = true

                // 窗口已存在，通过事件通信来更新数据
                try {
                  // 方法1: 通过事件发送新题目数据
                  const { emit } = await import('@tauri-apps/api/event')
                  await emit('new-question-added', {
                    windowId: currentUrlWindowId.value,
                    questions: existingQuestions,
                    latestQuestion: questionData
                  })

                  // 尝试聚焦到窗口
                  try {
                    if (existingWindow.setFocus) {
                      await existingWindow.setFocus()
                    } else {
                      console.log('⚠️ setFocus方法不可用，跳过聚焦')
                    }
                  } catch (focusError) {
                    console.log('⚠️ 聚焦窗口失败:', focusError)
                  }

                  console.log('✅ 已通过事件更新现有窗口的题目数据:', {
                    totalQuestions: existingQuestions.length,
                    latestQuestion: questionData
                  })

                  return // 成功更新，直接返回
                } catch (eventError) {
                  console.error('❌ 事件通信失败，尝试关闭并重新创建窗口:', eventError)

                  // 方法2: 关闭现有窗口并重新创建
                  try {
                    if (existingWindow.close) {
                      await existingWindow.close()
                    } else {
                      console.log('⚠️ close方法不可用，无法关闭窗口')
                    }
                    windowExists = false // 标记为不存在，后续会创建新窗口

                    // 等待一小段时间确保窗口完全关闭
                    await new Promise(resolve => setTimeout(resolve, 1000))

                    console.log('✅ 已关闭现有窗口，准备创建新窗口')
                  } catch (closeError) {
                    console.error('❌ 关闭窗口也失败:', closeError)
                    windowExists = false
                  }
                }
              } else {
                console.log('🔍 窗口存在但不可用，标记为需要重建')
                windowExists = false
              }
            }
          } catch (checkError) {
            console.log('🔍 窗口检查失败，可能窗口不存在:', checkError)
            windowExists = false
          }

          // 如果窗口不存在，创建新窗口
          if (!windowExists) {
            currentUrlWindowId.value = `w${Date.now()}`
            await invoke('open_url_content_window', {
              questions: JSON.stringify(existingQuestions),
              windowId: currentUrlWindowId.value
            })

            console.log('✅ URL内容处理窗口创建成功:', {
              totalQuestions: existingQuestions.length,
              latestQuestion: questionData
            })
          }

        } catch (error) {
          console.error('❌ 处理URL内容窗口失败:', error)
        }
      }
    }
  } catch (error) {
    console.error('检查URL响应失败:', error)
  }
}

// 获取已存在的题目数据
const getExistingQuestions = () => {
  try {
    const key = currentUrlWindowId.value ? `urlContentQuestions_${currentUrlWindowId.value}` : 'urlContentQuestions'
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) : []
  } catch (error) {
    console.error('获取存储的题目失败:', error)
    return []
  }
}

// 保存题目数据到本地存储
const saveQuestionsToStorage = (questions: any[]) => {
  try {
    const key = currentUrlWindowId.value ? `urlContentQuestions_${currentUrlWindowId.value}` : 'urlContentQuestions'
    localStorage.setItem(key, JSON.stringify(questions))
  } catch (error) {
    console.error('保存题目数据失败:', error)
  }
}

// 如果请求体中的 title 含有 URL，为 log 设置 urlQuestion 展示字段（不触发分析）
const injectUrlQuestionIfNeeded = (log: RequestLog) => {
  if (log.urlQuestion) return // 已设置过，跳过
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

      // 异步生成 base64 渲染 HTML
      buildRenderedHtml(title, options).then(html => {
        if (log.urlQuestion) log.urlQuestion.renderedHtml = html
      })
    }
  } catch { /* 解析失败忽略 */ }
}

// 对指定 requestId 的 URL 题目执行视觉分析
const analyzeUrlQuestion = async (requestId: string) => {
  const log = requestLogs.value.find(l => l.id === requestId)
  if (!log?.urlQuestion) return
  // 防止重复分析
  if (log.urlQuestion.analyzing || log.urlQuestion.analysisResult || activeUrlAnalysisRequestIds.has(requestId)) return
  if (isRequestCancelled(requestId)) return

  const visionModel = globalSelectedVisionModel.value
  if (!visionModel) {
    const errorMessage = '请先在模型选择中配置视觉模型'
    log.urlQuestion.analysisError = errorMessage
    log.urlQuestion.analyzing = false
    log.urlQuestion.streamingResponse = ''
    log.urlQuestion.streamingReasoning = ''
    log.urlQuestion.reasoningContent = ''
    log.modelResponse = `错误: ${errorMessage}`
    log.isModelCalling = false
    await sendModelResponseToBackend(requestId, `错误: ${errorMessage}`, false)
    return
  }


  activeUrlAnalysisRequestIds.add(requestId)
  const abortController = new AbortController()
  registerAbortController(requestId, abortController)
  log.urlQuestion.analyzing = true
  log.urlQuestion.analysisResult = null
  log.urlQuestion.analysisError = ''
  log.urlQuestion.streamingResponse = ''
  log.urlQuestion.streamingReasoning = ''
  log.urlQuestion.reasoningContent = ''


  try {
    const platform = platforms.value.find(p => p.models.some(m => m.id === visionModel.id))
    if (!platform) throw new Error('找不到视觉模型对应的平台')

    const { title, options, questionType } = log.urlQuestion
    const mode = classifyUrlQuestionMode(questionType, options)
    const optionMap = buildUrlOptionMapForMode(mode, options)
    const { optionsText, answerRule, typeHint } = buildUrlQuestionPromptParts(
      mode,
      options || '',
      optionMap,
      questionType || ''
    )

    const instruction = `\n\n请仔细分析上述题目，给出详细的解题过程和答案。${typeHint}\n在回答末尾，严格按照以下格式单独一行给出答案：\nANSWER: <答案>\n\n其中规则：\n${answerRule}`

    // 将 title + options + instruction 拼成完整文本，按 URL 拆分为交错多模态内容
    // 图片会先在本地拉取并转为 base64，再发送给视觉模型
    const fullText = title + optionsText + instruction
    const multimodalContent = await buildMultimodalContent(fullText)
    const preparedMultimodalContent = await prepareVisionRequestContent(multimodalContent)

    const analysisInput = {
      messages: [{ role: 'user', content: preparedMultimodalContent }],

      model: resolveRuntimeModelId(visionModel),
      stream: true
    }
    const runtimeModelId = resolveRuntimeModelId(visionModel)
    const executableCode = resolveExecutableModelJsCode(visionModel, platform)
    const config = { ...visionModel, apiKey: platform.apiKey, baseUrl: platform.baseUrl, model: runtimeModelId, modelId: runtimeModelId }

    const tauriHttp = await import('@tauri-apps/plugin-http')
    const tauriFetch: typeof fetch = ((input: RequestInfo | URL, init: RequestInit = {}) =>
      tauriHttp.fetch(input as any, {
        ...init,
        credentials: init.credentials ?? 'include',
        signal: init.signal ?? abortController.signal
      } as any)) as typeof fetch

    if (!executableCode) throw new Error('视觉模型未配置可执行代码')

    // 视觉模型：按设置自动重试
    const { fullResponse, fullReasoning } = await withModelRetry(
      requestId,
      `视觉:${visionModel.displayName}`,
      true,
      async (attempt, maxAttempts) => {
        const cur = requestLogs.value.find(x => x.id === requestId)
        if (cur?.urlQuestion) {
          cur.urlQuestion.analyzing = true
          cur.urlQuestion.analysisError = ''
          if (attempt > 1) {
            cur.urlQuestion.streamingResponse = `视觉重试中（${attempt}/${maxAttempts}）…`
            cur.urlQuestion.streamingReasoning = ''
          } else {
            cur.urlQuestion.streamingResponse = ''
            cur.urlQuestion.streamingReasoning = ''
          }
        }

        let processModel: any
        if (executableCode.startsWith('async function') || executableCode.startsWith('function')) {
          processModel = new Function('input', 'config', 'fetch', 'abortSignal', `${executableCode}\nreturn processModel;`)(analysisInput, config, tauriFetch, abortController.signal)
        } else {
          processModel = new Function('input', 'config', 'fetch', 'abortSignal', `return (async function processModel(input, config) { ${executableCode} });`)(analysisInput, config, tauriFetch, abortController.signal)
        }

        const result = await executeVisionModelWithAutoUpscale(processModel, analysisInput, config, tauriFetch, abortController.signal)
        if (!result) throw new Error('模型未返回有效结果')

        if (!heartbeatIntervals.has(requestId)) {
          const timerId = window.setInterval(() => {
            const l = requestLogs.value.find(x => x.id === requestId)
            const currentContent = l?.urlQuestion?.streamingResponse || ''
            sendModelProgressToBackend(requestId, currentContent)
          }, 1000)
          heartbeatIntervals.set(requestId, timerId)
        }

        let responseText = ''
        let reasoningText = ''
        if (result[Symbol.asyncIterator]) {
          for await (const chunk of result) {
            if (isRequestCancelled(requestId)) throw createCancelledRequestError()
            if (chunk.content) {
              responseText += chunk.content
              const l = requestLogs.value.find(x => x.id === requestId)
              if (l?.urlQuestion) l.urlQuestion.streamingResponse = responseText
            }
            const reasoning = getReasoningContentValue(chunk)
            if (reasoning) {
              reasoningText += reasoning
              const l = requestLogs.value.find(x => x.id === requestId)
              if (l?.urlQuestion) l.urlQuestion.streamingReasoning = reasoningText
            }
          }
        } else {
          responseText = typeof result === 'string'
            ? result
            : typeof result?.content === 'string'
              ? result.content
              : JSON.stringify(result)
          reasoningText = typeof result === 'string' ? '' : getReasoningContentValue(result)
        }

        clearRequestHeartbeat(requestId)
        if (!responseText.trim()) throw new Error('视觉模型返回空内容')
        return { fullResponse: responseText, fullReasoning: reasoningText }
      },
      (attempt, maxAttempts) => {
        clearRequestHeartbeat(requestId)
        const l = requestLogs.value.find(x => x.id === requestId)
        if (l?.urlQuestion) {
          l.urlQuestion.streamingResponse = `视觉第 ${attempt} 次失败，准备重试（${attempt + 1}/${maxAttempts}）…`
          l.urlQuestion.streamingReasoning = ''
        }
      }
    )

    const answer = resolveUrlAnswer(fullResponse, optionMap, mode)
    const l = requestLogs.value.find(x => x.id === requestId)
    if (l?.urlQuestion) {
      l.urlQuestion.analysisResult = fullResponse
      l.urlQuestion.reasoningContent = fullReasoning
      l.urlQuestion.streamingReasoning = ''
      l.urlQuestion.analyzing = false
    }
    if (l) l.isModelCalling = false

    if (isRequestCancelled(requestId)) return

    if (answer) {
      await sendModelResponseToBackend(requestId, JSON.stringify({ answer }), true, fullReasoning)
    } else {
      await sendModelResponseToBackend(requestId, fullResponse, true, fullReasoning)
    }

  } catch (err: unknown) {
    if (isAbortLikeError(err) || isRequestCancelled(requestId)) {
      return
    }
    // 停止心跳
    clearRequestHeartbeat(requestId)
    const detail = formatModelCallError(err, '分析失败')
    console.error('[视觉分析失败]', err)
    const l = requestLogs.value.find(x => x.id === requestId)
    if (l?.urlQuestion) {
      l.urlQuestion.analysisError = detail
      l.urlQuestion.streamingReasoning = ''
      l.urlQuestion.analyzing = false
    }

    if (l) l.isModelCalling = false
    // 通知后端分析失败，让 wait_for_model_response 尽快返回错误
    await sendModelResponseToBackend(requestId, `错误: ${detail}`, false)
  } finally {
    clearRequestHeartbeat(requestId)
    unregisterAbortController(requestId, abortController)
    cancelledRequestIds.delete(requestId)
    activeUrlAnalysisRequestIds.delete(requestId)
  }
}



onUnmounted(() => {
  // 清理SSE连接、轮询、以及请求侧边状态（心跳/Abort/大字段）
  stopSSEConnection()
  stopLogPolling()
  clearAllRequestRuntimeState()
  document.removeEventListener('visibilitychange', onVisibilityChange)
  if (unlistenModelCallRequest) {
    unlistenModelCallRequest()
    unlistenModelCallRequest = null
  }
  if (unlistenRequestLogComplete) {
    unlistenRequestLogComplete()
    unlistenRequestLogComplete = null
  }
})

</script>

<style scoped>
.home-page {
  background-color: var(--bg-secondary);
  border-radius: 4px;
  height: calc(100% - 5px);
  width: calc(100% - 5px);
  margin: 0 2px 2px 0;
  padding: 20px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 20px;
  min-height: 0;
  overflow: hidden;
  padding-bottom: 0px;
}

@media (max-width: 768px) {
  .home-page {
    padding: 16px;
    gap: 16px;
  }
}
</style>
