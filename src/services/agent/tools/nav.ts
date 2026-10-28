
import { cachedPageSnap, findInSnapshot, observedJson, pageSnapAge, PAGE_SNAP_FRESH_MS } from '../../browser/engine'

export const handleNavTools = async (ctx: Record<string, any>): Promise<string | null> => {
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
  } = ctx
  if (name === 'browser_get_state') {
    const state = await getBrowserState(browserId).catch(() => null)
    const item = listAppBrowsers().find((browser) => browser.id === browserId)
    const url = String(state?.url || item?.url || '')
    const graphUrl = await graphUrlOf(browserId, url)
    const { siteGraphAgentSnap } = await import('../../browser/siteGraph')
    const { coursePlanFor, coursePlanSummary } = await import('../../browser/coursePlan')
    const snap = siteGraphAgentSnap(graphUrl || url)
    const summary = coursePlanSummary(coursePlanFor(browserId))
    const nodeId = graphNodeId(graphUrl || url)
    return JSON.stringify({
      id: browserId,
      url,
      title: state?.title || item?.title || item?.name || '',
      frame: graphUrl && graphUrl !== url ? graphUrl : undefined,
      page: snap?.page || '',
      siteGraph: snap || undefined,
      coursePlan: summary || undefined,
      hint: [
        isShellNode(nodeId, graphUrl) ? SPACE_HINT : undefined,
        !snap
          ? '当前网址没有匹配的站点图谱。可用 get_page / screenshot 探路，或 read_agent_skill(site-learn) 记下这个站。'
          : undefined,
      ].filter(Boolean).join(' ') || undefined,
    })
  }
  if (name === 'browser_get_page') {
    try {
      const url = await currentUrl(browserId)
      const graphUrl = await graphUrlOf(browserId, url)
      const nodeId = graphNodeId(graphUrl)
      const probes = notePageProbe(browserId)
      const page = await readBrowserPage(browserId, { maxFrames: 8 })
      if (page == null || !Object.keys(page).length) {
        return JSON.stringify({
          error: '页面读取失败',
          hint: '再试一次 get_page。快照够用就用 ref。',
        })
      }
      if (page.error) {
        emptyPageSnaps.delete(browserId)
        return JSON.stringify({ ok: false, url: page.url || url, error: page.error })
      }
      if (!page.snapshot && !page.refs?.length) {
        const stateUrl = String((await getBrowserState(browserId).catch(() => null))?.url || peekAppBrowserUrl(browserId) || '')
        const here = page.url || stateUrl || url
        const misses = (emptyPageSnaps.get(browserId) || 0) + 1
        emptyPageSnaps.set(browserId, misses)
        if (misses >= 2) {
          await callProtocol(browserId, 'rebind').catch(() => null)
          const again = await readBrowserPage(browserId).catch(() => null)
          if (again?.snapshot || again?.refs?.length) {
            emptyPageSnaps.delete(browserId)
            return JSON.stringify({ ...again, url: again.url || here, hint: '快照是重连浏览器通道后读到的。' })
          }
          if (again?.error) {
            emptyPageSnaps.delete(browserId)
            return JSON.stringify({ ok: false, url: again.url || here, error: again.error })
          }
        }
        const sameLogin = graphNodeId(here) === 'login' || /\/login/i.test(here)
        const frameSrc = (page.iframes || []).map((item) => item.src).filter(Boolean).slice(0, 4)
        return JSON.stringify({
          url: here,
          empty: true,
          jumping: false,
          iframes: page.iframes,
          frames: page.frames,
          hint: sameLogin
            ? '快照暂时为空，当前网址属于登录页。等待页面就绪后重新读取快照，再按实际控件和用户目标操作。'
            : frameSrc.length
              ? `顶层快照空，内容多半在 iframe：${frameSrc.join('、')}。看 frames / preferredFrame，或 screenshot / eval（不要 contentDocument）。`
            : misses >= 2
              ? '连续两次快照为空，已尝试重连浏览器通道。先截图或只读检查加载状态，确认实际控件后再操作；仍无法读取则说明具体错误，不要按猜测文字点击。'
                : '快照暂时空。先看 url：没变就还在本页，不要当成跳转，不要 reset 图谱。',
        })
      }
      emptyPageSnaps.delete(browserId)
      const wantHw = graphNodeId(graphUrl) === 'course' && browserTaskIntent(sessionId) === 'homework'
      const preferred = page.preferredFrame
      const frameHint = preferred?.url
        ? `优先看 preferredFrame（${preferred.url}）里的内容；顶层壳常只有导航。`
        : undefined
      return JSON.stringify({
        ...page,
        page: siteGraphNodeForUrl(graphUrl)?.title || '',
        frame: graphUrl !== url ? graphUrl : preferred?.url || undefined,
        hint: [
          isShellNode(nodeId, graphUrl) ? SPACE_HINT : undefined,
          wantHw ? COURSE_HW_HINT : undefined,
          frameHint,
          probes >= 2 ? '快照已经有了。' : undefined,
          page.framesCapped ? '子 frame 已到上限。要某句文案用 browser_find。' : undefined,
        ].filter(Boolean).join(' ') || undefined,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return JSON.stringify({
        error: message || '页面读取失败',
        hint: '页面读取失败。再试一次 get_page。',
      })
    }
  }
  if (name === 'browser_navigate') {
    const url = String(args.url || '').trim()
    if (!url) return JSON.stringify({ error: '缺少网址' })
    const nowCourse = await currentUrl(browserId)
    if (sameChaoxingCourse(url, nowCourse)) {
      return JSON.stringify({
        ok: false,
        error: '已经在这门课。切「章节 / 任务 / 作业」用 click_text，不要重新打开课页。',
        url: nowCourse,
      })
    }
    const iframePage = isChaoxingIframeNavUrl(url)
    const blockedNav = iframePage || isSpaceListTopUrl(url)
    if (blockedNav && policy.permissionMode === 'strict') {
      return JSON.stringify({
        ok: false,
        error: isSpaceListTopUrl(url)
          ? '严格模式下课表用 click_text 点页签打开。'
          : IFRAME_NAV_HINT,
      })
    }
    const navWarning = blockedNav
      ? (isSpaceListTopUrl(url)
        ? '这是课表/iframe 地址，通常应留在外壳里点页签，而不是顶层打开。'
        : IFRAME_NAV_HINT)
      : undefined
    const target = resolveChaoxingLoginUrl(url)
    const from = await liveHref(browserId).catch(() => currentUrl(browserId))
    await navigateBrowserView(browserId, target)
    let landed = ''
    for (let i = 0; i < 20; i++) {
      await wait(400)
      // CDP 失联时 eval 会空；CEF 帧事件仍会写 state / peek，不能只信 evaluate
      const href = await evalBrowserView(
        browserId,
        `(function(){ try { return String(location.href || ''); } catch (e) { return ''; } })()`,
      ).catch(() => '')
      const fromEval = String(href || '').trim()
      const fromState = String(
        (await getBrowserState(browserId).catch(() => null))?.url
        || peekAppBrowserUrl(browserId)
        || '',
      ).trim()
      const live = fromEval || fromState
      if (!live) continue
      landed = live
      if (pageHostMatches(live, target)) break
    }
    if (!pageHostMatches(landed, target)) {
      const here = landed || from || await currentUrl(browserId)
      if (/browser-home|localhost:1420/i.test(here) && !/browser-home|localhost:1420/i.test(target)) {
        return observedJson(browserId, {
          ok: false,
          error: '仍在应用首页，目标页尚未打开。先核对导航结果、加载状态和网址，再决定是否重试。',
          url: here,
          want: target,
        })
      }
      return observedJson(browserId, {
        ok: false,
        error: `没有打开 ${target}。当前仍是 ${here || '原页面'}。`,
        url: here,
        want: target,
      })
    }
    const note = pageHostOf(landed) !== pageHostOf(target)
      ? `已到同站 ${pageHostOf(landed)}，路径发生变化。请根据当前网址和页面内容核对导航结果。`
      : undefined
    return observedJson(browserId, {
      ok: true,
      url: landed,
      ...(note ? { note } : {}),
      ...(navWarning ? { warning: navWarning } : {}),
    })
  }
  if (name === 'browser_reload') {
    await reloadBrowserView(browserId)
    await wait(500)
    return observedJson(browserId, { ok: true })
  }
  if (name === 'browser_go_back') {
    await goBackBrowserView(browserId)
    await wait(400)
    return observedJson(browserId, { ok: true })
  }
  if (name === 'browser_go_forward') {
    await goForwardBrowserView(browserId)
    await wait(400)
    return observedJson(browserId, { ok: true })
  }
  if (name === 'browser_find') {
    const query = String(args.query || args.text || '').trim()
    const regex = args.regex === true
    if (!query) return JSON.stringify({ ok: false, error: '缺少 query' })
    let snap = cachedPageSnap(browserId)
    if (!snap?.snapshot || pageSnapAge(browserId) > PAGE_SNAP_FRESH_MS) {
      const page = await readBrowserPage(browserId, { maxFrames: 8 }).catch(() => null)
      snap = cachedPageSnap(browserId) || (page ? {
        at: Date.now(),
        url: String(page.url || ''),
        title: String(page.title || ''),
        snapshot: String(page.snapshot || ''),
        refs: [],
      } : null)
    }
    if (!snap?.snapshot) {
      return JSON.stringify({ ok: false, error: '还没有快照。先 get_page。', url: snap?.url })
    }
    const found = findInSnapshot(snap.snapshot, query, regex)
    if (found.error) return JSON.stringify({ ok: false, error: found.error })
    let domHits: Array<{ text: string; role: string; frame: string }> = []
    if (!found.hits.length) {
      const script = `(function(){
        var q = ${JSON.stringify(query.toLowerCase())};
        var hits = [];
        function walk(doc, frame){
          if (!doc || hits.length >= 12) return;
          var nodes = [];
          try { nodes = doc.querySelectorAll('[role="treeitem"],[role="listitem"],[role="option"],a,button,[role="button"],[role="tab"],[role="menuitem"]'); } catch (e) { nodes = []; }
          for (var i = 0; i < nodes.length && hits.length < 12; i++) {
            var el = nodes[i];
            var name = '';
            try { name = String(el.innerText || el.getAttribute('aria-label') || '').replace(/\\s+/g, ' ').trim(); } catch (e2) { name = ''; }
            if (!name || name.toLowerCase().indexOf(q) < 0) continue;
            var role = '';
            try { role = String(el.getAttribute('role') || el.tagName || '').toLowerCase(); } catch (e3) { role = ''; }
            hits.push({ text: name.slice(0, 80), role: role, frame: frame });
          }
          var frames = [];
          try { frames = doc.querySelectorAll('iframe,frame'); } catch (e4) { frames = []; }
          for (var f = 0; f < frames.length && f < 8; f++) {
            try { walk(frames[f].contentDocument, frame ? frame + '/' + f : String(f)); } catch (e5) {}
          }
        }
        walk(document, '');
        return hits;
      })()`
      const raw = await evalBrowserView(browserId, script).catch(() => null)
      if (Array.isArray(raw)) domHits = raw.filter((item) => item && typeof item.text === 'string')
    }
    return JSON.stringify({
      ok: true,
      url: snap.url,
      query,
      hits: found.hits,
      domHits: domHits.length ? domHits : undefined,
      hint: found.hits.length
        ? undefined
        : domHits.length
          ? '快照里没有这句，页面上有。用 browser_click_text 点 text，同文案用 nth。'
          : undefined,
    })
  }
  return null
}
