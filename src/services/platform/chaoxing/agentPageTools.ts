import { mediaRefOf, watchFollowHint } from '../../browser/watchToolHelpers'
import type { SiteToolContext } from '../../browser/siteCapabilities'
export async function handleSitePageTools(ctx: SiteToolContext): Promise<string | null> {
  const { name, args, browserId, sessionId, liveHref, listCachedPageRefs, resolveRefLocator, callProtocol, compactStudyPanel, screenshotBrowserView } = ctx
  if (name === 'browser_decode_chaoxing_font') {
    try {
      const { CHAOXING_FONT_PROBE, decodeChaoxingProbe } = await import('../../agent/fontDecrypt/chaoxing')
      const report = await ctx.evalBrowserFrames(browserId, CHAOXING_FONT_PROBE)
      if (report.error || report.frames.some((frame: any) => frame.error)) throw new Error('无法读取全部页面框')
      const frames = report.frames.filter((frame: any) => frame.result)
      if (!frames.length) throw new Error('没有找到可解码的学习通混淆字体')
      const decoded = []
      for (const frame of frames) decoded.push({ url: frame.url, entries: await decodeChaoxingProbe(frame.result) })
      return JSON.stringify({ ok: true, frames: decoded, hint: '文本按页面中的加密区域顺序排列；请结合当前快照确认题目、选项和对应控件。' })
    } catch (error) {
      const reason = error instanceof Error ? error.message : '字体解码失败'
      try {
        const shot = await screenshotBrowserView(browserId)
        return JSON.stringify({ ok: false, reason, image: shot.image,
          hint: '字体解码不可靠，请依据截图读取当前可见的题干与选项；看不清时滚动后重新截图。不能看图时请说明需要视觉模型，不要猜测。' })
      } catch {
        return JSON.stringify({ ok: false, reason, hint: '字体解码失败且截图不可用；不要猜测题目，请检查页面和视觉模型。' })
      }
    }
  }
  if (name === 'browser_watch') {
    const watchUrl = await liveHref(browserId)
    const { isChaoxingPlayerUrl } = await import('./nav')
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
      const { packAgentPanel, watchSessionFastPath } = await import('../panelAccess')
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
      if (fast === 'already' && existing?.status !== 'stalled') {
        return JSON.stringify({
          watching: true,
          already: true,
          title: existing?.title || '',
          videoMid: existing?.mid || '',
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
      const { watchExistingChapterVideo } = await import('./chapterPlayback')
      if (!await watchExistingChapterVideo(browserId, sessionId, tick)) {
        startChaoxingWatch(browserId, sessionId, { ...tick, title: existing?.title || '' })
      }
      return JSON.stringify({
        watching: true,
        title: existing?.title || '',
        video: tick,
        panel: compactStudyPanel(packAgentPanel(browserId)),
        hint: watchFollowHint(browserId, false),
      })
    }
  }
  return null
}
