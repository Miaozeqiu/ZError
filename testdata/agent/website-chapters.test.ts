import { readFileSync } from 'node:fs'
import { JSDOM } from 'jsdom'
import { chapterRules, jobKinds } from './fixtures/chapterRules'
import type { WebsiteChapterRules } from '../../src/services/browser/websiteChapterRules'
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
vi.mock('../../src/services/agent/websiteScripts', () => ({
  runWebsiteScript: resolveScript,
  runWebsiteWorkflow: async (_host: string, _site: string, _capability: string,
    args: { currentOnly: boolean; allowQuiz: boolean }, send: (command: unknown) => Promise<any>) => {
    for (let i = 0; i < 20; i++) {
      const result = await send({ op: 'process' })
      if (result.ok && result.status === 'needs_quiz' && args.allowQuiz) {
        await send({ op: 'quiz' })
        break
      }
      if (result.ok && result.status === 'complete' && !args.currentOnly) {
        if (!(await send({ op: 'next' })).opened) break
        continue
      }
      if (result.ok && ['tab_changed', 'job_completed', 'discussion_completed'].includes(result.status)) continue
      if (result.status !== 'loading' && !result.retryable) break
      await send({ op: 'wait' })
    }
    return { done: true }
  },
}))
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
import { chapterAttachments, chapterCardJobs, chapterHeader, studentChapterUrl } from '../../src/services/chaoxing/host/chapterTasks'
import { handleWebsiteChapterDiscussion } from '../../src/services/agent/tools/websiteChapterDiscussion'
import { isDiscussionReplyGoal, permitsChapterDiscussionReply } from '../../src/services/agent/chapterDiscussionIntent'

const fixtureRules = chapterRules satisfies WebsiteChapterRules
const classify = (sources: string[]) => sources.map(src => jobKinds.find(([, pattern]) => new RegExp(pattern, 'i').test(src))?.[0] ?? 'unknown')
const probe = (input: { operation?: string; sources?: string[] }) => input.operation === 'page_rules' ? fixtureRules
  : input.operation === 'classify_jobs' ? classify(input.sources ?? []) : undefined

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
    if (input.operation) return { result: validate(probe(input)), revision: 'test' }
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
  expect(chapterHeader(top, studentChapterUrl(chapterUrl)!, fixtureRules)).toMatchObject({ number: '2.6', remaining: 1, tab: 1 })
  const attachments = chapterAttachments(cards, fixtureRules)!
  expect(chapterCardJobs(attachments, fixtureRules, classify(attachments.map(item => item.iframe?.getAttribute('src') || ''))).map(job => job.kind)).toEqual(['video', 'quiz', 'video'])
})

function openDiscussion(mid: string, options: { remaining: number }, course = '257080147') {
  const card = { frameId: 'bbs-card', loaderId: 'bbs-doc',
    url: `https://mooc1.chaoxing.com/mooc-ans/bbscircle/chapter?mtopicid=${mid}&knowledgeid=1065429967&ut=s&courseid=257080147&clazzId=131924538` }
  const topic = { frameId: 'bbs-topic', loaderId: 'topic-doc',
    url: `https://groupweb.chaoxing.com/course/topic/v3/bbs/course-board/topic-${mid}/replysList?courseId=${course}&classId=131924538` }
  openChapter(`<div class="ans-attach-ct"><span class="ans-job-icon"></span><iframe src="/ananas/modules/insertbbs/index.html"
    _src="${card.url.replaceAll('&', '&amp;')}" data='{"title":"章节讨论","mid":"${mid}"}'></iframe></div>`, options)
  const { window } = new JSDOM(`<div id="subPageMain">
    <div class="topicDetail_detail"><div class="topicDetail_title">怎样证明这个结论？</div>
    <div class="topicDetail_main"><div class="richText">请结合一个具体例子。</div></div></div>
    <div class="topicDetail_replyWrap"><div class="topicDetail_replyList">
      <div class="topicDetail_replyItem" id="student-a"><div class="topicReply_right">
        <div class="otherInfo">学生姓名</div><div class="replyContent">可以从定义出发。</div></div></div></div></div>
    <div class="topicDetail_editContainer"><div class="replyEdit"><div class="textareawrap"><textarea></textarea></div></div>
      <div class="replyEditBtnGroup"><div class="addReply">回复</div></div></div></div>`, { url: topic.url, runScripts: 'outside-only' })
  const cards = { frameId: 'cards', loaderId: 'cards-doc', url: new URL(cardPath + '&num=0', chapterUrl).href }
  protocol.mockImplementation(async (_id, op, params) => op === 'snapshot' ? { frames: [cards] }
    : { frames: [params.locator.value.includes('data-ze-discussion') ? topic : card] })
  evaluate.mockImplementation(async (_id, script, _hint, frame) => {
    if (frame.frameId === cards.frameId) return true
    if (frame.frameId === card.frameId) return script.includes('location.reload()') ? null : { href: topic.url, done: false }
    return window.eval(script)
  })
  const field = window.document.querySelector('textarea')!
  const list = window.document.querySelector('.topicDetail_replyList')!
  const post = (content: string) => {
    const item = window.document.createElement('div')
    item.className = 'topicDetail_replyItem'
    item.id = 'posted-item'
    item.innerHTML = '<div class="topicReply_right"><div class="replyContent"></div></div>'
    item.querySelector('.replyContent')!.textContent = content
    list.prepend(item)
  }
  const invoke = (reply?: string) => handleWebsiteChapterDiscussion({
    browserId: 'tab', wait: async () => {},
    name: reply === undefined ? 'browser_review_chapter_discussion' : 'browser_reply_chapter_discussion',
    args: { chapter_key: chapterKey, tab: 1, discussion_id: mid, reply },
  }).then(JSON.parse)
  return { field, post, invoke }
}

it('returns the pending discussion directly from the chapter workflow and sends through the bound form once', async () => {
  const options = { remaining: 1 }
  const { field, post, invoke } = openDiscussion('1234567801', options)
  const result = JSON.parse(await startWebsiteChapterTasks({
    name: 'browser_start_chapter_tasks', ...context, args: { current_only: true }, wait: async () => {},
    graphUrlOf: async () => '', liveHref: async () => chapterUrl, onNavigation: () => {},
  } as Parameters<typeof startWebsiteChapterTasks>[0]))
  expect(result).toMatchObject({ status: 'needs_discussion', discussion_id: '1234567801', discussion: {
    title: '怎样证明这个结论？', question: '请结合一个具体例子。', replies: ['可以从定义出发。'], canReply: true,
  } })
  expect(JSON.stringify(result)).not.toContain('学生姓名')
  expect(click).not.toHaveBeenCalled()
  click.mockImplementation(async (_id, locator, action, text) => {
    expect(locator).toMatchObject({ frameId: 'bbs-topic', loaderId: 'topic-doc' })
    if (action === 'fill') field.value = text
    else {
      post(field.value)
      options.remaining = 0
    }
    return { ok: true, dispatched: true }
  })
  expect(await invoke('例如，先验证边界条件，再使用定义证明。')).toMatchObject({ status: 'discussion_completed', jobDone: true, posted: true })
  expect(await invoke('例如，先验证边界条件，再使用定义证明。')).toMatchObject({ status: 'discussion_completed', jobDone: true })
  expect(click.mock.calls.map(call => call[2])).toEqual(['fill', 'click'])
})

it('distinguishes a visible reply from platform credit and does not resend to a pending topic', async () => {
  const { field, post, invoke } = openDiscussion('1234567802', { remaining: 1 })
  click.mockImplementation(async (_id, _locator, action, text) => {
    if (action === 'fill') field.value = text
    else post(field.value)
    return { ok: true, dispatched: true }
  })
  expect(await invoke('用两个不同的例子验证。')).toMatchObject({ status: 'awaiting_discussion_credit', posted: true, jobDone: false })
  expect(await invoke()).toMatchObject({ status: 'awaiting_discussion_credit', posted: true, jobDone: false })
  expect(await invoke('再发一条。')).toMatchObject({ ok: false, reason: 'verification_required' })
  expect(click.mock.calls.map(call => call[2])).toEqual(['fill', 'click'])
})

it('requires a fresh observation after an unanswered send instead of clicking again', async () => {
  const { field, invoke } = openDiscussion('1234567805', { remaining: 1 })
  click.mockImplementation(async (_id, _locator, action, text) => {
    if (action === 'fill') field.value = text
    return { ok: action === 'fill', dispatched: true }
  })
  expect(await invoke('对发送状态仍需核对。')).toMatchObject({ ok: false, reason: 'unstable', clickDispatched: true })
  expect(await invoke()).toMatchObject({ ok: true, status: 'discussion_unverified' })
  expect(await invoke('对发送状态仍需核对。')).toMatchObject({ ok: false, reason: 'verification_required', clickDispatched: false })
  expect(click.mock.calls.map(call => call[2])).toEqual(['fill', 'click'])
})

it('leaves drafts intact and rejects a discussion page linked to a different course', async () => {
  const wrong = openDiscussion('1234567803', { remaining: 1 }, '1')
  expect(await wrong.invoke('这条不能发出。')).toMatchObject({ ok: false, reason: 'not_found' })
  const correct = openDiscussion('1234567804', { remaining: 1 })
  correct.field.value = '原有草稿'
  expect(await correct.invoke('这条也不能发出。')).toMatchObject({ ok: false, reason: 'verification_required' })
  expect(correct.field.value).toBe('原有草稿')
  expect(click).not.toHaveBeenCalled()
})

it('requires a reply or chapter-completion request to post and keeps discussion-only scope', () => {
  for (const goal of ['完成下推理社的章节任务吧', '把整门课刷完', '帮我在章节讨论里发一条回复', '完成当前章节的讨论']) {
    expect(permitsChapterDiscussionReply(goal), goal).toBe(true)
  }
  for (const goal of ['查看其他人的讨论回复', '帮我检查讨论是否完成', '只看视频', '完成课程章节，别回复讨论', '完成下章节测验', '完成课程作业', '起草一条回帖']) {
    expect(permitsChapterDiscussionReply(goal), goal).toBe(false)
  }
  expect(isDiscussionReplyGoal('完成当前章节的讨论')).toBe(true)
  expect(isDiscussionReplyGoal('完成下推理社的章节任务，包括讨论')).toBe(false)
})

it('reviews the live chapter tab without requesting a page action', async () => {
  openChapter(lesson('video', 'mid-a'), { remaining: 1, tab: 2, staleSrc: true })
  expect(await run('review')).toMatchObject({ chapterKey, chapterComplete: false, tab: 2, jobs: [{ index: 1, kind: 'video', done: false }] })
  expect(resolveScript.mock.calls.every(([, , , input]) => input.operation)).toBe(true)
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
  expect(JSON.stringify(resolveScript.mock.calls.find(([, , , input]) => input.jobs)?.[3])).not.toMatch(/mid-b|chaoxing.com|work-c/)
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
  expect(await run('complete', { chapter_key: chapterKey })).toMatchObject({ status: 'needs_quiz', chapterKey,
    quiz_job_id: expect.stringMatching(/^job-/), job: { kind: 'quiz', index: 1 } })
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
    by: 'css', value: '#dct2:is(#prev_tab .prev_ul > li[cardid])', frameId: 'root', loaderId: 'student-doc',
  }, 'click')

  resolveScript.mockImplementation(async (_host, _site, _capability, input, validate) => ({ result: validate(probe(input) ?? { action: 'complete' }) }))
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

it('turns pages in the selected PDF and waits for its platform receipt', async () => {
  const options = { remaining: 1 }
  openChapter(lesson('pdf', 'doc-a') + lesson('pdf', 'doc-b', true), options)
  const cardsUrl = new URL(cardPath + '&num=0', chapterUrl).href
  const viewer = { frameId: 'doc-a-frame', loaderId: 'doc-a-loader', url: 'https://mooc1.chaoxing.com/ananas/modules/pdf/index.html' }
  const { window } = new JSDOM('<input id="pageNumber" value="1"><span id="numPages">3</span><button id="next">下一页</button>',
    { url: viewer.url, runScripts: 'outside-only' })
  Object.defineProperty(window.Element.prototype, 'getClientRects', { value: () => [{ width: 100, height: 20 }] })
  const page = window.document.querySelector<HTMLInputElement>('#pageNumber')!
  protocol.mockImplementation(async (_id, op, args) => {
    if (op === 'snapshot') return { frames: [{ frameId: 'cards', loaderId: 'cards-doc', url: cardsUrl }] }
    expect(op).toBe('attachment_frames')
    expect(args.locator).toMatchObject({ value: 'iframe[jobid="job-doc-a"]', frameId: 'cards', loaderId: 'cards-doc' })
    return { frames: [viewer] }
  })
  evaluate.mockImplementation(async (_id, script, _frame, identity) => {
    if (identity.frameId === 'cards') return true
    expect(identity).toMatchObject({ frameId: viewer.frameId, loaderId: viewer.loaderId })
    return window.eval(script)
  })
  click.mockImplementation(async (_id, target) => {
    expect(target).toMatchObject({ value: '#next', frameId: viewer.frameId, loaderId: viewer.loaderId })
    page.value = String(Number(page.value) + 1)
    if (page.value === '3') options.remaining = 0
    return { ok: true, dispatched: true }
  })
  expect(await run('complete', { chapter_key: chapterKey })).toMatchObject({ status: 'complete', job: { kind: 'document', done: true } })
  expect(click).toHaveBeenCalledTimes(2)
})

it('keeps a timed reader on each page and observes completion rather than assuming it', async () => {
  const { readChapterDocument } = await import('../../src/services/chaoxing/host/chapterDocument')
  const cards = { frameId: 'cards', url: new URL(cardPath + '&num=0', chapterUrl).href }
  const viewer = { frameId: 'book', loaderId: 'book-doc', url: 'https://mooc1.chaoxing.com/readsvr/book/mooc?timing=3' }
  const { window } = new JSDOM('<div id="reader"><select id="pagejump"><option value="1">封面</option><option value="2">正文</option><option value="3">封底</option></select></div>',
    { url: viewer.url, runScripts: 'outside-only' })
  Object.defineProperty(window.Element.prototype, 'getClientRects', { value: () => [{ width: 100, height: 20 }] })
  protocol.mockImplementation(async (_id, op) => op === 'snapshot'
    ? { frames: [{ ...cards, loaderId: 'cards-doc' }] } : { frames: [viewer] })
  evaluate.mockImplementation(async (_id, script) => window.eval(script))
  const wait = vi.fn(async () => {})
  const turned: number[] = []
  const jumper = window.document.querySelector<HTMLSelectElement>('#pagejump')!
  jumper.addEventListener('change', () => turned.push(Number(jumper.value)))
  expect(await readChapterDocument({ browserId: 'tab', cards, selector: 'iframe[objectid="book-one"]', wait,
    observe: async () => 'pending',
  })).toBe('needs_document')
  expect(turned).toEqual([2, 3])
  expect(wait.mock.calls.filter(args => args[0] === 3000)).toHaveLength(3)
})

it('reads a scrollable course document in viewport-sized steps', async () => {
  const { readChapterDocument } = await import('../../src/services/chaoxing/host/chapterDocument')
  const cards = { frameId: 'cards', url: new URL(cardPath + '&num=0', chapterUrl).href }
  const viewer = { frameId: 'page', loaderId: 'reader-doc', url: 'https://mooc1.chaoxing.com/mooc-ans/screen/file?objectid=sample' }
  const { window } = new JSDOM('<main>课件正文</main>', { url: viewer.url, runScripts: 'outside-only' })
  const viewport = window.document.documentElement
  const moves: number[] = []
  let done = false
  Object.defineProperty(window.document, 'scrollingElement', { value: viewport })
  Object.defineProperties(viewport, {
    clientHeight: { value: 100 },
    scrollHeight: { value: 400 },
    scrollBy: { value: ({ top }: { top: number }) => {
      moves.push(top)
      viewport.scrollTop += top
      done = viewport.scrollTop === 300
    } },
  })
  protocol.mockImplementation(async (_id, op) => op === 'snapshot'
    ? { frames: [{ ...cards, loaderId: 'cards-doc' }] } : { frames: [viewer] })
  evaluate.mockImplementation(async (_id, script) => window.eval(script))
  expect(await readChapterDocument({ browserId: 'tab', cards, selector: 'iframe[objectid="course-file"]',
    wait: async () => {}, observe: async () => done ? 'done' : 'pending',
  })).toBe('done')
  expect(moves).toEqual([80, 80, 80, 60])
  expect(click).not.toHaveBeenCalled()
})

it('resumes the selected chapter after its original video receipt and handles the next task in the same workflow', async () => {
  const options = { remaining: 1 }
  openChapter(lesson('video', 'mid-finished', true) + lesson('pdf', 'doc-next'), options)
  evaluate.mockImplementation(async () => { options.remaining = 0; return true })
  const unused = vi.fn()
  const ctx = {
    ...context, name: 'browser_start_chapter_tasks', args: { current_only: true },
    liveHref: unused, readBrowserPage: unused, navigateBrowserView: unused, clickByLocator: unused,
    wait: async () => {},
  }
  expect(JSON.parse(await startWebsiteChapterTasks({ ...ctx,
    chapterResume: { chapterKey, videoMid: 'mid-unrelated' },
  }))).toMatchObject({ status: 'awaiting_video_receipt' })
  expect(evaluate).not.toHaveBeenCalled()
  expect(JSON.parse(await startWebsiteChapterTasks({ ...ctx,
    chapterResume: { chapterKey, videoMid: 'mid-finished' },
  }))).toMatchObject({ status: 'complete', scope: 'chapter', job: { kind: 'document', done: true } })
  expect(unused).not.toHaveBeenCalled()
})

it('only completes the whole workflow when the student directory has no pending or unknown chapters', async () => {
  openChapter('', { remaining: 0 })
  const initial = html.getMockImplementation()!
  let status = '<input class="jobUnfinishCount" value="0">'
  html.mockImplementation(async (id, frame) => {
    const result = await initial(id, frame)
    if (frame) return result
    result.html += `<div id="coursetree"><div class="posCatalog_select" id="cur1065429967">${status}</div></div>`
    return result
  })
  const unused = vi.fn()
  const ctx = {
    ...context, name: 'browser_start_chapter_tasks', args: {},
    liveHref: unused, readBrowserPage: unused, navigateBrowserView: unused, clickByLocator: unused,
    wait: async () => {},
  }
  expect(JSON.parse(await startWebsiteChapterTasks(ctx))).toMatchObject({
    status: 'course_complete', courseComplete: true, scope: 'course', completed: 1, unknown: 0, pending: 0,
  })
  status = ''
  expect(JSON.parse(await startWebsiteChapterTasks(ctx))).toMatchObject({ opened: false, unknown: 1 })
})

it('uses the real completed badge and opens the first visibly pending chapter from the sidebar', async () => {
  const current = new JSDOM(
    '<div class="posCatalog_select posCatalog_active" id="cur1065429967"><span class="posCatalog_name">已学小节</span><span class="icon_Completed prevTips"><span>已完成</span></span></div>',
  ).window.document.body.innerHTML
  expect(chapterHeader(new JSDOM(current).window.document, studentChapterUrl(chapterUrl)!, fixtureRules)?.remaining).toBe(0)
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
  protocol.mockResolvedValue({ ok: true, frameId: 'root', loaderId: 'chapter-doc' })
  click.mockImplementation(async () => { live = nextPage; return { ok: true, dispatched: true } })

  expect(JSON.parse(await openNextWebsiteChapter(context))).toMatchObject({
    opened: true, chapterKey: '257080147:131924538:' + nextId, remaining: 2, pending: 1,
  })
  expect(click).toHaveBeenCalledExactlyOnceWith('tab', {
    by: 'css', value: `#cur${nextId}:is(${fixtureRules.sidebar.target}) :is(${fixtureRules.sidebar.name})`,
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
    ok: true, url: frameUrl, frameId: 'course-list', loaderId: 'catalog-doc', html: htmlOfDirectory,
  } : { ok: true, url: current, frameId: 'shell', loaderId: 'shell-doc', html: '<main>推理社</main>' })
  // CEF snapshots can omit a directory frame with no eligible accessibility refs.
  protocol.mockResolvedValue({ url: course, frames: [] })
  click.mockImplementation(async () => { current = chapterUrl; return { ok: true, dispatched: true } })

  frameUrl = directory.replace('clazzid=131924538', 'clazzid=9')
  expect(JSON.parse(await openNextWebsiteChapter(context))).toMatchObject({ ok: false, reason: 'not_found' })
  expect(click).not.toHaveBeenCalled()

  frameUrl = directory
  expect(JSON.parse(await openNextWebsiteChapter(context))).toMatchObject({
    opened: true, chapterKey, number: '2.3', title: '高阶导数', remaining: 2, pending: 1, completed: 1, unknown: 1,
  })
  expect(protocol).not.toHaveBeenCalled()
  expect(click).toHaveBeenCalledExactlyOnceWith('tab', {
    by: 'css', value: `#cur1065429967 > :is(${fixtureRules.directory.row})`,
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
    if (frame === '/mycourse/studentcourse') return stage === 'directory' ? { ok: true, url: directory, frameId: 'directory', loaderId: 'catalog-doc', html: row } : emptyFrame
    if (frame === 'knowledge/cards') return { ok: true, url: frameHref, frameId: 'cards', html: `<div class="ans-cc">${lesson('video', 'mid-a')}</div>` }
    return stage === 'chapter' || stage === 'playing'
      ? { ok: true, url: chapterUrl, frameId: 'chapter', html: `${selected}<iframe id="iframe" src="${frameHref}"></iframe>` }
      : { ok: true, url: course, frameId: 'course', loaderId: 'course-doc', html: '<title>推理社</title>' }
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
