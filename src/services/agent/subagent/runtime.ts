import { websitePrimaryHost } from '../websiteIdentity'
import { watch } from 'vue'
import { agentApprovalState } from '../agentApproval'
import { createRunController } from '../core/controller'
import { taskStateContext } from '../core/taskContext'
import { newRun } from '../core/run'
import { redactObject, redactText } from '../../security/secretRedaction'
/** 组 prompt + runTextModel + executeChatTool。父入口和子 Agent 共用。 */
import type { ImportStepPreview } from '../../app/importTasks'
import { emitStudyGraphStream } from '../../study/graphStream'
import { collectGraphNodes, extractMermaidSource } from '../../../utils/study/studyGraph'
import { getQuizCards, parseQuizCards, resolveQuizTitle, saveQuizTitle } from '../../../utils/question/quizPractice'
import { describeActivity } from '../activity'
import type { AgentChatMessage } from '../chatTypes'
import type { AgentToolRole } from '../toolContext'
import {
  flushChatCheckpoint,
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
import { TOOL_RESULT_KEEP } from '../modelHistory'
import { projectToolResult } from '../../model/toolResultProjection'
import { isModelStopped, runTextModel, type ModelToolCall, type RunTextModelOptions } from '../../model/runner'
import { parseToolArgs } from '../toolArgs'
import { scheduleStudyProgressEval } from '../chatStudy'
import { createBrowserControlGate } from '../browserControlGate'
import { createLearningCompletionCheck } from '../siteLearningReview'
import { peekAppBrowserUrl } from '../../browser/appBrowser'
import { createWatchContinuation } from '../watchContinuation'
import { createTaskCompletionCheck, type AgentTaskOutcome } from '../taskCompletion'

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
  taskOutcome?: AgentTaskOutcome
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
  const run = createRunController({
    run: liveMessage()?.run || newRun(assistantId),
    changed: checkpoint => { if (liveMessage()) patchMessage(sessionId, assistantId, { run: checkpoint }) },
    checkpoint: flushChatCheckpoint,
    prepareBrowser: async () => {
      const { ensureAgentBrowser } = await import('../agentBrowser')
      return ensureAgentBrowser(parentSessionId || sessionId)
    },
    browserTabs: () => liveSession(parentSessionId || sessionId)?.browserIds || [liveSession(parentSessionId || sessionId)?.browserId || ''].filter(Boolean),
    selectBrowser: async id => {
      const session = liveSession(parentSessionId || sessionId)
      const { browserIdsForChat, bindChatBrowser, ensureAgentBrowser } = await import('../agentBrowser')
      const { listAppBrowsers } = await import('../../browser/appBrowser')
      if (!session || !browserIdsForChat(session).includes(id) || !listAppBrowsers().some(tab => tab.id === id)) return false
      bindChatBrowser(session.id, id)
      return await ensureAgentBrowser(session.id) === id
    },
    browserId: () => liveSession(parentSessionId || sessionId)?.browserId || '', signal: abort.signal,
  })
  run.state('running')
  // 旧会话清单供模型参考，只有本轮实际更新的清单才约束本轮。
  const completion = createTaskCompletionCheck(() => ({
    todos: liveMessage()?.todos || [],
    steps: liveMessage()?.steps || [],
  }))
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
  const stripMarks = (text: string) => redactText(String(text || '').replace(/\u200B/g, ''))
  let consultedSitePath = ''
  let siteActionFailures = 0
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

  let waitingForApproval = false
  let waitingForVideo = false
  const pauseListeners = new Set<(paused: boolean) => void>()
  const stopApprovalWatch = watch(() => agentApprovalState.pending?.sessionId === sessionId, pending => {
    waitingForApproval = pending
    run.state(pending ? 'waiting_user' : waitingForVideo ? 'waiting_video' : 'running')
    pauseListeners.forEach(listener => listener(waitingForVideo || pending))
    void flushChatCheckpoint().catch(() => undefined)
  }, { flush: 'sync' })
  const continueVideo = role === 'parent' ? createWatchContinuation({
    sessionId, signal: abort.signal,
    browserId: () => liveSession(sessionId)?.browserId || '',
    expectedWatch: () => [...(liveMessage()?.steps || [])].reverse().find(step => step.name === 'browser_watch'
      && step.status === 'done' && parseToolArgs(step.result || '').watching === true)?.id,
    canFinish: () => Boolean(completion.terminal()),
    waiting: value => {
      run.state(waitingForApproval ? 'waiting_user' : value ? 'waiting_video' : 'running')
      waitingForVideo = value
      pauseListeners.forEach(listener => listener(value || waitingForApproval))
      void flushChatCheckpoint().catch(() => undefined)
      flushStreamHold()
      if (liveMessage()?.status === 'streaming') patchMessage(sessionId, assistantId, { awaitingVideo: value, waiting: !value })
    },
  }) : async () => undefined

  try {
    await flushChatCheckpoint()
    const finalText = await runTextModel(modelPrompt, (delta) => {
      if (abort.signal.aborted || liveMessage()?.status !== 'streaming') return
      streamText(delta)
    }, {
      timeoutMs,
      validateTools: true,
      compactBrowserContext: isBrowserChat,
      userContent,
      signal: abort.signal,
      tools,
      liveTools,
      systemPrompt,
      useAgentModel: true,
      history,
      maxRounds,
      liveContext: () => controlGate.liveContext(async () => [await liveContext?.() || '', run.context(), taskStateContext(liveSession(sessionId), assistantId)].join('\n')),
      beforeComplete: async remaining => {
        const recovery = !completion.terminal() ? run.beforeComplete() : undefined
        if (recovery) return recovery
        const continuation = await continueVideo()
        return completion.beforeComplete(remaining, continuation) || learningCheck.beforeComplete(remaining)
      },
      subscribePause: listener => {
        pauseListeners.add(listener); listener(waitingForVideo || waitingForApproval)
        return () => { pauseListeners.delete(listener) }
      },
      onTurnTranscript: (items) => {
        flushStreamHold()
        const prev = liveMessage()?.transcript || []
        patchMessage(sessionId, assistantId, {
          transcript: redactObject([...prev, ...items]),
        })
      },
      executeTool: async (call: ModelToolCall) => {
        const result = await controlGate.runTool(call, browserEpoch => run.execute(call, expectedBrowserId => executeChatTool({
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
              if (expectedBrowserId && id !== expectedBrowserId) throw new Error('网页操作未执行：当前标签页已改变，请重新读取页面。')

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
            getTodos: () => parentSessionId
              ? sessions.value.find(item => item.id === parentSessionId)?.todos || []
              : liveMessage()?.todos ?? (call.name === 'browser_todo' && parseToolArgs(call.arguments).action !== 'set'
                ? liveSession(sessionId)?.todos || [] : []),
            setTodos: (todos) => {
              const target = parentSessionId || sessionId
              const messageId = parentAssistantId || assistantId
              patchSession(target, (session) => ({ ...session, todos, updatedAt: Date.now() }))
              patchMessage(target, messageId, { todos })
            },
          },
        })))
        const finished = call.name === 'browser_finish' ? parseToolArgs(result) : null
        if (role === 'parent' && finished?.ok === true && finished.status === 'watching') {
          const continuation = await continueVideo()
          return JSON.stringify({ ...finished, finished: false, status: 'active',
            hint: continuation || '视频任务仍未完成，核对当前监控和页面状态后继续，不要输出最终结果。' })
        }
        return result
      },
      onEvent: (event) => {
        if (abort.signal.aborted || liveMessage()?.status !== 'streaming') return
        if (event.type === 'request') { run.request(event.inputTokens); return }
        if (event.type === 'usage') { run.usage(event.outputTokens); return }
        if (event.type === 'context_compacted') { run.compacted(event.beforeTokens, event.afterTokens); return }
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
            arguments: event.arguments,
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
          if (event.name === 'read_agent_skill_file' && extra?.id === 'site-learn' && /^sites\/[^/]+\/SKILL\.md$/.test(extra.path || '') && !extra.error) consultedSitePath = extra.path
          if (consultedSitePath === `sites/${websitePrimaryHost(peekAppBrowserUrl(liveSession(sessionId)?.browserId || ''))}/SKILL.md` && /^browser_(click|click_text)$/.test(event.name) && (extra?.reason === 'not_found' || extra?.failGate)) {
            siteActionFailures++
            if (siteActionFailures >= 2) patchMessage(sessionId, assistantId, { skillEvidence: [{ path: consultedSitePath, verifiedAt: Date.now(), browserId: liveSession(sessionId)?.browserId || '', outcome: 'needs_review' }] })
          }
          if (event.name === 'browser_finish' && extra?.ok && extra.finished && extra.status === 'done' && ['updated', 'covered'].includes(extra.learning?.decision) && extra.learning?.path) {
            patchMessage(sessionId, assistantId, { skillEvidence: [{ path: extra.learning.path, verifiedAt: Date.now(), browserId: liveSession(sessionId)?.browserId || '', outcome: 'validated' }] })
          }
          const status: 'failed' | 'done' = event.error || parsedError ? 'failed' : 'done'
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
            result: projectToolResult(event.result, TOOL_RESULT_KEEP, event.id),
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
    await run.finish(completion.outcome === 'blocked' || completion.outcome === 'incomplete' ? 'blocked' : 'completed')
    return { text: learningCheck.deferred ? `${assistantContent}\n\n本轮新的站点经验未确认保存到 Skill。` : assistantContent,
      aborted: false, taskOutcome: completion.outcome }
  } catch (error) {
    if (abort.signal.aborted || isModelStopped(error)) {
      return { text: liveContent(), aborted: true }
    }
    run.fail(error)
    await flushChatCheckpoint().catch(() => undefined)
    return {
      text: liveContent(),
      aborted: false,
      failed: error instanceof Error ? error.message : String(error),
      taskOutcome: completion.active ? 'incomplete' : undefined,
    }
  } finally {
    stopApprovalWatch()
    run.dispose()
    flushStreamHold()
    void liveSession(sessionId)
  }
}
