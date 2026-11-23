import { invoke } from '@tauri-apps/api/core'
import { MAX_AGENT_ATTACHMENT_BYTES } from './attachmentFiles'
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
  touched?: number
  signature?: string
  extending?: Promise<void>
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
} as const

const FILE_SIZE_MAX = MAX_AGENT_ATTACHMENT_BYTES
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

const statLocalFile = (path: string) => invoke<{ size: number; modified?: number }>('stat_local_file', { path })

const fileCaches = new Map<string, FileCache>()

const loadFileCache = async (path: string, fileSize: number): Promise<FileCache> => {
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
  const truncated = false
  return {
    path,
    kind: 'text',
    unit: '行',
    total: lines.length,
    truncated,
    fileSize,
    lines,
  }
}

const pendingFiles = new Map<string, Promise<FileCache>>()
const disposeCache = (cache: FileCache) => { void cache.pdf?.destroy()?.catch(() => {}) }
export const clearFileCaches = () => {
  for (const cache of fileCaches.values()) disposeCache(cache)
  fileCaches.clear()
}

const ensureFileCache = async (path: string) => {
  if (pendingFiles.has(path)) return pendingFiles.get(path)!
  const pending = (async () => {
    const info = await statLocalFile(path)
    const signature = `${info.size}:${info.modified ?? ''}`
    const now = Date.now()
    for (const [key, cache] of fileCaches) {
      if (now - (cache.touched || 0) > 10 * 60_000 || (key === path && cache.signature !== signature)) {
        fileCaches.delete(key)
        disposeCache(cache)
      }
    }
    let cache = fileCaches.get(path)
    if (!cache) {
      cache = await loadFileCache(path, info.size)
      cache.signature = signature
    }
    cache.touched = now
    fileCaches.delete(path)
    fileCaches.set(path, cache)
    while (fileCaches.size > 4) {
      const oldest = fileCaches.keys().next().value!
      disposeCache(fileCaches.get(oldest)!)
      fileCaches.delete(oldest)
    }
    return cache
  })()
  pendingFiles.set(path, pending)
  try { return await pending } finally { pendingFiles.delete(path) }
}

const extendLoadedRangeUnlocked = async (cache: FileCache, end: number) => {
  if (!cache.truncated) return
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

const extendLoadedRange = async (cache: FileCache, end: number) => {
  const operation = (cache.extending || Promise.resolve()).then(() => extendLoadedRangeUnlocked(cache, end))
  cache.extending = operation.catch(() => {})
  await operation
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
      ? `当前已预读 ${cache.total} ${cache.unit}，这是数量下限；按 nextStart 继续会自动加载后续内容。`
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
    hint: `由 Agent 自行选择：read_range 分段识题并每批保存最多 20 道；或先看样本，再 run_file_script 编写脚本/复用模板，核对后 save_questions(result_id)。每段最多 ${batch} ${cache.unit}。默认本地题库，目标按上下文和目录结构自行选择或创建。`,
  }
}

const contentOf = (cache: FileCache, index: number) => cache.kind === 'excel'
  ? (cache.rows?.[index] || []).join('\t')
  : cache.kind === 'pdf' ? cache.pages?.[index] || ''
    : (cache.kind === 'text' ? cache.lines?.[index] : cache.paragraphs?.[index]) || ''

// 分页只截内容，不截 JSON；超长单段用字符游标续读，不能跳过余文。
export const readLocalFileRange = async (path: string, start: number, end: number, offset = 0) => {
  if (![start, end, offset].every(Number.isSafeInteger) || start < 0 || end < start || offset < 0) {
    throw new Error('start、end、offset 必须是非负整数，且 end 不小于 start')
  }
  const cache = await ensureFileCache(path)
  const requestedEnd = Math.min(end, start + MAX_RANGE[cache.kind] - 1)
  if (cache.kind !== 'pdf' && cache.kind !== 'text') await extendLoadedRange(cache, requestedEnd)
  const last = Math.min(requestedEnd, cache.total - 1)
  if (cache.kind === 'pdf') await fillPdfPages(cache, start, last)
  if (start < cache.total && offset > contentOf(cache, start).length) throw new Error('offset 超出当前段落长度')
  const chunks: string[] = []
  let remaining = 6000, jsonBudget = 10_000, nextStart = start, nextOffset = offset, actualEnd = start - 1
  for (let index = start; index <= last; index++) {
    const text = contentOf(cache, index)
    const from = index === start ? offset : 0
    let count = Math.min(text.length - from, remaining)
    // 控制字符在 JSON 中会膨胀，保证完整回执也能放进模型的工具结果预算。
    if (JSON.stringify(text.slice(from, from + count)).length > jsonBudget) {
      let low = 0, high = count
      while (low < high) {
        const mid = Math.ceil((low + high) / 2)
        if (JSON.stringify(text.slice(from, from + mid)).length <= jsonBudget) low = mid
        else high = mid - 1
      }
      count = low
    }
    const piece = text.slice(from, from + count)
    jsonBudget -= JSON.stringify(piece).length
    chunks.push(piece)
    actualEnd = index
    remaining -= piece.length + 1
    nextStart = index + 1
    nextOffset = 0
    if (from + piece.length < text.length) {
      nextStart = index
      nextOffset = from + piece.length
      break
    }
    if (remaining <= 0 || jsonBudget <= 8) break
  }
  const hasMore = nextStart < cache.total || Boolean(cache.truncated)
  return {
    start, end: actualEnd, offset, total: cache.total, unit: cache.unit,
    content: chunks.join('\n'), truncated: Boolean(cache.truncated), hasMore,
    nextStart: hasMore ? nextStart : null, nextOffset: hasMore ? nextOffset : 0,
    nextHint: hasMore ? `继续 read_range(start=${nextStart}, end=${nextStart + MAX_RANGE[cache.kind] - 1}, offset=${nextOffset})` : '已经读到末尾',
  }
}

// 脚本直接消费宿主提取的原文，不经模型转抄；超限明确报错，绝不把部分文件当作全文。
export const readLocalFileDocument = async (path: string, signal?: AbortSignal) => {
  const cache = await ensureFileCache(path)
  let loaded = 0, characters = 0
  const lines: string[] = []
  while (loaded < cache.total || cache.truncated) {
    signal?.throwIfAborted()
    if (cache.kind === 'pdf') await fillPdfPages(cache, loaded, Math.min(loaded + 99, cache.total - 1))
    else if (cache.kind !== 'text') await extendLoadedRange(cache, loaded + 1999)
    if (cache.total > 20_000) throw new Error('脚本输入超过 20000 个文本单元，请拆分文件或分段导入')
    const stop = Math.min(loaded + (cache.kind === 'pdf' ? 100 : 2000), cache.total)
    for (; loaded < stop; loaded++) {
      const text = contentOf(cache, loaded)
      characters += text.length + 1
      if (characters > 2_000_000) throw new Error('脚本输入超过 200 万字符，请拆分文件或分段导入')
      lines.push(text)
    }
  }
  return { name: fileNameOf(path), type: kindLabel(cache.kind), unit: cache.unit, total: lines.length, lines, text: lines.join('\n'), ...(cache.rows ? { rows: cache.rows } : {}) }
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
      .filter((item) => item.question)
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
