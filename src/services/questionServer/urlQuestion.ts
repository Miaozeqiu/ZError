import { ref } from 'vue'
import { resolveExecutableModelJsCode, resolveRuntimeModelId } from '../model/protocol'
import {
  buildUrlOptionMapForMode,
  buildUrlQuestionPromptParts,
  classifyUrlQuestionMode,
  resolveUrlAnswer,
} from '../../utils/answer/urlQuestion'
import { modelApi } from './deps'
import {
  createCancelledRequestError,
  formatModelCallError,
  isAbortLikeError,
} from './errors'
import {
  getReasoningContentValue,
  withModelRetry,
} from './invoke'
import { sendModelProgressToBackend, sendModelResponseToBackend } from './backend'
import {
  activeUrlAnalysisRequestIds,
  cancelledRequestIds,
  clearRequestHeartbeat,
  isRequestCancelled,
  processedRequestIds,
  registerAbortController,
  requestLogs,
  unregisterAbortController,
  heartbeatIntervals,
} from './runtime'
import type { RequestLog } from './types'
import {
  buildMultimodalContent,
  buildRenderedHtml,
  executeVisionModelWithAutoUpscale,
  prepareVisionRequestContent,
} from './visionImage'

const {
  platforms,
  selectedVisionModel: globalSelectedVisionModel,
} = modelApi

export const currentUrlWindowId = ref('')
export const handleUrlQuestionRequest = async (requestId: string, rawTitle: string) => {
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


export const getExistingQuestions = () => {
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
export const saveQuestionsToStorage = (questions: any[]) => {
  try {
    const key = currentUrlWindowId.value ? `urlContentQuestions_${currentUrlWindowId.value}` : 'urlContentQuestions'
    localStorage.setItem(key, JSON.stringify(questions))
  } catch (error) {
    console.error('保存题目数据失败:', error)
  }
}


export const checkAndShowUrlDialog = async (log: RequestLog) => {
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


export const analyzeUrlQuestion = async (requestId: string) => {
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

