import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { beforeEach, expect, it, vi } from 'vitest'

const { html, protocol, click, evaluate, resolveScript, watch, watchFor, pin, appFocus } = vi.hoisted(() => ({
  html: vi.fn(), protocol: vi.fn(), click: vi.fn(), evaluate: vi.fn(), resolveScript: vi.fn(),
  watch: vi.fn(), watchFor: vi.fn(), pin: vi.fn(), appFocus: vi.fn(),
}))
vi.mock('@tauri-apps/api/window', () => ({ getCurrentWindow: () => ({ isFocused: appFocus }) }))
vi.mock('../../src/services/browser/domRead', () => ({ readFrameHtml: html, parseHtml: (markup: string) => new JSDOM(markup).window.document }))
vi.mock('../../src/services/browser/protocol', async load => ({
  ...await load<typeof import('../../src/services/browser/protocol')>(), callProtocol: protocol,
}))
vi.mock('../../src/services/browser/engine', () => ({ actOnceOnBrowser: click }))
vi.mock('../../src/services/browser/eval', () => ({ waitMs: async () => {}, evalBrowserViewInFrame: evaluate }))
vi.mock('../../src/services/agent/websiteScripts', () => ({ runWebsiteScript: resolveScript }))
vi.mock('../../src/services/chaoxing/browser/watch', () => ({ startChaoxingWatch: watch }))
vi.mock('../../src/services/platform/panelAccess', () => ({ videoWatchFor: watchFor }))
vi.mock('../../src/services/chaoxing/study/video', async load => ({
  ...await load<typeof import('../../src/services/chaoxing/study/video')>(),
  pinChaoxingPlayMid: pin,
}))

import { watchExistingChapterVideo } from '../../src/services/platform/chaoxing/chapterPlayback'
import { handleWebsiteChapterTools } from '../../src/services/agent/tools/websiteChapters'
import { startWebsiteChapterTasks } from '../../src/services/agent/tools/websiteChapterStart'
import { openNextWebsiteChapter } from '../../src/services/agent/tools/websiteChapterDirectory'
import { chapterCardJobs, chapterHeader, studentChapterUrl } from '../../src/services/chaoxing/host/chapterTasks'

const chapterUrl = 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=1065429967&courseId=257080147&clazzid=131924538'
const cardPath = '/mooc-ans/knowledge/cards?clazzid=131924538&courseid=257080147&knowledgeid=1065429967'
const chapterKey = '257080147:131924538:1065429967'
const context = { browserId: 'tab', sessionId: 'chat' }
const fixture = (file: string) => readFileSync(new URL(`../chaoxing/study/fixtures/${file}.html`, import.meta.url), 'utf8')
const run = async (name: 'review' | 'complete', args: Record<string, unknown> = {}) =>
  JSON.parse(await handleWebsiteChapterTools({ ...context, name: `browser_${name}_chapter`, args }))

const lesson = (kind: string, mid: string, done = false) =>
  `<div class="ans-attach-ct"><span class="ans-job-icon" aria-label="任务点${done ? '已' : '未'}完成"></span><iframe src="/ananas/modules/${kind}/index.html" mid="${mid}" jobid="job-${mid}"></iframe></div>`

function openChapter(jobs: string, options: { remaining?: number; mismatched?: boolean; tab?: number; staleSrc?: boolean } = {}) {
  let tab = options.tab ?? 1
  const position = () => `${cardPath}&num=${tab - 1}`
  const root = () => `<div class="posCatalog_select posCatalog_active" id="cur1065429967">
    <span class="posCatalog_name" title="高阶导数"><em class="posCatalog_sbar">2.6</em></span>
    ${options.remaining === undefined ? '' : `<input class="jobUnfinishCount" value="${options.remaining}">`}
    </div><div id="prev_tab"><ul class="prev_ul"><li class="${tab === 1 ? 'active' : ''}" cardid="1" id="dct1"></li>
    <li class="${tab === 2 ? 'active' : ''}" cardid="2" id="dct2"></li></ul></div><iframe id="iframe" src="${options.staleSrc ? cardPath + '&num=0' : position()}"></iframe>`
  html.mockImplementation(async (_id, frame) => frame ? {
    ok: true, url: new URL(options.mismatched ? position().replace('1065429967', '9') : position(), chapterUrl).href,
    html: `<div id="pageDiv" class="ans-cc">${jobs}</div>`, frameId: 'cards',
  } : { ok: true, url: chapterUrl, html: root(), frameId: 'root' })
  protocol.mockResolvedValue({ frames: [{ url: chapterUrl, frameId: 'root', loaderId: 'student-doc' }] })
  click.mockImplementation(async () => { tab = 2; return { ok: true, dispatched: true } })
}

beforeEach(() => {
  vi.resetAllMocks()
  evaluate.mockResolvedValue(true)
  watch.mockReturnValue({ status: 'watching' })
  resolveScript.mockImplementation(async (_host, _site, _capability, input, validate) => {
    const index = input.jobs.findIndex((job: { done: boolean; kind: string }) => !job.done && (!input.videoOnly || job.kind === 'video'))
    const proposed = input.remaining === 0 ? { action: 'complete' }
      : !input.loaded ? { action: 'loading' }
      : input.targetTab !== null ? { action: 'tab', tab: input.targetTab }
      : index >= 0 ? { action: input.jobs[index].kind, index }
      : input.nextTab !== null ? { action: 'tab', tab: input.nextTab }
      : { action: 'pending' }
    return { result: validate(proposed), revision: 'test' }
  })
})

it('reads only real task points and resolves the active chapter from captured Chaoxing pages', () => {
  const top = new JSDOM(fixture('studentstudy')).window.document
  const cards = new JSDOM(fixture('studentstudy-cards')).window.document
  expect(chapterHeader(top, studentChapterUrl(chapterUrl)!)).toMatchObject({ number: '2.6', remaining: 1, tab: 1 })
  expect(chapterCardJobs(cards)?.map(job => job.kind)).toEqual(['video', 'quiz', 'video'])
})

it('reviews the live chapter tab without a downloaded script or page action', async () => {
  openChapter(lesson('video', 'mid-a'), { remaining: 1, tab: 2, staleSrc: true })
  expect(await run('review')).toMatchObject({ chapterKey, chapterComplete: false, tab: 2, jobs: [{ index: 1, kind: 'video', done: false }] })
  expect(resolveScript).not.toHaveBeenCalled()
  expect(click).not.toHaveBeenCalled()
})

it('plays and monitors exactly the selected pending video using the fresh player document', async () => {
  const tasks = lesson('video', 'mid-a', true) + lesson('video', 'mid-b') + lesson('work', 'work-c')
  openChapter(tasks, { remaining: 2 })
  const tick = { mid: 'mid-b', current: 10, duration: 300, paused: true, ended: false, hasVideo: true, frameId: 'player-b', loaderId: 'video-doc' }
  protocol.mockResolvedValueOnce(tick).mockResolvedValueOnce({ ...tick, current: 11, paused: false })
  click.mockResolvedValue({ ok: true, dispatched: true })
  expect(await run('complete', { chapter_key: chapterKey })).toMatchObject({ status: 'watching', watching: true, job: { index: 2 } })
  expect(click).toHaveBeenCalledExactlyOnceWith('tab', expect.objectContaining({ frameId: 'player-b', loaderId: 'video-doc' }), 'click')
  expect(protocol).toHaveBeenNthCalledWith(1, 'tab', 'media_tick', { mid: 'mid-b' })
  expect(watch).toHaveBeenCalledWith('tab', 'chat', expect.objectContaining({ mid: 'mid-b' }), { recoverPause: expect.any(Function) })
  expect(JSON.stringify(resolveScript.mock.calls[0][3])).not.toMatch(/mid-b|chaoxing.com|work-c/)
})

it('waits for platform credit after the named video ends and does not replay it', async () => {
  openChapter(lesson('video', 'mid-b'), { remaining: 1 })
  protocol.mockResolvedValue({ mid: 'mid-b', ended: true, paused: true, hasVideo: true })
  expect(await run('complete', { chapter_key: chapterKey })).toMatchObject({ status: 'awaiting_credit', chapterComplete: false })
  expect(click).not.toHaveBeenCalled()
  expect(watch).not.toHaveBeenCalled()
})

it('checks the target chapter and frame before handing off the pending quiz', async () => {
  openChapter(lesson('work', 'quiz') + lesson('video', 'vid'), { remaining: 2 })
  expect(await run('complete', { chapter_key: 'other' })).toMatchObject({ ok: false, reason: 'stale' })
  expect(await run('complete', { chapter_key: chapterKey })).toMatchObject({ status: 'needs_quiz', job: { kind: 'quiz', index: 1 } })
  expect(evaluate).toHaveBeenCalledExactlyOnceWith('tab', expect.stringContaining('scrollIntoView'), '', { frameId: 'cards' })
  expect(click).not.toHaveBeenCalled()

  openChapter(lesson('work', 'quiz'), { remaining: 2, mismatched: true })
  expect(await run('complete', { chapter_key: chapterKey })).toMatchObject({ status: 'loading', loaded: false, jobs: [] })
  expect(evaluate).toHaveBeenCalledTimes(1)
})

it('switches only a verified same-chapter tab and rejects unverified completion from a bundle', async () => {
  openChapter(lesson('video', 'vid', true), { remaining: 1 })
  expect(await run('complete', { chapter_key: chapterKey })).toMatchObject({ status: 'tab_changed', tab: 2 })
  expect(click).toHaveBeenCalledExactlyOnceWith('tab', {
    by: 'css', value: '#prev_tab .prev_ul > li#dct2', frameId: 'root', loaderId: 'student-doc',
  }, 'click')

  resolveScript.mockImplementation(async (_host, _site, _capability, _input, validate) => ({ result: validate({ action: 'complete' }) }))
  expect(await run('complete', { chapter_key: chapterKey })).toMatchObject({ ok: false, reason: 'invalid' })
  expect(click).toHaveBeenCalledTimes(1)
})

it('does not infer completion from an empty list or a missing catalog count', async () => {
  openChapter('', { tab: 2 })
  expect(await run('complete', { chapter_key: chapterKey })).toMatchObject({ status: 'pending', remaining: null, chapterComplete: false })
  openChapter('', { remaining: 0 })
  expect(await run('complete', { chapter_key: chapterKey })).toMatchObject({ status: 'complete', remaining: 0, chapterComplete: true })
})

it('credits a document only when the chapter status changes after revealing it', async () => {
  const options = { remaining: 1 }
  openChapter(lesson('pdf', 'doc-a'), options)
  expect(await run('complete', { chapter_key: chapterKey })).toMatchObject({
    status: 'needs_document', chapterComplete: false, job: { kind: 'document', done: false },
  })
  evaluate.mockImplementation(async () => {
    options.remaining = 0
    return true
  })
  expect(await run('complete', { chapter_key: chapterKey })).toMatchObject({
    status: 'complete', chapterComplete: true, job: { kind: 'document', done: true },
  })
  expect(click).not.toHaveBeenCalled()
})

it('uses the real completed badge and opens the first visibly pending chapter from the sidebar', async () => {
  const current = new JSDOM(
    '<div class="posCatalog_select posCatalog_active" id="cur1065429967"><span class="posCatalog_name">已学小节</span><span class="icon_Completed prevTips"><span>已完成</span></span></div>',
  ).window.document.body.innerHTML
  expect(chapterHeader(new JSDOM(current).window.document, studentChapterUrl(chapterUrl)!)?.remaining).toBe(0)
  const nextId = '1065429988'
  const nextPage = chapterUrl.replace('1065429967', nextId)
  let live = chapterUrl
  html.mockImplementation(async () => ({
    ok: true, url: live, frameId: 'root',
    html: `<div id="coursetree">${current}
      <div class="posCatalog_select" id="cur1065429987"><span class="posCatalog_name">状态未标记</span></div>
      <div class="posCatalog_select" id="cur${nextId}"><span class="posCatalog_name">接着学</span><input class="jobUnfinishCount" value="2"></div>
      </div>`,
  }))
  protocol.mockResolvedValue({ frames: [{ frameId: 'root', loaderId: 'chapter-doc', url: chapterUrl }] })
  click.mockImplementation(async () => { live = nextPage; return { ok: true, dispatched: true } })

  expect(JSON.parse(await openNextWebsiteChapter(context))).toMatchObject({
    opened: true, chapterKey: '257080147:131924538:' + nextId, remaining: 2, pending: 1,
  })
  expect(click).toHaveBeenCalledExactlyOnceWith('tab', {
    by: 'css', value: `#coursetree .posCatalog_select[id="cur${nextId}"] .posCatalog_name`,
    frameId: 'root', loaderId: 'chapter-doc',
  }, 'click')
})

it('starts the visible player before it has focus, while recovery waits for focus', async () => {
  const task = lesson('video', 'mid-b').replace('jobid=', 'switchwindow="true" jobid=')
  openChapter(task, { remaining: 1 })
  const paused = { mid: 'mid-b', current: 50, duration: 100, paused: true, ended: false, hasVideo: true, frameId: 'player-b', loaderId: 'doc-b' }
  protocol.mockResolvedValue(paused)
  evaluate.mockResolvedValue(false)
  click.mockImplementation(async () => {
    protocol.mockResolvedValue({ ...paused, paused: false })
    return { ok: true, dispatched: true }
  })
  expect(await run('complete', { chapter_key: chapterKey })).toMatchObject({ status: 'watching' })
  expect(evaluate).not.toHaveBeenCalled()
  expect(click).toHaveBeenCalledOnce()

  click.mockClear()
  const recover = watch.mock.calls[0][3].recoverPause
  appFocus.mockResolvedValueOnce(false).mockResolvedValue(true)
  const { window } = new JSDOM(`<div class="video-js vjs-paused"><video></video>
    <button class="vjs-big-play-button"></button><button class="vjs-play-control vjs-paused"></button></div>`, { runScripts: 'outside-only' })
  const resume = vi.fn(() => protocol.mockResolvedValue({ ...paused, paused: false }))
  window.document.querySelector('.vjs-play-control')!.addEventListener('click', resume)
  evaluate.mockImplementation(async (_id, script) => script.includes('document.visibilityState')
    ? { visible: true, focused: false }
    : window.eval(script))
  protocol.mockResolvedValue(paused)
  expect(await recover(() => true)).toMatchObject({ mid: 'mid-b', paused: false })
  expect(appFocus).toHaveBeenCalledTimes(2)
  expect(resume).toHaveBeenCalledOnce()
  expect(click).not.toHaveBeenCalled()
  expect(evaluate).toHaveBeenLastCalledWith('tab', expect.stringContaining('control.click()'), '', { frameId: 'player-b', loaderId: 'doc-b' })
})

it('reads the real studentcourse task counters and opens the pending chapter from its own frame', async () => {
  const course = 'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=257080147&clazzid=131924538&pageHeader=1'
  const directory = 'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse?courseid=257080147&clazzid=131924538&ut=s'
  const row = (id: string, title: string, number: string, task: string) => `<div class="chapter_item" id="cur${id}" title="${title}">
    <div class="catalog_title" role="link"><div class="catalog_name"><a class="clicktitle"><span class="catalog_sbar">${number}</span> ${title}</a></div>
    <div class="catalog_task">${task}</div></div></div>`
  const htmlOfDirectory = row('1065429966', '函数', '2.2', '<div class="catalog_state icon_yiwanc">已完成</div>')
    + row('1065429967', '高阶导数', '2.3', '<input type="hidden" value="2" class="knowledgeJobCount"><div class="catalog_jindu"><span class="catalog_points_yi">2</span><span class="bntHoverTips">2个待完成任务点</span></div>')
    + row('1065429968', '状态未知', '2.4', '')
  let frameUrl = directory
  let current = course
  html.mockImplementation(async (_id, frame) => frame ? {
    ok: true, url: frameUrl, frameId: 'course-list', html: htmlOfDirectory,
  } : { ok: true, url: current, frameId: 'shell', html: '<main>推理社</main>' })
  protocol.mockResolvedValue({ url: course, frames: [{ url: directory, frameId: 'course-list', loaderId: 'catalog-doc' }] })
  click.mockImplementation(async () => { current = chapterUrl; return { ok: true, dispatched: true } })

  frameUrl = directory.replace('clazzid=131924538', 'clazzid=9')
  expect(JSON.parse(await openNextWebsiteChapter(context))).toMatchObject({ ok: false, reason: 'not_found' })
  expect(click).not.toHaveBeenCalled()

  frameUrl = directory
  expect(JSON.parse(await openNextWebsiteChapter(context))).toMatchObject({
    opened: true, chapterKey, number: '2.3', title: '高阶导数', remaining: 2, pending: 1, completed: 1, unknown: 1,
  })
  expect(protocol).toHaveBeenCalledWith('tab', 'snapshot', { acted: true, maxFrames: 1, frame: 'course-list' })
  expect(click).toHaveBeenCalledExactlyOnceWith('tab', {
    by: 'css', value: '.chapter_item[id="cur1065429967"] > .catalog_title[role="link"]',
    frameId: 'course-list', loaderId: 'catalog-doc',
  }, 'click')
})

it('opens the directory and starts the first video in one host call', async () => {
  const course = 'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/stu?courseid=257080147&clazzid=131924538'
  const directory = 'https://mooc2-ans.chaoxing.com/mooc2-ans/mycourse/studentcourse?courseid=257080147&clazzid=131924538&ut=s'
  const emptyFrame = { ok: false, url: '', frameId: '', html: '' }
  const frameHref = new URL(cardPath + '&num=0', chapterUrl).href
  const selected = '<div class="posCatalog_select posCatalog_active" id="cur1065429967"><span class="posCatalog_name">高阶导数</span><input class="jobUnfinishCount" value="1"></div>'
  const row = '<div class="chapter_item" id="cur1065429967" title="高阶导数"><div class="catalog_title" role="link"><div class="catalog_task"><input class="knowledgeJobCount" value="1"></div></div></div>'
  let stage = 'course'
  html.mockImplementation(async (_id, frame) => {
    if (frame === '/mycourse/studentcourse') return stage === 'directory' ? { ok: true, url: directory, frameId: 'directory', html: row } : emptyFrame
    if (frame === 'knowledge/cards') return { ok: true, url: frameHref, frameId: 'cards', html: `<div class="ans-cc">${lesson('video', 'mid-a')}</div>` }
    return stage === 'chapter' || stage === 'playing'
      ? { ok: true, url: chapterUrl, frameId: 'chapter', html: `${selected}<iframe id="iframe" src="${frameHref}"></iframe>` }
      : { ok: true, url: course, frameId: 'course', html: '<title>推理社</title>' }
  })
  protocol.mockImplementation(async (_id, op, opts) => op === 'snapshot'
    ? { url: course, frames: opts.frame
      ? [{ frameId: 'directory', loaderId: 'catalog-doc', url: directory }]
      : [{ frameId: 'course', loaderId: 'course-doc', url: course }] }
    : { mid: 'mid-a', duration: 100, current: 12, paused: stage !== 'playing', hasVideo: true, frameId: 'player', loaderId: 'player-doc' })
  click.mockImplementation(async (_id, locator) => {
    if (locator.frameId === 'course' && stage === 'course') stage = 'directory'
    else if (locator.frameId === 'directory' && stage === 'directory') stage = 'chapter'
    else if (locator.frameId === 'player' && stage === 'chapter') stage = 'playing'
    else throw new Error('Unexpected click target')
    return { ok: true, dispatched: true }
  })
  const onNavigation = vi.fn()
  const courseLookup = vi.fn()
  expect(JSON.parse(await startWebsiteChapterTasks({ ...context, name: 'browser_start_chapter_tasks',
    args: { course_name: '推理社' }, wait: async () => {}, onNavigation,
    liveHref: courseLookup, readBrowserPage: courseLookup, navigateBrowserView: courseLookup, clickByLocator: courseLookup,
  }))).toMatchObject({ ok: true, scope: 'course', chapterKey, opened: true, status: 'watching', watching: true })
  expect(courseLookup).not.toHaveBeenCalled()
  expect(onNavigation).toHaveBeenCalledOnce()
  expect(click.mock.calls.map(call => call[1].frameId)).toEqual(['course', 'directory', 'player'])
})

it('registers the same recovery when an already playing chapter is handed to browser_watch', async () => {
  openChapter(lesson('video', 'mid-b'), { remaining: 1 })
  const tick = { mid: 'mid-b', current: 50, duration: 100, paused: false, ended: false, hasVideo: true }
  expect(await watchExistingChapterVideo('tab', 'chat', { ...tick, mid: 'another-player' })).toBe(false)
  expect(await watchExistingChapterVideo('tab', 'chat', tick)).toBe(true)
  expect(watch).toHaveBeenCalledExactlyOnceWith('tab', 'chat', expect.objectContaining({ mid: 'mid-b' }), { recoverPause: expect.any(Function) })
  expect(click).not.toHaveBeenCalled()
})
