import { resolveExecutableModelJsCode, resolveRuntimeModelId } from './modelProtocol'
import { modelConfigManager } from './modelConfig'
import { settingsManager } from './settings'

export interface ModelToolCall {
  id: string
  name: string
  arguments: string
}

export type ModelRunEvent =
  | { type: 'round_start' }
  | { type: 'text'; text: string }
  | { type: 'tool_pending'; name?: string }
  | { type: 'tool_start'; id: string; name: string; arguments: string }
  | { type: 'tool_end'; id: string; name: string; result: string; error?: string }

export const MODEL_STOPPED_MESSAGE = '已终止对话'

export class ModelStoppedError extends Error {
  constructor() {
    super(MODEL_STOPPED_MESSAGE)
    this.name = 'ModelStoppedError'
  }
}

export const isModelStopped = (error: unknown) => {
  if (error instanceof ModelStoppedError) return true
  if (error instanceof Error && error.name === 'ModelStoppedError') return true
  const message = error instanceof Error ? error.message : String(error)
  return message === MODEL_STOPPED_MESSAGE
}

export interface RunTextModelOptions {
  timeoutMs?: number
  tools?: any[]
  systemPrompt?: string
  history?: { role: string; content: unknown }[]
  userContent?: unknown
  maxRounds?: number
  useAgentModel?: boolean
  signal?: AbortSignal
  executeTool?: (call: ModelToolCall) => Promise<string>
  onEvent?: (event: ModelRunEvent) => void
}

const collectContent = (result: any): string => {
  if (typeof result === 'string') return result
  if (typeof result?.content === 'string') return result.content
  if (result == null) return ''
  try {
    return JSON.stringify(result)
  } catch {
    return String(result)
  }
}

const formatRunnerError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  const name = error instanceof Error ? error.name : ''
  if (
    name === 'AbortError' ||
    name === 'TimeoutError' ||
    /cancelled|canceled|aborted|abort|超时|timeout/i.test(message)
  ) {
    return new Error('模型请求中断或超时，识别题目通常需要更长时间，请稍后重试')
  }
  return error instanceof Error ? error : new Error(message)
}

const SINGLETON_TOOLS = new Set(['get_file_info', 'list_folders'])

const mergeToolArgs = (prev: string, next: string) => {
  if (!next) return prev
  if (!prev) return next
  if (next === prev) return prev
  if (next.startsWith(prev)) return next
  if (prev.startsWith(next)) return prev
  return prev + next
}

const sameToolPayload = (left: any, right: any) => {
  const leftName = left?.function?.name || left?.name || ''
  const rightName = right?.function?.name || right?.name || ''
  if (!leftName || leftName !== rightName) return false
  if (SINGLETON_TOOLS.has(leftName)) return true
  const leftArgs = String(left?.function?.arguments || '')
  const rightArgs = String(right?.function?.arguments || '')
  if (leftArgs === rightArgs) return true
  if (!leftArgs || !rightArgs) return true
  if (leftArgs.startsWith(rightArgs) || rightArgs.startsWith(leftArgs)) return true
  try {
    return JSON.stringify(JSON.parse(leftArgs || '{}')) === JSON.stringify(JSON.parse(rightArgs || '{}'))
  } catch {
    return false
  }
}

const finalizeToolCalls = (toolCalls: any[]) => {
  const result: any[] = []
  for (const tc of toolCalls) {
    const dup = result.find((item) => {
      if (item.id && tc.id && item.id === tc.id) return true
      if (item.index != null && tc.index != null && item.index === tc.index) return true
      return sameToolPayload(item, tc)
    })
    if (!dup) {
      result.push(tc)
      continue
    }
    dup.function = dup.function || { name: '', arguments: '' }
    if (tc.id && String(dup.id || '').startsWith('tool-')) dup.id = tc.id
    if (tc.function?.name) dup.function.name = tc.function.name
    dup.function.arguments = mergeToolArgs(dup.function.arguments || '', tc.function?.arguments || '')
  }
  return result
}

const mergeToolCalls = (existing: any[], incoming: any[]) => {
  for (const tc of incoming || []) {
    const incomingId = tc.id || tc.tool_call_id || ''
    const incomingIndex = Number.isFinite(Number(tc.index)) ? Number(tc.index) : undefined
    const incomingName = tc.function?.name || tc.name || ''
    const found = existing.find((item) => {
      if (incomingId && item.id && item.id === incomingId) return true
      if (incomingIndex != null && item.index === incomingIndex) return true
      return false
    }) || (
      !incomingId && incomingIndex == null
        ? existing.find((item, index) => (
          index === existing.length - 1
          && (!incomingName || !item.function?.name || item.function.name === incomingName)
        ))
        : incomingId
          ? existing.find((item) =>
            String(item.id || '').startsWith('tool-')
            && (!incomingName || !item.function?.name || item.function.name === incomingName)
          )
          : undefined
    )
    if (found) {
      found.function = found.function || { name: '', arguments: '' }
      if (incomingId) found.id = incomingId
      if (incomingIndex != null) found.index = incomingIndex
      if (incomingName) found.function.name = incomingName
      found.function.arguments = mergeToolArgs(found.function.arguments || '', tc.function?.arguments || '')
      continue
    }
    existing.push({
      id: incomingId || `tool-${existing.length + 1}`,
      index: incomingIndex,
      type: tc.type || 'function',
      function: {
        name: incomingName,
        arguments: tc.function?.arguments || '',
      },
    })
  }
}

const normalizeToolCalls = (result: any): any[] => {
  if (Array.isArray(result?.tool_calls) && result.tool_calls.length) return result.tool_calls
  if (Array.isArray(result?.function_calls) && result.function_calls.length) return result.function_calls
  return []
}

export async function runTextModel(
  prompt: string,
  onDelta?: (text: string) => void,
  options?: RunTextModelOptions
): Promise<string> {
  const model = options?.useAgentModel
    ? (modelConfigManager.getSelectedAgentModel() || modelConfigManager.getSelectedTextModel())
    : (modelConfigManager.getSelectedTextModel() || modelConfigManager.getSelectedModel())
  if (!model) {
    throw new Error(options?.useAgentModel ? '请先在模型设置的 agent 里选择一个模型' : '请先在设置里选择一个文本模型')
  }

  const platform = modelConfigManager.getSettings().platforms.find((item) =>
    item.models.some((itemModel) => itemModel.id === model.id)
  )
  if (!platform) {
    throw new Error('未找到模型所属平台')
  }
  if (!platform.apiKey?.trim()) {
    throw new Error('当前平台还没有填写 API Key')
  }

  const runtimeModelId = resolveRuntimeModelId(model)
  const executableCode = resolveExecutableModelJsCode(model, platform)
  if (!executableCode) {
    throw new Error('当前模型没有可用的调用配置')
  }

  const messages: any[] = []
  if (options?.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt })
  }
  for (const item of options?.history || []) {
    if (!item?.content) continue
    if (item.role === 'assistant' || item.role === 'user') {
      messages.push({ role: item.role, content: item.content })
    }
  }
  messages.push({ role: 'user', content: options?.userContent ?? prompt })

  const input: any = {
    messages,
    model: runtimeModelId,
    stream: true,
    tools: options?.tools || [],
  }
  const config = {
    ...model,
    apiKey: platform.apiKey,
    baseUrl: platform.baseUrl,
    model: runtimeModelId,
    modelId: runtimeModelId,
  }

  const configuredMs = Number(settingsManager.get('modelResponseTimeout') ?? 40) * 1000
  const timeoutMs = Math.max(options?.timeoutMs ?? 0, configuredMs > 0 ? configuredMs : 40000, 180000)
  const abortController = new AbortController()
  const throwIfStopped = () => {
    if (options?.signal?.aborted) throw new ModelStoppedError()
  }
  if (options?.signal) {
    if (options.signal.aborted) {
      abortController.abort(options.signal.reason)
    } else {
      options.signal.addEventListener('abort', () => {
        abortController.abort(options.signal?.reason)
      }, { once: true })
    }
  }
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null
  const armTimeout = () => {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    timeoutHandle = setTimeout(() => {
      abortController.abort(new DOMException(`模型响应超时（${Math.round(timeoutMs / 1000)} 秒）`, 'TimeoutError'))
    }, timeoutMs)
  }
  armTimeout()
  throwIfStopped()

  const tauriHttp = await import('@tauri-apps/plugin-http')
  const tauriFetch = async (request: RequestInfo | URL, init: RequestInit = {}) => {
    return tauriHttp.fetch(request as any, {
      ...init,
      credentials: init.credentials ?? 'include',
      signal: init.signal ?? abortController.signal,
    } as any)
  }

  let processModel: any
  if (executableCode.startsWith('async function') || executableCode.startsWith('function')) {
    const safeEval = new Function('input', 'config', 'fetch', 'abortSignal', `
      ${executableCode}
      return processModel;
    `)
    processModel = safeEval(input, config, tauriFetch, abortController.signal)
  } else {
    const wrapperFunction = new Function('input', 'config', 'fetch', 'abortSignal', `
      return (async function processModel(input, config) {
        ${executableCode}
      });
    `)
    processModel = wrapperFunction(input, config, tauriFetch, abortController.signal)
  }

  const maxRounds = Math.max(1, options?.maxRounds ?? 1)
  let fullResponse = ''

  try {
    for (let round = 0; round < maxRounds; round += 1) {
      throwIfStopped()
      armTimeout()
      fullResponse = ''
      onDelta?.('')
      options?.onEvent?.({ type: 'round_start' })
      const result = await processModel(input, config, tauriFetch, abortController.signal)
      throwIfStopped()
      if (!result) {
        throw new Error('模型没有返回结果')
      }

      let toolCalls: any[] = []
      let toolPendingSent = false
      if (result[Symbol.asyncIterator]) {
        for await (const chunk of result) {
          throwIfStopped()
          if (chunk?.tool_calls) {
            mergeToolCalls(toolCalls, chunk.tool_calls)
            if (!toolPendingSent && toolCalls.length) {
              toolPendingSent = true
              options?.onEvent?.({
                type: 'tool_pending',
                name: toolCalls.find((item) => item.function?.name)?.function?.name || '',
              })
            }
          }
          if (chunk?.content) {
            fullResponse += chunk.content
            onDelta?.(fullResponse)
            options?.onEvent?.({ type: 'text', text: fullResponse })
            armTimeout()
          }
        }
      } else {
        mergeToolCalls(toolCalls, normalizeToolCalls(result))
        const response = collectContent(result)
        if (response) {
          fullResponse = response
          onDelta?.(fullResponse)
          options?.onEvent?.({ type: 'text', text: fullResponse })
        }
      }

      toolCalls = finalizeToolCalls(toolCalls)

      if (!toolCalls.length || !options?.executeTool) {
        return fullResponse.trim()
      }

      input.messages.push({
        role: 'assistant',
        content: fullResponse || '',
        tool_calls: toolCalls,
      })

      for (const tc of toolCalls) {
        throwIfStopped()
        const call: ModelToolCall = {
          id: tc.id || `tool-${Date.now()}`,
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || '',
        }
        options.onEvent?.({
          type: 'tool_start',
          id: call.id,
          name: call.name,
          arguments: call.arguments,
        })
        let toolResult = ''
        let toolError: string | undefined
        try {
          toolResult = await options.executeTool(call)
        } catch (error) {
          toolError = error instanceof Error ? error.message : String(error)
          toolResult = `Error: ${toolError}`
        }
        options.onEvent?.({
          type: 'tool_end',
          id: call.id,
          name: call.name,
          result: toolResult,
          error: toolError,
        })
        input.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          name: call.name,
          content: toolResult,
        })
        armTimeout()
      }

      fullResponse = ''
      onDelta?.('')
      options?.onEvent?.({ type: 'text', text: '' })
    }

    throw new Error('工具调用次数过多，已停止')
  } catch (error) {
    if (options?.signal?.aborted || isModelStopped(error)) {
      throw new ModelStoppedError()
    }
    throw formatRunnerError(error)
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}
