
import { observedJson } from '../../browser/engine'
import { explainEvalError, videoSnapshotNote } from '../../browser/eval'
import { cachedPageSnap } from '../../browser/engine/pageSnap'

export const handleActTools = async (ctx: Record<string, any>): Promise<string | null> => {
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
    evalBrowserFrames, isCourseChromeTab, withBudget, typedResult,
  } = ctx
  if (name === 'browser_click') {
    const from = await currentUrl(browserId)
    const ref = String(args.ref || '').trim()
    const selector = String(args.selector || '').trim()
    const css = cssSelectorFromArgs(ref, selector)
    const nth = Number(args.nth) > 0 ? Number(args.nth) : undefined
    const frame = String(args.frame || '').trim() || undefined
    const missHint = () => formatMissRefsHint(browserId, 'click')
    const runClick = async (locator: { by: 'css' | 'text' | 'role' | 'label'; value: string; name?: string; exact?: boolean; nth?: number; frame?: string; backend?: number }) => {
      const pinned = Number(locator.backend)
      if (Number.isFinite(pinned) && pinned > 0) {
        const hit = asObject(await callProtocol(browserId, 'click_node', {
          backend: pinned,
          button: 'left',
          clickCount: 1,
        }).catch(() => ({ ok: false })))
        const acted = hit.ok
          ? { ok: true, text: String(locator.name || locator.value || '') }
          : { ok: false, error: String(hit.error || '点击失败'), text: String(locator.name || '') }
        return JSON.stringify(await observeAfterClick(browserId, acted, from, locator.frame))
      }
      if (locator.by === 'css' && /^#[\w.-]+$/.test(locator.value)) {
        const quick = asObject(await clickBrowserElement(browserId, locator.value))
        if (quick.ok) {
          return JSON.stringify(await observeAfterClick(browserId, { ok: true, text: String(quick.text || locator.value) }, from, locator.frame))
        }
      }
      const acted = await clickByLocator(browserId, { ...locator, nth: locator.nth ?? nth, frame: locator.frame ?? frame })
      if (acted.ok) return JSON.stringify(await observeAfterClick(browserId, acted, from, locator.frame ?? frame))
      if (locator.by === 'text' || locator.by === 'role') {
        const framed = await clickBrowserText(browserId, String(locator.name || locator.value || ''))
        if (framed && typeof framed === 'object' && (framed as { ok?: boolean }).ok) {
          return JSON.stringify(await observeAfterClick(browserId, { ok: true, text: String((framed as { text?: string }).text || locator.value) }, from, locator.frame ?? frame))
        }
      }
      const seen = await observeAfterClick(browserId, acted, from, locator.frame ?? frame)
      return JSON.stringify({ ...seen, hint: [seen.hint, missHint()].filter(Boolean).join(' ') })
    }
    if (ref && !looksLikeCssSelector(ref)) {
      const locator = await resolveRefLocator(browserId, ref)
      if (locator) return runClick(locator)
      if (css) return runClick({ by: 'css', value: css })
      return observedJson(browserId, {
        ok: false,
        error: `没有找到快照 ref ${ref}。用本次返回里的 ref。CSS 请用 selector=#loginBtn，不要放进 ref。`,
        hint: missHint(),
      })
    }
    if (!css) {
      return JSON.stringify({
        ok: false,
        error: '缺少 ref 或 selector。快照用 ref=e3，CSS 用 selector=#loginBtn。',
        hint: missHint(),
      })
    }
    return runClick({ by: 'css', value: css, nth, frame })
  }
  if (name === 'browser_click_text') {
    const text = String(args.text || '').trim()
    const nth = Number(args.nth) > 0 ? Number(args.nth) : undefined
    const frame = String(args.frame || '').trim() || undefined
    if (!text) return JSON.stringify({ error: '缺少 text' })
    const nowUrl = await currentUrl(browserId)
    const shellId = graphNodeId(await graphUrlOf(browserId, nowUrl))
    if (isShellNode(shellId, nowUrl) && /搜索|查找/.test(text)) {
      if (policy.permissionMode === 'strict') return JSON.stringify({ ok: false, error: SPACE_HINT })
    }
    if (text === '任务' && /stucoursemiddle|\/mycourse\/stu/i.test(nowUrl) && browserTaskIntent(sessionId) === 'homework') {
      if (policy.permissionMode === 'strict') return JSON.stringify({ ok: false, error: COURSE_HW_HINT })
    }
    const from = nowUrl
    let clicked = await withBudget(
      (nth || frame
        ? clickByLocator(browserId, { by: 'text', value: text, nth, frame })
        : clickBrowserText(browserId, text)
      ).catch((error) => (
        { ok: false, error: error instanceof Error ? error.message : String(error) }
      )),
      10000,
      { ok: false, error: `点击「${text}」超时` },
    ) as { ok?: boolean; error?: string; text?: string }
    if (clicked?.ok) {
      if (isCourseChromeTab(text)) return JSON.stringify(clicked)
      const seen = await observeAfterClick(browserId, { ok: true, text: clicked.text || text }, from, frame)
      if (/^(我学的课|已学的课|我教的课)$/.test(text)) {
        const extra = clicked as { tab?: string; frame?: string; already?: boolean }
        return JSON.stringify({
          ...seen,
          spaceTab: extra.tab,
          frame: extra.frame,
          already: extra.already,
          hint: extra.tab === '我学的课'
            ? '已在「我学的课」。直接 click_text 课名，不要再点页签，不要 eval。'
            : undefined,
        })
      }
      return JSON.stringify(seen)
    }
    if (!clicked?.error) {
      return observedJson(browserId, { ok: false, error: `没有找到「${text}」`, hint: formatMissRefsHint(browserId, 'click') })
    }
    return observedJson(browserId, {
      ...(clicked && typeof clicked === 'object' ? clicked as Record<string, unknown> : { ok: false, error: String(clicked) }),
      hint: formatMissRefsHint(browserId, 'click'),
    }, frame)
  }
  if (name === 'browser_type') {
    const ref = String(args.ref || '').trim()
    const selector = String(args.selector || '').trim()
    const text = String(args.text ?? '')
    const nowUrl = await currentUrl(browserId)
    const onSpaceShell = isShellNode(graphNodeId(await graphUrlOf(browserId, nowUrl)), nowUrl)
    if (onSpaceShell && policy.permissionMode === 'strict') {
      return JSON.stringify({ ok: false, error: SPACE_HINT })
    }
    const css = cssSelectorFromArgs(ref, selector)
    const readFilled = async (locator: { by: string; value: string }) => {
      if (locator.by !== 'css') return null
      return asObject(await evalBrowserView(browserId, `(function(){
        var el = document.querySelector(${JSON.stringify(locator.value)});
        if (!el) return { filled: false, length: 0, password: false, found: false };
        var got = el.isContentEditable ? String(el.textContent || '') : String(el.value || '');
        var pwd = false;
        try { pwd = String(el.type || '').toLowerCase() === 'password'; } catch (e) {}
        return { filled: got.length > 0, length: got.length, password: pwd, value: pwd ? '' : got.slice(0, 500), found: true, ok: true };
      })()`).catch(() => ({ filled: false, length: 0 })))
    }
    const nth = Number(args.nth) > 0 ? Number(args.nth) : undefined
    const frame = String(args.frame || '').trim() || undefined
    const missHint = () => formatMissRefsHint(browserId, 'fill')
    const runFill = async (locator: { by: 'css' | 'text' | 'role' | 'label'; value: string; name?: string; exact?: boolean; nth?: number; frame?: string }) => {
      rememberLoginTyped(nowUrl, `${locator.value} ${locator.name || ''}`, text)
      if (locator.by === 'css' && /^#[\w.-]+$/.test(locator.value)) {
        const quick = asObject(await typeBrowserElement(browserId, locator.value, text))
        await wait(80)
        const check = await readFilled(locator)
        if (check?.filled || check?.length) {
          return observedJson(browserId, JSON.parse(typedResult(quick, text, {
            filled: Boolean(check.filled),
            length: Number(check.length) || 0,
            password: Boolean(check.password),
            value: String(check.value || ''),
          })), locator.frame)
        }
      }
      const written = await fillByLocator(browserId, { ...locator, nth: locator.nth ?? nth, frame: locator.frame ?? frame }, text)
      await wait(80)
      const again = locator.by === 'css' ? await readFilled(locator) : null
      const filled = again ? Boolean(again.filled) : written.filled === true
      return observedJson(browserId, JSON.parse(typedResult(written, text, {
        filled,
        length: Number(again?.length ?? written.length ?? 0) || 0,
        password: Boolean(again?.password) || (!written.text && (written.length || 0) > 0),
        value: again ? String(again.value || '') : '',
      }, missHint())), locator.frame ?? frame)
    }
    if (ref && !looksLikeCssSelector(ref)) {
      const locator = await resolveRefLocator(browserId, ref)
      if (locator) {
        const role = String(locator.role || '').toLowerCase()
        if (role && !/^(textbox|searchbox|combobox|spinbutton)$/.test(role)) {
          return observedJson(browserId, {
            ok: false,
            error: `${ref} 是${role}「${locator.name || locator.value}」，不是输入框。登录请填账号/密码框的 ref，或 selector=#username。`,
            hint: missHint(),
          })
        }
        return runFill(locator)
      }
      if (css) return runFill({ by: 'css', value: css })
      return observedJson(browserId, {
        ok: false,
        error: `没有找到快照 ref ${ref}。用本次返回里的 ref。CSS 请用 selector=#phone，不要放进 ref。`,
        hint: missHint(),
      })
    }
    if (!css) {
      return JSON.stringify({
        ok: false,
        error: '缺少 ref 或 selector。快照用 ref=e3，CSS 用 selector=#phone。',
        hint: missHint(),
      })
    }
    return runFill({ by: 'css', value: css, nth, frame })
  }
  if (name === 'browser_scroll') {
    const amount = Number(args.amount)
    return JSON.stringify(await scrollBrowserView(browserId, Number.isFinite(amount) ? amount : 600))
  }
  if (name === 'browser_eval') {
    const script = String(args.script || '').trim()
    if (!script) return JSON.stringify({ error: '缺少 script' })
    if (script.length > 20_000) {
      return JSON.stringify({ error: '脚本过长（上限 20000 字）', hint: '只读必要 DOM，不要整页 innerHTML。' })
    }
    const blocked = inspectEvalScript(script, role === 'explore' ? 'read' : loop.evalPolicy)
    if (blocked) {
      return JSON.stringify({
        ok: false,
        error: blocked,
        hint: loop.recipe,
      })
    }
    if (/\.src\s*=/.test(script) && isSpaceListTopUrl(script)) {
      return JSON.stringify({
        ok: false,
        error: '切课表用 click_text「我学的课」点页签，不要改 iframe src。',
      })
    }
    const frame = String(args.frame || '').trim()
    const all = args.all === true
    try {
      if (all) {
        const report = await evalBrowserFrames(browserId, script)
        const { logAgentDebug } = await import('../debugLog')
        logAgentDebug(sessionId, {
          kind: 'browser',
          type: 'eval_frames',
          frames: (report.frames || []).map((item) => ({
            url: item.url,
            error: item.error,
            hasResult: item.result != null,
          })),
          hint: report.hint,
        })
        const note = videoSnapshotNote(browserId, script, cachedPageSnap(browserId)?.snapshot || '')
        return JSON.stringify({
          ok: !report.error || report.frames.some((item) => item.error == null),
          ...report,
          hint: [report.hint, note].filter(Boolean).join(' ') || undefined,
        })
      }
      const result = await evaluate(browserId, script, frame ? { frame } : undefined)
      const note = videoSnapshotNote(browserId, script, cachedPageSnap(browserId)?.snapshot || '')
      return JSON.stringify({
        ok: result == null ? false : (typeof result === 'object' && result !== null && 'ok' in result ? Boolean((result as { ok?: unknown }).ok !== false) : true),
        result,
        frame: frame || 'top',
        hint: note || undefined,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const note = videoSnapshotNote(browserId, script, cachedPageSnap(browserId)?.snapshot || '')
      return JSON.stringify({
        error: explainEvalError(message, script) || '脚本执行失败',
        hint: ['默认只跑顶层。指定 iframe 用 frame；扫各帧用 all=true。不要 iframe.contentDocument。', note].filter(Boolean).join(' '),
      })
    }
  }

  return null
}
