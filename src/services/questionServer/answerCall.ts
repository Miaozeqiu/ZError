import type { AIModel } from '../model/config'
import { modelApi } from './deps'
import {
  createCancelledRequestError,
  formatModelCallError,
  isAbortLikeError,
  MODEL_REQUEST_CANCELLED_MESSAGE,
} from './errors'
import {
  callModelWithStreaming,
  formatModelOutputs,
  getMostFrequentSuccessfulAnswer,
  stripMarkdownCodeBlock,
  withModelRetry,
} from './invoke'
import { sendModelProgressToBackend, sendModelResponseToBackend } from './backend'
import {
  cancelledRequestIds,
  clearRequestHeartbeat,
  finalModelResponseState,
  finalizeMultiModelReasoning,
  heartbeatIntervals,
  isRequestCancelled,
  requestLogs,
  updateMultiModelStreamingReasoning,
  updateMultiModelStreamingResponse,
} from './runtime'
import { serverRunning, serverUrl } from './serverRefs'
import type { MultiModelResponse } from './types'

const {
  platforms,
  selectedTextModels: globalSelectedTextModels,
  selectedSummaryModels: globalSelectedSummaryModels,
  selectedVisionModel: globalSelectedVisionModel,
} = modelApi

export const getRequestReasoningForBackend = (requestId: string, modelId?: string): string => {
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

export const callSingleModelAPI = async (model: AIModel, query: string, logId: string): Promise<string> => {
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

export const callModelAPI = async (requestId: string, query: string) => {
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
