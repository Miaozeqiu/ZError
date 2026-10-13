import {
  abstractionDrill,
  abstractionParsing,
  lastHomeworkCard,
  publishHomeworkCard,
  setAbstractionDrill,
} from '../../browser/abstractions'
import { kickParserClock, parserClockWatching, unwatchParserClock, watchParserClock } from '../../browser/pageClock'
import { asObject, evalBrowserViewMain } from '../../browser/eval'
import { chapterStateFor } from '../browser/chapters'
import { inspectChaoxingHomework } from './inspect'
import { questionHasContent } from './parse'
import { startHomeworkLiveSync, stopHomeworkLiveSync } from './live'
import { PROBE_HOMEWORK_PAGE } from './scripts'

const VISION_EVERY = 4

let browserId = ''
let busy = false
let ticks = 0
let lastProbeUrl = ''
let autoDrill = false
let holdUntil = 0

/** 切章/播视频时先按住，避免长页里的测验 iframe 把面板抢走。 */
export const holdChapterQuizAutoDrill = (ms = 8000) => {
  holdUntil = Date.now() + Math.max(0, ms)
  autoDrill = false
}

const cardUseful = () => {
  const card = lastHomeworkCard.value
  if (!card) return false
  const questions = card.questions || []
  if (!questions.length) return false
  const withImages = questions.some((item) => (
    Boolean(item.images?.length)
    || (item.options || []).some((opt) => opt.image || opt.images?.length)
  ))
  if (withImages) return true
  return questions.every(questionHasContent)
}

const cardNeedsRefresh = (questionLi: number) => {
  if (!cardUseful()) return true
  const count = lastHomeworkCard.value?.questions?.length || 0
  if (questionLi > 0 && count !== questionLi) return true
  const hollow = (lastHomeworkCard.value?.questions || []).some((q) => (
    /单选|多选|判断|single|multi|judge/i.test(String(q.typeName || q.type || ''))
    && !(q.options || []).length
  ))
  return hollow
}

const quizIsCurrent = (id: string, probe: Record<string, unknown>) => {
  if (holdUntil && Date.now() < holdUntil) return false
  const chapter = chapterStateFor(id)
  const jobs = chapter?.jobs || []
  const active = jobs.find((job) => job.active)
  if (active?.kind === 'quiz') return true
  if (active?.kind === 'video' || active?.kind === 'doc') return false
  if (jobs.some((job) => job.kind === 'video')) return false
  // 播放页长页底下一直挂着测验 iframe，不能因此切题卡
  if (probe.topStudy) return false
  if (probe.work && !probe.topStudy) return true
  return false
}

const ensureQuizDrill = (id: string) => {
  if (abstractionDrill.value?.browserId === id && abstractionDrill.value.kind === 'chapter-quiz') {
    return
  }
  const chapter = chapterStateFor(id)
  const active = (chapter?.jobs || []).find((job) => job.active)
  const section = (chapter?.chapters || []).find((item) => item.active)
    || (chapter?.chapters || []).find((item) => String(item.title || '') === String(chapter?.currentTitle || ''))
  setAbstractionDrill({
    browserId: id,
    kind: 'chapter-quiz',
    sectionIndex: String(section?.index || chapter?.current || ''),
    sectionTitle: String(section?.title || chapter?.currentTitle || '本节').trim() || '本节',
    jobLabel: String(active?.label || '测验').trim() || '测验',
  })
  autoDrill = true
}

const clearAutoDrill = (id: string) => {
  if (!autoDrill) return
  if (abstractionDrill.value?.browserId === id && abstractionDrill.value.kind === 'chapter-quiz') {
    setAbstractionDrill(null)
  }
  autoDrill = false
}

const tick = async (id: string) => {
  if (busy || browserId !== id) return
  busy = true
  ticks += 1
  try {
    const probe = asObject(await evalBrowserViewMain(id, PROBE_HOMEWORK_PAGE()).catch(() => null))
    const questionLi = Number(probe?.questionLi) || 0
    const href = String(probe?.url || '')
    if (questionLi <= 0 || !quizIsCurrent(id, probe)) {
      clearAutoDrill(id)
      if (!abstractionDrill.value) {
        if (lastHomeworkCard.value?.questions?.length) publishHomeworkCard(null)
        stopHomeworkLiveSync()
      }
      return
    }
    ensureQuizDrill(id)
    const urlChanged = Boolean(href && href !== lastProbeUrl)
    lastProbeUrl = href || lastProbeUrl
    if (urlChanged || cardNeedsRefresh(questionLi)) {
      const useVision = ticks % VISION_EVERY === 1 || !cardUseful()
      abstractionParsing.value = true
      try {
        await inspectChaoxingHomework(id, { vision: useVision }).catch(() => null)
      } finally {
        abstractionParsing.value = false
      }
    }
    await startHomeworkLiveSync(id).catch(() => null)
  } finally {
    busy = false
  }
}

export const stopHomeworkBackgroundParse = () => {
  if (browserId) unwatchParserClock(browserId, 'homework')
  browserId = ''
  busy = false
  ticks = 0
  lastProbeUrl = ''
  autoDrill = false
  holdUntil = 0
  stopHomeworkLiveSync()
}

/** 学习页/作业页后台读题：不依赖打开「解析」面板。 */
export const startHomeworkBackgroundParse = (id: string) => {
  const next = String(id || '').trim()
  if (!next) {
    stopHomeworkBackgroundParse()
    return
  }
  if (browserId === next && parserClockWatching(next, 'homework')) {
    void kickParserClock(next)
    return
  }
  stopHomeworkBackgroundParse()
  browserId = next
  watchParserClock(next, 'homework', () => tick(next))
  void kickParserClock(next)
}
