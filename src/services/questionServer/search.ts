import { reactive } from 'vue'
import { settingsApi } from './deps'
import { createCancelledRequestError, formatModelCallError } from './errors'
import { sendModelProgressToBackend } from './backend'
import {
  isRequestCancelled, registerAbortController, requestLogs, startSearchHeartbeat,
  stopSearchHeartbeat, unregisterAbortController,
} from './runtime'
import { formatSearchContextForModel, performWebSearch, type SearchTrace } from '../searchService'

export const getSearchQuestionText = (requestId: string): string => {
  const log = requestLogs.value.find(item => item.id === requestId)
  if (log?.urlQuestion) {
    return [log.urlQuestion.title, log.urlQuestion.options].map(item => (item || '').trim()).filter(Boolean).join('\n')
  }
  if (log?.requestBody) {
    try {
      const body = JSON.parse(log.requestBody)
      return [body.title || body.question, body.options].map(item => String(item || '').trim()).filter(Boolean).join('\n')
    } catch { /* ignore malformed request body */ }
  }
  return ''
}

export const runSearchForRequest = async (
  requestId: string, rawQuery: string, modelName: string
): Promise<{ context: string; trace: SearchTrace } | null> => {
  const config = settingsApi.settings.search
  if (!config?.enabled) return null
  const query = (rawQuery || '').replace(/https?:\/\/\S+/gi, ' ').replace(/\s+/g, ' ').trim()
  if (!query) return null
  if (isRequestCancelled(requestId)) throw createCancelledRequestError()

  const log = requestLogs.value.find(item => item.id === requestId)
  const trace = reactive<SearchTrace>({
    id: `${requestId}-search-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    query, modelId: '', modelName, mode: 'remote', toolName: 'web_search_exa',
    status: 'searching', startedAt: Date.now(), results: [],
  })
  if (log) (log.searchTraces ??= []).push(trace)

  const controller = new AbortController()
  registerAbortController(requestId, controller)
  const heartbeat = () => { void sendModelProgressToBackend(requestId, 'searching') }
  startSearchHeartbeat(requestId, heartbeat)
  heartbeat()
  try {
    const outcome = await performWebSearch(query, { ...config }, { signal: controller.signal })
    Object.assign(trace, {
      status: 'success', durationMs: outcome.durationMs, results: outcome.results,
      rawText: outcome.rawText, mode: outcome.mode, toolName: outcome.toolName,
    })
    return { context: formatSearchContextForModel(outcome), trace }
  } catch (error) {
    trace.status = 'error'
    trace.durationMs = Date.now() - trace.startedAt
    trace.error = formatModelCallError(error, '联网搜索失败')
    if (controller.signal.aborted || isRequestCancelled(requestId)) throw createCancelledRequestError()
    console.warn('[联网搜索失败]', error)
    return null
  } finally {
    unregisterAbortController(requestId, controller)
    stopSearchHeartbeat(requestId)
    void sendModelProgressToBackend(requestId, 'search-finished')
  }
}
