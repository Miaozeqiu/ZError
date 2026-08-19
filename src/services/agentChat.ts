import { computed, ref } from 'vue'
import { databaseService } from './database'
import { inspectLocalFile, parseQuestions, normalizeType, readLocalFileRange, type ExtractedQuestion } from './agentImport'
import { isModelStopped, runTextModel, type ModelToolCall } from './modelRunner'
import type { ImportStepPreview, ImportTaskStep } from './importTasks'
import { parseDifficulty, parseImportance, parseMastery } from '../utils/questionMetrics'
import { getQuizCards, parseQuizCards, saveQuizCards, type QuizCard } from '../utils/quizPractice'
import { collectGraphNodes, extractMermaidSource, graphFromPayload, graphToMermaid, parseGraphEdgeInputs, parseGraphNodeInputs } from '../utils/studyGraph'
import { clipAgentDebug, logAgentDebug } from './agentDebugLog'
import { emitStudyGraphStream, finishStudyGraphStream } from './studyGraphStream'

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

export interface AgentChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: AgentChatAttachment[]
  steps: ImportTaskStep[]
  quizAttempts?: AgentQuizAttempt[]
  quizReported?: boolean
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
  createdAt: number
  updatedAt: number
}

const STORAGE_KEY = 'zerror-agent-chat-sessions'
const sessions = ref<AgentChatSession[]>([])
const activeId = ref<string | null>(null)
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
      messages: (session.messages || []).map((message) => ({
        ...message,
        attachments: Array.isArray(message.attachments) ? message.attachments : undefined,
        steps: Array.isArray(message.steps) ? message.steps : [],
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
      description: '查看某个文件夹里的题目，返回 Id、题干、答案、题型、重要性/掌握度/难度，以及最近练习摘要。出题或改指标前先调用。一次最多 40 道，多的翻页。',
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
      description: '向用户出示可点选的练习题。选择题必须用这个工具，不要把选项写成普通 Markdown。优先传 question_ids。也可以只传 count，系统会从未掌握的题里抽。一次最多 10 道。',
      parameters: {
        type: 'object',
        properties: {
          question_ids: { type: 'array', items: { type: 'integer' }, description: '题库题目 Id 列表' },
          count: { type: 'integer', description: '未指定题目时自动抽取的数量，默认 5' },
          folder_id: { type: 'integer' },
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question_id: { type: 'integer', description: '题库题目 Id' },
                question: { type: 'string' },
                options: { type: 'string', description: 'A. ...\\nB. ...' },
                answer: { type: 'string' },
                question_type: { type: 'string', description: '单选/多选/判断/填空' },
                explanation: { type: 'string' },
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
      name: 'list_subjects',
      description: '查看学习页的科目列表。知识图谱科目独立于题库文件夹。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_subject',
      description: '在学习页新建一个科目，用于绘制知识图谱。不要用创建文件夹代替。',
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
      name: 'get_knowledge_graph',
      description: '查看某科目当前的知识图谱节点。改图或生成前先调用。',
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
      description: '为某科目整图写入知识图谱，会替换该科目原有节点。只在整图推倒重来时用。结构必须像教材目录：科目→章→节，不要散落考点云。禁止空泛节点（学科基础、核心概念、方法与应用）。禁止空调用。生成新图请优先多次 patch_knowledge_graph。',
      parameters: {
        type: 'object',
        properties: {
          subject_id: { type: 'integer' },
          subject_name: { type: 'string' },
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
                mastery: { type: 'integer', description: '0未评估 1未掌握 2一般 3已掌握' },
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
      description: '往知识图谱里添加或修改节点。生成图谱时用这个分批添加，一次 3–8 个。先加章名，再给每章加 2–4 个节名（parent_key 填章的 key 或中文名）。节点名用教材目录口吻，不要定理/论文名。可多次调用，每批不同。不要一次塞整张图。',
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
                mastery: { type: 'integer' },
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
                mastery: { type: 'integer' },
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
]

const SYSTEM_PROMPT = `你是题库与学习助手。可以讲解、出题、整理题目，也可以管理学习页的科目和知识图谱，以及查看用户附带的本地文件。

规则：
1. 用户附带文件不等于要导入。先按用户的问题处理：问内容就 get_file_info 一次，再按需 read_range 后回答；闲聊或无关问题直接回答。同一个文件不要重复 get_file_info。只有用户明确要求导入、识别题目、保存、收录或写入题库时，才分段 read_range 并 save_questions。不要一次读完全文。文件较大时按 nextHint 继续读，直到说已经到末尾。一次写入不要超过 20 道。不要编造文件里没有的题目。用户消息里如果带了图片，按图中内容回答、讲解或识别题目。
2. 普通提问先直接回答。用户要求保存、收录、写入题库时，调用 save_questions。用户文本里如果出现「名称（folder_id=…，路径=…）」，必须使用这个 folder_id，不要按名称猜测或另选。用户只用语言指定文件夹（例如「存到错题本」）时，先 list_folders 或 get_folder_info 对应，不要自己另选。不确定文件夹时先问一句。
3. 用户要求新建、重命名、移动、删除文件夹时，使用对应工具。默认文件夹（Id=0）不能重命名、移动或删除。不确定文件夹时先 list_folders。
4. 用户要求把某几道题、某一类题挪到别的文件夹时，先 list_questions 或 search_questions 确认题目 Id，再 move_questions。不要把整个文件夹当题目移动；挪文件夹用 move_folder。一次不要超过 50 道。
5. 删除文件夹必须用户说清楚要删，并且说明题目是一起删还是留着。
6. 题目字段：question、options（写成 "A. xxx\\nB. xxx"）、answer、question_type（单选/多选/判断/填空）、importance/mastery/difficulty（0–3，或低/中/高、未掌握/一般/已掌握、简单/中等/困难）。
7. 出选择题或判断题练习时，必须调用 present_quiz，题目会出现在右侧练习页供点选。不要把选项写成普通列表让用户在输入框回答。题库里的题只传 question_id；自己出的题带上题干、选项、答案和解析。
8. 出题前用 list_questions 看掌握度和练习记录，优先出未掌握、掌握度为 /、或最近答错的题。需要细节时 get_practice_history。
9. 用户要求改重要性、掌握度、难度时用 update_question_metrics。保存新题时可在 save_questions 里一并写入这些指标。
10. 用户要求记下易错点或复习提示时，用 add_practice_note。
11. 不要编造用户没有给出或没有确认的题目。
12. 同一工具、相同参数只调用一次。list_questions 已含练习摘要，不要再对每道题 get_practice_history，除非用户点名某一题。present_quiz 成功后立刻停止调用工具，只用一两句话收尾，不要再 list_questions 或再次 present_quiz。patch_knowledge_graph 例外：生成图谱时必须多次调用，每批 3–8 个不同节点，先写全章，再补节，直到大约 28–45 个目录节点。
13. 用户每做完一题就会发来该题的选择。立刻只讲评这一题：判断对错、解释原因、点出易错点。不要装作没看到，不要一次讲评整套题，也不要再出新题，除非用户要求继续。
14. 操作完成后用一两句话说明结果。出题后提醒用户看右侧练习页。不要重复列出 present_quiz 已经出示的选项。
15. 学习页的科目和知识图谱独立于题库文件夹。用户要画、改、生成知识图谱时，用 patch_knowledge_graph 分批添加节点，不要一次塞整张 mermaid，不要调用空的 set_knowledge_graph。图谱必须像教材目录，不要像散落考点云：先加 8–12 个章名，再给每章加 2–4 个节名（parent_key 用章的 key 或中文名）。到节为止，不要再拆定理、模型、公式、论文名。禁止学科基础、核心概念、方法与应用、基础知识、综合应用、概述、其他。整图推倒重来才用 set_knowledge_graph。不要先问用户确认。若工具返回 error，修正后再调用，不要声称已经生成。画完用一两句话提醒用户看学习页。
16. 用户消息里如果带了 subject_id，必须使用这个科目，不要另建同名科目。`

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

const WRITE_GRAPH_HINT = '请立刻调用 patch_knowledge_graph，用 add 传入 3–8 个节点。第一批只写章名；之后给章补节，parent_key 填章的中文名。不要传空参数，不要一次塞整张 mermaid，不要加定理或论文名叶子。'

const GRAPH_QUALITY = `用 patch_knowledge_graph 分批画图，不要一次写整张 mermaid。图谱必须像教材目录，不要像散落考点云。
- 三层：科目 → 章（8–12 个章名）→ 节（每章 2–4 个节名）。到节为止
- 第一批只加章；之后每批给 1–2 章补节，parent_key 填章名
- 每批 3–8 个，连续调用到大约 28–45 个
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
    return {
      target: count ? `${count} 道练习` : '练习',
      label:
        status === 'running'
          ? '正在出题'
          : status === 'failed'
            ? '出题失败'
            : `出示了 ${count} 道可点选练习`,
    }
  }
  if (name === 'list_subjects') {
    return {
      target: '学习科目',
      label: status === 'running' ? '正在查看科目' : status === 'failed' ? '查看科目失败' : '查看了学习科目',
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
  const summaries = await databaseService.getPracticeSummaries(items.map((item) => item.id))
  const map = new Map(summaries.map((item) => [item.question_id, item]))
  return items.map((item) => ({
    ...summarizeQuestion(item as any),
    practice: map.get(item.id) || { count: 0 },
  }))
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

const saveQuestions = async (items: ExtractedQuestion[], folderId: number) => {
  let saved = 0
  for (const item of items) {
    await databaseService.addQuestion({
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
    saved += 1
  }
  if (saved) {
    window.dispatchEvent(new CustomEvent('questions-imported', { detail: { folderId } }))
  }
  return saved
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

export const createChat = (init?: Partial<Pick<AgentChatSession, 'title' | 'attachments'>>) => {
  composerAttachments.value = []
  const session: AgentChatSession = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: init?.title || '新对话',
    messages: [],
    attachments: init?.attachments,
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

export const startStudyGraphChat = async (input?: { subjectId?: number; subjectName?: string }) => {
  const name = String(input?.subjectName || '').trim()
  const id = Number(input?.subjectId)
  window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'agent' }))
  if (Number.isFinite(id) && id > 0) {
    emitStudyGraphStream({
      subjectId: id,
      mermaid: `flowchart TB\nsubject["${name || '知识图谱'}"]`,
      streaming: true,
    })
    try {
      await databaseService.setStudyGraph(id, [])
      window.dispatchEvent(new CustomEvent('study-graph-updated', { detail: { subjectId: id } }))
    } catch {
      // 旧图清不掉也继续画，避免挡住生成
    }
    createChat({ title: `知识图谱 ${name || id}` })
    await sendChatMessage(
      `请为学习科目「${name || '未命名'}」（subject_id=${id}）绘制知识图谱。${GRAPH_QUALITY}
${graphSubjectHint(name)}
用 patch_knowledge_graph，subject_id=${id}，add 里每次放 3–8 个节点。先写章，再给每章补节（parent_key 填章名）。不要调用空的 set_knowledge_graph，不要问确认，不要铺定理或论文名。画完用一两句话说明。`,
    )
    return
  }
  createChat({ title: '知识图谱' })
  await sendChatMessage(
    `请帮我在学习页建立知识图谱。先 list_subjects，没有合适科目就 create_subject。${GRAPH_QUALITY}
用 patch_knowledge_graph 分批 add 节点。不要询问是否同意结构，不要说无法写入。`,
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

export const sendChatMessage = async (text: string, files?: AgentChatAttachment[]) => {
  const content = text.trim()
  if (!content) return

  let session = activeChat.value
  if (!session) session = createChat()
  const sessionId = session.id
  if (sessionIsStreaming(sessions.value.find((item) => item.id === sessionId))) return

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
  const modelPrompt = modelUserContent(content, promptFolders)
  const images = (attachments || []).filter((item) => isImageAttachment(item) && item.imageUrl)
  const userContent = images.length
    ? toMultimodalUserContent(content, [...images, ...promptFolders])
    : undefined

  let drawingGraph = false
  const streamSubjectId = Number(String(content).match(/subject_id\s*=\s*(\d+)/)?.[1])

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
          const saved = await saveQuestions(questions, folder?.id ?? 0)
          return JSON.stringify({
            saved,
            folderId: folder?.id ?? 0,
            folderName: folder?.name || '默认',
            message: `已写入 ${saved} 道题目到「${folder?.name || '默认'}」`,
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
          let cards = await resolveQuizCards(args)
          if (!cards.length) {
            const count = Math.min(10, Math.max(1, Number(args.count) || 5))
            const folder = args.folder_id != null ? await resolveFolder(args.folder_id, args.folder_name) : null
            cards = await pickPracticeCards(sessionId, count, folder?.id)
          }
          if (!cards.length) {
            return JSON.stringify({ error: '没有可出示的题目。请先 list_questions，或传入 question_ids。' })
          }
          saveQuizCards(call.id, cards)
          return JSON.stringify({
            presented: cards.length,
            questions: cards.map((card) => ({
              question_id: card.question_id,
              question: card.question.slice(0, 180),
              question_type: card.question_type,
              importance: card.importance,
              mastery: card.mastery,
              difficulty: card.difficulty,
            })),
            message: `已出示 ${cards.length} 道可点选练习。现在直接用一两句话收尾，不要再调用任何工具，也不要再列出选项。`,
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

        const summarizeGraph = (payload: Awaited<ReturnType<typeof databaseService.getStudyGraph>>) => ({
          subject: payload.subject,
          node_count: payload.nodes.length,
          nodes: payload.nodes.map((item) => ({
            id: item.id,
            key: item.node_key,
            name: item.name,
            summary: String(item.summary || '').slice(0, 80),
            mastery: item.mastery,
            parent_id: item.parent_id || null,
          })),
        })

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
          if (nodes.length < 28) {
            return `已添加 ${added} 个，当前共 ${nodes.length} 个。目录还不够完整，请继续给尚未展开的章补 2–4 个节。`
          }
          return `已添加 ${added} 个，当前共 ${nodes.length} 个。目录已成形，不要再拆定理或公式叶子。用一两句话收尾并提醒用户看学习页。`
        }

        if (call.name === 'list_subjects') {
          const subjects = await databaseService.listStudySubjects()
          return JSON.stringify({
            count: subjects.length,
            subjects: summarizeSubjects(subjects),
          })
        }

        if (call.name === 'create_subject') {
          const name = String(args.name || '').trim()
          if (!name) return JSON.stringify({ error: '科目名称不能为空' })
          const subject = await databaseService.createStudySubject(name, String(args.description || ''))
          notifyStudyGraph(subject.id)
          return JSON.stringify({
            ...subject,
            message: `已创建科目「${subject.name}」，subject_id=${subject.id}。${WRITE_GRAPH_HINT}`,
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
              ...(payload.nodes.length ? {} : { message: `图谱为空。${WRITE_GRAPH_HINT}` }),
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
          const quizCards = event.name === 'present_quiz' ? getQuizCards(event.id) : []
          patchStep(sessionId, assistantId, event.id, {
            status,
            label: activity.label,
            target: activity.target,
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
    if (drawingGraph || Number.isFinite(streamSubjectId)) {
      finishStudyGraphStream(Number.isFinite(streamSubjectId) ? streamSubjectId : undefined)
    }
    if (chatAborts.get(sessionId) === abort) chatAborts.delete(sessionId)
  }
}
