/** Agent 浏览器工具。页面身份看网站地图，进度监控用 browser_watch。 */
import {
  clickBrowserElement,
  clickBrowserText,
  evalBrowserView,
  getBrowserState,
  goBackBrowserView,
  goForwardBrowserView,
  hostnameOf,
  listAppBrowsers,
  navigateBrowserView,
  patchAppBrowser,
  peekAppBrowserUrl,
  readBrowserFrameSrcs,
  readBrowserPage,
  reloadBrowserView,
  screenshotBrowserView,
  scrollBrowserView,
  typeBrowserElement,
} from '../browser/appBrowser'
import { captchaScreenshotHint, collectPageCaptchaHits, materializeCaptchaImages } from '../browser/captchaImages'
import { asObject, evalBrowserFrames, evalBrowserViewMain, isEvalActBusy, waitMs } from '../browser/eval'
import { notePageProbe, resetPageProbe } from './pageProbe'

const wait = waitMs
import { clickByLocator, cssSelectorFromArgs, fillByLocator, listCachedPageRefs, looksLikeCssSelector, observeAfterClick, pageHostMatches, pageHostOf, readPageSnapshot, resolveRefLocator } from '../browser/engine'
import { callProtocol, evaluate } from '../browser/protocol'
import { rememberLoginTyped } from './siteAccounts'
import { browserTaskIntent } from './browserTask'
import { compactStudyPanel, displaySiteName, formatSlimRefs, readBrowserLoop } from './browserLoop'
import { inspectEvalScript } from './browserEvalGuard'
import { resolveChaoxingLoginUrl } from '../browser/skills/chaoxingLogin'
import { isCourseChromeTab, readCourseTab, sameChaoxingCourse } from '../platform/chaoxing/courseTab'
import { isSpaceListTopUrl } from '../platform/chaoxing/spaceTab'
import { siteGraphForUrl, siteGraphNodeForUrl, siteGraphUrlFromFrames } from '../browser/siteGraphCore'
import {
  COURSE_HW_HINT,
  IFRAME_NAV_HINT,
  SPACE_HINT,
  chaoxingCoursePageHeader,
  chaoxingNodeId,
  isChaoxingCourseUrl,
  isChaoxingHomeworkListUrl,
  isChaoxingHost,
  isChaoxingIframeNavUrl,
  isChaoxingPlayableUrl,
  isChaoxingPlayerUrl,
  isChaoxingSpaceShell,
  isChaoxingStudentCourseList,
  readChaoxingSpaceContext,
  waitForChaoxingPlayer,
} from '../platform/chaoxing/nav'
import { getAgentPolicy } from './agentPolicy'
import { handleActTools } from './tools/act'
import { handleNavTools } from './tools/nav'
import { handlePageTools } from './tools/page'
import { handleCourseTools } from './tools/course'
import { handleTabTools } from './tools/tabs'
import { missingHostNeeds } from './hostCapabilities'
import { missingNeedsNote, nextStep } from './nextStep'

const TYPE_DONE_HINT = '已写入输入框，没有按回车。'
const emptyPageSnaps = new Map<string, number>()

const graphNodeId = (url: string) => chaoxingNodeId(url) || siteGraphNodeForUrl(url)?.id || ''
const isShellNode = (id: string, url = '') => isChaoxingSpaceShell(id, url)

const withBudget = async <T,>(task: Promise<T>, ms: number, fallback: T) => {
  let timer = 0
  try {
    return await Promise.race([
      task,
      new Promise<T>((resolve) => {
        timer = window.setTimeout(() => resolve(fallback), ms)
      }),
    ])
  } finally {
    if (timer) window.clearTimeout(timer)
  }
}

const graphUrlOf = async (browserId: string, topUrl: string) => {
  const frames = await withBudget(readBrowserFrameSrcs(browserId).catch(() => [] as string[]), 800, [])
  return siteGraphUrlFromFrames(topUrl, frames)
}

const formatMissRefsHint = (browserId: string, _kind: 'fill' | 'click') => (
  formatSlimRefs(listCachedPageRefs(browserId), 12)
)

const typedResult = (
  raw: unknown,
  text: string,
  check?: { filled?: boolean; length?: number; password?: boolean; value?: string },
  missHint = '',
) => {
  const body = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}
  if (raw == null) return JSON.stringify({ ok: false, error: '填写没有回执，再填一次', filled: false })
  if (body.ok === false) {
    return JSON.stringify({
      ...body,
      filled: false,
      hint: missHint || (body.hint ? String(body.hint) : undefined),
    })
  }
  const password = Boolean(check?.password || body.password)
  const length = Number(check?.length ?? body.length ?? 0) || 0
  const got = check?.value != null ? String(check.value) : ''
  const lengthMismatch = text.length > 0 && length > 0 && length !== text.length
  const valueMismatch = !password && got.length > 0 && got !== text
  if (lengthMismatch || valueMismatch) {
    return JSON.stringify({
      ok: false,
      reason: 'mismatch',
      filled: false,
      length,
      error: `框里的内容和要填的不一致（框内长度 ${length}，要填 ${text.length}）`,
    })
  }
  const filled = check ? Boolean(check.filled) : body.filled === true
  if (!filled) {
    return JSON.stringify({
      ok: false,
      error: '输入框还是空的，页面没吃到这次填写',
      filled: false,
      length,
      hint: missHint || undefined,
    })
  }
  return JSON.stringify({
    ok: true,
    ...body,
    text: password ? undefined : (got || body.text || text),
    filled: true,
    length,
    submitted: false,
    hint: TYPE_DONE_HINT,
  })
}

const currentUrl = async (browserId: string) => {
  const state = await getBrowserState(browserId).catch(() => null)
  return String(state?.url || listAppBrowsers().find((b) => b.id === browserId)?.url || '')
}

/** 以页内 location 为准；get_state 的 remembered_url 在 pageHeader 切换时会滞后。 */
/** 单页站（在浙学 /plan → /plan/detail）用 pushState 换页，本地记的地址不会变；这里顺手写回，活上下文才不会还说在目录。 */
const syncPeekedUrl = (browserId: string, url: string) => {
  const live = String(url || '').trim()
  if (!/^https?:/i.test(live)) return
  if (peekAppBrowserUrl(browserId) === live) return
  try {
    patchAppBrowser(browserId, { url: live })
  } catch {
    // 本地列表写不进去不影响本次动作
  }
}

const liveHref = async (browserId: string) => {
  const href = await evalBrowserViewMain(browserId, `(function(){ try { return String(location.href || ''); } catch (e) { return ''; } })()`).catch(() => '')
  const live = String(href || '').trim()
  if (live) {
    syncPeekedUrl(browserId, live)
    return live
  }
  return currentUrl(browserId)
}

export const executeBrowserTool = async (input: {
  name: string
  args: Record<string, unknown>
  browserId: string
  sessionId: string
  wait: (ms: number) => Promise<void>
  role?: 'parent' | 'explore' | 'execute'
  jobId?: string
}): Promise<string> => {
  const { name, args, browserId, sessionId, wait, role } = input
  const { packAgentPanel } = await import('../platform/panelAccess')
  const loop = readBrowserLoop({
    url: await liveHref(browserId),
    sessionId,
    panel: packAgentPanel(browserId),
  })

  const policy = getAgentPolicy()
  const failWithCard = (body: Record<string, unknown>, _href = loop.url) => (
    JSON.stringify({ ok: false, ...body })
  )
  const homeworkDoUrl = async () => {
    const { isHomeworkDoUrl } = await import('../browser/abstractions')
    const nowUrl = await currentUrl(browserId)
    return isHomeworkDoUrl(nowUrl) ? nowUrl : ''
  }
  // 作答页：看页始终允许；操作通过快照 ref；strict 禁止直接修改作业。
  if (['browser_click', 'browser_click_text', 'browser_type', 'browser_press', 'browser_set_checked'].includes(name) && policy.permissionMode === 'strict') {
    if (await homeworkDoUrl()) {
      return JSON.stringify({
        error: '当前为严格模式，作业页不要直接点或填写。',
        hint: '当前为严格模式。作答页先看快照，用题号和选项字母说明你要点哪一项。',
      })
    }
  }

  const toolCtx = {
    name, args, browserId, sessionId, wait, role, loop, policy, failWithCard, platformTool: null,
    currentUrl, graphUrlOf, liveHref, resetPageProbe,
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
    syncPeekedUrl, patchAppBrowser, scrollBrowserView, typedResult,
    evalBrowserFrames, isCourseChromeTab,
    withBudget, isChaoxingStudentCourseList, readCourseTab,
    compactStudyPanel,
  }
  return dispatchBrowserTool(toolCtx)
}

/** 四个处理器都没认领，才是未知工具。测试用这份，不打真实页面。 */
export const dispatchBrowserTool = async (ctx: Record<string, any>): Promise<string> => {
  const tabs = await handleTabTools(ctx)
  if (tabs != null) return tabs
  const coursed = await handleCourseTools(ctx)
  if (coursed != null) return coursed
  const navved = await handleNavTools(ctx)
  if (navved != null) return navved
  const acted = await handleActTools(ctx)
  if (acted != null) return acted
  const paged = await handlePageTools(ctx)
  if (paged != null) return paged
  return JSON.stringify({ error: `未知浏览器工具：${ctx.name}` })
}
