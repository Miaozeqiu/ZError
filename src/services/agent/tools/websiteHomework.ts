import { listCachedPageRefs, type BrowserLocator } from '../../browser/engine'
import { evalBrowserViewInFrame } from '../../browser/eval'
import { homeworkListRules, isStudentHomeworkList, readStudentHomeworkScript, studentHomeworkUrl } from '../../platform/chaoxing/studentHomework'
import { chaoxingUrl, studentCourseUrl } from '../../platform/chaoxing/studentCourses'
import { runWebsiteScript, hasWebsiteScriptManifest } from '../websiteScripts'
import { handleWebsiteCourseTools } from './websiteCourses'

type Course = NonNullable<ReturnType<typeof studentCourseUrl>>
type Frame = { url: string; frameId?: string; loaderId?: string; snapshot?: string }
type Entry = { title: string; status: string; address: string }
type List = { frame: Frame; entries: Entry[]; page: number; previous: boolean; next: boolean }
type Context = Parameters<typeof handleWebsiteCourseTools>[0]
const site = 'chaoxing.com'
const pageLimit = 20
const nameKey = (value: string) => value.normalize('NFKC').replace(/\s+/gu, '').toLowerCase()
const homeworkContentReady = (snapshot: string) => /^(?:\s*- (?:radio|checkbox|textbox|combobox|option)\b)/m.test(snapshot)
  || /开始(?:作答|答题|作业)|继续作答|查看(?:作业|答案|结果)|暂存|提交作业|提交答案|答题卡|题目解析|批阅结果|暂无题目|作业已结束|已过截止时间/.test(snapshot)

export async function handleWebsiteHomeworkTools(ctx: Context): Promise<string | null> {
  const opening = ctx.name === 'browser_open_homework'
  if (!opening && ctx.name !== 'browser_list_homework') return null
  const query = typeof ctx.args.homework_name === 'string' ? ctx.args.homework_name.trim() : ''
  const courseName = typeof ctx.args.course_name === 'string' ? ctx.args.course_name.trim() : ''
  const shortcut = opening && typeof ctx.args.homework_url === 'string' ? ctx.args.homework_url.trim() : ''
  if (ctx.role === 'explore' || (opening && !query) || query.length > 180 || courseName.length > 180) {
    return JSON.stringify({ ok: false, reason: 'invalid', error: '请提供有效的学习通作业名称。' })
  }
  const id = ctx.browserId
  let dispatched = false
  const fail = (reason: string, error: string, extra = {}) => JSON.stringify({ ok: false, reason, error, ...(dispatched ? { clickDispatched: true } : {}), ...extra })
  const scopedClick = async (frame: Frame, selector: string) => {
    await ctx.wait(0)
    return ctx.clickByLocator(id, { by: 'css', value: selector, frameId: frame.frameId, loaderId: frame.loaderId })
  }
  try {
    if (!await hasWebsiteScriptManifest(site)) return fail('invalid', '当前学习通经验来源未提供脚本清单，可通过快照查看课程作业。')
    const open = async (address: string, assignment: { title: string; status?: string }, meta = {}) => {
      const expected = studentHomeworkUrl(address)!
      const isTarget = (url: string) => {
        const target = studentHomeworkUrl(url)
        return target?.work === expected.work && target.course === expected.course
          && (!expected.clazz || target.clazz === expected.clazz)
      }
      await ctx.wait(0)
      dispatched = true
      await ctx.navigateBrowserView(id, address)
      ctx.onNavigation?.()
      let landing: { url: string; top: boolean; title?: string; snapshot: string } | undefined
      let ready = false
      for (let attempt = 0; attempt < 14; attempt++) {
        await ctx.wait(300)
        const page = await ctx.readBrowserPage(id, { maxFrames: 4 })
        if (page.error) continue
        if (shortcut && page.url && chaoxingUrl(page.url)?.hostname === 'passport2.chaoxing.com') {
          return fail('verification_required', '学习通需要登录。登录后可从学生课程重新定位作业。', { loginRequired: true })
        }
        const top = Boolean(page.url && isTarget(page.url))
        const frame = page.frames?.find(item => isTarget(item.url))
        const url = top ? page.url : shortcut ? undefined : frame?.url
        const snapshot = top ? page.snapshot : frame?.snapshot
        landing = url ? { url, top, title: page.title, snapshot: snapshot?.trimEnd() || '' } : undefined
        if (!landing) continue
        if (page.url) ctx.syncPeekedUrl?.(id, page.url)
        const titleMatches = !shortcut || nameKey(page.title || '') === nameKey(assignment.title)
          || landing.snapshot.split('\n').some(line => line.trimStart().startsWith(`- heading ${JSON.stringify(assignment.title)} [`))
        if (titleMatches && homeworkContentReady(landing.snapshot)) { ready = true; break }
      }
      if (shortcut && !ready) return fail('verification_required', '快捷入口未核对到目标作业，请从学生课程的作业列表重新定位。')
      if (!landing) return fail('verification_required', '已打开作业入口，尚未核对到目标作业页面。请读取当前页确认。')
      const lines = landing.snapshot ? landing.snapshot.split('\n') : []
      return JSON.stringify({ ok: true, opened: true, assignment, title: landing.title, path: new URL(landing.url).pathname,
        ...(landing.top && ready ? { url: landing.url } : {}),
        snapshot: lines.length ? lines.slice(0, 100).join('\n') : undefined,
        ...(lines.length > 100 ? { snapshotTruncated: true } : {}), ...(!ready ? { snapshotPending: true } : {}), ...meta,
        hint: ready ? '作业已打开。只要求进入时可直接收尾；后续操作可使用这份快照的 ref。'
          : '已核对进入作业，正文暂未就绪。后续操作需要正文时，使用 browser_get_page 重新读取。' })
    }
    if (shortcut) {
      if (!studentHomeworkUrl(shortcut)) return fail('invalid', '请使用本地经验里已核对的学习通学生作业顶层网址。')
      return await open(shortcut, { title: query })
    }
    if (courseName) {
      const result = await handleWebsiteCourseTools({ ...ctx, name: 'browser_open_course', args: { course_name: courseName, teacher: ctx.args.teacher } })
      if (!result || JSON.parse(result).opened !== true) return result
    }
    const currentUrl = await ctx.liveHref(id)
    if (chaoxingUrl(currentUrl)?.hostname === 'passport2.chaoxing.com') {
      return fail('invalid', '学习通需要登录。请先完成登录再读取课程作业。', { loginRequired: true })
    }
    const course = studentCourseUrl(currentUrl)
    if (!course) return fail('invalid', '请先进入学习通学生课程，或指定 course_name。')
    const belongs = (address: string) => {
      const target = studentHomeworkUrl(address)
      return target && target.course === course.id && (!course.clazz || course.clazz === target.clazz) ? target : null
    }
    const { result: rules } = await runWebsiteScript(site, 'chaoxing', 'homework', { operation: 'list_rules' }, homeworkListRules, { reuseForMs: 30_000 })
    const probe = readStudentHomeworkScript(rules)
    const readList = async (frame: Frame): Promise<List | null> => {
      const data = await evalBrowserViewInFrame(id, probe, '', { frameId: frame.frameId!, loaderId: frame.loaderId })
      if (!Array.isArray(data?.entries) || !Number.isInteger(data.page)) return null
      const entries = data.entries.filter((row: Entry) => row.title && belongs(row.address)) as Entry[]
      if ((!entries.length && !data.empty) || entries.length !== data.entries.length) return null
      return { frame, entries, page: data.page, previous: data.previous, next: data.next }
    }
    const findList = async (allowTabClick: boolean) => {
      const page = await ctx.readBrowserPage(id, { maxFrames: 4 })
      const frames = (page.frames ?? []).filter(frame => frame.frameId && frame.loaderId && isStudentHomeworkList(frame.url, course))
      if (frames.length === 1) return readList(frames[0]).catch(() => null)
      if (frames.length > 1 || !allowTabClick) return null
      const refs = listCachedPageRefs(id).filter(ref => ref.name === rules.tabName && /^(link|button|tab)$/.test(ref.role)
        && !ref.disabled && !ref.locator.framePath && ref.locator.frameId && ref.locator.loaderId)
      if (refs.length !== 1) return null
      await ctx.wait(0)
      return (await ctx.clickByLocator(id, refs[0].locator)).ok ? 'clicked' as const : null
    }
    let list: List | null = null
    let clickedTab = false
    for (let attempt = 0; attempt < 10 && !list; attempt++) {
      await ctx.wait(attempt ? 250 : 0)
      const found = await findList(!clickedTab)
      if (found === 'clicked') clickedTab = true
      else list = found
    }
    if (!list) return fail('not_found', '没有读到已加载的作业列表，请查看当前课程的「作业」页。')
    const move = async (before: List, direction: 'previous' | 'next') => {
      const selector = direction === 'next' ? rules.nextButton : rules.previousButton
      await scopedClick(before.frame, selector)
      const expected = before.page + (direction === 'next' ? 1 : -1)
      const signature = before.entries.map(row => belongs(row.address)?.work).join(',')
      let frame = before.frame
      for (let attempt = 0; attempt < 10; attempt++) {
        await ctx.wait(200)
        let next = await readList(frame).catch(() => null)
        if (!next && (attempt === 3 || attempt === 7)) {
          const found = await findList(false)
          next = found === 'clicked' ? null : found
          if (next) frame = next.frame
        }
        if (next?.page === expected && next.entries.map(row => belongs(row.address)?.work).join(',') !== signature) return next
      }
      return null
    }
    const goToPage = async (before: List, page: number) => {
      let current = before
      for (let step = 0; step < pageLimit && current.page !== page; step++) {
        const direction = current.page < page ? 'next' : 'previous'
        if (!current[direction]) return null
        const next = await move(current, direction)
        if (!next) return null
        current = next
      }
      return current.page === page ? current : null
    }
    const first = await goToPage(list, 1)
    if (!first) return fail('stale', '未能定位到作业列表第一页。')

    let current = first
    const entries: Array<Entry & { page: number }> = []
    const seen = new Set<string>()
    for (let step = 0; step < pageLimit; step++) {
      for (const item of current.entries) {
        const key = belongs(item.address)!.work
        if (seen.has(key)) continue
        seen.add(key)
        entries.push({ ...item, page: current.page })
      }
      if (!current.next || step === pageLimit - 1) break
      const next = await move(current, 'next')
      if (!next) break
      current = next
    }
    const script = await runWebsiteScript(site, 'chaoxing', 'homework', {
      operation: opening ? 'open' : 'list', query,
      assignments: entries.map(({ title }, index) => ({ id: index, title })),
    }, output => {
      const result = output as { ids?: number[]; selected?: number } | null
      if (!Array.isArray(result?.ids) || result.ids.some(index => !Number.isInteger(index) || index < 0 || index >= entries.length)
        || new Set(result.ids).size !== result.ids.length || (result.selected !== undefined && (result.ids.length !== 1 || result.ids[0] !== result.selected))) {
        throw new Error('作业脚本结果不符合约定。')
      }
      return { ids: result.ids, selected: result.selected }
    })
    const matches = script.result.ids.map(index => entries[index])
    const publicRows = matches.map(({ title, status }) => ({ title, status }))
    const meta = { scriptRevision: script.revision, ...(script.cached ? { cachedScript: true } : {}) }
    if (!opening) {
      const offset = Math.max(0, Math.min(matches.length, Math.floor(Number(ctx.args.offset) || 0)))
      return JSON.stringify({ ok: true, assignments: publicRows.slice(offset, offset + 40), total: matches.length, partial: current.next,
        nextOffset: matches.length > offset + 40 ? offset + 40 : undefined, ...meta })
    }
    if (current.next) return fail('ambiguous', '作业列表还有未核对的分页，无法确认唯一匹配。', { assignments: publicRows.slice(0, 20) })
    const name = nameKey(query)
    const exact = entries.filter(item => nameKey(item.title) === name)
    const eligible = exact.length ? exact : entries.filter(item => nameKey(item.title).includes(name))
    if (!eligible.length) return fail('not_found', '当前课程没有找到这份作业。')
    if (eligible.length !== 1 || entries[script.result.selected ?? -1] !== eligible[0]) {
      return fail('ambiguous', '无法确认唯一作业，请提供可区分的完整名称。', { assignments: publicRows.slice(0, 20) })
    }
    const assignment = eligible[0]
    const chosenPage = await goToPage(current, assignment.page)
    const chosen = chosenPage && await readList(chosenPage.frame).catch(() => null)
    if (!chosen || !chosen.entries.some(row => row.address === assignment.address && row.title === assignment.title)) {
      return fail('stale', '作业列表已变化，请重新读取。')
    }
    // The site's row handler can open a separate window. Use the verified row URL in the Agent's tab.
    return await open(assignment.address, { title: assignment.title, status: assignment.status }, meta)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    return fail(dispatched ? 'verification_required' : 'invalid', error instanceof Error ? error.message : String(error))
  }
}
