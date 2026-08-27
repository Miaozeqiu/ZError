import { databaseService, type StudyActivity } from './database'
import { runTextModel } from './modelRunner'

export type StudyTimelineSummaryResult = {
  subject_id: number
  summarized: number
  message: string
  error?: string
}

const running = new Map<number, AbortController>()

/** 超过这个间隔视为另一次学习 */
export const STUDY_SESSION_GAP_MS = 30 * 60 * 1000

/** 单点活动至少算这么多分钟 */
const SESSION_MIN_MINUTES = 5

const SUMMARY_SYSTEM = `你是学习记录归档员。用户完成一次学习后，把该时段内的活动概括成 1–2 句中文，供时间线展示。
要求：
- 只说事实，不要评价、不要建议
- 合并同类：新学了什么、复习了什么、做了几道题、正确率如何
- 80 字以内，口语化，像日记一行
- 只输出摘要正文，不要标题、不要列表符号`

export const parseActivityStamp = (value: string) => {
  const raw = String(value || '').trim()
  if (!raw) return 0
  const normalized = raw.includes('T') ? raw : raw.replace(' ', 'T')
  const ms = Date.parse(normalized)
  return Number.isFinite(ms) ? ms : Date.parse(`${normalized}Z`) || 0
}

export const groupActivitiesIntoSessions = (activities: StudyActivity[]) => {
  if (!activities.length) return [] as StudyActivity[][]
  const sorted = [...activities].sort((a, b) => (
    parseActivityStamp(a.create_time) - parseActivityStamp(b.create_time) || a.id - b.id
  ))
  const sessions: StudyActivity[][] = [[sorted[0]]]
  for (let i = 1; i < sorted.length; i += 1) {
    const prev = parseActivityStamp(sorted[i - 1].create_time)
    const curr = parseActivityStamp(sorted[i].create_time)
    if (curr - prev > STUDY_SESSION_GAP_MS) sessions.push([sorted[i]])
    else sessions[sessions.length - 1].push(sorted[i])
  }
  return sessions
}

export const sessionTimeRange = (activities: StudyActivity[]) => {
  const stamps = activities
    .map((item) => parseActivityStamp(item.create_time))
    .filter((value) => Number.isFinite(value) && value > 0)
  const start = Math.min(...stamps)
  let end = Math.max(...stamps)
  if (end - start < SESSION_MIN_MINUTES * 60 * 1000) {
    end = start + SESSION_MIN_MINUTES * 60 * 1000
  }
  return {
    start,
    end,
    minutes: Math.max(1, Math.round((end - start) / 60000)),
  }
}

export const formatSessionClockRange = (startMs: number, endMs: number) => {
  const clock = (stamp: number) => {
    const date = new Date(stamp)
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  }
  const start = clock(startMs)
  const end = clock(endMs)
  if (start === end) return start
  const sameDay = new Date(startMs).toDateString() === new Date(endMs).toDateString()
  if (sameDay) return `${start}–${end}`
  return `${start} – ${end}`
}

const formatActivityLine = (item: StudyActivity) => {
  const names = item.names.filter(Boolean).slice(0, 6).join('、')
  if (item.kind === 'practice') {
    const total = Math.max(1, item.question_count || 0)
    const correct = Math.max(0, item.correct_count || 0)
    const rate = Math.round((correct / total) * 100)
    return `练习 ${total} 道，正确率 ${rate}%${names ? `（${names}）` : ''}`
  }
  if (item.kind === 'review') return `复习${names ? `：${names}` : ''}`
  return `学习${names ? `：${names}` : ''}`
}

const buildPrompt = (subjectName: string, range: ReturnType<typeof sessionTimeRange>, items: StudyActivity[]) => {
  const lines = items.map(formatActivityLine).join('\n')
  const rangeLabel = formatSessionClockRange(range.start, range.end)
  return [
    `科目：${subjectName}`,
    `学习时段：${rangeLabel}（约 ${range.minutes} 分钟）`,
    `活动记录：`,
    lines,
    '',
    '请把这一次学习概括成 1–2 句时间线摘要。',
  ].join('\n')
}

const summarizeSession = async (
  subjectId: number,
  subjectName: string,
  batch: StudyActivity[],
  abort: AbortSignal,
) => {
  if (!batch.length) return { summarized: 0, message: '空会话' }
  const range = sessionTimeRange(batch)
  const text = await runTextModel(
    buildPrompt(subjectName, range, batch),
    () => undefined,
    {
      timeoutMs: 60 * 1000,
      tools: [],
      systemPrompt: SUMMARY_SYSTEM,
      useAgentModel: true,
      signal: abort,
      maxRounds: 1,
    },
  )
  const clean = String(text || '').trim()
  if (!clean) return { summarized: 0, message: '摘要为空', error: 'empty' }

  await databaseService.insertStudyTimelineSummary({
    subjectId,
    text: clean,
    startTime: new Date(range.start).toISOString(),
    endTime: new Date(range.end).toISOString(),
    coveredThroughId: batch[batch.length - 1].id,
    activityCount: batch.length,
  })
  return { summarized: batch.length, message: clean }
}

const resolveSubjectName = async (subjectId: number, subjectName?: string) => (
  subjectName
  || (await databaseService.listStudySubjects().catch(() => []))
    .find((item) => item.id === subjectId)?.name
  || `科目 ${subjectId}`
)

/** 结束当前这次学习：把最近一段未归档活动压成一条摘要 */
export const runStudySessionSummary = async (input: {
  subjectId: number
  subjectName?: string
}): Promise<StudyTimelineSummaryResult> => {
  const subjectId = Number(input.subjectId)
  if (!Number.isFinite(subjectId) || subjectId <= 0) {
    return { subject_id: subjectId, summarized: 0, message: '科目无效' }
  }

  const prev = running.get(subjectId)
  if (prev) prev.abort()
  const abort = new AbortController()
  running.set(subjectId, abort)

  try {
    const cursor = await databaseService.getStudyTimelineSummaryCursor(subjectId)
    const pending = await databaseService.listUnsummarizedStudyActivity(subjectId, cursor, 500)
    if (!pending.length) {
      return { subject_id: subjectId, summarized: 0, message: '没有可归档的学习活动' }
    }

    const sessions = groupActivitiesIntoSessions(pending)
    const batch = sessions[sessions.length - 1]
    const subjectName = await resolveSubjectName(subjectId, input.subjectName)
    const result = await summarizeSession(subjectId, subjectName, batch, abort.signal)
    return { subject_id: subjectId, ...result }
  } catch (error) {
    if (abort.signal.aborted) {
      return { subject_id: subjectId, summarized: 0, message: '已取消' }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { subject_id: subjectId, summarized: 0, message, error: message }
  } finally {
    if (running.get(subjectId) === abort) running.delete(subjectId)
  }
}

/** 归档所有已结束的学习时段（距最后一次活动超过间隔） */
export const runClosedStudySessionSummaries = async (input: {
  subjectId: number
  subjectName?: string
}): Promise<StudyTimelineSummaryResult> => {
  const subjectId = Number(input.subjectId)
  if (!Number.isFinite(subjectId) || subjectId <= 0) {
    return { subject_id: subjectId, summarized: 0, message: '科目无效' }
  }

  const prev = running.get(subjectId)
  if (prev) prev.abort()
  const abort = new AbortController()
  running.set(subjectId, abort)

  try {
    const cursor = await databaseService.getStudyTimelineSummaryCursor(subjectId)
    const pending = await databaseService.listUnsummarizedStudyActivity(subjectId, cursor, 500)
    if (!pending.length) {
      return { subject_id: subjectId, summarized: 0, message: '没有可归档的学习活动' }
    }

    const sessions = groupActivitiesIntoSessions(pending)
    const now = Date.now()
    const subjectName = await resolveSubjectName(subjectId, input.subjectName)
    let total = 0
    let lastMessage = ''

    for (let i = 0; i < sessions.length; i += 1) {
      const batch = sessions[i]
      const { end } = sessionTimeRange(batch)
      const isLast = i === sessions.length - 1
      const closed = !isLast || now - end >= STUDY_SESSION_GAP_MS
      if (!closed) continue
      const result = await summarizeSession(subjectId, subjectName, batch, abort.signal)
      total += result.summarized
      lastMessage = result.message
    }

    return {
      subject_id: subjectId,
      summarized: total,
      message: total ? lastMessage : '暂无已结束的学习时段',
    }
  } catch (error) {
    if (abort.signal.aborted) {
      return { subject_id: subjectId, summarized: 0, message: '已取消' }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { subject_id: subjectId, summarized: 0, message, error: message }
  } finally {
    if (running.get(subjectId) === abort) running.delete(subjectId)
  }
}
