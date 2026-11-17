import { parseHtml } from '../../browser/domRead'

export type CatalogChapter = {
  title: string
  id: string
  folder: boolean
  active: boolean
  pending: number
}

export type CatalogJob = {
  label: string
  kind: 'video' | 'quiz' | 'doc'
  id: string
  jobid: string
  done: boolean
  video: boolean
  quiz: boolean
  doc: boolean
  active: boolean
  jobDone: boolean
}

const clean = (value: string) => String(value || '').replace(/\s+/g, ' ').trim()

const kindOf = (box: Element, iframe: Element | null) => {
  const src = iframe?.getAttribute('src') || ''
  const hay = `${src} ${box.className || ''}`
  if (/insertvideo|modules\/video|videoContainer|ans-job-video/.test(hay)) return 'video' as const
  if (/doHomeWork|inserthomework|\/work\/|modules\/work|quiz|exam|ans-job-work|work-module|insertwork/.test(hay)) return 'quiz' as const
  if (/pdf|document|innerbook|insertdoc/.test(hay)) return 'doc' as const
  return ''
}

const jobDone = (box: Element) => {
  const icon = box.querySelector('.ans-job-icon')
  const title = icon?.getAttribute('title') || ''
  const iconClass = icon?.getAttribute('class') || ''
  return /ans-job-finished/.test(String(box.className || ''))
    || /任务点已完成/.test(title)
    || /ans-job-icon-finish|ans-job-done/.test(iconClass)
}

export const chaptersFromDocument = (doc: Document): CatalogChapter[] => {
  const rows = [...doc.querySelectorAll('#coursetree .posCatalog_select, .posCatalog_select')]
  const seen = new Set<Element>()
  const out: CatalogChapter[] = []
  for (const row of rows) {
    if (seen.has(row)) continue
    seen.add(row)
    const nameEl = row.querySelector('.posCatalog_name')
    const title = clean(nameEl?.getAttribute('title') || nameEl?.textContent || row.textContent || '')
    if (!title) continue
    const id = ((row.getAttribute('id') || '').match(/(\d+)/) || [])[1] || ''
    const pending = Number(clean(row.querySelector('.orangeNew')?.textContent || '')) || 0
    out.push({
      title,
      id,
      folder: /\bfirstLayer\b/.test(String(row.className || '')),
      active: /\bposCatalog_active\b/.test(String(row.className || '')),
      pending,
    })
  }
  return out
}

export const jobsFromDocument = (doc: Document): CatalogJob[] => {
  const counts = { video: 0, quiz: 0, doc: 0 }
  const out: CatalogJob[] = []
  for (const box of doc.querySelectorAll('.ans-attach-ct')) {
    const iframe = box.querySelector('iframe')
    const kind = kindOf(box, iframe)
    if (!kind) continue
    counts[kind] += 1
    const src = iframe?.getAttribute('src') || ''
    const mid = iframe?.getAttribute('mid')
      || iframe?.getAttribute('data-mid')
      || ((src.match(/[?&]mid=([^&]+)/) || [])[1] || '')
    const jobid = iframe?.getAttribute('jobid') || iframe?.getAttribute('data-jobid') || ''
    const done = jobDone(box)
    const label = kind === 'video' ? `视频${counts.video}` : kind === 'quiz' ? '测验' : '文档'
    out.push({
      label,
      kind,
      id: mid,
      jobid,
      done,
      video: kind === 'video',
      quiz: kind === 'quiz',
      doc: kind === 'doc',
      active: false,
      jobDone: done,
    })
  }
  return out
}

export const chaptersFromHtml = (html: string): CatalogChapter[] => {
  const doc = parseHtml(html)
  return doc ? chaptersFromDocument(doc) : []
}

export const jobsFromHtml = (html: string): CatalogJob[] => {
  const doc = parseHtml(html)
  return doc ? jobsFromDocument(doc) : []
}
