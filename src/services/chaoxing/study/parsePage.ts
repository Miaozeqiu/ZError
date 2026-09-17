import { createPageDocument } from '../../browser/pageDom'
import { studyParseApi } from '../../parser/studyRuntime'
import type { ChaoxingChapterSnap } from './types'

type StudyScan = ChaoxingChapterSnap & { score?: number }

const hintOf = (snap: StudyScan, href: string) => {
  const left = Number(snap.unfinishedCount) || 0
  const first = (snap.unfinished && snap.unfinished[0]) || snap.firstUnfinished || snap.current || ''
  const short = String(first).replace(/^\d+(?:\.\d+)+\s*/, '').trim() || first
  const onPlayer = snap.page === 'player' || /studentstudy/i.test(href)
  if (left > 0) {
    return onPlayer || snap.onUnfinished
      ? `已在播放页「${snap.current || first || ''}」。立刻 browser_study_play，禁止 get_page / eval / 再点章节。`
      : `未完成第一节点「${short}」（不要带 1.1）。进 studentstudy 后立刻 browser_study_play，不要 get_page / eval。`
  }
  return snap.progress
    ? `已完成任务点 ${snap.progress.done}/${snap.progress.total}。`
    : '没有读到未完成章节。'
}

export const scanStudyDocument = (doc: Document, href = '') => {
  const url = (() => {
    try { return new URL(href || 'https://mooc1.chaoxing.com/') } catch {
      return new URL('https://mooc1.chaoxing.com/')
    }
  })()
  return studyParseApi().__zeScanOne({
    location: { href: url.href, pathname: url.pathname, host: url.host },
    document: doc,
  })
}

/** CDP 取回的 HTML 在本地跑目录解析，不注入刷课页。 */
export const cardFromStudyHtml = (raw: Record<string, unknown>): ChaoxingChapterSnap | null => {
  const href = String(raw.url || '')
  const html = String(raw.html || '')
  if (!html.trim()) return null
  const snap = scanStudyDocument(createPageDocument(html, href), href)
  if (!snap) return null
  if (!(snap.chapters?.length || snap.unfinished?.length || snap.progress)) return null
  return {
    ...snap,
    url: snap.url || href,
    via: 'cdp-html',
    live: false,
    ts: Date.now(),
    hint: hintOf(snap, href),
  }
}
