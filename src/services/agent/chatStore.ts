/** 会话列表、持久化、作曲栏。发送循环在 chatLoop.ts，不要把模型调用写回这里。 */
import { computed, ref, watch } from 'vue'
import { readSecureDocument, writeSecureDocument } from '../security/secureStore'
import { redactObject } from '../security/secretRedaction'
import { browserControlState } from '../browser/control'
import type { ImportStepPreview, ImportTaskStep } from '../app/importTasks'
import { dropAllWatchQueues } from '../platform'
import { cancelApprovalsForSession } from './agentApproval'
import { wakeAgentWait } from './agentWait'
import { stopWatchFor } from './chatWatch'
import type {
  AgentChatAttachment,
  AgentChatMessage,
  AgentChatSession,
  AgentQuizAttempt,
} from './chatTypes'
import { writeBrowserTranscript } from './debugLog'
import { isFileAttachment, isFolderAttachment, isImageAttachment } from './folderTokens'
import { clipToolText, clipTranscript, TOOL_ARGS_KEEP, TOOL_RESULT_KEEP } from './modelHistory'

const STORAGE_KEY = 'zerror-agent-chat-sessions'
const CHAT_LIST_COLLAPSED_KEY = 'zerror-chat-list-collapsed'

export const sessions = ref<AgentChatSession[]>([])
export const activeId = ref<string | null>(null)
export const chatListCollapsed = ref(false)
export const chatAborts = new Map<string, AbortController>()
export const composerAttachments = ref<AgentChatAttachment[]>([])

try {
  chatListCollapsed.value = localStorage.getItem(CHAT_LIST_COLLAPSED_KEY) === '1'
} catch {
  chatListCollapsed.value = false
}

export const setChatListCollapsed = (value: boolean) => {
  chatListCollapsed.value = Boolean(value)
  try {
    localStorage.setItem(CHAT_LIST_COLLAPSED_KEY, chatListCollapsed.value ? '1' : '0')
  } catch {
    // ignore quota / private mode
  }
}

const clipPreview = (preview?: ImportStepPreview[]) => {
  if (!preview?.length) return preview
  return preview.slice(0, 40).map((item) => ({
    question: String(item.question || '').slice(0, 180),
    options: item.options ? String(item.options).slice(0, 160) : '',
    answer: String(item.answer || '').slice(0, 80),
    question_type: item.question_type ? String(item.question_type).slice(0, 12) : '',
    question_id: (item as ImportStepPreview & { question_id?: number }).question_id,
    explanation: (item as ImportStepPreview & { explanation?: string }).explanation
      ? String((item as ImportStepPreview & { explanation?: string }).explanation).slice(0, 160)
      : undefined,
  }))
}

const stripImageData = (items?: AgentChatAttachment[]) =>
  items?.map((item) => (item.imageUrl ? { ...item, imageUrl: undefined } : item))

const persist = (writeTranscript = true) => {
  const toPayload = (stripImages: boolean) =>
    sessions.value.filter((session) => !session.parentId).slice(0, 30).map((session) => ({
      ...session,
      attachments: stripImages ? stripImageData(session.attachments) : session.attachments,
      messages: session.messages.map((message) => ({
        ...message,
        attachments: stripImages ? stripImageData(message.attachments) : message.attachments,
        steps: message.steps.map((step) => ({
          ...step,
          preview: clipPreview(step.preview),
          arguments: step.arguments ? clipToolText(step.arguments, TOOL_ARGS_KEEP) : undefined,
          result: step.result ? clipToolText(step.result, TOOL_RESULT_KEEP) : undefined,
        })),
        transcript: message.transcript ? clipTranscript(message.transcript) : undefined,
      })),
    }))
  void chatStoreReady.then(() => writeSecureDocument('agent_chats', redactObject(toPayload(false)))).catch(() => undefined)
  if (!writeTranscript) return
  const latestBrowser = sessions.value
    .filter((session) => session.browserId && !session.parentId)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]
  writeBrowserTranscript(latestBrowser)
}

const loadPersisted = async () => {
  try {
    const parsed = await readSecureDocument<AgentChatSession[]>('agent_chats', STORAGE_KEY)
    if (!parsed) return
    if (!Array.isArray(parsed)) return
    const restored = parsed.filter(session => !sessions.value.some(existing => existing.id === session.id))
      .filter(session => !session.parentId).slice(0, 30).map((session): AgentChatSession => ({
      ...session,
      attachments: Array.isArray(session.attachments) ? session.attachments : undefined,
      studySubjectId: Number(session.studySubjectId) > 0 ? Number(session.studySubjectId) : undefined,
      browserId: String(session.browserId || '').trim() || undefined,
      browserIds: Array.isArray(session.browserIds) ? [...new Set(session.browserIds.map(id => String(id || '').trim()).filter(Boolean))] : undefined,
      todos: Array.isArray(session.todos) ? session.todos : undefined,
      contextSummary: session.contextSummary?.text && session.contextSummary.coveredThrough
        ? session.contextSummary
        : undefined,
      messages: (session.messages || []).map((message) => ({
        ...message,
        attachments: Array.isArray(message.attachments) ? message.attachments : undefined,
        steps: Array.isArray(message.steps) ? message.steps : [],
        transcript: Array.isArray(message.transcript) ? message.transcript : undefined,
        studyEval: message.studyEval?.status === 'running'
          ? { status: 'empty', text: '上次评估在关闭前中断了。' }
          : message.studyEval,
        status: message.status === 'streaming' ? 'failed' : message.status,
        error: message.status === 'streaming' ? '应用关闭时对话中断' : message.error,
      })),
    }))
    sessions.value = [...sessions.value, ...restored].slice(0, 30)
    if (!activeId.value || !sessions.value.some(session => session.id === activeId.value)) {
      activeId.value = sessions.value[0]?.id || null
    }
  } catch {
    // Keep unread encrypted history intact; the global storage notice explains unlock failures.
  }
}

export const chatStoreReady = loadPersisted()

export const chatSessions = computed(() => sessions.value.filter((session) => !session.parentId))
export const browserChatSessions = computed(() => sessions.value.filter((session) => session.browserId && !session.parentId))
export const activeChatId = computed(() => activeId.value)
export const activeChat = computed(
  () => sessions.value.find((session) => session.id === activeId.value) || null
)

export const sessionIsStreaming = (session?: AgentChatSession | null) =>
  Boolean(session?.messages.some((message) => message.status === 'streaming'))

export const runningChatCount = computed(() =>
  sessions.value.filter((session) => sessionIsStreaming(session)).length
)
export const isChatBusy = computed(() => runningChatCount.value > 0)

export const firstFileAttachment = (items?: AgentChatAttachment[]) =>
  items?.find(isFileAttachment) || null

export const sessionAttachment = (sessionId: string) => {
  const session = sessions.value.find((item) => item.id === sessionId)
  if (!session) return null
  const fromSession = firstFileAttachment(session.attachments)
  if (fromSession) return fromSession
  for (let index = session.messages.length - 1; index >= 0; index -= 1) {
    const file = firstFileAttachment(session.messages[index].attachments)
    if (file) return file
  }
  return null
}

export const sessionFolders = (sessionId: string) => {
  const session = sessions.value.find((item) => item.id === sessionId)
  if (!session) return []
  const seen = new Set<number>()
  const folders: AgentChatAttachment[] = []
  const push = (items?: AgentChatAttachment[]) => {
    for (const item of items || []) {
      if (!isFolderAttachment(item) || item.folderId == null || seen.has(item.folderId)) continue
      seen.add(item.folderId)
      folders.push(item)
    }
  }
  push(session.attachments)
  for (const message of session.messages) push(message.attachments)
  return folders
}

let persistTimer = 0
export const persistSoon = (immediate = false) => {
  const run = (writeTranscript: boolean) => {
    persistTimer = 0
    persist(writeTranscript)
  }
  if (immediate) {
    if (persistTimer) {
      window.clearTimeout(persistTimer)
      persistTimer = 0
    }
    const idle = (window as Window & {
      requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number
    }).requestIdleCallback
    if (idle) {
      idle(() => run(true), { timeout: 800 })
      return
    }
    persistTimer = window.setTimeout(() => run(true), 0)
    return
  }
  if (persistTimer) return
  // 长时间运行的浏览器任务也需要检查点；否则意外退出会丢掉整轮输出与工具记录。
  // 流式期间降低写入频率，避免每个 token 都触发加密存储。
  const streaming = sessions.value.some((session) => sessionIsStreaming(session))
  persistTimer = window.setTimeout(() => run(false), streaming ? 10_000 : 1500)
}

export const liveSession = (sessionId: string) =>
  sessions.value.find((session) => session.id === sessionId)

export const patchSession = (sessionId: string, mutate: (session: AgentChatSession) => AgentChatSession) => {
  const current = liveSession(sessionId)
  if (!current) return
  const next = mutate(current)
  if (next !== current) Object.assign(current, next)
  persistSoon()
}

export const patchMessage = (sessionId: string, messageId: string, patch: Partial<AgentChatMessage>) => {
  const session = liveSession(sessionId)
  const message = session?.messages.find((item) => item.id === messageId)
  if (!session || !message) return
  Object.assign(message, patch)
  session.updatedAt = Date.now()
  persistSoon()
}

export const addStep = (sessionId: string, messageId: string, step: ImportTaskStep) => {
  const session = liveSession(sessionId)
  const message = session?.messages.find((item) => item.id === messageId)
  if (!session || !message) return
  if (message.steps.some((item) => item.id === step.id)) return
  if (
    (step.name === 'get_file_info' || step.name === 'list_folders')
    && message.steps.some((item) => item.name === step.name)
  ) {
    return
  }
  message.steps.push({
    ...step,
    atContentLength: typeof step.atContentLength === 'number' ? step.atContentLength : message.content.length,
  })
  session.updatedAt = Date.now()
  persistSoon()
}

export const patchStep = (sessionId: string, messageId: string, stepId: string, patch: Partial<ImportTaskStep>) => {
  const session = liveSession(sessionId)
  const message = session?.messages.find((item) => item.id === messageId)
  const step = message?.steps.find((item) => item.id === stepId)
  if (!session || !step) return
  Object.assign(step, patch)
  session.updatedAt = Date.now()
  persistSoon()
}

export const addChildStep = (
  sessionId: string,
  messageId: string,
  parentStepId: string,
  step: ImportTaskStep,
) => {
  const session = liveSession(sessionId)
  const message = session?.messages.find((item) => item.id === messageId)
  const parent = message?.steps.find((item) => item.id === parentStepId)
  if (!session || !parent) return
  const children = parent.children || []
  if (children.some((item) => item.id === step.id)) return
  parent.children = [...children, { ...step }]
  session.updatedAt = Date.now()
  persistSoon()
}

export const patchChildStep = (
  sessionId: string,
  messageId: string,
  parentStepId: string,
  childId: string,
  patch: Partial<ImportTaskStep>,
) => {
  const session = liveSession(sessionId)
  const message = session?.messages.find((item) => item.id === messageId)
  const parent = message?.steps.find((item) => item.id === parentStepId)
  if (!session || !parent?.children) return
  parent.children = parent.children.map((item) => (item.id === childId ? { ...item, ...patch } : item))
  session.updatedAt = Date.now()
  persistSoon()
}

export const dropStep = (sessionId: string, messageId: string, stepId: string) => {
  patchSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) => {
      if (message.id !== messageId) return message
      return { ...message, steps: message.steps.filter((step) => step.id !== stepId) }
    }),
  }))
}

const fileNameFromPath = (filePath: string) => filePath.split(/[\\/]/).pop() || '文件'
const MAX_COMPOSER_IMAGES = 4

export const addComposerAttachment = (filePath: string) => {
  const path = String(filePath || '').trim()
  if (!path) return
  if (composerAttachments.value.some((item) => item.filePath === path)) return
  composerAttachments.value = [
    ...composerAttachments.value,
    { kind: 'file', filePath: path, fileName: fileNameFromPath(path) },
  ]
}

export const addComposerImage = (input: {
  imageUrl: string
  fileName?: string
  mimeType?: string
  filePath?: string
}) => {
  const imageUrl = String(input.imageUrl || '').trim()
  if (!imageUrl.startsWith('data:image/')) return false
  if (composerAttachments.value.filter(isImageAttachment).length >= MAX_COMPOSER_IMAGES) return false
  const diskPath = String(input.filePath || '').trim()
  composerAttachments.value = [
    ...composerAttachments.value,
    {
      kind: 'image',
      filePath: diskPath || `image:${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fileName: input.fileName || '图片',
      mimeType: input.mimeType,
      imageUrl,
    },
  ]
  return true
}

export const removeComposerAttachment = (filePath: string) => {
  composerAttachments.value = composerAttachments.value.filter((item) => item.filePath !== filePath)
}

export const consumeComposerAttachments = () => {
  const items = composerAttachments.value
  composerAttachments.value = []
  return items
}

export const selectChat = (id: string) => {
  if (activeId.value !== id) composerAttachments.value = []
  activeId.value = id
}

export const setChatStudySubject = (subjectId?: number | null, sessionId?: string) => {
  const id = sessionId || activeId.value
  const nextId = Number(subjectId) > 0 ? Number(subjectId) : undefined
  if (!id) {
    createChat({ studySubjectId: nextId })
    return
  }
  patchSession(id, (session) => ({
    ...session,
    studySubjectId: nextId,
    updatedAt: Date.now(),
  }))
}

export const createChat = (init?: Partial<Pick<AgentChatSession, 'title' | 'attachments' | 'studySubjectId' | 'browserId'>> & { activate?: boolean }) => {
  if (init?.activate !== false) composerAttachments.value = []
  const session: AgentChatSession = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: init?.title || '新对话',
    messages: [],
    attachments: init?.attachments,
    studySubjectId: Number(init?.studySubjectId) > 0 ? Number(init?.studySubjectId) : undefined,
    browserId: String(init?.browserId || '').trim() || undefined,
    todos: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  sessions.value = [session, ...sessions.value].slice(0, 40)
  if (init?.activate !== false) activeId.value = session.id
  persistSoon()
  return session
}

export const attachFileToChat = (input: {
  filePath: string
  folderId?: number
  folderName?: string
}) => {
  const fileName = input.filePath.split(/[\\/]/).pop() || '文件'
  const attachment: AgentChatAttachment = {
    filePath: input.filePath,
    fileName,
    folderId: input.folderId,
    folderName: input.folderName,
  }
  let session = activeChat.value
  if (!session) session = createChat({ title: fileName })
  const target = sessions.value.find((item) => item.id === session.id)
  if (!target) return
  target.attachments = [
    attachment,
    ...(target.attachments || []).filter((item) => item.filePath !== attachment.filePath),
  ]
  if (!target.title || target.title === '新对话') target.title = fileName
  target.updatedAt = Date.now()
  persist()
}

export const finalizeStopped = (sessionId: string, messageId: string, reason: AgentChatMessage['stopReason'] = 'user') => {
  patchSession(sessionId, (session) => ({
    ...session,
    updatedAt: Date.now(),
    messages: session.messages.map((message) => {
      if (message.id !== messageId) return message
      return {
        ...message,
        status: 'stopped' as const,
        stopReason: reason,
        waiting: false,
        awaitingVideo: false,
        error: undefined,
        steps: message.steps.map((step) =>
          step.status === 'running'
            ? { ...step, status: 'failed' as const, detail: '已终止', finishedAt: Date.now() }
            : step
        ),
      }
    }),
  }))
}

export const stopChat = (id?: string, reason: AgentChatMessage['stopReason'] = 'user') => {
  const sessionId = id || activeId.value
  if (!sessionId) return
  const abort = chatAborts.get(sessionId)
  const session = sessions.value.find((item) => item.id === sessionId)
  const message = session?.messages.find((item) => item.status === 'streaming')
  if (session && message) finalizeStopped(session.id, message.id, reason)
  persistSoon(true)
  void import('./subagent/owner').then(({ abortChildrenOf }) => abortChildrenOf(sessionId)).catch(() => undefined)
  if (abort && !abort.signal.aborted) abort.abort()
  chatAborts.delete(sessionId)
  wakeAgentWait(sessionId, { reason: 'timeout', hint: '已终止' })
  cancelApprovalsForSession(sessionId)
  dropAllWatchQueues(sessionId)
  for (const id of new Set([...(session?.browserIds || []), session?.browserId || ''].filter(Boolean))) stopWatchFor(id)
}

// 接管是终止当前回合；不能把模型/工具挂起到交还时再自动续跑。
const offBrowserTakeover = watch(
  () => Object.values(browserControlState),
  (next, previous) => {
    for (const state of next) {
      if (state.owner === 'user' && previous?.find(item => item.sessionId === state.sessionId)?.owner !== 'user') {
        stopChat(state.sessionId, 'browser-takeover')
      }
    }
  },
  { flush: 'sync', immediate: true },
)
if (import.meta.hot) import.meta.hot.dispose(offBrowserTakeover)

export const stopBrowserAgent = (browserId?: string) => {
  const id = String(browserId || '').trim()
  if (!id) return
  const session = sessions.value.find((item) => !item.parentId && (item.browserId === id || item.browserIds?.includes(id)))
  if (session) {
    stopChat(session.id)
    return
  }
  stopWatchFor(id)
}

export const ensureBrowserChat = (input: { browserId: string; title?: string }) => {
  const browserId = String(input.browserId || '').trim()
  if (!browserId) return null
  const keep = sessions.value.find((item) => !item.parentId
    && (item.browserId === browserId || item.browserIds?.includes(browserId)))
  if (keep) {
    if (keep.browserId !== browserId || (input.title && keep.title !== input.title)) {
      patchSession(keep.id, (current) => ({
        ...current,
        browserId,
        title: input.title || current.title,
        updatedAt: Date.now(),
      }))
    }
    persist()
    return sessions.value.find((item) => item.id === keep.id) || keep
  }
  return createChat({
    title: input.title || '网页助手',
    browserId,
    activate: false,
  })
}

export const removeChat = (id: string) => {
  const current = sessions.value.find(session => session.id === id)
  const browserIds = [...new Set([...(current?.browserIds || []), current?.browserId || ''].filter(Boolean))]
  if (sessionIsStreaming(sessions.value.find((session) => session.id === id))) {
    stopChat(id)
  }
  sessions.value = sessions.value.filter((session) => session.id !== id)
  if (activeId.value === id) activeId.value = sessions.value.find((session) => !session.parentId)?.id || null
  persist()
  if (browserIds.length) {
    void import('./agentBrowser').then(({ releaseChatBrowsers }) => releaseChatBrowsers(browserIds))
  }
}

export const clearBrowserChat = (browserId: string) => {
  const id = String(browserId || '').trim()
  if (!id) return
  stopWatchFor(id)
  const session = sessions.value.find((item) => item.browserId === id && !item.parentId)
  if (!session) return
  if (sessionIsStreaming(session)) stopChat(session.id)
  patchSession(session.id, (current) => ({
    ...current,
    messages: [],
    todos: [],
    contextSummary: undefined,
    updatedAt: Date.now(),
  }))
}

export const recordQuizAttempt = (sessionId: string, messageId: string, attempt: AgentQuizAttempt) => {
  patchSession(sessionId, (session) => ({
    ...session,
    updatedAt: Date.now(),
    messages: session.messages.map((message) => {
      if (message.id !== messageId) return message
      const rest = (message.quizAttempts || []).filter((item) => !(item.stepId === attempt.stepId && item.uid === attempt.uid))
      return { ...message, quizAttempts: [...rest, attempt] }
    }),
  }))
}
