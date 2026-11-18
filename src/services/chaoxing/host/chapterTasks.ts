import { parseHtml, readFrameHtml } from '../../browser/domRead'
import { chaoxingUrl } from '../../platform/chaoxing/studentCourses'

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

export function courseChapterRows(doc: Document) {
  return [...doc.querySelectorAll('.chapter_item[id^="cur"] > .catalog_title[role="link"]')].flatMap(link => {
    const chapterId = link.parentElement?.id.slice(3) || ''
    if (!digits.test(chapterId)) return []
    const name = link.querySelector('.catalog_name')
    const title = (link.parentElement?.getAttribute('title') || name?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160)
    if (!title) return []
    const number = name?.querySelector('.catalog_sbar')?.textContent?.trim() || ''
    const task = link.querySelector('.catalog_task')
    const hidden = count(task?.querySelector('.knowledgeJobCount')?.getAttribute('value'))
    const badge = count(task?.querySelector('.catalog_points_yi')?.textContent)
    const pending = hidden === null ? badge : Math.max(hidden, badge ?? 0)
    const complete = task?.querySelector('.icon_yiwanc')?.textContent?.trim() === '已完成'
    return [{ chapterId, title, number, remaining: pending ?? (complete ? 0 : null) }]
  })
}

export function chapterRow(row: Element) {
  const name = row.querySelector('.posCatalog_name')
  const title = (name?.getAttribute('title') || name?.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160)
  const number = name?.querySelector('.posCatalog_sbar')?.textContent?.trim() || ''
  const hidden = count(row.querySelector('.jobUnfinishCount')?.getAttribute('value'))
  const badge = count(row.querySelector('.orangeNew')?.textContent)
  const pending = hidden === null ? badge : Math.max(hidden, badge ?? 0)
  const complete = row.querySelector('.icon_Completed')?.textContent?.trim() === '已完成'
  return { title, number, remaining: pending ?? (complete ? 0 : null) }
}

export function chapterHeader(doc: Document, identity: NonNullable<ReturnType<typeof studentChapterUrl>>) {
  const row = doc.querySelector(`.posCatalog_select.posCatalog_active[id="cur${identity.chapterId}"]`)
  if (!row) return null
  const source = doc.querySelector('iframe[info="card"], iframe#iframe')?.getAttribute('src')
  let cards: ReturnType<typeof chapterCardsUrl> = null
  if (source) {
    try { cards = chapterCardsUrl(new URL(source, identity.href).href) } catch { /* malformed frame URL */ }
  }
  const tabs = [...doc.querySelectorAll('#prev_tab .prev_ul > li[cardid]')]
  const selected = tabs.findIndex(tab => tab.classList.contains('active')) + 1
  const tab = selected || cards?.tab || 1
  // The iframe may navigate independently of its src attribute. Its live
  // URL is checked against the selected tab when reading the card.
  if (cards?.key !== identity.key) cards = null

  return {
    ...chapterRow(row), tab, cards,
    tabs: tabs.map((item, i) => ({
      tab: i + 1,
      id: /^dct\d+$/.test(item.id) && tabs.filter(other => other.id === item.id).length === 1
        && !item.matches('.disabled, [aria-disabled="true"]') ? item.id : '',
    })),
  }
}

export async function readStudentChapter(browserId: string) {
  const main = await readFrameHtml(browserId)
  const identity = studentChapterUrl(main.url)
  const doc = main.ok && parseHtml(main.html)
  const header = doc && identity && chapterHeader(doc, identity)
  return header && identity ? { identity, header, frameId: main.frameId, loaderId: main.loaderId } : null
}

type JobKind = 'video' | 'quiz' | 'document' | 'discussion' | 'unknown'
const attachmentKind = (path: string): JobKind => {
  if (/\/(?:insertvideo|insertaudio|modules\/(?:video|audio))\b/i.test(path)) return 'video'
  if (/\/(?:insertwork|inserthomework|work|modules\/(?:work|quiz))\b/i.test(path)) return 'quiz'
  if (/\/ananas\/modules\/insertbbs\//i.test(path)) return 'discussion'
  if (/\/(?:insertdoc|insertbook|readsvr\/book\/mooc|modules\/(?:pdf|document|innerbook|book|ppt|doc|read))\b/i.test(path)) return 'document'
  return 'unknown'
}

export function chapterCardJobs(doc: Document) {
  const body = doc.querySelector('#pageDiv.ans-cc, .ans-cc')
  if (!body) return null
  return [...body.querySelectorAll('.ans-job-icon')].map((icon, index) => {
    const box = icon.closest('.ans-attach-ct')
    const iframe = box && [...box.querySelectorAll('iframe')].find(el => el.closest('.ans-attach-ct') === box)
    let data: Record<string, unknown> = {}
    try { data = JSON.parse(iframe?.getAttribute('data') || '{}') || {} } catch { /* attachment without metadata */ }
    const mid = iframe?.getAttribute('mid') || iframe?.getAttribute('data-mid') || String(data.mid || '')
    const kind = attachmentKind(iframe?.getAttribute('src') || '')
    const name = String(data.name || data.title || iframe?.title || '').replace(/\s+/g, ' ').trim().slice(0, 120)
    const done = Boolean(icon.matches('.ans-job-icon-finish, .ans-job-icon-finished, .ans-job-done')
      || box?.classList.contains('ans-job-finished')
      || [icon.getAttribute('title'), icon.getAttribute('aria-label')].includes('任务点已完成'))
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
  const cards = desired && await readFrameHtml(browserId, 'knowledge/cards')
  const cardUrl = cards && chapterCardsUrl(cards.url)
  const doc = cards?.ok && cardUrl?.key === state.identity.key && cardUrl.tab === state.header.tab
    ? parseHtml(cards.html) : null
  const jobs = doc ? chapterCardJobs(doc) : null
  return { ...state, jobs, cards: cards && doc ? cards : null }
}

export const sameStudentChapterPage = (a: Awaited<ReturnType<typeof readStudentChapter>>, b: NonNullable<Awaited<ReturnType<typeof readStudentChapter>>>) =>
  a && a.identity.href === b.identity.href && a.frameId === b.frameId && a.header.tab === b.header.tab
  && (!a.loaderId || !b.loaderId || a.loaderId === b.loaderId)

// Documents and quizzes may need to enter the viewport before Chaoxing loads
// their content. Scroll the uniquely identified attachment in this cards page.
export function revealChapterJob(href: string, selector: string) {
  return `(function(){
    if (location.href !== ${JSON.stringify(href)}) return false;
    const matches = document.querySelectorAll(${JSON.stringify(selector)});
    if (matches.length !== 1 || !matches[0].closest('.ans-attach-ct')?.querySelector('.ans-job-icon')) return false;
    matches[0].scrollIntoView({block: 'center'});
    return true;
  })()`
}
