import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { courseListRules, homeworkListRules } from './fixtures/studentListRules'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { state, readFrame, liveLocation, remembered } = vi.hoisted(() => ({
  state: { source: null as null | { url: string; manifest: string } },
  readFrame: vi.fn(), liveLocation: vi.fn(), remembered: vi.fn(() => []),
}))
vi.mock('../../src/services/agent/websiteRepository', () => ({ websiteScriptSource: async () => state.source }))
vi.mock('../../src/services/security/secureStore', () => ({ isNativeSecureStore: () => false }))
vi.mock('../../src/services/browser/eval', () => ({ evalBrowserViewInFrame: readFrame, evalBrowserViewMain: liveLocation }))
vi.mock('../../src/services/browser/engine', () => ({ listCachedPageRefs: remembered }))

import { runIsolatedWebsiteScript, runWebsiteScript, runWebsiteWorkflow } from '../../src/services/agent/websiteScripts'
import { handleWebsiteCourseTools } from '../../src/services/agent/tools/websiteCourses'
import { handleWebsiteHomeworkTools } from '../../src/services/agent/tools/websiteHomework'
import { studentCourseUrl } from '../../src/services/platform/chaoxing/studentCourses'

const serve = async () => {
  const source = { code: 'var ZErrorSiteScript = { run: ({courses}) => ({ ids: courses.map(c => c.id) }) };', revision: 'first', badHash: false }
  const server = createServer((request, response) => {
    const etag = `"${source.revision}"`
    if (request.url === '/manifest.json') {
      if (request.headers['if-none-match'] === etag) return response.writeHead(304).end()
      const hash = source.badHash ? 'a'.repeat(64) : createHash('sha256').update(source.code).digest('hex')
      response.writeHead(200, { ETag: etag, 'Content-Type': 'application/json' })
      const bundle = { url: './courses.js', sha256: hash }
      return response.end(JSON.stringify({ apiVersion: 1, siteId: 'chaoxing', revision: source.revision, bundles: { courses: bundle, homework: bundle } }))
    }
    if (request.url === '/courses.js') return response.writeHead(200).end(source.code)
    return response.writeHead(404).end()
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject).listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Missing test port')
  state.source = { url: `http://127.0.0.1:${address.port}/experience.json`, manifest: './manifest.json' }
  return { source, close: () => new Promise<void>(resolve => server.close(() => resolve())) }
}

afterEach(() => { state.source = null; vi.clearAllMocks() })

describe('external course scripts', () => {
  it('has no browser or network bindings and interrupts runaway code', async () => {
    expect(await runIsolatedWebsiteScript('var ZErrorSiteScript = {run: () => [typeof fetch, typeof document, typeof require]};', {}))
      .toEqual(['undefined', 'undefined', 'undefined'])
    await expect(runIsolatedWebsiteScript('while (true) {}', {})).rejects.toThrow('超时')
  })

  it('loads a new revision over HTTP and retains the last valid bundle on a hash failure', async () => {
    const { source, close } = await serve()
    try {
      const run = () => runWebsiteScript('chaoxing.com', 'chaoxing', 'courses', { courses: [{ id: 0 }] }, result => result)
      expect(await run()).toMatchObject({ result: { ids: [0] }, revision: 'first' })
      source.revision = 'second'
      source.code = 'var ZErrorSiteScript = { run: () => ({ ids: [] }) };'
      expect(await run()).toMatchObject({ result: { ids: [] }, revision: 'second' })
      source.revision = 'broken'
      source.badHash = true
      expect(await run()).toMatchObject({ result: { ids: [] }, revision: 'second', cached: true })
    } finally { await close() }
  })

  it('drives a pinned workflow through typed host steps without replaying an interrupted action', async () => {
    const { source, close } = await serve()
    source.code = 'var ZErrorSiteScript = {run: input => input.value, *workflow(){const issued = yield {op:"read"}; yield {op:"act", issued}; return {done: true}}};'
    try {
      const steps: unknown[] = []
      const result = await runWebsiteWorkflow('chaoxing.com', 'chaoxing', 'courses', {}, async (command, interpret) => {
        steps.push(command)
        return interpret({ value: 'current' })
      })
      expect(result).toEqual({ done: true })
      expect(steps).toEqual([{ op: 'read' }, { op: 'act', issued: 'current' }])

      const send = vi.fn(async (command: any) => {
        if (command.op === 'act') throw new Error('uncertain click')
        return 'current'
      })
      await expect(runWebsiteWorkflow('chaoxing.com', 'chaoxing', 'courses', {}, send)).rejects.toThrow('uncertain click')
      expect(send).toHaveBeenCalledTimes(2)
    } finally { await close() }
  })

  it('uses the actual student list for a direct open and verifies the landing', async () => {
    const { source, close } = await serve()
    source.code = `var ZErrorSiteScript = { run: ({operation, courses}) => operation === "list_rules" ? ${JSON.stringify(courseListRules)} : ({ ids: [courses[0].id], selected: courses[0].id }) };`
    const courseUrl = 'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=42&clazzid=7'
    const navigateBrowserView = vi.fn(async () => undefined)
    const clickByLocator = vi.fn(async () => ({ ok: true }))
    const snapshot = '- link "章节" [ref=e42]\n- link "作业" [ref=e43]'
    const readBrowserPage = vi.fn(async (_id: string, opts?: { maxFrames?: number }) => opts
      ? { url: courseUrl, title: '数据库基础', snapshot }
      : { frames: [{ url: 'https://mooc1-1.chaoxing.com/visit/courses', frameId: 'courses', loaderId: 'list-doc' }] })
    const ctx = {
      name: 'browser_open_course', args: { course_name: '数据库基础' }, browserId: 'tab',
      liveHref: async () => 'https://i.chaoxing.com/base',
      readBrowserPage,
      clickByLocator, navigateBrowserView, wait: async () => undefined,
    }
    try {
      readFrame.mockResolvedValueOnce({ student: false, courses: [] })
      readFrame.mockResolvedValue({ student: true, courses: [{ title: '数据库基础', href: courseUrl }] })
      liveLocation.mockResolvedValue(courseUrl)
      expect(JSON.parse((await handleWebsiteCourseTools(ctx))!)).toMatchObject({ ok: true, opened: true, course: { title: '数据库基础' }, title: '数据库基础', snapshot })
      expect(readBrowserPage.mock.calls.filter(([, opts]) => opts)).toEqual([['tab', { maxFrames: 2 }]])
      expect(clickByLocator).toHaveBeenCalledOnce()
      expect(clickByLocator.mock.calls[0]).toEqual(['tab', { by: 'css', value: '.tab-item[coursetype="1"]', frameId: 'courses', loaderId: 'list-doc' }])
      expect(navigateBrowserView.mock.calls).toEqual([['tab', courseUrl]])
      navigateBrowserView.mockClear()
      readBrowserPage.mockImplementation(async (_id, opts) => opts
        ? { url: courseUrl.replace('courseid=42', 'courseid=99'), title: '其他课程', snapshot }
        : { frames: [{ url: 'https://mooc1-1.chaoxing.com/visit/courses', frameId: 'courses', loaderId: 'list-doc' }] })
      const redirected = JSON.parse((await handleWebsiteCourseTools(ctx))!)
      expect(redirected).toMatchObject({ ok: false, reason: 'verification_required' })
      expect(redirected.snapshot).toBeUndefined()
      navigateBrowserView.mockClear()
      readFrame.mockResolvedValue({ student: true, courses: [{ title: '数据库基础', href: courseUrl }, { title: '数据库基础', href: courseUrl.replace('clazzid=7', 'clazzid=8') }] })
      expect(JSON.parse((await handleWebsiteCourseTools(ctx))!)).toMatchObject({ ok: false, reason: 'ambiguous' })
      expect(navigateBrowserView).not.toHaveBeenCalled()
    } finally { await close() }
  })

  it('rejects unrelated websites and teacher course URLs', () => {
    expect(studentCourseUrl('https://chaoxing.com.evil.test/visit/stucoursemiddle?courseid=42')).toBeNull()
    expect(studentCourseUrl('https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/tch?courseid=42')).toBeNull()
  })

  it('reads all homework pages before opening a unique row and returns only the verified landing snapshot', async () => {
    const { source, close } = await serve()
    source.code = `var ZErrorSiteScript = { run: ({operation, query, assignments}) => { if (operation === "list_rules") return ${JSON.stringify(homeworkListRules)}; const ids = assignments.filter(a => !query || a.title === query).map(a => a.id); return { ids, selected: operation === "open" && ids.length === 1 ? ids[0] : undefined }; } };`
    const course = 'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=42&clazzid=7'
    const list = 'https://mooc2-ans.chaoxing.com/mooc2/work/list?courseId=42&classId=7'
    const address = (work: number) => `https://mooc1.chaoxing.com/mooc-ans/mooc2/work/task?courseId=42&classId=7&workId=${work}`
    const snapshot = '- button "查看作业" [ref=e42]'
    let page = 1
    let landing = ''
    let landingReads = 0
    let secondTitle = '第二份作业'
    readFrame.mockImplementation(async () => ({ page, previous: page === 2, next: page === 1,
      entries: [{ title: page === 1 ? '第一份作业' : secondTitle, status: '已批阅', address: address(page) }] }))
    const clickByLocator = vi.fn(async (_id, locator) => {
      if (locator.value.includes('nextPage')) page++
      else if (locator.value.includes('prevPage')) page--
      return { ok: true }
    })
    const navigateBrowserView = vi.fn(async (_id, url) => { landing = url })
    const ctx = {
      name: 'browser_open_homework', args: { homework_name: '第二份作业' }, browserId: 'tab',
      liveHref: async () => course,
      readBrowserPage: async () => landing ? { url: landing, title: '作业', snapshot: ++landingReads === 1 ? '- link "返回" [ref=e1]' : snapshot }
        : { url: course, frames: [{ url: list, frameId: 'homework', loaderId: 'work-list' }] },
      clickByLocator, navigateBrowserView, wait: async () => undefined,
    }
    try {
      expect(JSON.parse((await handleWebsiteHomeworkTools({ ...ctx, name: 'browser_list_homework', args: {} }))!)).toMatchObject({
        ok: true, total: 2, partial: false, assignments: [{ title: '第一份作业' }, { title: '第二份作业' }],
      })
      expect(JSON.parse((await handleWebsiteHomeworkTools(ctx))!)).toMatchObject({ ok: true, opened: true, snapshot, assignment: { title: '第二份作业' } })
      expect(landingReads).toBe(2)
      expect(navigateBrowserView).toHaveBeenCalledExactlyOnceWith('tab', address(2))
      landing = ''
      secondTitle = '第一份作业'
      navigateBrowserView.mockClear()
      expect(JSON.parse((await handleWebsiteHomeworkTools({ ...ctx, args: { homework_name: '第一份作业' } }))!)).toMatchObject({ ok: false, reason: 'ambiguous' })
      expect(navigateBrowserView).not.toHaveBeenCalled()
    } finally { await close() }
  })

  it('opens a remembered student homework directly and verifies the top-level assignment', async () => {
    const { close } = await serve()
    const url = 'https://mooc1.chaoxing.com/mooc-ans/mooc2/work/task?courseId=42&classId=7&workId=5'
    const title = '第二份作业'
    const snapshot = '- heading "第二份作业" [ref=e1]\n- button "查看作业" [ref=e2]'
    const navigateBrowserView = vi.fn(async () => undefined)
    const readBrowserPage = vi.fn(async () => ({ url, title: '作业', snapshot }))
    const ctx = {
      name: 'browser_open_homework', args: { course_name: '数据库基础', homework_name: title, homework_url: url },
      browserId: 'tab', liveHref: vi.fn(async () => 'about:blank'), readBrowserPage,
      clickByLocator: vi.fn(async () => ({ ok: true })), navigateBrowserView, wait: async () => undefined,
    }
    try {
      expect(JSON.parse((await handleWebsiteHomeworkTools(ctx))!))
        .toMatchObject({ opened: true, url, assignment: { title }, snapshot })
      expect(navigateBrowserView).toHaveBeenCalledExactlyOnceWith('tab', url)
      expect(ctx.liveHref).not.toHaveBeenCalled()
      expect(readFrame).not.toHaveBeenCalled()

      readBrowserPage.mockResolvedValueOnce({ url: 'https://passport2.chaoxing.com/login', title: '登录', snapshot: '' })
      expect(JSON.parse((await handleWebsiteHomeworkTools(ctx))!)).toMatchObject({ ok: false, loginRequired: true })

      readBrowserPage.mockResolvedValue({ url, title: '作业', snapshot: snapshot.replace(title, '第一份作业') })
      expect(JSON.parse((await handleWebsiteHomeworkTools(ctx))!)).toMatchObject({ ok: false, reason: 'verification_required' })

      navigateBrowserView.mockClear()
      const external = url.replace('mooc1.chaoxing.com', 'mooc1.chaoxing.com.example.test')
      expect(JSON.parse((await handleWebsiteHomeworkTools({ ...ctx, args: { ...ctx.args, homework_url: external } }))!))
        .toMatchObject({ ok: false, reason: 'invalid' })
      expect(navigateBrowserView).not.toHaveBeenCalled()
    } finally { await close() }
  })
})
