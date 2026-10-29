import type { BrowserLocator } from '../../browser/engine/types'
import { handleCheckTool } from './check'

import { observedJson } from '../../browser/engine'
import { explainEvalError, videoSnapshotNote } from '../../browser/eval'
import { cachedPageSnap, invalidatePageSnap } from '../../browser/engine/pageSnap'
import { browserTabLimitSequence, withPopupTabLimit } from '../../browser/tabLimits'
import { rememberPageRefs } from '../../browser/engine/refs'

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
  if (name === 'browser_press') {
    const key = String(args.key || '')
    if (!['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(key)) {
      return JSON.stringify({ ok: false, error: '不支持的按键' })
    }
    const from = await currentUrl(browserId)
    const tabLimitBefore = browserTabLimitSequence()
    const result = await callProtocol(browserId, 'press', { key })
    return JSON.stringify(await observeAfterClick(browserId, asObject(result), from, undefined, tabLimitBefore))
  }
  if (name === 'browser_set_checked') {
    const from = await currentUrl(browserId)
    return JSON.stringify(await handleCheckTool(browserId, args, async () => {
      await wait(0)
      if (await currentUrl(browserId) !== from) throw new Error('页面已跳转，停止本批操作，请重新读取页面')
    }))
  }
  const textOnlyClick = name === 'browser_click' && !String(args.ref || '').trim() && !String(args.selector || '').trim() && Boolean(String(args.text || '').trim())
  if (name === 'browser_click' && !textOnlyClick) {
    const from = await currentUrl(browserId)
    const ref = String(args.ref || '').trim()
    const selector = String(args.selector || '').trim()
    const css = cssSelectorFromArgs(ref, selector)
    const nth = Number(args.nth) > 0 ? Number(args.nth) : undefined
    const frame = String(args.frame || '').trim() || undefined
    const missHint = () => formatMissRefsHint(browserId, 'click')
    const runClick = async (locator: BrowserLocator) => {
      const tabLimitBefore = browserTabLimitSequence()
      const target = { ...locator, nth: locator.nth ?? nth, frame: locator.frame ?? frame }
      const acted = await clickByLocator(browserId, target)
      if (acted.requiresRefresh) { invalidatePageSnap(browserId); rememberPageRefs(browserId, []) }
      const seen = await observeAfterClick(browserId, acted, from, acted.requiresRefresh ? undefined : target.frameId || acted.frameId || target.frame || target.framePath, tabLimitBefore)
      return JSON.stringify(acted.ok ? seen : { ...seen, hint: [seen.hint, missHint()].filter(Boolean).join(' ') })
    }
    if (ref && !looksLikeCssSelector(ref)) {
      const locator = await resolveRefLocator(browserId, ref)
      if (locator) return runClick(locator)
      if (css) return runClick({ by: 'css', value: css })
      return observedJson(browserId, {
        ok: false,
        error: `当前快照没有 ref ${ref}。请使用最新成功快照中的 ref；CSS 选择器应放在 selector 参数中。`,
        hint: missHint(),
      })
    }
    if (!css) {
      return JSON.stringify({
        ok: false,
        error: '缺少点击目标。请传入当前快照中的 ref、已核实的 CSS selector，或页面可见文字 text。',
        hint: missHint(),
      })
    }
    return runClick({ by: 'css', value: css, nth, frame })
  }
  if (name === 'browser_click_text' || textOnlyClick) {
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
    const tabLimitBefore = browserTabLimitSequence()
    // DOM 补充控件不一定在 AX 树里。唯一的精确快照命中优先使用原来的节点/frame 身份。
    const compact = (value: string) => String(value || '').replace(/\s+/g, '')
    const refs = typeof listCachedPageRefs === 'function' ? listCachedPageRefs(browserId) : []
    const matches = refs.filter((item: any) => !item.disabled && compact(item.name) === compact(text)
      && (!frame || [item.locator?.frame, item.locator?.frameId, item.locator?.framePath].includes(frame)))
    if (matches.length === 1 && !nth) {
      const locator = matches[0].locator
      const acted = await clickByLocator(browserId, locator)
      if (acted.requiresRefresh) { invalidatePageSnap(browserId); rememberPageRefs(browserId, []) }
      return JSON.stringify(await observeAfterClick(browserId, acted, from,
        acted.requiresRefresh ? undefined : locator.frameId || locator.frame || locator.framePath, tabLimitBefore))
    }
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
      if (isCourseChromeTab(text) && siteGraphForUrl?.(nowUrl)?.id === 'chaoxing') {
        return JSON.stringify(withPopupTabLimit(browserId, { ...clicked, ok: true }, tabLimitBefore))
      }
      const seen = await observeAfterClick(browserId, { ok: true, text: clicked.text || text }, from, frame, tabLimitBefore)
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
    const secret = String(args.secret_ref || '')
    if (secret && args.text !== undefined) return JSON.stringify({ ok: false, error: 'text 与 secret_ref 不能同时填写' })
    const text = String(args.text ?? '')
    if (!secret && /\{\{secret:/.test(text)) return JSON.stringify({ ok: false, error: '敏感变量必须放在 secret_ref，不能当作普通文字填写。' })
    const nowUrl = await currentUrl(browserId)
    const onSpaceShell = isShellNode(graphNodeId(await graphUrlOf(browserId, nowUrl)), nowUrl)
    if (onSpaceShell && policy.permissionMode === 'strict') {
      return JSON.stringify({ ok: false, error: SPACE_HINT })
    }
    const css = cssSelectorFromArgs(ref, selector)
    const nth = Number(args.nth) > 0 ? Number(args.nth) : undefined
    const frame = String(args.frame || '').trim() || undefined
    const missHint = () => formatMissRefsHint(browserId, 'fill')
    const runFill = async (locator: BrowserLocator) => {
      const target = { ...locator, nth: locator.nth ?? nth, frame: locator.frame ?? frame }
      if (secret) return JSON.stringify(await callProtocol(browserId, 'fill_secret', { locator: target, secret_ref: secret }))
      const written = await fillByLocator(browserId, target, text)
      if (written.ok) rememberLoginTyped(nowUrl, `${locator.value} ${locator.name || ''}`, text)
      return observedJson(browserId, JSON.parse(typedResult(written, text, undefined, missHint())),
        target.frameId || written.frameId || target.frame || target.framePath)
    }
    if (ref && !looksLikeCssSelector(ref)) {
      const locator = await resolveRefLocator(browserId, ref)
      if (locator) {
        const role = String(locator.role || '').toLowerCase()
        if (role && !/^(textbox|searchbox|combobox|spinbutton)$/.test(role)) {
          return observedJson(browserId, {
            ok: false,
            error: `${ref} 是${role}「${locator.name || locator.value}」，不是输入框。请使用当前页面输入框的 ref，或已核实的 CSS selector。`,
            hint: missHint(),
          })
        }
        return runFill(locator)
      }
      if (css) return runFill({ by: 'css', value: css })
      return observedJson(browserId, {
        ok: false,
        error: `当前快照没有 ref ${ref}。请使用最新成功快照中输入框的 ref；CSS 选择器应放在 selector 参数中。`,
        hint: missHint(),
      })
    }
    if (!css) {
      return JSON.stringify({
        ok: false,
        error: '缺少填写目标。请传入当前快照中输入框的 ref，或已核实的 CSS selector。',
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
    const frameId = String(args.frameId || '').trim()
    const loaderId = String(args.loaderId || '').trim()
    const all = args.all === true
    if (all && (frame || frameId || loaderId)) return JSON.stringify({ ok: false, error: 'all 不能与指定 frame 同时使用' })
    if (loaderId && !frameId) return JSON.stringify({ ok: false, error: 'loaderId 必须与 frameId 一起使用' })
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
      const target = frameId ? { frameId, ...(loaderId ? { loaderId } : {}) } : frame ? { frame } : undefined
      const result = await evaluate(browserId, script, target)
      const note = videoSnapshotNote(browserId, script, cachedPageSnap(browserId)?.snapshot || '')
      return JSON.stringify({
        ok: result == null ? false : (typeof result === 'object' && result !== null && 'ok' in result ? Boolean((result as { ok?: unknown }).ok !== false) : true),
        result,
        frame: frameId || frame || 'top',
        hint: note || undefined,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (/frame.*(?:不存在|不唯一|移除|更换|就绪)|目标 frame/i.test(message)) {
        const refreshed = JSON.parse(await observedJson(browserId, { ok: false, error: message, requiresRefresh: true,
          hint: '使用本次快照中的精确 frameId 和 loaderId 重新定位；不要原样重试旧 frame，不要退回顶层或全帧执行。快照缺少目标时先 browser_get_page。' }))
        const frames = new Map<string, { frameId: string; loaderId?: string; frame?: string }>()
        if (!refreshed.snapshotStale) for (const ref of listCachedPageRefs?.(browserId) || []) {
          const locator = ref.locator
          if (locator?.frameId && !frames.has(locator.frameId) && frames.size < 16) {
            frames.set(locator.frameId, { frameId: locator.frameId, loaderId: locator.loaderId, frame: locator.frame || locator.framePath })
          }
        }
        return JSON.stringify({ ...refreshed, frames: [...frames.values()] })
      }
      const note = videoSnapshotNote(browserId, script, cachedPageSnap(browserId)?.snapshot || '')
      return JSON.stringify({
        error: explainEvalError(message, script) || '脚本执行失败',
        hint: ['默认只跑顶层。指定 iframe 用 frame；扫各帧用 all=true。不要 iframe.contentDocument。', note].filter(Boolean).join(' '),
      })
    }
  }

  return null
}
