/** 上下文压缩、学习评估、回合环境前缀。模型循环在 chatLoop.ts。 */
import { computed, ref } from 'vue'
import { databaseService } from '../app/database'
import {
  hostnameOf,
  listAppBrowsers,
  peekAppBrowserUrl,
} from '../browser/appBrowser'
import { siteGraphAgentSnap } from '../browser/siteGraph'
import { hasUsableVisionModel } from '../model/config'
import { runTextModel } from '../model/runner'
import { runStudyProgressEvaluation } from '../study/progressAgent'
import { describeActivity } from './activity'
import { displaySiteName, formatBrowserLiveContext, shouldAttachLiveRefs } from './browserLoop'
import type { AgentChatAttachment, AgentChatMessage } from './chatTypes'
import { packAgentPanel } from '../platform/panelAccess'
import {
  dropStep,
  patchMessage,
  patchSession,
  patchStep,
  sessionIsStreaming,
  sessions,
  activeChat,
} from './chatStore'
import {
  AGENT_CONTEXT_COMPACT_AT,
  BROWSER_CONTEXT_COMPACT_AT,
  BROWSER_CONTEXT_KEEP_TOKENS,
  CONTEXT_COMPACT_INPUT_TOKENS,
  CONTEXT_COMPACT_MIN_MESSAGES,
  CONTEXT_COMPACT_MSG_CHARS,
  CONTEXT_KEEP_MIN_MESSAGES,
  CONTEXT_KEEP_TOKENS,
  estimateAgentContext,
  estimateTextTokens,
  splitCompactedHistory,
} from './context'
import {
  expandFolderTokens,
  isFolderAttachment,
  isImageAttachment,
  parseFolderTokens,
} from './folderTokens'
import { messageHistoryText } from './modelHistory'
import { resolveSitePackForUrl } from './sitePack'
import { siteAccountsPrompt } from './siteAccounts'

const describeFolders = (items?: AgentChatAttachment[]) => {
  const folders = (items || []).filter(isFolderAttachment)
  if (!folders.length) return ''
  const lines = folders.map((item) => {
    const path = item.folderPath || item.folderName || item.fileName || '文件夹'
    return `- ${path}（folder_id=${item.folderId}）`
  })
  return `\n\n指定文件夹：\n${lines.join('\n')}`
}

export const loadLiveExploreRefs = async (browserId: string, url: string) => {
  if (!browserId || !shouldAttachLiveRefs(url)) return null
  const { userControlsBrowser } = await import('../browser/control')
  const owner = sessions.value.find(session => session.browserId === browserId || session.browserIds?.includes(browserId))
  if (owner && userControlsBrowser(owner.id)) return null
  const { isEvalActBusy } = await import('../browser/eval')
  const { listCachedPageRefs } = await import('../browser/engine')
  // 模型刚从 get_state / get_page 拿到的 e3 必须还能点到同一个元素。
  // 每轮再拍一次 CDP 会重编号，点「登录」会点到备案号。
  const cached = listCachedPageRefs(browserId)
  if (cached.length || isEvalActBusy(browserId)) return cached
  const { readBrowserPage } = await import('../browser/appBrowser')
  let timer = 0
  try {
    const page = await Promise.race([
      readBrowserPage(browserId).catch(() => null),
      new Promise<null>((resolve) => {
        timer = window.setTimeout(() => resolve(null), 1000)
      }),
    ])
    if (page?.refs?.length) return page.refs
  } finally {
    if (timer) window.clearTimeout(timer)
  }
  return listCachedPageRefs(browserId)
}

export const browserStatePrefix = async (sessionId: string) => {
  const browserId = String(sessions.value.find((item) => item.id === sessionId)?.browserId || '').trim()
  if (!browserId) return ''
  const item = listAppBrowsers().find((browser) => browser.id === browserId)
  const url = peekAppBrowserUrl(browserId) || item?.url || ''
  const name = item?.name || item?.title || hostnameOf(url)
  const accountLine = siteAccountsPrompt(url)
  const snap = url ? siteGraphAgentSnap(url) : null
  const pack = resolveSitePackForUrl(url)
  const siteName = displaySiteName(url, {
    id: snap?.siteId || pack?.siteId,
    name: snap?.site || pack?.siteId,
  })
  const siteBits = [
    siteName,
    snap?.page ? `节点 ${snap.page}` : '',
    snap?.tab ? `页签 ${snap.tab}` : '',
  ].filter(Boolean)
  const siteLine = siteBits.length ? `【站点】${siteBits.join(' · ')}` : ''
  const todos = sessions.value.find((item) => item.id === sessionId)?.todos || []
  const panel = browserId ? packAgentPanel(browserId) : null
  const refs = await loadLiveExploreRefs(browserId, url)
  const loop = formatBrowserLiveContext({
    url,
    sessionId,
    todos,
    panel,
    browserId,
    role: 'parent',
    refs,
  })
  const host = hostnameOf(url).replace(/^www\./i, '')
  let skillLine = ''
  if (host) {
    try {
      const { readAgentSkillFileContent } = await import('./agentSkills')
      const { siteGraphNodeForUrl } = await import('../browser/siteGraphCore')
      const file = await readAgentSkillFileContent('site-learn', `sites/${host}/SKILL.md`)
      const text = String(file?.content || '')
      const node = siteGraphNodeForUrl(url)?.id || ''
      const section = node ? text.split(/^## /m).find((part) => part.startsWith(node)) : ''
      const body = (section ? `## ${section}` : text).trim().slice(0, 900)
      if (body) skillLine = `【经验】\n${body}`
    } catch {
      skillLine = ''
    }
  }
  return [
    `同一轮对话跟着整个浏览器「${name}」（browser_id=${browserId}）。弹出新标签会自动切过来。`,
    loop,
    accountLine,
    siteLine,
    skillLine,
    hasUsableVisionModel() ? '' : '【模型】当前是文本模型，不能看图。跳过图像/公式题和验证码识图。',
  ].filter(Boolean).join('\n') + '\n\n'
}

export const studyStatePrefix = async (sessionId: string) => {
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

export const modelUserContent = (text: string, items?: AgentChatAttachment[]) => {
  const expanded = expandFolderTokens(text, items)
  const mentioned = new Set(parseFolderTokens(text).map((item) => item.folderId))
  const extra = (items || []).filter((item) => (
    isFolderAttachment(item)
    && item.folderId != null
    && !mentioned.has(item.folderId)
  ))
  return `${expanded}${describeFolders(extra)}`
}

export const toMultimodalUserContent = (text: string, items?: AgentChatAttachment[]) => {
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

export const isGraphCatalogMessage = (item: AgentChatMessage) => {
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
      '【用户目标】（原话和 intent）',
      '【未完成清单】',
      '【已完成子 Agent】（每个一句 summary，不要内部 click 流水）',
      '【做过】（成功的 handle / 节点）',
      '【打开过的页面】',
      '【题库与学习】（关联科目、文件夹等 id，讲解结论、练习与作答情况）',
      '【工具调用与失败】（工具名、关键参数、error；同参失败要记下）',
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

const pickCompactBoundary = (kept: AgentChatMessage[], keepTokens = CONTEXT_KEEP_TOKENS) => {
  let tokens = 0
  let start = kept.length
  for (let i = kept.length - 1; i >= 0; i -= 1) {
    const size = estimateTextTokens(messageHistoryText(kept[i]))
    const overMin = kept.length - i > CONTEXT_KEEP_MIN_MESSAGES
    if (overMin && tokens + size > keepTokens) break
    tokens += size
    start = i
  }
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
  const start = pickCompactBoundary(kept, session.browserId ? BROWSER_CONTEXT_KEEP_TOKENS : CONTEXT_KEEP_TOKENS)
  if (start < CONTEXT_COMPACT_MIN_MESSAGES) return
  const archived = kept.slice(0, start)
  if (archived.some((item) => item.status === 'streaming')) return
  const transcript = buildCompactTranscript(archived)
  const jobLines = (session.jobs || [])
    .filter((job) => job.status === 'done' || job.status === 'failed')
    .map((job) => `子Agent ${job.kind}：${job.summary || job.goal}`)
    .join('\n')
  const packed = [transcript, jobLines ? `已完成子 Agent：\n${jobLines}` : ''].filter(Boolean).join('\n\n')
  if (!packed) return
  const text = await runTextModel(
    compactPrompt(summary?.text || '', packed, Boolean(session.browserId)),
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
  if (estimateAgentContext(session).used < (session.browserId ? BROWSER_CONTEXT_COMPACT_AT : AGENT_CONTEXT_COMPACT_AT)) return
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

export const lastUserText = (sessionId: string) => {
  const messages = sessions.value.find((item) => item.id === sessionId)?.messages || []
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user' && String(messages[i].content || '').trim()) {
      return String(messages[i].content)
    }
  }
  return ''
}

export const shouldAutoEvalStudy = (sessionId: string, message: AgentChatMessage) => {
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
  _force: boolean,
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

export const scheduleStudyProgressEval = (input: {
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
