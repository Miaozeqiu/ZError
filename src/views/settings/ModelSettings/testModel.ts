import { createBuiltinProvider, type ProviderAdapter, type ProviderChunk, type ProviderRequest } from '../../../services/model/providers'
import { estimateTextTokens, resolveModelOutputLimit } from '../../../services/model/contextBudget'
/** 模型连通性测试。设置页其它逻辑不要堆进这里。 */
import type { Ref } from 'vue'
import { secureFetch } from '../../../services/security/secureFetch'
import type { AIModel, AIPlatform } from '../../../services/model/config'
import { modelConfigManager, modelHasVision } from '../../../services/model/config'
import { resolveExecutableModelJsCode, resolveRuntimeModelId } from '../../../services/model/protocol'

export type ModelTestResult = {
  success: true
  response: string
  reasoning_content: string
  modelType: 'text' | 'vision'
}

export type ModelTestMetrics = {
  phase: 'preparing' | 'waiting' | 'streaming'
  modelType: ModelTestResult['modelType']
  elapsedMs: number
  firstTokenLatency?: number
  tokenRate?: number
  tokenRateEstimated: boolean
  outputTokens?: number
  outputTokensEstimated: boolean
}

type TestModelOutput = string | (ProviderChunk & { response?: string }) | AsyncIterable<ProviderChunk>
type TestModelRunner = (...args: Parameters<ProviderAdapter>) => TestModelOutput | Promise<TestModelOutput>

const loadTestImage = async (signal: AbortSignal): Promise<string> => {
  const response = await fetch('/assets/images/vlm_test/vlm_test.png', { signal })
  if (!response.ok) throw new Error(`无法加载测试图片（HTTP ${response.status}）`)

  const image = await response.blob()
  if (!image.type.startsWith('image/') || !image.size) throw new Error('测试图片无效')

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('无法读取测试图片'))
    reader.readAsDataURL(image)
  })
}

export type ModelTestState = {
  selectedPlatform: Ref<AIPlatform | null>
  testingModelId: Ref<string | null>
  testAbortController: Ref<AbortController | null>
  currentTestResult: Ref<ModelTestResult | null>
  currentTestError: Ref<string>
  testMetrics: Ref<ModelTestMetrics | null>
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
    testMetrics,
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


  const readMetric = (...values: unknown[]): number | undefined => {
    for (const raw of values) {
      const value = typeof raw === 'string' && raw.trim() ? Number(raw) : raw
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value
    }
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

  const testModel = async (model: AIModel) => {
    const platform = selectedPlatform.value
    if (!platform) return

    const runtimeModelId = resolveRuntimeModelId(model)
    const vision = modelHasVision(model)
    testAbortController.value?.abort()
    const controller = new AbortController()
    const signal = controller.signal
    testAbortController.value = controller
    testingModelId.value = model.id
    currentTestResult.value = null
    currentTestError.value = ''
    streamingResponse.value = ''
    streamingReasoning.value = ''

    const testStartedAt = performance.now()
    let requestStartedAt: number | undefined
    let firstOutputAt: number | undefined
    let lastOutputAt: number | undefined
    let firstChunkTokens = 0
    let providerOutputTokens: number | undefined
    let providerTokenRate: number | undefined
    let response = ''
    let reasoning = ''

    const readProviderMetrics = (chunk: ProviderChunk & Record<string, unknown>) => {
      const usage = chunk.usage
      providerOutputTokens = readMetric(
        usage?.output_tokens, usage?.completion_tokens, usage?.outputTokens, usage?.completionTokens,
        usage?.generated_tokens, usage?.generatedTokens, chunk.output_tokens, chunk.completion_tokens,
        chunk.outputTokens, chunk.completionTokens, chunk.generated_tokens, chunk.generatedTokens,
      ) ?? providerOutputTokens
      providerTokenRate = readMetric(
        chunk.tokenRate, chunk.token_rate, chunk.tokensPerSecond, chunk.tokens_per_second,
        chunk.averageTokensPerSecond, chunk.average_tokens_per_second, chunk.generationSpeed, chunk.generation_speed,
        usage?.tokenRate, usage?.token_rate, usage?.tokensPerSecond, usage?.tokens_per_second,
        usage?.averageTokensPerSecond, usage?.average_tokens_per_second,
      ) ?? providerTokenRate
    }

    const publishMetrics = (finished = false) => {
      const estimatedTokens = estimateTextTokens(reasoning.trim()) + estimateTextTokens(response.trim())
      const outputTokens = providerOutputTokens ?? (estimatedTokens || undefined)
      const sampleMs = firstOutputAt !== undefined && lastOutputAt !== undefined ? lastOutputAt - firstOutputAt : 0
      // Exclude the first batch because its generation happened before the measured interval.
      const sampledTokens = Math.max(0, (outputTokens ?? 0) - firstChunkTokens)
      const estimatedRate = sampledTokens > 0 && sampleMs >= (finished ? 100 : 250)
        ? sampledTokens * 1000 / sampleMs
        : undefined

      testMetrics.value = {
        phase: firstOutputAt !== undefined ? 'streaming' : requestStartedAt !== undefined ? 'waiting' : 'preparing',
        modelType: vision ? 'vision' : 'text',
        elapsedMs: performance.now() - testStartedAt,
        firstTokenLatency: firstOutputAt !== undefined && requestStartedAt !== undefined
          ? firstOutputAt - requestStartedAt
          : undefined,
        outputTokens,
        outputTokensEstimated: providerOutputTokens === undefined,
        tokenRate: providerTokenRate ?? estimatedRate,
        tokenRateEstimated: providerTokenRate === undefined,
      }
    }

    publishMetrics()
    const metricsTimer = setInterval(publishMetrics, 250)
    signal.addEventListener('abort', () => clearInterval(metricsTimer), { once: true })

    try {
      const executableCode = resolveExecutableModelJsCode(model, platform)
      if (!executableCode) {
        currentTestError.value = '模型未配置可执行代码'
        return
      }

      const content = vision
        ? [
            { type: 'image_url', image_url: { url: await loadTestImage(signal), detail: 'low' } },
            { type: 'text', text: '请解答题目中的问题' },
          ]
        : '你好，这是一个测试消息，请简单回复确认收到。'
      if (signal.aborted) return

      const input: ProviderRequest = {
        messages: [{ role: 'user', content }],
        model: runtimeModelId,
        stream: true,
      }
      const config = {
        ...model,
        maxTokens: resolveModelOutputLimit(model),
        apiKey: modelConfigManager.getPlatformApiKey(platform),
        customHeaders: platform.customHeaders,
        baseUrl: platform.baseUrl,
        model: runtimeModelId,
        modelId: runtimeModelId,
      }
      const tauriFetch = createCookieEnabledFetch(secureFetch, signal)
      const builtinProvider = createBuiltinProvider(model, platform)
      let processModel: TestModelRunner
      if (builtinProvider) {
        processModel = builtinProvider
      } else {
        // 自定义 JS 继续使用用户配置的请求实现。
        const source = executableCode.startsWith('async function') || executableCode.startsWith('function')
          ? `${executableCode}\nreturn processModel;`
          : `return (async function processModel(input, config) {\n${executableCode}\n});`
        processModel = new Function('input', 'config', 'fetch', 'abortSignal', source)(
          input, config, tauriFetch, signal
        )
      }

      requestStartedAt = performance.now()
      publishMetrics()
      const result = await processModel(input, config, tauriFetch, signal)
      if (signal.aborted) return

      if (!result) {
        currentTestError.value = '模型配置代码未返回有效结果'
        return
      }

      if (typeof result === 'object' && Symbol.asyncIterator in result) {
        for await (const chunk of result) {
          if (signal.aborted) return
          readProviderMetrics(chunk)
          if (chunk.content || chunk.reasoning_content) lastOutputAt = performance.now()
          if (chunk.content) {
            response += chunk.content
            streamingResponse.value = response
          }
          if (chunk.reasoning_content) {
            reasoning += chunk.reasoning_content
            streamingReasoning.value = reasoning
          }
          if (lastOutputAt !== undefined && firstOutputAt === undefined) {
            firstOutputAt = lastOutputAt
            firstChunkTokens = estimateTextTokens(reasoning.trim()) + estimateTextTokens(response.trim())
            publishMetrics()
          }
        }
        if (signal.aborted) return
      } else if (typeof result === 'string') {
        response = result
      } else {
        response = result.content ?? result.response ?? ''
        reasoning = result.reasoning_content ?? ''
        readProviderMetrics(result)
      }

      if (!hasVisibleOutputContent(response)) {
        currentTestError.value = '测试失败：模型未返回任何输出内容'
        return
      }

      currentTestResult.value = {
        success: true,
        response,
        reasoning_content: reasoning,
        modelType: vision ? 'vision' : 'text',
      }
    } catch (error) {
      if (testAbortController.value !== controller) return
      if (signal.aborted || isAbortedTestError(error)) {
        currentTestError.value = '测试已被用户取消'
      } else {
        console.error('测试模型失败:', error)
        currentTestError.value = `测试失败: ${error instanceof Error ? error.message : String(error)}`
      }
    } finally {
      clearInterval(metricsTimer)
      if (testAbortController.value === controller) {
        if (!signal.aborted) publishMetrics(true)
        testingModelId.value = null
        testAbortController.value = null
        if (currentTestError.value) {
          streamingResponse.value = ''
          streamingReasoning.value = ''
        }
      }
    }
  }

  // 处理测试弹窗关闭
  const handleCloseTestDialog = () => {
    cancelCurrentTest()
    showTestDialog.value = false
  }

  return {
    cancelCurrentTest,
    testModel,
    handleCloseTestDialog,
  }
}
