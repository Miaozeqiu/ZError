import { listCachedPageRefs, type BrowserLocator } from '../../browser/engine'
import { evalBrowserViewInFrame, evalBrowserViewMain } from '../../browser/eval'
import { chaoxingUrl, isCourseListFrame, READ_STUDENT_COURSES, studentCourseUrl } from '../../platform/chaoxing/studentCourses'
import { runWebsiteScript, hasWebsiteScriptManifest } from '../websiteScripts'

type Course = { title: string; teacher?: string; target: NonNullable<ReturnType<typeof studentCourseUrl>> }
type Frame = { frameId?: string; loaderId?: string; framePath?: string; url: string; snapshot?: string }
type CoursePage = { frames?: Frame[]; url?: string; title?: string; snapshot?: string; error?: string }
const site = 'chaoxing.com'
const space = 'https://i.chaoxing.com/'
const fail = (reason: string, error: string, extra = {}) => JSON.stringify({ ok: false, reason, error, ...extra })
const isLogin = (value: string) => chaoxingUrl(value)?.hostname === 'passport2.chaoxing.com'
const isSpace = (value: string) => ['i.chaoxing.com', 'i.mooc.chaoxing.com'].includes(chaoxingUrl(value)?.hostname ?? '')
const cleanName = (text: string) => text.normalize('NFKC').replace(/\s+/gu, '').toLowerCase()

type CourseToolContext = {
  name: string; args: Record<string, unknown>; browserId: string; role?: string
  liveHref: (id: string) => Promise<string>
  readBrowserPage: (id: string, opts?: { maxFrames?: number }) => Promise<CoursePage>
  syncPeekedUrl?: (id: string, url: string) => void
  navigateBrowserView: (id: string, url: string) => Promise<unknown>
  clickByLocator: (id: string, locator: BrowserLocator) => Promise<{ ok: boolean; error?: string; reason?: string }>
  onNavigation?: () => void
  wait: (ms: number) => Promise<void>
  includeLandingSnapshot?: boolean
}

const collect = async (id: string, frame: Frame) => {
  const snapshot = await evalBrowserViewInFrame(id, READ_STUDENT_COURSES, '', { frameId: frame.frameId!, loaderId: frame.loaderId })
  const seen = new Set<string>()
  const courses: Course[] = []
  for (const row of Array.isArray(snapshot?.courses) ? snapshot.courses : []) {
    const target = typeof row.href === 'string' && studentCourseUrl(row.href)
    if (!target || typeof row.title !== 'string' || !row.title.trim()) continue
    const key = JSON.stringify([target.id, target.clazz])
    if (seen.has(key)) continue
    seen.add(key)
    courses.push({ title: row.title, teacher: row.teacher || undefined, target })
  }
  return { student: snapshot?.student === true, knownEmpty: snapshot?.knownEmpty === true, truncated: snapshot?.truncated === true, courses }
}

export async function handleWebsiteCourseTools(ctx: CourseToolContext): Promise<string | null> {
  const opening = ctx.name === 'browser_open_course'
  if (!opening && ctx.name !== 'browser_list_courses') return null
  const query = typeof ctx.args.course_name === 'string' ? ctx.args.course_name.trim() : ''
  const teacherQuery = typeof ctx.args.teacher === 'string' ? ctx.args.teacher.trim() : ''
  if (ctx.role === 'explore' || query.length > 180 || teacherQuery.length > 100 || (opening && !query)) return fail('invalid', '请提供明确的学习通课程名。')
  let courseDispatched = false
  try {
    if (!await hasWebsiteScriptManifest(site)) return fail('invalid', '当前学习通经验来源未提供脚本清单。可以先用普通网页工具进入课程。')
    const id = ctx.browserId
    const initial = await ctx.liveHref(id)
    const login = () => fail('invalid', '学习通需要登录，请先完成登录再读取课程。', { loginRequired: true })
    if (isLogin(initial)) return login()
    if (!isSpace(initial) && !isCourseListFrame(initial)) {
      await ctx.wait(0)
      await ctx.navigateBrowserView(id, space)
      ctx.onNavigation?.()
    }

    let data: Awaited<ReturnType<typeof collect>> | undefined
    let sourceFrame: Frame | undefined
    let clickedCourseMenu = false
    let clickedStudentTab = false
    for (let attempt = 0; attempt < 14; attempt++) {
      const current = await ctx.liveHref(id)
      if (isLogin(current)) return login()
      if (isSpace(current) || isCourseListFrame(current)) {
        const page = await ctx.readBrowserPage(id)
        const frames = (page.frames ?? []).filter(frame => frame.frameId && frame.loaderId && isCourseListFrame(frame.url))
        if (frames.length > 1) return fail('ambiguous', '发现多个课表框，请先确认当前的学生课表。')
        if (frames.length === 1) {
          const frame = frames[0]
          try { data = await collect(id, frame) } catch (error) {
            if (!/frame|文档已更换/i.test(String(error))) throw error
            data = undefined
          }
          if (data?.student && (data.courses.length || data.knownEmpty)) {
            sourceFrame = frame
            break
          }
          if (data && !data.student && !clickedStudentTab) {
            await ctx.wait(0)
            const clicked = await ctx.clickByLocator(id, { by: 'css', value: '.tab-item[coursetype="1"]', frameId: frame.frameId, loaderId: frame.loaderId })
            clickedStudentTab = clicked.ok
            if (!clicked.ok && clicked.reason !== 'not_found' && !/frame|文档已更换/i.test(clicked.error ?? '')) return fail('invalid', clicked.error || '无法切换到「我学的课」。')
          }
        } else if (isSpace(current) && !clickedCourseMenu) {
          const refs = listCachedPageRefs(id).filter(ref => !ref.disabled && ref.role === 'menuitem' && ref.name.trim() === '课程' && ref.locator.frameId && ref.locator.loaderId && !ref.locator.framePath)
          if (refs.length === 1) {
            await ctx.wait(0)
            const clicked = await ctx.clickByLocator(id, refs[0].locator)
            clickedCourseMenu = clicked.ok
          }
        }
      }
      await ctx.wait(350)
    }
    if (!sourceFrame || !data?.student) return fail('not_found', '没有读到已加载的学生课表。请先打开「我学的课」，或用普通网页工具检查课表。')

    const { courses } = data
    const input = { operation: opening ? 'open' : 'list', query, teacher: teacherQuery, courses: courses.map(({ title, teacher }, id) => ({ id, title, teacher })) }
    const script = await runWebsiteScript(site, 'chaoxing', 'courses', input, (result) => {
      const output = result as { ids?: unknown[]; selected?: unknown } | null
      if (!Array.isArray(output?.ids) || output.ids.some(id => !Number.isInteger(id) || Number(id) < 0 || Number(id) >= courses.length)
        || new Set(output.ids).size !== output.ids.length || (output.selected !== undefined && (output.ids.length !== 1 || output.ids[0] !== output.selected))) {
        throw new Error('课程脚本结果不符合约定。')
      }
      return { ids: output.ids as number[], selected: output.selected as number | undefined }
    })
    const meta = { scriptRevision: script.revision, ...(script.cached ? { cachedScript: true } : {}) }
    const results = script.result.ids.map(index => courses[index]).map(({ title, teacher }) => ({ title, ...(teacher ? { teacher } : {}) }))
    if (!opening) {
      const offset = Math.max(0, Math.min(results.length, Math.floor(Number(ctx.args.offset) || 0)))
      return JSON.stringify({ ok: true, ...meta, courses: results.slice(offset, offset + 40), total: results.length, truncated: data.truncated, nextOffset: results.length > offset + 40 ? offset + 40 : undefined })
    }
    if (data.truncated) return fail('ambiguous', '课表采集没有覆盖全部课程，无法确认唯一匹配。', { ...meta, courses: results.slice(0, 20) })
    if (script.result.selected == null) return fail(results.length ? 'ambiguous' : 'not_found', results.length ? '匹配到多门课程，请提供可区分的完整课程名或授课教师。' : '学生课表中没有找到符合条件的课程。', { ...meta, courses: results.slice(0, 20) })
    const course = courses[script.result.selected]
    const teacher = cleanName(teacherQuery)
    const title = cleanName(query)
    const eligible = teacher ? courses.filter(item => cleanName(item.teacher ?? '').includes(teacher)) : courses
    const exact = eligible.filter(item => cleanName(item.title) === title)
    const matches = exact.length ? exact : eligible.filter(item => cleanName(item.title).includes(title))
    if (matches.length !== 1 || matches[0] !== course) return fail('ambiguous', '没有足够证据确认要打开的课程。', { ...meta, courses: results.slice(0, 20) })

    await ctx.wait(0)
    const current = await ctx.liveHref(id)
    if (!isSpace(current) && !isCourseListFrame(current)) return fail('stale', '当前页面已离开课表，请重新读取。')
    const latest = await collect(id, sourceFrame).catch(() => undefined)
    if (!latest?.student || latest.truncated || JSON.stringify(latest.courses) !== JSON.stringify(courses)) return fail('stale', '课表在查询期间发生了变化，请重新读取。')
    courseDispatched = true
    await ctx.navigateBrowserView(id, course.target.url)
    ctx.onNavigation?.()
    const matchesCourse = (url: string) => {
      const target = studentCourseUrl(url)
      return target && target.id === course.target.id && (!course.target.clazz || target.clazz === course.target.clazz)
    }
    let landed = ''
    for (let attempt = 0; attempt < 16; attempt++) {
      await ctx.wait(300)
      const href = String(await evalBrowserViewMain(id, 'String(location.href)').catch(() => '') || '')
      if (isLogin(href)) return fail('verification_required', '课程页要求重新登录。', { clickDispatched: true, loginRequired: true, ...meta })
      landed = matchesCourse(href) ? href : ''
      if (!landed) continue

      if (ctx.includeLandingSnapshot === false && /\/mycourse\/stu\/?$/i.test(new URL(landed).pathname)) {
        ctx.syncPeekedUrl?.(id, landed)
        return JSON.stringify({ ok: true, opened: true, course: results[0], ...meta })
      }

      const page = await ctx.readBrowserPage(id, { maxFrames: 2 })
      if (isLogin(page.url || '')) return fail('verification_required', '课程页要求重新登录。', { clickDispatched: true, loginRequired: true, ...meta })
      if (page.url && !matchesCourse(page.url)) { landed = ''; continue }
      if (!page.url || page.error || !page.snapshot?.trim()) continue

      const lines = page.snapshot.trimEnd().split('\n')
      const limit = 100
      ctx.syncPeekedUrl?.(id, page.url)
      return JSON.stringify({ ok: true, opened: true, course: results[0], title: page.title, path: new URL(page.url).pathname,
        snapshot: lines.slice(0, limit).join('\n'), ...(lines.length > limit ? { snapshotTruncated: true } : {}), ...meta,
        hint: '课程已打开，snapshot 是本标签的最新页面。若用户只要求进课，可直接 browser_finish(done)；若有后续任务，使用此快照的 ref。' })
    }
    if (landed) {
      ctx.syncPeekedUrl?.(id, landed)
      return JSON.stringify({ ok: true, opened: true, course: results[0], path: new URL(landed).pathname, ...meta,
        hint: '已核对进入课程。页面内容暂未读取成功；后续任务需要查看页面时再调用 browser_get_page。' })
    }
    return fail('verification_required', '课程入口已打开，但未核对到匹配的学生课程页。请读取当前网页确认。', { clickDispatched: true, ...meta })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return fail(courseDispatched ? 'verification_required' : 'invalid', error instanceof Error ? error.message : String(error), { clickDispatched: courseDispatched })
  }
}
