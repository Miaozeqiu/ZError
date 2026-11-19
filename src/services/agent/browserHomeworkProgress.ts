import { watch } from 'vue'
import { listenBrowserLoad } from '../browser/appBrowser'
import { evalBrowserViewMainIdle } from '../browser/eval'
import { kickParserClock, kickParserClockSoon, unwatchParserClock, watchParserClock } from '../browser/pageClock'
import { onHomeworkChanged } from '../browser/pushEvents'
import { courseHomeworkReadScript, loadCourseHomeworkRules, type PageHomework } from '../chaoxing/host/courseHomeworkAnswers'
import { studentHomeworkUrl } from '../platform/chaoxing/studentHomework'
import { liveSession, recordHomeworkProgress, sessionIsStreaming } from './chatStore'
import { observeHomeworkQuestion, type HomeworkQuestionProgress } from './homeworkProgress'

type BrowserHomeworkTarget = { sessionId: string; browserId: string; url: string }
const clockName = 'agent-homework-progress'
const batchSize = 32

export function watchBrowserHomework(
  source: () => BrowserHomeworkTarget | null, onOpen: (assignmentId: string) => void,
) {
  watch([() => source()?.sessionId, () => source()?.browserId, () => source()?.url], ([sessionId, browserId, url], _, cleanup) => {
    if (!sessionId || !browserId || !url) return
    const assignment = studentHomeworkUrl(url)
    if (!assignment) return
    const assignmentId = [assignment.course, assignment.clazz, assignment.work].join(':')
    let stopped = false
    let generation = 0
    let complete = false
    let opened = false

    const refresh = async () => {
      const revision = generation
      const isCurrent = () => {
        const current = source()
        return !stopped && generation === revision && current?.sessionId === sessionId
          && current.browserId === browserId && current.url === url
      }
      const rules = await loadCourseHomeworkRules().catch(() => null)
      if (!rules || !isCurrent()) return false
      let total = 0
      let title: string | undefined
      let documentTime: number | undefined
      const questions: HomeworkQuestionProgress[] = []
      const publish = (rows: HomeworkQuestionProgress[]) => {
        if (!rows.length) return
        recordHomeworkProgress(sessionId, undefined, { assignmentId, title, total, questions: rows, phase: 'read' })
        if (!opened) {
          opened = true
          onOpen(assignmentId)
        }
      }

      for (let offset = 0; isCurrent() && (offset === 0 || offset < total); offset += batchSize) {
        const page: PageHomework | null = await evalBrowserViewMainIdle(browserId, courseHomeworkReadScript(rules, offset, batchSize)).catch(() => null)
        if (!isCurrent() || page?.url !== url || !Number.isSafeInteger(page.total) || page.total <= 0
          || !Array.isArray(page.questions) || page.questions.length !== Math.min(batchSize, page.total - offset)) return false
        if (offset === 0) {
          total = page.total
          title = page.title
          documentTime = page.documentTime
        } else if (page.total !== total || documentTime !== page.documentTime) return false
        const rows = page.questions.map(observeHomeworkQuestion)
        if (!opened) publish(rows)
        else questions.push(...rows)
      }
      if (!isCurrent()) return false
      publish(questions)
      return total > 0
    }

    const offAnswers = onHomeworkChanged(browserId, () => {
      if (!sessionIsStreaming(liveSession(sessionId))) kickParserClockSoon(browserId)
    })
    const offLoad = listenBrowserLoad(event => {
      if (event.id !== browserId) return
      generation++
      complete = false
      if (event.phase === 'finished') void kickParserClock(browserId)
    }).catch(() => undefined)
    watchParserClock(browserId, clockName, async (_id, reason) => {
      if (!complete || reason === 'action') complete = await refresh()
    })
    void kickParserClock(browserId)
    cleanup(() => {
      stopped = true
      unwatchParserClock(browserId, clockName)
      offAnswers()
      void offLoad.then(off => off?.())
    })
  }, { immediate: true })
}
