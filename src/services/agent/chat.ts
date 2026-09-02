import { computed, ref } from 'vue'
import { databaseService } from '../app/database'
import { parseQuestions } from './import'
import { isModelStopped, runTextModel, type ModelToolCall } from '../model/runner'
import type { ImportStepPreview, ImportTaskStep } from '../app/importTasks'
import { getQuizCards, parseQuizCards, resolveQuizTitle, saveQuizTitle } from '../../utils/question/quizPractice'
import { collectGraphNodes, extractMermaidSource } from '../../utils/study/studyGraph'
import {
  hostnameOf,
  listAppBrowsers,
} from '../browser/appBrowser'
import { clipAgentDebug, logAgentDebug, writeBrowserTranscript } from './debugLog'
import { emitStudyGraphStream, finishStudyGraphStream, studyGraphStream } from '../study/graphStream'
import { runStudyProgressEvaluation } from '../study/progressAgent'
import { finalizeStudySessionSummary } from '../study/timelineSummary'
import { describeActivity } from './activity'
import { executeChatTool } from './executeChatTool'
import { GRAPH_QUALITY, KEEP_GRAPH_HINT, graphSubjectHint, lastStudyFocus } from './studyHelpers'
import type {
  AgentChatAttachment,
  AgentChatMessage,
  AgentChatSession,
  AgentQuizAttempt,
} from './chatTypes'
import {
  AGENT_CONTEXT_COMPACT_AT,
  AGENT_CONTEXT_LIMIT,
  CONTEXT_COMPACT_INPUT_TOKENS,
  CONTEXT_COMPACT_MIN_MESSAGES,
  CONTEXT_COMPACT_MSG_CHARS,
  CONTEXT_KEEP_MIN_MESSAGES,
  CONTEXT_KEEP_TOKENS,
  contextSummaryPrompt,
  estimateAgentContext,
  estimateTextTokens,
  splitCompactedHistory,
} from './context'
import {
  encodeFolderToken,
  expandFolderTokens,
  extractFolderAttachments,
  isFileAttachment,
  isFolderAttachment,
  isImageAttachment,
  parseFolderTokens,
  parseMessageParts,
} from './folderTokens'
import { parseToolArgs } from './toolArgs'
import {
  TOOL_ARGS_KEEP,
  TOOL_RESULT_KEEP,
  assistantTurnToHistory,
  buildModelHistory,
  clipToolText,
  clipTranscript,
  messageHistoryText,
} from './modelHistory'
import { buildBrowserSystemPrompt, buildLearningSystemPrompt } from './prompts'
import {
  getEnabledSkillCatalog,
  getSkillPromptBlocksByIds,
  matchSkillsForText,
} from './agentSkills'
import { BROWSER_TOOLS, CHAT_TOOLS } from './tools'
import {
  recoverSiteAccountsFromTexts,
  rememberAccountsFromUserText,
  siteAccountsPrompt,
} from './siteAccounts'
import { siteGraphAgentContext } from '../browser/siteGraph'
import { ensureStudyWatch, liveStudyPlayback } from '../chaoxing/browser/playback'
import {
  stopChaoxingWatch,
} from '../chaoxing/browser/watch'
import { bindChaoxingWatchAgent, dropWatchQueue, flushWatchAfterTurn } from '../chaoxing/browser/watchAgent'

export type {
  AgentChatAttachment,
  AgentChatMessage,
  AgentChatSession,
  AgentContextSummary,
  AgentContextUsage,
  AgentQuizAttempt,
  AgentStudyEvalNote,
} from './chatTypes'
export {
  encodeFolderToken,
  expandFolderTokens,
  extractFolderAttachments,
  isFileAttachment,
  isFolderAttachment,
  isImageAttachment,
  parseFolderTokens,
  parseMessageParts,
} from './folderTokens'
export type { AgentMessagePart } from './folderTokens'
export { hydrateQuizCards } from './quizTools'

const STORAGE_KEY = 'zerror-agent-chat-sessions'
const CHAT_LIST_COLLAPSED_KEY = 'zerror-chat-list-collapsed'
const sessions = ref<AgentChatSession[]>([])
const activeId = ref<string | null>(null)
export const chatListCollapsed = ref(false)

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
const chatAborts = new Map<string, AbortController>()

const loadPersisted = () => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const parsed = JSON.parse(raw) as AgentChatSession[]
    if (!Array.isArray(parsed)) return
    sessions.value = parsed.slice(0, 30).map((session) => ({
      ...session,
      attachments: Array.isArray(session.attachments) ? session.attachments : undefined,
      studySubjectId: Number(session.studySubjectId) > 0 ? Number(session.studySubjectId) : undefined,
      browserId: String(session.browserId || '').trim() || undefined,
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
    activeId.value = sessions.value.find((session) => !session.browserId)?.id || null
  } catch {
    sessions.value = []
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

const persist = () => {
  const toPayload = (stripImages: boolean) =>
    sessions.value.slice(0, 30).map((session) => ({
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
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(toPayload(false)))
  } catch {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(toPayload(true)))
    } catch {
      // ignore quota
    }
  }
  const latestBrowser = sessions.value
    .filter((session) => session.browserId)
    .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]
  writeBrowserTranscript(latestBrowser)
}

loadPersisted()

export const chatSessions = computed(() => sessions.value.filter((session) => !session.browserId))
export const browserChatSessions = computed(() => sessions.value.filter((session) => session.browserId))
export const activeChatId = computed(() => activeId.value)
export const activeChat = computed(
  () => sessions.value.find((session) => session.id === activeId.value) || null
)
const sessionIsStreaming = (session?: AgentChatSession | null) =>
  Boolean(session?.messages.some((message) => message.status === 'streaming'))

export const runningChatCount = computed(() =>
  sessions.value.filter((session) => sessionIsStreaming(session)).length
)
export const isChatBusy = computed(() => runningChatCount.value > 0)

export {
  AGENT_CONTEXT_COMPACT_AT,
  AGENT_CONTEXT_LIMIT,
  estimateAgentContext,
}

const firstFileAttachment = (items?: AgentChatAttachment[]) =>
  items?.find(isFileAttachment) || null

const sessionAttachment = (sessionId: string) => {
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

const sessionFolders = (sessionId: string) => {
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

const describeFolders = (items?: AgentChatAttachment[]) => {
  const folders = (items || []).filter(isFolderAttachment)
  if (!folders.length) return ''
  const lines = folders.map((item) => {
    const path = item.folderPath || item.folderName || item.fileName || '文件夹'
    return `- ${path}（folder_id=${item.folderId}）`
  })
  return `\n\n指定文件夹：\n${lines.join('\n')}`
}

const browserStatePrefix = async (sessionId: string) => {
  const browserId = String(sessions.value.find((item) => item.id === sessionId)?.browserId || '').trim()
  if (!browserId) return ''
  const item = listAppBrowsers().find((browser) => browser.id === browserId)
  const name = item?.name || item?.title || hostnameOf(item?.url || '')
  const url = item?.url || ''
  const accountLine = siteAccountsPrompt()
  const graphLine = siteGraphAgentContext(url)
  return [
    `【网页状态】当前对话挂着浏览器「${name}」（browser_id=${browserId}）${url ? `，网址 ${url}` : ''}。`,
    accountLine,
    graphLine,
    '要看页或操作请调用工具，不要只口头说已经做了。',
  ].filter(Boolean).join(' ') + '\n\n'
}

const studyStatePrefix = async (sessionId: string) => {
  const id = Number(sessions.value.find((item) => item.id === sessionId)?.studySubjectId)
  if (!Number.isFinite(id) || id <= 0) return ''
  try {
    const subjects = await databaseService.listStudySubjects()
    const subject = subjects.find((item) => item.id === id)
    if (!subject) return ''
    const pct = Math.round((Number(subject.progress) || 0) * 100)
    return `【学习状态】当前对话挂着科目「${subject.name}」（subject_id=${subject.id}）。掌握进度 ${pct}%，约 ${subject.node_count || 0} 个知识点。讲解、出题、改图谱时默认用这个科目，不要另建同名科目。订正或复习错题时调用 list_recent_wrong_questions。\n\n`
  } catch {
    return ''
  }
}

const modelUserContent = (text: string, items?: AgentChatAttachment[]) => {
  const expanded = expandFolderTokens(text, items)
  const mentioned = new Set(parseFolderTokens(text).map((item) => item.folderId))
  const extra = (items || []).filter((item) => (
    isFolderAttachment(item)
    && item.folderId != null
    && !mentioned.has(item.folderId)
  ))
  return `${expanded}${describeFolders(extra)}`
}

const toMultimodalUserContent = (text: string, items?: AgentChatAttachment[]) => {
  const modelPrompt = modelUserContent(text, items)
  const images = (items || []).filter((item) => isImageAttachment(item) && item.imageUrl)
  if (!images.length) return modelPrompt
  return [
    ...images.map((item) => ({
      type: 'image_url',
      image_url: { url: item.imageUrl, detail: 'high' },
    })),
    { type: 'text', text: modelPrompt },
  ]
}

const patchSession = (sessionId: string, mutate: (session: AgentChatSession) => AgentChatSession) => {
  sessions.value = sessions.value.map((session) => (session.id === sessionId ? mutate(session) : session))
  persist()
}

const patchMessage = (sessionId: string, messageId: string, patch: Partial<AgentChatMessage>) => {
  patchSession(sessionId, (session) => ({
    ...session,
    updatedAt: Date.now(),
    messages: session.messages.map((message) =>
      message.id === messageId ? { ...message, ...patch } : message
    ),
  }))
}

const addStep = (sessionId: string, messageId: string, step: ImportTaskStep) => {
  const contentLen = sessions.value
    .find((item) => item.id === sessionId)
    ?.messages.find((message) => message.id === messageId)
    ?.content.length ?? 0
  const anchored: ImportTaskStep = {
    ...step,
    atContentLength: typeof step.atContentLength === 'number' ? step.atContentLength : contentLen,
  }
  patchSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) => {
      if (message.id !== messageId) return message
      if (message.steps.some((item) => item.id === anchored.id)) return message
      if (
        (anchored.name === 'get_file_info' || anchored.name === 'list_folders')
        && message.steps.some((item) => item.name === anchored.name)
      ) {
        return message
      }
      return { ...message, steps: [...message.steps, anchored] }
    }),
  }))
}

const patchStep = (sessionId: string, messageId: string, stepId: string, patch: Partial<ImportTaskStep>) => {
  patchSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) => {
      if (message.id !== messageId) return message
      return {
        ...message,
        steps: message.steps.map((step) => (step.id === stepId ? { ...step, ...patch } : step)),
      }
    }),
  }))
}

const dropStep = (sessionId: string, messageId: string, stepId: string) => {
  patchSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) => {
      if (message.id !== messageId) return message
      return { ...message, steps: message.steps.filter((step) => step.id !== stepId) }
    }),
  }))
}

export const composerAttachments = ref<AgentChatAttachment[]>([])

const fileNameFromPath = (filePath: string) => filePath.split(/[\\/]/).pop() || '文件'

export const addComposerAttachment = (filePath: string) => {
  const path = String(filePath || '').trim()
  if (!path) return
  if (composerAttachments.value.some((item) => item.filePath === path)) return
  composerAttachments.value = [
    ...composerAttachments.value,
    { kind: 'file', filePath: path, fileName: fileNameFromPath(path) },
  ]
}

const MAX_COMPOSER_IMAGES = 4

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

const matchSubjectInText = <T extends { id: number; name: string }>(text: string, subjects: T[]) => {
  const raw = String(text || '')
  const ranked = subjects
    .filter((item) => item.name && item.name.length >= 2 && raw.includes(item.name))
    .sort((a, b) => b.name.length - a.name.length)
  return ranked[0] || null
}

const attachStudyFromUserText = async (sessionId: string, text: string) => {
  const session = sessions.value.find((item) => item.id === sessionId)
  if (session?.studySubjectId || session?.browserId) return
  try {
    const hit = matchSubjectInText(text, await databaseService.listStudySubjects())
    if (hit) setChatStudySubject(hit.id, sessionId)
  } catch {
    // ignore
  }
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
  persist()
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

const resolveFolderRef = async (input: {
  folderId: number
  folderName: string
  folderPath?: string
}) => {
  const folderId = Number(input.folderId)
  if (!Number.isFinite(folderId) || folderId < 0) return null
  const folderName = String(input.folderName || '').trim() || '文件夹'
  let folderPath = String(input.folderPath || folderName).trim()
  try {
    const parts = await databaseService.getFolderPath(folderId)
    if (parts.length) folderPath = parts.map((item) => item.name).join(' / ')
  } catch {
    // keep given path
  }
  const attachment: AgentChatAttachment = {
    kind: 'folder',
    filePath: `folder:${folderId}`,
    fileName: folderName,
    folderId,
    folderName,
    folderPath,
  }
  return {
    attachment,
    token: encodeFolderToken({ folderId, folderName, folderPath }),
  }
}

export const startFolderOrganizeChat = async (input: {
  folderId: number
  folderName: string
  folderPath?: string
}) => {
  const folder = await resolveFolderRef(input)
  if (!folder || folder.attachment.folderId === 0) return
  createChat({
    title: `整理 ${folder.attachment.folderName}`,
    attachments: [folder.attachment],
  })
  await sendChatMessage(
    `请整理 ${folder.token}。先查看这个文件夹的路径、子文件夹和题目，再按题目内容归类：该新建子文件夹就新建，该移动的题目就移动，该重命名就重命名。不要删除题目或文件夹。整理完用一两句话说明做了什么。`,
    [folder.attachment],
  )
}

export const startStudySubjectChat = async (input: {
  subjectId: number
  subjectName?: string
}) => {
  const id = Number(input.subjectId)
  const name = String(input.subjectName || '').trim()
  if (!Number.isFinite(id) || id <= 0) return
  try {
    localStorage.setItem('zerror-study-subject', String(id))
  } catch {
    // ignore
  }
  window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'agent' }))
  createChat({
    title: name ? `学习 ${name}` : '学习',
    studySubjectId: id,
  })
  await sendChatMessage(
    name
      ? `我现在开始学习「${name}」。根据我的学习进度学习。`
      : '根据我的学习进度学习。',
  )
}

export const startStudyGraphChat = async (input?: {
  subjectId?: number
  subjectName?: string
  rebuild?: boolean
}) => {
  const name = String(input?.subjectName || '').trim()
  const id = Number(input?.subjectId)
  const rebuild = Boolean(input?.rebuild)
  window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'agent' }))
  if (Number.isFinite(id) && id > 0) {
    const existing = await databaseService.getStudyGraph(id).catch(() => null)
    const nodes = existing?.nodes || []
    emitStudyGraphStream({
      subjectId: id,
      mermaid: `flowchart TB\nsubject["${name || '知识图谱'}"]`,
      streaming: true,
    })
    createChat({ title: `知识图谱 ${name || id}`, studySubjectId: id })
    if (rebuild && nodes.length) {
      try {
        await databaseService.setStudyGraph(id, [])
        window.dispatchEvent(new CustomEvent('study-graph-updated', { detail: { subjectId: id } }))
      } catch {
        // 清不掉也继续，按重画提示生成
      }
    }
    if (!nodes.length || rebuild) {
      await sendChatMessage(
        `请为学习科目「${name || '未命名'}」（subject_id=${id}）从零绘制知识图谱。${GRAPH_QUALITY}
${graphSubjectHint(name)}
用 patch_knowledge_graph，subject_id=${id}，add 里每次放 3–8 个节点。先写章，再给章补节。不要调用空的 set_knowledge_graph，不要问确认。画完用一两句话说明。`,
      )
      return
    }
    const chapters = nodes.filter((item) => !item.parent_id).map((item) => item.name).slice(0, 16).join('、')
    await sendChatMessage(
      `科目「${name || '未命名'}」（subject_id=${id}）已经有 ${nodes.length} 个节点。先 get_knowledge_graph。
${KEEP_GRAPH_HINT}
已有章：${chapters || '（见工具返回）'}
用户点了绘制：只补缺的章/节，或按这句话里的具体要求增删改。不要重画整张图，不要 set_knowledge_graph。
${graphSubjectHint(name)}
用 patch_knowledge_graph。做完用一两句话说明补了什么。`,
    )
    return
  }
  createChat({ title: '知识图谱' })
  await sendChatMessage(
    `请帮我在学习页处理知识图谱。先 list_subjects；有合适科目就 get_knowledge_graph。
已有图谱就按用户要求 patch，不要重画。没有科目或图谱为空再 create_subject 并从零画。
${GRAPH_QUALITY}`,
  )
}

export const ensureBrowserChat = (input: { browserId: string; title?: string }) => {
  const browserId = String(input.browserId || '').trim()
  if (!browserId) return null
  const existing = sessions.value.find((item) => item.browserId === browserId)
  if (existing) return existing
  return createChat({
    title: input.title || '网页助手',
    browserId,
    activate: false,
  })
}

export const startFileImportChat = async (input: {
  filePath: string
  folderId: number
  folderName: string
  folderPath?: string
}) => {
  const fileName = input.filePath.split(/[\\/]/).pop() || '文件'
  const folder = await resolveFolderRef(input)
  const fileAttachment: AgentChatAttachment = {
    kind: 'file',
    filePath: input.filePath,
    fileName,
    folderId: folder?.attachment.folderId,
    folderName: folder?.attachment.folderName,
    folderPath: folder?.attachment.folderPath,
  }
  const attachments = folder ? [fileAttachment, folder.attachment] : [fileAttachment]
  createChat({
    title: `导入 ${fileName}`,
    attachments,
  })
  await sendChatMessage(
    folder
      ? `请把附件「${fileName}」里的题目识别出来，保存到 ${folder.token}。`
      : `请把附件「${fileName}」里的题目识别出来，保存到「${input.folderName}」。`,
    attachments,
  )
}

const finalizeStopped = (sessionId: string, messageId: string) => {
  patchSession(sessionId, (session) => ({
    ...session,
    updatedAt: Date.now(),
    messages: session.messages.map((message) => {
      if (message.id !== messageId) return message
      return {
        ...message,
        status: 'stopped' as const,
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

export const stopChat = (id?: string) => {
  const sessionId = id || activeId.value
  if (!sessionId) return
  const abort = chatAborts.get(sessionId)
  const session = sessions.value.find((item) => item.id === sessionId)
  const message = session?.messages.find((item) => item.status === 'streaming')
  if (session && message) finalizeStopped(session.id, message.id)
  if (abort && !abort.signal.aborted) abort.abort()
  chatAborts.delete(sessionId)
  dropWatchQueue(sessionId)
  if (session?.browserId) stopChaoxingWatch(session.browserId)
}

/** 用户在面板上手动切章/播视频时打断该窗口 Agent 与播放监控 */
export const stopBrowserAgent = (browserId?: string) => {
  const id = String(browserId || '').trim()
  if (!id) return
  const session = sessions.value.find((item) => item.browserId === id)
  if (session) {
    stopChat(session.id)
    return
  }
  stopChaoxingWatch(id)
}

export const removeChat = (id: string) => {
  if (sessionIsStreaming(sessions.value.find((session) => session.id === id))) {
    stopChat(id)
  }
  sessions.value = sessions.value.filter((session) => session.id !== id)
  if (activeId.value === id) activeId.value = sessions.value.find((session) => !session.browserId)?.id || null
  persist()
}

export const clearBrowserChat = (browserId: string) => {
  const id = String(browserId || '').trim()
  if (!id) return
  stopChaoxingWatch(id)
  const session = sessions.value.find((item) => item.browserId === id)
  if (!session) return
  if (sessionIsStreaming(session)) stopChat(session.id)
  patchSession(session.id, (current) => ({
    ...current,
    messages: [],
    contextSummary: undefined,
    updatedAt: Date.now(),
  }))
}

export const formatQuizAttempt = (attempt: AgentQuizAttempt) => {
  const n = attempt.index && attempt.total ? `第 ${attempt.index}/${attempt.total} 题` : '这道练习'
  const id = attempt.question_id ? ` #${attempt.question_id}` : ''
  const result = attempt.correct == null ? '已作答' : attempt.correct ? '答对了' : '答错了'
  const last = Boolean(attempt.index && attempt.total && attempt.index >= attempt.total)
  const lines = [
    `${n}${id}`,
    '',
    attempt.question,
  ]
  if (attempt.options) lines.push('', attempt.options)
  lines.push('', `我选：${attempt.selected || '未选'}`, `对错：${result}`)
  if (attempt.answer) lines.push(`参考答案：${attempt.answer}`)
  if (attempt.explanation) lines.push(`题库解析：${attempt.explanation}`)
  if (attempt.note) lines.push(`备注：${attempt.note}`)
  lines.push('')
  lines.push(last
    ? '这是本轮最后一题。请针对我这一题的选择做评判和解析，可以一句话小结本轮，不要再出新题。'
    : '请针对我这一题的选择做评判和解析。不要出新题，我还在右侧继续做。')
  return lines.join('\n')
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

const isGraphCatalogMessage = (item: AgentChatMessage) => {
  if (item.role !== 'assistant') return false
  const drew = (item.steps || []).some((step) =>
    ['patch_knowledge_graph', 'set_knowledge_graph', 'create_subject'].includes(step.name),
  )
  const text = String(item.content || '')
  return drew && /知识图谱|共\s*\d+\s*章|覆盖从/.test(text)
}

const formatQuizEvidence = (item: AgentChatMessage) =>
  (item.quizAttempts || [])
    .filter((attempt) => attempt.kind !== 'note')
    .map((attempt) => {
      const mark = attempt.correct === true ? '对' : attempt.correct === false ? '错' : '已答'
      const n = attempt.index && attempt.total ? `第${attempt.index}/${attempt.total}题` : '练习'
      return `${n}「${String(attempt.question || '').slice(0, 80)}」答${mark}（选${attempt.selected || '未选'}，答案${attempt.answer || ''}）`
    })
    .join('；')

const collectRecentTurns = (sessionId: string, limit = 8) => {
  const messages = sessions.value.find((item) => item.id === sessionId)?.messages || []
  const usable = messages.filter((item) => (
    String(item.content || '').trim()
    || formatQuizEvidence(item)
  ) && !isGraphCatalogMessage(item))
  const turns = usable
    .slice(-limit)
    .map((item, index, items) => {
      const latestTeach = index === items.length - 1 && item.role === 'assistant'
      const max = latestTeach ? 1800 : 500
      const quiz = formatQuizEvidence(item)
      const tools = item.role === 'assistant' ? messageHistoryText({ ...item, content: '' }).slice(0, 800) : ''
      return [
        `${item.role === 'user' ? '用户' : '助手'}：${String(item.content || '').slice(0, max)}`,
        tools ? `工具：${tools}` : '',
        quiz ? `作答记录：${quiz}` : '',
      ].filter(Boolean).join('\n')
    })
    .join('\n')
  const quizLog = messages
    .flatMap((item) => item.quizAttempts || [])
    .filter((attempt) => attempt.kind !== 'note')
    .slice(-12)
    .map((attempt) => {
      const mark = attempt.correct === true ? '对' : attempt.correct === false ? '错' : '已答'
      const n = attempt.index && attempt.total ? `第${attempt.index}/${attempt.total}题` : '练习'
      return `${n}「${String(attempt.question || '').slice(0, 80)}」答${mark}`
    })
    .join('；')
  return [turns, quizLog ? `本轮作答摘要：${quizLog}` : ''].filter(Boolean).join('\n')
}

const COMPACT_SYSTEM = '你是对话归档员。把给定的对话压成结构化中文摘要，只保留后续对话还需要用到的信息。不要评论，不要写开场白。'

const compactPrompt = (previous: string, transcript: string, browser = false) => [
  previous ? `已有摘要（要和新内容合并，别丢掉里面的结论）：\n${previous}\n` : '',
  `需要归档的对话：\n${transcript}\n`,
  '输出合并后的摘要，1200 字以内，按下面的小标题分段，没有内容的标题写「无」：',
  ...(browser
    ? [
      '【用户目标】',
      '【打开过的页面】',
      '【工具调用与失败】（工具名、关键参数、error）',
      '【待办与约定】',
    ]
    : [
      '【用户背景与目标】',
      '【已讲解的知识点】',
      '【出过的题与作答情况】',
      '【已完成的操作】（导入题目、改图谱、建科目等，带上关键 id 或名称）',
      '【待办与约定】',
    ]),
  '只输出摘要正文。',
].filter(Boolean).join('\n')

// 从后往前留够近期原文，剩下的交给摘要。返回第一条保留原文的下标。
const pickCompactBoundary = (kept: AgentChatMessage[]) => {
  let tokens = 0
  let start = kept.length
  for (let i = kept.length - 1; i >= 0; i -= 1) {
    const size = estimateTextTokens(messageHistoryText(kept[i]))
    const overMin = kept.length - i > CONTEXT_KEEP_MIN_MESSAGES
    if (overMin && tokens + size > CONTEXT_KEEP_TOKENS) break
    tokens += size
    start = i
  }
  // 保留段以用户提问开头，模型看到的对话不会从助手发言开始
  if (start < kept.length && kept[start].role !== 'user') start += 1
  return start
}

const buildCompactTranscript = (messages: AgentChatMessage[]) => {
  const items = messages.flatMap((message) => {
    const text = messageHistoryText(message).trim()
    const quiz = formatQuizEvidence(message)
    if (!text && !quiz) return []
    const line = [
      `${message.role === 'user' ? '用户' : '助手'}：${text.slice(0, CONTEXT_COMPACT_MSG_CHARS)}`,
      quiz ? `作答记录：${quiz}` : '',
    ].filter(Boolean).join('\n')
    return [{ line, tokens: estimateTextTokens(line) }]
  })
  // 超出单次归档预算就丢最早的，那部分通常已被上一版摘要覆盖
  let total = items.reduce((sum, item) => sum + item.tokens, 0)
  let from = 0
  while (from < items.length - 1 && total > CONTEXT_COMPACT_INPUT_TOKENS) {
    total -= items[from].tokens
    from += 1
  }
  return items.slice(from).map((item) => item.line).join('\n\n')
}

const compactInFlightIds = ref<string[]>([])

export const contextCompacting = computed(() => {
  const id = activeChat.value?.id
  return Boolean(id && compactInFlightIds.value.includes(id))
})

const runContextCompaction = async (sessionId: string) => {
  const session = sessions.value.find((item) => item.id === sessionId)
  if (!session) return
  const { summary, kept } = splitCompactedHistory(session)
  const start = pickCompactBoundary(kept)
  if (start < CONTEXT_COMPACT_MIN_MESSAGES) return
  const archived = kept.slice(0, start)
  if (archived.some((item) => item.status === 'streaming')) return
  const transcript = buildCompactTranscript(archived)
  if (!transcript) return
  const text = await runTextModel(
    compactPrompt(summary?.text || '', transcript, Boolean(session.browserId)),
    () => undefined,
    {
      timeoutMs: 4 * 60 * 1000,
      tools: [],
      systemPrompt: COMPACT_SYSTEM,
      useAgentModel: true,
      maxRounds: 1,
    },
  )
  const clean = String(text || '').trim()
  if (!clean) return
  const coveredThrough = archived[archived.length - 1].id
  patchSession(sessionId, (current) => {
    // 压缩期间可能又聊了几轮，只要边界消息还在，摘要就仍然对得上
    if (!current.messages.some((item) => item.id === coveredThrough)) return current
    return {
      ...current,
      contextSummary: {
        text: clean,
        coveredThrough,
        coveredCount: (summary?.coveredCount || 0) + archived.length,
        tokens: estimateTextTokens(clean),
        updatedAt: Date.now(),
      },
    }
  })
}

export const maybeCompactContext = (sessionId: string) => {
  const session = sessions.value.find((item) => item.id === sessionId)
  if (!session || compactInFlightIds.value.includes(sessionId)) return
  if (sessionIsStreaming(session)) return
  if (estimateAgentContext(session).used < AGENT_CONTEXT_COMPACT_AT) return
  compactInFlightIds.value = [...compactInFlightIds.value, sessionId]
  void runContextCompaction(sessionId)
    .catch((error) => {
      console.warn('[agent] 上下文压缩失败', error)
    })
    .finally(() => {
      compactInFlightIds.value = compactInFlightIds.value.filter((id) => id !== sessionId)
    })
}

const EVAL_COOLDOWN_MS = 16_000
const evalStartedAt = new Map<string, number>()
const evalInFlightIds = ref<string[]>([])

export const studyEvalRunning = computed(() => {
  const id = activeChat.value?.id
  return Boolean(id && evalInFlightIds.value.includes(id))
})

const markEvalStart = (sessionId: string) => {
  if (evalInFlightIds.value.includes(sessionId)) return
  evalInFlightIds.value = [...evalInFlightIds.value, sessionId]
}

const markEvalEnd = (sessionId: string) => {
  if (!evalInFlightIds.value.includes(sessionId)) return
  evalInFlightIds.value = evalInFlightIds.value.filter((id) => id !== sessionId)
}

const NAV_EVAL_TOOLS = new Set([
  'open_knowledge_graph',
  'focus_knowledge_graph',
  'list_subjects',
  'get_subject',
  'attach_study_subject',
  'detach_study_subject',
  'create_subject',
  'rename_subject',
  'delete_subject',
  'set_knowledge_graph',
  'patch_knowledge_graph',
  'get_knowledge_graph',
  'list_folders',
  'get_folder_info',
  'get_file_info',
  'list_questions',
  'search_questions',
  'list_recent_wrong_questions',
  'get_practice_history',
  'list_knowledge_questions',
  'present_quiz',
  'get_campus_status',
  'list_campus_courses',
  'list_campus_papers',
  'list_campus_questions',
  'search_campus_questions',
  'list_campus_tags',
])

const lastUserText = (sessionId: string) => {
  const messages = sessions.value.find((item) => item.id === sessionId)?.messages || []
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && String(messages[i].content || '').trim()) {
      return String(messages[i].content)
    }
  }
  return ''
}

const shouldAutoEvalStudy = (sessionId: string, message: AgentChatMessage) => {
  const session = sessions.value.find((item) => item.id === sessionId)
  const subjectId = Number(session?.studySubjectId)
  if (!Number.isFinite(subjectId) || subjectId <= 0) return { yes: false, force: false, subjectId: 0 }
  if (message.status !== 'done') return { yes: false, force: false, subjectId }
  if (isGraphCatalogMessage(message)) return { yes: false, force: false, subjectId }
  if ((message.steps || []).some((step) => step.name === 'evaluate_study_progress')) {
    return { yes: false, force: false, subjectId }
  }

  const userText = lastUserText(sessionId)
  const asked = /学过|复习过|复习了|忘了|忘记|不记得|记得|进度|掌握|保持率|不会|生疏|印象/.test(userText)
  const quizTurn = /第\s*\d+\s*题|答对了|答错了|我选[：:]/.test(userText)
  const lastQuiz = /这是本轮最后一题/.test(userText)
  const tools = (message.steps || []).map((step) => step.name)
  const presentedQuiz = tools.includes('present_quiz')
  const onlyNav = tools.length > 0 && tools.every((name) => NAV_EVAL_TOOLS.has(name))
  const content = String(message.content || '').trim()
  const substantial = content.length >= 180 && !presentedQuiz

  if (asked) return { yes: true, force: true, subjectId }
  if (lastQuiz || (quizTurn && lastQuiz)) return { yes: true, force: false, subjectId }
  if (quizTurn && !lastQuiz) return { yes: false, force: false, subjectId }
  if (presentedQuiz) return { yes: false, force: false, subjectId }
  if (onlyNav && !substantial) return { yes: false, force: false, subjectId }
  if (substantial) return { yes: true, force: false, subjectId }
  return { yes: false, force: false, subjectId }
}

const applyEvalNotice = (
  sessionId: string,
  messageId: string,
  stepId: string,
  args: Record<string, unknown>,
  result: Awaited<ReturnType<typeof runStudyProgressEvaluation>>,
  force: boolean,
) => {
  const status = result.error ? 'failed' : 'done'
  const activity = describeActivity('evaluate_study_progress', args, status, result)
  patchStep(sessionId, messageId, stepId, {
    status,
    label: activity.label,
    target: activity.target,
    detail: result.error,
    finishedAt: Date.now(),
  })
  if (!result.error) dropStep(sessionId, messageId, stepId)
  patchMessage(sessionId, messageId, { studyEval: undefined })
}

const scheduleStudyProgressEval = (input: {
  sessionId: string
  messageId: string
  subjectId: number
  hint?: string
  force?: boolean
  stepId?: string
}) => {
  const sessionKey = input.sessionId
  if (evalInFlightIds.value.includes(sessionKey)) return
  const last = evalStartedAt.get(sessionKey) || 0
  if (!input.force && Date.now() - last < EVAL_COOLDOWN_MS) return
  evalStartedAt.set(sessionKey, Date.now())
  markEvalStart(sessionKey)

  const stepId = input.stepId || `auto-eval-${input.messageId}`
  const args = {
    subject_id: input.subjectId,
    hint: input.hint,
  }

  void runStudyProgressEvaluation({
    subjectId: input.subjectId,
    hint: input.hint,
    recentTurns: collectRecentTurns(input.sessionId),
  }).then((result) => {
    applyEvalNotice(input.sessionId, input.messageId, stepId, args, result, Boolean(input.force))
  }).catch((error) => {
    applyEvalNotice(input.sessionId, input.messageId, stepId, args, {
      updated: 0,
      subject_id: input.subjectId,
      message: error instanceof Error ? error.message : String(error),
      error: error instanceof Error ? error.message : String(error),
    }, true)
  }).finally(() => {
    markEvalEnd(sessionKey)
  })
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
    logAgentDebug(sessionId, { kind: session.browserId ? 'browser' : 'study', ...entry })
  if (options?.kind !== 'watch') await attachStudyFromUserText(sessionId, content)
  if (session.browserId) {
    rememberAccountsFromUserText(content)
    recoverSiteAccountsFromTexts(
      (session.messages || [])
        .filter((item) => item.role === 'user')
        .map((item) => String(item.content || '')),
    )
  }

  const abort = new AbortController()
  chatAborts.set(sessionId, abort)
  const attachments = files?.length ? files : undefined

  const userMessage: AgentChatMessage = {
    id: `user-${Date.now()}`,
    role: 'user',
    content,
    kind: options?.kind,
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

  patchSession(sessionId, (current) => ({
    ...current,
    title: current.title !== '新对话' || current.messages.length
      ? current.title
      : (attachments?.find(isFileAttachment)?.fileName || attachments?.[0]?.folderPath || attachments?.[0]?.fileName || content.slice(0, 24)),
    updatedAt: Date.now(),
    attachments: attachments?.length
      ? [
          ...attachments.filter((item) => !isImageAttachment(item)),
          ...(current.attachments || []).filter((item) => !attachments.some((file) => file.filePath === item.filePath)),
        ]
      : current.attachments,
    messages: [...current.messages, userMessage, assistantMessage],
  }))

  const compacted = splitCompactedHistory(sessions.value.find((item) => item.id === sessionId))
  const history = buildModelHistory(
    compacted.kept.filter((message) => message.id !== assistantId && message.id !== userMessage.id),
    (message) => toMultimodalUserContent(message.content, message.attachments),
  )
  const browserId = String(sessions.value.find((item) => item.id === sessionId)?.browserId || '').trim()
  const isBrowserChat = Boolean(browserId)
  const skillMatchText = String(options?.modelText || '').trim() || content
  const skillCatalog = getEnabledSkillCatalog()
  const matchedSkillIds = matchSkillsForText(skillMatchText)
  const preloadedSkillBlocks = await getSkillPromptBlocksByIds(matchedSkillIds)
  const baseSystemPrompt = isBrowserChat
    ? buildBrowserSystemPrompt({ catalog: skillCatalog, preloadedBlocks: preloadedSkillBlocks })
    : buildLearningSystemPrompt({ catalog: skillCatalog, preloadedBlocks: preloadedSkillBlocks })
  const turnSystemPrompt = `${baseSystemPrompt}${contextSummaryPrompt(compacted.summary)}`
  const hasFile = Boolean(sessionAttachment(sessionId))
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
  const studyPrefix = isBrowserChat ? await browserStatePrefix(sessionId) : await studyStatePrefix(sessionId)
  const isQuizReviewTurn = /^第\s*\d+/.test(content)
  const wantsNewQuiz = !isQuizReviewTurn && /出题|练习|巩固|继续下一|下一[章节]|^继续$|^接着|^再来|^再出/.test(content.trim())
  const quizNudge = wantsNewQuiz
    ? '\n\n【出题】用户这句话是要继续学并出可点选练习。必须调用 present_quiz，自己出 3–5 道选择题（带题干、选项、答案、解析和 node_name）。调用成功前禁止说已出示、请看右侧或假装题已经出来。'
    : ''
  const promptBody = String(options?.modelText || '').trim() || content
  const modelPrompt = `${studyPrefix}${modelUserContent(promptBody, promptFolders)}${quizNudge}`
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

  let drawingGraph = false
  const streamSubjectId = Number(
    String(content).match(/subject_id\s*=\s*(\d+)/)?.[1]
    || sessions.value.find((item) => item.id === sessionId)?.studySubjectId,
  )

  try {
    const liveMessage = () =>
      sessions.value.find((item) => item.id === sessionId)
        ?.messages.find((message) => message.id === assistantId)
    const historyWithCurrent = (spoken: string) => [
      ...history,
      { role: 'user', content: modelPrompt },
      ...assistantTurnToHistory({
        id: assistantId,
        role: 'assistant',
        content: spoken,
        steps: liveMessage()?.steps || [],
        status: 'streaming',
      }),
    ]

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
    const streamText = (text: string) => {
      const next = joinRound(text)
      if (!stripMarks(text).trim() && visibleText(liveContent())) {
        patchMessage(sessionId, assistantId, {
          waiting: awaitingTool,
          status: 'streaming',
        })
        return
      }
      if (next === spokenText && next === liveContent()) {
        patchMessage(sessionId, assistantId, {
          waiting: awaitingTool || !visibleText(next),
          status: 'streaming',
        })
        return
      }
      if (next.trim()) spokenText = next
      patchMessage(sessionId, assistantId, {
        content: next,
        waiting: awaitingTool || !visibleText(next),
        status: 'streaming',
      })
      const mermaid = extractMermaidSource(next)
      if (mermaid) {
        emitStudyGraphStream({
          subjectId: Number.isFinite(streamSubjectId) ? streamSubjectId : undefined,
          mermaid,
          streaming: true,
        })
      }
    }
    const waitForFirstToken = (clearContent = false) => {
      if (!clearContent) keepSpoken()
      patchMessage(sessionId, assistantId, {
        ...(clearContent ? { content: '' } : {}),
        waiting: true,
        status: 'streaming',
      })
    }

    const onDelta = (delta: string) => {
      if (abort.signal.aborted || liveMessage()?.status !== 'streaming') return
      streamText(delta)
    }
    const runOptions = {
      timeoutMs: isBrowserChat || hasFile || images.length ? 15 * 60 * 1000 : 5 * 60 * 1000,
      userContent,
      signal: abort.signal,
      tools: isBrowserChat ? BROWSER_TOOLS : CHAT_TOOLS,
      systemPrompt: turnSystemPrompt,
      useAgentModel: true,
      history,
      maxRounds: isBrowserChat || hasFile || images.length ? 80 : 32,
      onTurnTranscript: (items) => {
        const prev = liveMessage()?.transcript || []
        patchMessage(sessionId, assistantId, {
          transcript: clipTranscript([...prev, ...items]),
        })
      },
      executeTool: async (call: ModelToolCall) => {
        return executeChatTool({
          call,
          ctx: {
            sessionId,
            assistantId,
            abort: abort.signal,
            browserId: () => String(sessions.value.find((item) => item.id === sessionId)?.browserId || '').trim(),
            attachment: () => sessionAttachment(sessionId),
            folders: () => sessionFolders(sessionId),
            studySubjectId: () => {
              const id = Number(sessions.value.find((item) => item.id === sessionId)?.studySubjectId)
              return Number.isFinite(id) && id > 0 ? id : undefined
            },
            setStudySubject: (subjectId) => setChatStudySubject(subjectId, sessionId),
            markDrawingGraph: () => { drawingGraph = true },
            scheduleEval: (input) => scheduleStudyProgressEval({
              sessionId,
              messageId: assistantId,
              subjectId: input.subjectId,
              hint: input.hint,
              force: true,
              stepId: input.stepId,
            }),
            getTodos: () => sessions.value.find((item) => item.id === sessionId)?.todos
              || liveMessage()?.todos
              || [],
            setTodos: (todos) => {
              patchSession(sessionId, (session) => ({ ...session, todos, updatedAt: Date.now() }))
              patchMessage(sessionId, assistantId, { todos })
            },
          },
        })
      },
      onEvent: (event) => {
        if (abort.signal.aborted || liveMessage()?.status !== 'streaming') return
        if (event.type === 'round_start') {
          awaitingTool = false
          beginRound()
          waitForFirstToken(false)
          return
        }
        if (event.type === 'text') {
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
          addStep(sessionId, assistantId, {
            id: event.id,
            kind: 'tool',
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
            status: 'running',
            startedAt: Date.now(),
            arguments: clipToolText(event.arguments, TOOL_ARGS_KEEP),
          })
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
          patchStep(sessionId, assistantId, event.id, {
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
          })
          waitForFirstToken(false)
        }
      },
    }

    let finalText = await runTextModel(modelPrompt, onDelta, runOptions)
    if (isBrowserChat && !abort.signal.aborted && liveMessage()?.status === 'streaming') {
      const playbackNow = liveStudyPlayback(browserId)
      if (playbackNow.playing) ensureStudyWatch(browserId, sessionId, playbackNow)
    }
    const hasPresentedQuiz = () =>
      (liveMessage()?.steps || []).some((step) => step.name === 'present_quiz' && step.status === 'done')
    const quizTopicOf = (text: string) => {
      const names = [...String(text || '').matchAll(/「([^」]+)」/g)]
        .map((item) => String(item[1] || '').replace(/\s*(入门)?练习$/, '').trim())
        .filter(Boolean)
      return names[names.length - 1] || ''
    }
    const claimedQuiz = () => /出示|练习页|点选|作答会|入门练习|\d+\s*道题/.test(liveContent())
    const needsForcedQuiz = () => {
      if (hasPresentedQuiz() || isQuizReviewTurn) return false
      return claimedQuiz() || wantsNewQuiz
    }
    const parseDraftedQuestions = (text: string) => {
      const raw = String(text || '').trim()
      const start = raw.indexOf('[')
      const end = raw.lastIndexOf(']')
      if (start < 0 || end <= start) return []
      try {
        const items = JSON.parse(raw.slice(start, end + 1))
        if (!Array.isArray(items)) return []
        return items
          .filter((item) => item && item.question && item.answer)
          .slice(0, 5)
      } catch {
        return []
      }
    }
    const forcePresentQuiz = async (topic: string, questions?: unknown[]) => {
      const id = `auto-quiz-${Date.now()}`
      const title = topic ? `${topic} 练习` : '练习'
      const raw = JSON.stringify({
        title,
        node_name: topic || undefined,
        ...(questions?.length ? { questions } : { count: 5 }),
      })
      runOptions.onEvent?.({ type: 'tool_start', id, name: 'present_quiz', arguments: raw })
      let result = ''
      let error: string | undefined
      try {
        result = await runOptions.executeTool({ id, name: 'present_quiz', arguments: raw })
      } catch (caught) {
        error = caught instanceof Error ? caught.message : String(caught)
        result = `Error: ${error}`
      }
      runOptions.onEvent?.({ type: 'tool_end', id, name: 'present_quiz', result, error })
    }
    if (!isBrowserChat && !abort.signal.aborted && liveMessage()?.status === 'streaming' && needsForcedQuiz()) {
      keepSpoken()
      const topic = quizTopicOf(spokenText || liveContent())
        || lastStudyFocus.get(Number(sessions.value.find((item) => item.id === sessionId)?.studySubjectId))?.nodeName
        || ''
      debug({ type: 'quiz_followup', topic, reason: claimedQuiz() ? 'claimed without present_quiz' : 'asked without present_quiz' })
      const quizTools = CHAT_TOOLS.filter((item) =>
        ['present_quiz', 'focus_knowledge_graph', 'list_knowledge_questions'].includes(item.function.name),
      )
      finalText = await runTextModel(
        topic
          ? `右侧练习页现在是空的。立刻调用 present_quiz，自己出 3–5 道「${topic}」的选择题，title 用「${topic} 练习」，每题带 question、options、answer、explanation、node_name。不要只口头说已出示，不要再讲一遍。`
          : '右侧练习页现在是空的。立刻调用 present_quiz，自己出 3–5 道选择题，每题带 question、options、answer、explanation。不要只口头说已出示。',
        onDelta,
        {
          ...runOptions,
          tools: quizTools,
          userContent: undefined,
          history: historyWithCurrent(spokenText || liveContent()),
          maxRounds: 4,
        },
      )
      if (!hasPresentedQuiz() && !abort.signal.aborted) {
        const drafted = await runTextModel(
          topic
            ? `只输出 JSON 数组，不要其他文字。为「${topic}」出 5 道单选题，每项含 question、options（A. …\\nB. …）、answer（如 A）、explanation、question_type（单选）、node_name。`
            : '只输出 JSON 数组，不要其他文字。出 5 道当前进度相关的单选题，每项含 question、options、answer、explanation、question_type（单选）。',
          () => undefined,
          {
            timeoutMs: runOptions.timeoutMs,
            signal: abort.signal,
            tools: [],
            systemPrompt: '你只输出 JSON 数组，不要解释。',
            useAgentModel: true,
            history: historyWithCurrent(spokenText || liveContent()),
            maxRounds: 1,
          },
        )
        const questions = parseDraftedQuestions(drafted)
        debug({ type: 'quiz_fallback', topic, count: questions.length })
        if (questions.length) await forcePresentQuiz(topic, questions)
      }
    }

    if (abort.signal.aborted) {
      const current = sessions.value.find((item) => item.id === sessionId)
        ?.messages.find((message) => message.id === assistantId)
      if (current?.status === 'streaming') finalizeStopped(sessionId, assistantId)
      return
    }
    const liveNow = sessions.value.find((item) => item.id === sessionId)
      ?.messages.find((message) => message.id === assistantId)?.content || ''
    const assistantContent = visibleText(liveNow)
      ? liveNow
      : joinSpoken(finalText || '')
    const assistantSteps = sessions.value.find((item) => item.id === sessionId)
      ?.messages.find((message) => message.id === assistantId)?.steps || []
    debug({
      type: 'assistant',
      content: clipAgentDebug(assistantContent, 8000),
      steps: assistantSteps.map((step) => ({
        name: step.name,
        label: step.label,
        status: step.status,
        detail: step.detail,
      })),
    })
    patchMessage(sessionId, assistantId, {
      content: assistantContent,
      status: 'done',
    })
    const finished = sessions.value
      .find((item) => item.id === sessionId)
      ?.messages.find((message) => message.id === assistantId)
    if (finished && !sessions.value.find((item) => item.id === sessionId)?.browserId) {
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
    if (abort.signal.aborted || isModelStopped(error)) {
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
    flushWatchAfterTurn(sessionId)
  }
}

bindChaoxingWatchAgent({
  notify: (sessionId, display, modelText, files) => {
    void sendChatMessage(display, files, { sessionId, kind: 'watch', modelText })
  },
  gate: (sessionId) => {
    const session = sessions.value.find((item) => item.id === sessionId)
    if (!session) return 'missing'
    if (sessionIsStreaming(session) || chatAborts.has(sessionId)) return 'busy'
    return 'ready'
  },
})
