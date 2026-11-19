import { shallowReactive, watch } from 'vue'
import { listenBrowserLoad } from '../browser/appBrowser'
import { parseHtml, readFrameHtml } from '../browser/domRead'
import { kickParserClock, kickParserClockSoon, unwatchParserClock, watchParserClock } from '../browser/pageClock'
import { onBrowserFrame, onBrowserTick } from '../browser/pushEvents'
import { courseChapterRows, loadChapterRules, readStudentChapterCard, studentChapterDirectoryUrl, studentChapterUrl } from '../chaoxing/host/chapterTasks'
import { studentCourseUrl } from '../platform/chaoxing/studentCourses'
import { videoWatchFor } from '../platform/panelAccess'

type Target = { sessionId: string; browserId: string; url: string }
type ChapterSummary =
  | { title: string; number: string; remaining: number | null; tab: number; totalJobs: number; loaded: boolean;
    jobs: { kind: string; name: string; done: boolean }[] }
  | { pending: number; completed: number; unknown: number; next?: string }
const snapshots = shallowReactive(new Map<string, { sessionId: string; url: string; at: number; videoMids: string[]; summary: ChapterSummary }>())
const clock = 'agent-chapter-progress'

export function watchBrowserChapters(source: () => Target | null) {
  watch([() => source()?.sessionId, () => source()?.browserId, () => source()?.url], ([sessionId, id, url], _, cleanup) => {
    if (!id || !sessionId || !url) return
    const chapter = studentChapterUrl(url)
    const course = chapter ? null : studentCourseUrl(url)
    if (!chapter && !course?.clazz) return
    let generation = 0
    let closed = false
    const videoEvents = new Map<string, string>()

    const refresh = async () => {
      const revision = generation
      let summary: ChapterSummary
      let videoMids: string[] = []
      if (chapter) {
        const page = await readStudentChapterCard(id)
        if (page?.identity.href !== chapter.href) return
        const { header, jobs } = page
        videoMids = (jobs || []).filter(job => job.kind === 'video').map(job => job.mid).filter(Boolean)
        summary = { title: header.title, number: header.number, remaining: header.remaining, tab: header.tab, loaded: jobs !== null,
          totalJobs: jobs?.length ?? 0, jobs: (jobs || []).slice(0, 10).map(({ kind, name, done }) => ({ kind, name, done })) }
      } else {
        const frame = await readFrameHtml(id, '/mycourse/studentcourse')
        if (!frame.ok || studentChapterDirectoryUrl(frame.url) !== `${course!.id}:${course!.clazz}`) return
        const doc = parseHtml(frame.html)
        const rules = doc && await loadChapterRules().catch(() => null)
        const rows = doc && rules ? courseChapterRows(doc, rules) : []
        if (!rows.length) return
        const next = rows.find(row => Number(row.remaining) > 0)
        summary = {
          completed: rows.filter(row => row.remaining === 0).length,
          pending: rows.filter(row => Number(row.remaining) > 0).length,
          unknown: rows.filter(row => row.remaining === null).length,
          next: next ? `${next.number} ${next.title}`.trim() : undefined,
        }
      }
      const current = source()
      if (closed || revision !== generation || current?.sessionId !== sessionId || current.browserId !== id || current.url !== url) return
      snapshots.set(id, { sessionId, url, at: Date.now(), videoMids, summary })
    }
    const refreshSoon = () => {
      generation++
      snapshots.delete(id)
      kickParserClockSoon(id)
    }
    const offFrame = onBrowserFrame(id, url => {
      if (/\/(?:knowledge\/cards|mycourse\/(?:studentstudy|studentcourse))\b/i.test(url)) refreshSoon()
    })
    const offTick = chapter ? onBrowserTick(id, tick => {
      if (!tick.mid) return
      const state = `${tick.paused}:${tick.ended}`
      if (videoEvents.get(tick.mid) === state) return
      videoEvents.set(tick.mid, state)
      kickParserClockSoon(id)
    }) : undefined
    const offLoad = listenBrowserLoad(event => {
      if (event.id !== id) return
      generation++
      snapshots.delete(id)
      if (event.phase === 'finished') void kickParserClock(id)
    }).catch(() => undefined)
    watchParserClock(id, clock, refresh)
    void kickParserClock(id)
    cleanup(() => {
      closed = true
      snapshots.delete(id)
      unwatchParserClock(id, clock)
      offFrame()
      offTick?.()
      void offLoad.then(off => off?.())
    })
  }, { immediate: true })
}

export function browserChapterContext(sessionId: string, browserId: string, url: string) {
  const snapshot = snapshots.get(browserId)
  if (!snapshot || snapshot.sessionId !== sessionId || snapshot.url !== url || Date.now() - snapshot.at > 15_000) return ''
  const watch = videoWatchFor(browserId)
  const video = 'jobs' in snapshot.summary && watch?.sessionId === sessionId && 'mid' in watch && snapshot.videoMids.includes(watch.mid)
    ? { state: watch.status, current: Math.round(watch.current), duration: Math.round(watch.duration) }
    : undefined
  return `【学习通实时章节】${JSON.stringify({ ...snapshot.summary, video })}`
}
