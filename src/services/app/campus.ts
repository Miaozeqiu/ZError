import { CAMPUS_API_BASE, pickField, remoteJson, remoteUpload } from './remoteHttp'

export interface CampusSchool {
  id: number
  name: string
  question_count?: number
}

export interface CampusIdentity {
  campus: CampusSchool | null
  status?: string
  is_trusted?: boolean
  enrollment_year?: number | null
  is_reviewer?: boolean
  class_id?: number | null
  class_name?: string | null
  avatar?: string | null
}

export interface CampusCourse {
  id: number
  name: string
  image?: string
  campus_id?: number
  status?: string
  folder_count?: number
  question_count?: number
}

export interface CampusTag {
  id: number
  name: string
}

export interface CampusFolder {
  id: number
  name: string
  year?: number | null
  tag_id?: number | null
  tag_name?: string | null
  question_count?: number
  archived?: boolean
}

export interface CampusQuestion {
  id: number
  type: string
  content: string
  options: string
  answer: string
  parent_id?: number | null
  question_bank_id?: number | null
}

export interface CampusCourseDetail {
  course: CampusCourse
  folders: CampusFolder[]
  questions: CampusQuestion[]
}

const asNumber = (value: unknown) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

const asOptionalCount = (raw: any, ...keys: string[]) => {
  const value = pickField(raw, ...keys)
  if (value == null || value === '') return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

const asText = (value: unknown) => String(value ?? '').trim()

const normalizeSchool = (raw: any): CampusSchool | null => {
  const id = asNumber(pickField(raw, 'id', 'ID'))
  const name = asText(pickField(raw, 'name', 'Name'))
  if (!id || !name) return null
  return {
    id,
    name,
    question_count: asNumber(pickField(raw, 'question_count', 'QuestionCount')),
  }
}

const normalizeCourse = (raw: any): CampusCourse | null => {
  const id = asNumber(pickField(raw, 'id', 'ID'))
  const name = asText(pickField(raw, 'name', 'Name'))
  if (!id || !name) return null
  return {
    id,
    name,
    image: asText(pickField(raw, 'image', 'Image')) || undefined,
    campus_id: asNumber(pickField(raw, 'campus_id', 'CampusID', 'campusId')) || undefined,
    status: asText(pickField(raw, 'status', 'Status')) || undefined,
    folder_count: asOptionalCount(raw, 'folder_count', 'FolderCount'),
    question_count: asOptionalCount(raw, 'question_count', 'QuestionCount'),
  }
}

const normalizeTag = (raw: any): CampusTag | null => {
  const id = asNumber(pickField(raw, 'id', 'ID'))
  const name = asText(pickField(raw, 'name', 'Name'))
  if (!id || !name) return null
  return { id, name }
}

const normalizeFolder = (raw: any): CampusFolder | null => {
  const id = asNumber(pickField(raw, 'id', 'ID'))
  const name = asText(pickField(raw, 'name', 'Name'))
  if (!id || !name) return null
  const tag = pickField<any>(raw, 'tag', 'Tag')
  const tagName = asText(pickField(raw, 'tag_name', 'TagName')) || asText(pickField(tag, 'name', 'Name'))
  return {
    id,
    name,
    year: asNumber(pickField(raw, 'year', 'Year')) || null,
    tag_id: asNumber(pickField(raw, 'tag_id', 'TagID', 'tagId')) || asNumber(pickField(tag, 'id', 'ID')) || null,
    tag_name: tagName || null,
    question_count: asOptionalCount(raw, 'question_count', 'QuestionCount'),
    archived: Boolean(pickField(raw, 'archived', 'Archived', 'is_archived')),
  }
}

export const campusQuestionTypeLabel = (type?: string) => {
  const map: Record<string, string> = {
    single_choice: '单选',
    multiple_choice: '多选',
    true_false: '判断',
    fill_blank: '填空',
    short_answer: '简答',
    essay: '论述',
    calculation: '计算',
    definition: '名词解释',
    listening: '听力',
    cloze: '完形',
    reading: '阅读',
  }
  return map[String(type || '')] || type || '题目'
}

const optionText = (item: unknown): string => {
  if (item == null) return ''
  if (typeof item === 'string' || typeof item === 'number') return String(item).trim()
  if (typeof item === 'object') {
    const record = item as Record<string, unknown>
    for (const key of ['Content', 'content', 'text', 'Text', 'label', 'Label', 'value', 'Value']) {
      const value = record[key]
      if (value != null && String(value).trim()) return String(value).trim()
    }
  }
  return ''
}

const stripOptionLetter = (text: string) => {
  const match = String(text || '').trim().match(/^([A-Ha-h])(?:[\.、.)]|\s)\s*(.*)$/)
  return match ? match[2].trim() : String(text || '').trim()
}

const linesFromCampusOptions = (raw?: unknown): string[] => {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw.map(optionText).filter(Boolean)
  if (typeof raw === 'object') {
    const record = raw as Record<string, unknown>
    const keyed = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']
      .map((key) => optionText(record[key] ?? record[key.toLowerCase()]))
      .filter(Boolean)
    if (keyed.length) return keyed
    const values = Object.values(record).map(optionText).filter(Boolean)
    if (values.length) return values
  }
  const text = String(raw).trim()
  if (!text) return []
  if (text.startsWith('[') || text.startsWith('{')) {
    try {
      return linesFromCampusOptions(JSON.parse(text))
    } catch {
      // fall through
    }
  }
  if (text.includes('\n')) return text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const inline = text.split(/\s+(?=[A-Ha-h](?:[\.、.)]|\s)\s*)/).map((line) => line.trim()).filter(Boolean)
  if (inline.length > 1) return inline
  return [text]
}

export function parseCampusOptions(raw?: unknown): string[] {
  return linesFromCampusOptions(raw).map(stripOptionLetter).filter(Boolean)
}

export function formatCampusOptions(raw?: unknown): string {
  return parseCampusOptions(raw)
    .map((text, index) => `${String.fromCharCode(65 + index)}. ${text}`)
    .join('\n')
}

export function campusOptionRows(raw?: unknown): Array<{ key: string; text: string }> {
  return parseCampusOptions(raw).map((text, index) => ({
    key: String.fromCharCode(65 + index),
    text,
  }))
}

const CAMPUS_QUESTION_TYPES = new Set([
  'single_choice',
  'multiple_choice',
  'true_false',
  'fill_blank',
  'short_answer',
  'essay',
  'calculation',
  'definition',
  'listening',
  'cloze',
  'reading',
])

export function campusApiType(type?: string, options?: unknown): string {
  const text = String(type || '').trim()
  if (CAMPUS_QUESTION_TYPES.has(text)) return text
  const compact = text.replace(/\s/g, '')
  if (/多选|多项|multiple/i.test(compact)) return 'multiple_choice'
  if (/判断|对错|true_false/i.test(compact)) return 'true_false'
  if (/填空|fill/i.test(compact)) return 'fill_blank'
  if (/简答|short/i.test(compact)) return 'short_answer'
  if (/论述|essay/i.test(compact)) return 'essay'
  if (/计算|calculation/i.test(compact)) return 'calculation'
  if (/名词|definition/i.test(compact)) return 'definition'
  if (/听力|listening/i.test(compact)) return 'listening'
  if (/完形|cloze/i.test(compact)) return 'cloze'
  if (/阅读|reading/i.test(compact)) return 'reading'
  if (/单选|single|选择/.test(compact)) return 'single_choice'
  return parseCampusOptions(options).length ? 'single_choice' : 'short_answer'
}

export function encodeCampusOptions(raw?: unknown): string {
  const lines = parseCampusOptions(raw)
  if (lines.length) return JSON.stringify(lines)
  const text = String(raw ?? '').trim()
  if (text.startsWith('[')) return text
  return ''
}

export function encodeCampusAnswer(answer: string, options?: unknown, type?: string): string {
  const kind = campusApiType(type, options)
  const text = String(answer || '').trim()
  if (!text) return ''
  if (kind === 'true_false') {
    if (/^(正确|对|true|t|yes|y|√|1)$/i.test(text)) return 'T'
    if (/^(错误|错|false|f|no|n|×|0)$/i.test(text)) return 'F'
    const upper = text.toUpperCase()
    return upper === 'T' || upper === 'F' ? upper : text
  }
  if (kind === 'single_choice' || kind === 'multiple_choice') {
    const rows = campusOptionRows(options)
    const tokens = /^[A-Ha-h]{2,}$/.test(text.replace(/[\s,，、;；]/g, ''))
      ? text.replace(/[\s,，、;；]/g, '').toUpperCase().split('')
      : text.split(/[,，、;；\s]+/).map((part) => part.trim()).filter(Boolean)
    const keys: string[] = []
    for (const part of tokens.length ? tokens : [text]) {
      const letter = part.match(/^([A-Ha-h])(?:[\.、.)]|\s|$)/)
      if (letter) {
        keys.push(letter[1].toUpperCase())
        continue
      }
      const hit = rows.find((row) => row.text === part || row.text.includes(part) || part.includes(row.text))
      if (hit) keys.push(hit.key)
    }
    if (keys.length) {
      const unique = [...new Set(keys)]
      return kind === 'multiple_choice' ? unique.sort().join('') : unique[0]
    }
  }
  return text
}

export function normalizeCampusQuestion(raw: any): CampusQuestion | null {
  const id = asNumber(pickField(raw, 'id', 'ID'))
  const content = asText(pickField(raw, 'content', 'Content', 'title', 'Title'))
  if (!id) return null
  return {
    id,
    type: asText(pickField(raw, 'type', 'Type')) || 'short_answer',
    content: content || `题目 ${id}`,
    options: (() => {
      const value = pickField(raw, 'options', 'Options')
      if (Array.isArray(value) || (value && typeof value === 'object')) return JSON.stringify(value)
      return asText(value)
    })(),
    answer: asText(pickField(raw, 'answer', 'Answer')),
    parent_id: asNumber(pickField(raw, 'parent_id', 'ParentID')) || null,
    question_bank_id: asNumber(pickField(raw, 'question_bank_id', 'QuestionBankID')) || null,
  }
}

const unwrapList = (raw: any): any[] => {
  if (Array.isArray(raw)) return raw
  if (!raw || typeof raw !== 'object') return []
  for (const key of ['data', 'courses', 'folders', 'questions', 'items', 'results', 'campuses', 'tags']) {
    if (Array.isArray(raw[key])) return raw[key]
  }
  return []
}

export function campusImageUrl(image?: string | null) {
  const value = asText(image)
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  return `${CAMPUS_API_BASE}/images/${value.replace(/^\/+/, '')}`
}

export async function listCampusSchools() {
  const raw = await remoteJson(`${CAMPUS_API_BASE}/campuses`, {}, false)
  return unwrapList(raw).map(normalizeSchool).filter(Boolean) as CampusSchool[]
}

export async function listCampusTags() {
  const raw = await remoteJson(`${CAMPUS_API_BASE}/tags`, {}, false)
  return unwrapList(raw).map(normalizeTag).filter(Boolean) as CampusTag[]
}

export function campusAvatarUrl(avatar?: string | null) {
  const value = asText(avatar)
  if (!value) return ''
  if (value.startsWith('http://') || value.startsWith('https://')) return value
  const name = value.replace(/^\/+/, '').replace(/^images\//, '')
  return `${CAMPUS_API_BASE}/images/${name}`
}

export async function getUserCampus(userId?: number): Promise<CampusIdentity> {
  const raw = await remoteJson(`${CAMPUS_API_BASE}/user/campus`)
  const campus = normalizeSchool(raw?.campus)
  const year = asNumber(raw?.enrollment_year)
  const reviewers = unwrapList(raw?.reviewers)
  const fromReviewer = reviewers.find((item) => asNumber(pickField(item, 'id', 'ID')) === userId)
  return {
    campus,
    status: asText(raw?.status) || undefined,
    is_trusted: Boolean(raw?.is_trusted),
    enrollment_year: year || null,
    is_reviewer: Boolean(raw?.is_reviewer),
    class_id: asNumber(raw?.class_id) || null,
    class_name: asText(pickField(raw?.class, 'Name', 'name')) || null,
    avatar: asText(raw?.avatar) || asText(pickField(fromReviewer, 'avatar', 'Avatar')) || null,
  }
}

export async function uploadCampusAvatar(file: File) {
  const raw = await remoteUpload(`${CAMPUS_API_BASE}/user/reviewer/avatar`, file, 'image')
  const avatar = asText(pickField(raw, 'avatar', 'Avatar'))
  if (!avatar) throw new Error('上传成功但没有返回头像')
  return avatar
}

export async function bindCampus(campusId: number) {
  return remoteJson(`${CAMPUS_API_BASE}/bind-campus`, {
    method: 'POST',
    body: JSON.stringify({ campus_id: campusId }),
  })
}

export async function setEnrollmentYear(year: number) {
  return remoteJson(`${CAMPUS_API_BASE}/user/enrollment-year`, {
    method: 'POST',
    body: JSON.stringify({ enrollment_year: year }),
  })
}

export async function listCampusCourses(campusId: number, name = '') {
  const query = name.trim() ? `?name=${encodeURIComponent(name.trim())}` : ''
  const raw = await remoteJson(`${CAMPUS_API_BASE}/campus/${campusId}/courses${query}`)
  return unwrapList(raw).map(normalizeCourse).filter(Boolean) as CampusCourse[]
}

export async function getCampusCourse(courseId: number): Promise<CampusCourseDetail> {
  const raw = await remoteJson(`${CAMPUS_API_BASE}/courses/${courseId}`)
  const courseRaw = raw?.course || raw?.Course || raw
  const course = normalizeCourse(courseRaw)
  if (!course) throw new Error('课程不存在')
  const folders = unwrapList(raw?.folders || raw?.Folders || courseRaw?.folders || courseRaw?.Folders)
    .map(normalizeFolder)
    .filter(Boolean) as CampusFolder[]
  const questions = unwrapList(raw?.questions || raw?.Questions || courseRaw?.questions)
    .map(normalizeCampusQuestion)
    .filter(Boolean) as CampusQuestion[]
  return { course, folders, questions }
}

export async function listFolderQuestions(folderId: number) {
  const raw = await remoteJson(`${CAMPUS_API_BASE}/folders/${folderId}/questions`)
  return unwrapList(raw).map(normalizeCampusQuestion).filter(Boolean) as CampusQuestion[]
}

export async function withFolderQuestionCounts(folders: CampusFolder[]) {
  return Promise.all(folders.map(async (folder) => {
    if (folder.question_count != null) return folder
    try {
      const questions = await listFolderQuestions(folder.id)
      return { ...folder, question_count: questions.length }
    } catch {
      return folder
    }
  }))
}

export async function listUncategorizedQuestions(courseId: number, page = 1, pageSize = 50) {
  const raw = await remoteJson(`${CAMPUS_API_BASE}/courses/${courseId}/questions?page=${page}&page_size=${pageSize}`)
  return unwrapList(raw).map(normalizeCampusQuestion).filter(Boolean) as CampusQuestion[]
}

export async function searchCampusQuestions(query: string, page = 1, pageSize = 30) {
  const q = query.trim()
  if (!q) return []
  const raw = await remoteJson(`${CAMPUS_API_BASE}/search?q=${encodeURIComponent(q)}&page=${page}&page_size=${pageSize}`)
  return unwrapList(raw).map(normalizeCampusQuestion).filter(Boolean) as CampusQuestion[]
}

export function enrollmentYearOptions(now = new Date().getFullYear()) {
  const years: number[] = []
  for (let year = now; year >= 2000; year -= 1) years.push(year)
  return years
}

export async function createCampusPaper(courseId: number, name: string, tagId?: number) {
  const raw = await remoteJson(`${CAMPUS_API_BASE}/courses/${courseId}/folders`, {
    method: 'POST',
    body: JSON.stringify({
      name,
      ...(tagId ? { tag_id: tagId } : {}),
    }),
  })
  const folder = normalizeFolder(raw)
  if (!folder) throw new Error('创建试卷失败')
  return folder
}

export async function updateCampusPaper(folderId: number, input: { name: string; tag_id?: number; year?: string }) {
  const raw = await remoteJson(`${CAMPUS_API_BASE}/folders/${folderId}`, {
    method: 'PUT',
    body: JSON.stringify({
      name: input.name,
      ...(input.tag_id != null ? { tag_id: input.tag_id } : {}),
      ...(input.year != null ? { year: input.year } : {}),
    }),
  })
  return normalizeFolder(pickField(raw, 'folder', 'Folder') || raw) || { id: folderId, name: input.name }
}

export async function createCampusQuestion(courseId: number, input: {
  type: string
  content: string
  options?: string
  answer: string
  question_bank_id?: number
  add_to_top?: boolean
}) {
  const raw = await remoteJson(`${CAMPUS_API_BASE}/courses/${courseId}/questions`, {
    method: 'POST',
    body: JSON.stringify({
      type: input.type,
      content: input.content,
      options: input.options || '',
      answer: input.answer,
      ...(input.question_bank_id ? { question_bank_id: input.question_bank_id } : {}),
      add_to_top: input.add_to_top !== false,
    }),
  })
  const question = normalizeCampusQuestion(raw)
  if (!question) throw new Error('上传题目失败')
  return question
}

export async function updateCampusQuestion(id: number, input: {
  type?: string
  content?: string
  options?: string
  answer?: string
  question_bank_id?: number
}) {
  const body: Record<string, unknown> = {}
  if (input.type) body.type = input.type
  if (input.content) body.content = input.content
  if (input.options) body.options = input.options
  if (input.answer) body.answer = input.answer
  if (input.question_bank_id) body.question_bank_id = input.question_bank_id
  const raw = await remoteJson(`${CAMPUS_API_BASE}/questions/${id}`, {
    method: 'PUT',
    body: JSON.stringify(body),
  })
  return normalizeCampusQuestion(raw)
}
