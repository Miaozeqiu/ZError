/** 课程计划与导航配方。宿主按这份记账，模型只在探路、测验和事故时出现。 */
import { reactive } from 'vue'

export type CourseKind = 'video' | 'quiz' | 'homework' | 'doc' | 'other'

export type CourseItemStatus = 'pending' | 'done' | 'skipped' | 'blocked'

export type CourseItem = {
  label: string
  ref?: string
  frame?: string
  kind: CourseKind
  doneText?: string
  status: CourseItemStatus
}

export type CourseRecipe = {
  item?: { role?: string; frame?: string }
  current?: string
  done?: { text?: string }
  next?: 'next-undone' | 'next-button'
  nextButton?: string
  inner?: 'videos-in-order'
}

export type CourseSkips = {
  quiz?: 'skip' | 'save' | 'ask'
  homework?: 'skip' | 'save' | 'ask'
  doc?: 'skip' | 'read'
}

export type CoursePlan = {
  host: string
  courseId: string
  items: CourseItem[]
  recipe?: CourseRecipe
  recipeVerified: boolean
  skips: CourseSkips
  updatedAt: number
  pausedReason?: string
  /** 同一条进去又出来的次数 */
  spins: Record<string, number>
  heals: Record<string, number>
  incidentRounds: number
}

export type CourseProgress = {
  done: number
  total: number
  complete: boolean
}

const KINDS = new Set<CourseKind>(['video', 'quiz', 'homework', 'doc', 'other'])

export const courseProgress = (items: CourseItem[]): CourseProgress => {
  const active = items.filter((item) => item.status !== 'skipped')
  const done = active.filter((item) => item.status === 'done').length
  return {
    done,
    total: active.length,
    complete: active.length > 0 && done === active.length,
  }
}

export const normalizeCourseItem = (raw: unknown, index: number): CourseItem | null => {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const label = String(row.label || row.title || '').replace(/\s+/g, ' ').trim()
  if (!label) return null
  const kindRaw = String(row.kind || 'other').trim() as CourseKind
  const statusRaw = String(row.status || 'pending')
  const status: CourseItemStatus = statusRaw === 'done' || statusRaw === 'skipped' || statusRaw === 'blocked'
    ? statusRaw
    : 'pending'
  return {
    label: label.slice(0, 80),
    ref: String(row.ref || '').trim() || undefined,
    frame: String(row.frame || '').trim() || undefined,
    kind: KINDS.has(kindRaw) ? kindRaw : 'other',
    doneText: String(row.doneText || '').trim().slice(0, 40) || undefined,
    status: index < 0 ? status : status,
  }
}

export const applySkips = (items: CourseItem[], skips: CourseSkips = {}): CourseItem[] => (
  items.map((item) => {
    if (item.status === 'done' || item.status === 'blocked') return item
    if (item.kind === 'quiz' && skips.quiz === 'skip') return { ...item, status: 'skipped' }
    if (item.kind === 'homework' && skips.homework === 'skip') return { ...item, status: 'skipped' }
    if (item.kind === 'doc' && skips.doc === 'skip') return { ...item, status: 'skipped' }
    return item
  })
)

export const nextCourseItem = (items: CourseItem[]): CourseItem | null => (
  items.find((item) => item.status === 'pending') || null
)

const kindFromLabel = (label: string): CourseKind => {
  if (/测验|小测|quiz/i.test(label)) return 'quiz'
  if (/作业|homework/i.test(label)) return 'homework'
  if (/文档|课件|ppt|pdf|资料/i.test(label)) return 'doc'
  return 'video'
}

/** 从快照目录行生成清单。完成和当前用行尾的 [done] / [current]，不写 CSS。 */
export const itemsFromSnapshot = (snapshot: string): { role: string; items: CourseItem[] } => {
  const counts = { treeitem: 0, listitem: 0 }
  const parsed: Array<{ role: 'treeitem' | 'listitem'; item: CourseItem }> = []
  for (const line of String(snapshot || '').split('\n')) {
    const match = line.match(/^\s*- (treeitem|listitem) "([^"]+)"/)
    if (!match) continue
    const role = match[1] as 'treeitem' | 'listitem'
    counts[role] += 1
    const label = match[2].replace(/\s+/g, ' ').trim()
    if (!label || label === '(无文案)') continue
    const ref = line.match(/\[ref=(e\d+)\]/i)?.[1] || ''
    const mark = line.match(/\[(done|current|locked)\]/)?.[1] || ''
    const status = mark === 'done' ? 'done' : mark === 'locked' ? 'skipped' : 'pending'
    const item = normalizeCourseItem({
      label,
      ref,
      kind: kindFromLabel(label),
      status,
    }, parsed.length)
    if (item) parsed.push({ role, item })
  }
  const role = counts.listitem > counts.treeitem ? 'listitem' : 'treeitem'
  return {
    role,
    items: parsed.filter((row) => row.role === role).map((row) => row.item).slice(0, 80),
  }
}

export const snapshotRecipe = (role: string): CourseRecipe => ({
  item: { role: role || 'treeitem' },
  current: '[current]',
  done: { text: '[done]' },
  next: 'next-undone',
  inner: 'videos-in-order',
})

const markedLabels = (snapshot: string, mark: string) => String(snapshot || '').split('\n').flatMap((line) => {
  if (!line.includes(`[${mark}]`)) return []
  const name = line.match(/"([^"]+)"/)?.[1] || ''
  return name ? [name] : []
})

const videoState = (snapshot: string) => String(snapshot || '').split('\n').flatMap((line) => {
  if (!/^\s*- video\b/.test(line)) return []
  const name = line.match(/"([^"]+)"/)?.[1] || ''
  const state = line.match(/\b(playing|paused|ended)\b/)?.[1] || ''
  return [`${name}|${state}`]
})

/** 网址、当前标记或视频行有变化，才算真的打开了下一条。 */
export const navigationProven = (
  before: string,
  after: string,
  opened: { changed?: boolean },
) => {
  if (opened.changed) return true
  const beforeCur = markedLabels(before, 'current').join('\n')
  const afterCur = markedLabels(after, 'current').join('\n')
  if (afterCur && afterCur !== beforeCur) return true
  const beforeVid = videoState(before).join('\n')
  const afterVid = videoState(after).join('\n')
  if (afterVid && afterVid !== beforeVid) return true
  return false
}

export const coursePlanNudge = (snapshot: string, hasPlan: boolean) => {
  if (hasPlan) return ''
  const trees = String(snapshot || '').split('\n').filter((line) => /^\s*- treeitem\b/.test(line)).length
  if (trees >= 3) return 'next: browser_course_plan from_snapshot → start'
  return ''
}

export const parseRecipe = (raw: unknown): { ok: true; recipe: CourseRecipe } | { ok: false; error: string } => {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  if (!row) return { ok: false, error: '配方要是对象' }
  const allowed = new Set(['item', 'current', 'done', 'next', 'nextButton', 'inner'])
  const extra = Object.keys(row).filter((key) => !allowed.has(key))
  if (extra.length) return { ok: false, error: `配方只收这几项：${[...allowed].join('、')}` }
  const next = String(row.next || 'next-undone')
  if (next !== 'next-undone' && next !== 'next-button') {
    return { ok: false, error: 'next 只能是 next-undone 或 next-button' }
  }
  const inner = row.inner == null ? 'videos-in-order' : String(row.inner)
  if (inner !== 'videos-in-order') return { ok: false, error: 'inner 目前只支持 videos-in-order' }
  const item = row.item && typeof row.item === 'object' ? row.item as Record<string, unknown> : undefined
  const done = row.done && typeof row.done === 'object' ? row.done as Record<string, unknown> : undefined
  return {
    ok: true,
    recipe: {
      item: item ? { role: String(item.role || '').trim() || undefined, frame: String(item.frame || '').trim() || undefined } : undefined,
      current: String(row.current || '').trim() || undefined,
      done: done ? { text: String(done.text || '').trim() || undefined } : undefined,
      next,
      nextButton: String(row.nextButton || '').trim() || undefined,
      inner: 'videos-in-order',
    },
  }
}

/** 学习通目录的已知事实。新站不走这里，由模型点通后保存。 */
export const builtinRecipeFor = (host: string): CourseRecipe | null => {
  const name = String(host || '').replace(/^www\./i, '')
  if (/chaoxing\.com|mooc1\.|i\.chaoxing/i.test(name) || name === 'chaoxing') {
    return {
      item: { role: 'treeitem' },
      current: '.posCatalog_active',
      done: { text: '已完成' },
      next: 'next-undone',
      inner: 'videos-in-order',
    }
  }
  return null
}

export type PageSignal =
  | 'locked'
  | 'login'
  | 'spin'
  | 'no-progress'
  | 'video-stall'
  | 'tick-dead'
  | 'open-failed'
  | null

export const pageHandoff = (text: string, url: string): 'locked' | 'verify' | 'login' | null => {
  const body = String(text || '')
  if (/今日已错误|已锁定|账号锁定|次数过多|错误次数/.test(body)) return 'locked'
  if (/人脸识别|短信验证|扫码验证/.test(body)) return 'verify'
  if (/\/login|passport|gxptLogin|signin/i.test(String(url || ''))) return 'login'
  return null
}

export const classifyPageSignal = (input: {
  text?: string
  url?: string
  opened?: boolean
  changed?: boolean
  spinCount?: number
  doneStaleMs?: number
  tickAgeMs?: number
  videoStalled?: boolean
}): PageSignal => {
  const hand = pageHandoff(String(input.text || ''), String(input.url || ''))
  if (hand === 'locked' || hand === 'verify') return 'locked'
  if (hand === 'login') return 'login'
  if ((input.spinCount || 0) >= 3) return 'spin'
  if ((input.doneStaleMs || 0) >= 10 * 60 * 1000) return 'no-progress'
  if (input.videoStalled) return 'video-stall'
  if ((input.tickAgeMs || 0) > 10_000) return 'tick-dead'
  if (input.opened && input.changed === false) return 'open-failed'
  return null
}

export type WatchdogKind = Exclude<PageSignal, null> | 'quiz' | 'unknown'

export type WatchdogDecision = 'heal' | 'wake' | 'user'

export const decideWatchdog = (input: {
  kind: WatchdogKind
  heals: number
  incidentRounds: number
}): WatchdogDecision => {
  if (input.kind === 'locked') return 'user'
  if (input.incidentRounds >= 15) return 'user'
  if (input.kind === 'login' && input.heals < 2) return 'heal'
  if (input.kind === 'quiz' || input.kind === 'unknown' || input.kind === 'login' || input.kind === 'spin' || input.kind === 'no-progress') {
    return 'wake'
  }
  if (input.heals < 2) return 'heal'
  return 'wake'
}

const plans = new Map<string, CoursePlan>()
const navProofs = new Map<string, { from: string; to: string; at: number }>()

export const coursePlanState = reactive<{ byBrowser: Record<string, CoursePlan | undefined> }>({
  byBrowser: {},
})

export const rememberCoursePlan = (browserId: string, plan: CoursePlan) => {
  const id = String(browserId || '').trim()
  if (!id) return
  plans.set(id, plan)
  coursePlanState.byBrowser[id] = plan
}

export const coursePlanFor = (browserId: string) => (
  coursePlanState.byBrowser[String(browserId || '').trim()] || plans.get(String(browserId || '').trim()) || null
)

export const clearCoursePlan = (browserId?: string) => {
  const id = String(browserId || '').trim()
  if (id) {
    plans.delete(id)
    delete coursePlanState.byBrowser[id]
    return
  }
  plans.clear()
  coursePlanState.byBrowser = {}
}

export const noteCourseNavigation = (browserId: string, fromUrl: string, toUrl: string) => {
  const from = String(fromUrl || '').split('#')[0]
  const to = String(toUrl || '').split('#')[0]
  if (!from || !to || from === to) return
  navProofs.set(String(browserId || '').trim(), { from, to, at: Date.now() })
}

export const courseNextVerified = (browserId: string, maxAgeMs = 10 * 60 * 1000) => {
  const proof = navProofs.get(String(browserId || '').trim())
  return Boolean(proof && Date.now() - proof.at <= maxAgeMs)
}

export const coursePlanSummary = (plan: CoursePlan | null | undefined) => {
  if (!plan) return ''
  const progress = courseProgress(plan.items)
  const paused = plan.pausedReason ? `已暂停：${plan.pausedReason}` : ''
  return [`课程计划 ${progress.done}/${progress.total}`, paused].filter(Boolean).join('。')
}
