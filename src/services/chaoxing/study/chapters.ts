import {
  CHAOXING_CHAPTER_HOOK,
  CHAOXING_CHAPTER_TICK,
  CHAOXING_CLICK_CHAPTER_TAB,
  CHAOXING_NEXT_STEP,
  CHAOXING_OPEN_CHAPTER,
  CHAOXING_PARSE_CHAPTERS,
} from '../../browser/skills/chaoxingStudy'
import { askFrames, asObject, evalBrowserView, waitMs } from '../../browser/eval'
import { CAPTCHA_HINT, readChaoxingCaptcha } from './captcha'
import { dumpChaoxingParseHtml } from './dump'
import type { ChaoxingChapterSnap } from './types'
import { playChaoxingVideo, readChaoxingVideo, videoIsPlaying } from './video'

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

const waitForChaoxingCatalog = async (id: string, maxMs = 10000) => {
  const started = Date.now()
  let last: Awaited<ReturnType<typeof catalogReadySnap>> = null
  while (Date.now() - started < maxMs) {
    await askFrames(id, 'snap')
    last = await catalogReadySnap(id).catch(() => null)
    if (last?.onCatalog && (last.hasProgress || last.hasDir)) return last
    await waitMs(400)
  }
  return last
}

export const openChaoxingChapters = async (id: string) => {
  const probe = await evalBrowserView(id, `(function(){
    var href = location.href || '';
    var text = '';
    try { text = (document.body && document.body.innerText) || ''; } catch (e) {}
    return {
      url: href,
      already: /已完成任务点/.test(text) || !!document.querySelector('.catalog_title, #coursetree'),
      onStudent: /\\/mycourse\\/stu/.test(href),
    };
  })()`) as { url?: string; already?: boolean; onStudent?: boolean }
  // 只点页内「章节」标签，不要把 iframe src 当顶层网页打开
  if (probe?.onStudent && !probe?.already) {
    await evalBrowserView(id, CHAOXING_CLICK_CHAPTER_TAB).catch(() => null)
    await waitMs(400)
  }
  return readChaoxingChapterSnap(id)
}

const bareChapterTitle = (value: unknown) =>
  String(value || '')
    .replace(/[（(]\s*\d+\s*[）)]\s*$/g, '')
    .replace(/^\d+(?:\.\d+)+\s*/, '')
    .replace(/\s+/g, ' ')
    .trim()

const titlesMatch = (a: unknown, b: unknown) => {
  const left = bareChapterTitle(a)
  const right = bareChapterTitle(b)
  if (!left || !right) return false
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
    if (/^\d{1,2}$/.test(next) && !/^第/.test(line) && line.length > 1 && !/资料|测验|考试|作业|讨论|问卷/.test(line) && !/^第/.test(lines[i + 2] || '')) {
      const title = bareChapterTitle(line) || line
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
  } as ChaoxingChapterSnap
}

const unfinishedFromFrameSnaps = async (id: string) => {
  await askFrames(id, 'snap')
  const extras = asObject(await evalBrowserView(id, `(function(){
    var extras = window.__ZE_FRAME_SNAPS__ || [];
    var text = '';
    for (var i = 0; i < extras.length; i++) {
      if (extras[i] && extras[i].text) text += String(extras[i].text) + '\\n';
    }
    return { text: text.slice(0, 14000) };
  })()`).catch(() => null))
  return unfinishedFromCatalogText(String(extras.text || ''))
}

export const installChaoxingChapterHook = async (id: string) => {
  await askFrames(id, 'snap')
  return evalBrowserView(id, CHAOXING_CHAPTER_HOOK) as Promise<ChaoxingChapterSnap | null>
}

export const readChaoxingChapterTick = (id: string) =>
  evalBrowserView(id, CHAOXING_CHAPTER_TICK) as Promise<ChaoxingChapterSnap | null>

export const readChaoxingChapterSnap = async (id: string) => {
  const first = await installChaoxingChapterHook(id).catch(() => null)
  if ((first?.unfinished || []).length || (first?.progress && first.progress.total > first.progress.done)) {
    return first
  }
  for (let i = 0; i < 8; i += 1) {
    await waitMs(500)
    const tick = await readChaoxingChapterTick(id).catch(() => null)
    if ((tick?.unfinished || []).length || (tick?.progress && tick.progress.total > tick.progress.done)) {
      return tick
    }
    if (i === 3 || i === 6) await installChaoxingChapterHook(id).catch(() => null)
  }
  const last = (await readChaoxingChapterTick(id).catch(() => null)) || first
  if ((last?.unfinished || []).length || (last?.progress && last.progress.total > last.progress.done)) return last
  return (await unfinishedFromFrameSnaps(id)) || last
}

export const parseChaoxingChapters = async (id: string) => {
  const snap = await readChaoxingChapterSnap(id).catch(() => null)
  if (snap && ((snap.unfinished || []).length || snap.progress)) return snap
  try {
    return await evalBrowserView(id, CHAOXING_PARSE_CHAPTERS) as ChaoxingChapterSnap | null
  } catch (error) {
    await dumpChaoxingParseHtml(id, 'parse-error').catch(() => null)
    throw error
  }
}

export const openChaoxingChapter = async (id: string, title: string) => {
  const want = bareChapterTitle(title)
  if (!want) return { ok: false, error: '缺少节名' }
  const opened = asObject(await evalBrowserView(id, `${CHAOXING_OPEN_CHAPTER}(${JSON.stringify(want)})`))
  if (opened.ok) {
    await waitMs(1000)
    return opened
  }
  const parsed = await parseChaoxingChapters(id).catch(() => null)
  const hit = (parsed?.chapters || []).find((item) => titlesMatch(item.title, want))
  const studyHref = String(hit?.studyHref || '')
  const href = String(hit?.href || '')
  const playerHref = studyHref.includes('studentstudy')
    ? studyHref
    : (href.includes('studentstudy') ? href : '')
  if (playerHref) {
    await navigateBrowserView(id, playerHref)
    await waitMs(1200)
    return { ok: true, title: hit?.title || want, via: 'player' }
  }
  const chapterId = String(hit?.chapterId || '')
  if (chapterId) {
    const state = await getBrowserState(id).catch(() => null)
    try {
      const current = new URL(String(state?.url || parsed?.url || ''))
      const courseId = current.searchParams.get('courseid') || current.searchParams.get('courseId') || ''
      const clazzid = current.searchParams.get('clazzid') || current.searchParams.get('clazzId') || ''
      const cpi = current.searchParams.get('cpi') || ''
      const enc = current.searchParams.get('enc') || current.searchParams.get('stuenc') || ''
      if (courseId && clazzid) {
        const player = `https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=${chapterId}&courseId=${courseId}&clazzid=${clazzid}${cpi ? `&cpi=${cpi}` : ''}${enc ? `&enc=${enc}` : ''}&mooc2=1`
        await navigateBrowserView(id, player)
        await waitMs(1200)
        return { ok: true, title: hit?.title || want, via: 'chapterId' }
      }
    } catch {
      // ignore
    }
  }
  const fallback = await clickBrowserText(id, want).catch(() => null) as { ok?: boolean; text?: string } | null
  if (fallback?.ok) {
    await waitMs(1000)
    return { ok: true, title: want, via: 'click_text', text: fallback.text }
  }
  return { ok: false, error: String(opened.error || `目录里没有「${want}」`), want }
}

const SKIP_CHAPTER = /资料|测验|考试|作业|讨论|问卷/

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
    return { quiz: true, step: String(moved.step || ''), hasVideo: false, more: false }
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
  const onStudent = await evalBrowserView(id, `(function(){ return /\\/mycourse\\/stu/.test(location.href || ''); })()`).catch(() => false)
  if (onStudent) {
    await evalBrowserView(id, CHAOXING_CLICK_CHAPTER_TAB).catch(() => null)
    await waitForChaoxingCatalog(id, 5000)
  }
  let parsed = await readChaoxingChapterSnap(id).catch((error) => {
    parseError = String(error?.message || error || '')
    return null
  })
  if (!(parsed?.unfinished || []).length && !parsed?.progress) {
    await evalBrowserView(id, CHAOXING_CLICK_CHAPTER_TAB).catch(() => null)
    await waitForChaoxingCatalog(id, 4000)
    parsed = await readChaoxingChapterSnap(id).catch((error) => {
      parseError = String(error?.message || error || parseError)
      return parsed
    })
  }
  if (!(parsed?.unfinished || []).length) {
    parsed = (await unfinishedFromFrameSnaps(id)) || parsed
  }
  const unfinished = (parsed?.unfinished || []).map(bareChapterTitle).filter(Boolean)
  const progress = parsed?.progress || null
  const progressLeft = progress && progress.total > progress.done
    ? progress.total - progress.done
    : 0
  const preferred = bareChapterTitle(title)
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
        hint: `页面显示还有 ${progressLeft} 个未完成任务点（已完成 ${progress?.done}/${progress?.total}），但目录项没对上。不要说全部完成。立刻 browser_get_page 看目录正文和 iframe，读到节名就再调 browser_chaoxing_study，title 填干净节名。`,
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
          ? `解析目录失败：${parseError}。不要说全部完成。立刻 browser_get_page / browser_eval 自己读页面：找「已完成任务点 x/y」和节名旁的数字，读到未完成节名再 browser_chaoxing_study。`
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
        hint: '当前是测验/作业，停下让用户自己做。',
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
        : `已打开「${openedTitle}」，但还没播起来。再调一次 browser_chaoxing_study 或 browser_chaoxing_play。`,
    }
  }

  return {
    ok: false,
    done: false,
    unfinished,
    unfinishedCount: Number(parsed?.unfinishedCount) || unfinished.length || progressLeft,
    progress,
    skipped,
    hint: `未完成还有：${unfinished.join('、') || `任务点 ${progressLeft}`}。尝试打开失败或都是资料节。不要说全部完成，可再调一次 browser_chaoxing_study。`,
  }
}