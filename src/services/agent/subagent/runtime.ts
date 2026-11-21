import { createHostToolRunner, runChapterResume, type chapterResumePlan } from '../chapterResume'
import { chaoxingStartup } from '../chaoxingStartup'
import { LOAD_AGENT_TOOLS, loadAgentTools, modelAgentTools } from '../toolDiscovery'
import { toolRegistry } from '../core/tools'
import { WEBSITE_HOST_TOOLS } from '../websiteRuntime/hostTools'
import { websiteCheckpoints } from '../websiteRuntime/checkpoints'
import { websitePrimaryHost } from '../websiteIdentity'
import { watch } from 'vue'
import { chatLoginRequests, pendingWebsiteVerification } from '../chatLogin'
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
import { peekAppBrowserUrl } from '../../browser/appBrowser'
import { createWatchContinuation } from '../watchContinuation'
import { canReviewFinalReply, createTaskCompletionCheck, type AgentTaskOutcome } from '../taskCompletion'
import { videoWatchFor } from '../../platform/panelAccess'
import type { ChapterWorkflowResume } from '../tools/websiteChapterStart'

export type RunAgentTurnLoopInput = {
  sessionId: string
  assistantId: string
  abort: AbortController
  modelPrompt: string
  userContent?: unknown
  history?: RunTextModelOptions['history']
  systemPrompt: string
  tools: unknown[]
  deferTools?: boolean
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
  chapterResume?: ReturnType<typeof chapterResumePlan>
  startupCommand?: string
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
  let browserRevealRequested = false
  const onBrowserNavigation = () => {
    if (browserRevealRequested || parentSessionId || role !== 'parent' || abort.signal.aborted) return
    browserRevealRequested = true
    void import('../agentBrowser').then(({ requestAgentBrowserReveal }) => {
      if (!abort.signal.aborted) requestAgentBrowserReveal(sessionId)
    })
  }
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
  let runningChapterWorkflow = false
  const pauseListeners = new Set<(paused: boolean) => void>()
  const updateTimeout = () => pauseListeners.forEach(listener => listener(waitingForVideo || waitingForApproval || runningChapterWorkflow))
  const chatId = parentSessionId || sessionId
  const stopApprovalWatch = watch(() => agentApprovalState.pending?.sessionId === sessionId
    || chatLoginRequests.has(chatId) || pendingWebsiteVerification.has(chatId), pending => {
    waitingForApproval = pending
    run.state(pending ? 'waiting_user' : waitingForVideo ? 'waiting_video' : 'running')
    updateTimeout()
    void flushChatCheckpoint().catch(() => undefined)
  }, { flush: 'sync' })
  const continueVideo = role === 'parent' ? createWatchContinuation({
    sessionId, signal: abort.signal,
    browserId: () => liveSession(sessionId)?.browserId || '',
    expectedWatch: () => [...(liveMessage()?.steps || [])].reverse().find(step => ['browser_watch', 'browser_complete_chapter', 'browser_start_chapter_tasks'].includes(step.name || '')
      && step.status === 'done' && parseToolArgs(step.result || '').watching === true)?.id,
    canFinish: () => Boolean(completion.terminal()),
    waiting: value => {
      run.state(waitingForApproval ? 'waiting_user' : value ? 'waiting_video' : 'running')
      waitingForVideo = value
      updateTimeout()
      void flushChatCheckpoint().catch(() => undefined)
      flushStreamHold()
      if (liveMessage()?.status === 'streaming') patchMessage(sessionId, assistantId, { awaitingVideo: value, waiting: !value })
    },
  }) : async () => undefined

  try {
    await flushChatCheckpoint()
    let startupContext = ''

    const projectTools = (available: unknown[]) => modelAgentTools([...toolRegistry(available).values()], liveSession(sessionId))
    const currentCatalog = async () => await liveTools?.() ?? tools
    const currentModelTools = async () => {
      const catalog = [...toolRegistry(await currentCatalog()).values()]
      return input.deferTools ? projectTools(catalog) : catalog
    }
    const modelOptions: RunTextModelOptions = {
      timeoutMs,
      validateTools: true,
      compactBrowserContext: isBrowserChat,
      userContent,
      signal: abort.signal,
      tools: input.deferTools ? projectTools(tools) : tools,
      liveTools: currentModelTools,
      systemPrompt,
      useAgentModel: true,
      history,
      maxRounds,
      liveContext: () => controlGate.liveContext(async () => [startupContext, await liveContext?.() || '', run.context(), taskStateContext(liveSession(sessionId), assistantId)].join('\n')),
      beforeComplete: async (remaining, response) => {
        const recovery = !completion.terminal() ? run.beforeComplete() : undefined
        if (recovery) return recovery
        const continuation = await continueVideo()
        const message = liveMessage()
        if (role === 'parent' && response && !continuation && message
          && !completion.terminal() && canReviewFinalReply({ steps: message.steps, todos: message.todos || [] })
          && toolRegistry(await currentCatalog()).has('browser_finish')) {
          const receipt = await hostTool('browser_finish', { status: 'done', summary: response.slice(0, 600) })
          if (!receipt.finished && receipt.error) return String(receipt.error)
        }
        return completion.beforeComplete(remaining, continuation)
      },
      subscribePause: listener => {
        pauseListeners.add(listener); listener(waitingForVideo || waitingForApproval || runningChapterWorkflow)
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
        if (input.deferTools && call.name === LOAD_AGENT_TOOLS) {
          return run.execute(call, async () => loadAgentTools([...toolRegistry(await currentCatalog()).values()], parseToolArgs(call.arguments).names))
        }
        const dispatch = (chapterResume?: ChapterWorkflowResume) => controlGate.runTool(call, browserEpoch => run.execute(call, expectedBrowserId => executeChatTool({
          call,
          ctx: {
            sessionId,
            assistantId,
            abort: abort.signal,
            browserEpoch,
            chapterResume,
            role,
            parentSessionId,
            parentAssistantId,
            parentStepId,
            jobId,
            onBrowserNavigation,
            invokeHostTool: (name, args) => hostTool(name, args),
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
        if (role === 'parent' && call.name === 'browser_start_chapter_tasks') {
          runningChapterWorkflow = true
          updateTimeout()
          try {
            let result = await dispatch()
            while (true) {
              const chapter = parseToolArgs(result)
              if (chapter.ok !== true || chapter.watching !== true) return result
              const watchedBrowser = liveSession(sessionId)?.browserId || ''
              patchStep(sessionId, assistantId, call.id, { result: projectToolResult(result, TOOL_RESULT_KEEP, call.id) })
              const continuation = await continueVideo()
              if (!continuation) return result
              const watch = videoWatchFor(watchedBrowser)
              if (liveSession(sessionId)?.browserId !== watchedBrowser || watch?.sessionId !== sessionId
                || watch.status !== 'done' || !('mid' in watch) || watch.mid !== chapter.videoMid
                || typeof chapter.chapterKey !== 'string' || typeof chapter.videoMid !== 'string') {
                return JSON.stringify({ ...chapter, watching: false, status: 'video_event', hint: continuation })
              }
              result = await dispatch({ chapterKey: chapter.chapterKey, videoMid: chapter.videoMid })
            }
          } finally {
            runningChapterWorkflow = false
            updateTimeout()
          }
        }
        const result = await dispatch()
        if (role === 'parent' && call.name === 'browser_complete_chapter') {
          const chapter = parseToolArgs(result)
          if (chapter.ok === true && chapter.watching === true) {
            // Preserve the verified playback receipt even if the wait is interrupted.
            patchStep(sessionId, assistantId, call.id, { result: projectToolResult(result, TOOL_RESULT_KEEP, call.id) })
            const continuation = await continueVideo()
            if (continuation) return JSON.stringify({ ...chapter, watching: false, status: 'video_event', hint: continuation })
          }
        }
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
        if (event.type === 'reasoning') {
          const message = liveMessage()
          const text = [message?.reasoning, event.text].filter(Boolean).join('\n\n')
          const limit = 64_000
          patchMessage(sessionId, assistantId, {
            reasoning: text.length > limit ? `…（较早的思考已省略）\n\n${text.slice(-limit)}` : text,
            reasoningDurationMs: (message?.reasoningDurationMs ?? 0) + event.durationMs,
          })
          return
        }
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
            || event.name === 'list_campus_uncategorized_questions'
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
    }
    const hostTool = createHostToolRunner({ ...modelOptions, tools, liveTools: async () => [...await currentCatalog(), ...WEBSITE_HOST_TOOLS] }, assistantId)
    let workflowStorageReady = true
    const pendingWorkflows = await websiteCheckpoints.list(sessionId).catch(() => {
      workflowStorageReady = false
      startupContext = '【网站检查点暂不可读】普通对话可继续。本轮关闭网站快捷启动，不自动恢复或覆盖未读状态；网站流程需先解决安全存储错误。'
      return []
    })
    if (pendingWorkflows.length) startupContext = `【网站流程检查点】${JSON.stringify(pendingWorkflows.map(({ id, name, browserId }) => ({ id, name, browserId })))}。结合用户本轮目标决定是否使用 browser_workflows 恢复或丢弃；恢复须先读取实际页面，不能重复已完成的提交。`
    if (role === 'parent' && workflowStorageReady && !pendingWorkflows.length) {
      const registry = toolRegistry(tools)
      if (input.chapterResume && registry.has('browser_complete_chapter')) {
        startupContext = await runChapterResume(input.chapterResume, hostTool)
      } else if (input.startupCommand) {
        const startup = chaoxingStartup(input.startupCommand, peekAppBrowserUrl(liveSession(sessionId)?.browserId || ''))
        if (startup && registry.has(startup.name)) {
          let result = await hostTool(startup.name, startup.args)
          if (result.loginRequired === true && startup.name === 'browser_start_chapter_tasks' &&
            result.clickDispatched !== true && registry.has('browser_login_chaoxing')) {
            const login = await hostTool('browser_login_chaoxing', {})
            result = login.loggedIn === true ? await hostTool(startup.name, startup.args) : login
          }
          const loginOnly = startup.name === 'browser_login_chaoxing'
          const siteName = '学习通'
          const success = loginOnly ? result.loggedIn === true : result.courseComplete === true
          const summary = success
            ? loginOnly ? `${siteName}已登录。` : `${startup.args.course_name}的章节已完成。目录确认了 ${result.completed} 个已完成小节。`
            : loginOnly && !startupContext && typeof result.error === 'string' ? result.error : ''
          if (summary && registry.has('browser_finish')) {
            const finish = await hostTool('browser_finish', { status: success ? 'done' : 'blocked', summary })
            if (finish.finished === true) {
              await run.finish(success ? 'completed' : 'blocked')
              return { text: summary, aborted: false, taskOutcome: success ? 'completed' : 'blocked' }
            }
          }
          startupContext ||= `【宿主已执行本轮起始操作】${startup.name}，最新回执如下。直接处理剩余步骤，无需重复已完成操作或另建清单。\n${JSON.stringify(result)}`
        }
      }
    }
    const finalText = await runTextModel(modelPrompt, (delta) => {
      if (abort.signal.aborted || liveMessage()?.status !== 'streaming') return
      streamText(delta)
    }, modelOptions)

    if (abort.signal.aborted) {
      return { text: liveContent(), aborted: true }
    }
    const liveNow = liveMessage()?.content || ''
    const assistantContent = visibleText(liveNow)
      ? liveNow
      : joinRound(finalText || '')
    await run.finish(completion.outcome === 'blocked' || completion.outcome === 'incomplete' ? 'blocked' : 'completed')
    return { text: assistantContent,
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
