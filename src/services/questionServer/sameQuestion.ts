import { modelApi } from './deps'
import { sendModelResponseToBackend } from './backend'
import {
  callModelWithStreaming,
  stripMarkdownCodeBlock,
  withModelRetry,
} from './invoke'
import {
  finalModelResponseState,
  requestLogs,
  updateMultiModelStreamingResponse,
} from './runtime'
import type { SameQuestionCheckPayload } from './types'

const {
  platforms,
  selectedTextModel: globalSelectedTextModel,
  selectedTextModels: globalSelectedTextModels,
} = modelApi

export const buildSameQuestionCheckPrompt = (payload: SameQuestionCheckPayload): string => {
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

export const parseSameQuestionCheckResult = (raw: string): { same: boolean; matched_id?: number } => {
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
export const handleSameQuestionCheckRequest = async (requestId: string, payloadJson: string) => {
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
