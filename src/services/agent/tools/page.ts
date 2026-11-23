import { handleSitePageTool } from '../../browser/siteCapabilities'
import { mediaRefOf, watchFollowHint } from '../../browser/watchToolHelpers'
import { courseRunFor } from '../../browser/courseRunner'
import { nativeWatchFor } from '../../browser/videoWatch'

export const rejectHostedWait = (until: string, seconds: number, hosted: boolean) =>
  hosted && (until === 'fn' || until === 'selector') && seconds > 20

export const handlePageTools = async (ctx: Record<string, any>): Promise<string | null> => {
  const {
    name,
    args,
    browserId,
    sessionId,
    wait,
    role,
    getBrowserState,
    resolveRefLocator,
    waitMs,
    screenshotBrowserView,
    collectPageCaptchaHits,
    materializeCaptchaImages,
    captchaScreenshotHint,
    inspectEvalScript,
    listCachedPageRefs,
    getBrowserState: _gs,
    compactStudyPanel,
  } = ctx
  const siteResult = await handleSitePageTool(ctx)
  if (siteResult != null) return siteResult
  if (name === 'browser_select_tab' || name === 'browser_run_status' || name === 'browser_verify_operation') return JSON.stringify({ ok: false, reason: 'run_context_required', error: '此工具需要当前 Agent 的运行上下文，请通过对话执行；不能脱离运行检查点核对操作。' })
  if (name === 'browser_screenshot') {
    try {
      const state = await getBrowserState(browserId).catch(() => null)
      const hits = await collectPageCaptchaHits(browserId).catch(() => [])
      if (hits.length) await waitMs(60)
      const shot = await screenshotBrowserView(browserId)
      const extras = await materializeCaptchaImages(hits, shot.image).catch(() => ({ images: [] as string[], maxlength: 0 }))
      // 截图不刷新快照/ref；否则模型手中仍是截图前的编号，却在后台全部失效。
      const captchaHint = captchaScreenshotHint(extras.images.length, extras.maxlength)
      return JSON.stringify({
        ok: true,
        url: shot.url || state?.url || '',
        title: state?.title || '',
        image: shot.image,
        images: extras.images.length ? extras.images : undefined,
        captcha: extras.images.length ? { count: extras.images.length, maxlength: extras.maxlength || undefined } : undefined,
        hint: [captchaHint, '截图保留上一份快照的 ref；布局或页面变化后重新 get_page。'].filter(Boolean).join(' '),
      })
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error || '截图失败'),
      })
    }
  }
  if (name === 'browser_watch') {
    const {
      nativeWatchFor,
      readNativeVideoTick,
      startNativeWatch,
      stopNativeWatch,
    } = await import('../../browser/videoWatch')
    const emptyHint = ' 这只是当前看得见的那一条。同一节的其它条在快照的 iframe 分段里。'
    const { watchSessionFastPath } = await import('../../platform/panelAccess')
    const requestedRef = String(args.ref || '').trim()
    const mediaRef = mediaRefOf(browserId, requestedRef, listCachedPageRefs)
    if (requestedRef && !mediaRef) return JSON.stringify({ ok: false, error: '视频 ref 已失效，请重新读取页面快照' })
    const locator = mediaRef ? await resolveRefLocator(browserId, mediaRef) : undefined
    const existing = nativeWatchFor(browserId)
    const sameTarget = !locator || (existing?.locator?.frameId === locator.frameId
      && existing?.locator?.loaderId === locator.loaderId && existing?.locator?.nth === locator.nth)
    const fast = sameTarget ? watchSessionFastPath(existing, null) : ''
    if (fast === 'ended') {
      return JSON.stringify({
        watching: false,
        ended: true,
        already: true,
        title: existing?.title || '',
        hint: '这段视频已经结束。',
      })
    }
    if (fast === 'already') {
      return JSON.stringify({
        watching: true,
        already: true,
        title: existing?.title || '',
        hint: `${watchFollowHint(browserId, true)}${emptyHint}`,
      })
    }
    const tick = await readNativeVideoTick(browserId, locator)
    if (!tick?.hasVideo) {
      return JSON.stringify({
        watching: false,
        error: '当前页没有 <video>',
        ref: mediaRef || undefined,
        hint: mediaRef
          ? '这个 ref 是视频。先点它播放，再 browser_watch。'
          : '先打开播放页并点播放，再 browser_watch。',
      })
    }
    if (tick.paused && !tick.ended) {
      stopNativeWatch(browserId, { keep: true })
      return JSON.stringify({
        watching: false,
        playing: false,
        paused: true,
        video: tick,
        hint: '视频没有在播。下一步：先点播放，确认在播后再 browser_watch。',
      })
    }
    const started = startNativeWatch(browserId, sessionId, {
      ...tick,
      title: String(args.title || existing?.title || '').trim(),
    }, { locator })
    return JSON.stringify({
      watching: true,
      title: started?.title || '',
      video: tick,
      ref: mediaRef || undefined,
      hint: `${watchFollowHint(browserId, false)}${emptyHint}`,
    })
  }
  if (name === 'browser_wait') {
    const untilRaw = String(args.until || '').trim().toLowerCase()
    const until = untilRaw || (args.fn ? 'fn' : args.response ? 'response' : args.selector ? 'selector' : args.url ? 'url' : 'panel')
    if (until === 'fn') {
      const blocked = inspectEvalScript(String(args.fn || ''), 'read')
      if (blocked) return JSON.stringify({ ok: false, error: blocked })
    }
    const fallbackSeconds = until === 'panel' ? 8 : 8
    const seconds = Math.min(600, Math.max(1, Number(args.seconds) || fallbackSeconds))
    const { videoWatchFor } = await import('../../platform/panelAccess')
    const watchLive = (row: { sessionId?: string; status?: string } | null | undefined) => (
      Boolean(row?.sessionId && (row.status === 'watching' || row.status === 'paused' || row.status === 'stalled'))
    )
    const hosted = watchLive(nativeWatchFor(browserId)) || watchLive(videoWatchFor(browserId)) || Boolean(courseRunFor(sessionId))
    if (rejectHostedWait(until, seconds, hosted)) {
      return JSON.stringify({ ok: false, error: '已在监控，finish(watching) 交给宿主' })
    }
    const { runAgentWait } = await import('../agentWait')
    const result = await runAgentWait({
      sessionId,
      browserId,
      seconds,
      wait,
      until,
      url: args.url != null ? String(args.url) : undefined,
      selector: args.selector != null ? String(args.selector) : undefined,
      fn: args.fn != null ? String(args.fn) : undefined,
      response: args.response != null ? String(args.response) : undefined,
      frame: args.frame != null ? String(args.frame) : undefined,
      idleMs: Number(args.idleMs) || undefined,
    })
    return JSON.stringify({
      ...result,
      panel: compactStudyPanel(result.panel),
      url: result.url || '',
      hint: result.hint || (result.reason === 'timeout' ? '还没到等待条件。' : '等待条件已满足。'),
    })
  }
  if (name === 'browser_finish') {
    const { collectFinishEvidence, judgeFinish } = await import('../finishGate')
    const evidence = await collectFinishEvidence(browserId, sessionId, { role: role || 'parent' })
    const judged = judgeFinish(String(args.status || ''), String(args.summary || ''), evidence)
    if (!judged.ok) return JSON.stringify({ ok: false, finished: false, error: 'error' in judged ? judged.error : '还不能收工' })
    return JSON.stringify({ ok: true, finished: judged.status !== 'watching', status: judged.status, summary: judged.summary,
      ...(judged.status === 'watching' ? { awaitingVideo: true, taskComplete: false } : {}) })
  }

  return null
}
