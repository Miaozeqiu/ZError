import { AUTH_API_BASE, remoteJson, RemoteApiError } from '../../app/remoteHttp'
import { authToken, authUser } from '../../app/auth'
import { evalBrowserViewMain } from '../../browser/eval'
import questionPage from './questionPage.js?raw'

export type Question = {
  index: number; number: number; subjectType: number; stem: string; type: 'single' | 'multiple' | 'judgement' | 'completion'
  options: { label: string; text: string }[]; blanks: number; actual: string[]; official: string; supported: boolean
}
export type Paper = { key: string; courseId: string; kind: string; stage: string; paperId: string; title: string; declared: number; total: number; scopeTotal: number; ambiguous: boolean; hasNext: boolean; questions: Question[] }
export const pageOp = (id: string, request: object) => evalBrowserViewMain(id, '(' + questionPage + ')(' + JSON.stringify(request) + ')')
export async function readPaper(id: string, offset: number, limit: number, range?: { start: number; end: number }): Promise<Paper> {
  const p = await pageOp(id, { offset, limit, range })
  if (!Array.isArray(p?.questions)) throw new Error(p?.error || '在浙学试卷未就绪。')
  return p
}
// Crosses the Rust JSON bridge, where object key order is not guaranteed.
export const identity = (q: Question) => JSON.stringify([
  q.index, q.number, q.type, q.subjectType, q.stem, q.blanks, q.options.map(o => [o.label, o.text]),
])
const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim()
const plain = (html: unknown) => {
  if (typeof html !== 'string') return ''
  const el = document.createElement('template')
  el.innerHTML = html
  if (el.content.querySelector('img,video,audio')) return ''
  return norm(el.content.textContent || '')
}
const htmlText = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
type Subject = { subjectName: string; subjectType: number; rightAnswer: string; subjectOptions: { optionHead: string; optionContent: string }[] }
export function plan(q: Question, parts: unknown, labels = false): string[] | undefined {
  if (!Array.isArray(parts) || !parts.length || parts.some(p => typeof p !== 'string' || !p.trim() || p.length > 4000)) return
  if (q.type === 'completion') return parts.length === q.blanks ? parts.map(p => p.trim()) : undefined
  const chosen = parts.map(p => {
    const value = norm(p)
    if (q.type === 'judgement' && /^(yes|true|no|false)$/i.test(value)) {
      const correct = /^(yes|true)$/i.test(value)
      return q.options.find(o => (correct ? /^(正确|对)$/ : /^(错误|错)$/).test(o.text))?.label
    }
    return labels ? q.options.find(o => o.label === value)?.label : q.options.find(o => norm(o.text) === value)?.label
  })
  if (chosen.some(p => !p) || new Set(chosen).size !== chosen.length || (q.type !== 'multiple' && chosen.length !== 1)) return
  return q.options.filter(o => chosen.includes(o.label)).map(o => o.label)
}
function completionPlan(q: Question, raw: string) {
  if (!raw.trim().startsWith('[')) return plan(q, [plain(raw)])
  try {
    let blanks
    try { blanks = JSON.parse(raw) } catch { blanks = JSON.parse(raw.replace(/\|/g, ',')) }
    if (Array.isArray(blanks)) return plan(q, blanks.map(b => plain(Array.isArray(b) ? b[0] : b)))
  } catch { /* An unrecognized format needs review. */ }
}
export function officialAnswer(q: Question) {
  if (!q.official) return
  if (q.type === 'completion') return completionPlan(q, q.official)
  const parts = q.official.split(/[,，]/)
  return plan(q, parts, true) ?? (q.type === 'judgement' ? plan(q, parts) : undefined)
}
function resolveSubject(q: Question, item: Subject) {
  if (typeof item.rightAnswer !== 'string') return
  if (q.type === 'completion') {
    return completionPlan(q, item.rightAnswer)
  }
  const parts = item.rightAnswer.split(/[,，]/).map(s => s.trim())
  if (q.type === 'judgement') return plan(q, parts)
  if (!Array.isArray(item.subjectOptions) || item.subjectOptions.some(o => !o || typeof o.optionHead !== 'string') || new Set(item.subjectOptions.map(o => o.optionHead)).size !== q.options.length || item.subjectOptions.length !== q.options.length) return
  const values = item.subjectOptions.map(o => plain(o.optionContent))
  if (new Set(values).size !== values.length || !q.options.every(o => values.includes(norm(o.text)))) return
  return plan(q, parts.map(k => plain(item.subjectOptions.find(o => o.optionHead === k)?.optionContent)))
}
export function serverAnswer(q: Question, subjects: Subject[]) {
  const matches = subjects.filter(s => s && Number(s.subjectType) === q.subjectType && plain(s.subjectName) === norm(q.stem))
  if (matches.length !== 1) return
  return resolveSubject(q, matches[0])
}
const reviews = new Map<string, Subject[]>()
const reviewKey = (p: Paper) => JSON.stringify([authUser.value?.id, p.courseId, p.paperId])
export function reviewedAnswer(p: Paper, q: Question) { return serverAnswer(q, reviews.get(reviewKey(p)) || []) }
const requestOptions = { cache: 'no-store', redirect: 'error', maxRedirections: 0, connectTimeout: 10000 } as const
export async function fetchSubjects(p: Paper, signal?: AbortSignal): Promise<Subject[]> {
  const token = authToken.value
  if (!token) throw new Error('题库需要登录。')
  // The deployed originalJson endpoint validates its token in the query string.
  const query = new URLSearchParams({ id: p.paperId, need_data: 'true', token })
  try {
    const raw = await remoteJson(AUTH_API_BASE + '/originalJson?' + query, { ...requestOptions, signal }, false)
    return String(raw?.data?.id) === p.paperId && String(raw?.data?.courseId) === p.courseId && Array.isArray(raw.data.paperSubjectList)
      ? raw.data.paperSubjectList : []
  } catch (e) { if (e instanceof RemoteApiError && e.status === 404) return []; throw e }
}

const pendingUploads = new Map<string, Promise<boolean>>()

export async function captureReview(browserId: string, expectedUrl: string, active = () => true) {
  const user = authUser.value?.id
  if (!user || !authToken.value) return false
  if (!(await pageOp(browserId, { reviewReady: true }))?.ready || !active()) return false
  const p = await readPaper(browserId, 0, 1000)
  const path = new URL(expectedUrl).pathname.replace(/(?:\/processStatus\/\d+)?\/?$/, '')
  if (p.stage !== 'result' || !path.endsWith('/course/study/' + p.courseId + '/' + p.kind + '/result/' + p.paperId) || !p.questions.length) return false
  const subjects: Subject[] = []
  for (const q of p.questions) {
    if (!q.supported || !q.official) continue
    const answers = officialAnswer(q)
    if (!answers) continue
    subjects.push({ subjectName: htmlText(q.stem), subjectType: q.subjectType,
      subjectOptions: q.options.map(o => ({ optionHead: o.label, optionContent: htmlText(o.text) })),
      rightAnswer: q.type === 'completion' ? JSON.stringify(answers.map(a => [htmlText(a)])) :
        q.type === 'judgement' ? (/^(正确|对)$/.test(q.options.find(o => o.label === answers[0])!.text) ? 'yes' : 'no') : answers.join(',') })
  }
  if (!active() || authUser.value?.id !== user || !subjects.length) return false
  reviews.set(reviewKey(p), subjects)
  if (reviews.size > 32) reviews.delete(reviews.keys().next().value!)
  // /upload stores the first complete copy. A partially rendered review must not occupy that slot.
  if (!p.title || p.declared !== p.total || subjects.length !== p.total) return false
  const key = reviewKey(p)
  const pending = pendingUploads.get(key)
  if (pending) return pending
  const upload = uploadReview(p, subjects, () => active() && authUser.value?.id === user && !!authToken.value)
  pendingUploads.set(key, upload)
  try { return await upload } finally { pendingUploads.delete(key) }
}

async function uploadReview(p: Paper, subjects: Subject[], active: () => boolean) {
  try {
    const status = await remoteJson(AUTH_API_BASE + '/originalJson?' + new URLSearchParams({id: p.paperId, need_data:'false'}), requestOptions)
    if (status.has_original_json === true) return true
  } catch (e) { if (!(e instanceof RemoteApiError && e.status === 404)) throw e }
  if (!active()) return false
  await remoteJson(AUTH_API_BASE + '/upload', { ...requestOptions, method:'POST', body: JSON.stringify({ data: {
    id: p.paperId, courseId: p.courseId, paperType: p.kind === 'homework' ? 2 : 0, paperName: htmlText(p.title), paperSubjectList: subjects,
  } }) })
  return true
}
