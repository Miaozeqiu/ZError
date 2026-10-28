/** 模型连通性测试。设置页其它逻辑不要堆进这里。 */
import type { Ref } from 'vue'
import { secureFetch } from '../../../services/security/secureFetch'
import type { AIModel, AIPlatform } from '../../../services/model/config'
import { modelHasVision } from '../../../services/model/config'
import { resolveExecutableModelJsCode, resolveRuntimeModelId } from '../../../services/model/protocol'

export type ModelTestState = {
  selectedPlatform: Ref<AIPlatform | null>
  testingModelId: Ref<string | null>
  testAbortController: Ref<AbortController | null>
  currentTestResult: Ref<any>
  currentTestError: Ref<string>
  streamingResponse: Ref<string>
  streamingReasoning: Ref<string>
  showTestDialog: Ref<boolean>
}

export const bindModelTest = (state: ModelTestState) => {
  const {
    selectedPlatform,
    testingModelId,
    testAbortController,
    currentTestResult,
    currentTestError,
    streamingResponse,
    streamingReasoning,
    showTestDialog,
  } = state

  const isAbortedTestError = (error: unknown) => {
    if (!(error instanceof Error)) return false
    return error.name === 'AbortError' || /aborted|abort|cancelled|canceled|取消/i.test(error.message)
  }

  const cancelCurrentTest = () => {
    const controller = testAbortController.value
    if (!controller || controller.signal.aborted) return
    controller.abort()
    currentTestError.value = '测试已被用户取消'
  }


  const extractNumericTokenValue = (value: unknown): number | null => {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
    return null
  }

  const readTokenRateFromPayload = (payload: any): number | null => {
    if (!payload || typeof payload !== 'object') return null
    const candidates = [
      payload.tokenRate,
      payload.token_rate,
      payload.tokensPerSecond,
      payload.tokens_per_second,
      payload.averageTokensPerSecond,
      payload.average_tokens_per_second,
      payload.generationSpeed,
      payload.generation_speed,
      payload.usage?.tokenRate,
      payload.usage?.token_rate,
      payload.usage?.tokensPerSecond,
      payload.usage?.tokens_per_second,
      payload.usage?.averageTokensPerSecond,
      payload.usage?.average_tokens_per_second
    ]

    for (const candidate of candidates) {
      const normalized = extractNumericTokenValue(candidate)
      if (normalized !== null) return normalized
    }

    return null
  }

  const readOutputTokenCountFromPayload = (payload: any): number | null => {
    if (!payload || typeof payload !== 'object') return null
    const candidates = [
      payload.outputTokens,
      payload.output_tokens,
      payload.completionTokens,
      payload.completion_tokens,
      payload.generatedTokens,
      payload.generated_tokens,
      payload.usage?.outputTokens,
      payload.usage?.output_tokens,
      payload.usage?.completionTokens,
      payload.usage?.completion_tokens,
      payload.usage?.generatedTokens,
      payload.usage?.generated_tokens,
      payload.usage?.totalTokens,
      payload.usage?.total_tokens
    ]

    for (const candidate of candidates) {
      const normalized = extractNumericTokenValue(candidate)
      if (normalized !== null) return normalized
    }

    return null
  }

  const estimateTextTokens = (text: string): number => {
    const normalized = text.trim()
    if (!normalized) return 0

    const cjkCount = (normalized.match(/[\u3400-\u9fff]/g) || []).length
    const wordCount = (normalized.match(/[A-Za-z]+(?:['’-][A-Za-z]+)*/g) || []).length
    const numberCount = (normalized.match(/\d+(?:\.\d+)?/g) || []).length
    const symbolCount = (normalized.match(/[^\sA-Za-z0-9\u3400-\u9fff]/g) || []).length

    return Math.max(1, Math.round(cjkCount + wordCount * 1.3 + numberCount + symbolCount * 0.3))
  }

  const resolveTokenRate = (payload: any, response: string, reasoning = '', durationMs = 0): number | null => {
    const elapsedSeconds = durationMs > 0 ? durationMs / 1000 : 0
    if (elapsedSeconds <= 0) return null

    const explicitOutputTokens = readOutputTokenCountFromPayload(payload)
    const estimatedOutputTokens = estimateTextTokens(`${reasoning}\n${response}`.trim())
    const outputTokens = explicitOutputTokens ?? estimatedOutputTokens

    if (!outputTokens) return null
    return Number((outputTokens / elapsedSeconds).toFixed(1))
  }

  const hasVisibleOutputContent = (value: unknown): boolean => {
    if (typeof value !== 'string') return false
    return value.replace(/```[\s\S]*?```/g, '').trim().length > 0
  }

  const createCookieEnabledFetch = (
    baseFetch: typeof fetch,
    defaultSignal?: AbortSignal | null
  ) => {
    return (input: RequestInfo | URL, init: RequestInit = {}) => {
      const requestInit: RequestInit = {
        ...init,
        credentials: init.credentials ?? 'include'
      }

      if (defaultSignal && !requestInit.signal) {
        requestInit.signal = defaultSignal
      }

      return baseFetch(input, requestInit)
    }
  }

  // 测试模型功能
  const testModel = async (model: AIModel, testFunctionCalling: boolean = false) => {
    if (!selectedPlatform.value) return
    const runtimeModelId = resolveRuntimeModelId(model)
  
    // 创建AbortController用于取消请求
    testAbortController.value = new AbortController()
  
    // 显示测试状态
    testingModelId.value = model.id
    currentTestResult.value = null
    currentTestError.value = ''
    streamingResponse.value = '' // 重置流式响应
    streamingReasoning.value = '' // 重置流式思考过程
  
    try {
      // 根据模型类型构建不同的测试输入数据
      let testInput: any
    
      if (modelHasVision(model) && !testFunctionCalling) {
        // 视觉模型测试：使用图片输入
        // 将图片转换为base64格式
        let imageBase64 = ''
        try {
          // 使用与getPlatformIconUrl相同的环境检测逻辑
          const isTauriEnv = typeof window !== 'undefined' && (window.__TAURI__ || window.__TAURI_INTERNALS__)
          console.log('🔍 [DEBUG] Environment detection for test image - isTauriEnv:', isTauriEnv)
        
          let imageUrl = ''
        
          if (isTauriEnv) {
            // 检查是否在开发环境
            const isDev = import.meta.env.DEV
            console.log('🔍 [DEBUG] import.meta.env.DEV:', isDev)
          
            if (isDev) {
              // 开发环境：使用 Vite 开发服务器路径
              imageUrl = '/assets/images/vlm_test/vlm_test.png'
              console.log('✅ [DEBUG] Using development path for test image:', imageUrl)
            } else {
              // 生产环境：使用 frontendDist 管理的静态资源路径
              console.log('🚀 [DEBUG] Production environment detected for test image')
            
              try {
                // 方法1：使用 public 目录中的资源（通过 frontendDist 管理）
                imageUrl = '/assets/images/vlm_test/vlm_test.png'
                console.log('✅ [DEBUG] Using frontendDist managed path for test image:', imageUrl)
              } catch (error) {
                console.error('❌ [DEBUG] frontendDist path failed for test image:', error)
              
                // 方法2：尝试使用 Tauri 资源解析
                try {
                  console.log('🔍 [DEBUG] Attempting Tauri resource resolution for test image')
                  const { convertFileSrc } = await import('@tauri-apps/api/core')
                  const resourcePath = 'assets/images/vlm_test/vlm_test.png'
                  imageUrl = convertFileSrc(resourcePath)
                  console.log('✅ [DEBUG] Tauri converted URL for test image:', imageUrl)
                } catch (tauriError) {
                  console.error('❌ [DEBUG] Tauri resource resolution failed for test image:', tauriError)
                
                  // 方法3：回退到相对路径
                  imageUrl = '/assets/images/vlm_test/vlm_test.png'
                  console.log('⚠️ [DEBUG] Using fallback path for test image:', imageUrl)
                }
              }
            }
          } else {
            // 在浏览器环境中使用 public 目录路径
            imageUrl = '/assets/images/vlm_test/vlm_test.png'
            console.log('🌐 [DEBUG] Using browser path for test image:', imageUrl)
          }
        
          // 使用确定的URL获取图片
          const response = await fetch(imageUrl)
          if (!response.ok) {
            throw new Error(`Failed to fetch image: ${response.status} ${response.statusText}`)
          }
        
          const blob = await response.blob()
        
          // 转换为base64
          const reader = new FileReader()
          imageBase64 = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(reader.result as string)
            reader.onerror = reject
            reader.readAsDataURL(blob)
          })
        
          console.log('✅ 成功加载测试图片，base64长度:', imageBase64.length)
        } catch (error) {
          console.error('图片转换失败:', error)
          // 使用备用的简单测试图片
          const testImageBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChAI9jU77zgAAAABJRU5ErkJggg=='
          imageBase64 = `data:image/png;base64,${testImageBase64}`
          console.log('⚠️ 使用备用测试图片')
        }
      
        testInput = {
          messages: [
            {
              role: 'user',
              content: [
                {
                  type: 'image_url',
                  image_url: {
                    url: imageBase64,
                    detail: 'low'
                  }
                },
                {
                  type: 'text',
                  text: '请解答题目中的问题'
                }
              ]
            }
          ],
          model: runtimeModelId,
          stream: true
        }
      } else {
        // 文本模型或测试 Function Calling 时：使用纯文本输入
        let messageContent = '你好，这是一个测试消息，请简单回复确认收到。'
        if (testFunctionCalling) {
          messageContent = '请调用名称为 encrypt_string 的函数，将字符串 "HelloZError" 进行 base64 加密，不要做多余的解释。'
        }
        testInput = {
          messages: [
            {
              role: 'user',
              content: messageContent
            }
          ],
          model: runtimeModelId,
          stream: true
        }
      
        if (testFunctionCalling) {
          testInput.tools = [
            {
              type: 'function',
              function: {
                name: 'encrypt_string',
                description: '将输入的字符串进行 Base64 加密编码',
                parameters: {
                  type: 'object',
                  properties: {
                    text: {
                      type: 'string',
                      description: '需要加密的原始字符串'
                    }
                  },
                  required: ['text']
                }
              }
            }
          ]
        }
      }
    
      // 构建配置对象
      const config = {
        ...model,
        apiKey: selectedPlatform.value.apiKey,
        customHeaders: selectedPlatform.value.customHeaders,
        baseUrl: selectedPlatform.value.baseUrl,
        model: runtimeModelId,
        modelId: runtimeModelId
      }
    

      const tauriFetch = createCookieEnabledFetch(
        secureFetch,
        testAbortController.value?.signal
      )
      const executableCode = resolveExecutableModelJsCode(model, selectedPlatform.value)
    
      // 执行JavaScript配置代码
      if (executableCode) {
        try {
          // 创建一个安全的执行环境
          let processModel
        
          if (executableCode.startsWith('async function') || executableCode.startsWith('function')) {
            // 如果是完整的函数声明，使用eval在安全环境中执行
            const safeEval = new Function('input', 'config', 'fetch', 'abortSignal', `
              ${executableCode}
              return processModel;
            `)
            processModel = safeEval(testInput, config, tauriFetch, testAbortController.value?.signal)
          } else {
            // 如果是函数体，包装为async函数
            const wrapperFunction = new Function('input', 'config', 'fetch', 'abortSignal', `
              return (async function processModel(input, config) {
                ${executableCode}
              });
            `)
            processModel = wrapperFunction(testInput, config, tauriFetch, testAbortController.value?.signal)
          }
        
          // 执行测试
          const testStartedAt = performance.now()
          let fullResponse = ''
          let fullReasoning = ''
          let firstTokenAt: number | null = null
          let lastUsagePayload: any = null
          streamingResponse.value = '' // 重置流式响应
          streamingReasoning.value = '' // 重置流式思考过程
        
          while (true) {
            const result = await processModel(testInput, config, tauriFetch, testAbortController.value?.signal)
          
            if (result) {
              // 如果返回的是生成器或异步迭代器，收集结果
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
                    if (firstTokenAt === null) firstTokenAt = performance.now()
                    fullResponse += chunk.content
                    streamingResponse.value = fullResponse // 实时更新流式响应
                  }
                  // 兼容新的思考过程字段
                  if (chunk.reasoning_content) {
                    if (firstTokenAt === null) firstTokenAt = performance.now()
                    fullReasoning += chunk.reasoning_content
                    streamingReasoning.value = fullReasoning // 实时更新流式思考过程
                  }
                  if (readTokenRateFromPayload(chunk) !== null || readOutputTokenCountFromPayload(chunk) !== null) {
                    lastUsagePayload = chunk
                  }
                }

                if (toolCalls.length > 0) {
                  testInput.messages.push({ role: 'assistant', content: '', tool_calls: toolCalls })

                  for (const tc of toolCalls) {
                    try {
                      fullResponse += `\n\n[测试：模型请求调用函数 ${tc.function.name}...]\n`
                      streamingResponse.value = fullResponse

                      let toolResult = ''
                      if (tc.function.name === 'test_function') {
                        const args = tc.function.arguments || '{}'
                        toolResult = `{"success": true, "message": "函数 test_function 执行成功，收到的参数: ${args}"}`
                      } else if (tc.function.name === 'encrypt_string') {
                        try {
                          const args = JSON.parse(tc.function.arguments || '{}')
                          if (args.text) {
                            const base64Str = btoa(unescape(encodeURIComponent(args.text)))
                            toolResult = `{"success": true, "result": "${base64Str}"}`
                          } else {
                            toolResult = `{"success": false, "error": "Missing required parameter 'text'"}`
                          }
                        } catch (e) {
                          toolResult = `{"success": false, "error": "Invalid JSON arguments"}`
                        }
                      } else {
                        toolResult = `Error: Unknown function ${tc.function.name}`
                      }

                      fullResponse += `[测试：向模型返回模拟结果: ${toolResult}]\n\n`
                      streamingResponse.value = fullResponse

                      testInput.messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: toolResult })
                    } catch (e: any) {
                      const errStr = `Error: ${e.message || String(e)}`
                      fullResponse += `[测试：工具执行失败: ${errStr}]\n\n`
                      streamingResponse.value = fullResponse
                      testInput.messages.push({ role: 'tool', tool_call_id: tc.id, name: tc.function.name, content: errStr })
                    }
                  }
                  continue; // tool calls processed, loop again
                }

                if (!hasVisibleOutputContent(fullResponse)) {
                  currentTestResult.value = null
                  currentTestError.value = '测试失败：模型未返回任何输出内容'
                } else {
                  const firstTokenLatency = firstTokenAt !== null ? firstTokenAt - testStartedAt : null
                  const tokenRateDuration = firstTokenAt !== null ? performance.now() - firstTokenAt : 0
                  const tokenRate = resolveTokenRate(lastUsagePayload, fullResponse, fullReasoning, tokenRateDuration)

                  currentTestResult.value = {
                    success: true,
                    response: fullResponse,
                    reasoning_content: fullReasoning,
                    firstTokenLatency: firstTokenLatency ?? undefined,
                    tokenRate: tokenRate ?? undefined,
                    timestamp: new Date().toLocaleString(),
                    modelType: modelHasVision(model) ? 'vision' : 'text',
                    testType: modelHasVision(model) ? '图像理解测试' : '文本对话测试'
                  }
                }
                break;
              } else {
                // 非流式返回：兼容对象格式与字符串格式
                let finalResponse = ''
                let finalReasoning = ''
                let usagePayload: any = null
                if (typeof result === 'string') {
                  finalResponse = result
                } else if (result && typeof result === 'object') {
                  finalResponse = (result.content ?? result.response ?? '')
                  // 兼容新的思考过程字段
                  finalReasoning = (result.reasoning_content ?? '')
                  usagePayload = result
                }

                if (!hasVisibleOutputContent(finalResponse)) {
                  currentTestResult.value = null
                  currentTestError.value = '测试失败：模型未返回任何输出内容'
                } else {
                  const finalCompletedAt = performance.now()
                  const firstTokenLatency = finalCompletedAt - testStartedAt
                  const tokenRate = resolveTokenRate(usagePayload, finalResponse, finalReasoning, 0)

                  currentTestResult.value = {
                    success: true,
                    response: finalResponse,
                    reasoning_content: finalReasoning,
                    firstTokenLatency,
                    tokenRate: tokenRate ?? undefined,
                    timestamp: new Date().toLocaleString(),
                    modelType: modelHasVision(model) ? 'vision' : 'text',
                    testType: modelHasVision(model) ? '图像理解测试' : '文本对话测试'
                  }
                }
                break;
              }
            } else {
              currentTestError.value = '模型配置代码未返回有效结果'
              break;
            }
          }
        } catch (codeError) {
          if (isAbortedTestError(codeError)) {
            if (!currentTestError.value) currentTestError.value = '测试已被用户取消'
            return
          }
          console.error('执行模型配置代码失败:', codeError)
          currentTestError.value = `代码执行错误: ${(codeError as Error).message}`
        }
      } else {
        currentTestError.value = '模型未配置可执行代码'
      }
    } catch (error) {
      if (isAbortedTestError(error)) {
        if (!currentTestError.value) currentTestError.value = '测试已被用户取消'
        return
      }
      console.error('测试模型失败:', error)
      currentTestError.value = `测试失败: ${(error as Error).message}`
    } finally {
      testingModelId.value = null
      testAbortController.value = null
      // 测试完成后，如果有错误则清空流式响应
      if (currentTestError.value) {
        streamingResponse.value = ''
        streamingReasoning.value = ''
      }
    }
  }

  // 处理测试弹窗关闭
  const handleCloseTestDialog = () => {
    cancelCurrentTest()
    showTestDialog.value = false
  }

  // 处理取消测试
  const handleCancelTest = () => {
    cancelCurrentTest()
  }
  return {
    isAbortedTestError,
    cancelCurrentTest,
    extractNumericTokenValue,
    readTokenRateFromPayload,
    readOutputTokenCountFromPayload,
    estimateTextTokens,
    resolveTokenRate,
    hasVisibleOutputContent,
    createCookieEnabledFetch,
    testModel,
    handleCloseTestDialog,
    handleCancelTest,
  }
}
