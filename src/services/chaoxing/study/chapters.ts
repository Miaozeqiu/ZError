/** CDP 开章 / 读目录。面板状态在 ../browser/chapters.ts，不要把 Vue ref 写进这里。 */
import { READ_PAGE_DOM } from '../../browser/pageDom'
import { readFrameHtml, useLegacyEval } from '../../browser/domRead'
import { asObject, evalBrowserViewMain, evalBrowserViewMainNow, waitMs } from '../../browser/eval'
import { locatorsForChapter, locatorsForStudyControl } from '../locators'
import { clickHomeworkBox } from '../homework/act'
import { READ_CATALOG_READY, READ_CATALOG_SLIM } from './cdpScripts'
import { catalogReadyFromHtml } from './localJobs'
import { cardFromStudyHtml } from './parsePage'
import { CAPTCHA_HINT, readChaoxingCaptcha } from './captcha'
import { dumpChaoxingParseHtml } from './dump'
import type { ChaoxingChapterSnap } from './types'
import { clearChaoxingPlayMid, playChaoxingVideo, readChaoxingVideo, readChaoxingVideoTick, videoIsPlaying } from './video'

/** 排查 webview / 题卡问题时可先关掉章节解析。 */
export const CHAPTER_PARSER_ENABLED = true

const browserView = () => import('../../browser/appBrowser')

const clickBrowserText = async (id: string, text: string) => {
  const { clickBrowserText: click } = await browserView()
  return click(id, text)
}

/** 目录脚本自己穿透同源 iframe。只跑顶层，禁止再扫 20+ iframe（会把解析卡成十几秒）。 */
const evalCatalog = async (id: string, script: string) => (
  asObject(await evalBrowserViewMain(id, script))
)

const catalogReadySnap = async (id: string) => {
  if (!useLegacyEval()) {
    const tree = await readFrameHtml(id, 'coursetree')
    const main = tree.html ? tree : await readFrameHtml(id, 'main')
    if (main.html) return catalogReadyFromHtml(main.html, main.url || tree.url)
  }
  return evalBrowserViewMain(id, READ_CATALOG_READY()) as Promise<{
    href?: string
    onCatalog?: boolean
    hasProgress?: boolean
    hasDir?: boolean
    catalogLi?: number
    sample?: string
  } | null>
}

const hasChapterData = (snap: ChaoxingChapterSnap | null | undefined) => Boolean(
  snap
  && (
    (snap.chapters || []).length
    || (snap.unfinished || []).length
    || snap.progress
  )
)

const waitForChaoxingCatalog = async (id: string, maxMs = 2500) => {
  const started = Date.now()
  let last: Awaited<ReturnType<typeof catalogReadySnap>> = null
  while (Date.now() - started < maxMs) {
    last = await catalogReadySnap(id).catch(() => null)
    if (last?.onCatalog && (last.hasProgress || last.hasDir || Number((last as { catalogLi?: number }).catalogLi) > 0)) return last
    await waitMs(160)
  }
  return last
}

export const liveStudyHref = async (id: string) => {
  const href = await evalBrowserViewMainNow(id, `(function(){ try { return String(location.href || ''); } catch (e) { return ''; } })()`).catch(() => '')
  return String(href || '').trim()
}

/** 等顶层真正进到 studentstudy；课程壳目录上的预览不能当播放器。 */
export const waitForStudentStudyPage = async (id: string, maxMs = 12_000) => {
  const started = Date.now()
  let url = await liveStudyHref(id)
  while (Date.now() - started < maxMs) {
    if (/studentstudy/i.test(url)) return url
    await waitMs(350)
    url = await liveStudyHref(id)
  }
  return url
}

const videoTickReady = (tick: Record<string, unknown> | null) => {
  if (!tick) return false
  const duration = Number(tick.duration) || 0
  const current = Number(tick.current) || 0
  const src = String(tick.src || '')
  return duration > 1 || Boolean(src) || tick.paused === false || current > 0.2
}

/** 目录点进去要等跳转；播放页内切章只等新 iframe，不要等整页 load。 */
export const waitForStudyPlayerReady = async (id: string, maxMs = 8_000) => {
  const before = await liveStudyHref(id)
  const startedOnPlayer = /studentstudy/i.test(before)
  if (!startedOnPlayer) {
    const { waitForBrowserIdle } = await import('../../browser/appBrowser')
    await waitForBrowserIdle(id, Math.min(maxMs, 6_000)).catch(() => null)
  }
  const url = startedOnPlayer ? before : await waitForStudentStudyPage(id, maxMs)
  if (!/studentstudy/i.test(url)) {
    return { ok: false as const, url, error: '目录点击后没有进入播放页（studentstudy）' }
  }
  const settleMs = startedOnPlayer ? 5_000 : 7_000
  const settleStart = Date.now()
  while (Date.now() - settleStart < settleMs) {
    const tick = asObject(await readChaoxingVideoTick(id).catch(() => null))
    if (videoTickReady(tick)) return { ok: true as const, url, hasVideo: true }
    await waitMs(280)
  }
  return { ok: true as const, url, hasVideo: false }
}

const hrefChapterId = (href: string) => (
  ((String(href || '').match(/[?&](?:chapterId|chapterid|knowledgeid)=(\d+)/i) || [])[1] || '').replace(/\D/g, '')
)

const settleAfterChapterClick = async (id: string, wantId = '') => {
  await waitMs(700)
  let href = await liveStudyHref(id)
  if (/studentstudy/i.test(href) && (!wantId || hrefChapterId(href) === wantId)) return href
  await waitMs(700)
  href = await liveStudyHref(id)
  return href
}

const chaptersWaiting = (extra?: Record<string, unknown>) => ({
  waiting: true,
  page: 'chapters',
  unfinished: [] as string[],
  unfinishedCount: 0,
  ...extra,
  hint: String(extra?.hint || '目录还没读到「已完成任务点」。再调一次 get_state；仍空用 browser_get_page。'),
})

const diagnoseCatalogGap = async (id: string) => {
  const probe = asObject(await evalBrowserViewMain(id, `(function(){
    var href = location.href || '';
    var pageHeader = (href.match(/[?&]pageHeader=(\\d+)/) || [])[1] || '';
    var iframes = [];
    try {
      var list = document.querySelectorAll('iframe[src]');
      for (var i = 0; i < list.length && iframes.length < 8; i++) iframes.push(String(list[i].src || ''));
    } catch (e) {}
    return {
      href: href,
      pageHeader: pageHeader,
      onCourse: /\\/mycourse\\/stu|stucoursemiddle/.test(href) && !/studentstudy/.test(href),
      hasChapterTab: !!document.querySelector('a[data-url*="studentcourse"], [data-url*="studentcourse"], [title="章节"]'),
      iframes: iframes,
    };
  })()`).catch(() => ({})))
  const slim = await evalCatalog(id, READ_CATALOG_SLIM())
  const pageHeader = String(probe.pageHeader || '')
  const iframeSrcs = (Array.isArray(probe.iframes) ? probe.iframes : []).map(String)
  const hasStudentcourse = iframeSrcs.some((src) => /studentcourse/i.test(src))
    || /studentcourse/i.test(String(slim.url || ''))
  const diag = {
    pierced: Number(slim.pierced) || 0,
    candidates: slim.candidates,
    catalogLi: Number(slim.catalogLi) || 0,
    hasProgress: Boolean(slim.hasProgress),
    frame: String(slim.url || ''),
  }
  if (probe.onCourse && pageHeader !== '1') {
    return chaptersWaiting({
      reason: 'not_chapter_tab',
      pageHeader,
      hint: '还在课程壳其它页签。先点「章节」（pageHeader=1），再 get_state。',
    })
  }
  if (probe.onCourse && !hasStudentcourse && !(Number(slim.catalogLi) > 0) && !slim.hasProgress) {
    return chaptersWaiting({
      reason: 'iframe_missing',
      pageHeader,
      iframes: iframeSrcs,
      hint: '章节页签已开，但目录 iframe（studentcourse）还没挂上。等 1–2 秒再调 get_state；仍空用 browser_get_page 看 frames。',
    })
  }
  if (Number(slim.catalogLi) > 0 || slim.hasProgress || String(slim.text || '').includes('已完成任务点')) {
    return chaptersWaiting({
      reason: 'parse_empty',
      pageHeader,
      ...diag,
      hint: '目录帧在，但未解析出未完成节名。再调一次 get_state。',
    })
  }
  return chaptersWaiting({
    reason: Number(slim.pierced) > 1 ? 'iframe_loading' : 'iframe_empty',
    pageHeader,
    iframes: iframeSrcs,
    ...diag,
  })
}

export const openChaoxingChapters = async (id: string) => {
  if (!CHAPTER_PARSER_ENABLED) return chaptersWaiting({ reason: 'disabled' })
  const tryParse = () => parseChaoxingChapters(id).catch(() => null)
  let parsed = await tryParse()
  if (hasChapterData(parsed)) return withNextPlay(parsed)
  const probe = await evalBrowserViewMain(id, `(function(){
    var href = location.href || '';
    return {
      onCourse: /\\/mycourse\\/stu|stucoursemiddle/.test(href) && !/studentstudy/.test(href),
      hasTab: !!document.querySelector('a[data-url*="studentcourse"], [data-url*="studentcourse"]'),
      pageHeader: (href.match(/[?&]pageHeader=(\\d+)/) || [])[1] || '',
    };
  })()`).catch(() => null) as { onCourse?: boolean; hasTab?: boolean; pageHeader?: string } | null
  if (probe?.onCourse && probe.hasTab && probe.pageHeader !== '1') {
    await clickHomeworkBox(id, locatorsForStudyControl('chapter-tab')).catch(() => null)
    await waitForChaoxingCatalog(id, 3200)
  } else if (probe?.onCourse) {
    await waitForChaoxingCatalog(id, 2800)
  }
  for (let i = 0; i < 6; i += 1) {
    parsed = await tryParse()
    if (hasChapterData(parsed)) return withNextPlay(parsed)
    await waitMs(450)
  }
  return diagnoseCatalogGap(id)
}

const withNextPlay = (snap: ChaoxingChapterSnap | null) => {
  if (!snap) return chaptersWaiting()
  const unfinished = snap.unfinished || []
  const first = String(unfinished[0] || '').replace(/^\d+(?:\.\d+)+\s*/, '').trim() || unfinished[0] || ''
  if (unfinished.length || (snap.unfinishedCount || 0) > 0) {
    return {
      ...snap,
      next: 'click',
      hint: snap.hint || (first
        ? `未完成：${unfinished.slice(0, 8).join('、')}${unfinished.length > 8 ? '…' : ''}。`
        : '有未完成任务点。'),
    }
  }
  return snap
}

const catalogIndex = (value: unknown) => {
  const hit = String(value || '').trim().match(/^(\d+(?:\.\d+)+)\b/)
  return hit?.[1] || ''
}

const keepChapterTitle = (value: unknown) =>
  String(value || '').replace(/\s+/g, ' ').trim()

const bareChapterTitle = (value: unknown) => {
  const raw = String(value || '')
    .replace(/[（(]\s*\d+\s*[）)]\s*$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  const index = catalogIndex(raw)
  const bare = raw.replace(/^\d+(?:\.\d+)+\s*/, '').trim()
  return bare || index
}

const titlesMatch = (a: unknown, b: unknown) => {
  const ia = catalogIndex(a)
  const ib = catalogIndex(b)
  if (ia && ib && ia !== ib) return false
  const left = bareChapterTitle(a)
  const right = bareChapterTitle(b)
  if (!left || !right) return ia && ib && ia === ib
  if (ia && ib) return left === right
  return left === right || left.includes(right) || right.includes(left)
}

const unfinishedFromCatalogText = (text: string) => {
  const lines = String(text || '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
  const rows: Array<{ title: string; jobs: number; unfinished: boolean }> = []
  const progressHit = String(text || '').match(/已完成任务点\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/)
  const progress = progressHit
    ? { done: Number(progressHit[1]), total: Number(progressHit[2]) }
    : null
  const pushRow = (rawTitle: string, jobs: number) => {
    const title = keepChapterTitle(rawTitle) || bareChapterTitle(rawTitle) || rawTitle
    if (!title || title.length < 2) return
    if (/^第/.test(title) || title === '目录') return
    if (/资料|测验|考试|作业|讨论|问卷/.test(title) && !catalogIndex(title)) return
    if (rows.some((item) => titlesMatch(item.title, title))) {
      const hit = rows.find((item) => titlesMatch(item.title, title))
      if (hit && jobs > hit.jobs) {
        hit.jobs = jobs
        hit.unfinished = jobs > 0
      }
      return
    }
    rows.push({ title, jobs, unfinished: jobs > 0 })
  }
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const next = lines[i + 1] || ''
    if (/^\d{1,2}$/.test(line) && /^第/.test(next)) continue
    if (/已完成任务点|待完成任务点|^目录$|^第/.test(line)) continue
    if (/^[一二三四五六七八九十百]+[、.]/.test(line) || /单选题|多选题|判断题|填空题|共\s*\d+\s*题/.test(line)) continue
    // 节名下一行是该节任务点数；0 表示已清完
    if (
      /^\d{1,2}$/.test(next)
      && !/^第/.test(line)
      && line.length > 1
      && !/^第/.test(lines[i + 2] || '')
    ) {
      pushRow(line, Number(next) || 0)
      continue
    }
    // mooc2 / a11y：同行「1.1 函数（一） 2」
    const sameLine = line.match(/^(.*\S)\s+(\d{1,2})$/)
    if (sameLine && !/^第/.test(sameLine[1]) && sameLine[1] !== '目录') {
      pushRow(sameLine[1], Number(sameLine[2]) || 0)
    }
  }
  const unfinished = rows.filter((item) => item.unfinished).map((item) => item.title)
  if (!rows.length && !(progress && progress.total > progress.done)) return null
  return {
    url: '',
    page: 'chapters',
    current: '',
    progress,
    unfinished,
    unfinishedCount: progress && progress.total > progress.done ? progress.total - progress.done : unfinished.length,
    chapters: rows.map((item) => ({ title: item.title, jobs: item.jobs, unfinished: item.unfinished })),
    via: 'frames',
    hint: unfinished.length
      ? (`未完成：${unfinished.slice(0, 8).join('、')}${unfinished.length > 8 ? '…' : ''}。点「${String(unfinished[0] || '').replace(/^\d+(?:\.\d+)+\s*/, '').trim() || unfinished[0]}」（不要带 1.1），进 studentstudy 后立刻 看快照。`)
      : (progress ? `已完成任务点 ${progress.done}/${progress.total}。` : '没有读到未完成章节。'),
  } as ChaoxingChapterSnap
}

const unfinishedFromPageDom = async (id: string) => {
  if (!useLegacyEval()) {
    const tree = await readFrameHtml(id, 'coursetree')
    const page = tree.html ? tree : await readFrameHtml(id, 'main')
    if (page.html) {
      const fromHtml = cardFromStudyHtml({ url: page.url, html: page.html })
      if (hasChapterData(fromHtml)) return { ...fromHtml, via: 'dom-html' } as ChaoxingChapterSnap
      const text = page.html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
      const fromText = unfinishedFromCatalogText(text)
      if (hasChapterData(fromText)) {
        return { ...fromText, url: page.url || fromText?.url || '', via: 'dom-text' } as ChaoxingChapterSnap
      }
    }
  }
  // 课程壳目录在同源 studentcourse iframe：穿透取节点，再本地兜底
  const slim = await evalCatalog(id, READ_CATALOG_SLIM())
  const slimUrl = String(slim.url || '')
  const slimText = String(slim.text || '')
  const slimHtml = String(slim.html || '')
  const slimChapters = Array.isArray(slim.chapters) ? slim.chapters : []
  if (slimChapters.length) {
    const unfinished = Array.isArray(slim.unfinished)
      ? slim.unfinished.map(String)
      : slimChapters.filter((item: { unfinished?: boolean; kind?: string }) => item.unfinished && item.kind !== 'chapter').map((item: { title?: string }) => String(item.title || ''))
    return {
      url: slimUrl,
      page: 'chapters',
      current: String(slim.current || ''),
      chapters: slimChapters,
      unfinished,
      unfinishedCount: Number(slim.unfinishedCount) || unfinished.length,
      progress: slim.progress && typeof slim.progress === 'object' ? slim.progress as { done: number; total: number } : null,
      via: 'catalog-rows',
    } as ChaoxingChapterSnap
  }
  if (slimText || Number(slim.catalogLi) > 0 || slim.hasProgress) {
    const fromText = unfinishedFromCatalogText(slimText)
    if (hasChapterData(fromText)) {
      return {
        ...fromText,
        url: slimUrl || fromText?.url || '',
        via: 'frames-text',
      } as ChaoxingChapterSnap
    }
  }
  if (slimHtml.trim()) {
    const fromHtml = cardFromStudyHtml({ url: slimUrl, html: slimHtml })
    if (hasChapterData(fromHtml)) {
      return {
        ...fromHtml,
        url: slimUrl || fromHtml?.url || '',
        via: 'frames-html',
      } as ChaoxingChapterSnap
    }
  }
  // 目录节点在、但 slim 没抽出节名时，只拉顶层 HTML，不再扫每个 iframe 的 outerHTML
  if (Number(slim.catalogLi) > 0 || slim.hasProgress) {
    const dom = asObject(await evalBrowserViewMain(id, READ_PAGE_DOM()).catch(() => ({})))
    const parsed = cardFromStudyHtml(dom)
    if (hasChapterData(parsed)) return parsed
    const html = String(dom.html || '')
    const text = html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ')
    const fromDom = unfinishedFromCatalogText(text)
    if (hasChapterData(fromDom)) return fromDom
  }
  return unfinishedFromCatalogText(slimText)
}

const readStudyCatalog = async (id: string) => {
  if (!CHAPTER_PARSER_ENABLED) return null
  try {
    return await unfinishedFromPageDom(id)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error || '解析失败')
    void import('./debug').then(({ noteStudyParser }) => {
      noteStudyParser({ via: 'catalog-error', error: message, force: true })
    }).catch(() => null)
    await dumpChaoxingParseHtml(id, 'parse-error').catch(() => null)
    throw error
  }
}

export const installChaoxingChapterHook = (id: string) => readStudyCatalog(id)

export const readChaoxingChapterTick = (id: string) => readStudyCatalog(id)

export const readChaoxingChapterSnap = (id: string) => readStudyCatalog(id)

export const parseChaoxingChapters = (id: string) => readStudyCatalog(id)

export type OpenChapterHint = {
  chapterId?: string
  href?: string
  studyHref?: string
  index?: string
}

export const openChaoxingChapter = async (id: string, title: string, hint?: OpenChapterHint) => {
  const want = keepChapterTitle(title) || bareChapterTitle(title) || String(hint?.index || '').trim()
  const chapterId = String(hint?.chapterId || '').replace(/\D/g, '')
  if (!want && !chapterId) return { ok: false, error: '缺少节名' }
  const clicked = await clickHomeworkBox(id, locatorsForChapter(want, chapterId)).catch(() => ({ ok: false, text: '', error: undefined }))
  if (clicked.ok) {
    // 换节了，上一节钉住的 mid 作废
    clearChaoxingPlayMid(id)
    await settleAfterChapterClick(id, chapterId)
    return { ok: true, title: want, chapterId, via: 'catalog', text: clicked.text }
  }
  return { ok: false, error: clicked.error || `目录里没有「${want}」`, want }
}

/** 资料/讨论等可跳；测验/考试/作业留着让 Agent 用题卡作答。 */
const SKIP_CHAPTER = /资料|讨论|问卷/

const clickChapterOrNext = async (id: string, name?: string) => {
  const target = String(name || '').trim()
  if (target) {
    const hit = await clickBrowserText(id, target).catch(() => null) as { ok?: boolean } | null
    if (hit?.ok) return hit
  }
  return clickBrowserText(id, '下一节')
}

export const openNextChaoxingStep = async (id: string) => {
  const clicked = asObject(await clickHomeworkBox(id, locatorsForStudyControl('next')).catch(() => ({ ok: false, text: '', error: undefined })))
  const moved = {
    ok: Boolean(clicked.ok),
    opened: Boolean(clicked.ok),
    step: String(clicked.text || ''),
  }
  if (!moved.ok) {
    return { ok: false, chapterDone: false, more: false, videoCount: 0 }
  }
  await waitMs(1000)
  const page = await readChaoxingVideo(id).catch(() => null)
  if (page?.captcha || await readChaoxingCaptcha(id)) {
    return { captcha: true, hasVideo: false, more: false, hint: CAPTCHA_HINT }
  }
  if (page?.quiz) {
    return { quiz: true, step: String(page.step || moved.step || ''), hasVideo: false, more: false }
  }
  // NEXT_STEP 已经点到目标任务点，绝不能再 play 时点「第一个未完成」
  const played = await playChaoxingVideo(id, { skipTabClick: true })
  if (played.captcha) {
    return { captcha: true, hasVideo: false, more: false, hint: CAPTCHA_HINT }
  }
  return {
    ok: Boolean(played.hasVideo),
    more: true,
    chapterDone: false,
    opened: String(played.title || moved.step || ''),
    step: String(moved.step || ''),
    videoCount: 0,
    ...played,
  }
}

export const openNextChaoxingChapter = async (id: string) => {
  if (await readChaoxingCaptcha(id)) {
    return { captcha: true, hasVideo: false, skipped: [], hint: CAPTCHA_HINT }
  }
  const skipped: string[] = []
  const start = await readChaoxingVideo(id).catch(() => null)
  if (start?.quiz) {
    return { quiz: true, step: start.step || '', hasVideo: false, skipped }
  }
  const same = await openNextChaoxingStep(id)
  if (same.quiz) return { ...same, skipped }
  if (same.captcha) return { ...same, skipped, captcha: true, hint: CAPTCHA_HINT }
  if (same.ok && same.hasVideo) return { ...same, skipped, sameChapter: true }
  const fromId = String(start?.chapterId || '').trim()
  const fromTitle = String(start?.current || '').trim()
  await clickChapterOrNext(id, start?.next)
  for (let i = 0; i < 10; i += 1) {
    await waitMs(900)
    const page = await readChaoxingVideo(id).catch(() => null)
    if (page?.captcha || await readChaoxingCaptcha(id)) {
      return { captcha: true, hasVideo: false, skipped, hint: CAPTCHA_HINT }
    }
    if (page?.quiz) {
      return { quiz: true, current: page.current || '', skipped, hasVideo: false }
    }
    const title = String(page?.current || '').trim()
    const chapterId = String(page?.chapterId || '').trim()
    const moved = Boolean((chapterId && fromId && chapterId !== fromId) || (title && fromTitle && title !== fromTitle))
    const looksDoc = SKIP_CHAPTER.test(title) || SKIP_CHAPTER.test(String(page?.step || ''))
    if (looksDoc) {
      skipped.push(title || '资料节')
      await clickChapterOrNext(id, page?.next)
      continue
    }
    const played = await playChaoxingVideo(id)
    if (played.captcha) {
      return { captcha: true, hasVideo: false, skipped, hint: CAPTCHA_HINT }
    }
    const duration = Number(played?.duration) || 0
    const current = Number(played?.current) || 0
    const playing = Boolean(played?.playing || videoIsPlaying(played))
    const hasPlayer = Boolean(played?.hasVideo && duration > 1 && !played.ended)
    if (playing && (moved || current < 8)) {
      return { ok: true, opened: title || String(played.title || ''), skipped, ...played, playing: true }
    }
    if (hasPlayer && moved) {
      return { ok: true, opened: title || String(played.title || ''), skipped, ...played, playing: false }
    }
    if (!moved || !hasPlayer) {
      skipped.push(title || (hasPlayer ? '还在上一节' : '播放器未就绪'))
      await clickChapterOrNext(id, page?.next)
    }
  }
  return {
    ok: false,
    hasVideo: false,
    skipped,
    hint: '没能切到下一节视频，或播放器还没就绪',
  }
}

export const studyChaoxingUnfinished = async (id: string, title?: string) => {
  if (await readChaoxingCaptcha(id)) {
    return { ok: false, captcha: true, done: false, hint: CAPTCHA_HINT }
  }
  let parseError = ''
  let parsed = await parseChaoxingChapters(id).catch((error) => {
    parseError = String(error?.message || error || '')
    return null
  })
  if (!hasChapterData(parsed)) {
    const onStudent = await evalBrowserViewMain(id, `(function(){ return /\\/mycourse\\/stu/.test(location.href || ''); })()`).catch(() => false)
    if (onStudent) {
      await clickHomeworkBox(id, locatorsForStudyControl('chapter-tab')).catch(() => null)
      await waitForChaoxingCatalog(id, 1500)
      parsed = await parseChaoxingChapters(id).catch((error) => {
        parseError = String(error?.message || error || parseError)
        return parsed
      })
    }
  }
  const unfinished = (parsed?.unfinished || [])
    .map(keepChapterTitle)
    .filter(Boolean)
    .filter((item, _, list) => {
      const idx = catalogIndex(item)
      if (!idx) return true
      const prefix = `${idx}.`
      return !list.some((other) => catalogIndex(other).startsWith(prefix))
    })
  const progress = parsed?.progress || null
  const progressLeft = progress && progress.total > progress.done
    ? progress.total - progress.done
    : 0
  const preferred = keepChapterTitle(title) || bareChapterTitle(title)
  const queue = preferred
    ? [preferred, ...unfinished.filter((item) => !titlesMatch(item, preferred))]
    : unfinished
  if (!queue.length) {
    if (progressLeft > 0) {
      return {
        ok: false,
        done: false,
        unfinished: [],
        unfinishedCount: progressLeft,
        progress,
        page: parsed?.page,
        url: parsed?.url,
        hint: `页面显示还有 ${progressLeft} 个未完成任务点（已完成 ${progress?.done}/${progress?.total}），但目录项没对上。不要说全部完成。点「章节」后再 get_state；点节用中文短名，进 studentstudy 后立刻 看快照。`,
      }
    }
    const stillNotCatalog = parsed?.page !== 'chapters' && parsed?.page !== 'player' && !progress
    if (stillNotCatalog || parsed?.page === 'student' || Boolean(parseError)) {
      return {
        ok: false,
        done: false,
        unfinished: [],
        unfinishedCount: 0,
        progress,
        page: parsed?.page,
        url: parsed?.url,
        error: parseError || undefined,
        hint: parseError
          ? `解析目录失败：${parseError}。不要说全部完成。立刻 browser_get_page / browser_eval 自己读页面：找「已完成任务点 x/y」和节名旁的数字，读到未完成节名就 click_text，再 看快照。`
          : '课程壳或目录 iframe 还没读到未完成节。不要说全部完成。点「章节」后等两秒，再用 browser_get_page 看 iframe 正文，或 browser_eval 扫 .catalog_title / #coursetree。',
      }
    }
    if (!progress) {
      return {
        ok: false,
        done: false,
        unfinished: [],
        unfinishedCount: 0,
        page: parsed?.page,
        url: parsed?.url,
        hint: '解析器没读到进度，不等于全部完成。立刻 browser_get_page 自己解析目录，不要问用户。',
      }
    }
    return {
      ok: false,
      done: true,
      unfinished: [],
      unfinishedCount: 0,
      progress,
      hint: `已完成任务点 ${progress.done}/${progress.total}。`,
    }
  }

  const skipped: string[] = []
  for (const want of queue.slice(0, 6)) {
    const alreadyHere = Boolean(parsed?.onUnfinished && titlesMatch(parsed?.current, want))
      || (parsed?.page === 'player' && titlesMatch(parsed?.current, want))

    if (!alreadyHere) {
      const opened = await openChaoxingChapter(id, want)
      if (!opened.ok) {
        skipped.push(`${want}（打不开）`)
        continue
      }
      await waitMs(1000)
    }

    if (await readChaoxingCaptcha(id)) {
      return { ok: false, captcha: true, done: false, target: want, hint: CAPTCHA_HINT }
    }
    const played = await playChaoxingVideo(id)
    if (played.captcha) {
      return { ok: false, captcha: true, done: false, target: want, hint: CAPTCHA_HINT }
    }
    if (played.quiz) {
      return {
        ok: false,
        quiz: true,
        target: want,
        unfinished,
        unfinishedCount: Number(parsed?.unfinishedCount) || unfinished.length || progressLeft,
        progress,
        skipped,
        hint: '当前是章节测验。系统会按 ocs 流程自动搜题/随机/暂存；失败再用 homework inspect/guess，然后 next。',
      }
    }
    if (!played.hasVideo) {
      skipped.push(want)
      parsed = await parseChaoxingChapters(id).catch(() => parsed)
      continue
    }

    const info = await readChaoxingVideo(id).catch(() => null)
    const openedTitle = String(info?.current || played.title || want).trim()
    const playing = Boolean(played.playing || videoIsPlaying(played))
    return {
      ok: true,
      target: want,
      opened: openedTitle,
      unfinished,
      unfinishedCount: Number(parsed?.unfinishedCount) || unfinished.length || progressLeft,
      progress,
      skipped,
      playing,
      hasVideo: true,
      paused: Boolean(played.paused),
      ended: Boolean(played.ended),
      current: Number(played.current) || 0,
      duration: Number(played.duration) || 0,
      next: info?.next || played.next || '',
      jobDone: info?.jobDone ?? played.jobDone ?? null,
      moreVideos: Boolean(info?.moreVideos ?? played.moreVideos),
      videoCount: Number(info?.videoCount || played.videoCount) || 0,
      videoIndex: Number(info?.videoIndex || played.videoIndex) || 0,
      step: info?.step || played.step || '',
      quiz: false,
      hint: playing
        ? `已打开并确认在播「${openedTitle}」。进度在 Agent 面板，系统会定时核对，不要再 click_text。`
        : `已打开「${openedTitle}」，但还没播起来。再 看快照；不行就回目录重点节名。`,
    }
  }

  return {
    ok: false,
    done: false,
    unfinished,
    unfinishedCount: Number(parsed?.unfinishedCount) || unfinished.length || progressLeft,
    progress,
    skipped,
    hint: `未完成还有：${unfinished.join('、') || `任务点 ${progressLeft}`}。尝试打开失败或都是资料节。不要说全部完成，可再 click_text 下一节或 看快照。`,
  }
}