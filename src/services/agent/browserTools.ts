import {
  clickBrowserElement,
  clickBrowserText,
  evalBrowserView,
  getBrowserState,
  goBackBrowserView,
  goForwardBrowserView,
  listAppBrowsers,
  navigateBrowserView,
  readBrowserFrameSrcs,
  readBrowserPage,
  reloadBrowserView,
  screenshotBrowserView,
  scrollBrowserView,
  typeBrowserElement,
} from '../browser/appBrowser'
import { asObject, evalBrowserFrames, waitMs } from '../browser/eval'
import { liveTrustedCard, notePageProbe, resetPageProbe, trustedCardBlock } from '../parser/trust'

const wait = waitMs
import { chapterStateFor, ingestChapterSnap } from '../chaoxing/browser/chapters'
import {
  ensurePanelStudy,
  openPanelChapter,
  packAgentPanel,
  playPanelStudy,
} from '../chaoxing/browser/panelStudy'
import { ensureStudyWatch, liveStudyPlayback } from '../chaoxing/browser/playback'
import { parseChaoxingChapters } from '../chaoxing/study/chapters'
import { installChaoxingVideoHook, readChaoxingVideoTick, videoIsPlaying } from '../chaoxing/study/video'
import {
  ensurePlatformAdapters,
  normalizePlatformTool,
  resolvePlatformAdapter,
  type HomeworkAction,
  type PlatformAdapter,
} from '../platform'
import { clickByLocator, cssSelectorFromArgs, fillByLocator, looksLikeCssSelector, observeAfterClick, resolveRefLocator } from '../browser/engine'
import { rememberLoginTyped } from './siteAccounts'
import { browserTaskIntent } from './browserTask'
import { compactStudyPanel, readBrowserLoop } from './browserLoop'
import { inspectEvalScript } from './browserEvalGuard'
import { resolveChaoxingLoginUrl } from '../browser/skills/chaoxingLogin'
import { isSpaceListTopUrl } from '../browser/engine/spaceTab'
import { siteGraphNodeForUrl, siteGraphUrlFromFrames } from '../browser/siteGraphCore'
import { homeworkEnteringList } from './homeworkGate'
import { getAgentPolicy } from './agentPolicy'

ensurePlatformAdapters()

const SPACE_HINT = '当前节点是空间壳。课表在 #frame_content。get_state.spaceTab 是当前页签。'
const TYPE_DONE_HINT = '已写入输入框，没有按回车。'
const COURSE_HW_HINT = '当前在课程壳。侧栏「作业」是作业名单；「任务」不是作业。'

const graphNodeId = (url: string) => siteGraphNodeForUrl(url)?.id || ''
const isStudentCourseList = (url: string) => /visit\/courses|courselist/i.test(url) && !/visit\/interaction/i.test(url)
const isShellNode = (id: string, url = '') => id === 'space' && !isStudentCourseList(url)

const graphUrlOf = async (browserId: string, topUrl: string) => {
  const frames = await readBrowserFrameSrcs(browserId).catch(() => [])
  return siteGraphUrlFromFrames(topUrl, frames)
}

const typedResult = (raw: unknown, text: string, check?: { filled?: boolean; length?: number; password?: boolean }) => {
  const body = raw && typeof raw === 'object' ? { ...(raw as Record<string, unknown>) } : {}
  if (raw == null) return JSON.stringify({ ok: false, error: '填写没有回执，再填一次', filled: false })
  if (body.ok === false) return JSON.stringify({ ...body, filled: false })
  const filled = check ? Boolean(check.filled) : body.filled === true
  const length = Number(check?.length ?? body.length ?? 0) || 0
  if (!filled) {
    return JSON.stringify({
      ok: false,
      error: '输入框还是空的，页面没吃到这次填写',
      filled: false,
      length,
    })
  }
  return JSON.stringify({
    ok: true,
    ...body,
    text: check?.password ? undefined : (body.text || text),
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
const liveHref = async (browserId: string) => {
  const href = await evalBrowserView(browserId, `(function(){ try { return String(location.href || ''); } catch (e) { return ''; } })()`).catch(() => '')
  const live = String(href || '').trim()
  if (live) return live
  return currentUrl(browserId)
}

const coursePageHeader = (url: string) => {
  const hit = String(url || '').match(/[?&]pageHeader=(\d+)/i)
  return hit?.[1] || ''
}

/** 等顶层真正进到 studentstudy；课程壳 / 任务页上的预览视频不算播放页。 */
const waitForStudentStudy = async (browserId: string, maxMs = 10_000) => {
  const started = Date.now()
  let url = await liveHref(browserId)
  while (Date.now() - started < maxMs) {
    if (/studentstudy/i.test(url)) return url
    await waitMs(400)
    url = await liveHref(browserId)
  }
  return url
}

/** 课程壳上确保侧栏「章节」页签（pageHeader=1），再打开第一节。 */
const ensureCourseChapterTab = async (browserId: string) => {
  let url = await liveHref(browserId)
  if (/studentstudy/i.test(url)) return url
  if (!/mycourse\/stu|stucoursemiddle/i.test(url)) return url
  if (coursePageHeader(url) === '1') return url
  const { clickHomeworkBox } = await import('../chaoxing/homework/act')
  const { LOCATE_CHAPTER_TAB } = await import('../chaoxing/study/cdpScripts')
  await clickHomeworkBox(browserId, LOCATE_CHAPTER_TAB()).catch(() => null)
  await waitMs(700)
  if (coursePageHeader(await liveHref(browserId)) !== '1') {
    await clickBrowserText(browserId, '章节').catch(() => null)
    await waitMs(700)
  }
  return liveHref(browserId)
}

const firstUnfinishedTitle = async (browserId: string) => {
  let first = String(chapterStateFor(browserId)?.unfinished?.[0] || '').trim()
  if (first) return first
  const parsed = await parseChaoxingChapters(browserId).catch(() => null)
  if (parsed && !(parsed as { waiting?: boolean }).waiting) {
    ingestChapterSnap(browserId, parsed as never)
  }
  return String(chapterStateFor(browserId)?.unfinished?.[0] || parsed?.unfinished?.[0] || '').trim()
}

const adapterFor = async (browserId: string): Promise<PlatformAdapter | null> => (
  resolvePlatformAdapter(await liveHref(browserId))
)

const studyHints = {
  homeworkFill: '作答页/章节测验用解析面板题卡：inspect 读题，fill 点选项。题干没读全先跳过，稍后再 inspect。其他页面仍用 get_page / eval 看页。',
  getPage: '解析面板只覆盖两页：章节目录/播放（browser_study_chapters）、作答题卡（browser_homework）。这两页优先走面板；其他页面 get_page / eval 就是看页的方式。',
  iframeNav: '不要把 iframe 地址当顶层网页打开。作业名单、章节目录、播放器都在页内框里。留在课程壳，用 browser_homework / click_text / browser_study_play。',
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
  const loop = readBrowserLoop({
    url: await liveHref(browserId),
    sessionId,
    panel: packAgentPanel(browserId),
  })

  const policy = getAgentPolicy()
  if (platformTool === 'browser_study_play' && !loop.allowStudyPlay) {
    return JSON.stringify({
      error: '当前不在课程/章节页',
      hint: loop.recipe,
      url: loop.url,
      page: loop.kind,
    })
  }
  if (
    platformTool === 'browser_homework'
    && loop.skipChapterQuiz
    && loop.kind === 'player'
    && loop.intent === 'play'
  ) {
    return JSON.stringify({
      ok: false,
      skipped: true,
      hint: '刷课默认跳过章节测验。立刻 browser_study_next，不要 homework。',
      page: loop.kind,
    })
  }
  const homeworkDoUrl = async () => {
    const { isHomeworkUrl } = await import('../browser/abstractions')
    const nowUrl = await currentUrl(browserId)
    return isHomeworkUrl(nowUrl) && /dowork|doHomeWork|\/work\/do/i.test(nowUrl) ? nowUrl : ''
  }
  // 作答页：看页始终允许；填写优先走题卡。strict 才禁止直接点/填。
  if (['browser_click', 'browser_type'].includes(name) && policy.permissionMode === 'strict') {
    if (await homeworkDoUrl()) {
      return JSON.stringify({
        error: '当前为严格模式，作业页禁止直接点页面或填写。请用 browser_homework 题卡。',
        hint: studyHints.homeworkFill,
      })
    }
  }
  if (name === 'browser_get_state') {
    const state = await getBrowserState(browserId).catch(() => null)
    const item = listAppBrowsers().find((browser) => browser.id === browserId)
    const url = state?.url || item?.url || ''
    const space = /i\.chaoxing\.com|i\.mooc\.chaoxing\.com/i.test(url)
      ? await import('../browser/engine/spaceTab').then((mod) => mod.readSpaceList(browserId)).catch(() => null)
      : null
    const graphUrl = space?.tab === '我学的课'
      ? (/visit\/courses|courselist/i.test(space.frame || '') ? space.frame : 'https://mooc1-1.chaoxing.com/visit/courses')
      : space?.tab === '我教的课'
        ? (/visit\/interaction/i.test(space.frame || '') ? space.frame : 'https://mooc1-1.chaoxing.com/visit/interaction')
        : await graphUrlOf(browserId, url)
    const { siteGraphAgentSnap } = await import('../browser/siteGraph')
    const snap = siteGraphAgentSnap(graphUrl)
    const spaceHint = space?.tab === '我学的课'
      ? '课表页签已是「我学的课」。'
      : space?.tab
        ? `当前课表页签是「${space.tab}」。`
        : undefined
    const card = liveTrustedCard(browserId, graphUrl || url)
    if (card) resetPageProbe(browserId)
    return JSON.stringify({
      id: browserId,
      url,
      title: state?.title || item?.title || item?.name || '',
      frame: space?.frame || (graphUrl !== url ? graphUrl : undefined),
      spaceTab: space?.tab || undefined,
      siteGraph: snap,
      card: card || undefined,
      hint: isShellNode(graphNodeId(graphUrl), graphUrl)
        ? [SPACE_HINT, spaceHint].filter(Boolean).join(' ')
        : (graphNodeId(graphUrl) === 'course' && browserTaskIntent(sessionId) === 'homework'
          ? COURSE_HW_HINT
          : (!snap
            ? '当前网址没有匹配的站点图谱。可用 get_page / screenshot 探路，或 read_agent_skill(site-learn) 记下这个站。'
            : undefined)),
    })
  }
  if (name === 'browser_get_page') {
    try {
      const url = await currentUrl(browserId)
      const graphUrl = await graphUrlOf(browserId, url)
      const trusted = liveTrustedCard(browserId, graphUrl || url)
      if (trusted) {
        resetPageProbe(browserId)
        return JSON.stringify(trustedCardBlock(trusted))
      }
      const nodeId = graphNodeId(graphUrl)
      const probes = notePageProbe(browserId)
      const page = await readBrowserPage(browserId)
      if (page == null || !Object.keys(page).length) {
        return JSON.stringify({
          error: '页面读取失败',
          hint: '再试一次 get_page，或 browser_eval 看 DOM。',
        })
      }
      if (!page.snapshot && !page.refs?.length) {
        const here = page.url || url
        const sameLogin = /passport2|\/login/i.test(here)
        const frameSrc = (page.iframes || []).map((item) => item.src).filter(Boolean).slice(0, 4)
        return JSON.stringify({
          url: here,
          empty: true,
          jumping: false,
          iframes: page.iframes,
          frames: page.frames,
          hint: sameLogin
            ? '快照暂时空，网址还在登录页，不是跳转。等 1 秒再 get_page。密码框有 value=已填写 才算填上了。'
            : frameSrc.length
              ? `顶层快照空，内容多半在 iframe：${frameSrc.join('、')}。看 frames / preferredFrame，或 screenshot / eval（不要 contentDocument）。`
              : '快照暂时空。先看 url：没变就还在本页，不要当成跳转，不要 reset 图谱。',
        })
      }
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
          probes >= 2 ? '连续探路仍空。确认结构变了再改 parsers/*/helpers.js，不要用 get_page 代替解析器。' : undefined,
        ].filter(Boolean).join(' ') || undefined,
      })
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
    const iframePage = /studentcourse|\/knowledge\/cards|ananas\/modules|insertvideo|insertdoc|insertaudio|insertbbs|\/mooc2\/work\/list|\/work\/list/i.test(url)
    const blockedNav = iframePage || isSpaceListTopUrl(url)
    if (blockedNav && policy.permissionMode === 'strict') {
      return JSON.stringify({
        ok: false,
        error: isSpaceListTopUrl(url)
          ? '严格模式禁止打开课表地址。用 click_text 点页签。'
          : studyHints.iframeNav,
      })
    }
    const navWarning = blockedNav
      ? (isSpaceListTopUrl(url)
        ? '这是课表/iframe 地址，通常应留在外壳里点页签，而不是顶层打开。'
        : studyHints.iframeNav)
      : undefined
    const target = resolveChaoxingLoginUrl(url)
    await navigateBrowserView(browserId, target)
    let landed = ''
    let host = ''
    try { host = new URL(target).host } catch { host = '' }
    for (let i = 0; i < 10; i++) {
      await wait(400)
      landed = await currentUrl(browserId)
      if (host && landed.includes(host)) break
      if (landed && !/browser-home|localhost:1420|about:blank/i.test(landed)) break
    }
    if (/browser-home|localhost:1420/i.test(landed) && /chaoxing|mooc/i.test(target)) {
      return JSON.stringify({
        ok: false,
        error: '还在应用首页，没有打开目标页。再 navigate 一次，不要先点登录。',
        url: landed,
      })
    }
    return JSON.stringify({
      ok: true,
      url: landed || target,
      ...(navWarning ? { warning: navWarning } : {}),
    })
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
    const from = await currentUrl(browserId)
    const ref = String(args.ref || '').trim()
    const selector = String(args.selector || '').trim()
    const css = cssSelectorFromArgs(ref, selector)
    const runClick = async (locator: { by: 'css' | 'text' | 'role' | 'label'; value: string; name?: string; exact?: boolean }) => {
      if (locator.by === 'css' && /^#[\w.-]+$/.test(locator.value)) {
        const quick = asObject(await clickBrowserElement(browserId, locator.value))
        if (quick.ok) {
          return JSON.stringify(await observeAfterClick(browserId, { ok: true, text: String(quick.text || locator.value) }, from))
        }
      }
      const acted = await clickByLocator(browserId, locator)
      if (acted.ok) return JSON.stringify(await observeAfterClick(browserId, acted, from))
      if (locator.by === 'text' || locator.by === 'role') {
        const framed = await clickBrowserText(browserId, String(locator.name || locator.value || ''))
        if (framed && typeof framed === 'object' && (framed as { ok?: boolean }).ok) {
          return JSON.stringify(await observeAfterClick(browserId, { ok: true, text: String((framed as { text?: string }).text || locator.value) }, from))
        }
      }
      return JSON.stringify(await observeAfterClick(browserId, acted, from))
    }
    if (ref && !looksLikeCssSelector(ref)) {
      const locator = await resolveRefLocator(browserId, ref)
      if (locator) return runClick(locator)
      if (css) return runClick({ by: 'css', value: css })
      return JSON.stringify({
        ok: false,
        error: `没有找到快照 ref ${ref}。ref 只能是 e3 这种编号。CSS 请用 selector=#loginBtn，不要放进 ref，也不要 get_page。`,
      })
    }
    if (!css) return JSON.stringify({ ok: false, error: '缺少 ref 或 selector。快照用 ref=e3，CSS 用 selector=#loginBtn。' })
    return runClick({ by: 'css', value: css })
  }
  if (name === 'browser_click_text') {
    const text = String(args.text || '').trim()
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
    let clicked = await clickBrowserText(browserId, text).catch((error) => (
      { ok: false, error: error instanceof Error ? error.message : String(error) }
    )) as { ok?: boolean; error?: string; text?: string }
    if (clicked?.ok) {
      const seen = await observeAfterClick(browserId, { ok: true, text: clicked.text || text }, from)
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
      return JSON.stringify({ ok: false, error: `没有找到「${text}」` })
    }
    const chrome = /^(我学的课|我教的课|章节|任务|作业|讨论|考试|资料|登录|返回课程|下一节|体验新版)$/.test(text)
    const graphUrl = await graphUrlOf(browserId, nowUrl)
    if (!chrome && /chaoxing|mooc/i.test(nowUrl) && !/(?:^|[?&])pageHeader=8(?:&|$)|\/work\//i.test(graphUrl)) {
      const opened = await openPanelChapter(browserId, { title: text }).catch(() => null)
      if (opened?.ok) {
        return JSON.stringify({
          ok: true,
          text,
          via: 'panel',
          hint: '已用解析面板打开该节。立刻 browser_study_play。',
          panel: opened.panel,
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
        return { filled: got.length > 0, length: got.length, password: pwd, found: true, ok: true };
      })()`).catch(() => ({ filled: false, length: 0 })))
    }
    const runFill = async (locator: { by: 'css' | 'text' | 'role' | 'label'; value: string; name?: string; exact?: boolean }) => {
      rememberLoginTyped(nowUrl, locator.value, text)
      if (locator.by === 'css' && /^#[\w.-]+$/.test(locator.value)) {
        const quick = asObject(await typeBrowserElement(browserId, locator.value, text))
        await wait(80)
        const check = await readFilled(locator)
        if (check?.filled) {
          return typedResult(quick, text, {
            filled: true,
            length: Number(check.length) || 0,
            password: Boolean(check.password),
          })
        }
      }
      const written = await fillByLocator(browserId, locator, text)
      await wait(80)
      const again = locator.by === 'css' ? await readFilled(locator) : null
      const filled = again ? Boolean(again.filled) : written.filled === true
      return typedResult(written, text, {
        filled,
        length: Number(again?.length ?? written.length ?? 0) || 0,
        password: Boolean(again?.password) || (!written.text && (written.length || 0) > 0),
      })
    }
    if (ref && !looksLikeCssSelector(ref)) {
      const locator = await resolveRefLocator(browserId, ref)
      if (locator) return runFill(locator)
      if (css) return runFill({ by: 'css', value: css })
      return JSON.stringify({
        ok: false,
        error: `没有找到快照 ref ${ref}。ref 只能是 e3 这种编号。CSS 请用 selector=#phone，不要放进 ref，也不要 get_page。`,
      })
    }
    if (!css) return JSON.stringify({ ok: false, error: '缺少 ref 或 selector。快照用 ref=e3，CSS 用 selector=#phone。' })
    return runFill({ by: 'css', value: css })
  }
  if (name === 'browser_scroll') {
    const amount = Number(args.amount)
    return JSON.stringify(await scrollBrowserView(browserId, Number.isFinite(amount) ? amount : 600))
  }
  if (name === 'browser_eval') {
    const evalUrl = await currentUrl(browserId).catch(() => '')
    const trustedEval = liveTrustedCard(browserId, evalUrl)
    if (trustedEval) {
      resetPageProbe(browserId)
      return JSON.stringify(trustedCardBlock(trustedEval))
    }
    const script = String(args.script || '').trim()
    if (!script) return JSON.stringify({ error: '缺少 script' })
    if (script.length > 20_000) {
      return JSON.stringify({ error: '脚本过长（上限 20000 字）', hint: '只读必要 DOM，不要整页 innerHTML。' })
    }
    const blocked = inspectEvalScript(script, loop.evalPolicy)
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
        error: '禁止改 iframe src 切课表。只 click_text「我学的课」点页签。',
      })
    }
    try {
      const report = await evalBrowserFrames(browserId, script)
      const { logAgentDebug } = await import('./debugLog')
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
      return JSON.stringify({
        ok: !report.error || report.frames.some((item) => item.error == null),
        ...report,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return JSON.stringify({
        error: message || '脚本执行失败',
        hint: '脚本在每个 frame 内执行。直接用 document，不要 iframe.contentDocument。顶层 return 会自动包装。',
      })
    }
  }

  if (platformTool === 'browser_study_chapters') {
    const adapter = await adapterFor(browserId)
    if (!adapter) return JSON.stringify({ error: '当前站点不支持章节工具' })
    await ensureCourseChapterTab(browserId)
    adapter.startChapterParser?.(browserId)
    await ensurePanelStudy(browserId)
    const catalog = await adapter.openChapters(browserId)
    if (catalog && typeof catalog === 'object' && !(catalog as { waiting?: boolean }).waiting) {
      ingestChapterSnap(browserId, catalog as never)
    }
    const open = String(args.open || args.title || '').trim()
    if (open) {
      const opened = await openPanelChapter(browserId, { title: open })
      const afterOpen = await waitForStudentStudy(browserId, 8_000)
      return JSON.stringify({
        ...opened,
        url: afterOpen,
        onPlayer: /studentstudy/i.test(afterOpen),
        hint: opened.ok && /studentstudy/i.test(afterOpen)
          ? '解析面板已打开该节。立刻 browser_study_play。'
          : opened.ok
            ? '已点节名，但还没进 studentstudy。再 browser_study_play。'
            : String(opened.error || '解析面板里没有这一节。用返回的 chapters 里的 title 再 open，或 get_page / eval 看目录。'),
      })
    }
    const panel = packAgentPanel(browserId)
    return JSON.stringify({
      via: 'panel',
      panel: compactStudyPanel(panel),
      jobLine: panel?.jobLine || '',
      doneJobs: panel?.doneJobs || [],
      leftJobs: panel?.leftJobs || [],
      unfinished: panel?.unfinishedSections || [],
      current: panel?.current || '',
      progress: panel?.progress || null,
      hint: panel?.hint || '解析面板还没读到目录。课程壳先点「章节」再调一次；仍空就 get_page / eval 看目录 iframe。',
    })
  }

  if (platformTool === 'browser_study_play') {
    const adapter = await adapterFor(browserId)
    if (!adapter) return JSON.stringify({ error: '当前站点不支持播放工具' })
    let nowUrlGate = await liveHref(browserId)
    if (!/studentstudy|mycourse\/stu|stucoursemiddle/i.test(nowUrlGate)) {
      return JSON.stringify({
        error: '当前不在课程/章节页',
        hint: '先进入课程并点「章节」，browser_study_chapters 后再 play。',
        url: nowUrlGate,
      })
    }
    const action = String(args.action || 'play').trim() === 'pause' ? 'pause' : 'play'
    if (action === 'pause' && !/studentstudy/i.test(nowUrlGate)) {
      return JSON.stringify({
        error: '暂停只在章节播放页（studentstudy）',
        hint: '先打开某一节进入播放页。',
        url: nowUrlGate,
      })
    }
    if (action === 'pause') {
      const { stopChaoxingWatch } = await import('../chaoxing/browser/watch')
      stopChaoxingWatch(browserId, { keep: true })
      const paused = adapter.runAfterCaptcha
        ? await adapter.runAfterCaptcha(sessionId, browserId, () => adapter.playVideo(browserId, { action: 'pause' }))
        : await adapter.playVideo(browserId, { action: 'pause' })
      return JSON.stringify({
        ...paused,
        playing: false,
        watching: false,
        hint: String(paused.hint || '已暂停。继续播再用 browser_study_play。'),
      })
    }
    let nowUrl = nowUrlGate
    if (!/studentstudy/i.test(nowUrl) && /mycourse\/stu|stucoursemiddle/i.test(nowUrl)) {
      nowUrl = await ensureCourseChapterTab(browserId)
      await ensurePanelStudy(browserId)
      const first = await firstUnfinishedTitle(browserId)
      if (first) {
        await openPanelChapter(browserId, { title: first }).catch(() => null)
      } else {
        await playPanelStudy(browserId).catch(() => null)
      }
      nowUrl = await waitForStudentStudy(browserId, 12_000)
      if (!/studentstudy/i.test(nowUrl)) {
        return JSON.stringify({
          ok: false,
          page: 'chapters',
          tab: coursePageHeader(await liveHref(browserId)) === '1' ? '章节' : '课程',
          hasVideo: false,
          playing: false,
          url: nowUrl,
          error: '还在课程壳目录，没有进入章节播放页（studentstudy）',
          hint: '目录里的节名 ≠ 播放页。再 browser_study_play 重试打开第一节；或 click_text 短节名进播放后再 play。',
        })
      }
    }
    const videoIndex = Number(args.videoIndex) || 0
    const label = String(args.label || '').trim()
    const skipIfDone = args.skipIfDone === true
    const run = () => adapter.playVideo(browserId, {
      videoIndex: videoIndex > 0 ? videoIndex : undefined,
      label: label || undefined,
      skipIfDone,
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
    if (played?.captcha || played?.quiz) {
      return JSON.stringify({ ...played, panel: compactStudyPanel(packAgentPanel(browserId)) })
    }
    if (played?.mismatched) {
      return JSON.stringify({
        ...played,
        watching: false,
        panel: compactStudyPanel(packAgentPanel(browserId)),
        hint: String(played.hint || '没切到你指定的任务点。不要 watch 当前这条。'),
      })
    }
    if (played?.hasVideo) {
      const playing = adapter.videoIsPlaying(played) || Boolean(played.playing)
      const panel = packAgentPanel(browserId)
      if (panel?.event === 'quiz_left' || panel?.event === 'chapter_jobs_done') {
        return JSON.stringify({
          ...played,
          playing,
          watching: false,
          panel: compactStudyPanel(panel),
          hint: panel.event === 'quiz_left'
            ? '本节视频已完成，还剩测验。刷课默认跳过，立刻 browser_study_next。'
            : panel.hint,
        })
      }
      const jobs = panel?.thisSection?.jobs || []
      const active = jobs.find((job) => job.active)
      const videos = jobs.filter((job) => job.kind === 'video')
      const want = videoIndex > 0 ? videos[videoIndex - 1] : (label ? jobs.find((job) => job.label === label) : null)
      if (want && active && want.label !== active.label) {
        return JSON.stringify({
          ...played,
          playing,
          watching: false,
          panel: compactStudyPanel(panel),
          hint: `你要的是${want.label}，当前却是${active.label}${active.done ? '（已完成）' : ''}。不要 watch，再 play 指定任务点。`,
        })
      }
      if (active?.kind === 'video' && active.done) {
        const left = jobs.filter((job) => !job.done).map((job) => job.label).join('、')
        return JSON.stringify({
          ...played,
          playing,
          watching: false,
          panel: compactStudyPanel(panel),
          hint: `当前${active.label}已完成，不要再看。要播哪个用 videoIndex / label。未完成：${left || '无'}。`,
        })
      }
      if (playing) {
        adapter.startWatch(
          browserId,
          sessionId,
          { ...played, paused: false },
          { resume: Boolean(adapter.videoWatchFor(browserId)) },
        )
      }
      return JSON.stringify({
        ...played,
        playing,
        watching: playing,
        panel: compactStudyPanel(panel),
        hint: String(played.hint || (
          playing
            ? 'playing=true。进度在面板/watch；要等面板事件用 browser_wait。'
            : '播放器在，但视频没有播起来。立刻再 browser_study_play，禁止 watch，禁止说正在播放。'
        )),
      })
    }
    return JSON.stringify({ ...played, panel: compactStudyPanel(packAgentPanel(browserId)) })
  }

  if (platformTool === 'browser_study_watch') {
    const adapter = await adapterFor(browserId)
    if (!adapter) return JSON.stringify({ error: '当前站点不支持进度监控' })
    const watchUrl = await liveHref(browserId)
    if (!/studentstudy/i.test(watchUrl)) {
      return JSON.stringify({
        error: '播放监控只在章节详情页（studentstudy）',
        hint: '先 browser_study_chapters → browser_study_play 进入播放页。',
        url: watchUrl,
      })
    }
    const existing = adapter.videoWatchFor(browserId)
    const panelNow = packAgentPanel(browserId)
    const { watchSessionFastPath, stopChaoxingWatch } = await import('../chaoxing/browser/watch')
    const fast = watchSessionFastPath(existing, panelNow?.event)
    if (fast === 'panel_clear') {
      return JSON.stringify({
        watching: false,
        panelEvent: panelNow?.event,
        panel: compactStudyPanel(panelNow),
        hint: panelNow?.event === 'quiz_left'
          ? '本节视频已完成，还剩测验。刷课默认跳过，立刻 browser_study_next。'
          : panelNow?.hint,
      })
    }
    if (fast === 'ended') {
      return JSON.stringify({
        watching: false,
        ended: true,
        already: true,
        title: existing?.title || '',
        panel: compactStudyPanel(panelNow),
        hint: '这段视频已经结束。看 jobs，用 browser_study_play 指定下一条；只剩测验就 browser_study_next。',
      })
    }
    if (fast === 'already') {
      return JSON.stringify({
        watching: true,
        already: true,
        title: existing?.title || '',
        panel: compactStudyPanel(panelNow),
        hint: '已经在监控。面板事件会结束 wait。',
      })
    }
    const tick = await readChaoxingVideoTick(browserId).catch(() => null)
    const livePlaying = videoIsPlaying(tick)
    if (!livePlaying) {
      stopChaoxingWatch(browserId, { keep: true })
      return JSON.stringify({
        watching: false,
        playing: false,
        paused: true,
        title: existing?.title || '',
        video: tick,
        panel: compactStudyPanel(packAgentPanel(browserId)),
        hint: '视频没有在播。立刻 browser_study_play 指定任务点，禁止 watch，禁止说正在播放。',
      })
    }
    adapter.startWatch(browserId, sessionId, {
      ...tick,
      title: existing?.title || '',
    })
    return JSON.stringify({
      watching: true,
      title: existing?.title || '',
      video: tick,
      panel: compactStudyPanel(packAgentPanel(browserId)),
      hint: '进度条实时更新。播完不会自动打开下一段，面板会叫醒。',
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
    const nextUrl = await liveHref(browserId)
    if (!/studentstudy/i.test(nextUrl)) {
      return JSON.stringify({
        error: '下一任务点只在章节播放页使用',
        hint: '先进入 studentstudy 播放页；课程壳目录用 browser_study_chapters。',
        url: nextUrl,
      })
    }
    const run = () => adapter.openNext(browserId)
    const next = adapter.runAfterCaptcha
      ? await adapter.runAfterCaptcha(sessionId, browserId, run)
      : await run()
    if (next?.captcha || next?.quiz) {
      return JSON.stringify({ ...next, panel: compactStudyPanel(next.panel || packAgentPanel(browserId)) })
    }
    if (next?.hasVideo && Number(next.duration) > 1) {
      const playing = adapter.videoIsPlaying(next)
      const panel = packAgentPanel(browserId)
      if (next.sameChapter && (panel?.event === 'quiz_left' || panel?.event === 'chapter_jobs_done')) {
        return JSON.stringify({
          ...next,
          playing,
          watching: false,
          panel: compactStudyPanel(panel),
          hint: panel.event === 'quiz_left'
            ? '本节视频已完成，还剩测验。刷课默认跳过，立刻再 browser_study_next。'
            : panel.hint,
        })
      }
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
        panel: compactStudyPanel(panel),
        hint: playing
          ? next.sameChapter
            ? '已打开本章下一个未完成视频，playing=true。'
            : '已打开下一节视频，playing=true。'
          : studyHints.nextPaused,
      })
    }
    return JSON.stringify({ ...next, panel: compactStudyPanel(next.panel || packAgentPanel(browserId)) })
  }

  if (platformTool === 'browser_homework') {
    const adapter = await adapterFor(browserId)
    if (!adapter) return JSON.stringify({ error: '当前站点不支持作业工具' })
    const topUrl = await currentUrl(browserId)
    const nowUrl = await graphUrlOf(browserId, topUrl)
    const action = String(args.action || 'list').trim() as HomeworkAction | string
    const enteringList = homeworkEnteringList(adapter, action, topUrl, nowUrl)
    if (!adapter.canUseHomeworkTools(nowUrl) && !enteringList) {
      return JSON.stringify({
        error: studyHints.homeworkForbidden,
        url: nowUrl,
        hint: '课程作业：先点「作业」到列表或作答页；章节测验：在播放页点开测验标签后再调。',
      })
    }
    const chapterQuiz = adapter.isChapterWorkUrl(nowUrl)
    if (chapterQuiz && ['list', 'open'].includes(action)) {
      return JSON.stringify({
        error: '章节测验页不要 list/open',
        url: nowUrl,
        hint: studyHints.chapterNoList,
      })
    }
    if (!chapterQuiz && !adapter.isHomeworkUrl(nowUrl) && !enteringList) {
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

  if (name === 'browser_screenshot') {
    try {
      const state = await getBrowserState(browserId).catch(() => null)
      const shot = await screenshotBrowserView(browserId)
      const page = await readBrowserPage(browserId).catch(() => null)
      const frameSrc = (page?.iframes || []).map((item) => item.src).filter(Boolean).slice(0, 4)
      return JSON.stringify({
        ok: true,
        url: shot.url || state?.url || '',
        title: state?.title || '',
        image: shot.image,
        iframes: page?.iframes,
        preferredFrame: page?.preferredFrame?.url || undefined,
        hint: frameSrc.length
          ? `截图是当前可视区域（含已画出的 iframe）。页内还有框：${frameSrc.join('、')}。`
          : undefined,
      })
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error || '截图失败'),
      })
    }
  }
  if (name === 'browser_wait') {
    const untilRaw = String(args.until || '').trim().toLowerCase()
    const until = untilRaw || (args.selector ? 'selector' : args.url ? 'url' : 'panel')
    const fallbackSeconds = until === 'panel' ? 180 : 30
    const seconds = Math.min(600, Math.max(1, Number(args.seconds) || fallbackSeconds))
    const { runAgentWait } = await import('./agentWait')
    const { flushWatchIntoWait, notePanelEvent } = await import('../chaoxing/browser/watchAgent')
    const result = await runAgentWait({
      sessionId,
      browserId,
      seconds,
      wait,
      until,
      url: args.url != null ? String(args.url) : undefined,
      selector: args.selector != null ? String(args.selector) : undefined,
      idleMs: Number(args.idleMs) || undefined,
      onStart: until === 'panel' ? flushWatchIntoWait : undefined,
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
