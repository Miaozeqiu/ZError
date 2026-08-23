import { computed, ref } from 'vue'
import { databaseService } from './database'
import { inspectLocalFile, parseQuestions, normalizeType, readLocalFileRange, type ExtractedQuestion } from './agentImport'
import { isModelStopped, runTextModel, type ModelToolCall } from './modelRunner'
import type { ImportStepPreview, ImportTaskStep } from './importTasks'
import { parseDifficulty, parseImportance, parseMastery } from '../utils/questionMetrics'
import { getQuizCards, parseQuizCards, resolveQuizTitle, saveQuizCards, saveQuizTitle, type QuizCard } from '../utils/quizPractice'
import { collectGraphNodes, extractMermaidSource, graphFromPayload, graphToMermaid, parseGraphEdgeInputs, parseGraphNodeInputs } from '../utils/studyGraph'
import { isLoggedIn } from './auth'
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
  type CampusCourse,
  type CampusFolder,
  type CampusQuestion,
} from './campus'
import { clipAgentDebug, logAgentDebug } from './agentDebugLog'
import { RemoteApiError } from './remoteHttp'
import { emitStudyGraphStream, finishStudyGraphStream } from './studyGraphStream'
import { formatEvalNotice, runStudyProgressEvaluation } from './studyProgressAgent'
import { associateQuestionsToKnowledge, notifyQuestionKnowledgeUpdated, type QuestionKnowledgeHint } from './questionKnowledge'
import { clampForgettingStage, forgettingStageLabel, retentionScore } from '../utils/studyForgetting'

export interface AgentQuizAttempt {
  stepId: string
  uid: string
  question_id?: number
  question: string
  options?: string
  selected: string
  answer: string
  correct?: boolean
  note?: string
  explanation?: string
  index?: number
  total?: number
  kind?: 'submit' | 'note'
}

export interface AgentStudyEvalNote {
  status: 'running' | 'done' | 'empty' | 'failed'
  text: string
  updated?: number
}

export interface AgentChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: AgentChatAttachment[]
  steps: ImportTaskStep[]
  quizAttempts?: AgentQuizAttempt[]
  quizReported?: boolean
  studyEval?: AgentStudyEvalNote
  status: 'streaming' | 'done' | 'failed' | 'stopped'
  waiting?: boolean
  error?: string
}

export interface AgentChatAttachment {
  kind?: 'file' | 'folder' | 'image'
  filePath: string
  fileName: string
  folderId?: number
  folderName?: string
  folderPath?: string
  imageUrl?: string
  mimeType?: string
}

export const isFolderAttachment = (item: AgentChatAttachment) =>
  item.kind === 'folder' || item.filePath.startsWith('folder:')

export const isImageAttachment = (item: AgentChatAttachment) =>
  item.kind === 'image' || Boolean(item.imageUrl)

export const isFileAttachment = (item: AgentChatAttachment) =>
  !isFolderAttachment(item) && !isImageAttachment(item)

const FOLDER_TOKEN_SOURCE = '\\{\\{folder:(-?\\d+):([^:}]+)(?::([^}]+))?\\}\\}'

const safeDecode = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export const encodeFolderToken = (folder: {
  folderId: number
  folderName: string
  folderPath?: string
}) =>
  `{{folder:${folder.folderId}:${encodeURIComponent(folder.folderName)}:${encodeURIComponent(folder.folderPath || folder.folderName)}}}`

export type AgentMessagePart =
  | { type: 'text'; text: string }
  | { type: 'folder'; folderId: number; folderName: string }

export const parseFolderTokens = (text: string) => {
  const items: { folderId: number; folderName: string; folderPath: string }[] = []
  const re = new RegExp(FOLDER_TOKEN_SOURCE, 'g')
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    const folderName = safeDecode(match[2])
    items.push({
      folderId: Number(match[1]),
      folderName,
      folderPath: match[3] ? safeDecode(match[3]) : folderName,
    })
  }
  return items
}

export const parseMessageParts = (text: string): AgentMessagePart[] => {
  const parts: AgentMessagePart[] = []
  const re = new RegExp(FOLDER_TOKEN_SOURCE, 'g')
  let last = 0
  let match: RegExpExecArray | null
  while ((match = re.exec(text))) {
    if (match.index > last) parts.push({ type: 'text', text: text.slice(last, match.index) })
    parts.push({
      type: 'folder',
      folderId: Number(match[1]),
      folderName: safeDecode(match[2]),
    })
    last = match.index + match[0].length
  }
  if (last < text.length) parts.push({ type: 'text', text: text.slice(last) })
  return parts
}

export const extractFolderAttachments = (text: string): AgentChatAttachment[] => {
  const seen = new Set<number>()
  const items: AgentChatAttachment[] = []
  for (const folder of parseFolderTokens(text)) {
    if (!Number.isFinite(folder.folderId) || folder.folderId < 0 || seen.has(folder.folderId)) continue
    seen.add(folder.folderId)
    items.push({
      kind: 'folder',
      filePath: `folder:${folder.folderId}`,
      fileName: folder.folderName,
      folderId: folder.folderId,
      folderName: folder.folderName,
      folderPath: folder.folderPath,
    })
  }
  return items
}

export const expandFolderTokens = (text: string, items?: AgentChatAttachment[]) => {
  const byId = new Map(
    (items || [])
      .filter((item) => isFolderAttachment(item) && item.folderId != null)
      .map((item) => [item.folderId as number, item]),
  )
  return text.replace(new RegExp(FOLDER_TOKEN_SOURCE, 'g'), (_all, id, rawName, rawPath) => {
    const folderId = Number(id)
    const name = safeDecode(rawName)
    const att = byId.get(folderId)
    const path = att?.folderPath || (rawPath ? safeDecode(rawPath) : name)
    return `${name}（folder_id=${folderId}，路径=${path}）`
  })
}

export interface AgentChatSession {
  id: string
  title: string
  messages: AgentChatMessage[]
  attachments?: AgentChatAttachment[]
  studySubjectId?: number
  createdAt: number
  updatedAt: number
}

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
    activeId.value = sessions.value[0]?.id || null
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
}

loadPersisted()

export const chatSessions = computed(() => sessions.value)
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

const CHAT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_file_info',
      description: '查看当前对话附带文件的类型和规模。需要阅读文件内容时先调用。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径，不传则使用对话附带的文件' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_range',
      description: '按范围读取附带文件。Excel 按行，Word 按段落，PDF 按页，文本按行。下标从 0 开始，包含 end。一次不要读太多。',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'integer' },
          end: { type: 'integer' },
          path: { type: 'string' },
        },
        required: ['start', 'end'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_folders',
      description: '查看题库文件夹列表，含 Id、名称、父级和题目数量。不确定目标文件夹时先调用。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_folder_info',
      description: '查看某个文件夹的路径、父级和题目数量。可用 folder_id 或 folder_name。',
      parameters: {
        type: 'object',
        properties: {
          folder_id: { type: 'integer' },
          folder_name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_folder',
      description: '新建文件夹。可指定父文件夹，默认建在最外层（默认文件夹下，parent_id=0）。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '新文件夹名称' },
          parent_id: { type: 'integer', description: '父文件夹 Id，默认 0' },
          parent_name: { type: 'string', description: '父文件夹名称，不知道 Id 时可用' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_folder',
      description: '重命名文件夹。不能改默认文件夹（Id=0）。',
      parameters: {
        type: 'object',
        properties: {
          folder_id: { type: 'integer' },
          folder_name: { type: 'string', description: '当前名称，不知道 Id 时可用' },
          new_name: { type: 'string' },
        },
        required: ['new_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_folder',
      description: '把文件夹移到另一个父文件夹下。不能移动默认文件夹，也不能移进自己的子文件夹。',
      parameters: {
        type: 'object',
        properties: {
          folder_id: { type: 'integer' },
          folder_name: { type: 'string' },
          parent_id: { type: 'integer', description: '新的父文件夹 Id，0 表示最外层' },
          parent_name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_folder',
      description: '删除文件夹。只能在用户明确要求删除时调用。不能删除默认文件夹。delete_questions 为 true 时连题目一起删，否则题目回到默认文件夹。',
      parameters: {
        type: 'object',
        properties: {
          folder_id: { type: 'integer' },
          folder_name: { type: 'string' },
          delete_questions: { type: 'boolean', description: '是否同时删除里面的题目，默认 false' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_questions',
      description: '查看某个文件夹里的题目，返回 Id、题干、答案、题型、重要性/掌握度/难度、已关联知识点，以及最近练习摘要。出题、整理题目或改指标前先调用。一次最多 40 道，多的翻页。',
      parameters: {
        type: 'object',
        properties: {
          folder_id: { type: 'integer' },
          folder_name: { type: 'string' },
          page: { type: 'integer', description: '页码，从 1 开始，默认 1' },
          page_size: { type: 'integer', description: '每页数量，默认 20，最大 40' },
          include_subfolders: { type: 'boolean', description: '是否包含子文件夹里的题目，默认 false' },
          importance: { type: 'integer', description: '按重要性筛选，0未设置 1低 2中 3高' },
          mastery: { type: 'integer', description: '按掌握程度筛选，0未设置 1未掌握 2一般 3已掌握' },
          difficulty: { type: 'integer', description: '按难度筛选，0未设置 1简单 2中等 3困难' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_questions',
      description: '按题干关键词查找题目。可用 folder_id 或 folder_name 限定范围。移动某几道题时，先搜到 Id 再 move_questions。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '题干关键词' },
          folder_id: { type: 'integer' },
          folder_name: { type: 'string' },
        },
        required: ['keyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_campus_status',
      description: '查看校园题库登录和学校绑定。用户问校园题、学校课、试卷或同学分享的题时先调用。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_campus_courses',
      description: '列出当前学校的校园课程。可用 name 按课名筛选。看校园题前先调用。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: '课程名关键词，可省略' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_campus_papers',
      description: '列出某门校园课下的试卷/文件夹。必须用 course_id 或 course_name。',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'integer' },
          course_name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_campus_questions',
      description: '查看某份校园试卷里的题目。必须用 paper_id / folder_id，或同时提供课程和试卷名。返回 campus_question_id，不是本地题库 Id。一次最多 40 道，多的翻页。',
      parameters: {
        type: 'object',
        properties: {
          paper_id: { type: 'integer', description: '试卷/文件夹 Id' },
          folder_id: { type: 'integer' },
          paper_name: { type: 'string' },
          course_id: { type: 'integer' },
          course_name: { type: 'string' },
          page: { type: 'integer', description: '页码，从 1 开始，默认 1' },
          page_size: { type: 'integer', description: '每页数量，默认 20，最大 40' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_campus_questions',
      description: '在当前学校的校园题库里按题干搜索。返回 campus_question_id，不是本地题库 Id。',
      parameters: {
        type: 'object',
        properties: {
          keyword: { type: 'string', description: '题干关键词' },
          page: { type: 'integer' },
          page_size: { type: 'integer' },
        },
        required: ['keyword'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_campus_tags',
      description: '列出校园试卷可用的平台/标签，如学习通、智慧树。改平台或新建试卷前可调用。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_campus_paper',
      description: '在校园课下新建试卷/文件夹。必须已登录、绑定学校并完成校园认证。必须用 course_id 或 course_name，以及试卷名 name。平台用 tag（学习通、智慧树等）。',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'integer' },
          course_name: { type: 'string' },
          name: { type: 'string', description: '试卷名称' },
          tag: { type: 'string', description: '平台/标签名，如学习通、智慧树' },
          tag_name: { type: 'string' },
          platform: { type: 'string', description: '与 tag 相同，学习通/智慧树等' },
          tag_id: { type: 'integer' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_campus_paper',
      description: '修改已有校园试卷的名称或平台标签（学习通、智慧树等）。用户说把试卷改成某平台、改试卷名时必须调用，不要新建一份再复制题目。只能改自己创建的试卷。',
      parameters: {
        type: 'object',
        properties: {
          paper_id: { type: 'integer' },
          folder_id: { type: 'integer' },
          paper_name: { type: 'string' },
          course_id: { type: 'integer' },
          course_name: { type: 'string' },
          name: { type: 'string', description: '新的试卷名，不改名可省略' },
          tag: { type: 'string', description: '平台/标签名，如智慧树、学习通' },
          tag_name: { type: 'string' },
          platform: { type: 'string', description: '与 tag 相同' },
          tag_id: { type: 'integer' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_campus_questions',
      description: '把题目上传到校园试卷。用户要求上传、收录到校园题库时调用，不要用 save_questions。必须已认证。必须指定课程和试卷。可手写题目，或用本地 question_ids 复制已有本地题。一次最多 20 道。',
      parameters: {
        type: 'object',
        properties: {
          course_id: { type: 'integer' },
          course_name: { type: 'string' },
          paper_id: { type: 'integer', description: '校园试卷 Id' },
          folder_id: { type: 'integer' },
          paper_name: { type: 'string', description: '试卷名，没有就按 create_paper 决定是否新建' },
          folder_name: { type: 'string' },
          create_paper: { type: 'boolean', description: '试卷不存在时是否新建，默认 true' },
          tag: { type: 'string', description: '新建试卷时的标签名' },
          tag_name: { type: 'string' },
          tag_id: { type: 'integer' },
          question_ids: { type: 'array', items: { type: 'integer' }, description: '本地题库 Id，会按原文复制到校园试卷' },
          question_id: { type: 'integer' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                options: { description: '选项，写成 "A. xx\\nB. xx" 或字符串数组' },
                answer: { type: 'string', description: '选择题优先写 A/B/C/D，判断写 T/F 或对/错' },
                question_type: { type: 'string', description: '单选/多选/判断/填空/简答，或 single_choice 等' },
              },
              required: ['question', 'answer'],
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_campus_question',
      description: '修改已有校园题的题干、选项、答案、题型，或移到另一份试卷。必须用 campus_question_id（来自 list/search/save），不是本地 question_id。必须已认证。一次最多 10 道。',
      parameters: {
        type: 'object',
        properties: {
          campus_question_id: { type: 'integer' },
          campus_question_ids: { type: 'array', items: { type: 'integer' } },
          question: { type: 'string' },
          options: { description: '选项，写成 "A. xx\\nB. xx" 或字符串数组' },
          answer: { type: 'string' },
          question_type: { type: 'string' },
          paper_id: { type: 'integer', description: '要移到的试卷 Id；改内容时也尽量带上当前试卷，避免题目被移出试卷' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                campus_question_id: { type: 'integer' },
                question: { type: 'string' },
                options: { description: '选项' },
                answer: { type: 'string' },
                question_type: { type: 'string' },
                paper_id: { type: 'integer' },
              },
              required: ['campus_question_id'],
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_questions',
      description: '把指定题目移到另一个文件夹。必须用 question_ids（来自 list_questions / search_questions），或用 keyword 在源文件夹里匹配。不要用这个工具移动整个文件夹，移动文件夹请用 move_folder。一次最多 50 道。',
      parameters: {
        type: 'object',
        properties: {
          question_ids: {
            type: 'array',
            items: { type: 'integer' },
            description: '要移动的题目 Id 列表',
          },
          question_id: { type: 'integer', description: '只移一道时可用' },
          keyword: { type: 'string', description: '按题干匹配源文件夹中的题目' },
          source_folder_id: { type: 'integer' },
          source_folder_name: { type: 'string' },
          folder_id: { type: 'integer', description: '目标文件夹 Id' },
          folder_name: { type: 'string', description: '目标文件夹名称' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_questions',
      description: '把题目写入指定文件夹。用户要求保存、收录、导入题目时必须调用。一次不要超过 20 道，多的分批写入。不要编造用户没确认过的题目。',
      parameters: {
        type: 'object',
        properties: {
          folder_id: { type: 'integer', description: '文件夹 Id，默认 0' },
          folder_name: { type: 'string', description: '文件夹名称，不知道 Id 时可用' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string' },
                options: { type: 'string' },
                answer: { type: 'string' },
                question_type: { type: 'string' },
                importance: { type: 'integer', description: '0未设置 1低 2中 3高' },
                mastery: { type: 'integer', description: '0未设置 1未掌握 2一般 3已掌握' },
                difficulty: { type: 'integer', description: '0未设置 1简单 2中等 3困难' },
                knowledge_point: { type: 'string', description: '对应知识点或节名' },
                node_name: { type: 'string', description: '图谱节点名，可与 knowledge_point 相同' },
                node_id: { type: 'integer', description: '已有知识点 Id' },
                parent_name: { type: 'string', description: '所属章名，没有对应节点时用来挂到该章下' },
                subject_id: { type: 'integer' },
              },
              required: ['question', 'answer'],
            },
          },
        },
        required: ['questions'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'update_question_metrics',
      description: '更新题库题目的重要性、掌握程度或难度。必须用 list_questions / search_questions 拿到的 question_ids。取值 0–3，也可写低/中/高、未掌握/一般/已掌握、简单/中等/困难。',
      parameters: {
        type: 'object',
        properties: {
          question_ids: { type: 'array', items: { type: 'integer' } },
          question_id: { type: 'integer' },
          importance: { description: '重要性' },
          mastery: { description: '掌握程度' },
          difficulty: { description: '难度' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_recent_wrong_questions',
      description: '查看最近答错的题目。用户问错题、要订正、复习刚错过的题时调用。可按科目、知识点或文件夹筛选，返回题干、上次错选、错了几次、最近 5 次对错。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer', description: '学习科目 Id，挂着学习状态时可省略' },
          subject_name: { type: 'string' },
          node_id: { type: 'integer', description: '只看某个知识点及其子节点' },
          node_name: { type: 'string' },
          folder_id: { type: 'integer' },
          folder_name: { type: 'string' },
          days: { type: 'integer', description: '最近几天，默认 30' },
          limit: { type: 'integer', description: '最多返回多少道，默认 20，最大 40' },
          unresolved_only: { type: 'boolean', description: '只看最后一次仍是错的题，默认 false' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_practice_history',
      description: '查看某道题的历史作答和备注，出题或讲评前可调用，避免重复出刚错过的题或忽略用户备注。',
      parameters: {
        type: 'object',
        properties: {
          question_id: { type: 'integer' },
          limit: { type: 'integer', description: '默认 10，最多 30' },
        },
        required: ['question_id'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'add_practice_note',
      description: '给某道题追加一条备注，供以后出题和讲解参考。用户要求记下易错点、口诀或复习提示时使用。',
      parameters: {
        type: 'object',
        properties: {
          question_id: { type: 'integer' },
          note: { type: 'string' },
        },
        required: ['question_id', 'note'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'present_quiz',
      description: '向用户出示可点选的练习题。选择题必须用这个工具，不要把选项写成普通 Markdown。必须用 title 给这次练习起短名字。本地题用 question_ids；校园题用 campus_question_ids 或 paper_id，系统会按校园题库原文出题，不要抄选项。订正错题时先 list_recent_wrong_questions。也可以只传 count，从未掌握的本地题里抽。一次最多 10 道。',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string', description: '这次练习的短标题，例如「考试1」「劳动需求 错题订正」。会显示在练习卡片上，不要只用「练习」。' },
          question_ids: { type: 'array', items: { type: 'integer' }, description: '本地题库题目 Id 列表' },
          campus_question_ids: { type: 'array', items: { type: 'integer' }, description: '校园题 Id，来自 list_campus_questions。系统按原文出题。' },
          paper_id: { type: 'integer', description: '校园试卷 Id，出示这份试卷里的题' },
          paper_name: { type: 'string' },
          count: { type: 'integer', description: '未指定题目时自动抽取的数量，默认 5' },
          folder_id: { type: 'integer' },
          node_id: { type: 'integer', description: '这批题默认挂到的知识点 Id' },
          node_name: { type: 'string', description: '这批题默认挂到的知识点或节名' },
          knowledge_point: { type: 'string' },
          parent_name: { type: 'string' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question_id: { type: 'integer', description: '本地题库题目 Id' },
                campus_question_id: { type: 'integer', description: '校园题 Id，有这个就不要再手写 options' },
                question: { type: 'string' },
                options: { type: 'string', description: 'A. ...\\nB. ...。校园题不要填这个字段' },
                answer: { type: 'string' },
                question_type: { type: 'string', description: '单选/多选/判断/填空' },
                explanation: { type: 'string' },
                knowledge_point: { type: 'string', description: '对应知识点或节名' },
                node_name: { type: 'string' },
                node_id: { type: 'integer' },
                parent_name: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'link_questions_to_knowledge',
      description: '把题库题目关联到知识图谱节点。用户说整理题目、把题挂到某节、这题考某某时调用。没有对应节点就自动生成。可用 question_ids，或对每道题分别给 node_name / parent_name。',
      parameters: {
        type: 'object',
        properties: {
          question_ids: { type: 'array', items: { type: 'integer' } },
          question_id: { type: 'integer' },
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
          node_id: { type: 'integer' },
          node_name: { type: 'string', description: '知识点或节名' },
          knowledge_point: { type: 'string' },
          parent_name: { type: 'string', description: '所属章名' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question_id: { type: 'integer' },
                node_id: { type: 'integer' },
                node_name: { type: 'string' },
                knowledge_point: { type: 'string' },
                parent_name: { type: 'string' },
              },
            },
          },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_knowledge_questions',
      description: '查看某个知识点关联了哪些题目。出该节的练习或整理题目后可调用。',
      parameters: {
        type: 'object',
        properties: {
          node_id: { type: 'integer' },
          node_name: { type: 'string' },
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'merge_subjects',
      description: '把多个学习科目合成一个大科目。源科目的图谱会作为章节并入目标科目，题目与知识点的关联会保留。源科目随后删除。',
      parameters: {
        type: 'object',
        properties: {
          target_id: { type: 'integer', description: '合并后保留的科目 Id' },
          target_name: { type: 'string' },
          source_ids: { type: 'array', items: { type: 'integer' }, description: '要并进来的科目 Id' },
          source_names: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'split_subject',
      description: '把一个科目拆成新科目。指定要拆出的章/节，它们及其下级会移到新科目。题目关联跟着节点走。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
          parts: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string', description: '新科目名称' },
                description: { type: 'string' },
                node_ids: { type: 'array', items: { type: 'integer' } },
                node_names: { type: 'array', items: { type: 'string' } },
              },
              required: ['name'],
            },
          },
          name: { type: 'string', description: '只拆出一块时的新科目名' },
          node_ids: { type: 'array', items: { type: 'integer' } },
          node_names: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_subjects',
      description: '查看学习页有哪些科目。用户问有哪些科目、列出学习科目时必须调用。科目独立于题库文件夹。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_subject',
      description: '查看某一个学习科目的详情（简介、进度、知识点数量），并在右侧展开它的思维导图。用户说查看某科、打开某科、看看某科时调用。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_subject',
      description: '在学习页新建一个科目，并展开它的思维导图。用户说新建科目、加一个学习科目时必须调用。不要用创建文件夹代替。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          description: { type: 'string' },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'rename_subject',
      description: '重命名学习科目或改简介。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
          new_name: { type: 'string' },
          description: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'delete_subject',
      description: '删除学习科目及其知识图谱。必须用户明确要求删除科目时才调用。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'attach_study_subject',
      description: '把学习科目挂到当前对话。右上角会显示正在学习，之后讲解、出题、改图谱都默认用这个科目。用户说想学某科时必须调用。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'detach_study_subject',
      description: '撤下当前对话的学习状态。只有用户明确说不学了、撤下或取消学习状态时才调用。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_knowledge_graph',
      description: '查看某科目当前的知识图谱。节点含 forgetting_stage（0–6 复习点）和上次复习时间。章的熟练度由子节点汇总，不要用题目那种掌握度 0–3 理解图谱。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_knowledge_graph',
      description: '整图替换某科目知识图谱，会丢掉已有节点和遗忘进度。仅当用户明确说重画、推倒重来、全部重做，并带 replace=true 时使用。普通绘制、补章、改名一律用 patch_knowledge_graph。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
          replace: {
            type: 'boolean',
            description: '必须为 true。表示用户明确要求整图重画。缺省或 false 时拒绝覆盖。',
          },
          mermaid: {
            type: 'string',
            description: 'mermaid flowchart TB 或 mindmap 源码，不要包代码围栏',
          },
          outline: {
            type: 'string',
            description: '教材目录式大纲。例如：\\n劳动需求\\n  短期劳动需求\\n  长期劳动需求\\n劳动供给\\n  收入与闲暇\\n  劳动参与率',
          },
          nodes: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                name: { type: 'string' },
                summary: { type: 'string' },
                parent_key: { type: 'string' },
                mastery: { type: 'integer', description: '不要填。图谱进度用 evaluate_study_progress，不是 0–3 掌握度' },
              },
              required: ['name'],
            },
          },
          edges: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                from_key: { type: 'string' },
                to_key: { type: 'string' },
                relation: { type: 'string' },
              },
              required: ['from_key', 'to_key'],
            },
          },
        },
        required: ['nodes'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'patch_knowledge_graph',
      description: '往知识图谱里添加或修改节点。生成图谱时用这个分批添加，一次 3–8 个。先加章名，再给每章加 2–4 个节名（parent_key 填章的 key 或中文名）。节点名用教材目录口吻，不要定理/论文名。不要用手写 mastery 表示遗忘进度，学完/复习后调用 evaluate_study_progress。可多次调用，每批不同。不要一次塞整张图。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
          add: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                key: { type: 'string' },
                name: { type: 'string' },
                summary: { type: 'string' },
                parent_key: { type: 'string' },
              },
              required: ['name'],
            },
          },
          update: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'integer' },
                name: { type: 'string' },
                summary: { type: 'string' },
                parent_id: { type: 'integer' },
              },
              required: ['id'],
            },
          },
          remove_ids: { type: 'array', items: { type: 'integer' } },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'focus_knowledge_graph',
      description: '在右侧知识图谱里聚焦某个章或节，镜头会移到该节点及其子节点。讲解、点名某一章/节，或用户说「看某某」「讲这一块」时必须调用。node_name 用图谱里的中文名。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
          node_name: { type: 'string', description: '图谱节点的章名或节名，例如「劳动需求」' },
          node_id: { type: 'integer' },
        },
        required: ['node_name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'open_knowledge_graph',
      description: '展开右侧思维导图。用户说打开图谱、展开思维导图、看知识图谱、打开导图时必须调用。可指定科目，默认用当前学习状态。只要展开整张图，不要用这个聚焦单个节点。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'evaluate_study_progress',
      description: '立刻把学习/复习效果评估交给后台。系统讲完或练完后也会自动评估；用户明确问进度、说学过/忘了/复习过时仍应调用。不要自己打分或改 mastery。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
          hint: { type: 'string', description: '这次真正讲到、练到或用户点名的节名（叶子中文名，可多个）。不要写章名，不要写「基础/入门」' },
        },
      },
    },
  },
]

const SYSTEM_PROMPT = `你是题库与学习助手。可以讲解、出题、整理题目，也可以管理学习页的科目和知识图谱，查看、上传和编辑校园题库，以及查看用户附带的本地文件。

规则：
1. 用户附带文件不等于要导入。先按用户的问题处理：问内容就 get_file_info 一次，再按需 read_range 后回答；闲聊或无关问题直接回答。同一个文件不要重复 get_file_info。只有用户明确要求导入、识别题目、保存、收录或写入题库时，才分段 read_range 再写入。写入本地题库用 save_questions，写入校园题库用 save_campus_questions。不要一次读完全文。文件较大时按 nextHint 继续读，直到说已经到末尾。一次写入不要超过 20 道。不要编造文件里没有的题目。用户消息里如果带了图片，按图中内容回答、讲解或识别题目。
2. 普通提问先直接回答。用户要求保存、收录、写入本地题库时，调用 save_questions。用户文本里如果出现「名称（folder_id=…，路径=…）」，必须使用这个 folder_id，不要按名称猜测或另选。用户只用语言指定文件夹（例如「存到错题本」）时，先 list_folders 或 get_folder_info 对应，不要自己另选。不确定文件夹时先问一句。用户说上传到校园、放到校园试卷、改校园题时，不要用 save_questions。
3. 用户要求新建、重命名、移动、删除文件夹时，使用对应工具。默认文件夹（Id=0）不能重命名、移动或删除。不确定文件夹时先 list_folders。
4. 用户要求把某几道题、某一类题挪到别的文件夹时，先 list_questions 或 search_questions 确认题目 Id，再 move_questions。不要把整个文件夹当题目移动；挪文件夹用 move_folder。一次不要超过 50 道。
5. 删除文件夹必须用户说清楚要删，并且说明题目是一起删还是留着。
6. 题目字段：question、options（写成 "A. xxx\\nB. xxx"）、answer、question_type（单选/多选/判断/填空）、importance/mastery/difficulty（0–3，或低/中/高、未掌握/一般/已掌握、简单/中等/困难）。能看出考点就写 knowledge_point / node_name，能看出章节就写 parent_name。
7. 出选择题或判断题练习时，必须调用 present_quiz，题目会出现在右侧练习页供点选。不要把选项写成普通列表让用户在输入框回答。必须用 title 给这次练习起一个短名字（试卷名、知识点、错题订正等），不要只用「练习」。题库里的题只传 question_id；自己出的题带上题干、选项、答案、解析，以及 knowledge_point 或 node_name。整批同一节时也可在 present_quiz 顶层传 node_name。新出的题会自动写入题库；挂着学习状态时再挂到对应知识点，作答会记到该节点。没有对应节点就生成。
8. 出题前用 list_questions 看掌握度、练习记录和已关联知识点，优先出未掌握、掌握度为 /、或最近答错的题。用户问错题、要订正或复习刚错过的题时，调用 list_recent_wrong_questions；挂着学习状态就带这个科目。需要某一题的细节时 get_practice_history。按某节出题可先 list_knowledge_questions。
9. 用户要求改重要性、掌握度、难度时用 update_question_metrics。保存新题时可在 save_questions 里一并写入这些指标和知识点。用户说整理题目、把题挂到某节时，调用 link_questions_to_knowledge。
10. 用户要求记下易错点或复习提示时，用 add_practice_note。
11. 不要编造用户没有给出或没有确认的题目。
12. 同一工具、相同参数只调用一次。list_questions 已含练习摘要，不要再对每道题 get_practice_history，除非用户点名某一题。list_recent_wrong_questions 已经是错题列表，不要再对每道错题 get_practice_history。present_quiz 成功后立刻停止调用工具，只用一两句话收尾，不要再 list_questions 或再次 present_quiz。patch_knowledge_graph 例外：空图从零画时必须多次调用，每批 3–8 个不同节点，先写全章再补节；已有图谱只改用户点名的部分，不要为凑 28–45 个而继续加。
13. 用户每做完一题就会发来该题的选择。立刻只讲评这一题：判断对错、解释原因、点出易错点。不要装作没看到，不要一次讲评整套题，也不要再出新题，除非用户要求继续。
14. 操作完成后用一两句话说明结果。出题后提醒用户看右侧练习页。不要重复列出 present_quiz 已经出示的选项。
15. 学习页的科目和知识图谱独立于题库文件夹。改图前先 get_knowledge_graph。已有节点时按用户这句话做事：说补、加、改名、删某一章/节就 patch；说重画、推倒重来、全部重做才 set_knowledge_graph（必须 replace=true）。没说重画就不要清空。空图才从零分批画：先加 8–12 个章名，再给每章加 2–4 个节名。到节为止，不要拆定理、模型、公式、论文名。禁止学科基础、核心概念、方法与应用、基础知识、综合应用、概述、其他。不要先问用户确认。若工具返回 error，修正后再调用。画完用一两句话说明改了什么。
16. 用户消息里如果带了 subject_id，或消息前有【学习状态】，必须使用这个科目，不要另建同名科目。对话挂着学习状态时，默认按该科目的进度讲解、出题或改图谱；用户撤下前不要换科目。
17. 用户说想学某科、开始学某科、或点名某科目时：先 list_subjects。有同名就 attach_study_subject；没有就 create_subject，再 attach_study_subject。挂上后右上角会显示「正在学习」。用户说撤下、不学了或取消学习状态时，调用 detach_study_subject。
18. 讲解或点名图谱里的某一章、某一节时，调用 focus_knowledge_graph，右侧图谱会聚焦到该节点。用户说「看某某」「讲这一章」「聚焦某某」时必须调用。node_name 用 get_knowledge_graph 里的中文名。不要在分批画图时对每个新节点都 focus。
19. 用户说打开/展开思维导图、看知识图谱时，调用 open_knowledge_graph。用户问有哪些学习科目时调用 list_subjects。用户说查看某一科、打开某一科时调用 get_subject。用户说新建科目时调用 create_subject。这些操作会在右侧展开对应界面，不要只口头描述。
20. 挂着学习状态时，系统会在讲完、练完后自动后台评估新学/复习效果，评估完会告诉用户，你不必每次都调用 evaluate_study_progress。用户明确问进度，或主动说以前学过/忘了/复习过某块时仍要调用，hint 只写这次真正讲到、练到或用户点名的节名（叶子），不要写章名，不要写「基础/入门」。图谱进度是 7 段遗忘曲线，不是题目那种掌握度 0–3。再次讲解已学过的节是复习。不要用 patch_knowledge_graph 改 mastery，不要自己口头打分。画图谱、只列出目录、只 focus 某一章、动笔讲解之前、只闲聊时不要调用。
21. 导入或保存题目时尽量带上 knowledge_point / parent_name。对应不上现有节点就自动生成，不要为此先问用户。用户要把几门课合成一门时用 merge_subjects；要把某几章拆成新科目时用 split_subject。拆分前先 get_knowledge_graph 拿到 node_id 或准确章名。
22. 用户问校园题、学校课、试卷、同学分享的题时，用校园题库工具：先 get_campus_status，再 list_campus_courses → list_campus_papers → list_campus_questions，或 search_campus_questions。有试卷就必须 list_campus_questions，不能只看数量就说没题。list_campus_questions / search_campus_questions 会弹出浏览卡片，只供看题，不是作答。成功后不要再列出选项，也不要 present_quiz，除非用户明确说要练习、做题或订正。练习时 present_quiz 只传 campus_question_ids 或 paper_id 和 title。campus_question_id 不是本地题库 Id，不能传给 get_practice_history、move_questions、save_questions。没登录或没绑定学校时据实说明，不要编造校园题目。
23. 用户要求往校园题库上传、收录、新建试卷或改校园题时，用 create_campus_paper / save_campus_questions / update_campus_question。先 get_campus_status 确认已登录、已绑定、verified=true；未认证就说明需要先完成校园认证，不要假装已上传。上传必须指定课程和试卷（course_id/course_name + paper_id/paper_name）；试卷不存在且用户要新建时 create_paper=true 或先 create_campus_paper。一次最多 20 道。改题必须用 campus_question_id，不要把本地 question_id 当成校园题 Id。改内容时尽量带上当前 paper_id。上传或改完会弹出浏览卡片，不要再列出选项，也不要 present_quiz，除非用户要练习。
24. 用户说把试卷改成学习通、智慧树或其他平台，或改试卷名时，调用 update_campus_paper。先 list_campus_papers 或 list_campus_tags 确认 paper_id 和标签名。不要因为没有现成工具就新建一份再复制，也不要在没调用工具时声称已经改好。`

const unescapeJsonString = (value: string) => {
  try {
    return JSON.parse(`"${value}"`) as string
  } catch {
    return value.replace(/\\n/g, '\n').replace(/\\"/g, '"')
  }
}

const extractJsonStringField = (raw: string, key: string) => {
  const match = String(raw).match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`))
  return match ? unescapeJsonString(match[1]) : ''
}

const extractJsonArrayField = (raw: string, key: string) => {
  const text = String(raw)
  const start = text.search(new RegExp(`"${key}"\\s*:\\s*`))
  if (start < 0) return null
  const open = text.indexOf('[', start)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(open, i + 1))
          return Array.isArray(parsed) ? parsed : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}

const recoverFieldsFromRaw = (raw: string): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  const mermaid = extractJsonStringField(raw, 'mermaid')
  const outline = extractJsonStringField(raw, 'outline')
  if (mermaid) out.mermaid = mermaid
  if (outline) out.outline = outline
  const id = String(raw).match(/"subject_id"\s*:\s*(\d+)/)
  if (id) out.subject_id = Number(id[1])
  const nodes = extractJsonArrayField(raw, 'nodes')
  const add = extractJsonArrayField(raw, 'add')
  if (nodes) out.nodes = nodes
  if (add) out.add = add
  return out
}

const parseToolArgs = (raw: string) => {
  const text = String(raw || '').trim()
  if (!text) return {}
  const tryParse = (value: string) => {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
    } catch {
      return null
    }
  }
  const normalize = (value: string) =>
    value
      .replace(/^(?:\{\}\s*)+/, '')
      .replace(/\}\s*\{/g, ',')
      .replace(/\{\s*,/g, '{')
      .replace(/,\s*,/g, ',')
      .replace(/,\s*\}/g, '}')
  for (const candidate of [text, normalize(text)]) {
    const parsed = tryParse(candidate)
    if (parsed) return { ...recoverFieldsFromRaw(text), ...parsed }
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const nested = tryParse(normalize(text.slice(start, end + 1)))
    if (nested) return { ...recoverFieldsFromRaw(text), ...nested }
  }
  return recoverFieldsFromRaw(text)
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

const campusFail = (err: unknown, fallback: string) => {
  if (err instanceof RemoteApiError) {
    if (err.status === 401) return '校园登录已失效，请先在顶栏重新登录。'
    if (err.status === 403) {
      const msg = String(err.message || '')
      if (/not verified|未认证/i.test(msg)) return '需要先完成校园认证才能上传或改题。'
      if (/not the creator/i.test(msg)) return '只能改自己创建的试卷。'
      if (/archived/i.test(msg)) return '这份试卷已归档，不能再改。'
      return msg || '没有权限做这个操作。'
    }
  }
  return err instanceof Error && err.message ? err.message : fallback
}

const loadCampusContext = async (opts?: { requireVerified?: boolean }) => {
  if (!isLoggedIn.value) {
    return { error: '还没有登录校园账号。请先在顶栏用微信登录，再到校园题库页绑定学校。' }
  }
  try {
    const identity = await getUserCampus()
    if (!identity.campus) {
      return { error: '还没有绑定学校。请先打开校园题库页选择学校。' }
    }
    if (opts?.requireVerified && identity.status !== 'verified') {
      return { error: '需要先完成校园认证才能上传或改题。请先在校园题库页完成认证。' }
    }
    return { identity }
  } catch (err) {
    return { error: campusFail(err, '读取校园账号失败') }
  }
}

const summarizeCampusCourse = (item: CampusCourse) => ({
  course_id: item.id,
  name: item.name,
  ...(item.folder_count != null ? { folder_count: item.folder_count } : {}),
  ...(item.question_count != null ? { question_count: item.question_count } : {}),
})

const summarizeCampusPaper = (item: CampusFolder) => ({
  paper_id: item.id,
  name: item.name,
  tag: item.tag_name || '',
  year: item.year || null,
  ...(item.question_count != null ? { question_count: item.question_count } : {}),
})

const resolveCampusCourse = async (campusId: number, id?: number, name?: string) => {
  const keyword = String(name || '').trim()
  const courses = await listCampusCourses(campusId, keyword)
  if (Number(id) > 0) {
    const found = courses.find((item) => item.id === Number(id))
    if (found) return found
    try {
      return (await getCampusCourse(Number(id))).course
    } catch {
      throw new Error(`没有找到课程 ${id}`)
    }
  }
  if (!keyword) return null
  const exact = courses.filter((item) => item.name === keyword)
  if (exact.length === 1) return exact[0]
  const fuzzy = courses.filter((item) => item.name.includes(keyword))
  if (fuzzy.length === 1) return fuzzy[0]
  if (fuzzy.length > 1 || exact.length > 1) {
    const list = (exact.length > 1 ? exact : fuzzy).slice(0, 8)
    throw new Error(`有多门课程叫「${keyword}」，请改用 course_id：${list.map((item) => `${item.name}(${item.id})`).join('、')}`)
  }
  throw new Error(`没有找到课程「${keyword}」`)
}

const resolveCampusPaper = async (courseId: number, id?: number, name?: string) => {
  const detail = await getCampusCourse(courseId)
  const papers = detail.folders.filter((item) => !item.archived)
  if (Number(id) > 0) {
    const found = papers.find((item) => item.id === Number(id))
    if (found) return { course: detail.course, paper: found, papers }
    throw new Error(`这门课里没有试卷 ${id}`)
  }
  const keyword = String(name || '').trim()
  if (!keyword) return { course: detail.course, paper: null, papers }
  const exact = papers.filter((item) => item.name === keyword)
  if (exact.length === 1) return { course: detail.course, paper: exact[0], papers }
  const fuzzy = papers.filter((item) => item.name.includes(keyword))
  if (fuzzy.length === 1) return { course: detail.course, paper: fuzzy[0], papers }
  if (fuzzy.length > 1 || exact.length > 1) {
    const list = (exact.length > 1 ? exact : fuzzy).slice(0, 8)
    throw new Error(`有多份试卷叫「${keyword}」，请改用 paper_id：${list.map((item) => `${item.name}(${item.id})`).join('、')}`)
  }
  throw new Error(`这门课里没有试卷「${keyword}」`)
}

const resolveCampusTagId = async (id?: number, name?: string) => {
  if (Number(id) > 0) return Number(id)
  const keyword = String(name || '').trim()
  if (!keyword) return undefined
  const tags = await listCampusTags()
  const exact = tags.filter((item) => item.name === keyword)
  if (exact.length === 1) return exact[0].id
  const fuzzy = tags.filter((item) => item.name.includes(keyword))
  if (fuzzy.length === 1) return fuzzy[0].id
  if (exact.length > 1 || fuzzy.length > 1) {
    const list = (exact.length > 1 ? exact : fuzzy).slice(0, 8)
    throw new Error(`有多个标签叫「${keyword}」，请改用 tag_id：${list.map((item) => `${item.name}(${item.id})`).join('、')}`)
  }
  throw new Error(`没有找到标签「${keyword}」`)
}

const parseCampusDrafts = (raw: unknown) => {
  if (!Array.isArray(raw)) return []
  return raw
    .map((item) => ({
      question: String(item?.question || item?.content || '').trim(),
      options: item?.options,
      answer: String(item?.answer || '').trim(),
      question_type: String(item?.question_type || item?.type || '').trim(),
    }))
    .filter((item) => item.question && item.answer)
}

const campusTagArg = (args: any) =>
  String(args?.tag || args?.tag_name || args?.platform || '').trim()

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

const describeActivity = (name: string, args: any, status: ImportTaskStep['status'], extra?: any) => {
  if (name === 'get_file_info') {
    const summary = extra?.type ? `${extra.type}，共 ${extra.total} ${extra.unit}` : ''
    return {
      target: summary || '文件概况',
      label:
        status === 'running'
          ? '正在查看文件概况'
          : status === 'failed'
            ? '查看文件概况失败'
            : summary
              ? `查看了文件概况，${summary}`
              : '查看了文件概况',
    }
  }
  if (name === 'read_range') {
    const unit = extra?.unit || '段'
    const start = extra?.start ?? Number(args?.start ?? 0)
    const end = extra?.end ?? Number(args?.end ?? start)
    const target = `第 ${start}–${end} ${unit}`
    return {
      target,
      label:
        status === 'running'
          ? `正在阅读${target}`
          : status === 'failed'
            ? `阅读${target}失败`
            : `阅读了${target}`,
    }
  }
  if (name === 'list_folders') {
    const count = Array.isArray(extra?.folders) ? extra.folders.length : 0
    return {
      target: '文件夹',
      label:
        status === 'running'
          ? '正在查看文件夹'
          : status === 'failed'
            ? '查看文件夹失败'
            : count
              ? `查看了 ${count} 个文件夹`
              : '查看了文件夹',
    }
  }
  if (name === 'get_folder_info') {
    const folder = extra?.name || args?.folder_name || '文件夹'
    return {
      target: folder,
      label:
        status === 'running'
          ? `正在查看「${folder}」`
          : status === 'failed'
            ? `查看「${folder}」失败`
            : `查看了「${folder}」`,
    }
  }
  if (name === 'create_folder') {
    const folder = extra?.name || args?.name || '文件夹'
    return {
      target: folder,
      label:
        status === 'running'
          ? `正在创建「${folder}」`
          : status === 'failed'
            ? `创建「${folder}」失败`
            : `创建了「${folder}」`,
    }
  }
  if (name === 'rename_folder') {
    const from = extra?.oldName || args?.folder_name || '文件夹'
    const to = extra?.name || args?.new_name || ''
    return {
      target: to || from,
      label:
        status === 'running'
          ? `正在重命名「${from}」`
          : status === 'failed'
            ? `重命名「${from}」失败`
            : to
              ? `把「${from}」改成了「${to}」`
              : `重命名了「${from}」`,
    }
  }
  if (name === 'move_folder') {
    const folder = extra?.name || args?.folder_name || '文件夹'
    const parent = extra?.parentName || args?.parent_name || '最外层'
    return {
      target: folder,
      label:
        status === 'running'
          ? `正在移动「${folder}」`
          : status === 'failed'
            ? `移动「${folder}」失败`
            : `把「${folder}」移到了「${parent}」`,
    }
  }
  if (name === 'delete_folder') {
    const folder = extra?.name || args?.folder_name || '文件夹'
    return {
      target: folder,
      label:
        status === 'running'
          ? `正在删除「${folder}」`
          : status === 'failed'
            ? `删除「${folder}」失败`
            : `删除了「${folder}」`,
    }
  }
  if (name === 'list_questions') {
    const folder = extra?.folderName || args?.folder_name || '文件夹'
    const count = extra?.count ?? extra?.questions?.length
    return {
      target: folder,
      label:
        status === 'running'
          ? `正在查看「${folder}」里的题目`
          : status === 'failed'
            ? `查看「${folder}」题目失败`
            : count != null
              ? `查看了「${folder}」里的 ${count} 道题目`
              : `查看了「${folder}」里的题目`,
    }
  }
  if (name === 'search_questions') {
    const keyword = extra?.keyword || args?.keyword || '题目'
    const count = extra?.count ?? extra?.questions?.length
    return {
      target: keyword,
      label:
        status === 'running'
          ? `正在搜索「${keyword}」`
          : status === 'failed'
            ? `搜索「${keyword}」失败`
            : count != null
              ? `找到 ${count} 道与「${keyword}」相关的题目`
              : `搜索了「${keyword}」`,
    }
  }
  if (name === 'get_campus_status') {
    const school = extra?.campus || extra?.name || '校园题库'
    return {
      target: school,
      label:
        status === 'running'
          ? '正在查看校园账号'
          : status === 'failed'
            ? '查看校园账号失败'
            : extra?.loggedIn === false
              ? '还没有登录校园账号'
              : extra?.campus
                ? `查看了校园账号「${school}」`
                : '查看了校园账号',
    }
  }
  if (name === 'list_campus_courses') {
    const count = extra?.count ?? extra?.courses?.length
    const school = extra?.campus || '校园'
    return {
      target: school,
      label:
        status === 'running'
          ? '正在查看校园课程'
          : status === 'failed'
            ? '查看校园课程失败'
            : count != null
              ? `查看了 ${count} 门校园课`
              : '查看了校园课程',
    }
  }
  if (name === 'list_campus_papers') {
    const course = extra?.course || args?.course_name || '课程'
    const count = extra?.count ?? extra?.papers?.length
    return {
      target: course,
      label:
        status === 'running'
          ? `正在查看「${course}」的试卷`
          : status === 'failed'
            ? `查看「${course}」试卷失败`
            : count != null
              ? `查看了「${course}」的 ${count} 份试卷`
              : `查看了「${course}」的试卷`,
    }
  }
  if (name === 'list_campus_questions') {
    const paper = extra?.paper || args?.paper_name || '试卷'
    const count = extra?.count ?? extra?.questions?.length
    return {
      target: paper,
      label:
        status === 'running'
          ? `正在查看校园试卷「${paper}」`
          : status === 'failed'
            ? `查看校园试卷「${paper}」失败`
            : count != null
              ? `查看了「${paper}」里的 ${count} 道校园题`
              : `查看了「${paper}」里的校园题`,
    }
  }
  if (name === 'search_campus_questions') {
    const keyword = extra?.keyword || args?.keyword || '校园题'
    const count = extra?.count ?? extra?.questions?.length
    return {
      target: keyword,
      label:
        status === 'running'
          ? `正在搜索校园题「${keyword}」`
          : status === 'failed'
            ? `搜索校园题失败`
            : count != null
              ? `找到 ${count} 道校园题`
              : `搜索了校园题「${keyword}」`,
    }
  }
  if (name === 'list_campus_tags') {
    const count = extra?.count ?? extra?.tags?.length
    return {
      target: '平台标签',
      label:
        status === 'running'
          ? '正在查看校园平台标签'
          : status === 'failed'
            ? '查看校园平台标签失败'
            : count != null
              ? `查看了 ${count} 个校园平台标签`
              : '查看了校园平台标签',
    }
  }
  if (name === 'update_campus_paper') {
    const paper = extra?.paper || args?.paper_name || args?.name || '试卷'
    const tag = extra?.tag || args?.tag || args?.platform || args?.tag_name
    return {
      target: paper,
      label:
        status === 'running'
          ? `正在修改校园试卷「${paper}」`
          : status === 'failed'
            ? `修改校园试卷失败`
            : tag
              ? `把「${paper}」改成了「${tag}」`
              : `修改了校园试卷「${paper}」`,
    }
  }
  if (name === 'create_campus_paper') {
    const paper = extra?.paper || extra?.name || args?.name || '试卷'
    return {
      target: paper,
      label:
        status === 'running'
          ? `正在创建校园试卷「${paper}」`
          : status === 'failed'
            ? `创建校园试卷失败`
            : extra?.already
              ? `校园试卷「${paper}」已存在`
              : `创建了校园试卷「${paper}」`,
    }
  }
  if (name === 'save_campus_questions') {
    const count = extra?.saved ?? extra?.count ?? (Array.isArray(args?.questions) ? args.questions.length : 0)
    const paper = extra?.paper || args?.paper_name || '校园试卷'
    const target = count ? `${count} 道题目` : '题目'
    return {
      target,
      label:
        status === 'running'
          ? `正在上传${target}到「${paper}」`
          : status === 'failed'
            ? `上传校园题失败`
            : `上传了${target}到「${paper}」`,
    }
  }
  if (name === 'update_campus_question') {
    const count = extra?.updated ?? extra?.count ?? (Array.isArray(args?.questions) ? args.questions.length : args?.campus_question_id ? 1 : 0)
    return {
      target: count ? `${count} 道校园题` : '校园题',
      label:
        status === 'running'
          ? '正在修改校园题'
          : status === 'failed'
            ? '修改校园题失败'
            : `修改了 ${count || 0} 道校园题`,
    }
  }
  if (name === 'move_questions') {
    const count = extra?.moved ?? (Array.isArray(args?.question_ids) ? args.question_ids.length : args?.question_id ? 1 : 0)
    const folder = extra?.targetName || args?.folder_name || '文件夹'
    const target = count ? `${count} 道题目` : '题目'
    return {
      target,
      label:
        status === 'running'
          ? `正在移动${target}`
          : status === 'failed'
            ? `移动${target}失败`
            : `把${target}移到了「${folder}」`,
    }
  }
  if (name === 'save_questions') {
    const count = extra?.saved ?? (Array.isArray(args?.questions) ? args.questions.length : 0)
    const folder = extra?.folderName || args?.folder_name || '题库'
    const target = count ? `${count} 道题目` : '题目'
    return {
      target,
      label:
        status === 'running'
          ? `正在写入${target}`
          : status === 'failed'
            ? `写入${target}失败`
            : `写入了${target}到「${folder}」`,
    }
  }
  if (name === 'update_question_metrics') {
    const count = extra?.updated ?? (Array.isArray(args?.question_ids) ? args.question_ids.length : args?.question_id ? 1 : 0)
    return {
      target: count ? `${count} 道题目` : '题目指标',
      label:
        status === 'running'
          ? '正在更新题目指标'
          : status === 'failed'
            ? '更新题目指标失败'
            : `更新了 ${count || 0} 道题目的指标`,
    }
  }
  if (name === 'list_recent_wrong_questions') {
    const count = extra?.count ?? extra?.questions?.length
    return {
      target: extra?.scope || '错题',
      label:
        status === 'running'
          ? '正在查看最近错题'
          : status === 'failed'
            ? '查看最近错题失败'
            : count != null
              ? `查看了 ${count} 道最近错题`
              : '查看了最近错题',
    }
  }
  if (name === 'get_practice_history') {
    const count = extra?.count ?? extra?.records?.length
    return {
      target: args?.question_id ? `题目 ${args.question_id}` : '练习记录',
      label:
        status === 'running'
          ? '正在查看练习记录'
          : status === 'failed'
            ? '查看练习记录失败'
            : count != null
              ? `查看了 ${count} 条练习记录`
              : '查看了练习记录',
    }
  }
  if (name === 'add_practice_note') {
    return {
      target: args?.question_id ? `题目 ${args.question_id}` : '备注',
      label:
        status === 'running'
          ? '正在写入备注'
          : status === 'failed'
            ? '写入备注失败'
            : '记下了一条练习备注',
    }
  }
  if (name === 'present_quiz') {
    const count = extra?.presented ?? (Array.isArray(args?.questions) ? args.questions.length : 0)
    const title = resolveQuizTitle(args) || extra?.title
    return {
      target: title && title !== '练习' ? title : (count ? `${count} 道练习` : '练习'),
      label:
        status === 'running'
          ? title && title !== '练习' ? `正在出「${title}」` : '正在出题'
          : status === 'failed'
            ? title && title !== '练习' ? `「${title}」出题失败` : '出题失败'
            : title && title !== '练习'
              ? `出示了「${title}」${count} 道可点选练习`
              : `出示了 ${count} 道可点选练习`,
    }
  }
  if (name === 'link_questions_to_knowledge') {
    const count = extra?.linked ?? (Array.isArray(args?.question_ids) ? args.question_ids.length : args?.question_id ? 1 : 0)
    return {
      target: count ? `${count} 道题目` : '题目',
      label:
        status === 'running'
          ? '正在关联知识点'
          : status === 'failed'
            ? '关联知识点失败'
            : `关联了 ${count || 0} 道题目的知识点`,
    }
  }
  if (name === 'list_knowledge_questions') {
    const title = extra?.node_name || args?.node_name || '知识点'
    return {
      target: title,
      label:
        status === 'running'
          ? `正在查看「${title}」的题目`
          : status === 'failed'
            ? '查看知识点题目失败'
            : `查看了「${title}」的相关题目`,
    }
  }
  if (name === 'merge_subjects') {
    return {
      target: extra?.name || args?.target_name || '科目',
      label:
        status === 'running'
          ? '正在合并科目'
          : status === 'failed'
            ? '合并科目失败'
            : extra?.message || '合并了学习科目',
    }
  }
  if (name === 'split_subject') {
    return {
      target: extra?.name || args?.name || '科目',
      label:
        status === 'running'
          ? '正在拆分科目'
          : status === 'failed'
            ? '拆分科目失败'
            : extra?.message || '拆分了学习科目',
    }
  }
  if (name === 'list_subjects') {
    return {
      target: '学习科目',
      label: status === 'running' ? '正在查看科目' : status === 'failed' ? '查看科目失败' : '查看了学习科目',
    }
  }
  if (name === 'get_subject') {
    const title = extra?.name || args?.subject_name || '科目'
    return {
      target: title,
      label: status === 'running' ? `正在查看「${title}」` : status === 'failed' ? `查看「${title}」失败` : `查看了「${title}」`,
    }
  }
  if (name === 'open_knowledge_graph') {
    const title = extra?.name || args?.subject_name || '思维导图'
    return {
      target: title,
      label: status === 'running' ? '正在展开思维导图' : status === 'failed' ? '展开思维导图失败' : `展开了「${title}」的思维导图`,
    }
  }
  if (name === 'evaluate_study_progress') {
    const title = extra?.name || args?.subject_name || '掌握度'
    const count = extra?.updated
    return {
      target: title,
      label: status === 'running'
        ? '正在评估掌握度'
        : status === 'failed'
          ? '评估掌握度失败'
          : extra?.started && count == null
            ? '正在后台评估学习效果'
            : count
              ? `评估完这次的学习效果，更新了 ${count} 个知识点`
              : extra?.message || '完成了学习效果评估',
    }
  }
  if (name === 'create_subject') {
    return {
      target: args?.name || extra?.name || '科目',
      label: status === 'running' ? '正在创建科目' : status === 'failed' ? '创建科目失败' : `创建了科目「${args?.name || extra?.name || ''}」`,
    }
  }
  if (name === 'rename_subject') {
    return {
      target: args?.new_name || '科目',
      label: status === 'running' ? '正在重命名科目' : status === 'failed' ? '重命名科目失败' : '重命名了科目',
    }
  }
  if (name === 'delete_subject') {
    return {
      target: args?.subject_name || '科目',
      label: status === 'running' ? '正在删除科目' : status === 'failed' ? '删除科目失败' : '删除了学习科目',
    }
  }
  if (name === 'attach_study_subject') {
    const title = extra?.name || args?.subject_name || '科目'
    return {
      target: title,
      label: status === 'running' ? '正在挂上学习状态' : status === 'failed' ? '挂上学习状态失败' : `挂上了「${title}」`,
    }
  }
  if (name === 'detach_study_subject') {
    return {
      target: extra?.name || '学习状态',
      label: status === 'running' ? '正在撤下学习状态' : status === 'failed' ? '撤下学习状态失败' : '撤下了学习状态',
    }
  }
  if (name === 'get_knowledge_graph') {
    const missed = extra?.found === false
    return {
      target: extra?.subject?.name || args?.subject_name || '知识图谱',
      label:
        status === 'running'
          ? '正在查看知识图谱'
          : status === 'failed'
            ? '查看知识图谱失败'
            : missed
              ? '未匹配到知识图谱'
              : '查看了知识图谱',
    }
  }
  if (name === 'set_knowledge_graph') {
    const count = extra?.subject?.node_count ?? extra?.nodes?.length ?? extra?.node_count ?? args?.nodes?.length
    return {
      target: extra?.subject?.name || args?.subject_name || '知识图谱',
      label:
        status === 'running'
          ? '正在绘制知识图谱'
          : status === 'failed'
            ? '绘制知识图谱失败'
            : `写入了 ${count || 0} 个知识点`,
    }
  }
  if (name === 'patch_knowledge_graph') {
    const count = extra?.added ?? (Array.isArray(args?.add) ? args.add.length : 0)
    return {
      target: extra?.subject?.name || args?.subject_name || '知识图谱',
      label:
        status === 'running'
          ? '正在添加知识点'
          : status === 'failed'
            ? '添加知识点失败'
            : count
              ? `添加了 ${count} 个知识点`
              : '更新了知识图谱',
    }
  }
  if (name === 'focus_knowledge_graph') {
    const title = extra?.node?.name || args?.node_name || '节点'
    return {
      target: extra?.subject?.name || args?.subject_name || '知识图谱',
      label:
        status === 'running'
          ? `正在聚焦「${title}」`
          : status === 'failed'
            ? `聚焦「${title}」失败`
            : `聚焦了「${title}」`,
    }
  }
  return { target: name, label: name || '未知动作' }
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

const resolveFolder = async (id?: number, name?: string) => {
  const folders = await databaseService.getFolders()
  if (Number.isFinite(id)) {
    const found = folders.find((folder) => folder.id === Number(id))
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
    databaseService.getRecentPracticeMarks(ids, 5).catch(() => []),
    databaseService.listQuestionKnowledge(ids).catch(() => []),
  ])
  const map = new Map(summaries.map((item) => [item.question_id, item]))
  const markMap = new Map(marks.map((item) => [item.question_id, item.results || []]))
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
  if (sessions.value.find((item) => item.id === sessionId)?.studySubjectId) return
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

export const createChat = (init?: Partial<Pick<AgentChatSession, 'title' | 'attachments' | 'studySubjectId'>>) => {
  composerAttachments.value = []
  const session: AgentChatSession = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: init?.title || '新对话',
    messages: [],
    attachments: init?.attachments,
    studySubjectId: Number(init?.studySubjectId) > 0 ? Number(init?.studySubjectId) : undefined,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  sessions.value = [session, ...sessions.value].slice(0, 30)
  activeId.value = session.id
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
}

export const removeChat = (id: string) => {
  if (sessionIsStreaming(sessions.value.find((session) => session.id === id))) {
    stopChat(id)
  }
  sessions.value = sessions.value.filter((session) => session.id !== id)
  if (activeId.value === id) activeId.value = sessions.value[0]?.id || null
  persist()
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

const EVAL_COOLDOWN_MS = 16_000
const evalStartedAt = new Map<string, number>()
const evalInFlight = new Set<string>()

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
  if (!force && !result.updated && !result.error) {
    dropStep(sessionId, messageId, stepId)
    patchMessage(sessionId, messageId, { studyEval: undefined })
    return
  }
  patchMessage(sessionId, messageId, {
    studyEval: {
      status: result.error ? 'failed' : result.updated ? 'done' : 'empty',
      text: formatEvalNotice(result),
      updated: result.updated,
    },
  })
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
  if (evalInFlight.has(sessionKey)) return
  const last = evalStartedAt.get(sessionKey) || 0
  if (!input.force && Date.now() - last < EVAL_COOLDOWN_MS) return
  evalStartedAt.set(sessionKey, Date.now())
  evalInFlight.add(sessionKey)

  const stepId = input.stepId || `auto-eval-${input.messageId}`
  const args = {
    subject_id: input.subjectId,
    hint: input.hint,
  }
  if (!input.stepId) {
    const activity = describeActivity('evaluate_study_progress', args, 'running')
    addStep(input.sessionId, input.messageId, {
      id: stepId,
      kind: 'tool',
      name: 'evaluate_study_progress',
      label: activity.label,
      target: activity.target,
      status: 'running',
      startedAt: Date.now(),
    })
  }
  patchMessage(input.sessionId, input.messageId, {
    studyEval: {
      status: 'running',
      text: '正在后台评估这次的学习效果…',
    },
  })

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
    evalInFlight.delete(sessionKey)
  })
}

export const sendChatMessage = async (text: string, files?: AgentChatAttachment[]) => {
  const content = text.trim()
  if (!content) return

  let session = activeChat.value
  if (!session) session = createChat()
  const sessionId = session.id
  if (sessionIsStreaming(sessions.value.find((item) => item.id === sessionId))) return
  await attachStudyFromUserText(sessionId, content)

  const abort = new AbortController()
  chatAborts.set(sessionId, abort)
  const attachments = files?.length ? files : undefined

  const userMessage: AgentChatMessage = {
    id: `user-${Date.now()}`,
    role: 'user',
    content,
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

  logAgentDebug(sessionId, {
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

  const history: { role: string; content: unknown }[] = []
  for (const message of sessions.value.find((item) => item.id === sessionId)?.messages || []) {
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
  const studyPrefix = await studyStatePrefix(sessionId)
  const modelPrompt = `${studyPrefix}${modelUserContent(content, promptFolders)}`
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
    const streamText = (text: string) => {
      patchMessage(sessionId, assistantId, {
        content: text,
        waiting: awaitingTool || !visibleText(text),
        status: 'streaming',
      })
      const mermaid = extractMermaidSource(text)
      if (mermaid) {
        emitStudyGraphStream({
          subjectId: Number.isFinite(streamSubjectId) ? streamSubjectId : undefined,
          mermaid,
          streaming: true,
        })
      }
    }
    const waitForFirstToken = (clearContent = true) => {
      patchMessage(sessionId, assistantId, {
        ...(clearContent ? { content: '' } : {}),
        waiting: true,
        status: 'streaming',
      })
    }

    const finalText = await runTextModel(modelPrompt, (delta) => {
      if (abort.signal.aborted || liveMessage()?.status !== 'streaming') return
      streamText(delta)
    }, {
      timeoutMs: hasFile || images.length ? 15 * 60 * 1000 : 5 * 60 * 1000,
      userContent,
      signal: abort.signal,
      tools: CHAT_TOOLS,
      systemPrompt: SYSTEM_PROMPT,
      useAgentModel: true,
      history,
      maxRounds: hasFile || images.length ? 80 : 32,
      executeTool: async (call: ModelToolCall) => {
        const args = parseToolArgs(call.arguments)
        const attachment = sessionAttachment(sessionId)

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
            args.new_name,
            args.description,
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
            update: args.update,
            remove_ids: args.remove_ids,
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
          waitForFirstToken()
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
          waitForFirstToken()
          const args = parseToolArgs(event.arguments)
          logAgentDebug(sessionId, {
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
          logAgentDebug(sessionId, {
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
          waitForFirstToken()
        }
      },
    })

    if (abort.signal.aborted) {
      const current = sessions.value.find((item) => item.id === sessionId)
        ?.messages.find((message) => message.id === assistantId)
      if (current?.status === 'streaming') finalizeStopped(sessionId, assistantId)
      return
    }
    const assistantContent = finalText || sessions.value.find((item) => item.id === sessionId)
      ?.messages.find((message) => message.id === assistantId)?.content || ''
    const assistantSteps = sessions.value.find((item) => item.id === sessionId)
      ?.messages.find((message) => message.id === assistantId)?.steps || []
    logAgentDebug(sessionId, {
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
    if (finished) {
      const auto = shouldAutoEvalStudy(sessionId, finished)
      if (auto.yes) {
        scheduleStudyProgressEval({
          sessionId,
          messageId: assistantId,
          subjectId: auto.subjectId,
          force: auto.force,
        })
      }
    }
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
  }
}
