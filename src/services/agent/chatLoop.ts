/** 一轮对话：组 prompt、跑模型、写回消息。会话状态在 chatStore.ts。 */
import { databaseService } from '../app/database'
import { peekAppBrowserUrl } from '../browser/appBrowser'
import { isModelStopped } from '../model/runner'
import { finishStudyGraphStream, studyGraphStream } from '../study/graphStream'
import { finalizeStudySessionSummary } from '../study/timelineSummary'
import { getProfileForKind } from './agentProfiles'
import { getEnabledSkillCatalog } from './agentSkills'
import { formatBrowserLiveContext } from './browserLoop'
import { rememberBrowserTaskIntent } from './browserTask'
import { bindAllWatchAgents, flushAllWatchAfterTurn } from '../platform'
import {
  chatAborts,
  createChat,
  finalizeStopped,
  liveSession,
  persistSoon,
  patchMessage,
  sessionFolders,
  sessionIsStreaming,
  sessions,
  setChatStudySubject,
  activeChat,
} from './chatStore'
import {
  browserStatePrefix,
  lastUserText,
  loadLiveExploreRefs,
  maybeCompactContext,
  modelUserContent,
  scheduleStudyProgressEval,
  shouldAutoEvalStudy,
  studyStatePrefix,
  toMultimodalUserContent,
} from './chatStudy'
import { packAgentPanel } from '../platform/panelAccess'
import { ensureStudyWatch, liveStudyPlayback } from '../chaoxing/browser/playback'
import type { AgentChatAttachment, AgentChatMessage } from './chatTypes'
import { contextSummaryPrompt, splitCompactedHistory } from './context'
import { clipAgentDebug, logAgentDebug } from './debugLog'
import { isFileAttachment, isFolderAttachment, isImageAttachment } from './folderTokens'
import { buildModelHistory } from './modelHistory'
import { buildAgentSystemPrompt } from './prompts'
import { recoverSiteAccountsFromTexts, rememberAccountsFromUserText } from './siteAccounts'
import { runAgentTurnLoop } from './subagent/runtime'
import { assembleAgentTools, availableAgentTools } from './tools'
import { useSettings } from '../app/settings'
import { claimBrowserForNewMessage } from '../browser/control'

const matchSubjectInText = <T extends { id: number; name: string }>(text: string, subjects: T[]) => {
  const raw = String(text || '')
  const ranked = subjects
    .filter((item) => item.name && item.name.length >= 2 && raw.includes(item.name))
    .sort((a, b) => b.name.length - a.name.length)
  return ranked[0] || null
}

const attachStudyFromUserText = async (sessionId: string, text: string) => {
  const session = sessions.value.find((item) => item.id === sessionId)
  if (session?.studySubjectId) return
  try {
    const hit = matchSubjectInText(text, await databaseService.listStudySubjects())
    if (hit) setChatStudySubject(hit.id, sessionId)
  } catch {
    // ignore
  }
}

export const sendChatMessage = async (
  text: string,
  files?: AgentChatAttachment[],
  options?: { sessionId?: string; kind?: 'watch'; modelText?: string },
) => {
  const content = text.trim()
  if (!content) return

  let session = options?.sessionId
    ? sessions.value.find((item) => item.id === options.sessionId)
    : activeChat.value
  if (!session && !options?.sessionId) session = createChat()
  if (!session) return
  const sessionId = session.id
  if (sessionIsStreaming(sessions.value.find((item) => item.id === sessionId))) return
  const debug = (entry: Record<string, unknown>) =>
    logAgentDebug(sessionId, { kind: 'browser', ...entry })
  if (options?.kind !== 'watch') await attachStudyFromUserText(sessionId, content)
  if (options?.kind !== 'watch') rememberBrowserTaskIntent(sessionId, content)
  if (session.browserId) {
    const browserUrl = peekAppBrowserUrl(session.browserId) || ''
    rememberAccountsFromUserText(content, browserUrl)
    recoverSiteAccountsFromTexts(
      (session.messages || [])
        .filter((item) => item.role === 'user')
        .map((item) => String(item.content || '')),
      browserUrl,
    )
  }

  const abort = new AbortController()
  chatAborts.set(sessionId, abort)
  const attachments = files?.length ? files : undefined

  const modelFacing = String(options?.modelText || '').trim()
  const userMessage: AgentChatMessage = {
    id: `user-${Date.now()}`,
    role: 'user',
    content,
    kind: options?.kind,
    modelContent: modelFacing && modelFacing !== content ? modelFacing : undefined,
    attachments,
    steps: [],
    status: 'done',
  }
  const assistantId = `assistant-${Date.now()}`
  const assistantMessage: AgentChatMessage = {
    id: assistantId,
    role: 'assistant',
    content: '',
    steps: [],
    status: 'streaming',
    waiting: true,
  }

  debug({
    type: 'user',
    content: clipAgentDebug(content, 8000),
    attachments: attachments?.map((item) => item.fileName || item.folderPath || item.filePath),
  })

  const live = liveSession(sessionId)
  if (live) {
    if (live.title === '新对话' && !live.messages.length) {
      live.title = attachments?.find(isFileAttachment)?.fileName
        || attachments?.[0]?.folderPath
        || attachments?.[0]?.fileName
        || content.slice(0, 24)
    }
    live.updatedAt = Date.now()
    if (attachments?.length) {
      live.attachments = [
        ...attachments.filter((item) => !isImageAttachment(item)),
        ...(live.attachments || []).filter((item) => !attachments.some((file) => file.filePath === item.filePath)),
      ]
    }
    live.messages.push(userMessage, assistantMessage)
    persistSoon()
  }
  await new Promise<void>((resolve) => { window.setTimeout(resolve, 0) })

  let drawingGraph = false
  const streamSubjectId = Number(
    String(content).match(/subject_id\s*=\s*(\d+)/)?.[1]
    || sessions.value.find((item) => item.id === sessionId)?.studySubjectId,
  )

  try {
    await claimBrowserForNewMessage({
      sessionId, browserId: liveSession(sessionId)?.browserId, kind: options?.kind, signal: abort.signal,
    })

    const compacted = splitCompactedHistory(sessions.value.find((item) => item.id === sessionId))
    const history = buildModelHistory(
      compacted.kept.filter((message) => message.id !== assistantId && message.id !== userMessage.id),
      (message) => toMultimodalUserContent(message.modelContent || message.content, message.attachments),
    )
    const browserId = String(sessions.value.find((item) => item.id === sessionId)?.browserId || '').trim()
    const isBrowserChat = Boolean(browserId)
    const profile = getProfileForKind('learning')
    const browserProfile = getProfileForKind('browser')
    const skillCatalog = [...new Map([
      ...getEnabledSkillCatalog('learning', profile.skillIds.length ? profile.skillIds : undefined),
      ...getEnabledSkillCatalog('browser', browserProfile.skillIds.length ? browserProfile.skillIds : undefined),
    ].map(skill => [skill.id, skill])).values()]
    const baseSystemPrompt = buildAgentSystemPrompt({ catalog: skillCatalog })
    const overlay = String(profile.systemOverlay || '').trim()
    const browserOverlay = String(browserProfile.systemOverlay || '').trim()
    const envBlock = [await studyStatePrefix(sessionId), isBrowserChat ? await browserStatePrefix(sessionId) : ''].filter(Boolean).join('\n').trim()
    const promptFolders = (() => {
      const seen = new Set<number>()
      const folders: AgentChatAttachment[] = []
      for (const item of [...(attachments || []), ...sessionFolders(sessionId)]) {
        if (!isFolderAttachment(item) || item.folderId == null || seen.has(item.folderId)) continue
        seen.add(item.folderId)
        folders.push(item)
      }
      return folders
    })()
    const turnSystemPrompt = [
      baseSystemPrompt,
      overlay ? `【附加规则】\n${overlay}` : '',
      browserOverlay ? `【网页操作附加规则】仅进行网页操作时适用：\n${browserOverlay}` : '',
      contextSummaryPrompt(compacted.summary),
      envBlock,
    ].filter(Boolean).join('\n\n')
    const promptBody = String(options?.modelText || '').trim() || content
    const modelPrompt = modelUserContent(promptBody, promptFolders)
    const images = (attachments || []).filter((item) => isImageAttachment(item) && item.imageUrl)
    const userContent = images.length
      ? [
          ...images.map((item) => ({
            type: 'image_url' as const,
            image_url: { url: item.imageUrl, detail: 'high' as const },
          })),
          { type: 'text' as const, text: modelPrompt },
        ]
      : undefined

    const liveBrowserId = () => String(sessions.value.find(item => item.id === sessionId)?.browserId || '').trim()
    const currentTools = () => availableAgentTools(assembleAgentTools(peekAppBrowserUrl(liveBrowserId())), useSettings().settings.search)
    const loop = await runAgentTurnLoop({
      sessionId,
      assistantId,
      abort,
      modelPrompt,
      userContent,
      history,
      systemPrompt: turnSystemPrompt,
      tools: currentTools(),
      liveTools: currentTools,
      liveContext: async () => {
        const current = sessions.value.find(item => item.id === sessionId)
        const id = liveBrowserId()
        if (!id) return ''
        const url = peekAppBrowserUrl(id) || ''
        const refs = await loadLiveExploreRefs(id, url)
        return formatBrowserLiveContext({
          url,
          sessionId,
          todos: current?.todos || [],
          panel: packAgentPanel(id),
          browserId: id,
          role: 'parent',
          refs,
        })
      },
      maxRounds: 80,
      timeoutMs: 15 * 60 * 1000,
      isBrowserChat: true,
      role: 'parent',
      streamSubjectId: Number.isFinite(streamSubjectId) ? streamSubjectId : undefined,
      onDrawingGraph: () => { drawingGraph = true },
    })

    const completedBrowserId = liveBrowserId()
    if (completedBrowserId && !abort.signal.aborted && !loop.aborted) {
      const playbackNow = liveStudyPlayback(completedBrowserId)
      if (playbackNow.playing) ensureStudyWatch(completedBrowserId, sessionId, playbackNow)
    }

    if (abort.signal.aborted || loop.aborted) {
      const current = sessions.value.find((item) => item.id === sessionId)
        ?.messages.find((message) => message.id === assistantId)
      if (current?.status === 'streaming') finalizeStopped(sessionId, assistantId)
      return
    }
    if (loop.failed) {
      patchMessage(sessionId, assistantId, {
        content: loop.text,
        status: 'failed',
        error: loop.failed,
      })
      return
    }
    const assistantSteps = sessions.value.find((item) => item.id === sessionId)
      ?.messages.find((message) => message.id === assistantId)?.steps || []
    debug({
      type: 'assistant',
      content: clipAgentDebug(loop.text, 8000),
      steps: assistantSteps.map((step) => ({
        name: step.name,
        label: step.label,
        status: step.status,
        detail: step.detail,
      })),
    })
    patchMessage(sessionId, assistantId, {
      content: loop.text,
      status: 'done',
    })
    const finished = sessions.value
      .find((item) => item.id === sessionId)
      ?.messages.find((message) => message.id === assistantId)
    if (finished) {
      const auto = shouldAutoEvalStudy(sessionId, finished)
      if (auto.yes) {
        scheduleStudyProgressEval({
          sessionId,
          messageId: assistantId,
          subjectId: auto.subjectId,
          force: auto.force,
        })
      } else if (/这是本轮最后一题/.test(lastUserText(sessionId))) {
        const subjectId = Number(sessions.value.find((item) => item.id === sessionId)?.studySubjectId)
        if (Number.isFinite(subjectId) && subjectId > 0) {
          finalizeStudySessionSummary({ subjectId })
        }
      }
    }
    maybeCompactContext(sessionId)
  } catch (error) {
    if (abort.signal.aborted || isModelStopped(error) || (error instanceof Error && error.name === 'AbortError')) {
      const current = sessions.value.find((item) => item.id === sessionId)
        ?.messages.find((message) => message.id === assistantId)
      if (current?.status === 'streaming') finalizeStopped(sessionId, assistantId)
      return
    }
    patchMessage(sessionId, assistantId, {
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
    })
  } finally {
    const liveId = studyGraphStream.value?.subjectId
    const id = Number.isFinite(streamSubjectId) ? streamSubjectId : liveId
    if (drawingGraph || studyGraphStream.value?.streaming) {
      if (liveId == null || id == null || liveId === id) finishStudyGraphStream(id)
    }
    if (chatAborts.get(sessionId) === abort) chatAborts.delete(sessionId)
    flushAllWatchAfterTurn(sessionId)
    persistSoon(true)
  }
}

bindAllWatchAgents({
  notify: (sessionId, display, modelText, files) => {
    void sendChatMessage(display, files as AgentChatAttachment[] | undefined, { sessionId, kind: 'watch', modelText })
  },
  gate: (sessionId) => {
    const session = sessions.value.find((item) => item.id === sessionId)
    if (!session) return 'missing'
    if (sessionIsStreaming(session) || chatAborts.has(sessionId)) return 'busy'
    return 'ready'
  },
})
