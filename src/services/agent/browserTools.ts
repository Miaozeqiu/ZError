import {
  clickBrowserElement,
  clickBrowserText,
  evalBrowserView,
  fillChaoxingCaptcha,
  fillChaoxingHomework,
  getBrowserState,
  inspectChaoxingHomework,
  openChaoxingHomeworkItem,
  openChaoxingHomeworkList,
  saveChaoxingHomework,
  submitChaoxingHomework,
  goBackBrowserView,
  goForwardBrowserView,
  listAppBrowsers,
  navigateBrowserView,
  openChaoxingChapters,
  openNextChaoxingChapter,
  playChaoxingVideo,
  readBrowserPage,
  readChaoxingVideo,
  reloadBrowserView,
  scrollBrowserView,
  typeBrowserElement,
  videoIsPlaying,
} from '../browser/appBrowser'
import {
  startChaoxingWatch,
  videoWatchFor,
} from '../chaoxing/browser/watch'
import { clearPendingCaptcha, runAfterCaptcha } from '../chaoxing/browser/watchAgent'
import { rememberLoginTyped } from './siteAccounts'

export const executeBrowserTool = async (input: {
  name: string
  args: Record<string, unknown>
  browserId: string
  sessionId: string
  wait: (ms: number) => Promise<void>
}): Promise<string> => {
  const { name, args, browserId, sessionId, wait } = input
  // 作业答题页只允许走题卡：读页面/点选项一律挡回，题卡和网页自动双向同步
  if (['browser_get_page', 'browser_eval', 'browser_click', 'browser_type'].includes(name)) {
    const { isHomeworkUrl } = await import('../browser/abstractions')
    const state = await getBrowserState(browserId).catch(() => null)
    const nowUrl = String(state?.url || listAppBrowsers().find((b) => b.id === browserId)?.url || '')
    if (isHomeworkUrl(nowUrl) && /dowork|doHomeWork/i.test(nowUrl)) {
      return JSON.stringify({
        error: '作业页禁止读网页或直接点页面',
        hint: '题卡和网页是自动双向同步的：browser_chaoxing_homework action=fill 会同步到网页，网页状态会自动回到题卡。题干/选项还没读出的题先跳过答其他题，稍后 inspect 一次抽象层会自动补读，不要猜答案。',
      })
    }
  }
  if (name === 'browser_get_state') {
    const state = await getBrowserState(browserId).catch(() => null)
    const item = listAppBrowsers().find((browser) => browser.id === browserId)
    const url = state?.url || item?.url || ''
    const { siteGraphAgentSnap } = await import('../browser/siteGraph')
    return JSON.stringify({
      id: browserId,
      url,
      title: state?.title || item?.title || item?.name || '',
      siteGraph: siteGraphAgentSnap(url),
    })
  }
  if (name === 'browser_get_page') {
    const page = await readBrowserPage(browserId)
    if (page == null) {
      return JSON.stringify({
        error: '页面读取失败',
        hint: '不要再 get_page 或 eval iframe。在课程页点「章节」，用 browser_chaoxing_chapters 看未完成，再 click_text 节名，到播放页 browser_chaoxing_play。',
      })
    }
    return JSON.stringify(page)
  }
  if (name === 'browser_navigate') {
    const url = String(args.url || '').trim()
    if (!url) return JSON.stringify({ error: '缺少网址' })
    const iframePage = /studentcourse|\/knowledge\/cards|ananas\/modules|insertvideo|insertdoc|insertaudio|insertbbs/i.test(url)
    if (iframePage) {
      return JSON.stringify({
        ok: false,
        error: '不要把 iframe 地址当顶层网页打开。留在当前课页，用 click_text / browser_chaoxing_play 在页面里操作。',
      })
    }
    await navigateBrowserView(browserId, url)
    await wait(800)
    return JSON.stringify({ ok: true, url })
  }
  if (name === 'browser_reload') {
    await reloadBrowserView(browserId)
    await wait(500)
    return JSON.stringify({ ok: true })
  }
  if (name === 'browser_go_back') {
    await goBackBrowserView(browserId)
    await wait(400)
    return JSON.stringify({ ok: true })
  }
  if (name === 'browser_go_forward') {
    await goForwardBrowserView(browserId)
    await wait(400)
    return JSON.stringify({ ok: true })
  }
  if (name === 'browser_click') {
    const selector = String(args.selector || '').trim()
    if (!selector) return JSON.stringify({ error: '缺少 selector' })
    return JSON.stringify(await clickBrowserElement(browserId, selector))
  }
  if (name === 'browser_click_text') {
    const text = String(args.text || '').trim()
    if (!text) return JSON.stringify({ error: '缺少 text' })
    return JSON.stringify(await clickBrowserText(browserId, text))
  }
  if (name === 'browser_type') {
    const selector = String(args.selector || '').trim()
    if (!selector) return JSON.stringify({ error: '缺少 selector' })
    const text = String(args.text ?? '')
    const nowUrl = String(
      (await getBrowserState(browserId).catch(() => null))?.url
      || listAppBrowsers().find((b) => b.id === browserId)?.url
      || '',
    )
    rememberLoginTyped(nowUrl, selector, text)
    return JSON.stringify(await typeBrowserElement(browserId, selector, text))
  }
  if (name === 'browser_scroll') {
    const amount = Number(args.amount)
    return JSON.stringify(await scrollBrowserView(browserId, Number.isFinite(amount) ? amount : 600))
  }
  if (name === 'browser_eval') {
    const script = String(args.script || '').trim()
    if (!script) return JSON.stringify({ error: '缺少 script' })
    return JSON.stringify({ result: await evalBrowserView(browserId, script) })
  }
  if (name === 'browser_chaoxing_chapters') {
    return JSON.stringify(await openChaoxingChapters(browserId))
  }
  if (name === 'browser_chaoxing_play') {
    const played = await runAfterCaptcha(sessionId, browserId, () =>
      playChaoxingVideo(browserId) as Promise<{
        hasVideo?: boolean
        playing?: boolean
        current?: number
        duration?: number
        paused?: boolean
        ended?: boolean
        captcha?: boolean
        hint?: string
      }>,
    )
    if (played?.captcha) return JSON.stringify(played)
    if (played?.hasVideo) {
      const playing = videoIsPlaying(played)
      startChaoxingWatch(
        browserId,
        sessionId,
        { ...played, paused: !playing },
        { resume: Boolean(videoWatchFor(browserId)) },
      )
      return JSON.stringify({
        ...played,
        playing,
        watching: playing,
        hint: playing
          ? '已确认在播。进度在 Agent 面板。系统会定时和按进度叫你核对，不要 browser_wait 空等整节。'
          : '播放器在，但视频没有播起来。不要说正在播放，再点一次播放或告诉用户没播起来。',
      })
    }
    return JSON.stringify(played)
  }
  if (name === 'browser_chaoxing_watch') {
    const existing = videoWatchFor(browserId)
    if (existing && (existing.status === 'watching' || existing.status === 'paused' || existing.status === 'stalled')) {
      return JSON.stringify({
        watching: true,
        already: true,
        title: existing.title,
        hint: '已经在监控，进度在 Agent 面板。不要重复调用，不要 browser_wait。',
      })
    }
    let snap = await readChaoxingVideo(browserId)
    if (snap?.captcha) {
      const solved = await runAfterCaptcha(sessionId, browserId, async () => {
        snap = await readChaoxingVideo(browserId)
        return { captcha: Boolean(snap?.captcha), hint: snap?.hint }
      })
      if (solved.captcha) return JSON.stringify({ captcha: true, watching: false, hint: solved.hint })
    }
    startChaoxingWatch(browserId, sessionId, snap?.video
      ? { ...snap.video, title: snap.current, next: snap.next }
      : { title: snap?.current, next: snap?.next })
    return JSON.stringify({
      watching: true,
      title: snap?.current || '',
      next: snap?.next || '',
      jobDone: snap?.jobDone ?? null,
      quiz: Boolean(snap?.quiz),
      video: snap?.video || null,
      hint: '进度在 Agent 面板。系统会定时叫你核对。这个视频结束了会先切本章下一个视频。',
    })
  }
  if (name === 'browser_chaoxing_captcha') {
    const code = String(args.code || '').trim()
    if (!code) return JSON.stringify({ error: '缺少 code，填图中 4 位字母或数字' })
    const filled = await fillChaoxingCaptcha(browserId, code)
    if (filled.ok) clearPendingCaptcha(sessionId)
    return JSON.stringify({
      ...filled,
      hint: filled.ok
        ? '验证码已提交。立刻 browser_chaoxing_play 继续；不在播放页就点回章节再进节。'
        : `${filled.error || '没填上'}。再看图读一次，或换一张再填。不要问用户。`,
    })
  }
  if (name === 'browser_chaoxing_next') {
    const next = await runAfterCaptcha(sessionId, browserId, () =>
      openNextChaoxingChapter(browserId) as Promise<{
        hasVideo?: boolean
        quiz?: boolean
        captcha?: boolean
        opened?: string
        title?: string
        next?: string
        current?: number
        duration?: number
        paused?: boolean
        ended?: boolean
        skipped?: string[]
        hint?: string
      }>,
    )
    if (next?.captcha || next?.quiz) return JSON.stringify(next)
    if (next?.hasVideo && Number(next.duration) > 1) {
      const playing = videoIsPlaying(next)
      startChaoxingWatch(browserId, sessionId, {
        ...next,
        paused: !playing,
        title: next.opened || next.title,
        moreVideos: Boolean((next as { moreVideos?: boolean }).moreVideos),
        videoCount: Number((next as { videoCount?: number }).videoCount) || 0,
        videoIndex: Number((next as { videoIndex?: number }).videoIndex) || 0,
      })
      return JSON.stringify({
        ...next,
        playing,
        watching: playing,
        hint: playing
          ? (next as { sameChapter?: boolean }).sameChapter
            ? '已打开本章下一个视频并确认在播。不要停。'
            : '已打开下一节视频并确认在播。不要停。'
          : '已打开下一个视频，但还是暂停的。立刻 browser_chaoxing_play，不要说正在播放。',
      })
    }
    return JSON.stringify(next)
  }
  if (name === 'browser_chaoxing_homework') {
    const action = String(args.action || 'list').trim()
    // 题卡里的 data URL 图只给面板看，回给模型前换成短标记，避免撑爆上下文
    const stripHwImages = (card: Awaited<ReturnType<typeof inspectChaoxingHomework>>) => {
      const brief = (src?: string) => {
        const s = String(src || '')
        return s.startsWith('data:') ? '［图，已由视觉读成文字］' : s
      }
      return JSON.stringify({
        ...card,
        questions: (card.questions || []).map((q) => ({
          ...q,
          images: (q.images || []).map(brief),
          options: (q.options || []).map((opt) => ({
            ...opt,
            image: brief(opt.image),
            images: (opt.images || []).map(brief),
          })),
        })),
      })
    }
    if (action === 'list') return JSON.stringify(await openChaoxingHomeworkList(browserId))
    if (action === 'inspect') return stripHwImages(await inspectChaoxingHomework(browserId))
    if (action === 'open') {
      const title = String(args.title || '').trim()
      if (!title) return JSON.stringify({ error: 'open 需要 title' })
      return JSON.stringify(await openChaoxingHomeworkItem(browserId, title))
    }
    if (action === 'fill') {
      // fill 只回进度摘要（内部只做一次轻量状态检查，不全量重读）
      return JSON.stringify(await fillChaoxingHomework(browserId, args.answers))
    }
    if (action === 'save') return stripHwImages(await saveChaoxingHomework(browserId))
    if (action === 'submit') return stripHwImages(await submitChaoxingHomework(browserId))
    return JSON.stringify({ error: 'action 必须是 list / open / inspect / fill / save / submit' })
  }
  if (name === 'browser_wait') {
    const seconds = Math.min(60, Math.max(1, Number(args.seconds) || 20))
    await wait(seconds * 1000)
    const state = await getBrowserState(browserId).catch(() => null)
    return JSON.stringify({ ok: true, waited: seconds, url: state?.url || '' })
  }
  if (name === 'browser_finish') {
    const status = String(args.status || '').trim()
    const summary = String(args.summary || '').trim()
    if (!/^(done|blocked|watching)$/.test(status)) {
      return JSON.stringify({ error: 'status 必须是 done / blocked / watching' })
    }
    if (!summary) return JSON.stringify({ error: '缺少 summary' })
    return JSON.stringify({ ok: true, finished: true, status, summary })
  }

  return JSON.stringify({ error: `未知浏览器工具：${name}` })
}
