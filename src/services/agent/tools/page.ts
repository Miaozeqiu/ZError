
import { cachedPageSnap } from '../../browser/engine/pageSnap'
import { coursePlanFor, coursePlanNudge } from '../../browser/coursePlan'
import { courseRunFor } from '../../browser/courseRunner'
import { nativeWatchFor } from '../../browser/videoWatch'

export const rejectHostedWait = (until: string, seconds: number, hosted: boolean) =>
  hosted && (until === 'fn' || until === 'selector') && seconds > 20

const watchFollowHint = (browserId: string, already: boolean) => {
  const base = already
    ? '已经在监控。播完会叫醒你，现在 finish(watching)。'
    : '进度条实时更新。播完会叫醒你，现在 finish(watching)。'
  const nudge = coursePlanNudge(cachedPageSnap(browserId)?.snapshot || '', Boolean(coursePlanFor(browserId)))
  return nudge ? `${base} ${nudge}。` : base
}

const mediaRefOf = (browserId: string, ref: string, listRefs: (id: string) => Array<{ id?: string; role?: string; locator?: { role?: string; value?: string } }>) => {
  const id = String(ref || '').trim()
  if (!id) return ''
  const hit = listRefs(browserId).find((item) => item.id === id)
  if (!hit) return ''
  const role = String(hit.role || hit.locator?.role || hit.locator?.value || '')
  return role === 'video' || role === 'audio' ? id : ''
}

export const handlePageTools = async (ctx: Record<string, any>): Promise<string | null> => {
  const {
    name, args, browserId, sessionId, wait, role, loop, policy, failWithCard, platformTool,
    currentUrl, graphUrlOf, liveHref,
    notePageProbe, readBrowserPage, getBrowserState, peekAppBrowserUrl, emptyPageSnaps, callProtocol,
    graphNodeId, siteGraphNodeForUrl, isShellNode, SPACE_HINT, COURSE_HW_HINT,
    browserTaskIntent, resolveChaoxingLoginUrl, sameChaoxingCourse, isChaoxingIframeNavUrl, isSpaceListTopUrl,
    IFRAME_NAV_HINT, navigateBrowserView, evalBrowserView, pageHostMatches, pageHostOf, reloadBrowserView,
    goBackBrowserView, goForwardBrowserView, formatMissRefsHint, cssSelectorFromArgs, looksLikeCssSelector,
    resolveRefLocator, clickByLocator, clickBrowserElement, clickBrowserText, observeAfterClick, asObject,
    rememberLoginTyped, typeBrowserElement, fillByLocator, waitMs, listAppBrowsers, readChaoxingSpaceContext,
    readPageSnapshot, isEvalActBusy, displaySiteName, missingHostNeeds, missingNeedsNote, nextStep,
    screenshotBrowserView, collectPageCaptchaHits, materializeCaptchaImages, captchaScreenshotHint,
    evaluate, inspectEvalScript, readBrowserLoop, listCachedPageRefs, hostnameOf,
    siteGraphForUrl,
    syncPeekedUrl, patchAppBrowser, scrollBrowserView, getBrowserState: _gs,
    cardHasClickableBody, compactStudyPanel,
  } = ctx
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
    const watchUrl = await liveHref(browserId)
    const { isChaoxingPlayerUrl } = await import('../../platform/chaoxing/nav')
    if (isChaoxingPlayerUrl(watchUrl)) {
      const requestedRef = String(args.ref || '').trim()
      if (requestedRef) {
        const mediaRef = mediaRefOf(browserId, requestedRef, listCachedPageRefs)
        const locator = mediaRef ? await resolveRefLocator(browserId, mediaRef) : null
        if (!locator) return JSON.stringify({ ok: false, error: '视频 ref 已失效，请重新读取页面快照' })
        const tick = await callProtocol(browserId, 'media_tick', { locator })
        if (!tick.hasVideo || !tick.mid) return JSON.stringify({ ok: false, error: '指定视频任务点尚未就绪，请重新读取页面' })
        const { pinChaoxingPlayMid } = await import('../../chaoxing/study/video')
        pinChaoxingPlayMid(browserId, String(tick.mid))
      }
      const { readChaoxingVideoTick, videoIsPlaying } = await import('../../chaoxing/study')
      const { startChaoxingWatch, stopChaoxingWatch, videoWatchFor } = await import('../../chaoxing/browser/watch')
      const { packAgentPanel, watchSessionFastPath } = await import('../../platform/panelAccess')
      const existing = videoWatchFor(browserId)
      const panelNow = packAgentPanel(browserId)
      const fast = requestedRef ? '' : watchSessionFastPath(existing, panelNow?.event)
      if (fast === 'panel_clear') {
        return JSON.stringify({
          watching: false,
          panelEvent: panelNow?.event,
          panel: compactStudyPanel(panelNow),
          hint: panelNow?.hint || '本节视频已完成。',
        })
      }
      if (fast === 'ended') {
        return JSON.stringify({
          watching: false,
          ended: true,
          already: true,
          title: existing?.title || '',
          panel: compactStudyPanel(panelNow),
          hint: '这段视频已经结束。',
        })
      }
      if (fast === 'already') {
        return JSON.stringify({
          watching: true,
          already: true,
          title: existing?.title || '',
          panel: compactStudyPanel(panelNow),
          hint: watchFollowHint(browserId, true),
        })
      }
      const tick = await readChaoxingVideoTick(browserId).catch(() => null)
      if (!videoIsPlaying(tick)) {
        stopChaoxingWatch(browserId, { keep: true })
        return JSON.stringify({
          watching: false,
          playing: false,
          paused: true,
          title: existing?.title || '',
          video: tick,
          panel: compactStudyPanel(packAgentPanel(browserId)),
          hint: '视频没有在播。先点播放，确认在播后再 browser_watch。',
        })
      }
      startChaoxingWatch(browserId, sessionId, {
        ...tick,
        title: existing?.title || '',
      })
      return JSON.stringify({
        watching: true,
        title: existing?.title || '',
        video: tick,
        panel: compactStudyPanel(packAgentPanel(browserId)),
        hint: watchFollowHint(browserId, false),
      })
    }
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
          : '先打开播放页并点播放，再 browser_watch。不要抄学习通 study_watch。',
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
    const { videoWatchFor } = await import('../../chaoxing/browser/watch')
    const watchLive = (row: { sessionId?: string; status?: string } | null | undefined) => (
      Boolean(row?.sessionId && (row.status === 'watching' || row.status === 'paused' || row.status === 'stalled'))
    )
    const hosted = watchLive(nativeWatchFor(browserId)) || watchLive(videoWatchFor(browserId)) || Boolean(courseRunFor(sessionId))
    if (rejectHostedWait(until, seconds, hosted)) {
      return JSON.stringify({ ok: false, error: '已在监控，finish(watching) 交给宿主' })
    }
    const { runAgentWait } = await import('../agentWait')
    const { flushWatchIntoWait, notePanelEvent } = await import('../../chaoxing/browser/watchAgent')
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
      onStart: until === 'panel' ? () => flushWatchIntoWait(sessionId) : undefined,
      onPanel: (panel) => notePanelEvent(browserId, panel),
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
    return JSON.stringify({ ok: true, finished: true, status: judged.status, summary: judged.summary })
  }

  return null
}
