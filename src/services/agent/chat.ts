import { computed, ref } from 'vue'
import { databaseService } from '../app/database'
import { parseQuestions } from './import'
import { isModelStopped, runTextModel, type ModelToolCall } from '../model/runner'
import type { ImportStepPreview, ImportTaskStep } from '../app/importTasks'
import { getQuizCards, parseQuizCards, resolveQuizTitle, saveQuizTitle } from '../../utils/question/quizPractice'
import { collectGraphNodes, extractMermaidSource } from '../../utils/study/studyGraph'
import {
  getBrowserState,
  hostnameOf,
  listAppBrowsers,
  readChaoxingVideo,
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
  messagePlainText,
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
import { BROWSER_SYSTEM_PROMPT, SYSTEM_PROMPT } from './prompts'
import { BROWSER_TOOLS, CHAT_TOOLS } from './tools'
import {
  recoverSiteAccountsFromTexts,
  rememberAccountsFromUserText,
  siteAccountsPrompt,
} from './siteAccounts'
import { siteGraphAgentContext } from '../browser/siteGraph'
import { chapterStateFor } from '../chaoxing/browser/chapters'
import {
  formatVideoClock,
  stopChaoxingWatch,
  videoWatchFor,
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
      contextSummary: session.contextSummary?.text && session.contextSummary.coveredThrough
        ? session.contextSummary
        : undefined,
      messages: (session.messages || []).map((message) => ({
        ...message,
        attachments: Array.isArray(message.attachments) ? message.attachments : undefined,
        steps: Array.isArray(message.steps) ? message.steps : [],
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
        })),
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

const browserStatePrefix = async (sessionId: string, light = false) => {
  const browserId = String(sessions.value.find((item) => item.id === sessionId)?.browserId || '').trim()
  if (!browserId) return ''
  const item = listAppBrowsers().find((browser) => browser.id === browserId)
  const name = item?.name || item?.title || hostnameOf(item?.url || '')
  const url = item?.url || ''
  let playLine = '当前没有确认在播的视频。禁止说「正在播放」「视频仍在后台播放」。'
  const watch = videoWatchFor(browserId)
  const accountLine = siteAccountsPrompt()
  if (light && watch) {
    const clock = `${formatVideoClock(watch.current)} / ${formatVideoClock(watch.duration)}`
    const videos = watch.videoCount > 1
      ? ` 本章视频 ${watch.videoIndex || 1}/${watch.videoCount}${watch.moreVideos ? '，后面还有' : ''}`
      : ''
    playLine = watch.paused
      ? `监控中「${watch.title || '当前节'}」已暂停 ${clock}。${videos}`
      : `监控中「${watch.title || '当前节'}」在播 ${clock}。${videos}不要再点播放或读目录。`
    return `【网页状态】当前对话挂着浏览器「${name}」（browser_id=${browserId}）${url ? `，网址 ${url}` : ''}。${playLine}${accountLine ? ` ${accountLine}` : ''}\n\n`
  }
  try {
    const info = await readChaoxingVideo(browserId)
    if (info?.captcha) {
      playLine = '学习通弹出图片验证码（9010）。自己认图读出 4 位，立刻 browser_chaoxing_captcha 提交，然后继续刷课。不要问用户。'
    } else if (info?.quiz) {
      playLine = `当前是测验/作业（${info.step || info.current || ''}）。停下让用户自己做，不要点播放。`
    } else if (info?.video) {
      const clock = `${formatVideoClock(info.video.current)} / ${formatVideoClock(info.video.duration)}`
      const title = info.current || '当前节'
      const videos = Number(info.videoCount) > 1
        ? ` 本章视频 ${info.videoIndex || 1}/${info.videoCount}${info.moreVideos ? '，后面还有视频' : ''}`
        : ''
      if (info.video.paused || info.video.ended) {
        playLine = `当前节「${title}」视频没有在播（paused=${info.video.paused} ended=${info.video.ended} ${clock}）。${videos}禁止说正在播放。用户要看课就立刻 browser_chaoxing_play。`
      } else {
        playLine = `当前节「${title}」视频确认在播 ${clock}。${videos}`
      }
    }
  } catch {
    // keep default
  }
  return `【网页状态】当前对话挂着浏览器「${name}」（browser_id=${browserId}）${url ? `，网址 ${url}` : ''}。${playLine}${accountLine ? ` ${accountLine}` : ''} 读页面、点击、填写、跳转都必须调用工具，不要只口头说已经操作。\n\n`
}

/** 图谱 + 章节解析器：每次发给模型前刷新，不依赖用户是否再开口 */
const browserGraphParserContext = (sessionId: string) => {
  const browserId = String(sessions.value.find((item) => item.id === sessionId)?.browserId || '').trim()
  if (!browserId) return ''
  const url = String(listAppBrowsers().find((browser) => browser.id === browserId)?.url || '')
  const chapters = chapterStateFor(browserId)
  const chapterLine = chapters
    ? (chapters.unfinished.length
      ? `【章节解析】未完成 ${chapters.unfinishedCount}${chapters.progress ? `（任务点 ${chapters.progress.done}/${chapters.progress.total}）` : ''}：${chapters.unfinished.slice(0, 8).join('、')}${chapters.currentTitle ? `；当前「${chapters.currentTitle}」` : ''}。`
      : chapters.progress
        ? (chapters.progress.total > chapters.progress.done
          ? `【章节解析】已完成任务点 ${chapters.progress.done}/${chapters.progress.total}，还没对上节名。不要说全部完成，自己 get_page 解析。`
          : `【章节解析】已完成任务点 ${chapters.progress.done}/${chapters.progress.total}。`)
        : '【章节解析】解析器还没读到目录。这不等于做完，必须自己 get_page / eval 解析，不要说全部完成。')
    : '【章节解析】解析器未挂上。'
  const jobs = (chapters?.jobs || []).slice(0, 8)
  const jobLine = jobs.length
    ? `本节任务点：${jobs.map((job) => {
      const mark = job.jobDone ? '完成' : job.active ? '进行中' : '未完成'
      const clock = job.duration
        ? ` ${formatVideoClock(job.current || 0)}/${formatVideoClock(job.duration)} ${Math.round(job.percent || 0)}%`
        : ''
      return `${job.label}(${mark}${clock})`
    }).join('、')}。`
    : ''
  const graphLine = siteGraphAgentContext(url)
  return [graphLine, chapterLine, jobLine].filter(Boolean).join(' ')
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
      return [
        `${item.role === 'user' ? '用户' : '助手'}：${String(item.content || '').slice(0, max)}`,
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

const compactPrompt = (previous: string, transcript: string) => [
  previous ? `已有摘要（要和新内容合并，别丢掉里面的结论）：\n${previous}\n` : '',
  `需要归档的对话：\n${transcript}\n`,
  '输出合并后的摘要，1200 字以内，按下面的小标题分段，没有内容的标题写「无」：',
  '【用户背景与目标】',
  '【已讲解的知识点】',
  '【出过的题与作答情况】',
  '【已完成的操作】（导入题目、改图谱、建科目等，带上关键 id 或名称）',
  '【待办与约定】',
  '只输出摘要正文。',
].filter(Boolean).join('\n')

// 从后往前留够近期原文，剩下的交给摘要。返回第一条保留原文的下标。
const pickCompactBoundary = (kept: AgentChatMessage[]) => {
  let tokens = 0
  let start = kept.length
  for (let i = kept.length - 1; i >= 0; i -= 1) {
    const size = estimateTextTokens(messagePlainText(kept[i].content))
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
    const text = messagePlainText(message.content).trim()
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
    compactPrompt(summary?.text || '', transcript),
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
  const history: { role: string; content: unknown }[] = []
  for (const message of compacted.kept) {
    if (message.id === assistantId || message.id === userMessage.id) continue
    if (message.content) {
      history.push({
        role: message.role,
        content: message.role === 'user'
          ? toMultimodalUserContent(message.content, message.attachments)
          : message.content,
      })
    }
  }
  const browserId = String(sessions.value.find((item) => item.id === sessionId)?.browserId || '').trim()
  const isBrowserChat = Boolean(browserId)
  const turnSystemPrompt = `${isBrowserChat ? BROWSER_SYSTEM_PROMPT : SYSTEM_PROMPT}${contextSummaryPrompt(compacted.summary)}`
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
  const studyPrefix = isBrowserChat ? await browserStatePrefix(sessionId, options?.kind === 'watch') : await studyStatePrefix(sessionId)
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

    const visibleText = (text?: string) => Boolean(String(text || '').replace(/\u200B/g, '').trim())
    let awaitingTool = false
    let spokenText = ''
    const liveContent = () => String(liveMessage()?.content || '')
    const joinSpoken = (text: string) => {
      const piece = String(text || '').replace(/\u200B/g, '')
      if (!spokenText) return piece
      if (!piece.trim()) return spokenText
      if (piece === spokenText || piece.startsWith(spokenText)) return piece
      return `${spokenText}\n\n${piece}`
    }
    const keepSpoken = () => {
      const current = liveContent().trim()
      if (current) spokenText = current
    }
    const streamText = (text: string) => {
      const next = joinSpoken(text)
      if (!String(text || '').trim() && visibleText(liveContent())) {
        patchMessage(sessionId, assistantId, {
          waiting: awaitingTool,
          status: 'streaming',
        })
        return
      }
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
      liveContext: isBrowserChat
        ? () => browserGraphParserContext(sessionId)
        : undefined,
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
          },
        })
      },
      onEvent: (event) => {
        if (abort.signal.aborted || liveMessage()?.status !== 'streaming') return
        if (event.type === 'round_start') {
          awaitingTool = false
          waitForFirstToken(false)
          return
        }
        if (event.type === 'text') {
          streamText(event.text)
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
      const wantsHomework = /作业|答题|作答|应用高等数学/.test(content) && !/刷课|播完|播放视频/.test(content)
      const wantsCourse = /播放|视频|章节|未完成|刷课|看完|看一下.*课|这个课程|国家安全|进度检查|已完成/.test(content)
      const spoken = spokenText || liveContent()
      const steps = liveMessage()?.steps || []
      const usedNext = steps.some((step) => step.name === 'browser_chaoxing_next' && step.status === 'done')
      const usedPlay = steps.some((step) => step.name === 'browser_chaoxing_play' && step.status === 'done')
      const usedWatch = steps.some((step) => step.name === 'browser_chaoxing_watch' && step.status === 'done')
      const usedClick = steps.some((step) => (step.name === 'browser_click_text' || step.name === 'browser_click') && step.status === 'done')
      const claimedPlaying = /正在播放|仍在播放|后台播放/.test(spoken)
      const watchDoneTurn = options?.kind === 'watch' && /已完成|已经结束/.test(`${content}\n${options?.modelText || ''}`)
      const leftAfterSkip = /没有视频|学习资料|正在打开下一节|已切换到下一节/.test(spoken)
      const stoppedMid = /让我查看|已进入|下一步|章节目录|正在打开下一节/.test(spoken)
        && !/正在播放|任务点已完成|遇到测验|开始监控|已确认在播|打开并播放/.test(spoken)
      const liveWatch = videoWatchFor(browserId)
      const actuallyWatching = Boolean(liveWatch && (liveWatch.status === 'watching' || liveWatch.status === 'paused' || liveWatch.status === 'stalled'))
      const alreadyWatching = actuallyWatching || ((usedPlay || usedWatch) && !/没有|失败|无法/.test(spoken))
      const courseNudge = (
        '刷课是流程不是一键工具：课程页点「章节」→ browser_chaoxing_chapters 或 get_page 看未完成'
        + '→ click_text 干净节名 → 播放页 browser_chaoxing_play。不要问用户，不要打开 iframe 网址。'
      )
      const askedCaptcha = /请.*(输入|填写).*验证码|让用户.*验证码|停下.*验证码|用户看图|用户说填完/.test(spoken)
      const claimedAllDone = wantsCourse && !alreadyWatching && options?.kind !== 'watch'
        && /全部完成|没有未完成|无未完成|暂无任务|学习任务已全部完成|无需继续播放|章节列表为空|没有任何需要播放|已完成检查|跨域|无法读取|无法直接读取|无法继续操作|我将等待|等待您提供/.test(spoken)
      const fakePlaying = wantsCourse && claimedPlaying && !alreadyWatching && options?.kind !== 'watch'
      if (watchDoneTurn && !usedNext && (leftAfterSkip || stoppedMid || !steps.some((step) => step.name === 'browser_chaoxing_watch'))) {
        keepSpoken()
        debug({ type: 'browser_continue', reason: 'stopped before next video' })
        finalText = await runTextModel(
          '这节已经结束，但还没播上下一节视频。立刻 browser_chaoxing_next。资料/PDF 会自动跳过。不要只点「下一节」就停，不要再解释。',
          onDelta,
          {
            ...runOptions,
            maxRounds: 48,
            history: [
              ...history,
              { role: 'user', content: modelPrompt },
              { role: 'assistant', content: spoken },
            ],
          },
        )
      } else if (fakePlaying) {
        keepSpoken()
        debug({ type: 'browser_continue', reason: 'claimed playing without play' })
        finalText = await runTextModel(
          '当前并没有在播放。立刻 browser_chaoxing_play 确认 paused=false，不要再口头说正在播放或视频仍在后台播放。',
          onDelta,
          {
            ...runOptions,
            maxRounds: 48,
            history: [
              ...history,
              { role: 'user', content: modelPrompt },
              { role: 'assistant', content: spoken },
            ],
          },
        )
      } else if (wantsCourse && !alreadyWatching && options?.kind !== 'watch' && /请确认|您可以提供|无法自动定位|无法找到|建议：|请手动|告诉我具体|请告诉我|截图|配合提供|无法直接看到|请提供当前页面|跨域/.test(spoken)) {
        keepSpoken()
        debug({ type: 'browser_continue', reason: 'asked user instead of play' })
        finalText = await runTextModel(courseNudge, onDelta, {
          ...runOptions,
          maxRounds: 48,
          history: [
            ...history,
            { role: 'user', content: modelPrompt },
            { role: 'assistant', content: spoken },
          ],
        })
      } else if (askedCaptcha) {
        keepSpoken()
        debug({ type: 'browser_continue', reason: 'asked user to fill captcha' })
        finalText = await runTextModel(
          '不要让用户填验证码。立刻看页面 #ccc 图认出 4 位，调用 browser_chaoxing_captcha。提交后再 browser_chaoxing_play。不要问用户，不要 browser_wait。',
          onDelta,
          {
            ...runOptions,
            maxRounds: 48,
            history: [
              ...history,
              { role: 'user', content: modelPrompt },
              { role: 'assistant', content: spoken },
            ],
          },
        )
      } else if (claimedAllDone) {
        keepSpoken()
        debug({ type: 'browser_continue', reason: 'claimed all done without catalog' })
        finalText = await runTextModel(courseNudge, onDelta, {
          ...runOptions,
          maxRounds: 48,
          history: [
            ...history,
            { role: 'user', content: modelPrompt },
            { role: 'assistant', content: spoken },
          ],
        })
      } else if (wantsCourse && stoppedMid && !alreadyWatching && options?.kind !== 'watch') {
        keepSpoken()
        debug({ type: 'browser_continue', reason: 'stopped before play' })
        finalText = await runTextModel(courseNudge, onDelta, {
          ...runOptions,
          maxRounds: 48,
          history: [
            ...history,
            { role: 'user', content: modelPrompt },
            { role: 'assistant', content: spoken },
          ],
        })
      }
      const usedHomework = (liveMessage()?.steps || []).some((step) => step.name === 'browser_chaoxing_homework')
      const alreadyInspected = (liveMessage()?.steps || []).some((step) => step.name === 'browser_chaoxing_homework' && step.status === 'done')
      const homeworkTalk = /作业|题目|选项|作答|选上|开始|继续/.test(content)
        || /作业|单选题|题卡|questions|next/.test(spoken)
      const filledHomework = steps.some((step) => step.name === 'browser_chaoxing_homework' && step.status === 'done' && /fill|已填|暂时保存/.test(`${step.label || ''}${step.detail || ''}`))
      const homeworkUnfinished = (wantsHomework || homeworkTalk || usedHomework)
        && options?.kind !== 'watch'
        && (
          /请确认|需要你允许|现在提交|全部识别|让我继续查看|没有选中|取消选择|并没有选|看不清|是图像/.test(spoken)
          || (usedHomework && !filledHomework && !alreadyInspected && /inspect|读题|单选题/.test(spoken))
        )
        && !/已暂时保存|已提交|next":"done"/.test(spoken)
      const stillNoCourseFlow = wantsCourse && !wantsHomework && !alreadyWatching && options?.kind !== 'watch'
        && !usedPlay && !usedWatch && !usedClick
      const sawCatalog = wantsCourse && !alreadyWatching && options?.kind !== 'watch'
        && /已完成任务点|需要开始播放未完成|【章节目录】/.test(spokenText || liveContent())
        && !/正在播放|已确认在播|进度正常/.test(spokenText || liveContent())
      if (stillNoCourseFlow) {
        keepSpoken()
        debug({ type: 'browser_continue', reason: 'never started course flow' })
        finalText = await runTextModel(courseNudge, onDelta, {
          ...runOptions,
          maxRounds: 24,
          history: [
            ...history,
            { role: 'user', content: modelPrompt },
            { role: 'assistant', content: spokenText || liveContent() },
          ],
        })
      } else if (homeworkUnfinished) {
        keepSpoken()
        debug({ type: 'browser_continue', reason: 'homework unfinished' })
        finalText = await runTextModel(
          '作业还没做完。只许用 browser_chaoxing_homework：有题卡就一题一题作答，答出一道立刻 fill 这一道（answers 只放一项），再做下一道；没有题卡就 inspect。题干没读出的题先跳过等 inspect 补读，不要猜。不要 eval，不要 click，不要读网页，不要出练习题，不要问用户确认。已选中的题 fill 会跳过。',
          onDelta,
          {
            ...runOptions,
            maxRounds: 48,
            history: [
              ...history,
              { role: 'user', content: modelPrompt },
              { role: 'assistant', content: spokenText || liveContent() },
            ],
          },
        )
      } else if (wantsHomework && !usedHomework && options?.kind !== 'watch') {
        keepSpoken()
        debug({ type: 'browser_continue', reason: 'homework without tool' })
        finalText = await runTextModel(
          '用户要写作业。若还在空间/课表/章节，先点进课程再点「作业」进入作业页；已在作业列表就 browser_chaoxing_homework action=list 或 open，已在作答页就 inspect。读到题卡后一题一题作答，每答出一道就 fill 一道。不要 eval，不要在非作业页硬调 homework。',
          onDelta,
          {
            ...runOptions,
            maxRounds: 48,
            history: [
              ...history,
              { role: 'user', content: modelPrompt },
              { role: 'assistant', content: spokenText || liveContent() },
            ],
          },
        )
      } else if (sawCatalog && !wantsHomework) {
        keepSpoken()
        debug({ type: 'browser_continue', reason: 'had catalog but did not play' })
        finalText = await runTextModel(
          '目录已经读到未完成节。立刻 browser_click_text 点第一节干净节名，进播放页后 browser_chaoxing_play。不要要截图，不要打开 iframe 网址。',
          onDelta,
          {
            ...runOptions,
            maxRounds: 24,
            history: [
              ...history,
              { role: 'user', content: modelPrompt },
              { role: 'assistant', content: spokenText || liveContent() },
            ],
          },
        )
      }

      // 任务门：用户这句话是任务。没 browser_finish、也没交监控时，空嘴停不算完，继续催。
      // flash 常把 browser_finish(...) 写成正文，或登录已成功却不 finish——这两种直接收工。
      if (options?.kind !== 'watch') {
        const acceptFinish = (status: string, summary: string, via: string) => {
          addStep(sessionId, assistantId, {
            id: `finish-auto-${Date.now()}`,
            kind: 'tool',
            name: 'browser_finish',
            status: 'done',
            label: summary.slice(0, 80) || (status === 'blocked' ? '需要用户处理' : '任务已完成'),
            detail: `${status} · ${via}`,
            startedAt: Date.now(),
            finishedAt: Date.now(),
          })
          debug({ type: 'browser_finish_accepted', status, summary, via })
        }
        const parseFinishInText = (text: string) => {
          const raw = String(text || '')
          const hit = raw.match(/browser_finish\s*\(\s*(?:\{?\s*)?status\s*[=:]\s*["']?(done|blocked|watching)["']?/i)
            || raw.match(/browser_finish\s*\(\s*status\s*=\s*(done|blocked|watching)/i)
          if (!hit) return null
          const status = String(hit[1] || 'done').toLowerCase()
          const sum = raw.match(/summary\s*[=:]\s*["“]([^"”]+)["”]/i)
          return { status, summary: (sum?.[1] || raw.replace(/browser_finish[\s\S]*/i, '').trim() || '任务结束').slice(0, 160) }
        }
        const loginOnlyTask = /登录|登陆/.test(content)
          && !/刷课|作业|答题|播放|章节|未完成|看完|自动播放/.test(content)
        const pageUrl = async () => {
          try {
            const state = await getBrowserState(browserId)
            return String(state?.url || listAppBrowsers().find((b) => b.id === browserId)?.url || '')
          } catch {
            return String(listAppBrowsers().find((b) => b.id === browserId)?.url || '')
          }
        }

        for (let kick = 0; kick < 12; kick += 1) {
          if (abort.signal.aborted || liveMessage()?.status !== 'streaming') break
          const liveSteps = liveMessage()?.steps || []
          if (liveSteps.some((step) => step.name === 'browser_finish' && step.status === 'done')) break
          const liveWatchNow = videoWatchFor(browserId)
          const handedOff = Boolean(
            liveWatchNow
            && (liveWatchNow.status === 'watching' || liveWatchNow.status === 'paused' || liveWatchNow.status === 'stalled'),
          )
          if (handedOff) break

          const spokenNow = spokenText || liveContent()
          const textFinish = parseFinishInText(spokenNow)
          if (textFinish) {
            acceptFinish(textFinish.status, textFinish.summary, 'text')
            break
          }
          const urlNow = await pageUrl()
          if (
            loginOnlyTask
            && /已成功登录|登录成功|已登录学习通|勾选了.*自动登录/.test(spokenNow)
            && /i\.mooc\.chaoxing|i\.chaoxing\.com|space\/index|visit\/interaction|个人空间|课程空间/.test(`${spokenNow}\n${urlNow}`)
          ) {
            acceptFinish('done', '已登录学习通（用户仅要求登录）', 'login-done')
            break
          }

          keepSpoken()
          const onlyFinish = /已成功登录|登录成功|已完成|任务已完成|流程已完成/.test(spokenNow)
          const taskNudge = onlyFinish
            ? '任务其实已经做完。立刻只调用工具 browser_finish(status=done, summary=…)，禁止写在正文里，不要再点「课程」或其它入口。'
            : (
              '用户任务还没结束。禁止只写「让我再试」「接下来」或把 browser_finish(...) 写进正文。'
              + '立刻继续调用工具；真正做完必须用工具调用 browser_finish(status=done)，等人用 blocked，监控中用 watching。'
            )
          debug({ type: 'browser_continue', reason: 'task not finished', kick })
          finalText = await runTextModel(
            taskNudge,
            onDelta,
            {
              ...runOptions,
              maxRounds: 24,
              history: [
                ...history,
                { role: 'user', content: modelPrompt },
                { role: 'assistant', content: spokenNow },
              ],
            },
          )
        }
      }
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
          history: [
            ...history,
            { role: 'user', content: modelPrompt },
            { role: 'assistant', content: spokenText || liveContent() },
          ],
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
            history: [
              ...history,
              { role: 'user', content: modelPrompt },
              { role: 'assistant', content: spokenText || liveContent() },
            ],
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
