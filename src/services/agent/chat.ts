import { computed, ref } from 'vue'
import { databaseService, type PracticeMarks, type QuestionKnowledgeLink, type StudyGraphNodePatch } from '../app/database'
import { inspectLocalFile, parseQuestions, normalizeType, readLocalFileRange, type ExtractedQuestion } from './import'
import { isModelStopped, runTextModel, type ModelToolCall } from '../model/runner'
import type { ImportStepPreview, ImportTaskStep } from '../app/importTasks'
import { parseDifficulty, parseImportance, parseMastery } from '../../utils/questionMetrics'
import { getQuizCards, parseQuizCards, resolveQuizTitle, saveQuizCards, saveQuizTitle, type QuizCard } from '../../utils/quizPractice'
import { collectGraphNodes, extractMermaidSource, graphFromPayload, graphToMermaid, parseGraphEdgeInputs, parseGraphNodeInputs } from '../../utils/studyGraph'
import { isLoggedIn } from '../app/auth'
import {
  hostnameOf,
  listAppBrowsers,
  readChaoxingVideo,
} from '../browser/appBrowser'
import {
  campusApiType,
  campusQuestionTypeLabel,
  createCampusPaper,
  createCampusQuestion,
  encodeCampusAnswer,
  encodeCampusOptions,
  formatCampusOptions,
  getCampusCourse,
  getUserCampus,
  listCampusCourses,
  listCampusTags,
  listFolderQuestions,
  searchCampusQuestions,
  updateCampusPaper,
  updateCampusQuestion,
  withFolderQuestionCounts,
  type CampusFolder,
  type CampusQuestion,
} from '../app/campus'
import { clipAgentDebug, logAgentDebug, writeBrowserTranscript } from './debugLog'
import { emitStudyGraphStream, finishStudyGraphStream, studyGraphStream } from '../study/graphStream'
import { runStudyProgressEvaluation } from '../study/progressAgent'
import { finalizeStudySessionSummary } from '../study/timelineSummary'
import { associateQuestionsToKnowledge, notifyQuestionKnowledgeUpdated, type QuestionKnowledgeHint } from '../study/questionKnowledge'
import { clampForgettingStage, forgettingStageLabel, retentionScore } from '../../utils/studyForgetting'
import { describeActivity } from './activity'
import { executeBrowserTool } from './browserTools'
import {
  campusFail,
  campusTagArg,
  loadCampusContext,
  parseCampusDrafts,
  resolveCampusCourse,
  resolveCampusPaper,
  resolveCampusTagId,
  summarizeCampusCourse,
  summarizeCampusPaper,
} from './campusResolve'
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
import { chapterStateFor } from '../chaoxing/chapters'
import {
  formatVideoClock,
  stopChaoxingWatch,
  videoWatchFor,
} from '../chaoxing/watch'
import { bindChaoxingWatchAgent, dropWatchQueue, flushWatchAfterTurn } from '../chaoxing/watchAgent'

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

const pickSubjectRef = (args: Record<string, unknown> | any) => {
  const id = Number(args?.subject_id ?? args?.subjectId ?? args?.id)
  const name = String(args?.subject_name ?? args?.subjectName ?? args?.name ?? '').trim()
  return {
    id: Number.isFinite(id) && id > 0 ? id : undefined,
    name: name || undefined,
  }
}

const lastStudyFocus = new Map<number, { nodeName: string; nodeId?: number }>()

const rememberStudyFocus = (subjectId: number, nodeName?: string, nodeId?: number) => {
  const name = String(nodeName || '').trim()
  if (!(Number.isFinite(subjectId) && subjectId > 0) || !name) return
  lastStudyFocus.set(subjectId, {
    nodeName: name,
    nodeId: Number(nodeId) > 0 ? Number(nodeId) : undefined,
  })
}

const openStudyGraphPane = (subjectId: number, nodeName?: string, nodeId?: number) => {
  if (!Number.isFinite(subjectId) || subjectId <= 0) return
  rememberStudyFocus(subjectId, nodeName, nodeId)
  window.dispatchEvent(new CustomEvent('open-study-graph', {
    detail: {
      subjectId,
      expand: true,
      ...(String(nodeName || '').trim() ? { nodeName: String(nodeName).trim() } : {}),
      ...(Number(nodeId) > 0 ? { nodeId: Number(nodeId) } : {}),
    },
  }))
}

const WRITE_GRAPH_HINT = '图谱是空的，请调用 patch_knowledge_graph，用 add 传入 3–8 个节点。第一批只写章名；之后给章补节，parent_key 填章的中文名。不要传空参数，不要一次塞整张 mermaid，不要加定理或论文名叶子。'

const KEEP_GRAPH_HINT = '已有图谱。先看现有节点再 patch 增删改，不要 set_knowledge_graph，不要清空重画。只有用户明确说重画、推倒重来、全部重做时才整图替换。'

const GRAPH_QUALITY = `用 patch_knowledge_graph 分批改图，不要一次写整张 mermaid。图谱必须像教材目录，不要像散落考点云。
- 三层：科目 → 章（8–12 个章名）→ 节（每章 2–4 个节名）。到节为止
- 已有图谱时：先 get_knowledge_graph，只补缺的章/节或按用户点名增删改，保留已有节点和遗忘进度
- 空图才从零画：第一批只加章；之后每批给 1–2 章补节，parent_key 填章名；每批 3–8 个，大约 28–45 个
- 节点名用教材目录口吻，例如「劳动需求」「短期劳动需求」「人力资本」
- 禁止空泛桶：学科基础、核心概念、方法与应用、基础知识、综合应用、概述、其他
- 禁止把定理、模型、公式、论文平铺成叶子，例如不要单独列出「保留工资定理」「明瑟方程」「Oaxaca-Blinder」「Card-Krueger」`

const graphSubjectHint = (name: string) => {
  if (/英语|CET|四级|六级|考研英语/i.test(name)) {
    return `「${name}」按应试教材目录展开（章=题型，节=技能），必须画到这一细度（可增删，不能更粗）：
听力 → 场景与身份 / 数字与时间 / 建议与请求 / 转折与否定 / 主旨把握 / 细节定位 / 态度与语气 / 讲座结构
阅读 → 主旨大意 / 事实细节 / 推理判断 / 词义猜测 / 段落匹配 / 词性判断 / 搭配与衔接
词汇语法 → 词缀词根 / 近义辨析 / 短语动词 / 定语从句 / 状语从句 / 非谓语动词 / 虚拟语气 / 时态语态
翻译 → 文化负载词 / 无主句处理 / 定语后置 / 被动与使役
写作 → 现象解释 / 观点论证 / 书信通知或图表描述 / 逻辑衔接词`
  }
  if (/劳动经济|人力资源经济|劳动和人力/i.test(name)) {
    return `「${name}」按本科劳动经济学教材目录展开，不要按考研/论文考点平铺。先写 8–12 个章，再给每章 2–4 个节。章应覆盖这类主题（用教材章名，不要照抄成论文关键词）：导论、劳动力市场的基本图景与概念、劳动需求、劳动供给、人力资本与教育、内部劳动力市场与薪酬、劳动力流动与工作搜寻、失业、工会与劳动关系、收入分配与公共政策。节名用小节口吻，例如「短期劳动需求」「收入与闲暇」「劳动参与率」「工作搜寻」，不要把定理、方程、分解方法、经典论文名做成叶子。`
  }
  if (/经济|金融|会计|管理|社会学|政治/i.test(name)) {
    return `「${name}」按该学科本科教材目录展开：8–12 个章名，每章 2–4 个节名。叶子是节标题，不是模型名、公式名或论文名。不要「基础 / 核心 / 应用」三大块。`
  }
  return `「${name}」按该学科真实教材目录展开：先写章，再写节。叶子是节标题，不是定理名、公式名或论文名。不要「基础 / 核心 / 应用」三大块。`
}

const clipToolResult = (text: string) => (text.length > 12000 ? `${text.slice(0, 11999)}…` : text)

const resolveCampusWriteTarget = async (
  sessionId: string,
  campusId: number,
  args: any,
  opts?: { createPaper?: boolean; paperName?: string },
) => {
  const cache = campusCacheOf(sessionId)
  let paperId = Number(args.paper_id ?? args.folder_id)
  let paperName = String(opts?.paperName || args.paper_name || args.folder_name || '').trim()
  if (!(Number.isFinite(paperId) && paperId > 0) && !paperName && cache.papers.length === 1) {
    paperId = cache.papers[0].id
    paperName = cache.papers[0].name
  }
  const known = Number.isFinite(paperId) && paperId > 0
    ? cache.papers.find((item) => item.id === paperId)
    : paperName
      ? cache.papers.find((item) => item.name === paperName)
      : undefined
  const course = await resolveCampusCourse(
    campusId,
    Number(args.course_id) || known?.courseId || undefined,
    String(args.course_name || '').trim() || known?.courseName || undefined,
  )
  if (!course) {
    return { error: '请提供 course_id 或 course_name，或先 list_campus_papers' as const }
  }
  const remember = (paper: { id: number; name: string }) => {
    rememberCampusPapers(sessionId, [{
      id: paper.id,
      name: paper.name,
      courseName: course.name,
      courseId: course.id,
    }])
  }
  if (Number.isFinite(paperId) && paperId > 0) {
    try {
      const resolved = await resolveCampusPaper(course.id, paperId)
      remember(resolved.paper)
      return { course, paper: resolved.paper, createdPaper: false }
    } catch {
      const paper = { id: paperId, name: paperName || known?.name || `试卷 ${paperId}` }
      remember(paper)
      return { course, paper, createdPaper: false }
    }
  }
  if (!paperName) return { error: '请提供 paper_id 或 paper_name' as const }
  try {
    const resolved = await resolveCampusPaper(course.id, undefined, paperName)
    if (resolved.paper) {
      remember(resolved.paper)
      return { course, paper: resolved.paper, createdPaper: false }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : ''
    if (opts?.createPaper === false || /有多/.test(msg)) {
      return { error: campusFail(err, msg || `没有找到试卷「${paperName}」`), course }
    }
  }
  if (opts?.createPaper === false) {
    return { error: `没有找到试卷「${paperName}」` as const, course }
  }
  const tagId = await resolveCampusTagId(
    Number(args.tag_id) || undefined,
    campusTagArg(args) || undefined,
  )
  const paper = await createCampusPaper(course.id, paperName, tagId)
  remember(paper)
  return { course, paper, createdPaper: true }
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
  const chapters = chapterStateFor(browserId)
  const chapterLine = chapters
    ? (chapters.unfinished.length
      ? `章节解析：未完成 ${chapters.unfinishedCount}${chapters.progress ? `（任务点 ${chapters.progress.done}/${chapters.progress.total}）` : ''}：${chapters.unfinished.slice(0, 6).join('、')}。`
      : chapters.progress
        ? (chapters.progress.total > chapters.progress.done
          ? `章节解析：已完成任务点 ${chapters.progress.done}/${chapters.progress.total}，还没对上节名。不要说全部完成，自己 get_page 解析。`
          : `章节解析：已完成任务点 ${chapters.progress.done}/${chapters.progress.total}。`)
        : '章节解析器还没读到目录。这不等于做完，必须自己 get_page / eval 解析，不要说全部完成。')
    : ''
  const watch = videoWatchFor(browserId)
  if (light && watch) {
    const clock = `${formatVideoClock(watch.current)} / ${formatVideoClock(watch.duration)}`
    const videos = watch.videoCount > 1
      ? ` 本章视频 ${watch.videoIndex || 1}/${watch.videoCount}${watch.moreVideos ? '，后面还有' : ''}`
      : ''
    playLine = watch.paused
      ? `监控中「${watch.title || '当前节'}」已暂停 ${clock}。${videos}`
      : `监控中「${watch.title || '当前节'}」在播 ${clock}。${videos}不要再点播放或读目录。`
    return `【网页状态】当前对话挂着浏览器「${name}」（browser_id=${browserId}）${url ? `，网址 ${url}` : ''}。${playLine}${chapterLine ? ` ${chapterLine}` : ''}\n\n`
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
  return `【网页状态】当前对话挂着浏览器「${name}」（browser_id=${browserId}）${url ? `，网址 ${url}` : ''}。${playLine}${chapterLine ? ` ${chapterLine}` : ''} 读页面、点击、填写、跳转都必须调用工具，不要只口头说已经操作。\n\n`
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

const notifyFoldersChanged = (folderId?: number) => {
  window.dispatchEvent(new CustomEvent('questions-imported', { detail: { folderId } }))
}

const notifyCampusUpdated = (detail?: { courseId?: number; paperId?: number }) => {
  window.dispatchEvent(new CustomEvent('campus-updated', { detail: detail || {} }))
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
  patchSession(sessionId, (session) => ({
    ...session,
    messages: session.messages.map((message) => {
      if (message.id !== messageId) return message
      if (message.steps.some((item) => item.id === step.id)) return message
      if (
        (step.name === 'get_file_info' || step.name === 'list_folders')
        && message.steps.some((item) => item.name === step.name)
      ) {
        return message
      }
      return { ...message, steps: [...message.steps, step] }
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

const resolveFolder = async (id?: unknown, name?: unknown) => {
  const folders = await databaseService.getFolders()
  const folderId = Number(id)
  if (Number.isFinite(folderId)) {
    const found = folders.find((folder) => folder.id === folderId)
    if (found) return found
  }
  const keyword = String(name || '').trim()
  if (!keyword) return null
  const exact = folders.filter((folder) => folder.name === keyword)
  if (exact.length === 1) return exact[0]
  if (exact.length > 1) {
    throw new Error(`有多个同名文件夹「${keyword}」，请改用 folder_id`)
  }
  const fuzzy = folders.filter((folder) => folder.name.includes(keyword))
  if (fuzzy.length === 1) return fuzzy[0]
  if (fuzzy.length > 1) {
    throw new Error(`有多个文件夹名称包含「${keyword}」，请改用 folder_id`)
  }
  return null
}

const summarizeQuestion = (item: {
  id: number
  question?: string
  options?: string
  answer?: string
  question_type?: string
  folder_id?: number
  folder_name?: string
  importance?: number
  mastery?: number
  difficulty?: number
}) => ({
  id: item.id,
  question: String(item.question || '').slice(0, 180),
  options: String(item.options || '').slice(0, 220),
  answer: String(item.answer || '').slice(0, 80),
  question_type: item.question_type || '',
  folderId: item.folder_id ?? 0,
  folderName: item.folder_name || '',
  importance: item.importance ?? 0,
  mastery: item.mastery ?? 0,
  difficulty: item.difficulty ?? 0,
})

const withPractice = async <T extends { id: number }>(items: T[]) => {
  const ids = items.map((item) => item.id)
  const [summaries, marks, links] = await Promise.all([
    databaseService.getPracticeSummaries(ids),
    databaseService.getRecentPracticeMarks(ids, 5).catch((): PracticeMarks[] => []),
    databaseService.listQuestionKnowledge(ids).catch((): QuestionKnowledgeLink[] => []),
  ])
  const map = new Map(summaries.map((item) => [item.question_id, item] as const))
  const markMap = new Map(marks.map((item) => [item.question_id, item.results || []] as const))
  const byQuestion = new Map<number, { node_id: number; node_name: string; subject_id: number; subject_name: string }[]>()
  for (const item of links) {
    const list = byQuestion.get(item.question_id) || []
    list.push({
      node_id: item.node_id,
      node_name: item.node_name,
      subject_id: item.subject_id,
      subject_name: item.subject_name,
    })
    byQuestion.set(item.question_id, list)
  }
  return items.map((item) => {
    const practice = map.get(item.id)
    return {
      ...summarizeQuestion(item as any),
      practice: practice
        ? { ...practice, recent: markMap.get(item.id) || [] }
        : { count: 0, recent: markMap.get(item.id) || [] },
      knowledge: byQuestion.get(item.id) || [],
    }
  })
}

const parseQuestionIds = (args: any) => {
  const raw = args?.question_ids ?? args?.question_id
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : []
  return [...new Set(list.map((value) => Number(value)).filter((id) => Number.isFinite(id) && id > 0))]
}

const listedBySession = new Map<string, { id: number; mastery?: number; question_type?: string; folder_id?: number }[]>()

const rememberListed = (sessionId: string, items: { id: number; mastery?: number; question_type?: string; folder_id?: number }[]) => {
  listedBySession.set(sessionId, items.filter((item) => item.id > 0))
}

type CampusPaperCache = { id: number; name: string; courseName?: string; courseId?: number }

type CampusSessionCache = {
  questions: CampusQuestion[]
  papers: CampusPaperCache[]
}

const campusBySession = new Map<string, CampusSessionCache>()

const campusCacheOf = (sessionId: string): CampusSessionCache => {
  const current = campusBySession.get(sessionId)
  if (current) return current
  const created = { questions: [] as CampusQuestion[], papers: [] as CampusSessionCache['papers'] }
  campusBySession.set(sessionId, created)
  return created
}

const rememberCampusPapers = (sessionId: string, papers: CampusPaperCache[]) => {
  const cache = campusCacheOf(sessionId)
  for (const paper of papers) {
    const index = cache.papers.findIndex((item) => item.id === paper.id)
    if (index >= 0) cache.papers[index] = { ...cache.papers[index], ...paper }
    else cache.papers.push(paper)
  }
}

const rememberCampusQuestions = (sessionId: string, questions: CampusQuestion[], paper?: CampusPaperCache) => {
  const cache = campusCacheOf(sessionId)
  const seen = new Set(questions.map((item) => item.id))
  cache.questions = [...questions, ...cache.questions.filter((item) => !seen.has(item.id))]
  if (paper?.id) rememberCampusPapers(sessionId, [paper])
}

const parseCampusQuestionIds = (args: any) => {
  const fromArgs = args?.campus_question_ids ?? args?.campus_question_id
  const list = Array.isArray(fromArgs) ? fromArgs : fromArgs != null ? [fromArgs] : []
  if (Array.isArray(args?.questions)) {
    for (const item of args.questions) {
      const id = Number(item?.campus_question_id)
      if (Number.isFinite(id) && id > 0) list.push(id)
    }
  }
  return [...new Set(list.map((value) => Number(value)).filter((id) => Number.isFinite(id) && id > 0))]
}

const campusQuestionToCard = (item: CampusQuestion): QuizCard => ({
  uid: `c-${item.id}`,
  question: item.content,
  options: formatCampusOptions(item.options),
  answer: item.answer,
  question_type: campusQuestionTypeLabel(item.type),
})

const publishCampusQuestionCards = (stepId: string, questions: CampusQuestion[], title: string) => {
  const cards = questions.slice(0, 10).map(campusQuestionToCard)
  if (!cards.length) return []
  saveQuizCards(stepId, cards)
  saveQuizTitle(stepId, title || '校园题')
  return cards
}

const resolveCampusQuizCards = async (sessionId: string, args: any): Promise<{ cards: QuizCard[]; title: string }> => {
  const ids = parseCampusQuestionIds(args)
  const paperId = Number(args.paper_id)
  const cache = campusCacheOf(sessionId)
  let questions: CampusQuestion[] = []
  let paperName = String(args.paper_name || args.title || '').trim()
  let courseName = String(args.course_name || '').trim()

  if (Number.isFinite(paperId) && paperId > 0) {
    questions = await listFolderQuestions(paperId)
    const known = cache.papers.find((item) => item.id === paperId)
    paperName = paperName || known?.name || ''
    courseName = courseName || known?.courseName || ''
    rememberCampusQuestions(sessionId, questions, { id: paperId, name: paperName || `试卷 ${paperId}`, courseName })
  } else if (ids.length) {
    const byId = new Map(cache.questions.map((item) => [item.id, item]))
    questions = ids.map((id) => byId.get(id)).filter((item): item is CampusQuestion => Boolean(item))
    if (questions.length < ids.length && cache.papers.length === 1) {
      const only = cache.papers[0]
      const fetched = await listFolderQuestions(only.id)
      rememberCampusQuestions(sessionId, fetched, only)
      const next = new Map(campusCacheOf(sessionId).questions.map((item) => [item.id, item]))
      questions = ids.map((id) => next.get(id)).filter((item): item is CampusQuestion => Boolean(item))
      paperName = paperName || only.name
      courseName = courseName || only.courseName || ''
    }
  }

  if (ids.length) {
    const want = new Set(ids)
    questions = questions.filter((item) => want.has(item.id))
  }

  const knownPaper = cache.papers.find((item) => questions.some((question) => question.question_bank_id === item.id))
  paperName = paperName || knownPaper?.name || ''
  courseName = courseName || knownPaper?.courseName || ''
  const title = paperName || (courseName ? `${courseName}校园题` : '')
  return {
    cards: questions.slice(0, 10).map(campusQuestionToCard),
    title,
  }
}

const isChoiceType = (type?: string) => {
  const text = String(type || '')
  return /单选|多选|判断|选择/.test(text) || !text
}

const cardsFromQuestions = async (items: { id: number }[]) => {
  const stored = await databaseService.getQuestionsByIds(items.map((item) => item.id))
  return stored
    .filter((item) => item.question && item.answer)
    .map((item, index) => ({
      uid: `q-${item.id}`,
      question_id: item.id,
      question: item.question,
      options: item.options || '',
      answer: item.answer || '',
      question_type: item.question_type || undefined,
      importance: item.importance,
      mastery: item.mastery,
      difficulty: item.difficulty,
    } satisfies QuizCard))
    .slice(0, 10)
}

export const hydrateQuizCards = async (cards: QuizCard[]) => {
  const next: QuizCard[] = []
  for (const card of cards) {
    if (card.question_id && card.answer) {
      next.push(card)
      continue
    }
    const keyword = card.question.replace(/\s+/g, '').slice(0, 24)
    if (!keyword) {
      if (card.options) next.push(card)
      continue
    }
    try {
      const found = await databaseService.searchQuestionsByTitle(card.question.slice(0, 40))
      const compact = (value: string) => value.replace(/\s+/g, '')
      const match = found.find((item) => {
        const left = compact(item.question || '')
        const right = compact(card.question)
        return left.includes(right.slice(0, 16)) || right.includes(left.slice(0, 16))
      })
      if (match) {
        next.push({
          ...card,
          uid: `q-${match.id}`,
          question_id: match.id,
          question: match.question,
          options: match.options || card.options,
          answer: match.answer || card.answer,
          question_type: match.question_type || card.question_type,
          importance: match.importance,
          mastery: match.mastery,
          difficulty: match.difficulty,
        })
        continue
      }
    } catch {
      // keep local card
    }
    if (card.question && card.options) next.push(card)
  }
  return next
}

const pickPracticeCards = async (sessionId: string, count = 5, folderId?: number) => {
  const listed = listedBySession.get(sessionId) || []
  const ranked = [...listed].sort((a, b) => (a.mastery || 0) - (b.mastery || 0))
  const choice = ranked.filter((item) => isChoiceType(item.question_type))
  const picked = (choice.length ? choice : ranked).slice(0, count)
  if (picked.length) return cardsFromQuestions(picked)
  const folder = folderId != null ? folderId : 0
  const result = await databaseService.getPaginatedQuestions({
    folderId: folder,
    page: 1,
    pageSize: 40,
  })
  const weak = [...result.items].sort((a, b) => (a.mastery || 0) - (b.mastery || 0))
  return cardsFromQuestions(weak.slice(0, count))
}

const resolveQuizCards = async (raw: unknown): Promise<QuizCard[]> => {
  const drafted = parseQuizCards(raw)
  const extraIds = raw && typeof raw === 'object' ? parseQuestionIds(raw) : []
  const ids = [...new Set([
    ...drafted.map((item) => item.question_id).filter((id): id is number => Number.isFinite(id) && (id as number) > 0),
    ...extraIds,
  ])]
  const stored = ids.length ? await databaseService.getQuestionsByIds(ids) : []
  const byId = new Map(stored.map((item) => [item.id, item]))
  const cards: QuizCard[] = []
  const used = new Set<number>()
  drafted.forEach((item, index) => {
    const fromBank = item.question_id ? byId.get(item.question_id) : undefined
    const question = item.question || fromBank?.question || ''
    const answer = item.answer || fromBank?.answer || ''
    if (!question || !answer) return
    if (item.question_id) used.add(item.question_id)
    cards.push({
      uid: item.question_id ? `q-${item.question_id}` : `g-${index}`,
      question_id: item.question_id,
      question,
      options: item.options || fromBank?.options || '',
      answer,
      question_type: item.question_type || fromBank?.question_type || undefined,
      explanation: item.explanation,
      importance: item.importance ?? fromBank?.importance,
      mastery: item.mastery ?? fromBank?.mastery,
      difficulty: item.difficulty ?? fromBank?.difficulty,
      knowledge_point: item.knowledge_point,
      node_name: item.node_name,
      node_id: item.node_id,
      parent_name: item.parent_name,
      subject_id: item.subject_id,
    })
  })
  for (const id of extraIds) {
    if (used.has(id) || !byId.has(id)) continue
    const fromBank = byId.get(id)!
    if (!fromBank.question || !fromBank.answer) continue
    cards.push({
      uid: `q-${id}`,
      question_id: id,
      question: fromBank.question,
      options: fromBank.options || '',
      answer: fromBank.answer || '',
      question_type: fromBank.question_type || undefined,
      importance: fromBank.importance,
      mastery: fromBank.mastery,
      difficulty: fromBank.difficulty,
    })
  }
  return cards.slice(0, 10)
}

const saveQuestions = async (items: ExtractedQuestion[], folderId: number, subjectId?: number) => {
  const created: { id: number; item: ExtractedQuestion }[] = []
  for (const item of items) {
    const question = await databaseService.addQuestion({
      content: item.question,
      options: item.options || '',
      answer: item.answer,
      question_type: normalizeType(item.question_type),
      folderId,
      isAi: 1,
      importance: item.importance,
      mastery: item.mastery,
      difficulty: item.difficulty,
    })
    created.push({ id: question.id, item })
  }
  const association = created.length
    ? await associateQuestionsToKnowledge(
      created.map(({ id, item }) => ({
        questionId: id,
        question: item.question,
        knowledge_point: item.knowledge_point,
        node_name: item.node_name,
        node_id: item.node_id,
        parent_name: item.parent_name,
        subject_id: item.subject_id,
      })),
      { subjectId, createMissing: true },
    )
    : { linked: 0, created: 0, skipped: created.length, links: [] }
  if (created.length) {
    window.dispatchEvent(new CustomEvent('questions-imported', { detail: { folderId } }))
    if (association.created || association.linked) {
      window.dispatchEvent(new CustomEvent('study-graph-updated', { detail: { subjectId } }))
    }
  }
  return {
    saved: created.length,
    questionIds: created.map((item) => item.id),
    association,
  }
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
      executeTool: async (call: ModelToolCall) => {
        if (abort.signal.aborted) throw new DOMException('已停止', 'AbortError')
        const args = parseToolArgs(call.arguments)
        const attachment = sessionAttachment(sessionId)
        const browserId = String(sessions.value.find((item) => item.id === sessionId)?.browserId || '').trim()

        if (browserId && call.name.startsWith('browser_')) {
          const wait = (ms: number) => new Promise<void>((resolve, reject) => {
            if (abort.signal.aborted) {
              reject(new DOMException('已停止', 'AbortError'))
              return
            }
            const timer = window.setTimeout(() => {
              abort.signal.removeEventListener('abort', onAbort)
              resolve()
            }, ms)
            const onAbort = () => {
              window.clearTimeout(timer)
              reject(new DOMException('已停止', 'AbortError'))
            }
            abort.signal.addEventListener('abort', onAbort, { once: true })
          })
          try {
            return await executeBrowserTool({
              name: call.name,
              args,
              browserId,
              sessionId,
              wait,
            })
          } catch (error) {
            if (abort.signal.aborted || isModelStopped(error)) throw error
            return JSON.stringify({ error: error instanceof Error ? error.message : String(error) })
          }
        }

        if (call.name === 'get_file_info') {
          const path = String(args.path || attachment?.filePath || '')
          if (!path) return JSON.stringify({ error: '当前对话没有附带文件' })
          return JSON.stringify(await inspectLocalFile(path))
        }

        if (call.name === 'read_range') {
          const path = String(args.path || attachment?.filePath || '')
          if (!path) return JSON.stringify({ error: '当前对话没有附带文件' })
          const start = Number(args.start)
          const end = Number(args.end)
          if (!Number.isFinite(start) || !Number.isFinite(end)) {
            return JSON.stringify({ error: 'start 和 end 必须是数字' })
          }
          return clipToolResult(JSON.stringify(await readLocalFileRange(path, start, end)))
        }

        if (call.name === 'list_folders') {
          const folders = await databaseService.getFolders()
          const stats = await databaseService.getFolderStats()
          const countMap = new Map(stats.map((item) => [item.folderId, item.questionCount]))
          return JSON.stringify({
            folders: folders.map((folder) => ({
              id: folder.id,
              name: folder.name,
              parentId: folder.parent_id ?? 0,
              questionCount: countMap.get(folder.id) ?? 0,
            })),
          })
        }

        if (call.name === 'get_folder_info') {
          const folder = await resolveFolder(args.folder_id, args.folder_name)
          if (!folder) return JSON.stringify({ error: '没有找到这个文件夹' })
          const path = await databaseService.getFolderPath(folder.id)
          const count = await databaseService.getFolderQuestionCount(folder.id)
          return JSON.stringify({
            id: folder.id,
            name: folder.name,
            parentId: folder.parent_id ?? 0,
            questionCount: count,
            path: path.map((item) => item.name).join(' / '),
          })
        }

        if (call.name === 'create_folder') {
          const name = String(args.name || '').trim()
          if (!name) return JSON.stringify({ error: '文件夹名称不能为空' })
          let parentId = Number.isFinite(Number(args.parent_id)) ? Number(args.parent_id) : 0
          if (args.parent_name && !Number.isFinite(Number(args.parent_id))) {
            const parent = await resolveFolder(undefined, args.parent_name)
            if (!parent) return JSON.stringify({ error: `没有找到父文件夹「${args.parent_name}」` })
            parentId = parent.id
          }
          const id = await databaseService.createFolder(name, parentId)
          const parent = await resolveFolder(parentId)
          notifyFoldersChanged(id)
          return JSON.stringify({
            id,
            name,
            parentId,
            parentName: parent?.name || '最外层',
            message: `已创建「${name}」`,
          })
        }

        if (call.name === 'rename_folder') {
          const folder = await resolveFolder(args.folder_id, args.folder_name)
          if (!folder) return JSON.stringify({ error: '没有找到这个文件夹' })
          if (folder.id === 0) return JSON.stringify({ error: '默认文件夹不能重命名' })
          const newName = String(args.new_name || '').trim()
          if (!newName) return JSON.stringify({ error: '新名称不能为空' })
          await databaseService.renameFolder(folder.id, newName)
          notifyFoldersChanged(folder.id)
          return JSON.stringify({
            id: folder.id,
            oldName: folder.name,
            name: newName,
            message: `已把「${folder.name}」改成「${newName}」`,
          })
        }

        if (call.name === 'move_folder') {
          const folder = await resolveFolder(args.folder_id, args.folder_name)
          if (!folder) return JSON.stringify({ error: '没有找到要移动的文件夹' })
          if (folder.id === 0) return JSON.stringify({ error: '默认文件夹不能移动' })
          let parentId = Number.isFinite(Number(args.parent_id)) ? Number(args.parent_id) : 0
          if (args.parent_name && !Number.isFinite(Number(args.parent_id))) {
            const parent = await resolveFolder(undefined, args.parent_name)
            if (!parent) return JSON.stringify({ error: `没有找到目标文件夹「${args.parent_name}」` })
            parentId = parent.id
          }
          await databaseService.moveFolder(folder.id, parentId)
          const parent = await resolveFolder(parentId)
          notifyFoldersChanged(folder.id)
          return JSON.stringify({
            id: folder.id,
            name: folder.name,
            parentId,
            parentName: parent?.name || '最外层',
            message: `已把「${folder.name}」移到「${parent?.name || '最外层'}」`,
          })
        }

        if (call.name === 'delete_folder') {
          const folder = await resolveFolder(args.folder_id, args.folder_name)
          if (!folder) return JSON.stringify({ error: '没有找到要删除的文件夹' })
          if (folder.id === 0) return JSON.stringify({ error: '默认文件夹不能删除' })
          const deleteQuestions = args.delete_questions === true
          await databaseService.deleteFolder(folder.id, deleteQuestions)
          notifyFoldersChanged(0)
          return JSON.stringify({
            id: folder.id,
            name: folder.name,
            deleteQuestions,
            message: deleteQuestions
              ? `已删除「${folder.name}」及其题目`
              : `已删除「${folder.name}」，题目已回到默认文件夹`,
          })
        }

        if (call.name === 'list_questions') {
          const folder = (await resolveFolder(args.folder_id, args.folder_name)) || await resolveFolder(0)
          if (!folder) return JSON.stringify({ error: '没有找到这个文件夹' })
          const page = Math.max(1, Number(args.page) || 1)
          const pageSize = Math.min(40, Math.max(1, Number(args.page_size) || 20))
          const importance = args.importance == null ? undefined : parseImportance(args.importance)
          const mastery = args.mastery == null ? undefined : parseMastery(args.mastery)
          const difficulty = args.difficulty == null ? undefined : parseDifficulty(args.difficulty)
          if (args.include_subfolders === true) {
            let all = await databaseService.getQuestionsFromFolderAndSubfolders(folder.id)
            if (args.importance != null) all = all.filter((item) => (item.importance || 0) === importance)
            if (args.mastery != null) all = all.filter((item) => (item.mastery || 0) === mastery)
            if (args.difficulty != null) all = all.filter((item) => (item.difficulty || 0) === difficulty)
            const start = (page - 1) * pageSize
            const items = all.slice(start, start + pageSize)
            rememberListed(sessionId, items)
            return clipToolResult(JSON.stringify({
              folderId: folder.id,
              folderName: folder.name,
              includeSubfolders: true,
              page,
              pageSize,
              total: all.length,
              count: items.length,
              hasMore: start + items.length < all.length,
              questions: await withPractice(items),
            }))
          }
          const result = await databaseService.getPaginatedQuestions({
            folderId: folder.id,
            page,
            pageSize,
            importance: args.importance == null ? undefined : importance,
            mastery: args.mastery == null ? undefined : mastery,
            difficulty: args.difficulty == null ? undefined : difficulty,
          })
          rememberListed(sessionId, result.items)
          return clipToolResult(JSON.stringify({
            folderId: folder.id,
            folderName: folder.name,
            includeSubfolders: false,
            page,
            pageSize,
            total: result.total,
            count: result.items.length,
            hasMore: page * pageSize < result.total,
            questions: await withPractice(result.items),
          }))
        }

        if (call.name === 'get_campus_status') {
          if (!isLoggedIn.value) {
            return JSON.stringify({
              loggedIn: false,
              campus: null,
              message: '还没有登录校园账号。请先在顶栏用微信登录，再到校园题库页绑定学校。',
            })
          }
          try {
            const identity = await getUserCampus()
            return JSON.stringify({
              loggedIn: true,
              campus: identity.campus?.name || null,
              campus_id: identity.campus?.id || null,
              enrollment_year: identity.enrollment_year || null,
              class_name: identity.class_name || null,
              verified: identity.status === 'verified',
              message: identity.campus
                ? identity.status === 'verified'
                  ? `当前学校「${identity.campus.name}」，已认证。用 list_campus_courses 看课，save_campus_questions 上传，update_campus_question 改题。`
                  : `当前学校「${identity.campus.name}」。可以看题；上传或改题需要先完成校园认证。`
                : '已登录，但还没有绑定学校。请先打开校园题库页选择学校。',
            })
          } catch (err) {
            return JSON.stringify({ error: campusFail(err, '读取校园账号失败') })
          }
        }

        if (call.name === 'list_campus_courses') {
          const ctx = await loadCampusContext()
          if ('error' in ctx) return JSON.stringify(ctx)
          try {
            const keyword = String(args.name || '').trim()
            const courses = await listCampusCourses(ctx.identity.campus!.id, keyword)
            return clipToolResult(JSON.stringify({
              campus: ctx.identity.campus!.name,
              campus_id: ctx.identity.campus!.id,
              count: courses.length,
              courses: courses.map(summarizeCampusCourse),
              message: courses.length
                ? '用 course_id 调用 list_campus_papers 查看试卷。不要根据课程上的数量判断有没有试卷或题目。'
                : keyword
                  ? `没有找到名称包含「${keyword}」的课程。`
                  : '这所学校还没有课程。',
            }))
          } catch (err) {
            return JSON.stringify({ error: campusFail(err, '查看校园课程失败') })
          }
        }

        if (call.name === 'list_campus_papers') {
          const ctx = await loadCampusContext()
          if ('error' in ctx) return JSON.stringify(ctx)
          try {
            const course = await resolveCampusCourse(
              ctx.identity.campus!.id,
              Number(args.course_id) || undefined,
              String(args.course_name || '').trim() || undefined,
            )
            if (!course) return JSON.stringify({ error: '请提供 course_id 或 course_name' })
            const detail = await getCampusCourse(course.id)
            const papers = await withFolderQuestionCounts(detail.folders.filter((item) => !item.archived))
            rememberCampusPapers(sessionId, papers.map((item) => ({
              id: item.id,
              name: item.name,
              courseName: course.name,
              courseId: course.id,
            })))
            return clipToolResult(JSON.stringify({
              campus: ctx.identity.campus!.name,
              course: course.name,
              course_id: course.id,
              count: papers.length,
              papers: papers.map(summarizeCampusPaper),
              message: papers.length
                ? '用 paper_id 调用 list_campus_questions 查看题目。改平台或改名用 update_campus_paper，不要新建一份再复制。campus_question_id 不是本地题库 Id。'
                : '这门课还没有试卷。',
            }))
          } catch (err) {
            return JSON.stringify({ error: campusFail(err, '查看校园试卷失败') })
          }
        }

        if (call.name === 'list_campus_questions') {
          const ctx = await loadCampusContext()
          if ('error' in ctx) return JSON.stringify(ctx)
          try {
            const paperId = Number(args.paper_id ?? args.folder_id)
            const paperName = String(args.paper_name || args.folder_name || '').trim()
            let paper: CampusFolder | null = null
            let courseName = ''
            let courseId = 0
            if (Number.isFinite(paperId) && paperId > 0) {
              const known = campusCacheOf(sessionId).papers.find((item) => item.id === paperId)
              paper = { id: paperId, name: paperName || known?.name || `试卷 ${paperId}` }
              courseName = known?.courseName || ''
              courseId = known?.courseId || 0
            } else {
              const course = await resolveCampusCourse(
                ctx.identity.campus!.id,
                Number(args.course_id) || undefined,
                String(args.course_name || '').trim() || undefined,
              )
              if (!course) return JSON.stringify({ error: '请提供 paper_id，或同时提供课程和试卷名' })
              const resolved = await resolveCampusPaper(course.id, undefined, paperName || undefined)
              paper = resolved.paper
              courseName = resolved.course.name
              courseId = resolved.course.id
              if (!paper) {
                return JSON.stringify({
                  error: paperName ? `没有找到试卷「${paperName}」` : '请提供 paper_id 或 paper_name',
                  course: course.name,
                  course_id: course.id,
                  papers: resolved.papers.map(summarizeCampusPaper),
                })
              }
            }
            const all = await listFolderQuestions(paper.id)
            rememberCampusQuestions(sessionId, all, {
              id: paper.id,
              name: paper.name,
              courseName,
              courseId: courseId || undefined,
            })
            const page = Math.max(1, Number(args.page) || 1)
            const pageSize = Math.min(40, Math.max(1, Number(args.page_size) || 20))
            const start = (page - 1) * pageSize
            const items = all.slice(start, start + pageSize)
            const title = paper.name || '校园题'
            publishCampusQuestionCards(call.id, items, title)
            return clipToolResult(JSON.stringify({
              campus: ctx.identity.campus!.name,
              course: courseName || undefined,
              paper: paper.name,
              paper_id: paper.id,
              title,
              page,
              pageSize,
              total: all.length,
              count: items.length,
              hasMore: start + items.length < all.length,
              questions: items.map((item) => ({
                campus_question_id: item.id,
                question: String(item.content || '').slice(0, 80),
                question_type: campusQuestionTypeLabel(item.type),
              })),
              message: `已在右侧弹出「${title}」${items.length} 道浏览卡片，只供看题。不要再列出选项。用户没说练习就不要 present_quiz。`,
            }))
          } catch (err) {
            return JSON.stringify({ error: campusFail(err, '查看校园题目失败') })
          }
        }

        if (call.name === 'search_campus_questions') {
          const ctx = await loadCampusContext()
          if ('error' in ctx) return JSON.stringify(ctx)
          const keyword = String(args.keyword || '').trim()
          if (!keyword) return JSON.stringify({ error: '关键词不能为空' })
          try {
            const page = Math.max(1, Number(args.page) || 1)
            const pageSize = Math.min(40, Math.max(1, Number(args.page_size) || 20))
            const items = await searchCampusQuestions(keyword, page, pageSize)
            rememberCampusQuestions(sessionId, items)
            const title = `搜索「${keyword}」`
            if (items.length) publishCampusQuestionCards(call.id, items, title)
            return clipToolResult(JSON.stringify({
              campus: ctx.identity.campus!.name,
              keyword,
              title: items.length ? title : undefined,
              page,
              pageSize,
              count: items.length,
              questions: items.map((item) => ({
                campus_question_id: item.id,
                question: String(item.content || '').slice(0, 80),
                question_type: campusQuestionTypeLabel(item.type),
              })),
              message: items.length
                ? `已在右侧弹出「${title}」${items.length} 道浏览卡片，只供看题。不要再列出选项。用户没说练习就不要 present_quiz。`
                : `校园题库里没有找到「${keyword}」。`,
            }))
          } catch (err) {
            return JSON.stringify({ error: campusFail(err, '搜索校园题失败') })
          }
        }

        if (call.name === 'list_campus_tags') {
          try {
            const tags = await listCampusTags()
            return JSON.stringify({
              count: tags.length,
              tags: tags.map((item) => ({ tag_id: item.id, name: item.name })),
              message: '改平台用 update_campus_paper，传 tag 或 tag_id。不要新建试卷再复制。',
            })
          } catch (err) {
            return JSON.stringify({ error: campusFail(err, '查看校园平台标签失败') })
          }
        }

        if (call.name === 'update_campus_paper') {
          const ctx = await loadCampusContext({ requireVerified: true })
          if ('error' in ctx) return JSON.stringify(ctx)
          try {
            const target = await resolveCampusWriteTarget(sessionId, ctx.identity.campus!.id, args, {
              createPaper: false,
            })
            if ('error' in target) return JSON.stringify(target)
            const nextName = String(args.name || '').trim() || target.paper.name
            const tagName = campusTagArg(args)
            const tagId = await resolveCampusTagId(Number(args.tag_id) || undefined, tagName || undefined)
            if (!String(args.name || '').trim() && tagId == null) {
              return JSON.stringify({ error: '请提供要改的试卷名 name，或平台 tag（如智慧树、学习通）' })
            }
            const paper = await updateCampusPaper(target.paper.id, {
              name: nextName,
              tag_id: tagId,
            })
            rememberCampusPapers(sessionId, [{
              id: paper.id,
              name: paper.name,
              courseName: target.course.name,
              courseId: target.course.id,
            }])
            notifyCampusUpdated({ courseId: target.course.id, paperId: paper.id })
            const tag = paper.tag_name || tagName || undefined
            return JSON.stringify({
              campus: ctx.identity.campus!.name,
              course: target.course.name,
              course_id: target.course.id,
              paper: paper.name,
              paper_id: paper.id,
              tag,
              message: tag
                ? `已把「${paper.name}」的平台改为「${tag}」。不要再新建试卷。`
                : `已把试卷改名为「${paper.name}」。`,
            })
          } catch (err) {
            return JSON.stringify({ error: campusFail(err, '修改校园试卷失败') })
          }
        }

        if (call.name === 'create_campus_paper') {
          const ctx = await loadCampusContext({ requireVerified: true })
          if ('error' in ctx) return JSON.stringify(ctx)
          const name = String(args.name || args.paper_name || '').trim()
          if (!name) return JSON.stringify({ error: '请提供试卷名称 name' })
          try {
            const course = await resolveCampusCourse(
              ctx.identity.campus!.id,
              Number(args.course_id) || undefined,
              String(args.course_name || '').trim() || undefined,
            )
            if (!course) return JSON.stringify({ error: '请提供 course_id 或 course_name' })
            try {
              const resolved = await resolveCampusPaper(course.id, undefined, name)
              if (resolved.paper) {
                rememberCampusPapers(sessionId, [{
                  id: resolved.paper.id,
                  name: resolved.paper.name,
                  courseName: course.name,
                  courseId: course.id,
                }])
                return JSON.stringify({
                  already: true,
                  campus: ctx.identity.campus!.name,
                  course: course.name,
                  course_id: course.id,
                  paper: resolved.paper.name,
                  paper_id: resolved.paper.id,
                  message: `试卷「${resolved.paper.name}」已存在，paper_id=${resolved.paper.id}。上传题目用 save_campus_questions。`,
                })
              }
            } catch (err) {
              const msg = err instanceof Error ? err.message : ''
              if (/有多/.test(msg)) return JSON.stringify({ error: msg })
            }
            const tagId = await resolveCampusTagId(
              Number(args.tag_id) || undefined,
              campusTagArg(args) || undefined,
            )
            const paper = await createCampusPaper(course.id, name, tagId)
            rememberCampusPapers(sessionId, [{
              id: paper.id,
              name: paper.name,
              courseName: course.name,
              courseId: course.id,
            }])
            notifyCampusUpdated({ courseId: course.id, paperId: paper.id })
            return JSON.stringify({
              campus: ctx.identity.campus!.name,
              course: course.name,
              course_id: course.id,
              paper: paper.name,
              paper_id: paper.id,
              tag: paper.tag_name || undefined,
              message: `已创建试卷「${paper.name}」，paper_id=${paper.id}。接下来用 save_campus_questions 上传题目。`,
            })
          } catch (err) {
            return JSON.stringify({ error: campusFail(err, '创建校园试卷失败') })
          }
        }

        if (call.name === 'save_campus_questions') {
          const ctx = await loadCampusContext({ requireVerified: true })
          if ('error' in ctx) return JSON.stringify(ctx)
          try {
            const localIds = parseQuestionIds(args)
            const fromLocal = localIds.length ? await databaseService.getQuestionsByIds(localIds) : []
            const drafts = [
              ...fromLocal.map((item) => ({
                question: String(item.question || '').trim(),
                options: item.options,
                answer: String(item.answer || '').trim(),
                question_type: String(item.question_type || '').trim(),
              })),
              ...parseCampusDrafts(args.questions),
            ].filter((item) => item.question && item.answer)
            if (!drafts.length) {
              return JSON.stringify({ error: '没有有效题目。请提供 questions，或本地 question_ids。每道需要题干和答案。' })
            }
            const pending = drafts.slice(0, 20)
            const target = await resolveCampusWriteTarget(sessionId, ctx.identity.campus!.id, args, {
              createPaper: args.create_paper !== false,
            })
            if ('error' in target) return JSON.stringify(target)
            const created: CampusQuestion[] = []
            const failed: Array<{ question: string; error: string }> = []
            for (const item of pending) {
              const type = campusApiType(item.question_type, item.options)
              const options = encodeCampusOptions(item.options)
              const answer = encodeCampusAnswer(item.answer, item.options, type)
              if (!answer) {
                failed.push({ question: item.question.slice(0, 80), error: '答案为空' })
                continue
              }
              try {
                created.push(await createCampusQuestion(target.course.id, {
                  type,
                  content: item.question,
                  options,
                  answer,
                  question_bank_id: target.paper.id,
                }))
              } catch (err) {
                const message = campusFail(err, '上传失败')
                failed.push({ question: item.question.slice(0, 80), error: message })
                if (/认证|登录已失效/.test(message)) break
              }
            }
            rememberCampusQuestions(sessionId, created, {
              id: target.paper.id,
              name: target.paper.name,
              courseName: target.course.name,
              courseId: target.course.id,
            })
            const title = target.paper.name || '校园题'
            if (created.length) publishCampusQuestionCards(call.id, created, title)
            if (created.length || target.createdPaper) {
              notifyCampusUpdated({ courseId: target.course.id, paperId: target.paper.id })
            }
            return clipToolResult(JSON.stringify({
              campus: ctx.identity.campus!.name,
              course: target.course.name,
              course_id: target.course.id,
              paper: target.paper.name,
              paper_id: target.paper.id,
              created_paper: target.createdPaper || undefined,
              title: created.length ? title : undefined,
              saved: created.length,
              failed: failed.length || undefined,
              errors: failed.length ? failed.slice(0, 8) : undefined,
              skipped: drafts.length > pending.length ? drafts.length - pending.length : undefined,
              questions: created.map((item) => ({
                campus_question_id: item.id,
                question: String(item.content || '').slice(0, 80),
                question_type: campusQuestionTypeLabel(item.type),
              })),
              message: created.length
                ? `已上传 ${created.length} 道到「${target.paper.name}」，并弹出浏览卡片。不要再列出选项。用户没说练习就不要 present_quiz。`
                : failed[0]?.error || '没有成功上传的题目',
            }))
          } catch (err) {
            return JSON.stringify({ error: campusFail(err, '上传校园题失败') })
          }
        }

        if (call.name === 'update_campus_question') {
          const ctx = await loadCampusContext({ requireVerified: true })
          if ('error' in ctx) return JSON.stringify(ctx)
          try {
            const shared = {
              question: args.question,
              options: args.options,
              answer: args.answer,
              question_type: args.question_type,
              paper_id: args.paper_id,
            }
            const patches = Array.isArray(args.questions) && args.questions.length
              ? args.questions
              : parseCampusQuestionIds({ ...args, questions: undefined }).map((id) => ({
                campus_question_id: id,
                ...shared,
              }))
            const items = patches.slice(0, 10).map((item: any) => ({
              campus_question_id: Number(Array.isArray(item?.campus_question_id) ? item.campus_question_id[0] : item?.campus_question_id),
              question: item?.question != null ? String(item.question).trim() : undefined,
              options: item?.options,
              answer: item?.answer != null ? String(item.answer).trim() : undefined,
              question_type: item?.question_type != null ? String(item.question_type).trim() : undefined,
              paper_id: Number(item?.paper_id || args.paper_id) || 0,
            })).filter((item: { campus_question_id: number }) => Number.isFinite(item.campus_question_id) && item.campus_question_id > 0)
            if (!items.length) {
              return JSON.stringify({ error: '请提供 campus_question_id。这是校园题 Id，不是本地题库 Id。先 list_campus_questions 或 search_campus_questions。' })
            }
            const cache = campusCacheOf(sessionId)
            const updated: CampusQuestion[] = []
            const failed: Array<{ campus_question_id: number; error: string }> = []
            for (const item of items) {
              let current = cache.questions.find((question) => question.id === item.campus_question_id) || null
              const paperId = item.paper_id || current?.question_bank_id || 0
              if (!current && paperId) {
                try {
                  const listed = await listFolderQuestions(paperId)
                  rememberCampusQuestions(sessionId, listed, { id: paperId, name: `试卷 ${paperId}` })
                  current = listed.find((question) => question.id === item.campus_question_id) || null
                } catch {
                  // keep going
                }
              }
              if (!paperId) {
                failed.push({ campus_question_id: item.campus_question_id, error: '改题必须带上 paper_id，或先 list_campus_questions 再改，以免题目被移出试卷' })
                continue
              }
              const nextType = item.question_type
                ? campusApiType(item.question_type, item.options ?? current?.options)
                : undefined
              const nextOptions = item.options != null ? encodeCampusOptions(item.options) : undefined
              const nextAnswer = item.answer
                ? encodeCampusAnswer(item.answer, item.options ?? current?.options, nextType || current?.type)
                : undefined
              if (!item.question && !nextOptions && !nextAnswer && !nextType && paperId === current?.question_bank_id) {
                failed.push({ campus_question_id: item.campus_question_id, error: '没有要改的字段' })
                continue
              }
              try {
                const saved = await updateCampusQuestion(item.campus_question_id, {
                  type: nextType,
                  content: item.question,
                  options: nextOptions,
                  answer: nextAnswer,
                  question_bank_id: paperId,
                })
                const next = saved || {
                  id: item.campus_question_id,
                  type: nextType || current?.type || 'short_answer',
                  content: item.question || current?.content || `题目 ${item.campus_question_id}`,
                  options: nextOptions || current?.options || '',
                  answer: nextAnswer || current?.answer || '',
                  question_bank_id: paperId,
                }
                updated.push(next)
                rememberCampusQuestions(sessionId, [next], {
                  id: paperId,
                  name: cache.papers.find((paper) => paper.id === paperId)?.name || `试卷 ${paperId}`,
                  courseId: cache.papers.find((paper) => paper.id === paperId)?.courseId,
                  courseName: cache.papers.find((paper) => paper.id === paperId)?.courseName,
                })
              } catch (err) {
                const message = campusFail(err, '修改失败')
                failed.push({ campus_question_id: item.campus_question_id, error: message })
                if (/认证|登录已失效/.test(message)) break
              }
            }
            const title = '已修改的校园题'
            if (updated.length) publishCampusQuestionCards(call.id, updated, title)
            return clipToolResult(JSON.stringify({
              campus: ctx.identity.campus!.name,
              updated: updated.length,
              failed: failed.length || undefined,
              errors: failed.length ? failed.slice(0, 8) : undefined,
              title: updated.length ? title : undefined,
              questions: updated.map((item) => ({
                campus_question_id: item.id,
                question: String(item.content || '').slice(0, 80),
                question_type: campusQuestionTypeLabel(item.type),
              })),
              message: updated.length
                ? `已修改 ${updated.length} 道校园题，并弹出浏览卡片。不要再列出选项。用户没说练习就不要 present_quiz。`
                : failed[0]?.error || '没有改成功的题目',
            }))
          } catch (err) {
            return JSON.stringify({ error: campusFail(err, '修改校园题失败') })
          }
        }

        if (call.name === 'search_questions') {
          const keyword = String(args.keyword || '').trim()
          if (!keyword) return JSON.stringify({ error: '关键词不能为空' })
          const folder = args.folder_id != null || args.folder_name
            ? await resolveFolder(args.folder_id, args.folder_name)
            : null
          if ((args.folder_id != null || args.folder_name) && !folder) {
            return JSON.stringify({ error: '没有找到这个文件夹' })
          }
          const found = await databaseService.searchQuestionsByTitle(keyword, folder?.id)
          const items = found.slice(0, 40)
          rememberListed(sessionId, items)
          return clipToolResult(JSON.stringify({
            keyword,
            folderId: folder?.id,
            folderName: folder?.name,
            total: found.length,
            count: items.length,
            hasMore: found.length > items.length,
            questions: await withPractice(items),
          }))
        }

        if (call.name === 'move_questions') {
          const target = await resolveFolder(args.folder_id, args.folder_name)
          if (!target) return JSON.stringify({ error: '没有找到目标文件夹' })
          const source = args.source_folder_id != null || args.source_folder_name
            ? await resolveFolder(args.source_folder_id, args.source_folder_name)
            : null
          if ((args.source_folder_id != null || args.source_folder_name) && !source) {
            return JSON.stringify({ error: '没有找到源文件夹' })
          }

          const ids = parseQuestionIds(args)
          const keyword = String(args.keyword || '').trim()
          const selected = new Map<number, ReturnType<typeof summarizeQuestion>>()

          if (source) {
            const inFolder = await databaseService.getAIResponses(source.id)
            for (const item of inFolder) {
              if (ids.includes(item.id)) selected.set(item.id, summarizeQuestion(item))
            }
            if (keyword) {
              const found = await databaseService.searchQuestionsByTitle(keyword, source.id)
              for (const item of found.slice(0, 50)) selected.set(item.id, summarizeQuestion(item))
            }
          }

          if (ids.length && !source) {
            for (const id of ids) selected.set(id, summarizeQuestion({ id }))
          }

          if (keyword && !source) {
            const found = await databaseService.searchQuestionsByTitle(keyword)
            for (const item of found.slice(0, 50)) selected.set(item.id, summarizeQuestion(item))
          }

          const moving = [...selected.values()].slice(0, 50)
          if (!moving.length) {
            return JSON.stringify({ error: '没有找到要移动的题目，请先 list_questions 或 search_questions 拿到 Id' })
          }

          for (const item of moving) {
            await databaseService.moveQuestionToFolder(item.id, target.id)
          }
          notifyFoldersChanged(target.id)
          return JSON.stringify({
            moved: moving.length,
            questionIds: moving.map((item) => item.id),
            questions: moving.map((item) => item.question).filter(Boolean).slice(0, 12),
            targetId: target.id,
            targetName: target.name,
            sourceId: source?.id,
            sourceName: source?.name,
            message: `已把 ${moving.length} 道题目移到「${target.name}」`,
          })
        }

        if (call.name === 'save_questions') {
          const questions = parseQuestions(args.questions)
          if (!questions.length) {
            return JSON.stringify({ saved: 0, message: '没有有效题目，需要 question 和 answer' })
          }
          const attachedFolder = sessionFolders(sessionId)[0]
          const folder = (await resolveFolder(args.folder_id, args.folder_name))
            || (attachedFolder?.folderId != null ? await resolveFolder(attachedFolder.folderId) : null)
            || (attachment?.folderId != null ? await resolveFolder(attachment.folderId) : null)
            || (await resolveFolder(0))
          const attachedSubject = Number(sessions.value.find((item) => item.id === sessionId)?.studySubjectId)
          const result = await saveQuestions(
            questions,
            folder?.id ?? 0,
            attachedSubject > 0 ? attachedSubject : undefined,
          )
          const linked = result.association.linked
          return JSON.stringify({
            saved: result.saved,
            questionIds: result.questionIds,
            folderId: folder?.id ?? 0,
            folderName: folder?.name || '默认',
            linked,
            created_nodes: result.association.created,
            knowledge: result.association.links.slice(0, 20).map((item) => ({
              question_id: item.question_id,
              node_id: item.node_id,
              node_name: item.node_name,
              subject_id: item.subject_id,
            })),
            message: linked
              ? `已写入 ${result.saved} 道题目到「${folder?.name || '默认'}」，并关联了 ${linked} 个知识点`
              : `已写入 ${result.saved} 道题目到「${folder?.name || '默认'}」`,
          })
        }

        if (call.name === 'update_question_metrics') {
          const ids = parseQuestionIds(args)
          if (!ids.length) return JSON.stringify({ error: '需要 question_id 或 question_ids' })
          const patch: { importance?: number; mastery?: number; difficulty?: number } = {}
          if (args.importance != null) patch.importance = parseImportance(args.importance)
          if (args.mastery != null) patch.mastery = parseMastery(args.mastery)
          if (args.difficulty != null) patch.difficulty = parseDifficulty(args.difficulty)
          if (!Object.keys(patch).length) return JSON.stringify({ error: '至少提供 importance、mastery 或 difficulty 之一' })
          for (const id of ids) {
            await databaseService.updateQuestion(id, patch)
          }
          notifyFoldersChanged()
          return JSON.stringify({
            updated: ids.length,
            questionIds: ids,
            ...patch,
            message: `已更新 ${ids.length} 道题目的指标`,
          })
        }

        if (call.name === 'get_practice_history') {
          const questionId = Number(args.question_id)
          if (!Number.isFinite(questionId) || questionId <= 0) {
            return JSON.stringify({ error: 'question_id 无效' })
          }
          const limit = Math.min(30, Math.max(1, Number(args.limit) || 10))
          const records = await databaseService.getPracticeHistory(questionId, limit)
          return JSON.stringify({
            questionId,
            count: records.length,
            records: records.map((item) => ({
              id: item.id,
              userAnswer: item.user_answer,
              correct: item.is_correct,
              note: item.note,
              source: item.source,
              time: item.create_time,
            })),
          })
        }

        if (call.name === 'add_practice_note') {
          const questionId = Number(args.question_id)
          const note = String(args.note || '').trim()
          if (!Number.isFinite(questionId) || questionId <= 0) {
            return JSON.stringify({ error: 'question_id 无效' })
          }
          if (!note) return JSON.stringify({ error: '备注不能为空' })
          const record = await databaseService.addPracticeRecord({
            questionId,
            userAnswer: '',
            isCorrect: false,
            note,
            source: 'agent-note',
          })
          return JSON.stringify({
            id: record.id,
            questionId,
            note,
            message: '已记下备注',
          })
        }

        if (call.name === 'present_quiz') {
          const campusQuiz = await resolveCampusQuizCards(sessionId, args)
          let cards = campusQuiz.cards
          if (!cards.length) cards = await resolveQuizCards(args)
          if (!cards.length) {
            const count = Math.min(10, Math.max(1, Number(args.count) || 5))
            const folder = args.folder_id != null ? await resolveFolder(args.folder_id, args.folder_name) : null
            cards = await pickPracticeCards(sessionId, count, folder?.id)
          }
          if (!cards.length) {
            return JSON.stringify({
              error: parseCampusQuestionIds(args).length || args.paper_id
                ? '没有找到这些校园题。先 list_campus_questions，再把 campus_question_ids 或 paper_id 传给 present_quiz。'
                : '没有可出示的题目。请先 list_questions，或传入 question_ids。',
            })
          }
          const attachedSubject = Number(sessions.value.find((item) => item.id === sessionId)?.studySubjectId)
          const subjectId = attachedSubject > 0 ? attachedSubject : undefined
          const focus = subjectId ? lastStudyFocus.get(subjectId) : undefined
          const defaultNodeId = Number(args.node_id) > 0 ? Number(args.node_id) : focus?.nodeId
          const defaultNodeName = String(args.node_name || args.knowledge_point || focus?.nodeName || '').trim()
          const defaultParent = String(args.parent_name || '').trim()
          cards = cards.map((card) => ({
            ...card,
            node_id: card.node_id || defaultNodeId,
            node_name: card.node_name || defaultNodeName || undefined,
            knowledge_point: card.knowledge_point || defaultNodeName || undefined,
            parent_name: card.parent_name || defaultParent || undefined,
            subject_id: card.subject_id || subjectId,
          }))
          const folder = args.folder_id != null ? await resolveFolder(args.folder_id, args.folder_name) : null
          const existingHints: QuestionKnowledgeHint[] = []
          for (let index = 0; index < cards.length; index += 1) {
            const card = cards[index]
            if (card.question_id) {
              if (card.node_id || card.node_name || card.knowledge_point || card.parent_name) {
                existingHints.push({
                  questionId: card.question_id,
                  question: card.question,
                  knowledge_point: card.knowledge_point,
                  node_name: card.node_name,
                  node_id: card.node_id,
                  parent_name: card.parent_name,
                  subject_id: card.subject_id || subjectId,
                })
              }
              continue
            }
            if (!card.question || !card.answer) continue
            const saved = await saveQuestions([{
              question: card.question,
              options: card.options,
              answer: card.answer,
              question_type: card.question_type,
              knowledge_point: card.knowledge_point,
              node_name: card.node_name,
              node_id: card.node_id,
              parent_name: card.parent_name,
              subject_id: card.subject_id || subjectId,
            }], folder?.id ?? 0, subjectId)
            const id = saved.questionIds[0]
            if (id) cards[index] = { ...card, uid: `q-${id}`, question_id: id }
          }
          const presentedIds = cards.map((card) => card.question_id).filter((id): id is number => Number(id) > 0)
          const existingLinks = presentedIds.length
            ? await databaseService.listQuestionKnowledge(presentedIds).catch(() => [])
            : []
          const linkedIds = new Set(existingLinks.map((item) => item.question_id))
          for (const card of cards) {
            if (!card.question_id || linkedIds.has(card.question_id)) continue
            if (!(card.node_id || card.node_name || card.knowledge_point || card.parent_name)) continue
            existingHints.push({
              questionId: card.question_id,
              question: card.question,
              knowledge_point: card.knowledge_point,
              node_name: card.node_name,
              node_id: card.node_id,
              parent_name: card.parent_name,
              subject_id: card.subject_id || subjectId,
            })
          }
          if (existingHints.length) {
            const associated = await associateQuestionsToKnowledge(existingHints, { subjectId, createMissing: true })
            if (associated.linked || associated.created) {
              notifyQuestionKnowledgeUpdated({ subjectId })
              window.dispatchEvent(new CustomEvent('study-graph-updated', { detail: { subjectId } }))
            }
          }
          const links = presentedIds.length
            ? await databaseService.listQuestionKnowledge(presentedIds).catch(() => [])
            : []
          const knowledgeByQuestion = new Map<number, string[]>()
          for (const item of links) {
            const names = knowledgeByQuestion.get(item.question_id) || []
            if (item.node_name && !names.includes(item.node_name)) names.push(item.node_name)
            knowledgeByQuestion.set(item.question_id, names)
          }
          const title = resolveQuizTitle({
            ...args,
            title: args.title || campusQuiz.title,
            paper_name: args.paper_name || campusQuiz.title,
          }, cards)
          saveQuizCards(call.id, cards)
          saveQuizTitle(call.id, title)
          return JSON.stringify({
            presented: cards.length,
            title,
            questions: cards.map((card) => ({
              question_id: card.question_id,
              question: card.question.slice(0, 180),
              question_type: card.question_type,
              importance: card.importance,
              mastery: card.mastery,
              difficulty: card.difficulty,
              knowledge_point: (card.question_id && knowledgeByQuestion.get(card.question_id)?.join('、'))
                || card.node_name
                || card.knowledge_point,
            })),
            message: `已出示 ${cards.length} 道可点选练习，作答会记到关联知识点。现在直接用一两句话收尾，不要再调用任何工具，也不要再列出选项。`,
          })
        }

        const notifyStudyGraph = (subjectId?: number) => {
          window.dispatchEvent(new CustomEvent('study-graph-updated', { detail: { subjectId } }))
        }

        const publishGraph = (payload: Awaited<ReturnType<typeof databaseService.getStudyGraph>>, streaming = true) => {
          drawingGraph = true
          emitStudyGraphStream({
            subjectId: payload.subject.id,
            mermaid: graphToMermaid(graphFromPayload(payload)),
            streaming,
          })
          notifyStudyGraph(payload.subject.id)
        }

        const resolveSubject = async (id?: number, name?: string, fallbackSingle = false) => {
          const subjects = await databaseService.listStudySubjects()
          if (Number.isFinite(id) && Number(id) > 0) {
            const found = subjects.find((item) => Number(item.id) === Number(id))
            if (found) return found
          }
          const keyword = String(name || '').trim()
          if (keyword) {
            const exact = subjects.filter((item) => item.name === keyword)
            if (exact.length === 1) return exact[0]
            if (exact.length > 1) throw new Error(`有多个同名科目「${keyword}」，请改用 subject_id`)
            const fuzzy = subjects.filter((item) => item.name.includes(keyword))
            if (fuzzy.length === 1) return fuzzy[0]
            if (fuzzy.length > 1) throw new Error(`有多个科目名称包含「${keyword}」，请改用 subject_id`)
          }
          if (fallbackSingle && subjects.length === 1) return subjects[0]
          return null
        }

        const summarizeSubjects = (subjects: Awaited<ReturnType<typeof databaseService.listStudySubjects>>) =>
          subjects.map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            node_count: item.node_count,
            progress: Math.round((item.progress || 0) * 100),
          }))

        const summarizeGraph = (payload: Awaited<ReturnType<typeof databaseService.getStudyGraph>>) => {
          const parentIds = new Set(
            payload.nodes.map((item) => item.parent_id).filter((id): id is number => id != null),
          )
          return {
            subject: payload.subject,
            node_count: payload.nodes.length,
            note: 'forgetting_stage 是 0–6 复习点。父节点熟练度由子节点汇总。',
            nodes: payload.nodes.map((item) => {
              const stage = clampForgettingStage(item.forgetting_stage)
              const retention = retentionScore(item)
              return {
                id: item.id,
                key: item.node_key,
                name: item.name,
                summary: String(item.summary || '').slice(0, 80),
                forgetting_stage: stage,
                stage_label: forgettingStageLabel(stage),
                retention: retention == null ? null : Math.round(retention * 100),
                last_reviewed_at: item.last_reviewed_at || null,
                parent_id: item.parent_id || null,
                leaf: !parentIds.has(item.id),
              }
            }),
          }
        }

        const SCATTERED_LEAF = /定理|方程|分解|Card-?Krueger|Oaxaca|Blinder|CES|生产函数|明瑟|保留工资|弹性系数/
        const graphBuildMessage = (
          payload: Awaited<ReturnType<typeof databaseService.getStudyGraph>>,
          added: number,
        ) => {
          const nodes = payload.nodes
          const roots = nodes.filter((item) => !item.parent_id)
          const bareChapters = roots.filter((root) => !nodes.some((item) => item.parent_id === root.id))
          const scattered = nodes.filter((item) => SCATTERED_LEAF.test(item.name))
          if (scattered.length >= 4) {
            return `已添加 ${added} 个，当前共 ${nodes.length} 个，但有不少定理/论文名叶子，图谱会散落。请停止再加这类叶子，改为按教材目录给缺节的章补 2–4 个节名。`
          }
          if (roots.length < 8 && nodes.length < 20) {
            return `已添加 ${added} 个，当前共 ${nodes.length} 个。请先把章写全（目标 8–12 个章名），再给每章补节。继续 patch_knowledge_graph，不要停。`
          }
          if (bareChapters.length) {
            const names = bareChapters.slice(0, 6).map((item) => item.name).join('、')
            return `已添加 ${added} 个，当前共 ${nodes.length} 个。这些章还没有节：${names}。请继续给它们各加 2–4 个节名，不要加定理或论文名。`
          }
          if (nodes.length < 28 && added >= 3) {
            return `已添加 ${added} 个，当前共 ${nodes.length} 个。若用户是从零画图，继续给尚未展开的章补 2–4 个节；若只是补某几处，现在可以停。`
          }
          return `已添加 ${added} 个，当前共 ${nodes.length} 个。不要整图重画。用一两句话说明改了什么。`
        }

        const resolveSubjectFromArgs = async (raw: Record<string, unknown> | any, fallbackAttached = true) => {
          const ref = pickSubjectRef(raw)
          let subject = await resolveSubject(ref.id, ref.name, true)
          if (!subject && fallbackAttached) {
            const attached = Number(sessions.value.find((item) => item.id === sessionId)?.studySubjectId)
            if (attached > 0) subject = await resolveSubject(attached)
          }
          return subject
        }

        if (call.name === 'list_subjects') {
          const subjects = await databaseService.listStudySubjects()
          return JSON.stringify({
            count: subjects.length,
            subjects: summarizeSubjects(subjects),
            message: subjects.length
              ? '查看某一科请用 get_subject，展开思维导图请用 open_knowledge_graph。'
              : '还没有学习科目。请先 create_subject。',
          })
        }

        if (call.name === 'get_subject') {
          const subject = await resolveSubjectFromArgs(args)
          if (!subject) {
            const subjects = await databaseService.listStudySubjects()
            return JSON.stringify({
              error: '找不到该科目',
              subjects: summarizeSubjects(subjects),
              message: subjects.length ? '请用上面的 subject_id 再调用 get_subject。' : '还没有科目，请先 create_subject。',
            })
          }
          const payload = await databaseService.getStudyGraph(subject.id)
          openStudyGraphPane(subject.id)
          return JSON.stringify({
            ...summarizeSubjects([subject])[0],
            description: subject.description,
            node_count: payload.nodes.length,
            chapters: payload.nodes
              .filter((item) => !item.parent_id)
              .map((item) => item.name)
              .slice(0, 16),
            message: payload.nodes.length
              ? `已打开「${subject.name}」的思维导图。`
              : `已打开「${subject.name}」，图谱还是空的。${WRITE_GRAPH_HINT}`,
          })
        }

        if (call.name === 'open_knowledge_graph') {
          const subject = await resolveSubjectFromArgs(args)
          if (!subject) {
            const subjects = await databaseService.listStudySubjects()
            return JSON.stringify({
              error: '找不到要展开的科目',
              subjects: summarizeSubjects(subjects),
              message: subjects.length ? '请指定 subject_id，或先挂上学习状态。' : '还没有科目，请先 create_subject。',
            })
          }
          const payload = await databaseService.getStudyGraph(subject.id)
          openStudyGraphPane(subject.id)
          return JSON.stringify({
            opened: true,
            subject: summarizeSubjects([subject])[0],
            node_count: payload.nodes.length,
            message: payload.nodes.length
              ? `已展开「${subject.name}」的思维导图。`
              : `已展开「${subject.name}」，图谱还是空的。${WRITE_GRAPH_HINT}`,
          })
        }

        if (call.name === 'create_subject') {
          const name = String(args.name || '').trim()
          if (!name) return JSON.stringify({ error: '科目名称不能为空' })
          const subject = await databaseService.createStudySubject(name, String(args.description || ''))
          notifyStudyGraph(subject.id)
          if (!sessions.value.find((item) => item.id === sessionId)?.studySubjectId) {
            setChatStudySubject(subject.id, sessionId)
          }
          openStudyGraphPane(subject.id)
          return JSON.stringify({
            ...subject,
            attached: Boolean(sessions.value.find((item) => item.id === sessionId)?.studySubjectId === subject.id),
            message: `已创建科目「${subject.name}」，subject_id=${subject.id}，并展开了思维导图。${WRITE_GRAPH_HINT}`,
          })
        }

        if (call.name === 'attach_study_subject') {
          const ref = pickSubjectRef(args)
          const subject = await resolveSubject(ref.id, ref.name, true)
          if (!subject) return JSON.stringify({ error: '找不到该科目，请先 list_subjects 或 create_subject' })
          setChatStudySubject(subject.id, sessionId)
          return JSON.stringify({
            attached: true,
            id: subject.id,
            name: subject.name,
            progress: Math.round((subject.progress || 0) * 100),
            node_count: subject.node_count,
            message: `已把「${subject.name}」挂到当前对话，右上角会显示正在学习。`,
          })
        }

        if (call.name === 'detach_study_subject') {
          const currentId = sessions.value.find((item) => item.id === sessionId)?.studySubjectId
          const subjects = currentId ? await databaseService.listStudySubjects().catch(() => []) : []
          const current = subjects.find((item) => item.id === currentId)
          if (currentId && current) {
            finalizeStudySessionSummary({ subjectId: currentId, subjectName: current.name })
          }
          setChatStudySubject(null, sessionId)
          return JSON.stringify({
            attached: false,
            name: current?.name,
            message: current ? `已撤下「${current.name}」的学习状态。` : '当前对话没有学习状态。',
          })
        }

        if (call.name === 'rename_subject') {
          const ref = pickSubjectRef(args)
          const subject = await resolveSubject(ref.id, ref.name)
          if (!subject) return JSON.stringify({ error: '找不到该科目，请先 list_subjects' })
          const updated = await databaseService.renameStudySubject(
            subject.id,
            args.new_name == null ? undefined : String(args.new_name),
            args.description == null ? undefined : String(args.description),
          )
          notifyStudyGraph(updated.id)
          return JSON.stringify(updated)
        }

        if (call.name === 'delete_subject') {
          const ref = pickSubjectRef(args)
          const subject = await resolveSubject(ref.id, ref.name)
          if (!subject) return JSON.stringify({ error: '找不到该科目' })
          await databaseService.deleteStudySubject(subject.id)
          notifyStudyGraph(subject.id)
          return JSON.stringify({ deleted: true, id: subject.id, name: subject.name })
        }

        if (call.name === 'get_knowledge_graph') {
          try {
            const ref = pickSubjectRef(args)
            const subject = await resolveSubject(ref.id, ref.name, true)
            if (!subject) {
              const subjects = await databaseService.listStudySubjects()
              return JSON.stringify({
                found: false,
                subjects: summarizeSubjects(subjects),
                message: subjects.length
                  ? `未匹配到科目。请用上面的 id 作为 subject_id。${WRITE_GRAPH_HINT}`
                  : `还没有科目。请先 create_subject，然后 ${WRITE_GRAPH_HINT}`,
              })
            }
            const payload = await databaseService.getStudyGraph(subject.id)
            return JSON.stringify({
              ...summarizeGraph(payload),
              message: payload.nodes.length
                ? KEEP_GRAPH_HINT
                : `图谱为空。${WRITE_GRAPH_HINT}`,
            })
          } catch (error) {
            const subjects = await databaseService.listStudySubjects().catch(() => [])
            return JSON.stringify({
              found: false,
              subjects: summarizeSubjects(subjects),
              message: `查看失败：${error instanceof Error ? error.message : String(error)}。${WRITE_GRAPH_HINT}`,
            })
          }
        }

        if (call.name === 'set_knowledge_graph') {
          try {
            let nodes = collectGraphNodes(args, call.arguments)
            const ref = pickSubjectRef(args)
            let subject = await resolveSubject(ref.id, ref.name, true)
            if (!subject && ref.name) {
              subject = await databaseService.createStudySubject(ref.name, '')
            }
            if (!subject) {
              const subjects = await databaseService.listStudySubjects()
              return JSON.stringify({
                error: subjects.length
                  ? `请提供 subject_id。现有科目：${subjects.map((item) => `${item.name}(id=${item.id})`).join('、')}。然后带 outline 再调用 set_knowledge_graph。`
                  : '请先 create_subject，再 set_knowledge_graph 写入 outline。',
                subjects: summarizeSubjects(subjects),
              })
            }
            if (!nodes.length) {
              return JSON.stringify({ error: `没有解析到知识点。${WRITE_GRAPH_HINT}` })
            }
            const existing = await databaseService.getStudyGraph(subject.id)
            const replace = args.replace === true || args.replace === 'true'
            if (existing.nodes.length && !replace) {
              return JSON.stringify({
                error: `「${subject.name}」已有 ${existing.nodes.length} 个节点。${KEEP_GRAPH_HINT}`,
              })
            }
            if (existing.nodes.length >= 8 && nodes.length < Math.min(8, Math.ceil(existing.nodes.length / 3))) {
              return JSON.stringify({
                error: `这次只解析到 ${nodes.length} 个节点，少于已有图谱，没有覆盖。请改用 patch_knowledge_graph 分批添加。`,
              })
            }
            const payload = await databaseService.setStudyGraph(
              subject.id,
              nodes,
              parseGraphEdgeInputs(args.edges),
            )
            publishGraph(payload, true)
            return JSON.stringify({
              ...summarizeGraph(payload),
              message: graphBuildMessage(payload, payload.nodes.length),
            })
          } catch (error) {
            return JSON.stringify({
              error: `写入失败：${error instanceof Error ? error.message : String(error)}。请改用 outline 再调用 set_knowledge_graph，不要让用户手动创建。`,
            })
          }
        }

        if (call.name === 'focus_knowledge_graph') {
          const nodeName = String(args.node_name ?? args.name ?? args.node ?? '').trim()
          const nodeId = Number(args.node_id ?? args.id)
          if (!nodeName && !(Number.isFinite(nodeId) && nodeId > 0)) {
            return JSON.stringify({ error: '请提供 node_name，用图谱里的章名或节名' })
          }
          const subjectId = Number(args.subject_id ?? args.subjectId)
          const subjectName = String(args.subject_name ?? args.subjectName ?? '').trim()
          let subject = await resolveSubject(
            Number.isFinite(subjectId) && subjectId > 0 ? subjectId : undefined,
            subjectName || undefined,
            true,
          )
          if (!subject) {
            const attached = Number(sessions.value.find((item) => item.id === sessionId)?.studySubjectId)
            if (attached > 0) subject = await resolveSubject(attached)
          }
          if (!subject) return JSON.stringify({ error: '找不到科目，请先 list_subjects 或挂上学习状态' })
          const payload = await databaseService.getStudyGraph(subject.id)
          if (!payload.nodes.length) {
            return JSON.stringify({ error: '这个科目还没有图谱', subject: payload.subject })
          }
          const byId = Number.isFinite(nodeId) && nodeId > 0
            ? payload.nodes.find((item) => item.id === nodeId)
            : null
          const exact = byId || payload.nodes.find((item) => item.name === nodeName || item.node_key === nodeName)
          const fuzzy = exact || payload.nodes.filter((item) =>
            item.name.includes(nodeName) || nodeName.includes(item.name),
          )
          const matched = Array.isArray(fuzzy)
            ? (fuzzy.find((item) => item.name.startsWith(nodeName)) || (fuzzy.length === 1 ? fuzzy[0] : null))
            : fuzzy
          if (!matched) {
            const candidates = Array.isArray(fuzzy) && fuzzy.length
              ? fuzzy.map((item) => item.name).slice(0, 8)
              : payload.nodes.map((item) => item.name).slice(0, 20)
            return JSON.stringify({
              error: `图谱里没有「${nodeName || nodeId}」`,
              candidates,
            })
          }
          openStudyGraphPane(subject.id, matched.name, matched.id)
          return JSON.stringify({
            focused: true,
            subject: { id: subject.id, name: subject.name },
            node: {
              id: matched.id,
              key: matched.node_key,
              name: matched.name,
              summary: String(matched.summary || '').slice(0, 120),
              mastery: matched.mastery,
            },
            message: `已在图谱中聚焦「${matched.name}」`,
          })
        }

        if (call.name === 'patch_knowledge_graph') {
          const ref = pickSubjectRef(args)
          const subject = await resolveSubject(ref.id, ref.name, true)
          if (!subject) return JSON.stringify({ error: '找不到该科目，请先 list_subjects' })
          let add = parseGraphNodeInputs(args.add ?? args.nodes)
          if (!add.length) add = collectGraphNodes(args, call.arguments)
          if (!add.length && !args.update && !args.remove_ids) {
            return JSON.stringify({ error: `没有解析到要添加的节点。${WRITE_GRAPH_HINT}` })
          }
          const payload = await databaseService.patchStudyGraph(subject.id, {
            add,
            update: Array.isArray(args.update) ? args.update as StudyGraphNodePatch[] : undefined,
            remove_ids: Array.isArray(args.remove_ids)
              ? args.remove_ids.map((id) => Number(id)).filter((id) => Number.isFinite(id))
              : undefined,
          })
          publishGraph(payload, true)
          return JSON.stringify({
            ...summarizeGraph(payload),
            added: add.length,
            message: graphBuildMessage(payload, add.length),
          })
        }

        if (call.name === 'link_questions_to_knowledge') {
          const subject = await resolveSubjectFromArgs(args).catch(() => null)
          const rows = Array.isArray(args.questions) ? args.questions : []
          const ids = parseQuestionIds(args)
          const hints = [
            ...rows.map((item: any) => ({
              questionId: Number(item?.question_id || item?.id),
              question: String(item?.question || ''),
              knowledge_point: String(item?.knowledge_point || '').trim() || undefined,
              node_name: String(item?.node_name || item?.knowledge_point || '').trim() || undefined,
              node_id: Number(item?.node_id) > 0 ? Number(item.node_id) : undefined,
              parent_name: String(item?.parent_name || '').trim() || undefined,
              subject_id: Number(item?.subject_id) > 0 ? Number(item.subject_id) : subject?.id,
            })),
            ...ids.map((id) => ({
              questionId: id,
              knowledge_point: String(args.knowledge_point || '').trim() || undefined,
              node_name: String(args.node_name || args.knowledge_point || '').trim() || undefined,
              node_id: Number(args.node_id) > 0 ? Number(args.node_id) : undefined,
              parent_name: String(args.parent_name || '').trim() || undefined,
              subject_id: subject?.id,
            })),
          ].filter((item) => item.questionId > 0)
          if (!hints.length) return JSON.stringify({ error: '需要 question_id 或 question_ids' })
          const result = await associateQuestionsToKnowledge(hints, {
            subjectId: subject?.id,
            createMissing: true,
          })
          if (result.created || result.linked) notifyStudyGraph(subject?.id)
          return JSON.stringify({
            linked: result.linked,
            created_nodes: result.created,
            skipped: result.skipped,
            knowledge: result.links.slice(0, 30).map((item) => ({
              question_id: item.question_id,
              node_id: item.node_id,
              node_name: item.node_name,
              subject_id: item.subject_id,
              subject_name: item.subject_name,
            })),
            message: result.linked
              ? `已把 ${result.linked} 道题目关联到知识点${result.created ? `，并新建了 ${result.created} 个节点` : ''}`
              : '没有关联成功。请先挂上学习状态或指定 subject_id / node_name。',
          })
        }

        if (call.name === 'list_recent_wrong_questions') {
          const subject = await resolveSubjectFromArgs(args).catch(() => null)
          const folder = args.folder_id != null || args.folder_name
            ? await resolveFolder(args.folder_id, args.folder_name)
            : null
          let nodeId = Number(args.node_id)
          let nodeName = String(args.node_name || '').trim()
          if ((!Number.isFinite(nodeId) || nodeId <= 0) && nodeName) {
            if (!subject) return JSON.stringify({ error: '按知识点筛选时请提供 node_id，或同时提供科目和 node_name' })
            const payload = await databaseService.getStudyGraph(subject.id)
            const matched = payload.nodes.filter((item) => item.name === nodeName || item.name.includes(nodeName) || nodeName.includes(item.name))
            const node = matched.find((item) => item.name === nodeName)
              || (matched.length === 1 ? matched[0] : matched.find((item) => item.name.startsWith(nodeName)) || null)
            if (!node) {
              return JSON.stringify({
                error: `图谱里没有「${nodeName}」`,
                candidates: payload.nodes.map((item) => item.name).slice(0, 20),
              })
            }
            nodeId = node.id
            nodeName = node.name
          }
          const days = Math.min(365, Math.max(1, Number(args.days) || 30))
          const limit = Math.min(40, Math.max(1, Number(args.limit) || 20))
          const items = await databaseService.listRecentWrongQuestions({
            subjectId: Number.isFinite(nodeId) && nodeId > 0 ? undefined : subject?.id,
            nodeId: Number.isFinite(nodeId) && nodeId > 0 ? nodeId : undefined,
            folderId: folder?.id,
            days,
            limit,
            unresolvedOnly: args.unresolved_only === true,
          })
          const questions = items.length
            ? await databaseService.getQuestionsByIds(items.map((item) => item.question_id))
            : []
          const byId = new Map(questions.map((item) => [item.id, item]))
          const hydrated = await withPractice(items.map((item) => byId.get(item.question_id)).filter(Boolean) as typeof questions)
          const extra = new Map(items.map((item) => [item.question_id, item]))
          const scope = nodeName
            ? `「${nodeName}」`
            : subject
              ? `「${subject.name}」`
              : folder
                ? `「${folder.name}」`
                : '全部题库'
          rememberListed(sessionId, hydrated)
          return clipToolResult(JSON.stringify({
            scope,
            days,
            count: hydrated.length,
            questions: hydrated.map((item) => {
              const wrong = extra.get(item.id)
              return {
                ...item,
                lastWrongAnswer: wrong?.last_wrong_answer || '',
                lastWrongNote: wrong?.last_wrong_note || '',
                lastWrongTime: wrong?.last_wrong_time || '',
                wrongCount: wrong?.wrong_count || 0,
              }
            }),
            message: hydrated.length
              ? `最近 ${days} 天${scope}有 ${hydrated.length} 道答错过的题。recent 从早到晚，true=对，false=错。`
              : `最近 ${days} 天${scope}没有答错过的题。`,
          }))
        }

        if (call.name === 'list_knowledge_questions') {
          const subject = await resolveSubjectFromArgs(args).catch(() => null)
          const nodeId = Number(args.node_id)
          let resolvedId = Number.isFinite(nodeId) && nodeId > 0 ? nodeId : 0
          let nodeName = String(args.node_name || '').trim()
          if (!resolvedId) {
            if (!subject || !nodeName) {
              return JSON.stringify({ error: '请提供 node_id，或同时提供科目和 node_name' })
            }
            const payload = await databaseService.getStudyGraph(subject.id)
            const matched = payload.nodes.find((item) => item.name === nodeName)
              || payload.nodes.filter((item) => item.name.includes(nodeName) || nodeName.includes(item.name))
            const node = Array.isArray(matched)
              ? (matched.length === 1 ? matched[0] : matched.find((item) => item.name.startsWith(nodeName)) || null)
              : matched
            if (!node) {
              return JSON.stringify({
                error: `图谱里没有「${nodeName}」`,
                candidates: payload.nodes.map((item) => item.name).slice(0, 20),
              })
            }
            resolvedId = node.id
            nodeName = node.name
          }
          const questionIds = await databaseService.listNodeQuestions(resolvedId)
          const questions = questionIds.length ? await databaseService.getQuestionsByIds(questionIds) : []
          return JSON.stringify({
            node_id: resolvedId,
            node_name: nodeName,
            count: questions.length,
            questions: await withPractice(questions.slice(0, 40)),
          })
        }

        if (call.name === 'merge_subjects') {
          const target = await resolveSubject(
            Number(args.target_id || args.subject_id) || undefined,
            String(args.target_name || args.subject_name || '').trim() || undefined,
            true,
          )
          if (!target) return JSON.stringify({ error: '找不到目标科目，请先 list_subjects' })
          const sourceIds = new Set<number>()
          const rawIds = Array.isArray(args.source_ids) ? args.source_ids : []
          for (const value of rawIds) {
            const id = Number(value)
            if (id > 0 && id !== target.id) sourceIds.add(id)
          }
          const names = Array.isArray(args.source_names) ? args.source_names : []
          for (const name of names) {
            const found = await resolveSubject(undefined, String(name || '').trim())
            if (found && found.id !== target.id) sourceIds.add(found.id)
          }
          if (!sourceIds.size) return JSON.stringify({ error: '请提供要并入的 source_ids 或 source_names' })
          const merged = await databaseService.mergeStudySubjects(target.id, [...sourceIds])
          notifyStudyGraph(merged.id)
          openStudyGraphPane(merged.id)
          return JSON.stringify({
            ...summarizeSubjects([merged])[0],
            merged_from: [...sourceIds],
            message: `已把 ${sourceIds.size} 个科目并入「${merged.name}」`,
          })
        }

        if (call.name === 'split_subject') {
          const subject = await resolveSubjectFromArgs(args)
          if (!subject) return JSON.stringify({ error: '找不到要拆分的科目' })
          const payload = await databaseService.getStudyGraph(subject.id)
          const resolvePartNodes = (ids: unknown, names: unknown) => {
            const set = new Set<number>()
            for (const value of Array.isArray(ids) ? ids : []) {
              const id = Number(value)
              if (payload.nodes.some((item) => item.id === id)) set.add(id)
            }
            for (const raw of Array.isArray(names) ? names : []) {
              const name = String(raw || '').trim()
              if (!name) continue
              const exact = payload.nodes.find((item) => item.name === name)
              const fuzzy = exact ? [exact] : payload.nodes.filter((item) => item.name.includes(name) || name.includes(item.name))
              if (fuzzy.length === 1) set.add(fuzzy[0].id)
            }
            return [...set]
          }
          const rawParts = Array.isArray(args.parts) ? args.parts : []
          const parts = rawParts.length
            ? rawParts.map((part: any) => ({
              name: String(part?.name || '').trim(),
              description: String(part?.description || ''),
              node_ids: resolvePartNodes(part?.node_ids, part?.node_names),
            }))
            : [{
              name: String(args.name || '').trim(),
              description: String(args.description || ''),
              node_ids: resolvePartNodes(args.node_ids, args.node_names),
            }]
          const valid = parts.filter((part) => part.name && part.node_ids.length)
          if (!valid.length) {
            return JSON.stringify({ error: '请提供要拆出的科目名，以及 node_ids 或准确的章/节名' })
          }
          const result = await databaseService.splitStudySubject(subject.id, valid)
          notifyStudyGraph(subject.id)
          for (const created of result.created) notifyStudyGraph(created.id)
          return JSON.stringify({
            original: summarizeSubjects([result.original])[0],
            created: summarizeSubjects(result.created),
            message: `已从「${subject.name}」拆出 ${result.created.map((item) => item.name).join('、')}`,
          })
        }

        if (call.name === 'evaluate_study_progress') {
          const subject = await resolveSubjectFromArgs(args)
          if (!subject) {
            return JSON.stringify({ error: '找不到科目，请先挂上学习状态或指定 subject_id' })
          }
          const hint = String(args.hint || args.notes || args.topic || '').trim()
          scheduleStudyProgressEval({
            sessionId,
            messageId: assistantId,
            subjectId: subject.id,
            hint,
            force: true,
            stepId: call.id,
          })
          return JSON.stringify({
            started: true,
            subject_id: subject.id,
            name: subject.name,
            message: '掌握度评估已交给后台助手，评估完会告诉用户。继续对话即可，不要等待评估结束，也不要口头打分。',
          })
        }

        return JSON.stringify({ error: `未知动作 ${call.name}` })
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
      const usedStudy = steps.some((step) => step.name === 'browser_chaoxing_study' && step.status === 'done')
      const usedPlay = steps.some((step) => step.name === 'browser_chaoxing_play' && step.status === 'done')
      const usedWatch = steps.some((step) => step.name === 'browser_chaoxing_watch' && step.status === 'done')
      const claimedPlaying = /正在播放|仍在播放|后台播放/.test(spoken)
      const watchDoneTurn = options?.kind === 'watch' && /已完成|已经结束/.test(`${content}\n${options?.modelText || ''}`)
      const leftAfterSkip = /没有视频|学习资料|正在打开下一节|已切换到下一节/.test(spoken)
      const stoppedMid = /让我查看|已进入|下一步|章节目录|正在打开下一节/.test(spoken)
        && !/正在播放|任务点已完成|遇到测验|开始监控|已确认在播|打开并播放/.test(spoken)
      const liveWatch = videoWatchFor(browserId)
      const actuallyWatching = Boolean(liveWatch && (liveWatch.status === 'watching' || liveWatch.status === 'paused' || liveWatch.status === 'stalled'))
      // study 工具调用成功 ≠ 已在播放；失败时仍要自动重试
      const alreadyWatching = actuallyWatching || ((usedPlay || usedWatch) && !/没有|失败|无法/.test(spoken))
      const studyFailedAskUser = wantsCourse && usedStudy && !alreadyWatching && options?.kind !== 'watch'
        && /请手动|建议您|建议：|无法自动|无法读取|无法定位|告诉我|提供具体|请先手动|跨域/.test(spoken)
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
      } else if (studyFailedAskUser) {
        keepSpoken()
        debug({ type: 'browser_continue', reason: 'study failed then asked user' })
        finalText = await runTextModel(
          '不要问用户，不要让用户手动点。立刻再调一次 browser_chaoxing_study。若已在目录页会直接解析未完成节并播放。不要 click_text「xxx(1)」。',
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
      } else if (wantsCourse && !alreadyWatching && options?.kind !== 'watch' && /请确认|您可以提供|无法自动定位|无法找到|建议：|请手动|告诉我具体|请告诉我|截图|配合提供|无法直接看到|请提供当前页面/.test(spoken)) {
        keepSpoken()
        debug({ type: 'browser_continue', reason: 'asked user instead of play' })
        finalText = await runTextModel(
          '不要问用户，不要要截图。立刻 browser_chaoxing_study，title 填目录里未完成的第一节（如维护网络安全）。不要再 get_page，不要再点「章节」。',
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
      } else if (askedCaptcha) {
        keepSpoken()
        debug({ type: 'browser_continue', reason: 'asked user to fill captcha' })
        finalText = await runTextModel(
          '不要让用户填验证码。立刻看页面 #ccc 图认出 4 位，调用 browser_chaoxing_captcha。提交后再 browser_chaoxing_study。不要问用户，不要 browser_wait。',
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
        finalText = await runTextModel(
          '跨域不是借口。不要再 get_page / eval / 打开 iframe。立刻只调 browser_chaoxing_study。不要问用户，不要说全部完成。',
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
      } else if (wantsCourse && stoppedMid && !alreadyWatching && options?.kind !== 'watch') {
        keepSpoken()
        debug({ type: 'browser_continue', reason: 'stopped before play' })
        finalText = await runTextModel(
          '任务还没做完。立刻只调 browser_chaoxing_study。不要 get_page，不要 eval iframe，不要打开 iframe 网址，不要问用户。',
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
      const stillNoStudy = wantsCourse && !wantsHomework && !alreadyWatching && options?.kind !== 'watch'
        && !(liveMessage()?.steps || []).some((step) => step.name === 'browser_chaoxing_study')
      const sawCatalog = wantsCourse && !alreadyWatching && options?.kind !== 'watch'
        && /已完成任务点|需要开始播放未完成|【章节目录】/.test(spokenText || liveContent())
        && !/正在播放|已确认在播|进度正常/.test(spokenText || liveContent())
      if (stillNoStudy) {
        keepSpoken()
        debug({ type: 'browser_continue', reason: 'never called study' })
        finalText = await runTextModel(
          '这一轮还没调用 browser_chaoxing_study。立刻只调这一次，不要 get_page，不要 eval，不要打开 iframe 网址，不要问用户。',
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
          '用户要写作业。立刻 browser_chaoxing_homework action=inspect 或 list。读到题卡后一题一题作答，每答出一道就 fill 一道，不要攒到最后。不要 eval，不要 click，不要问用户。',
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
          '目录已经读到未完成节。立刻 browser_chaoxing_study，title 填「维护网络安全」。不要要截图，不要再点「章节」，不要再 get_page。',
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
