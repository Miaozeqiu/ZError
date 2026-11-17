/** 课程循环。视频和文档由宿主推进；测验、作业和未知条目交给模型。 */
import { writeDebugDump } from '../agent/debugLog'
import { setCourseWatchConsumer } from './videoWatchAgent'
import {
  applySkips,
  builtinRecipeFor,
  classifyPageSignal,
  coursePlanFor,
  courseProgress,
  decideWatchdog,
  navigationProven,
  nextCourseItem,
  rememberCoursePlan,
  type CourseItem,
  type CourseKind,
  type CoursePlan,
  type PageSignal,
} from './coursePlan'

export type CourseOpenResult = {
  ok: boolean
  url: string
  changed: boolean
  text?: string
}

export type CourseTick = {
  current: number
  paused: boolean
  ended: boolean
  ageMs: number
  hasVideo: boolean
} | null

export type CourseRunnerDeps = {
  now: () => number
  open: (item: CourseItem) => Promise<CourseOpenResult>
  play: (item: CourseItem) => Promise<{ playing: boolean }>
  readTick: () => Promise<CourseTick>
  readText: () => Promise<string>
  doneCount: () => Promise<number>
  wake: (text: string) => void
  notifyUser: (reason: string) => void
  readSnapshot?: () => Promise<string>
}

export type CourseStepResult = {
  action: 'done' | 'watching' | 'needs-agent' | 'paused' | 'advanced'
  item?: CourseItem
  progress: { done: number; total: number }
  report?: string
}

const runs = new Map<string, { browserId: string; sessionId: string; deps: CourseRunnerDeps; lastDone: number; lastDoneAt: number }>()

export const courseRunFor = (sessionId: string) => runs.get(String(sessionId || '').trim()) || null

export const stopCourseRun = (sessionId: string) => {
  runs.delete(String(sessionId || '').trim())
}

const persist = (browserId: string, plan: CoursePlan) => {
  plan.updatedAt = Date.now()
  rememberCoursePlan(browserId, plan)
  const host = String(plan.host || 'site').replace(/[^\w.-]+/g, '')
  const id = String(plan.courseId || 'course').replace(/[^\w.-]+/g, '').slice(0, 40)
  writeDebugDump(`course-${host}-${id}`, JSON.stringify(plan, null, 2), 'json')
}

const reportFor = (item: CourseItem, why: string, tried: string) => [
  `【课程计划】第「${item.label}」条（${item.kind}）`,
  why,
  tried ? `宿主已经试过：${tried}` : '',
  '处理完这一条后 finish 交回。修不好就 finish(blocked)。',
].filter(Boolean).join('\n')

const needsAgent = (kind: CourseKind, skips: CoursePlan['skips']) => {
  if (kind === 'quiz') return skips.quiz !== 'skip'
  if (kind === 'homework') return skips.homework !== 'skip'
  if (kind === 'other') return true
  return false
}

export const createCoursePlan = (input: {
  host: string
  courseId: string
  items: CourseItem[]
  skips?: CoursePlan['skips']
}): CoursePlan => {
  const host = String(input.host || '').replace(/^www\./i, '')
  const builtin = builtinRecipeFor(host)
  const skips = input.skips || {}
  return {
    host,
    courseId: String(input.courseId || 'course'),
    items: applySkips(input.items, skips),
    recipe: builtin || undefined,
    recipeVerified: Boolean(builtin),
    skips,
    updatedAt: Date.now(),
    spins: {},
    heals: {},
    incidentRounds: 0,
  }
}

const handleSignal = (
  plan: CoursePlan,
  item: CourseItem,
  signal: Exclude<PageSignal, null> | 'quiz' | 'unknown',
  deps: CourseRunnerDeps,
): CourseStepResult | null => {
  const key = `${signal}:${item.label}`
  const heals = plan.heals[key] || 0
  const decision = decideWatchdog({ kind: signal, heals, incidentRounds: plan.incidentRounds })
  if (decision === 'heal') {
    plan.heals[key] = heals + 1
    return null
  }
  if (decision === 'user') {
    const reason = signal === 'locked'
      ? '站点要求验证或已限制登录，需要你来处理'
      : '这一条反复处理不了，课程计划已暂停'
    plan.pausedReason = reason
    deps.notifyUser(reason)
    return { action: 'paused', item, progress: courseProgress(plan.items), report: reason }
  }
  plan.incidentRounds += 1
  const text = reportFor(item, `卡住：${signal}`, heals ? `自救 ${heals} 次` : '')
  deps.wake(text)
  return { action: 'needs-agent', item, progress: courseProgress(plan.items), report: text }
}

export const stepCourse = async (
  browserId: string,
  plan: CoursePlan,
  deps: CourseRunnerDeps,
): Promise<CourseStepResult> => {
  const item = nextCourseItem(plan.items)
  const progress = () => courseProgress(plan.items)
  if (!item) {
    plan.pausedReason = ''
    persist(browserId, plan)
    return { action: 'done', progress: progress() }
  }
  if (needsAgent(item.kind, plan.skips)) {
    const why = item.kind === 'other'
      ? '类型还不明确。确认后用 browser_course_plan 把这一条的 kind 改成 video、quiz、homework 或 doc，或者标成跳过。'
      : `这一条是${item.kind === 'quiz' ? '测验' : '作业'}。做完或暂存后 finish 交回。`
    const text = reportFor(item, why, '')
    deps.wake(text)
    persist(browserId, plan)
    return { action: 'needs-agent', item, progress: progress(), report: text }
  }

  const wasVerified = plan.recipeVerified
  const beforeSnap = wasVerified ? '' : await deps.readSnapshot?.().catch(() => '') || ''
  const opened = await deps.open(item)
  let changed = opened.changed
  if (!wasVerified) {
    const afterSnap = await deps.readSnapshot?.().catch(() => '') || ''
    if (!navigationProven(beforeSnap, afterSnap, { changed })) {
      const text = reportFor(item, '点了这一条，网址、[current] 和视频行都没有变。视频已在播就 finish(watching)。', '自动验证配方')
      deps.wake(text)
      persist(browserId, plan)
      return { action: 'needs-agent', item, progress: progress(), report: text }
    }
    plan.recipeVerified = true
    changed = true
  }
  const text = opened.text || await deps.readText().catch(() => '')
  const signal = classifyPageSignal({
    text,
    url: opened.url,
    opened: true,
    changed,
    spinCount: plan.spins[item.label] || 0,
    doneStaleMs: 0,
    tickAgeMs: 0,
    videoStalled: false,
  })
  if (signal) {
    const handled = handleSignal(plan, item, signal, deps)
    if (handled) {
      persist(browserId, plan)
      return handled
    }
    if (signal === 'open-failed' || signal === 'login') {
      const again = await deps.open(item)
      if (!again.changed && !again.ok) {
        plan.heals[`${signal}:${item.label}`] = (plan.heals[`${signal}:${item.label}`] || 1)
        const second = handleSignal(plan, item, signal, deps)
        persist(browserId, plan)
        if (second) return second
      }
    }
  }

  if (signal === 'open-failed' || signal === 'login' || signal === 'locked') {
    const again = handleSignal(plan, item, signal, deps)
    persist(browserId, plan)
    if (again) return again
    plan.pausedReason = '这一条打不开'
    deps.notifyUser(plan.pausedReason)
    return { action: 'paused', item, progress: progress(), report: plan.pausedReason }
  }

  if (item.kind === 'doc') {
    item.status = 'done'
    persist(browserId, plan)
    return { action: 'advanced', item, progress: progress() }
  }

  let tick = await deps.readTick()
  if (!tick?.hasVideo || tick.paused || tick.ended) {
    const played = await deps.play(item)
    tick = await deps.readTick()
    if (!played.playing && !(tick && tick.hasVideo && !tick.paused && !tick.ended)) {
      const stalled = handleSignal(plan, item, 'video-stall', deps)
      persist(browserId, plan)
      if (stalled) return stalled
    }
  }
  persist(browserId, plan)
  return { action: 'watching', item, progress: progress() }
}

export const markCourseItem = (
  browserId: string,
  label: string,
  patch: { status?: CourseItem['status']; kind?: CourseKind },
) => {
  const plan = coursePlanFor(browserId)
  if (!plan) return null
  const item = plan.items.find((row) => row.label === label) || plan.items.find((row) => row.status === 'pending')
  if (!item) return plan
  if (patch.status) item.status = patch.status
  if (patch.kind) item.kind = patch.kind
  if (patch.status === 'pending') {
    plan.spins[item.label] = (plan.spins[item.label] || 0) + 1
  }
  persist(browserId, plan)
  return plan
}

export const bindCourseRun = (browserId: string, sessionId: string, deps: CourseRunnerDeps) => {
  runs.set(String(sessionId || '').trim(), {
    browserId,
    sessionId,
    deps,
    lastDone: 0,
    lastDoneAt: deps.now(),
  })
}

export const noteCourseVideoDone = async (sessionId: string) => {
  const run = courseRunFor(sessionId)
  if (!run) return false
  const plan = coursePlanFor(run.browserId)
  if (!plan) return false
  const item = nextCourseItem(plan.items)
  if (item?.kind === 'video') {
    item.status = 'done'
    persist(run.browserId, plan)
    await stepCourse(run.browserId, plan, run.deps)
  }
  return true
}

setCourseWatchConsumer((sessionId, kind) => {
  if (!courseRunFor(sessionId)) return false
  if (kind === 'done') void noteCourseVideoDone(sessionId)
  else if (kind === 'stalled' || kind === 'lost') void noteCourseStall(sessionId, true)
  return true
})

export const noteCourseStall = async (sessionId: string, stalled: boolean) => {
  const run = courseRunFor(sessionId)
  if (!run) return false
  const plan = coursePlanFor(run.browserId)
  const item = plan ? nextCourseItem(plan.items) : null
  if (!plan || !item) return false
  const tick = await run.deps.readTick()
  const signal = classifyPageSignal({
    text: await run.deps.readText().catch(() => ''),
    url: '',
    videoStalled: stalled,
    tickAgeMs: tick?.ageMs,
    spinCount: plan.spins[item.label] || 0,
  })
  if (!signal) return true
  const handled = handleSignal(plan, item, signal, run.deps)
  persist(run.browserId, plan)
  if (!handled) {
    await run.deps.play(item)
    return true
  }
  return handled.action !== 'needs-agent'
}
