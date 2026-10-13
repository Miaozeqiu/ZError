import { jobsFromHtml as jobsFromCatalog, type CatalogJob } from '../host/catalog'
import { studyParseApi } from '../host/studyHost'

export const legacyJobRow = (job: CatalogJob): Record<string, unknown> => ({
  label: job.label,
  kind: job.kind,
  video: job.video,
  quiz: job.quiz,
  doc: job.doc,
  active: job.active,
  jobDone: job.jobDone,
  done: job.done,
  mid: job.id,
  id: job.id,
  jobid: job.jobid,
})

/** cards 帧 HTML → 任务点行。静态 HTML 走目录读取；读不到再退回宿主 collectSteps。 */
export const jobsFromHtml = (html: string, _frame = ''): Record<string, unknown>[] => {
  const rows = jobsFromCatalog(html)
  if (rows.length) return rows.map(legacyJobRow)
  try {
    const doc = new DOMParser().parseFromString(String(html || ''), 'text/html')
    const live = studyParseApi().collectSteps(doc)
    return Array.isArray(live) ? live as Record<string, unknown>[] : []
  } catch {
    return []
  }
}

export const catalogReadyFromHtml = (html: string, url = '') => {
  const text = String(html || '')
  const catalogLi = (text.match(/posCatalog_select|clicktitle|ncells/gi) || []).length
  return {
    href: url,
    onCatalog: catalogLi > 0 || /coursetree|studentstudy/i.test(url + text.slice(0, 400)),
    hasProgress: /_studystate|unfinishCount|orangeNew/.test(text),
    hasDir: /coursetree|posCatalog/.test(text),
    catalogLi,
  }
}
