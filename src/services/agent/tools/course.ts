import { notifyCourseIncident } from '../../browser/videoWatchAgent'
import { hostCapabilitiesFor } from '../hostCapabilities'
import {
  applySkips,
  courseNextVerified,
  coursePlanFor,
  coursePlanSummary,
  courseProgress,
  itemsFromSnapshot,
  normalizeCourseItem,
  parseRecipe,
  rememberCoursePlan,
  snapshotRecipe,
  type CourseKind,
  type CourseSkips,
} from '../../browser/coursePlan'
import {
  bindCourseRun,
  createCoursePlan,
  markCourseItem,
  stepCourse,
  stopCourseRun,
  type CourseRunnerDeps,
} from '../../browser/courseRunner'

const asItems = (raw: unknown) => {
  const list = Array.isArray(raw) ? raw : []
  return list.map((item, index) => normalizeCourseItem(item, index)).filter((item): item is NonNullable<typeof item> => Boolean(item))
}

const skipsOf = (raw: unknown): CourseSkips => {
  const row = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const quiz = String(row.quiz || '')
  const homework = String(row.homework || '')
  const doc = String(row.doc || '')
  return {
    quiz: quiz === 'skip' || quiz === 'save' || quiz === 'ask' ? quiz : undefined,
    homework: homework === 'skip' || homework === 'save' || homework === 'ask' ? homework : undefined,
    doc: doc === 'skip' || doc === 'read' ? doc : undefined,
  }
}

export const handleCourseTools = async (ctx: Record<string, any>): Promise<string | null> => {
  const { name, args, browserId, sessionId, clickBrowserText, currentUrl, pageHostOf } = ctx
  if (name !== 'browser_course_plan') return null
  const action = String(args.action || 'status').trim()
  const hostOf = async () => {
    const url = await currentUrl(browserId)
    return String(pageHostOf?.(url) || '').replace(/^www\./i, '')
  }

  if (action === 'from_host') {
    const url = await currentUrl(browserId)
    const host = await hostOf()
    if (!hostCapabilitiesFor(url).catalog) {
      return JSON.stringify({ ok: false, error: '这个站没有目录能力。看快照后用 action=set 提交清单。' })
    }
    const { readChaoxingCourseItems } = await import('../../platform/chaoxing/courseHost')
    const titles = await readChaoxingCourseItems(browserId)
    const items = titles
      .map((label) => normalizeCourseItem({ label, kind: 'other' }, 0))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    if (!items.length) {
      return JSON.stringify({ ok: false, error: '目录里没有未完成的章节。', url })
    }
    const plan = createCoursePlan({ host: host || 'chaoxing', courseId: 'chaoxing', items, skips: skipsOf(args.skips) })
    rememberCoursePlan(browserId, plan)
    return JSON.stringify({ ok: true, total: items.length, summary: coursePlanSummary(plan) })
  }

  if (action === 'from_snapshot') {
    const page = await ctx.readBrowserPage?.(browserId, { maxFrames: 8 }).catch(() => null)
    const snapshot = String(page?.snapshot || '')
    const { role, items } = itemsFromSnapshot(snapshot)
    if (!items.length) {
      return JSON.stringify({ ok: false, error: '快照里没有目录。先 get_page，看到 treeitem 再 from_snapshot。' })
    }
    const host = String(args.host || await hostOf() || 'site')
    const plan = createCoursePlan({
      host,
      courseId: String(args.courseId || 'course'),
      items,
      skips: skipsOf(args.skips),
    })
    if (!plan.recipe) {
      plan.recipe = snapshotRecipe(role)
      plan.recipeVerified = false
    }
    rememberCoursePlan(browserId, plan)
    return JSON.stringify({
      ok: true,
      total: courseProgress(plan.items).total,
      role,
      verified: plan.recipeVerified,
      summary: coursePlanSummary(plan),
    })
  }

  if (action === 'set') {
    const items = applySkips(asItems(args.items), skipsOf(args.skips))
    if (!items.length) return JSON.stringify({ ok: false, error: 'items 里要有 label 和 kind' })
    const host = String(args.host || await hostOf() || 'site')
    const plan = createCoursePlan({
      host,
      courseId: String(args.courseId || 'course'),
      items,
      skips: skipsOf(args.skips),
    })
    rememberCoursePlan(browserId, plan)
    return JSON.stringify({
      ok: true,
      total: courseProgress(plan.items).total,
      verified: plan.recipeVerified,
      summary: coursePlanSummary(plan),
    })
  }

  if (action === 'save_recipe') {
    const plan = coursePlanFor(browserId)
    if (!plan) return JSON.stringify({ ok: false, error: '还没有课程计划' })
    const parsed = parseRecipe(args.recipe)
    if (!parsed.ok) return JSON.stringify(parsed)
    plan.recipe = parsed.recipe
    if (plan.recipeVerified || courseNextVerified(browserId)) plan.recipeVerified = true
    rememberCoursePlan(browserId, plan)
    return JSON.stringify({ ok: true, recipe: plan.recipe, verified: plan.recipeVerified })
  }

  if (action === 'set_kind' || action === 'skip') {
    const label = String(args.label || '').trim()
    const kind = String(args.kind || '') as CourseKind
    const plan = markCourseItem(browserId, label, {
      kind: action === 'set_kind' ? kind : undefined,
      status: action === 'skip' ? 'skipped' : undefined,
    })
    if (!plan) return JSON.stringify({ ok: false, error: '还没有课程计划' })
    return JSON.stringify({ ok: true, summary: coursePlanSummary(plan) })
  }

  if (action === 'stop') {
    stopCourseRun(sessionId)
    return JSON.stringify({ ok: true, stopped: true })
  }

  if (action === 'start' || action === 'resume') {
    const plan = coursePlanFor(browserId)
    if (!plan) return JSON.stringify({ ok: false, error: '还没有课程计划。先 set、from_host 或 from_snapshot。' })
    const deps: CourseRunnerDeps = {
      now: () => Date.now(),
      open: async (item) => {
        const from = await currentUrl(browserId)
        const clicked = item.ref
          ? await ctx.clickByLocator?.(browserId, { by: 'text', value: item.label, frame: item.frame })
          : await clickBrowserText(browserId, item.label)
        if (item.kind === 'doc') await ctx.scrollBrowserView?.(browserId, 1600)
        const url = await currentUrl(browserId)
        const ok = Boolean(clicked && typeof clicked === 'object' && (clicked as { ok?: boolean }).ok !== false)
        return { ok, url, changed: String(url || '') !== String(from || ''), text: '' }
      },
      play: async () => {
        const clicked = await clickBrowserText(browserId, '播放').catch(() => null)
        return { playing: Boolean(clicked && (clicked as { ok?: boolean }).ok) }
      },
      readTick: async () => {
        const { readNativeVideoTick } = await import('../../browser/videoWatch')
        const tick = await readNativeVideoTick(browserId).catch(() => null)
        if (!tick) return null
        return {
          current: Number(tick.current) || 0,
          paused: Boolean(tick.paused),
          ended: Boolean(tick.ended),
          ageMs: 0,
          hasVideo: Boolean(tick.hasVideo),
        }
      },
      readText: async () => {
        const raw = await ctx.evalBrowserView?.(browserId, `(function(){ return String((document.body && document.body.innerText) || '').slice(0, 1500); })()`).catch(() => '')
        return typeof raw === 'string' ? raw : ''
      },
      doneCount: async () => courseProgress(coursePlanFor(browserId)?.items || []).done,
      wake: (text) => notifyCourseIncident(sessionId, text),
      notifyUser: (reason) => notifyCourseIncident(sessionId, reason),
      readSnapshot: async () => {
        const page = await ctx.readBrowserPage?.(browserId, { maxFrames: 4 }).catch(() => null)
        return String(page?.snapshot || '')
      },
    }
    bindCourseRun(browserId, sessionId, deps)
    const step = await stepCourse(browserId, plan, deps)
    if (step.action === 'watching') {
      const tick = await deps.readTick()
      const { isChaoxingPlayerUrl } = await import('../../platform/chaoxing/nav')
      const url = await currentUrl(browserId)
      if (isChaoxingPlayerUrl(url)) {
        const { startChaoxingCourseWatch } = await import('../../platform/chaoxing/courseHost')
        await startChaoxingCourseWatch(browserId, sessionId, {
          title: step.item?.label || '',
          current: tick?.current,
          paused: tick?.paused,
          ended: tick?.ended,
        })
      } else if (tick) {
        const { startNativeWatch } = await import('../../browser/videoWatch')
        startNativeWatch(browserId, sessionId, { ...tick, title: step.item?.label || '' })
      }
    }
    return JSON.stringify({ ok: step.action !== 'paused', ...step, summary: coursePlanSummary(plan) })
  }

  const plan = coursePlanFor(browserId)
  return JSON.stringify({
    ok: true,
    summary: coursePlanSummary(plan) || '还没有课程计划',
    progress: plan ? courseProgress(plan.items) : null,
    pausedReason: plan?.pausedReason || '',
  })
}
