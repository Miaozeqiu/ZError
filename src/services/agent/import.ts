import { invoke } from '@tauri-apps/api/core'
import { parseDifficulty, parseImportance, parseMastery } from '../../utils/question/questionMetrics'

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
  const [{ getDocument }, base64] = await Promise.all([
    import('../../utils/ui/pdfDocument'),
    invoke<string>('read_file_bytes', { path }),
  ])
  return getDocument({ data: decodeBase64Bytes(base64) }).promise
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
