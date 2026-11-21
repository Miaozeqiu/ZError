import { shallowReactive } from 'vue'
import { peekAppBrowserUrl } from '../../browser/appBrowser'

/** Display/context data supplied by a verified package; it never grants an operation. */
export type WebsitePanel = {
  event?: string; current?: string; jobLine?: string; leftJobs?: string[]; doneJobs?: string[]; hint?: string
  unfinishedSections?: string[]; unfinishedCount?: number
  thisSection?: { title?: string; next?: { label?: string; kind?: string } | null }
  chapters?: Array<{ title: string; unfinished?: boolean; active?: boolean }>
}
type Observation = { sessionId: string; rootUrl: string; at: number; panel: WebsitePanel }
const snapshots = new Map<string, Observation>()
export function publishWebsiteObservation(browserId: string, sessionId: string, rootUrl: string, json: string) {
  if (new TextEncoder().encode(json).length > 8192) throw new Error('页面状态超过限制')
  const raw = JSON.parse(json)
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('页面状态格式无效')
  const panel: WebsitePanel = {}
  for (const key of ['event', 'current', 'jobLine', 'hint'] as const) {
    if (raw[key] !== undefined) { if (typeof raw[key] !== 'string') throw new Error('页面状态字段无效'); panel[key] = raw[key].slice(0, 2000) }
  }
  for (const key of ['leftJobs', 'doneJobs', 'unfinishedSections'] as const) {
    if (raw[key] !== undefined) {
      if (!Array.isArray(raw[key]) || raw[key].length > 40 || raw[key].some((v: unknown) => typeof v !== 'string')) throw new Error('页面状态条目无效')
      panel[key] = raw[key].map((v: string) => v.slice(0, 160))
    }
  }
  if (raw.unfinishedCount !== undefined) {
    if (!Number.isSafeInteger(raw.unfinishedCount) || raw.unfinishedCount < 0) throw new Error('页面计数无效')
    panel.unfinishedCount = raw.unfinishedCount
  }
  if (raw.thisSection !== undefined) {
    const row = raw.thisSection
    if (!row || typeof row !== 'object' || typeof row.title !== 'string') throw new Error('当前条目无效')
    panel.thisSection = { title: row.title.slice(0,160) }
    if (row.next != null) {
      if (typeof row.next.label !== 'string' || typeof row.next.kind !== 'string') throw new Error('待完成条目无效')
      panel.thisSection.next = { label: row.next.label.slice(0,160), kind: row.next.kind.slice(0,40) }
    }
  }
  if (raw.chapters !== undefined) {
    if (!Array.isArray(raw.chapters) || raw.chapters.length > 40) throw new Error('页面目录无效')
    panel.chapters = raw.chapters.map((row: Record<string, unknown>) => {
      if (!row || typeof row.title !== 'string' || row.unfinished !== undefined && typeof row.unfinished !== 'boolean' || row.active !== undefined && typeof row.active !== 'boolean') throw new Error('页面目录条目无效')
      return { title: row.title.slice(0,160), unfinished: row.unfinished as boolean | undefined, active: row.active as boolean | undefined }
    })
  }
  snapshots.delete(browserId)
  if (snapshots.size >= 128) snapshots.delete(snapshots.keys().next().value!)
  snapshots.set(browserId, { sessionId, rootUrl, at: Date.now(), panel })
}
type QuestionPublication = { sessionId: string; assignmentId: string; url: string; at: number }
const questionPublications = shallowReactive(new Map<string, QuestionPublication>())
export function publishWebsiteQuestions(browserId: string, sessionId: string, url: string, assignmentId: string) {
  questionPublications.delete(browserId)
  if (questionPublications.size >= 128) questionPublications.delete(questionPublications.keys().next().value!)
  questionPublications.set(browserId, {sessionId,assignmentId,url,at:Date.now()})
}
export function currentWebsiteQuestions(browserId: string, sessionId: string, url: string) {
  const row = questionPublications.get(browserId)
  return row?.sessionId === sessionId && row.url === url && Date.now() - row.at <= 15000 ? row.assignmentId : undefined
}
export function clearWebsiteObservation(browserId: string) { snapshots.delete(browserId); questionPublications.delete(browserId) }
export function websiteObservation(browserId: string, sessionId?: string) {
  const row = snapshots.get(browserId)
  if (!row || sessionId && row.sessionId !== sessionId || Date.now() - row.at > 15000 || peekAppBrowserUrl(browserId) !== row.rootUrl) { snapshots.delete(browserId); return null }
  return row.panel
}
export function browserChapterContext(sessionId: string, browserId: string, _url: string) {
  const panel = websiteObservation(browserId, sessionId)
  return panel ? `【网站实时状态（仓库解析）】${JSON.stringify(panel)}` : ''
}
