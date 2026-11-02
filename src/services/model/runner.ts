import { validateToolCall } from '../agent/core/tools'
import { createBuiltinProvider } from './providers'
import { secureFetch } from '../security/secureFetch'
import { redactNative } from '../security/secureStore'
import { redactObject, redactText } from '../security/secretRedaction'
import { resolveExecutableModelJsCode, resolveRuntimeModelId } from './protocol'
import { modelConfigManager, modelHasVision, type AIModel } from './config'
import { settingsManager } from '../app/settings'
import { logAgentDebug } from '../agent/debugLog'
import { takeToolImages, visionAttachParts } from './toolImages'
import { mergeToolArgs, mergeToolCalls } from './toolCallMerge'
import { estimateRequestTextTokens, compactAgentRequestMessages } from './agentRequestContext'
import { resolveContextBudget, estimateContextTokens, ContextCapacityError } from './contextBudget'
import { compactExecutionContext, isContextOverflow, isPinnedContextMessage } from './contextCompaction'
import { SUMMARY_SYSTEM, summarizeRecord } from './contextSummary'
import { redactReplayMessages, replayAsBackground, thinkingBlocksOf, type ThinkingBlock } from './replayState'

export interface ModelToolCall {
  id: string
  name: string
  arguments: string
}

export type ModelRunEvent =
  | { type: 'round_start' }
  | { type: 'request'; inputTokens: number }
  | { type: 'usage'; outputTokens: number }
  | { type: 'context_compacted'; beforeTokens: number; afterTokens: number }
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
  /** Internal archive requests never recursively compact themselves. */
  contextSummaryOnly?: boolean
  outputTokenLimit?: number
  /** A summary belongs to the same model as the ongoing run. */
  contextModel?: AIModel
  validateTools?: boolean
  beforeComplete?: (remainingRounds: number) => string | undefined | Promise<string | undefined>
  compactBrowserContext?: boolean
  timeoutMs?: number
  tools?: any[]
  systemPrompt?: string
  history?: Array<{
    role: string
    content?: unknown
    name?: string
    tool_call_id?: string
    tool_calls?: unknown[]
  }>
  userContent?: unknown
  maxRounds?: number
  useAgentModel?: boolean
  useVisionModel?: boolean
  signal?: AbortSignal
  /** 每轮发给模型前刷新（浏览器图谱/解析器等），返回文本会写入独立 system 消息 */
  liveContext?: () => string | Promise<string>
  /** 每轮发给模型前按当前页刷新工具列表（进学习通后再挂上 study_*） */
  liveTools?: () => any[] | Promise<any[]>
  executeTool?: (call: ModelToolCall) => Promise<string>
  /** 宿主等待视频等外部事件时暂停响应超时；用户接管仍直接终止任务。 */
  subscribePause?: (changed: (paused: boolean) => void) => () => void
  onEvent?: (event: ModelRunEvent) => void
  /** 本轮追加的 assistant / tool 消息，供跨轮按回合回放 */
  onTurnTranscript?: (messages: import('../agent/chatTypes').AgentTranscriptItem[]) => void
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
    return new Error('模型请求中断或超时，本次响应未完成。请检查连接或模型服务状态后重试。')
  }
  if (/Repetitive tool calls|相同参数|infinite loops/i.test(message)) {
    return new Error('模型重复调用了同一个工具，已中止。请再试一次，或换个说法继续。')
  }
  if (/error sending request for url/i.test(message)) {
    return new Error(
      `模型接口网络请求失败（连接被中断或暂时不可达，已自动重试）。${message}`,
    )
  }
  return error instanceof Error ? error : new Error(message)
}

const SINGLETON_TOOLS = new Set(['get_file_info', 'list_folders'])
const REPEAT_NUDGE = '相同的只读查询已经执行过。先使用已有结果，根据用户目标选择下一步；需要更新信息时调整查询范围。只有确实缺少必要信息、权限或遇到阻塞时才向用户说明，不能凭空扩大操作范围。'

const toolExecutionLock = (name: string) => {
  if (name.startsWith('browser_')) return 'browser'
  if (name === 'write_agent_skill_file' || name === 'reset_agent_skill_file') return 'skill-write'
  return ''
}
const LIVE_CONTEXT_MARK = '\u200B【实时网页状态】'
/** 传输层失败时最多再试几次（不含首次）。cheaptokens 等网关常偶发 reset。 */
const MAX_NETWORK_RETRIES = 10
const MAX_STREAM_NETWORK_RETRIES = 2

const waitMs = (ms: number) => new Promise<void>((resolve) => {
  setTimeout(resolve, ms)
})

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error))

const isRetryableNetworkError = (error: unknown, aborted: boolean) => {
  if (aborted || isModelStopped(error)) return false
  const message = errorText(error)
  const name = error instanceof Error ? error.name : ''
  if (name === 'AbortError' || name === 'TimeoutError') return false
  if (/已终止对话|Request canceled|Request cancelled|模型响应超时|模型请求中断/i.test(message)) return false
  return /error sending request|failed to fetch|network|connection|reset|broken pipe|timed out|timeout|dns|tls|ssl|eof|closed before|temporarily|unavailable|hyper_util|reqwest|ConnectError|SendRequest/i.test(message)
}

export const isRetryableHttpStatus = (status: number) => (
  status === 408 || status === 425 || status === 429
  || status === 500 || status === 502 || status === 503 || status === 504 || status === 524
)

const networkBackoffMs = (attempt: number) => {
  const base = Math.min(8000, 400 * (2 ** Math.min(attempt, 4)))
  return base + Math.floor(Math.random() * 300)
}

const resolveNetworkRetries = () => MAX_NETWORK_RETRIES

const applyLiveContext = async (
  messages: any[],
  liveContext?: () => string | Promise<string>,
) => {
  if (!liveContext) return
  const text = String(await liveContext() || '').trim()
  if (!text) return
  const content = `${LIVE_CONTEXT_MARK}\n${text}`
  const idx = messages.findIndex((item) => (
    item?.role === 'system' && String(item.content || '').startsWith(LIVE_CONTEXT_MARK)
  ))
  if (idx >= 0) {
    messages.splice(idx, 1)
  }
  // 动态网页状态放在尾部，避免每轮改写长历史前面的缓存前缀。
  messages.push({ role: 'system', content })
}

const sortJson = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(sortJson)
  if (value && typeof value === 'object') {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortJson((value as Record<string, unknown>)[key])
        return acc
      }, {})
  }
  return value
}

const toolSignature = (name: string, raw: string) => {
  const args = String(raw || '').trim()
  try {
    return `${name}:${JSON.stringify(sortJson(JSON.parse(args || '{}')))}`
  } catch {
    return `${name}:${args.replace(/\s+/g, '')}`
  }
}

const isRepetitiveToolError = (error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  return /Repetitive tool calls|相同参数|infinite loops/i.test(message)
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
    dup.function.arguments = mergeToolArgs(dup.function.arguments || '', tc.function?.arguments || '', 'snapshot')
  }
  return result
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
  const pickVisionModel = () => {
    const vision = modelConfigManager.getSelectedVisionModel()
    if (vision) return vision
    const agent = modelConfigManager.getSelectedAgentModel()
    if (agent && modelHasVision(agent)) return agent
    const text = modelConfigManager.getSelectedTextModel()
    if (text && modelHasVision(text)) return text
    return agent || text || modelConfigManager.getSelectedModel()
  }
  await modelConfigManager.ready
  const selectedModel = options?.contextModel || (options?.useVisionModel
    ? pickVisionModel()
    : options?.useAgentModel
      ? (modelConfigManager.getSelectedAgentModel() || modelConfigManager.getSelectedTextModel())
      : (modelConfigManager.getSelectedTextModel() || modelConfigManager.getSelectedModel()))
  // Archive requests have a small output budget and perform no reasoning task.
  // Clone rather than mutating the selected model or the main Agent's settings.
  const model = selectedModel && options?.contextSummaryOnly
    ? { ...selectedModel, enableThinking: false } : selectedModel
  if (!model) {
    throw new Error(
      options?.useVisionModel
        ? '请先在模型设置里选择一个能看图的模型'
        : options?.useAgentModel
          ? '请先在模型设置的 agent 里选择一个模型'
          : '请先在设置里选择一个文本模型',
    )
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

  const inputHasImage = Array.isArray(options?.userContent) && options.userContent.some((part: any) => part?.type === 'image_url')
  if (inputHasImage && !modelHasVision(model)) throw new Error('当前模型未配置视觉能力，图片未发送。请在模型设置选择支持视觉的模型后重试。')
  if (options?.tools?.length && model.supportsTools === false) throw new Error('当前模型不支持工具调用，请选择支持工具的 Agent 模型。')
  const runtimeModelId = resolveRuntimeModelId(model)
  const executableCode = resolveExecutableModelJsCode(model, platform)
  if (!executableCode) {
    throw new Error('当前模型没有可用的调用配置')
  }

  const messages: any[] = []
  if (options?.systemPrompt) {
    messages.push({ role: 'system', content: options.systemPrompt })
  }
  // Project old tool payloads while they still have tool roles. Background
  // replay must not turn them into unbounded, apparently user-authored text.
  const projectedHistory = options?.compactBrowserContext
    ? compactAgentRequestMessages(options?.history || [], new Set(), resolveContextBudget(model).target)
    : options?.history || []
  const priorHistory = model.enableThinking || model.apiProtocol === 'anthropic' || platform.apiProtocol === 'anthropic'
    ? replayAsBackground(projectedHistory) : projectedHistory
  for (const item of priorHistory) {
    if (item.role === 'tool') {
      messages.push({
        role: 'tool',
        tool_call_id: item.tool_call_id,
        name: item.name,
        content: item.content ?? '',
      })
      continue
    }
    if (item.role === 'assistant') {
      const toolCalls = Array.isArray(item.tool_calls) ? item.tool_calls : []
      const content = item.content ?? ''
      if (!toolCalls.length && (content === '' || content == null)) continue
      messages.push({
        role: 'assistant',
        content,
        ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
      })
      continue
    }
    if (item.role === 'user' && item.content) {
      messages.push({ role: 'user', content: item.content,
        ...((item as any).__agentHistory ? { __agentHistory: true } : {}),
      })
    }
  }
  messages.push({ role: 'user', content: options?.userContent ?? prompt })
  let transcriptFrom = messages.length
  const toolImageMessages = new Set<any>()

  const emitTurnTranscript = (spoken: string) => {
    const turn: NonNullable<RunTextModelOptions['history']> = input.messages
      .slice(transcriptFrom)
      .filter((item) => item?.role === 'assistant' || item?.role === 'tool')
      .map((item) => ({
        role: String(item.role),
        content: item.content,
        name: item.name,
        tool_call_id: item.tool_call_id,
        tool_calls: item.tool_calls,
      }))
    const text = String(spoken || '').trim()
    if (text && !turn.some((item) => item.role === 'assistant' && !item.tool_calls?.length && item.content === text)) {
      turn.push({ role: 'assistant', content: text })
    }
    if (turn.length) options?.onTurnTranscript?.(redactObject(turn) as import('../agent/chatTypes').AgentTranscriptItem[])
    transcriptFrom = input.messages.length
  }

  const input: any = {
    messages,
    model: runtimeModelId,
    stream: true,
    tools: options?.tools || [],
  }
  const redactMessages = (items: any[]) => redactReplayMessages(items, value => redactNative(redactObject(value)))
  const config = {
    ...model,
    apiKey: platform.apiKey,
    customHeaders: platform.customHeaders,
    baseUrl: platform.baseUrl,
    model: runtimeModelId,
    modelId: runtimeModelId,
  }
  if (options?.outputTokenLimit) config.maxTokens = Math.min(Number(config.maxTokens) || options.outputTokenLimit, options.outputTokenLimit)
  const contextBudget = resolveContextBudget(config)
  config.maxTokens = contextBudget.outputReserve

  const configuredMs = Number(settingsManager.get('modelResponseTimeout') ?? 40) * 1000
  // 调用方显式给了超时就照用（视觉转写等短任务不能被 180s 下限拖死）
  const timeoutMs = options?.timeoutMs
    ? Math.max(options.timeoutMs, 5000)
    : Math.max(configuredMs > 0 ? configuredMs : 40000, 180000)
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
  let suspended = false
  const armTimeout = () => {
    if (timeoutHandle) clearTimeout(timeoutHandle)
    if (suspended) { timeoutHandle = null; return }
    timeoutHandle = setTimeout(() => {
      abortController.abort(new DOMException(`模型响应超时（${Math.round(timeoutMs / 1000)} 秒）`, 'TimeoutError'))
    }, timeoutMs)
  }
  armTimeout()
  let stopPause: (() => void) | undefined
  throwIfStopped()


  const networkRetries = resolveNetworkRetries()
  let requestReturnedResponse = false
  const tauriFetch = async (request: RequestInfo | URL, init: RequestInit = {}) => {
    let lastError: unknown
    for (let attempt = 0; attempt <= networkRetries; attempt += 1) {
      throwIfStopped()
      try {
        if (attempt > 0) options?.onEvent?.({ type: 'request', inputTokens: requestTokens })
        const response = await secureFetch(request as any, {
          ...init,
          // 连接阶段单独加长；默认过短时 CDN 抖一下就会 “error sending request”
          connectTimeout: typeof (init as { connectTimeout?: number }).connectTimeout === 'number'
            ? (init as { connectTimeout?: number }).connectTimeout
            : 30_000,
          credentials: init.credentials ?? 'include',
          signal: init.signal ?? abortController.signal,
        } as any)
        if (
          response
          && isRetryableHttpStatus(response.status)
          && attempt < networkRetries
        ) {
          logModelIo({
            kind: 'fetch_retry',
            hop: attempt + 1,
            retries: networkRetries,
            status: response.status,
            url: String(typeof request === 'string' ? request : (request as Request).url || request),
          })
          await waitMs(networkBackoffMs(attempt))
          continue
        }
        requestReturnedResponse = true
        return response
      } catch (error) {
        lastError = error
        if (!isRetryableNetworkError(error, abortController.signal.aborted) || attempt >= networkRetries) {
          throw error
        }
        logModelIo({
          kind: 'fetch_retry',
          hop: attempt + 1,
          retries: networkRetries,
          error: errorText(error),
          url: String(typeof request === 'string' ? request : (request as Request).url || request),
        })
        await waitMs(networkBackoffMs(attempt))
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError || '模型网络请求失败'))
  }

  let requestTokens = 0
  let processModel: any = createBuiltinProvider(model, platform)
  if (!processModel && (executableCode.startsWith('async function') || executableCode.startsWith('function'))) {
    const loadCustomProvider = new Function('input', 'config', 'fetch', 'abortSignal', `
      ${executableCode}
      return processModel;
    `)
    processModel = loadCustomProvider(input, config, tauriFetch, abortController.signal)
  } else if (!processModel) {
    const wrapperFunction = new Function('input', 'config', 'fetch', 'abortSignal', `
      return (async function processModel(input, config) {
        ${executableCode}
      });
    `)
    processModel = wrapperFunction(input, config, tauriFetch, abortController.signal)
  }

  const maxRounds = Math.max(1, options?.maxRounds ?? 1)
  let fullResponse = ''
  const seenToolCalls = new Set<string>()
  let toolsSnapshot = Array.isArray(input.tools) ? input.tools : []
  let gatewayRepeatHits = 0

  // 开发模式把每轮发给模型的原始 messages / 回复落盘，方便排查 agent 行为
  const ioSafeMessages = (list: any[]) => list.map((item) => {
    const body = typeof item?.content === 'string' ? item.content : JSON.stringify(item?.content ?? '')
    const cut = String(body || '')
      .replace(/data:image\/[A-Za-z0-9+/=;,._-]+/g, (s) => `[图 ${s.length}b]`)
    return {
      role: item?.role,
      name: item?.name,
      tool_calls: Array.isArray(item?.tool_calls)
        ? item.tool_calls.map((tc: any) => ({ name: tc?.function?.name, args: String(tc?.function?.arguments || '').slice(0, 600) }))
        : undefined,
      content: cut.length > 4000 ? `${cut.slice(0, 4000)}…(${cut.length})` : cut,
    }
  })
  const logModelIo = (entry: Record<string, unknown>) => {
    try {
      logAgentDebug('model-io', { label: prompt.slice(0, 60), model: runtimeModelId, ...entry })
    } catch { /* 日志失败不影响主流程 */ }
  }

  try {
    stopPause = options?.subscribePause?.(paused => { suspended = paused; armTimeout() })
    let compactions = 0
    let overflowRecovered = false
    let softCompactionUnavailable = false
    let nextSoftCompactionAt = 0
    const maintainContext = async (force = false) => {
      const project = (messages = input.messages) => {
        const projected = options?.compactBrowserContext
          ? compactAgentRequestMessages(messages, toolImageMessages, contextBudget.target) : messages
        return { ...input, messages: projected.map(({ __agentToolImage, __agentHistory, ...message }: any) => message) }
      }
      let request = project()
      const beforeTokens = estimateContextTokens(request)
      // Tools and pinned instructions cannot be summarised away. Leave useful
      // history headroom above that floor instead of repeatedly summarising a
      // few observations when the browser tool catalog itself is already large.
      const instructionTokens = estimateContextTokens({ ...input, messages: input.messages.filter(isPinnedContextMessage) })
      const compactAt = Math.min(contextBudget.inputLimit, Math.max(contextBudget.compactAt, instructionTokens + Math.floor(contextBudget.target / 2)))
      if ((force || (!softCompactionUnavailable && beforeTokens > Math.max(compactAt, nextSoftCompactionAt))) && !options?.contextSummaryOnly && (options?.executeTool || options?.compactBrowserContext)) {
        if (++compactions > 12) throw new Error('上下文反复压缩仍无法继续，已保留执行记录并停止。请缩小任务范围。')
        emitTurnTranscript('')
        let compacted: any[]
        try {
          compacted = await compactExecutionContext({ messages: input.messages, keepTokens: Math.floor(contextBudget.target * (force ? 0.3 : 0.5)),
          summarize: (text, previous) => summarizeRecord({ text, previous, signal: abortController.signal,
            chunkTokens: Math.max(512, Math.min(8000, Math.floor(contextBudget.inputLimit * 0.45))),
            summarize: prompt => runTextModel(prompt, undefined, { systemPrompt: SUMMARY_SYSTEM, tools: [], maxRounds: 1,
              contextSummaryOnly: true, contextModel: model, outputTokenLimit: Math.min(4096, contextBudget.outputReserve), timeoutMs,
              useAgentModel: options?.useAgentModel, useVisionModel: options?.useVisionModel, signal: abortController.signal,
              onEvent: event => { if (event.type === 'request' || event.type === 'usage') options?.onEvent?.(event) },
            }),
          }),
          })
        } catch (error) {
          throwIfStopped()
          // A token-saving summary must not terminate a task whose complete
          // request still fits. Keep the original records and defer further
          // soft attempts; hard overflow still requires successful compaction.
          if (!force && beforeTokens <= contextBudget.inputLimit && error instanceof Error && error.name === 'ModelOutputLimitError') {
            softCompactionUnavailable = true
            compactions--
            logModelIo({ kind: 'context_compaction_deferred', beforeTokens })
            return request
          }
          throw error
        }
        throwIfStopped()
        if (compacted === input.messages) {
          compactions--
          if (force || beforeTokens > contextBudget.inputLimit) throw new ContextCapacityError()
          return request
        }
        const clean = await redactMessages(compacted)
        const next = project(clean)
        const afterTokens = estimateContextTokens(next)
        if (afterTokens >= beforeTokens || afterTokens > contextBudget.inputLimit) throw new ContextCapacityError()
        input.messages = clean
        transcriptFrom = input.messages.length
        request = next
        // The retained latest batch may itself be large. Require meaningful
        // growth above the actual post-compaction size, not just above the
        // original soft threshold; the hard check below remains unconditional.
        nextSoftCompactionAt = Math.min(contextBudget.inputLimit, afterTokens + Math.max(512, Math.floor(contextBudget.target / 2)))
        options?.onEvent?.({ type: 'context_compacted', beforeTokens, afterTokens })
      }
      if (estimateContextTokens(request) > contextBudget.inputLimit) throw new ContextCapacityError()
      return request
    }
    for (let round = 0; round < maxRounds; round += 1) {
      throwIfStopped()
      armTimeout()
      fullResponse = ''
      onDelta?.('')
      if (options?.liveTools) {
        const nextTools = await options.liveTools()
        if (Array.isArray(nextTools) && nextTools.length) {
          input.tools = nextTools
          toolsSnapshot = nextTools
        }
      }
      await applyLiveContext(input.messages, options?.liveContext)
      input.messages = await redactMessages(input.messages)
      options?.onEvent?.({ type: 'round_start' })
      const requestInput = await maintainContext()
      logModelIo({ kind: 'model_request', round, messages: ioSafeMessages(requestInput.messages) })
      requestTokens = estimateContextTokens(requestInput)
      options?.onEvent?.({ type: 'request', inputTokens: requestTokens })
      let result: any
      let responseRetries = 0
      const retryResponse = async () => {
        await waitMs(networkBackoffMs(responseRetries++))
        throwIfStopped()
        options?.onEvent?.({ type: 'request', inputTokens: requestTokens })
      }
      const requestModel = async () => {
        for (;;) {
          requestReturnedResponse = false
          try {
            return await processModel(requestInput, config, tauriFetch, abortController.signal)
          } catch (error) {
            // Some gateways return JSON or buffer the body before exposing a
            // stream. Retry body-read failures too, but never multiply the
            // fetch connection retries after no response was received.
            if (!requestReturnedResponse || responseRetries >= MAX_STREAM_NETWORK_RETRIES
              || !isRetryableNetworkError(error, abortController.signal.aborted)) throw error
            await retryResponse()
          }
        }
      }
      try {
        result = await requestModel()
      } catch (error) {
        if (!overflowRecovered && !options?.contextSummaryOnly && (options?.executeTool || options?.compactBrowserContext) && isContextOverflow(error)) {
          overflowRecovered = true
          await maintainContext(true)
          continue
        }
        if (isRepetitiveToolError(error) && gatewayRepeatHits < 2) {
          gatewayRepeatHits += 1
          input.tools = toolsSnapshot
          input.messages.push({ role: 'system', content: REPEAT_NUDGE })
          continue
        }
        throw error
      }
      throwIfStopped()
      if (!result) {
        throw new Error('模型没有返回结果')
      }

      let toolCalls: any[] = []
      let toolPendingSent = false
      let roundUsage: Record<string, unknown> | undefined
      let reasoning = ''
      let thinkingBlocks: ThinkingBlock[] = []
      const reportRoundUsage = () => options?.onEvent?.({ type: 'usage', outputTokens: Number(roundUsage?.output_tokens ?? roundUsage?.completion_tokens)
        || estimateRequestTextTokens(fullResponse + reasoning + (toolCalls.length ? JSON.stringify(toolCalls) : '')) })
      for (;;) {
        const streamed = Boolean(result?.[Symbol.asyncIterator])
        try {
          if (!result) throw new Error('模型没有返回结果')
          if (result[Symbol.asyncIterator]) {
            for await (const chunk of result) {
              throwIfStopped()
              if (chunk?.usage && typeof chunk.usage === 'object') roundUsage = { ...roundUsage, ...chunk.usage }
              if (typeof chunk?.reasoning_content === 'string') { reasoning += chunk.reasoning_content; armTimeout() }
              if (Array.isArray(chunk?.thinking_blocks)) thinkingBlocks = thinkingBlocksOf(chunk.thinking_blocks)
              if (chunk?.tool_calls) {
                mergeToolCalls(toolCalls, chunk.tool_calls, 'delta')
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
            if (result?.usage && typeof result.usage === 'object') roundUsage = result.usage
            reasoning = typeof result?.reasoning_content === 'string' ? result.reasoning_content : ''
            thinkingBlocks = thinkingBlocksOf(result?.thinking_blocks)
            mergeToolCalls(toolCalls, normalizeToolCalls(result), 'snapshot')
            const response = collectContent(result)
            if (response) {
              fullResponse = response
              onDelta?.(fullResponse)
              options?.onEvent?.({ type: 'text', text: fullResponse })
            }
          }
          break
        } catch (error) {
          // Completed previous tool batches remain in requestInput. No tool
          // from this response has been dispatched until consumption finishes.
          // Retry only transport failures before visible text, never truncated
          // JSON, provider filtering, cancellation or an already shown answer.
          reportRoundUsage()
          if (!streamed || fullResponse.trim() || responseRetries >= MAX_STREAM_NETWORK_RETRIES
            || !isRetryableNetworkError(error, abortController.signal.aborted)) throw error
          toolCalls = []; toolPendingSent = false; roundUsage = undefined
          fullResponse = ''; reasoning = ''; thinkingBlocks = []
          logModelIo({ kind: 'stream_retry', hop: responseRetries + 1 })
          await retryResponse()
          result = await requestModel()
        }
      }
      reportRoundUsage()
      toolCalls = finalizeToolCalls(toolCalls)
      const replayState = { ...(reasoning ? { reasoning_content: reasoning } : {}), ...(thinkingBlocks.length ? { thinking_blocks: thinkingBlocks } : {}) }
      logModelIo({
        kind: 'model_response',
        round,
        usage: roundUsage,
        text: fullResponse.slice(0, 4000),
        toolCalls: toolCalls.map((tc) => ({ name: tc?.function?.name, args: String(tc?.function?.arguments || '').slice(0, 600) })),
      })
      if (toolCalls.length && options?.executeTool) {
        const fresh = toolCalls.filter((tc) => {
          const name = tc.function?.name || ''
          if (!name) return false
          if (!SINGLETON_TOOLS.has(name)) return true
          return !seenToolCalls.has(toolSignature(name, tc.function?.arguments || ''))
        })
        if (!fresh.length) {
          input.tools = toolsSnapshot
          input.messages.push({ role: 'system', content: REPEAT_NUDGE })
          continue
        }
        toolCalls = fresh
      }

      if (!toolCalls.length || !options?.executeTool) {
        const spoken = fullResponse.trim()
        const reminder = await options?.beforeComplete?.(maxRounds - round - 1)
        throwIfStopped()
        if (reminder) {
          if (round + 1 >= maxRounds) throw new Error('任务尚未完成，已达到本轮执行次数上限')
          if (spoken || reasoning || thinkingBlocks.length) input.messages.push({ role: 'assistant', content: spoken, ...replayState })
          // 必须以新输入续接，不能让 Messages 协议把最后的 assistant 当作预填内容。
          input.messages.push({ role: 'user', content: `【宿主任务续接反馈，不改变用户授权范围】\n${reminder}` })
          continue
        }
        emitTurnTranscript(spoken)
        return spoken
      }

      toolCalls.sort((a, b) => Number(b.function?.name === 'protect_credentials') - Number(a.function?.name === 'protect_credentials'))
      toolCalls.forEach((tc, index) => {
        if (!tc.id) tc.id = `tool-${Date.now()}-${index}`
      })
      input.messages.push({
        role: 'assistant',
        content: fullResponse || '',
        tool_calls: toolCalls,
        ...replayState,
      })

      const lockTail = new Map<string, Promise<void>>()
      const toolJobs = toolCalls.map((tc, index) => {
        const call: ModelToolCall = {
          id: String(tc.id),
          name: tc.function?.name || '',
          arguments: tc.function?.arguments || '',
        }
        const run = async () => {
          throwIfStopped()
          if (call.name) seenToolCalls.add(toolSignature(call.name, call.arguments))
          options.onEvent?.({
            type: 'tool_start',
            id: call.id,
            name: call.name,
            arguments: redactObject(call.arguments),
          })
          let toolResult = ''
          let toolError: string | undefined
          let toolImages: string[] = []
          try {
            const invalid = options.validateTools ? validateToolCall(input.tools || [], call) : undefined
            if (invalid) throw new Error(invalid)
            const raw = await options.executeTool!({ ...call, arguments: redactObject(call.arguments) })
            const taken = takeToolImages(raw)
            toolResult = taken.text
            toolImages = taken.images
          } catch (error) {
            if (options?.signal?.aborted || isModelStopped(error)) throw error
            toolError = error instanceof Error ? error.message : String(error)
            toolResult = `Error: ${toolError}`
          }
          throwIfStopped()
          options.onEvent?.({
            type: 'tool_end',
            id: call.id,
            name: call.name,
            result: toolResult,
            error: toolError,
          })
          armTimeout()
          return { index, call, toolResult, toolImages }
        }
        const lock = toolCalls.some(tc => tc.function?.name === 'protect_credentials') ? 'credential-registration' : toolExecutionLock(call.name)
        if (!lock) return run()
        const prev = lockTail.get(lock) || Promise.resolve()
        const curr = prev.then(run, run)
        lockTail.set(lock, curr.then(() => undefined, () => undefined))
        return curr
      })
      const finished = await Promise.all(toolJobs)
      input.messages = await redactMessages(input.messages)
      fullResponse = redactText(fullResponse)
      const visionOk = modelHasVision(model)
      const attached: string[] = []
      finished
        .sort((left, right) => left.index - right.index)
        .forEach((item) => {
          const noVision = Boolean(item.toolImages?.length) && !visionOk
          input.messages.push({
            role: 'tool',
            tool_call_id: item.call.id,
            name: item.call.name,
            content: noVision
              ? `${item.toolResult}\n${item.call.name === 'browser_decode_chaoxing_font' ? '当前 Agent 模型不能看图，请切换支持视觉的 Agent 模型后重试，不能猜测混淆文字。' : '当前 Agent 模型不能看图，请用 get_page 读结构。'}`
              : item.toolResult,
          })
          if (visionOk) {
            for (const image of item.toolImages || []) {
              if (image.startsWith('data:image/') && image.length < 2_500_000) attached.push(image)
            }
          }
        })
      if (attached.length) {
        const imageMessage = {
          role: 'user',
          content: visionAttachParts(attached),
          __agentToolImage: true,
        }
        input.messages.push(imageMessage)
        toolImageMessages.add(imageMessage)
      }

      emitTurnTranscript('')
      fullResponse = ''
      onDelta?.('')
      options?.onEvent?.({ type: 'text', text: '' })
    }

    throw new Error('工具调用次数过多，已停止')
  } catch (error) {
    logModelIo({ kind: 'model_error', error: error instanceof Error ? error.message : String(error) })
    if (options?.signal?.aborted || isModelStopped(error)) {
      throw new ModelStoppedError()
    }
    throw formatRunnerError(error)
  } finally {
    stopPause?.()
    if (timeoutHandle) clearTimeout(timeoutHandle)
  }
}
