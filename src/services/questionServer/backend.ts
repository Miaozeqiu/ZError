import { normalizeAnswerJsonContent } from '../../utils/answer/answerNormalize'
import { getModelResponseFailure, isTimeoutLikeModelFailureText } from './errors'
import {
  applyLocalRequestCompletion,
  clearRequestHeartbeat,
  finalModelResponseState,
  requestLogs,
} from './runtime'
import { serverUrl } from './serverRefs'

export const getRequestOptionsFromLog = (requestId: string): string => {
  const log = requestLogs.value.find(l => l.id === requestId)
  if (!log?.requestBody) return ''
  try {
    const parsed = JSON.parse(log.requestBody)
    return typeof parsed.options === 'string' ? parsed.options : ''
  } catch {
    return ''
  }
}

export const sendModelResponseToBackend = async (requestId: string, content: string, isSuccess: boolean = true, reasoningContent = '') => {
  isSuccess = isSuccess && !!content.trim() && !getModelResponseFailure(content)
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

    const acknowledgement = await response.json()
    if (acknowledgement.is_success === false) isSuccess = false
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
export const sendModelProgressToBackend = async (requestId: string, content: string) => {
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
