import { invoke } from '@tauri-apps/api/core'
import * as pdfjsLib from 'pdfjs-dist'
import { databaseService } from './database'
import { associateQuestionsToKnowledge } from './questionKnowledge'
import { parseDifficulty, parseImportance, parseMastery } from '../utils/questionMetrics'
import {
  addImportTaskStep,
  createImportTask,
  patchImportTaskStep,
  updateImportTask,
  type ImportTask,
} from './importTasks'
import { runTextModel, type ModelToolCall } from './modelRunner'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.mjs',
  import.meta.url
).toString()

export interface ExtractedQuestion {
  question: string
  options?: string
  answer: string
  question_type?: string
  importance?: number
  mastery?: number
  difficulty?: number
  knowledge_point?: string
  node_name?: string
  node_id?: number
  parent_name?: string
  subject_id?: number
}

type FileKind = 'excel' | 'docx' | 'doc' | 'pdf' | 'text'

interface FileCache {
  path: string
  kind: FileKind
  unit: string
  total: number
  truncated?: boolean
  fileSize?: number
  rows?: string[][]
  paragraphs?: string[]
  pages?: string[]
  pdf?: any
  lines?: string[]
}

const MAX_RANGE = {
  excel: 80,
  docx: 60,
  doc: 60,
  pdf: 3,
  text: 180,
} as const

const LOAD_CAP = {
  excel: 2000,
  docx: 2000,
  doc: 2000,
  text: 8000,
} as const

const FILE_SIZE_MAX = 40 * 1024 * 1024
const FILE_SIZE_WARN = 8 * 1024 * 1024

const formatFileSize = (bytes: number) => {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

const IMPORT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'get_file_info',
      description: '查看待导入文件的类型和规模。开始识别前应先调用。',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_range',
      description: '按范围读取文件内容。Excel 按行，Word 按段落，PDF 按页，文本按行。下标从 0 开始，包含 end。一次不要读太多。',
      parameters: {
        type: 'object',
        properties: {
          start: { type: 'integer', description: '起始下标，从 0 开始' },
          end: { type: 'integer', description: '结束下标，包含' },
        },
        required: ['start', 'end'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'save_questions',
      description: '把已经识别出的题目写入题库。每看完一段就保存一批，不要等全部看完。不要编造文件里没有的题目。',
      parameters: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                question: { type: 'string', description: '题干' },
                options: { type: 'string', description: '选项，没有则空字符串' },
                answer: { type: 'string', description: '答案' },
                question_type: { type: 'string', description: '单选/多选/判断/填空' },
                knowledge_point: { type: 'string', description: '对应知识点或节名，没有就根据题干概括' },
                node_name: { type: 'string', description: '图谱节点名，可与 knowledge_point 相同' },
                parent_name: { type: 'string', description: '所属章名' },
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

const fileNameOf = (path: string) => {
  const parts = path.split(/[/\\]/)
  return parts[parts.length - 1] || path
}

const extOf = (path: string) => {
  const name = fileNameOf(path)
  const index = name.lastIndexOf('.')
  return index >= 0 ? name.slice(index + 1).toLowerCase() : ''
}

const decodeBase64Bytes = (base64: string) => {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes
}

const openPdf = async (path: string) => {
  const base64 = await invoke<string>('read_file_bytes', { path })
  const data = decodeBase64Bytes(base64)
  return pdfjsLib.getDocument({ data }).promise
}

const readPdfPage = async (pdf: any, index: number) => {
  const page = await pdf.getPage(index + 1)
  const content = await page.getTextContent()
  return content.items.map((item: any) => item.str || '').join(' ').trim()
}

const statLocalFile = async (path: string) => {
  try {
    const info = await invoke<{ size: number }>('stat_local_file', { path })
    return Number(info?.size || 0)
  } catch {
    return 0
  }
}

const fileCaches = new Map<string, FileCache>()

const loadFileCache = async (path: string): Promise<FileCache> => {
  const fileSize = await statLocalFile(path)
  if (fileSize > FILE_SIZE_MAX) {
    throw new Error(`文件约 ${formatFileSize(fileSize)}，超过 40 MB，请先拆成更小的文件再导入`)
  }

  const ext = extOf(path)

  if (ext === 'xlsx' || ext === 'xls') {
    const rows = await invoke<string[][]>('read_excel_range', { path, start: 0, end: LOAD_CAP.excel - 1 })
    return {
      path,
      kind: 'excel',
      unit: '行',
      total: rows.length,
      truncated: rows.length >= LOAD_CAP.excel,
      fileSize,
      rows,
    }
  }
  if (ext === 'docx') {
    const paragraphs = await invoke<string[]>('read_docx_range', { path, start: 0, end: LOAD_CAP.docx - 1 })
    return {
      path,
      kind: 'docx',
      unit: '段',
      total: paragraphs.length,
      truncated: paragraphs.length >= LOAD_CAP.docx,
      fileSize,
      paragraphs,
    }
  }
  if (ext === 'doc') {
    const paragraphs = await invoke<string[]>('read_doc_range', { path, start: 0, end: LOAD_CAP.doc - 1 })
    return {
      path,
      kind: 'doc',
      unit: '段',
      total: paragraphs.length,
      truncated: paragraphs.length >= LOAD_CAP.doc,
      fileSize,
      paragraphs,
    }
  }
  if (ext === 'pdf') {
    const pdf = await openPdf(path)
    return { path, kind: 'pdf', unit: '页', total: pdf.numPages, fileSize, pdf, pages: [] }
  }

  const text = (await invoke<string>('read_file_text', { path })).replace(/\u0000/g, '')
  const lines = text.split(/\r?\n/)
  const truncated = lines.length > LOAD_CAP.text
  return {
    path,
    kind: 'text',
    unit: '行',
    total: Math.min(lines.length, LOAD_CAP.text),
    truncated,
    fileSize,
    lines: truncated ? lines.slice(0, LOAD_CAP.text) : lines,
  }
}

const ensureFileCache = async (path: string) => {
  const cached = fileCaches.get(path)
  if (cached) return cached
  const loaded = await loadFileCache(path)
  fileCaches.set(path, loaded)
  return loaded
}

const extendLoadedRange = async (cache: FileCache, end: number) => {
  if (cache.kind === 'excel') {
    const loaded = cache.rows?.length || 0
    if (end < loaded) return
    const extra = await invoke<string[][]>('read_excel_range', { path: cache.path, start: loaded, end })
    cache.rows = [...(cache.rows || []), ...extra]
    if (extra.length < end - loaded + 1) {
      cache.total = cache.rows.length
      cache.truncated = false
    } else {
      cache.total = Math.max(cache.total, cache.rows.length)
      cache.truncated = true
    }
    return
  }

  if (cache.kind === 'docx' || cache.kind === 'doc') {
    const loaded = cache.paragraphs?.length || 0
    if (end < loaded) return
    const extra = await invoke<string[]>(
      cache.kind === 'docx' ? 'read_docx_range' : 'read_doc_range',
      { path: cache.path, start: loaded, end }
    )
    cache.paragraphs = [...(cache.paragraphs || []), ...extra]
    if (extra.length < end - loaded + 1) {
      cache.total = cache.paragraphs.length
      cache.truncated = false
    } else {
      cache.total = Math.max(cache.total, cache.paragraphs.length)
      cache.truncated = true
    }
  }
}

const fillPdfPages = async (cache: FileCache, start: number, end: number) => {
  if (!cache.pdf) return
  cache.pages = cache.pages || []
  for (let index = start; index <= end; index += 1) {
    if (cache.pages[index] == null) {
      cache.pages[index] = await readPdfPage(cache.pdf, index)
    }
  }
}

export const inspectLocalFile = async (path: string) => {
  const cache = await ensureFileCache(path)
  if (!cache.total) {
    throw new Error('文件里没有可读的文本')
  }
  const batch = MAX_RANGE[cache.kind]
  const warning = cache.fileSize && cache.fileSize > FILE_SIZE_WARN
    ? `文件较大（${formatFileSize(cache.fileSize)}），请严格分段读取，每批保存。`
    : cache.truncated
      ? `当前先处理前 ${cache.total} ${cache.unit}。读到末尾后如果 nextHint 还允许继续，就继续读；否则请提示用户拆分文件。`
      : undefined
  return {
    fileName: fileNameOf(path),
    type: kindLabel(cache.kind),
    unit: cache.unit,
    total: cache.total,
    truncated: Boolean(cache.truncated),
    fileSize: cache.fileSize ? formatFileSize(cache.fileSize) : undefined,
    suggestedBatch: batch,
    estimatedBatches: Math.ceil(cache.total / batch),
    warning,
    hint: `请用 read_range 分段读取，每次不超过 ${batch} ${cache.unit}。读完一段就 save_questions，直到读到末尾。一次写入不要超过 20 道。`,
  }
}

export const readLocalFileRange = async (path: string, start: number, end: number) => {
  const cache = await ensureFileCache(path)
  const maxSpan = MAX_RANGE[cache.kind]
  const last = Math.max(cache.total - 1, 0)
  const safeStart = Math.max(0, Math.min(Number(start) || 0, last))
  const safeEnd = Math.max(safeStart, Math.min(Number(end) || safeStart, safeStart + maxSpan - 1))
  if (cache.kind === 'pdf') {
    await fillPdfPages(cache, safeStart, Math.min(safeEnd, last))
  } else if (cache.kind !== 'text') {
    await extendLoadedRange(cache, safeEnd)
  }
  const slice = sliceCache(cache, safeStart, safeEnd)
  const nextEnd = Math.min(slice.end + maxSpan, Math.max(cache.total - 1, 0))
  return {
    ...slice,
    truncated: Boolean(cache.truncated),
    nextHint: slice.end + 1 < cache.total
      ? `还可以继续从 ${slice.end + 1} 读到 ${nextEnd}`
      : cache.truncated
        ? '当前可读范围已经到末尾。如果题目明显还没读完，请提示用户把文件拆小后再导入。'
        : '已经读到末尾',
  }
}

const sliceCache = (cache: FileCache, start: number, end: number) => {
  const maxSpan = MAX_RANGE[cache.kind]
  const last = Math.max((cache.kind === 'excel' ? cache.rows?.length : cache.kind === 'pdf' ? cache.total : cache.kind === 'text' ? cache.lines?.length : cache.paragraphs?.length) || cache.total, 1) - 1
  const safeStart = Math.max(0, Math.min(start, last))
  const safeEnd = Math.max(safeStart, Math.min(end, safeStart + maxSpan - 1, last))

  if (cache.kind === 'excel') {
    const rows = (cache.rows || []).slice(safeStart, safeEnd + 1)
    return {
      start: safeStart,
      end: safeEnd,
      total: cache.total,
      unit: cache.unit,
      content: rows.map((row) => row.join('\t')).join('\n'),
    }
  }
  if (cache.kind === 'pdf') {
    const pages = (cache.pages || []).slice(safeStart, safeEnd + 1)
    return {
      start: safeStart,
      end: safeEnd,
      total: cache.total,
      unit: cache.unit,
      content: pages.map((page, index) => `--- 第 ${safeStart + index + 1} 页 ---\n${page || ''}`).join('\n\n'),
    }
  }
  const items = (cache.kind === 'text' ? cache.lines : cache.paragraphs) || []
  return {
    start: safeStart,
    end: safeEnd,
    total: cache.total,
    unit: cache.unit,
    content: items.slice(safeStart, safeEnd + 1).join('\n'),
  }
}

const parseToolArgs = (raw: string) => {
  try {
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

export const parseQuestions = (raw: unknown): ExtractedQuestion[] => {
  if (Array.isArray(raw)) {
    return raw
      .map((item) => ({
        question: String(item?.question || item?.content || '').trim(),
        options: String(item?.options || '').trim(),
        answer: String(item?.answer || '').trim(),
        question_type: String(item?.question_type || item?.type || '').trim(),
        importance: item?.importance == null ? undefined : parseImportance(item.importance),
        mastery: item?.mastery == null ? undefined : parseMastery(item.mastery),
        difficulty: item?.difficulty == null ? undefined : parseDifficulty(item.difficulty),
        knowledge_point: String(item?.knowledge_point || item?.knowledge || '').trim() || undefined,
        node_name: String(item?.node_name || item?.knowledge_point || '').trim() || undefined,
        node_id: Number(item?.node_id || item?.nodeId) > 0 ? Number(item?.node_id || item?.nodeId) : undefined,
        parent_name: String(item?.parent_name || item?.chapter || '').trim() || undefined,
        subject_id: Number(item?.subject_id || item?.subjectId) > 0 ? Number(item?.subject_id || item?.subjectId) : undefined,
      }))
      .filter((item) => item.question && item.answer)
  }

  const text = String(raw || '').trim()
  if (!text) return []
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = (fenced?.[1] || text).trim()
  const start = candidate.indexOf('[')
  const end = candidate.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  try {
    return parseQuestions(JSON.parse(candidate.slice(start, end + 1)))
  } catch {
    return []
  }
}

export const normalizeType = (value?: string) => {
  const text = (value || '').trim()
  if (['单选', '多选', '判断', '填空'].includes(text)) return text
  if (/单选|选择/.test(text) && !/多选/.test(text)) return '单选'
  if (/多选/.test(text)) return '多选'
  if (/判断|对错|是否/.test(text)) return '判断'
  if (/填空/.test(text)) return '填空'
  return text
}

const kindLabel = (kind: FileKind) => {
  switch (kind) {
    case 'excel':
      return 'Excel'
    case 'docx':
    case 'doc':
      return 'Word'
    case 'pdf':
      return 'PDF'
    default:
      return '文本'
  }
}

const describeActivity = (
  name: string,
  args: any,
  status: 'running' | 'done' | 'failed',
  extra?: any
) => {
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

  if (name === 'save_questions') {
    const count = extra?.saved ?? (Array.isArray(args?.questions) ? args.questions.length : 0)
    const target = count ? `${count} 道题目` : '题目'
    return {
      target,
      label:
        status === 'running'
          ? `正在写入${target}`
          : status === 'failed'
            ? `写入${target}失败`
            : `写入了${target}`,
    }
  }

  return { target: name, label: name || '未知动作' }
}

const clipToolResult = (text: string) => (text.length > 12000 ? `${text.slice(0, 11999)}…` : text)

const SYSTEM_PROMPT = `你是题库导入助手。用户选了一份本地文件，你必须通过工具查看内容并提取题目。

规则：
1. 先调用 get_file_info，再分段调用 read_range，不要一次读完全文。
2. 每看完一段，立刻用 save_questions 保存识别到的题目。
3. 只提取文件里真实存在的题目，不要编造。
4. 题目字段：question（题干）、options（选项，可写成 "A. xxx\\nB. xxx"）、answer、question_type（单选/多选/判断/填空）。能看出考点就写 knowledge_point 或 node_name，能看出章节就写 parent_name。没有对应知识点时也要写一个简短考点名，系统会自动生成并关联。
5. 全部读完并保存后，用一两句话总结导入结果。不要把题目 JSON 直接输出到对话里。`

const composeSummary = (raw: string, task: ImportTask, count: number) => {
  const text = String(raw || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/^\s*\[.*\]\s*$/s, '')
    .trim()
  if (text && text.length <= 280 && !text.startsWith('{') && !text.startsWith('[')) {
    return text
  }
  return `已从「${task.fileName}」写入 ${count} 道题目到「${task.folderName || '指定文件夹'}」。`
}

let pumping = false
const queue: ImportTask[] = []

const runTask = async (task: ImportTask) => {
  let importedCount = 0
  let cache: FileCache | null = null

  const ensureCache = async () => {
    if (cache) return cache
    updateImportTask(task.id, { status: 'reading', progressText: '正在读取文件结构' })
    cache = await loadFileCache(task.filePath)
    if (!cache.total) {
      throw new Error('文件里没有可读的文本')
    }
    return cache
  }

  const saveQuestions = async (items: ExtractedQuestion[]) => {
    const created: { id: number; item: ExtractedQuestion }[] = []
    for (const item of items) {
      const question = await databaseService.addQuestion({
        content: item.question,
        options: item.options || '',
        answer: item.answer,
        question_type: normalizeType(item.question_type),
        folderId: task.folderId,
        isAi: 1,
      })
      created.push({ id: question.id, item })
      importedCount += 1
      updateImportTask(task.id, {
        status: 'saving',
        importedCount,
        progressText: `正在写入题目，已写入 ${importedCount} 道`,
      })
    }
    if (created.length) {
      await associateQuestionsToKnowledge(
        created.map(({ id, item }) => ({
          questionId: id,
          question: item.question,
          knowledge_point: item.knowledge_point,
          node_name: item.node_name,
          node_id: item.node_id,
          parent_name: item.parent_name,
          subject_id: item.subject_id,
        })),
        { hintText: task.fileName, createMissing: true },
      )
    }
    return created.length
  }

  const executeTool = async (call: ModelToolCall) => {
    const args = parseToolArgs(call.arguments)

    if (call.name === 'get_file_info') {
      const file = await ensureCache()
      updateImportTask(task.id, {
        status: 'analyzing',
        progressText: `查看了文件概况，${kindLabel(file.kind)}，共 ${file.total} ${file.unit}`,
      })
      return JSON.stringify({
        fileName: task.fileName,
        type: kindLabel(file.kind),
        unit: file.unit,
        total: file.total,
        hint: `请用 read_range 分段读取，建议每次不超过 ${MAX_RANGE[file.kind]} ${file.unit}`,
      })
    }

    if (call.name === 'read_range') {
      const file = await ensureCache()
      const start = Number(args.start ?? 0)
      const end = Number(args.end ?? start)
      const slice = sliceCache(file, start, end)
      updateImportTask(task.id, {
        status: 'analyzing',
        progressText: `正在阅读第 ${slice.start}–${slice.end} ${slice.unit}`,
      })
      return clipToolResult(JSON.stringify({
        start: slice.start,
        end: slice.end,
        total: slice.total,
        unit: slice.unit,
        content: slice.content,
        nextHint: slice.end + 1 < slice.total ? `还可以继续从 ${slice.end + 1} 读到 ${Math.min(slice.end + MAX_RANGE[file.kind], slice.total - 1)}` : '已经读到末尾',
      }))
    }

    if (call.name === 'save_questions') {
      const questions = parseQuestions(args.questions)
      if (!questions.length) {
        return JSON.stringify({ saved: 0, totalSaved: importedCount, message: '没有有效题目，需要 question 和 answer' })
      }
      const saved = await saveQuestions(questions)
      return JSON.stringify({
        saved,
        totalSaved: importedCount,
        message: `本批保存 ${saved} 道，累计 ${importedCount} 道`,
      })
    }

    return JSON.stringify({ error: `未知工具 ${call.name}` })
  }

  try {
    updateImportTask(task.id, { status: 'analyzing', progressText: '正在查看文件' })

    const finalText = await runTextModel(
      `请导入文件「${task.fileName}」。先查看文件信息，再分段阅读并提取题目。每识别一批就调用 save_questions。全部完成后用一句话总结。`,
      undefined,
      {
        timeoutMs: 5 * 60 * 1000,
        tools: IMPORT_TOOLS,
        systemPrompt: SYSTEM_PROMPT,
        useAgentModel: true,
        maxRounds: 48,
        executeTool,
        onEvent: (event) => {
          if (event.type === 'text') {
            updateImportTask(task.id, { status: 'analyzing', progressText: '正在整理题目' })
            return
          }

          if (event.type === 'tool_start') {
            const args = parseToolArgs(event.arguments)
            const activity = describeActivity(event.name, args, 'running')
            addImportTaskStep(task.id, {
              id: event.id,
              kind: 'tool',
              name: event.name,
              label: activity.label,
              target: activity.target,
              preview: event.name === 'save_questions' ? parseQuestions(args.questions) : undefined,
              status: 'running',
              startedAt: Date.now(),
            })
            updateImportTask(task.id, { status: 'analyzing', progressText: activity.label })
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
            patchImportTaskStep(task.id, event.id, {
              status,
              label: activity.label,
              target: activity.target,
              detail: event.error,
              finishedAt: Date.now(),
            })
            updateImportTask(task.id, {
              status: event.name === 'save_questions' ? 'saving' : 'analyzing',
              progressText: event.error ? activity.label : '正在整理题目',
            })
          }
        },
      }
    )

    if (!importedCount) {
      const fallback = parseQuestions(finalText)
      if (fallback.length) {
        const fallbackId = `fallback-${Date.now()}`
        const running = describeActivity('save_questions', { questions: fallback }, 'running')
        updateImportTask(task.id, { status: 'saving', progressText: running.label })
        addImportTaskStep(task.id, {
          id: fallbackId,
          kind: 'tool',
          name: 'save_questions',
          label: running.label,
          target: running.target,
          preview: fallback,
          status: 'running',
          startedAt: Date.now(),
        })
        await saveQuestions(fallback)
        const done = describeActivity('save_questions', { questions: fallback }, 'done', { saved: fallback.length })
        patchImportTaskStep(task.id, fallbackId, {
          status: 'done',
          label: done.label,
          target: done.target,
          finishedAt: Date.now(),
        })
      }
    }

    if (!importedCount) {
      throw new Error('没有识别到题目，请换一份更清晰的文件或换个模型再试')
    }

    const summary = composeSummary(finalText, task, importedCount)
    updateImportTask(task.id, {
      status: 'done',
      importedCount,
      summary,
      progressText: `已写入 ${importedCount} 道题目`,
      finishedAt: Date.now(),
    })
    window.dispatchEvent(new CustomEvent('questions-imported', { detail: { folderId: task.folderId } }))
  } catch (error) {
    updateImportTask(task.id, {
      status: 'failed',
      importedCount,
      summary: importedCount > 0 ? `导入中断，已经写入 ${importedCount} 道题目。` : undefined,
      error: error instanceof Error ? error.message : String(error),
      progressText: importedCount > 0 ? `导入中断，已写入 ${importedCount} 道` : '导入失败',
      finishedAt: Date.now(),
    })
  }
}

const pump = async () => {
  if (pumping) return
  pumping = true
  try {
    while (queue.length) {
      const task = queue.shift()
      if (task) await runTask(task)
    }
  } finally {
    pumping = false
  }
}

export const startAgentImport = (input: {
  filePath: string
  folderId: number
  folderName: string
}) => {
  const task = createImportTask({
    fileName: fileNameOf(input.filePath),
    filePath: input.filePath,
    folderId: input.folderId,
    folderName: input.folderName,
  })
  queue.push(task)
  void pump()
  return task
}
