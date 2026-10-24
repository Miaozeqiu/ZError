/** 组 prompt + runTextModel + executeChatTool。父入口和子 Agent 共用。 */
import type { ImportStepPreview } from '../../app/importTasks'
import { emitStudyGraphStream } from '../../study/graphStream'
import { collectGraphNodes, extractMermaidSource } from '../../../utils/study/studyGraph'
import { getQuizCards, parseQuizCards, resolveQuizTitle, saveQuizTitle } from '../../../utils/question/quizPractice'
import { describeActivity } from '../activity'
import type { AgentChatMessage } from '../chatTypes'
import type { AgentToolRole } from '../toolContext'
import {
  addChildStep,
  addStep,
  liveSession,
  patchChildStep,
  patchMessage,
  patchSession,
  patchStep,
  sessionAttachment,
  sessionFolders,
  sessions,
  setChatStudySubject,
} from '../chatStore'
import { clipAgentDebug, logAgentDebug } from '../debugLog'
import { executeChatTool } from '../executeChatTool'
import { parseQuestions } from '../import'
import { TOOL_ARGS_KEEP, TOOL_RESULT_KEEP, clipToolText, clipTranscript } from '../modelHistory'
import { isModelStopped, runTextModel, type ModelToolCall, type RunTextModelOptions } from '../../model/runner'
import { parseToolArgs } from '../toolArgs'
import { scheduleStudyProgressEval } from '../chatStudy'
import { createBrowserControlGate } from '../browserControlGate'
import { createLearningCompletionCheck } from '../siteLearningReview'
import { peekAppBrowserUrl } from '../../browser/appBrowser'

export type RunAgentTurnLoopInput = {
  sessionId: string
  assistantId: string
  abort: AbortController
  modelPrompt: string
  userContent?: unknown
  history?: RunTextModelOptions['history']
  systemPrompt: string
  tools: unknown[]
  liveTools?: () => unknown[] | Promise<unknown[]>
  liveContext?: () => string | Promise<string>
  maxRounds: number
  timeoutMs: number
  isBrowserChat: boolean
  role?: AgentToolRole
  parentSessionId?: string
  parentAssistantId?: string
  parentStepId?: string
  jobId?: string
  streamSubjectId?: number
  onDrawingGraph?: () => void
}

export type RunAgentTurnLoopResult = {
  text: string
  aborted: boolean
  failed?: string
}

export const runAgentTurnLoop = async (input: RunAgentTurnLoopInput): Promise<RunAgentTurnLoopResult> => {
  const {
    sessionId,
    assistantId,
    abort,
    modelPrompt,
    userContent,
    history,
    systemPrompt,
    tools,
    liveTools,
    liveContext,
    maxRounds,
    timeoutMs,
    isBrowserChat,
    role = 'parent',
    parentSessionId,
    parentAssistantId,
    parentStepId,
    jobId,
    streamSubjectId,
    onDrawingGraph,
  } = input

  const controlGate = createBrowserControlGate(parentSessionId || sessionId, abort.signal)
  const debug = (entry: Record<string, unknown>) =>
    logAgentDebug(parentSessionId || sessionId, { kind: isBrowserChat ? 'browser' : 'study', ...entry })

  const liveMessage = () =>
    sessions.value.find((item) => item.id === sessionId)
      ?.messages.find((message) => message.id === assistantId)
  const learningCheck = createLearningCompletionCheck(() => {
    const session = liveSession(sessionId)
    const steps = liveMessage()?.steps || []
    const todos = session?.todos || []
    return {
      url: peekAppBrowserUrl(session?.browserId || ''), steps,
      enabled: role === 'parent' && !abort.signal.aborted,
      ready: (todos.some(item => item.status === 'done') && todos.every(item => item.status !== 'pending'))
        || steps.some(step => step.name === 'browser_finish' && parseToolArgs(step.result || '').learningRequired === true),
    }
  })
  const visibleText = (text?: string) => Boolean(String(text || '').replace(/\u200B/g, '').trim())
  const stripMarks = (text: string) => String(text || '').replace(/\u200B/g, '')
  let awaitingTool = false
  let spokenText = ''
  let roundBase = ''
  const liveContent = () => stripMarks(liveMessage()?.content || '')
  const joinRound = (text: string) => {
    const piece = stripMarks(text)
    const base = stripMarks(roundBase || spokenText || liveContent())
    if (!piece.trim()) return base
    if (!base.trim()) return piece
    if (piece === base || piece.startsWith(base)) return piece
    if (base.startsWith(piece)) return base
    const parts = base.split(/\n\n+/)
    const last = parts[parts.length - 1] || ''
    if (last && (piece === last || piece.startsWith(last))) {
      return [...parts.slice(0, -1), piece].join('\n\n')
    }
    if (last && last.startsWith(piece)) return base
    return `${base}\n\n${piece}`
  }
  const keepSpoken = () => {
    const current = liveContent().trim()
    if (current) spokenText = current
  }
  const beginRound = () => {
    keepSpoken()
    roundBase = spokenText || liveContent()
  }
  let streamPaint = 0
  let streamHold: Partial<AgentChatMessage> | null = null
  const flushStreamHold = () => {
    if (streamPaint) {
      window.cancelAnimationFrame(streamPaint)
      streamPaint = 0
    }
    if (!streamHold) return
    const hold = streamHold
    streamHold = null
    if (abort.signal.aborted || liveMessage()?.status !== 'streaming') return
    patchMessage(sessionId, assistantId, hold)
  }
  const streamPatch = (patch: Partial<AgentChatMessage>) => {
    streamHold = { ...streamHold, ...patch }
    if (streamPaint) return
    streamPaint = window.requestAnimationFrame(() => {
      streamPaint = 0
      flushStreamHold()
    })
  }
  const streamText = (text: string) => {
    const next = joinRound(text)
    if (!stripMarks(text).trim() && visibleText(liveContent())) {
      streamPatch({ waiting: awaitingTool, status: 'streaming' })
      return
    }
    if (next === spokenText && next === liveContent()) {
      streamPatch({
        waiting: awaitingTool || !visibleText(next),
        status: 'streaming',
      })
      return
    }
    if (next.trim()) spokenText = next
    streamPatch({
      content: next,
      waiting: awaitingTool || !visibleText(next),
      status: 'streaming',
    })
    const mermaid = extractMermaidSource(next)
    if (mermaid) {
      onDrawingGraph?.()
      emitStudyGraphStream({
        subjectId: Number.isFinite(streamSubjectId) ? streamSubjectId : undefined,
        mermaid,
        streaming: true,
      })
    }
  }
  const waitForFirstToken = (clearContent = false) => {
    if (!clearContent) keepSpoken()
    flushStreamHold()
    patchMessage(sessionId, assistantId, {
      ...(clearContent ? { content: '' } : {}),
      waiting: true,
      status: 'streaming',
    })
  }

  try {
    const finalText = await runTextModel(modelPrompt, (delta) => {
      if (abort.signal.aborted || liveMessage()?.status !== 'streaming') return
      streamText(delta)
    }, {
      timeoutMs,
      compactBrowserContext: isBrowserChat,
      userContent,
      signal: abort.signal,
      tools,
      liveTools,
      systemPrompt,
      useAgentModel: true,
      history,
      maxRounds,
      liveContext: () => controlGate.liveContext(liveContext),
      beforeComplete: learningCheck.beforeComplete,
      onTurnTranscript: (items) => {
        flushStreamHold()
        const prev = liveMessage()?.transcript || []
        patchMessage(sessionId, assistantId, {
          transcript: clipTranscript([...prev, ...items]),
        })
      },
      executeTool: async (call: ModelToolCall) => {
        return controlGate.runTool(call, browserEpoch => executeChatTool({
          call,
          ctx: {
            sessionId,
            assistantId,
            abort: abort.signal,
            browserEpoch,
            role,
            parentSessionId,
            parentAssistantId,
            parentStepId,
            jobId,
            ensureBrowser: async () => {
              const { ensureAgentBrowser } = await import('../agentBrowser')
              const target = parentSessionId || sessionId
              const id = await ensureAgentBrowser(target)
              if (call.name === 'browser_navigate') {
                const url = String(parseToolArgs(call.arguments).url || '')
                if (url) {
                  const { recoverSiteAccountsFromTexts } = await import('../siteAccounts')
                  recoverSiteAccountsFromTexts(
                    (liveSession(target)?.messages || []).filter(message => message.role === 'user').map(message => message.content),
                    url,
                  )
                }
              }
              return id
            },
            browserId: () => String(
              sessions.value.find((item) => item.id === (parentSessionId || sessionId))?.browserId
              || sessions.value.find((item) => item.id === sessionId)?.browserId
              || '',
            ).trim(),
            attachment: () => sessionAttachment(parentSessionId || sessionId),
            folders: () => sessionFolders(parentSessionId || sessionId),
            studySubjectId: () => {
              const id = Number(sessions.value.find((item) => item.id === (parentSessionId || sessionId))?.studySubjectId)
              return Number.isFinite(id) && id > 0 ? id : undefined
            },
            setStudySubject: (subjectId) => setChatStudySubject(subjectId, parentSessionId || sessionId),
            markDrawingGraph: () => { onDrawingGraph?.() },
            scheduleEval: (evalInput) => scheduleStudyProgressEval({
              sessionId: parentSessionId || sessionId,
              messageId: parentAssistantId || assistantId,
              subjectId: evalInput.subjectId,
              hint: evalInput.hint,
              force: true,
              stepId: evalInput.stepId,
            }),
            getTodos: () => sessions.value.find((item) => item.id === (parentSessionId || sessionId))?.todos
              || liveMessage()?.todos
              || [],
            setTodos: (todos) => {
              const target = parentSessionId || sessionId
              const messageId = parentAssistantId || assistantId
              patchSession(target, (session) => ({ ...session, todos, updatedAt: Date.now() }))
              patchMessage(target, messageId, { todos })
            },
          },
        }))
      },
      onEvent: (event) => {
        if (abort.signal.aborted || liveMessage()?.status !== 'streaming') return
        if (event.type === 'round_start') {
          awaitingTool = false
          beginRound()
          waitForFirstToken(false)
          return
        }
        if (event.type === 'text') return
        if (event.type === 'tool_pending') {
          awaitingTool = true
          waitForFirstToken(false)
          return
        }
        if (event.type === 'tool_start') {
          awaitingTool = true
          waitForFirstToken(false)
          const args = parseToolArgs(event.arguments)
          debug({
            type: 'tool_start',
            name: event.name,
            arguments: clipAgentDebug(event.arguments),
            parsed: args,
            nodes: event.name === 'set_knowledge_graph' ? collectGraphNodes(args, event.arguments) : undefined,
          })
          const activity = describeActivity(event.name, args, 'running')
          flushStreamHold()
          const step = {
            id: event.id,
            kind: 'tool' as const,
            name: event.name,
            label: activity.label,
            target: activity.target,
            title: event.name === 'present_quiz' ? resolveQuizTitle(args) : undefined,
            preview: event.name === 'save_questions'
              ? parseQuestions(args.questions) as ImportStepPreview[]
              : event.name === 'present_quiz'
                ? parseQuizCards(args.questions) as ImportStepPreview[]
                : undefined,
            previewCount: event.name === 'save_questions'
              ? parseQuestions(args.questions).length
              : event.name === 'present_quiz'
                ? parseQuizCards(args.questions).length
                : undefined,
            status: 'running' as const,
            startedAt: Date.now(),
            arguments: clipToolText(event.arguments, TOOL_ARGS_KEEP),
            jobId,
          }
          addStep(sessionId, assistantId, step)
          if (parentSessionId && parentAssistantId && parentStepId) {
            addChildStep(parentSessionId, parentAssistantId, parentStepId, step)
          }
          return
        }
        if (event.type === 'tool_end') {
          let extra: any = null
          try {
            extra = JSON.parse(event.result)
          } catch {
            extra = null
          }
          const parsedError = extra && typeof extra === 'object' ? extra.error : null
          const status = event.error || parsedError ? 'failed' : 'done'
          debug({
            type: 'tool_end',
            name: event.name,
            status,
            result: clipAgentDebug(event.result),
            error: event.error || parsedError,
          })
          const activity = describeActivity(event.name, extra, status, extra)
          const quizCards = event.name === 'present_quiz'
            || event.name === 'list_campus_questions'
            || event.name === 'search_campus_questions'
            || event.name === 'save_campus_questions'
            || event.name === 'update_campus_question'
            ? getQuizCards(event.id)
            : []
          const quizTitle = quizCards.length
            ? String(extra?.title || resolveQuizTitle(extra) || '').trim()
            : ''
          if (quizTitle) saveQuizTitle(event.id, quizTitle)
          flushStreamHold()
          const patch = {
            status,
            label: activity.label,
            target: activity.target,
            title: quizTitle || undefined,
            detail: event.error || (typeof parsedError === 'string' ? parsedError : parsedError ? JSON.stringify(parsedError) : undefined),
            result: clipToolText(event.result, TOOL_RESULT_KEEP),
            finishedAt: Date.now(),
            ...(quizCards.length ? {
              preview: quizCards as ImportStepPreview[],
              previewCount: quizCards.length,
            } : {}),
          }
          patchStep(sessionId, assistantId, event.id, patch)
          if (parentSessionId && parentAssistantId && parentStepId) {
            patchChildStep(parentSessionId, parentAssistantId, parentStepId, event.id, patch)
          }
          waitForFirstToken(false)
        }
      },
    })

    if (abort.signal.aborted) {
      return { text: liveContent(), aborted: true }
    }
    const liveNow = liveMessage()?.content || ''
    const assistantContent = visibleText(liveNow)
      ? liveNow
      : joinRound(finalText || '')
    return { text: learningCheck.deferred ? `${assistantContent}\n\n本轮新的站点经验未确认保存到 Skill。` : assistantContent, aborted: false }
  } catch (error) {
    if (abort.signal.aborted || isModelStopped(error)) {
      return { text: liveContent(), aborted: true }
    }
    return {
      text: liveContent(),
      aborted: false,
      failed: error instanceof Error ? error.message : String(error),
    }
  } finally {
    flushStreamHold()
    void liveSession(sessionId)
  }
}
