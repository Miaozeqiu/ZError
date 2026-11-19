import { parseHtml, readFrameHtml } from '../../browser/domRead'
import { chaoxingUrl } from '../../platform/chaoxing/studentCourses'
import { websiteChapterRules, WEBSITE_CHAPTER_KINDS, type WebsiteChapterKind, type WebsiteChapterRules } from '../../browser/websiteChapterRules'
import { runWebsiteScript } from '../../agent/websiteScripts'

export const loadChapterRules = async () =>
  (await runWebsiteScript('chaoxing.com', 'chaoxing', 'chapters', { operation: 'page_rules' }, websiteChapterRules,
    { reuseForMs: 30_000 })).result

const studyPath = /^\/(?:(?:mooc2?-ans)\/)?mycourse\/studentstudy\/?$/i
const cardsPath = /^\/(?:(?:mooc2?-ans)\/)?knowledge\/cards\/?$/i
const directoryPath = /^\/(?:(?:mooc2?-ans)\/)?mycourse\/studentcourse\/?$/i
const digits = /^\d+$/
const safeId = /^[a-z\d_-]{1,100}$/i

function pageIds(url: URL, card = false) {
  const params = new Map([...url.searchParams].map(([key, value]) => [key.toLowerCase(), value]))
  const chapterId = params.get(card ? 'knowledgeid' : 'chapterid') || params.get('knowledgeid') || ''
  const courseId = params.get('courseid') || ''
  const classId = params.get('clazzid') || params.get('classid') || ''
  return [chapterId, courseId, classId].every(value => digits.test(value))
    ? { chapterId, courseKey: `${courseId}:${classId}`, key: `${courseId}:${classId}:${chapterId}` }
    : null
}

export function studentChapterUrl(value: string) {
  const url = chaoxingUrl(value)
  const ids = url && studyPath.test(url.pathname) && pageIds(url)
  return ids && url ? { ...ids, href: url.href } : null
}

export function chapterCardsUrl(value: string) {
  const url = chaoxingUrl(value)
  const ids = url && cardsPath.test(url.pathname) && pageIds(url, true)
  const num = url?.searchParams.get('num')
  return ids && url && num != null && digits.test(num) ? { ...ids, href: url.href, tab: Number(num) + 1 } : null
}

const count = (value: string | null | undefined) => value && digits.test(value.trim()) ? Number(value) : null

export function studentChapterDirectoryUrl(value: string) {
  const url = chaoxingUrl(value)
  if (!url || !directoryPath.test(url.pathname)) return null
  const courseId = url.searchParams.get('courseid') ?? url.searchParams.get('courseId') ?? ''
  const classId = url.searchParams.get('clazzid') ?? url.searchParams.get('clazzId') ?? ''
  return digits.test(courseId) && digits.test(classId) ? `${courseId}:${classId}` : null
}

function remainingTasks(row: Element, rules: WebsiteChapterRules['directory'], completionLabel: string) {
  const task = rules.task ? row.querySelector(rules.task) : row
  const hidden = count(task?.querySelector(rules.hiddenCount)?.getAttribute('value'))
  const badge = count(task?.querySelector(rules.badge)?.textContent)
  const pending = hidden === null ? badge : Math.max(hidden, badge ?? 0)
  return pending ?? (task?.querySelector(rules.completed)?.textContent?.trim() === completionLabel ? 0 : null)
}

export function courseChapterRows(doc: Document, rules: WebsiteChapterRules) {
  const row = rules.directory
  return [...doc.querySelectorAll(row.row)].flatMap(link => {
    const chapterId = link.parentElement?.id.slice(3) || ''
    if (!digits.test(chapterId)) return []
    const name = link.querySelector(row.name)
    const title = (link.parentElement?.getAttribute('title') || name?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    if (!title) return []
    const number = name?.querySelector(row.number)?.textContent?.trim() || ''
    return [{ chapterId, title, number, remaining: remainingTasks(link, row, rules.completionLabel) }]
  })
}

export function chapterRow(element: Element, rules: WebsiteChapterRules) {
  const row = rules.sidebar
  const name = element.querySelector(row.name)
  const title = (name?.getAttribute('title') || name?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160)
  const number = name?.querySelector(row.number)?.textContent?.trim() || ''
  return { title, number, remaining: remainingTasks(element, row, rules.completionLabel) }
}

export function chapterHeader(doc: Document, identity: NonNullable<ReturnType<typeof studentChapterUrl>>, rules: WebsiteChapterRules) {
  const row = doc.getElementById(`cur${identity.chapterId}`)
  if (!row?.matches(rules.sidebar.row) || !row.matches(rules.sidebar.active)) return null
  const source = doc.querySelector(rules.cards)?.getAttribute('src')
  let cards: ReturnType<typeof chapterCardsUrl> = null
  if (source) {
    try { cards = chapterCardsUrl(new URL(source, identity.href).href) } catch { /* malformed frame URL */ }
  }
  const tabs = [...doc.querySelectorAll(rules.tabs)]
  const selected = tabs.findIndex(tab => tab.matches(rules.activeTab)) + 1
  const tab = selected || cards?.tab || 1
  // The iframe may navigate independently of its src attribute. Its live
  // URL is checked against the selected tab when reading the card.
  if (cards?.key !== identity.key) cards = null

  return {
    ...chapterRow(row, rules), tab, cards,
    tabs: tabs.map((item, i) => ({
      tab: i + 1,
      id: item.id.startsWith(rules.tabPrefix) && digits.test(item.id.slice(rules.tabPrefix.length)) && tabs.filter(other => other.id === item.id).length === 1
        && !item.matches(rules.disabledTab) ? item.id : '',
    })),
  }
}

export async function readStudentChapter(browserId: string, pinnedRules?: WebsiteChapterRules) {
  const main = await readFrameHtml(browserId)
  const identity = studentChapterUrl(main.url)
  const doc = main.ok && parseHtml(main.html)
  if (!doc || !identity) return null
  const rules = pinnedRules ?? await loadChapterRules().catch(() => null)
  const header = rules && chapterHeader(doc, identity, rules)
  return header && rules ? { identity, header, rules, frameId: main.frameId, loaderId: main.loaderId } : null
}

export function chapterAttachments(doc: Document, rules: WebsiteChapterRules) {
  const body = doc.querySelector(rules.body)
  if (!body) return null
  return [...body.querySelectorAll(rules.jobIcon)].map(icon => {
    const box = icon.closest(rules.jobContainer)
    const iframe = box && [...box.querySelectorAll('iframe')].find(el => el.closest(rules.jobContainer) === box)
    return { icon, box, iframe }
  })
}

export function chapterCardJobs(
  attachments: NonNullable<ReturnType<typeof chapterAttachments>>, rules: WebsiteChapterRules, kinds: WebsiteChapterKind[],
) {
  return attachments.map(({ icon, box, iframe }, index) => {
    let data: Record<string, unknown> = {}
    try { data = JSON.parse(iframe?.getAttribute('data') || '{}') || {} } catch { /* attachment without metadata */ }
    const mid = iframe?.getAttribute('mid') || iframe?.getAttribute('data-mid') || String(data.mid || '')
    const kind = kinds[index] ?? 'unknown'
    const name = String(data.name || data.title || iframe?.title || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const done = Boolean(icon.matches(rules.jobDoneIcon)
      || box?.matches(rules.jobDoneBox)
      || [icon.getAttribute('title'), icon.getAttribute('aria-label')].includes(rules.jobDoneLabel))
    const attrs = ['jobid', 'data-jobid', 'objectid'] as const
    const attr = attrs.find(key => safeId.test(iframe?.getAttribute(key) || ''))
    const discussionId = kind === 'discussion' && safeId.test(mid) ? mid : undefined
    const selector = attr ? `iframe[${attr}="${iframe?.getAttribute(attr)}"]`
      : discussionId ? `iframe[src*="/insertbbs/"][_src*="mtopicid=${discussionId}&"]` : ''
    const quizJobId = kind === 'quiz' ? iframe?.getAttribute('jobid') || iframe?.getAttribute('data-jobid') || data._jobid : null
    const focusRequired = iframe?.getAttribute('switchwindow') === 'true'
    return { index, kind, done, name, focusRequired, mid: safeId.test(mid) ? mid : '', selector,
      quizJobId: typeof quizJobId === 'string' && safeId.test(quizJobId) ? quizJobId : undefined, discussionId }
  })
}

export async function readStudentChapterCard(browserId: string) {
  const state = await readStudentChapter(browserId)
  if (!state) return null
  const desired = state.header.cards
  const cards = desired && await readFrameHtml(browserId, state.rules.cardTarget)
  const cardUrl = cards && chapterCardsUrl(cards.url)
  const doc = cards?.ok && cardUrl?.key === state.identity.key && cardUrl.tab === state.header.tab
    ? parseHtml(cards.html) : null
  const attachments = doc && chapterAttachments(doc, state.rules)
  const sources = attachments?.map(attachment => (attachment.iframe?.getAttribute('src') || '').slice(0, 2048))
  const kinds = sources && await runWebsiteScript('chaoxing.com', 'chaoxing', 'chapters', {
    operation: 'classify_jobs', sources,
  }, value => {
    if (!Array.isArray(value) || value.length !== sources.length || value.some(kind => !WEBSITE_CHAPTER_KINDS.includes(kind))) {
      throw new Error('章节脚本返回了无效任务类型。')
    }
    return value as WebsiteChapterKind[]
  }, { reuseForMs: 30_000 }).catch(() => null)
  const jobs = attachments && kinds ? chapterCardJobs(attachments, state.rules, kinds.result) : null
  return { ...state, jobs, cards: cards && doc ? cards : null }
}

export const sameStudentChapterPage = (a: Awaited<ReturnType<typeof readStudentChapter>>, b: NonNullable<Awaited<ReturnType<typeof readStudentChapter>>>) =>
  a && a.identity.href === b.identity.href && a.frameId === b.frameId && a.header.tab === b.header.tab
  && (!a.loaderId || !b.loaderId || a.loaderId === b.loaderId)

// Documents and quizzes may need to enter the viewport before Chaoxing loads
// their content. Scroll the uniquely identified attachment in this cards page.
export function revealChapterJob(href: string, selector: string, rules: WebsiteChapterRules) {
  return `(function(){
    if (location.href !== ${JSON.stringify(href)}) return false;
    const matches = document.querySelectorAll(${JSON.stringify(selector)});
    if (matches.length !== 1 || !matches[0].closest(${JSON.stringify(rules.jobContainer)})?.querySelector(${JSON.stringify(rules.jobIcon)})) return false;
    matches[0].scrollIntoView({block: 'center'});
    return true;
  })()`
}
