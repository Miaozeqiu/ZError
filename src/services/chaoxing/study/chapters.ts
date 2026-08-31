import {
  CHAOXING_CHAPTER_HOOK,
  CHAOXING_CHAPTER_INSTALL,
  CHAOXING_CHAPTER_REFRESH,
  CHAOXING_CHAPTER_TICK,
  CHAOXING_CLICK_CHAPTER_TAB,
  CHAOXING_NEXT_STEP,
  CHAOXING_OPEN_CHAPTER,
} from '../../browser/skills/chaoxingStudy'
import { askFrames, asObject, evalBrowserView, waitMs } from '../../browser/eval'
import { CAPTCHA_HINT, readChaoxingCaptcha } from './captcha'
import { dumpChaoxingParseHtml } from './dump'
import type { ChaoxingChapterSnap } from './types'
import { playChaoxingVideo, readChaoxingVideo, videoIsPlaying } from './video'

/** 排查 webview / 题卡问题时可先关掉章节解析。 */
export const CHAPTER_PARSER_ENABLED = true

const browserView = () => import('../../browser/appBrowser')

const clickBrowserText = async (id: string, text: string) => {
  const { clickBrowserText: click } = await browserView()
  return click(id, text)
}

const navigateBrowserView = async (id: string, url: string) => {
  const { navigateBrowserView: go } = await browserView()
  return go(id, url)
}

const getBrowserState = async (id: string) => {
  const { getBrowserState: state } = await browserView()
  return state(id)
}

const catalogReadySnap = (id: string) =>
  evalBrowserView(id, `(function(){
    var href = location.href || '';
    var text = '';
    var walk = function(win, depth){
      try {
        var piece = ((win.document.body && win.document.body.innerText) || '');
        if (!(/暂无任务|默认班级/.test(piece) && !/已完成任务点/.test(piece))) text += piece + '\\n';
      } catch (e) {}
      if ((depth || 0) > 4) return;
      try {
        var list = win.document.querySelectorAll('iframe');
        for (var i = 0; i < list.length; i++) {
          try { if (list[i].contentWindow) walk(list[i].contentWindow, (depth || 0) + 1); } catch (e) {}
        }
      } catch (e) {}
    };
    walk(window, 0);
    var extras = window.__ZE_FRAME_SNAPS__ || [];
    for (var e = 0; e < extras.length; e++) {
      var extraText = String((extras[e] && extras[e].text) || '');
      if (extraText) text += extraText + '\\n';
    }
    return {
      href: href,
      onCatalog: /已完成任务点/.test(text) || !!document.querySelector('.catalog_title, #coursetree'),
      hasProgress: /已完成任务点/.test(text),
      hasDir: text.indexOf('目录') >= 0 && /已完成任务点|维护|第\\d/.test(text),
      sample: text.replace(/\\s+/g, ' ').slice(0, 120),
    };
  })()`) as Promise<{
    href?: string
    onCatalog?: boolean
    hasProgress?: boolean
    hasDir?: boolean
    sample?: string
  } | null>

const hasChapterData = (snap: ChaoxingChapterSnap | null | undefined) => Boolean(
  snap
  && (
    (snap.chapters || []).length
    || (snap.unfinished || []).length
    || snap.progress
  )
)

const waitForChaoxingCatalog = async (id: string, maxMs = 1500) => {
  const started = Date.now()
  let last: Awaited<ReturnType<typeof catalogReadySnap>> = null
  while (Date.now() - started < maxMs) {
    last = await catalogReadySnap(id).catch(() => null)
    if (last?.onCatalog && (last.hasProgress || last.hasDir)) return last
    await waitMs(120)
  }
  return last
}

export const openChaoxingChapters = async (id: string) => {
  if (!CHAPTER_PARSER_ENABLED) return null
  const parsed = await parseChaoxingChapters(id).catch(() => null)
  if (hasChapterData(parsed)) return parsed
  const probe = await evalBrowserView(id, `(function(){
    var href = location.href || '';
    return {
      onCourse: /\\/mycourse\\/stu|stucoursemiddle/.test(href) && !/studentstudy/.test(href),
      hasTab: !!document.querySelector('a[data-url*="studentcourse"], [data-url*="studentcourse"]'),
      pageHeader: (href.match(/[?&]pageHeader=(\\d+)/) || [])[1] || '',
    };
  })()`) as { onCourse?: boolean; hasTab?: boolean; pageHeader?: string }
  // 课程壳但还不在章节页签时，先点「章节」
  if (probe?.onCourse && probe.hasTab && probe.pageHeader !== '1') {
    await evalBrowserView(id, CHAOXING_CLICK_CHAPTER_TAB).catch(() => null)
    await waitForChaoxingCatalog(id, 800)
    const again = await parseChaoxingChapters(id).catch(() => null)
    if (hasChapterData(again)) return again
  } else if (probe?.onCourse) {
    // 已在章节页签：同源扫空时再等一帧让跨域目录 iframe 回传
    await waitMs(400)
    const again = await parseChaoxingChapters(id).catch(() => null)
    if (hasChapterData(again)) return again
  }
  return parsed
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
  const unfinished: string[] = []
  const progressHit = String(text || '').match(/已完成任务点\s*[:：]?\s*(\d+)\s*\/\s*(\d+)/)
  const progress = progressHit
    ? { done: Number(progressHit[1]), total: Number(progressHit[2]) }
    : null
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const next = lines[i + 1] || ''
    if (/^\d{1,2}$/.test(line) && /^第/.test(next)) continue
    if (/已完成任务点|^目录$|^第/.test(line)) continue
    // 节名下一行是待完成数（>0）；0 表示该节已清完，跳过
    if (
      /^\d{1,2}$/.test(next)
      && Number(next) > 0
      && !/^第/.test(line)
      && line.length > 1
      && !/资料|测验|考试|作业|讨论|问卷/.test(line)
      && !/^第/.test(lines[i + 2] || '')
    ) {
      const title = keepChapterTitle(line) || bareChapterTitle(line) || line
      if (title && !unfinished.some((item) => titlesMatch(item, title))) unfinished.push(title)
    }
  }
  if (!unfinished.length && !(progress && progress.total > progress.done)) return null
  return {
    url: '',
    page: 'chapters',
    current: '',
    progress,
    unfinished,
    unfinishedCount: progress && progress.total > progress.done ? progress.total - progress.done : unfinished.length,
    chapters: unfinished.map((title) => ({ title, jobs: 1, unfinished: true })),
    via: 'frames',
    hint: unfinished.length
      ? (`未完成：${unfinished.slice(0, 8).join('、')}${unfinished.length > 8 ? '…' : ''}。用 click_text 点第一节干净节名，再 browser_chaoxing_play。`)
      : (progress ? `已完成任务点 ${progress.done}/${progress.total}。` : '没有读到未完成章节。'),
  } as ChaoxingChapterSnap
}

const unfinishedFromFrameSnaps = async (id: string) => {
  // 课程壳里目录常在跨域 iframe，同源 __cxFrames 扫不到；走 frame bridge 拉文本
  await askFrames(id, 'snap')
  await waitMs(80)
  await askFrames(id, 'snap')
  const extras = asObject(await evalBrowserView(id, `(function(){
    var extras = window.__ZE_FRAME_SNAPS__ || [];
    var catalog = '';
    var other = '';
    for (var i = 0; i < extras.length; i++) {
      var s = extras[i];
      if (!s) continue;
      var t = String(s.text || '');
      if (!t) continue;
      if (s.kind === 'catalog' || /已完成任务点|posCatalog_|\\d+\\.\\d+\\s+\\S/.test(t)) catalog += t + '\\n';
      else other += t + '\\n';
    }
    try {
      var topText = String((document.body && document.body.innerText) || '');
      if (/已完成任务点|\\d+\\.\\d+/.test(topText)) catalog = topText + '\\n' + catalog;
    } catch (e) {}
    return { text: (catalog || other).slice(0, 16000), count: extras.length };
  })()`).catch(() => null))
  return unfinishedFromCatalogText(String(extras.text || ''))
}

export const installChaoxingChapterHook = async (id: string) => {
  if (!CHAPTER_PARSER_ENABLED) return null
  return evalBrowserView(id, CHAOXING_CHAPTER_HOOK) as Promise<ChaoxingChapterSnap | null>
}

export const readChaoxingChapterTick = (id: string) => {
  if (!CHAPTER_PARSER_ENABLED) return Promise.resolve(null)
  return evalBrowserView(id, CHAOXING_CHAPTER_TICK) as Promise<ChaoxingChapterSnap | null>
}

export const readChaoxingChapterSnap = async (id: string) => {
  if (!CHAPTER_PARSER_ENABLED) return null
  const first = await installChaoxingChapterHook(id).catch(() => null)
  if (hasChapterData(first)) return first
  for (let i = 0; i < 3; i += 1) {
    await waitMs(160)
    const tick = await readChaoxingChapterTick(id).catch(() => null)
    if (hasChapterData(tick)) return tick
  }
  return (await unfinishedFromFrameSnaps(id)) || first
}

export const parseChaoxingChapters = async (id: string) => {
  if (!CHAPTER_PARSER_ENABLED) return null
  let local: ChaoxingChapterSnap | null = null
  try {
    const cached = await readChaoxingChapterTick(id).catch(() => null)
    if (hasChapterData(cached)) return cached
    const fresh = asObject(await evalBrowserView(id, CHAOXING_CHAPTER_REFRESH).catch(() => null)) as ChaoxingChapterSnap
    if (hasChapterData(fresh) && !fresh.needInstall) return fresh
    local = await evalBrowserView(id, CHAOXING_CHAPTER_INSTALL).catch(async () => {
      await dumpChaoxingParseHtml(id, 'parse-error').catch(() => null)
      return null
    }) as ChaoxingChapterSnap | null
    if (hasChapterData(local)) return local
  } catch {
    await dumpChaoxingParseHtml(id, 'parse-error').catch(() => null)
  }
  // 同源扫不到时（mooc2 课程壳 + 跨域目录 iframe）用 bridge 文本兜底
  const fromFrames = await unfinishedFromFrameSnaps(id).catch(() => null)
  if (hasChapterData(fromFrames)) return fromFrames
  return local
}

export type OpenChapterHint = {
  chapterId?: string
  href?: string
  studyHref?: string
  index?: string
}

const playerHrefOf = (href?: string, studyHref?: string) => {
  const study = String(studyHref || '')
  const raw = String(href || '')
  if (study.includes('studentstudy')) return study
  if (raw.includes('studentstudy')) return raw
  return ''
}

const playerUrlForChapterId = async (id: string, chapterId: string, pageUrl?: string) => {
  const wantId = String(chapterId || '').replace(/\D/g, '')
  if (!wantId) return ''
  const state = await getBrowserState(id).catch(() => null)
  try {
    const current = new URL(String(state?.url || pageUrl || ''))
    const courseId = current.searchParams.get('courseid') || current.searchParams.get('courseId') || ''
    const clazzid = current.searchParams.get('clazzid') || current.searchParams.get('clazzId') || ''
    const cpi = current.searchParams.get('cpi') || ''
    const enc = current.searchParams.get('enc') || current.searchParams.get('stuenc') || ''
    if (!courseId || !clazzid) return ''
    return `https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=${wantId}&courseId=${courseId}&clazzid=${clazzid}${cpi ? `&cpi=${cpi}` : ''}${enc ? `&enc=${enc}` : ''}&mooc2=1`
  } catch {
    return ''
  }
}

const clickChapterById = async (id: string, chapterId: string, title: string) => {
  const wantId = String(chapterId || '').replace(/\D/g, '')
  if (!wantId) return { ok: false as const }
  const opened = asObject(await evalBrowserView(id, `(function(){
    var wantId = ${JSON.stringify(wantId)};
    var find = function(win, depth){
      if ((depth || 0) > 4) return null;
      try {
        var el = win.document.getElementById('cur' + wantId) || win.document.getElementById(wantId);
        if (el) return el;
        var list = win.document.querySelectorAll('iframe');
        for (var i = 0; i < list.length; i++) {
          try {
            var hit = find(list[i].contentWindow, (depth || 0) + 1);
            if (hit) return hit;
          } catch (e) {}
        }
      } catch (e2) {}
      return null;
    };
    var el = find(window, 0);
    if (!el) return { ok: false };
    var name = (el.querySelector && (el.querySelector('.posCatalog_name, a.clicktitle, a') || el)) || el;
    try { name.click(); } catch (e3) { try { el.click(); } catch (e4) {} }
    return { ok: true, title: ${JSON.stringify(title)}, via: 'id' };
  })()`))
  return opened.ok ? { ok: true as const, title, via: 'id' } : { ok: false as const }
}

const goPlayer = async (id: string, url: string, title: string, via: string) => {
  const state = await getBrowserState(id).catch(() => null)
  const current = String(state?.url || '')
  if (/studentstudy/i.test(current) && /studentstudy/i.test(url)) {
    const chapterId = (url.match(/chapterId=(\d+)/i) || [])[1] || ''
    if (chapterId) {
      const clicked = await clickChapterById(id, chapterId, title)
      if (clicked.ok) {
        await waitMs(400)
        return { ok: true, title, via: `${via}-inplace` }
      }
    }
    return { ok: true, title, via: `${via}-stay` }
  }
  await navigateBrowserView(id, url)
  await waitMs(1200)
  return { ok: true, title, via }
}

export const openChaoxingChapter = async (id: string, title: string, hint?: OpenChapterHint) => {
  const want = keepChapterTitle(title) || bareChapterTitle(title) || String(hint?.index || '').trim()
  const chapterId = String(hint?.chapterId || '').replace(/\D/g, '')
  if (!want && !chapterId) return { ok: false, error: '缺少节名' }
  const state = await getBrowserState(id).catch(() => null)
  const onPlayer = /studentstudy/i.test(String(state?.url || ''))
  if (chapterId) {
    const clicked = await clickChapterById(id, chapterId, want)
    if (clicked.ok) {
      await waitMs(400)
      return clicked
    }
  }
  if (!onPlayer) {
    const knownPlayer = playerHrefOf(hint?.href, hint?.studyHref)
    if (knownPlayer) return goPlayer(id, knownPlayer, want, 'player')
    if (chapterId) {
      const built = await playerUrlForChapterId(id, chapterId)
      if (built) return goPlayer(id, built, want, 'chapterId')
    }
  }
  const opened = asObject(await evalBrowserView(
    id,
    `${CHAOXING_OPEN_CHAPTER}(${JSON.stringify(want)}, ${JSON.stringify(chapterId)})`,
  ))
  if (opened.ok) {
    await waitMs(400)
    return opened
  }
  if (!CHAPTER_PARSER_ENABLED) {
    return { ok: false, error: String(opened.error || `目录里没有「${want}」`), want }
  }
  const parsed = await parseChaoxingChapters(id).catch(() => null)
  const wantIndex = catalogIndex(want) || String(hint?.index || '').trim()
  const hit = (parsed?.chapters || []).find((item) => (
    (wantIndex && (item.index === wantIndex || catalogIndex(item.title) === wantIndex))
    || titlesMatch(item.title, want)
    || titlesMatch(item.index, want)
    || (chapterId && item.chapterId === chapterId)
  ))
  const playerHref = playerHrefOf(hit?.href, hit?.studyHref)
  if (playerHref && !onPlayer) return goPlayer(id, playerHref, hit?.title || want, 'player')
  const parsedId = String(hit?.chapterId || chapterId)
  if (parsedId) {
    const clicked = await clickChapterById(id, parsedId, hit?.title || want)
    if (clicked.ok) {
      await waitMs(400)
      return clicked
    }
    if (!onPlayer) {
      const built = await playerUrlForChapterId(id, parsedId, parsed?.url)
      if (built) return goPlayer(id, built, hit?.title || want, 'chapterId')
    }
  }
  return { ok: false, error: String(opened.error || `目录里没有「${want}」`), want }
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
  const moved = asObject(await evalBrowserView(id, CHAOXING_NEXT_STEP).catch(() => null))
  if (moved.quiz) {
    await waitMs(1000)
    return { quiz: true, step: String(moved.step || ''), hasVideo: false, more: false, opened: Boolean(moved.opened) }
  }
  if (!moved.ok) {
    return { ok: false, chapterDone: true, more: false, videoCount: Number(moved.videoCount) || 0 }
  }
  await waitMs(1000)
  const page = await readChaoxingVideo(id).catch(() => null)
  if (page?.captcha || await readChaoxingCaptcha(id)) {
    return { captcha: true, hasVideo: false, more: false, hint: CAPTCHA_HINT }
  }
  if (page?.quiz) {
    return { quiz: true, step: String(page.step || moved.step || ''), hasVideo: false, more: false }
  }
  const played = await playChaoxingVideo(id)
  if (played.captcha) {
    return { captcha: true, hasVideo: false, more: false, hint: CAPTCHA_HINT }
  }
  return {
    ok: Boolean(played.hasVideo),
    more: true,
    chapterDone: false,
    opened: String(played.title || moved.step || ''),
    step: String(moved.step || ''),
    videoCount: Number(moved.videoCount) || 0,
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
    const onStudent = await evalBrowserView(id, `(function(){ return /\\/mycourse\\/stu/.test(location.href || ''); })()`).catch(() => false)
    if (onStudent) {
      await evalBrowserView(id, CHAOXING_CLICK_CHAPTER_TAB).catch(() => null)
      await waitForChaoxingCatalog(id, 1500)
      parsed = await parseChaoxingChapters(id).catch((error) => {
        parseError = String(error?.message || error || parseError)
        return parsed
      })
    }
  }
  if (!hasChapterData(parsed)) {
    parsed = (await unfinishedFromFrameSnaps(id)) || parsed
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
        hint: `页面显示还有 ${progressLeft} 个未完成任务点（已完成 ${progress?.done}/${progress?.total}），但目录项没对上。不要说全部完成。立刻 browser_get_page 看目录正文和 iframe，读到节名就 click_text 干净节名，进播放页后 browser_chaoxing_play。`,
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
          ? `解析目录失败：${parseError}。不要说全部完成。立刻 browser_get_page / browser_eval 自己读页面：找「已完成任务点 x/y」和节名旁的数字，读到未完成节名就 click_text，再 browser_chaoxing_play。`
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
        : `已打开「${openedTitle}」，但还没播起来。再 browser_chaoxing_play；不行就回目录重点节名。`,
    }
  }

  return {
    ok: false,
    done: false,
    unfinished,
    unfinishedCount: Number(parsed?.unfinishedCount) || unfinished.length || progressLeft,
    progress,
    skipped,
    hint: `未完成还有：${unfinished.join('、') || `任务点 ${progressLeft}`}。尝试打开失败或都是资料节。不要说全部完成，可再 click_text 下一节或 browser_chaoxing_next。`,
  }
}