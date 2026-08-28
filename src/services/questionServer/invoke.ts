import type { AIModel } from '../model/config'
import { resolveExecutableModelJsCode, resolveRuntimeModelId } from '../model/protocol'
import { buildAnswerChatMessages } from '../../utils/answer/answerFewShot'
import { modelApi, settingsApi } from './deps'
import {
  createCancelledRequestError,
  formatModelCallError,
  isAbortLikeError,
} from './errors'
import {
  isRequestCancelled,
  registerAbortController,
  unregisterAbortController,
  updateStreamingReasoning,
  updateStreamingResponse,
  updateRequestDetailsWithModelReasoning,
} from './runtime'
import { sendModelProgressToBackend } from './backend'

const { settings } = settingsApi
const { platforms } = modelApi

export const getModelRetryCount = () => {
  const n = Number(settings.modelRetryCount)
  if (!Number.isFinite(n) || n < 0) return 2
  return Math.min(10, Math.floor(n))
}

export const shouldSkipModelRetry = (_error: unknown, requestId: string) => {
  return isRequestCancelled(requestId)
}

export const withModelRetry = async <T>(
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

export const stripMarkdownCodeBlock = (content: string): string => {
  return content.replace(/^```[\w]*\n?/, '').replace(/\n?```$/, '')
}

/** 拼装多模型输出：成功内容或真实报错原文，不使用统一失败文案 */
export const formatModelOutputs = (
  entries: Array<{ model: { displayName: string }; response: string }>
): string => {
  const usable = entries.filter(e => (e.response || '').trim())
  if (usable.length === 0) return ''
  if (usable.length === 1) return usable[0].response
  return usable.map(e => `[${e.model.displayName}]\n${e.response}`).join('\n\n')
}

export const normalizeAnswerForComparison = (content: string): string => {
  return stripMarkdownCodeBlock(content || '')
    .replace(/\s+/g, ' ')
    .trim()
}

export const getMostFrequentSuccessfulAnswer = (responses: string[]): string => {
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

export const getReasoningContentValue = (payload: any): string => {
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


export const callModelWithStreaming = async (

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
  const timeoutMs = (settings.modelResponseTimeout ?? 40) * 1000

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


export const callModel = async (model: AIModel, query: string) => {
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

