import { computed, ref } from 'vue'
import { databaseService } from './database'
import { inspectLocalFile, parseQuestions, normalizeType, readLocalFileRange, type ExtractedQuestion } from './agentImport'
import { isModelStopped, runTextModel, type ModelToolCall } from './modelRunner'
import type { ImportStepPreview, ImportTaskStep } from './importTasks'

export interface AgentChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  attachments?: AgentChatAttachment[]
  steps: ImportTaskStep[]
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
      description: '查看某个文件夹里的题目，返回 Id、题干、答案和题型。移动单题前先调用，用返回的 Id 再 move_questions。一次最多 40 道，多的翻页。',
      parameters: {
        type: 'object',
        properties: {
          folder_id: { type: 'integer' },
          folder_name: { type: 'string' },
          page: { type: 'integer', description: '页码，从 1 开始，默认 1' },
          page_size: { type: 'integer', description: '每页数量，默认 20，最大 40' },
          include_subfolders: { type: 'boolean', description: '是否包含子文件夹里的题目，默认 false' },
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
              },
              required: ['question', 'answer'],
            },
          },
        },
        required: ['questions'],
      },
    },
  },
]

const SYSTEM_PROMPT = `你是题库问答助手。可以讲解、出题、整理题目，也可以查看用户附带的本地文件、管理文件夹并把题目保存进题库。

规则：
1. 用户附带文件不等于要导入。先按用户的问题处理：问内容就 get_file_info 一次，再按需 read_range 后回答；闲聊或无关问题直接回答。同一个文件不要重复 get_file_info。只有用户明确要求导入、识别题目、保存、收录或写入题库时，才分段 read_range 并 save_questions。不要一次读完全文。文件较大时按 nextHint 继续读，直到说已经到末尾。一次写入不要超过 20 道。不要编造文件里没有的题目。用户消息里如果带了图片，按图中内容回答、讲解或识别题目。
2. 普通提问先直接回答。用户要求保存、收录、写入题库时，调用 save_questions。用户文本里如果出现「名称（folder_id=…，路径=…）」，必须使用这个 folder_id，不要按名称猜测或另选。用户只用语言指定文件夹（例如「存到错题本」）时，先 list_folders 或 get_folder_info 对应，不要自己另选。不确定文件夹时先问一句。
3. 用户要求新建、重命名、移动、删除文件夹时，使用对应工具。默认文件夹（Id=0）不能重命名、移动或删除。不确定文件夹时先 list_folders。
4. 用户要求把某几道题、某一类题挪到别的文件夹时，先 list_questions 或 search_questions 确认题目 Id，再 move_questions。不要把整个文件夹当题目移动；挪文件夹用 move_folder。一次不要超过 50 道。
5. 删除文件夹必须用户说清楚要删，并且说明题目是一起删还是留着。
6. 题目字段：question、options（可写成 "A. xxx\\nB. xxx"）、answer、question_type（单选/多选/判断/填空）。
7. 不要编造用户没有给出或没有确认的题目。
8. 操作完成后用一两句话说明结果。`

const parseToolArgs = (raw: string) => {
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
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

const summarizeQuestion = (item: { id: number; question?: string; answer?: string; question_type?: string; folder_id?: number; folder_name?: string }) => ({
  id: item.id,
  question: String(item.question || '').slice(0, 180),
  answer: String(item.answer || '').slice(0, 80),
  question_type: item.question_type || '',
  folderId: item.folder_id ?? 0,
  folderName: item.folder_name || '',
})

const parseQuestionIds = (args: any) => {
  const raw = args?.question_ids ?? args?.question_id
  const list = Array.isArray(raw) ? raw : raw != null ? [raw] : []
  return [...new Set(list.map((value) => Number(value)).filter((id) => Number.isFinite(id) && id > 0))]
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

  const history = (sessions.value.find((item) => item.id === sessionId)?.messages || [])
    .filter((message) => message.id !== assistantId && message.id !== userMessage.id && message.content)
    .map((message) => ({
      role: message.role,
      content: message.role === 'user'
        ? toMultimodalUserContent(message.content, message.attachments)
        : message.content,
    }))
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
          if (args.include_subfolders === true) {
            const all = await databaseService.getQuestionsFromFolderAndSubfolders(folder.id)
            const start = (page - 1) * pageSize
            const items = all.slice(start, start + pageSize)
            return clipToolResult(JSON.stringify({
              folderId: folder.id,
              folderName: folder.name,
              includeSubfolders: true,
              page,
              pageSize,
              total: all.length,
              count: items.length,
              hasMore: start + items.length < all.length,
              questions: items.map(summarizeQuestion),
            }))
          }
          const result = await databaseService.getPaginatedQuestions({
            folderId: folder.id,
            page,
            pageSize,
          })
          return clipToolResult(JSON.stringify({
            folderId: folder.id,
            folderName: folder.name,
            includeSubfolders: false,
            page,
            pageSize,
            total: result.total,
            count: result.items.length,
            hasMore: page * pageSize < result.total,
            questions: result.items.map(summarizeQuestion),
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
          return clipToolResult(JSON.stringify({
            keyword,
            folderId: folder?.id,
            folderName: folder?.name,
            total: found.length,
            count: items.length,
            hasMore: found.length > items.length,
            questions: items.map(summarizeQuestion),
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
            for (const id of ids) selected.set(id, { id, question: '', answer: '', question_type: '', folderId: 0, folderName: '' })
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
          const activity = describeActivity(event.name, args, 'running')
          addStep(sessionId, assistantId, {
            id: event.id,
            kind: 'tool',
            name: event.name,
            label: activity.label,
            target: activity.target,
            preview: event.name === 'save_questions' ? parseQuestions(args.questions) as ImportStepPreview[] : undefined,
            previewCount: event.name === 'save_questions' ? parseQuestions(args.questions).length : undefined,
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
          const status = event.error ? 'failed' : 'done'
          const activity = describeActivity(event.name, extra, status, extra)
          patchStep(sessionId, assistantId, event.id, {
            status,
            label: activity.label,
            target: activity.target,
            detail: event.error,
            finishedAt: Date.now(),
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
    patchMessage(sessionId, assistantId, {
      content: finalText || sessions.value.find((item) => item.id === sessionId)
        ?.messages.find((message) => message.id === assistantId)?.content || '',
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
    if (chatAborts.get(sessionId) === abort) chatAborts.delete(sessionId)
  }
}
