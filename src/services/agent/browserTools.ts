import {
  clickBrowserElement,
  clickBrowserText,
  evalBrowserView,
  getBrowserState,
  goBackBrowserView,
  goForwardBrowserView,
  listAppBrowsers,
  navigateBrowserView,
  readBrowserPage,
  reloadBrowserView,
  scrollBrowserView,
  typeBrowserElement,
} from '../browser/appBrowser'
import { waitMs } from '../browser/eval'
import { chapterStateFor } from '../chaoxing/browser/chapters'
import { ensureStudyWatch, liveStudyPlayback } from '../chaoxing/browser/playback'
import { openChaoxingChapter } from '../chaoxing/study/chapters'
import { installChaoxingVideoHook, readChaoxingVideoTick, videoIsPlaying } from '../chaoxing/study/video'
import {
  ensurePlatformAdapters,
  normalizePlatformTool,
  resolvePlatformAdapter,
  type HomeworkAction,
  type PlatformAdapter,
} from '../platform'
import { clickByLocator, cssSelectorFromArgs, fillByLocator, looksLikeCssSelector, resolveRefLocator } from '../browser/engine'
import { rememberLoginTyped } from './siteAccounts'

ensurePlatformAdapters()

const currentUrl = async (browserId: string) => {
  const state = await getBrowserState(browserId).catch(() => null)
  return String(state?.url || listAppBrowsers().find((b) => b.id === browserId)?.url || '')
}

const adapterFor = async (browserId: string): Promise<PlatformAdapter | null> => (
  resolvePlatformAdapter(await currentUrl(browserId))
)

const studyHints = {
  homeworkFill: '题卡和网页是自动双向同步的：browser_homework action=fill 会同步到网页，网页状态会自动回到题卡。题干/选项还没读出的题先跳过答其他题，稍后 inspect 一次抽象层会自动补读，不要猜答案。',
  getPage: '先看 snapshot 里的 button/link/heading。课程页点「章节」后用 browser_study_chapters，不要用本工具找目录。',
  iframeNav: '不要把 iframe 地址当顶层网页打开。留在当前课页，用 click_text / browser_study_play 在页面里操作。',
  captchaOk: '验证码已提交。立刻 browser_study_play 继续；不在播放页就点回章节再进节。',
  nextPaused: '已打开下一个视频，但还是暂停的。立刻 browser_study_play，不要说正在播放。',
  homeworkForbidden: '当前不是作业/章节测验页，禁止调用 browser_homework',
  chapterNoList: '直接 inspect → fill（或 guess）→ save/submit，再 browser_study_next。',
}

export const executeBrowserTool = async (input: {
  name: string
  args: Record<string, unknown>
  browserId: string
  sessionId: string
  wait: (ms: number) => Promise<void>
}): Promise<string> => {
  const { name, args, browserId, sessionId, wait } = input
  const platformTool = normalizePlatformTool(name)

  // 作业答题页只允许走题卡：读页面/点选项一律挡回，题卡和网页自动双向同步
  if (['browser_get_page', 'browser_eval', 'browser_click', 'browser_type'].includes(name)) {
    const { isHomeworkUrl } = await import('../browser/abstractions')
    const nowUrl = await currentUrl(browserId)
    if (isHomeworkUrl(nowUrl) && /dowork|doHomeWork|\/work\/do/i.test(nowUrl)) {
      return JSON.stringify({
        error: '作业页禁止读网页或直接点页面',
        hint: studyHints.homeworkFill,
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
    try {
      const page = await readBrowserPage(browserId)
      if (page == null || !Object.keys(page).length) {
        return JSON.stringify({
          error: '页面读取失败',
          hint: studyHints.getPage,
        })
      }
      return JSON.stringify(page)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return JSON.stringify({
        error: message || '页面读取失败',
        hint: studyHints.getPage,
      })
    }
  }
  if (name === 'browser_navigate') {
    const url = String(args.url || '').trim()
    if (!url) return JSON.stringify({ error: '缺少网址' })
    const iframePage = /studentcourse|\/knowledge\/cards|ananas\/modules|insertvideo|insertdoc|insertaudio|insertbbs/i.test(url)
    if (iframePage) {
      return JSON.stringify({
        ok: false,
        error: studyHints.iframeNav,
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
    const ref = String(args.ref || '').trim()
    const selector = String(args.selector || '').trim()
    const css = cssSelectorFromArgs(ref, selector)
    if (ref && !looksLikeCssSelector(ref)) {
      const locator = await resolveRefLocator(browserId, ref)
      if (locator) return JSON.stringify(await clickByLocator(browserId, locator))
      if (css) return JSON.stringify(await clickBrowserElement(browserId, css))
      return JSON.stringify({
        error: `没有找到快照 ref ${ref}。ref 只能是 e3 这种编号。CSS 请用 selector=#loginBtn，不要放进 ref，也不要 get_page。`,
      })
    }
    if (!css) return JSON.stringify({ error: '缺少 ref 或 selector。快照用 ref=e3，CSS 用 selector=#loginBtn。' })
    return JSON.stringify(await clickBrowserElement(browserId, css))
  }
  if (name === 'browser_click_text') {
    const text = String(args.text || '').trim()
    if (!text) return JSON.stringify({ error: '缺少 text' })
    const clicked = await clickBrowserText(browserId, text) as { ok?: boolean; error?: string; text?: string }
    if (clicked?.ok) return JSON.stringify(clicked)
    const nowUrl = await currentUrl(browserId)
    const chrome = /^(我学的课|我教的课|章节|任务|作业|讨论|考试|资料|登录|返回课程|下一节|体验新版)$/.test(text)
    if (!chrome && /studentstudy/i.test(nowUrl)) {
      return JSON.stringify({
        ok: true,
        text,
        via: 'already-player',
        hint: '已在播放页。立刻 browser_study_play，不要 get_page。',
      })
    }
    if (!chrome && /chaoxing|mooc/i.test(nowUrl)) {
      const opened = await openChaoxingChapter(browserId, text).catch(() => null)
      if (opened?.ok) {
        return JSON.stringify({
          ok: true,
          text,
          via: 'chapter-parser',
          hint: '已用章节解析器打开该节。立刻 browser_study_play，不要 get_page。',
        })
      }
    }
    return JSON.stringify(clicked)
  }
  if (name === 'browser_type') {
    const ref = String(args.ref || '').trim()
    const selector = String(args.selector || '').trim()
    const text = String(args.text ?? '')
    const nowUrl = await currentUrl(browserId)
    const css = cssSelectorFromArgs(ref, selector)
    if (ref && !looksLikeCssSelector(ref)) {
      const locator = await resolveRefLocator(browserId, ref)
      if (locator) {
        rememberLoginTyped(nowUrl, locator.value, text)
        return JSON.stringify(await fillByLocator(browserId, locator, text))
      }
      if (css) {
        rememberLoginTyped(nowUrl, css, text)
        return JSON.stringify(await typeBrowserElement(browserId, css, text))
      }
      return JSON.stringify({
        error: `没有找到快照 ref ${ref}。ref 只能是 e3 这种编号。CSS 请用 selector=#phone，不要放进 ref，也不要 get_page。`,
      })
    }
    if (!css) return JSON.stringify({ error: '缺少 ref 或 selector。快照用 ref=e3，CSS 用 selector=#phone。' })
    rememberLoginTyped(nowUrl, css, text)
    return JSON.stringify(await typeBrowserElement(browserId, css, text))
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

  if (platformTool === 'browser_study_chapters') {
    const adapter = await adapterFor(browserId)
    if (!adapter) return JSON.stringify({ error: '当前站点不支持章节工具' })
    const catalog = await adapter.openChapters(browserId)
    const open = String(args.open || args.title || '').trim()
    if (!open) return JSON.stringify(catalog)
    const opened = await openChaoxingChapter(browserId, open)
    return JSON.stringify({
      catalog,
      opened,
      hint: opened.ok
        ? '已打开该节。立刻 browser_study_play，不要 get_page。'
        : String((opened as { error?: string }).error || '没打开，再调一次或直接 browser_study_play。'),
    })
  }

  if (platformTool === 'browser_study_play') {
    const adapter = await adapterFor(browserId)
    if (!adapter) return JSON.stringify({ error: '当前站点不支持播放工具' })
    const nowUrl = await currentUrl(browserId)
    if (!/studentstudy/i.test(nowUrl) && /mycourse\/stu|stucoursemiddle/i.test(nowUrl)) {
      const first = String(chapterStateFor(browserId)?.unfinished?.[0] || '').trim()
      if (first) {
        const short = first.replace(/^\d+(?:\.\d+)+\s*/, '').trim() || first
        const opened = await openChaoxingChapter(browserId, short).catch(() => null)
        if (!opened?.ok) await clickBrowserText(browserId, short).catch(() => null)
        await waitMs(1200)
      }
    }
    const videoIndex = Number(args.videoIndex) || 0
    const label = String(args.label || '').trim()
    const run = () => adapter.playVideo(browserId, {
      videoIndex: videoIndex > 0 ? videoIndex : undefined,
      label: label || undefined,
      // 没指定任务点时：点当前激活视频标签播放；已在视频上不会跳回第一个
      skipTabClick: false,
    })
    let played: Record<string, unknown>
    try {
      played = adapter.runAfterCaptcha
        ? await adapter.runAfterCaptcha(sessionId, browserId, run)
        : await run()
    } catch (error) {
      const timeout = /超时|timeout/i.test(error instanceof Error ? error.message : String(error))
      if (!timeout) throw error
      await waitMs(600)
      await installChaoxingVideoHook(browserId).catch(() => null)
      const tick = await readChaoxingVideoTick(browserId).catch(() => null)
      const live = liveStudyPlayback(browserId)
      const hasPlayer = videoIsPlaying(tick) || Number(tick?.duration) > 1 || live.duration > 1 || live.playing
      if (!hasPlayer) {
        const url = await currentUrl(browserId)
        if (/studentstudy/i.test(url)) {
          return JSON.stringify({
            page: 'player',
            hasVideo: true,
            playing: false,
            timedOut: true,
            hint: '播放脚本超时，但已在播放页。这不是资料。立刻再 browser_study_play，禁止 next / get_page。',
          })
        }
        throw error
      }
      const watching = live.playing || videoIsPlaying(tick)
        ? Boolean(ensureStudyWatch(browserId, sessionId, {
          ...live,
          playing: live.playing || videoIsPlaying(tick),
          current: Number(tick?.current ?? live.current) || 0,
          duration: Number(tick?.duration ?? live.duration) || 0,
          paused: tick ? Boolean(tick.paused) : live.paused,
          ended: Boolean(tick?.ended || live.ended),
        }).watching)
        : false
      played = {
        page: 'player',
        hasVideo: true,
        playing: live.playing || videoIsPlaying(tick),
        paused: tick ? Boolean(tick.paused) : !live.playing,
        ended: Boolean(tick?.ended || live.ended),
        current: Number(tick?.current ?? live.current) || 0,
        duration: Number(tick?.duration ?? live.duration) || 0,
        title: live.title,
        recovered: true,
        watching,
        hint: watching
          ? '播放脚本超时，但已确认视频在播。已交给监控，不要 reload / get_page。'
          : '播放脚本超时，播放器还在。不要 reload，再 play 一次。',
      }
    }
    if (played?.captcha || played?.quiz) return JSON.stringify(played)
    if (played?.hasVideo) {
      const playing = adapter.videoIsPlaying(played) || Boolean(played.playing)
      if (playing || played.watching) {
        adapter.startWatch(
          browserId,
          sessionId,
          { ...played, paused: !playing },
          { resume: Boolean(adapter.videoWatchFor(browserId)) },
        )
      }
      return JSON.stringify({
        ...played,
        playing,
        watching: playing || Boolean(played.watching),
        hint: String(played.hint || (
          playing
            ? '已确认在播当前任务点。进度条会实时更新；播完系统按 attachments 切下一个，不要自己点回第一个视频。'
            : '播放器在，但视频没有播起来。不要说正在播放；可用 videoIndex 指定第几个视频再 play。'
        )),
      })
    }
    return JSON.stringify(played)
  }

  if (platformTool === 'browser_study_watch') {
    const adapter = await adapterFor(browserId)
    if (!adapter) return JSON.stringify({ error: '当前站点不支持进度监控' })
    const existing = adapter.videoWatchFor(browserId)
    if (existing && (existing.status === 'watching' || existing.status === 'paused' || existing.status === 'stalled')) {
      return JSON.stringify({
        watching: true,
        already: true,
        title: existing.title,
        hint: '已经在监控，进度条会自己走。不要重复调用，不要 browser_wait。',
      })
    }
    let snap = await adapter.readVideo(browserId)
    if (snap?.captcha) {
      const solve = async () => {
        snap = await adapter.readVideo(browserId)
        return { captcha: Boolean(snap?.captcha), hint: snap?.hint }
      }
      const solved = adapter.runAfterCaptcha
        ? await adapter.runAfterCaptcha(sessionId, browserId, solve)
        : await solve()
      if (solved.captcha) return JSON.stringify({ captcha: true, watching: false, hint: solved.hint })
    }
    const video = (snap?.video && typeof snap.video === 'object')
      ? snap.video as Record<string, unknown>
      : null
    adapter.startWatch(browserId, sessionId, video
      ? { ...video, title: snap?.current, next: snap?.next }
      : { title: snap?.current, next: snap?.next })
    return JSON.stringify({
      watching: true,
      title: snap?.current || '',
      next: snap?.next || '',
      jobDone: snap?.jobDone ?? null,
      quiz: Boolean(snap?.quiz),
      video: snap?.video || null,
      hint: '进度条实时更新。播完系统会自动切下一视频；卡住/丢播放器/验证码/测验才叫你。不要 browser_wait。',
    })
  }

  if (platformTool === 'browser_captcha') {
    const adapter = await adapterFor(browserId)
    if (!adapter) return JSON.stringify({ error: '当前站点不支持验证码工具' })
    const code = String(args.code || '').trim()
    if (!code) return JSON.stringify({ error: '缺少 code，填图中 4 位字母或数字' })
    const filled = await adapter.fillCaptcha(browserId, code)
    if (filled.ok) adapter.clearPendingCaptcha?.(sessionId)
    return JSON.stringify({
      ...filled,
      hint: filled.ok
        ? studyHints.captchaOk
        : `${filled.error || '没填上'}。再看图读一次，或换一张再填。不要问用户。`,
    })
  }

  if (platformTool === 'browser_study_next') {
    const adapter = await adapterFor(browserId)
    if (!adapter) return JSON.stringify({ error: '当前站点不支持下一节工具' })
    const run = () => adapter.openNext(browserId)
    const next = adapter.runAfterCaptcha
      ? await adapter.runAfterCaptcha(sessionId, browserId, run)
      : await run()
    if (next?.captcha || next?.quiz) return JSON.stringify(next)
    if (next?.hasVideo && Number(next.duration) > 1) {
      const playing = adapter.videoIsPlaying(next)
      adapter.startWatch(browserId, sessionId, {
        ...next,
        paused: !playing,
        title: next.opened || next.title,
        moreVideos: Boolean(next.moreVideos),
        videoCount: Number(next.videoCount) || 0,
        videoIndex: Number(next.videoIndex) || 0,
      })
      return JSON.stringify({
        ...next,
        playing,
        watching: playing,
        hint: playing
          ? next.sameChapter
            ? '已打开本章下一个视频并确认在播。不要停。'
            : '已打开下一节视频并确认在播。不要停。'
          : studyHints.nextPaused,
      })
    }
    return JSON.stringify(next)
  }

  if (platformTool === 'browser_homework') {
    const adapter = await adapterFor(browserId)
    if (!adapter) return JSON.stringify({ error: '当前站点不支持作业工具' })
    const nowUrl = await currentUrl(browserId)
    if (!adapter.canUseHomeworkTools(nowUrl)) {
      return JSON.stringify({
        error: studyHints.homeworkForbidden,
        url: nowUrl,
        hint: '课程作业：先点「作业」到列表或作答页；章节测验：在播放页点开测验标签后再调。',
      })
    }
    const chapterQuiz = adapter.isChapterWorkUrl(nowUrl)
    const action = String(args.action || 'list').trim() as HomeworkAction | string
    if (chapterQuiz && ['list', 'open'].includes(action)) {
      return JSON.stringify({
        error: '章节测验页不要 list/open',
        url: nowUrl,
        hint: studyHints.chapterNoList,
      })
    }
    if (!chapterQuiz && !adapter.isHomeworkUrl(nowUrl)) {
      return JSON.stringify({
        error: '当前不是作业页',
        url: nowUrl,
      })
    }
    if (['inspect', 'fill', 'guess', 'save', 'submit'].includes(action) && !adapter.isHomeworkDoUrl(nowUrl) && !chapterQuiz) {
      return JSON.stringify({
        error: '当前是作业列表，不是作答页',
        url: nowUrl,
        hint: '列表页用 list / open；进作答页后再 inspect / fill / save / submit。',
      })
    }
    if (['list', 'open'].includes(action) && adapter.isHomeworkDoUrl(nowUrl) && !adapter.isHomeworkListUrl(nowUrl)) {
      if (action === 'open') {
        return JSON.stringify({
          error: '已在作答页，不要 open',
          hint: '直接 inspect / fill / save。',
        })
      }
    }
    if (!['list', 'open', 'inspect', 'fill', 'guess', 'save', 'submit'].includes(action)) {
      return JSON.stringify({ error: 'action 必须是 list / open / inspect / fill / guess / save / submit' })
    }
    const result = await adapter.runHomework(browserId, {
      action: action as HomeworkAction,
      title: args.title != null ? String(args.title) : undefined,
      answers: args.answers,
    })
    return typeof result === 'string' ? result : JSON.stringify(result)
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
