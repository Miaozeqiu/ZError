import { invoke } from '@tauri-apps/api/core'
import { asObject, evalBrowserViewMain, evalBrowserViewMainNow, waitMs } from '../../browser/eval'
import { liveGraphHref, liveSpaceTab, noteCourseTab } from '../../browser/siteGraph'
import { siteGraphNodeForUrl, siteGraphUrlFromFrames } from '../../browser/siteGraphCore'
import { courseParseScript } from '../../chaoxing/host/courseRuntime'
import { isChaoxingCourseUrl } from './nav'
import { READ_SPACE_LIST } from './spaceTab'

/** 中间 iframe / 明确页签优先。pageHeader=0 是弱信号，单独用会把章节目录误判成任务。 */
export const courseTabFromHref = (href: string) => {
  const h = String(href || '')
  if (/studentcourse/i.test(h)) return '章节'
  if (/stuActiveList|\/active\/stu/i.test(h)) return '任务'
  if (/\/work\/(?:list|index|view)/i.test(h)) return '作业'
  if (/[?&]pageHeader=8(?:&|$)/i.test(h)) return '作业'
  if (/[?&]pageHeader=1(?:&|$)/i.test(h)) return '章节'
  return ''
}

export const COURSE_CHROME_TABS = ['任务', '章节', '作业', '讨论', '考试', '资料'] as const

export const isCourseChromeTab = (text: string) => (
  (COURSE_CHROME_TABS as readonly string[]).includes(String(text || '').trim())
)

const courseIdOf = (url: string) => (
  (String(url || '').match(/[?&](?:courseid|courseId)=(\d+)/i) || [])[1] || ''
)

export const sameChaoxingCourse = (a: string, b: string) => {
  const left = courseIdOf(a)
  const right = courseIdOf(b)
  return Boolean(left && right && left === right && isChaoxingCourseUrl(a) && isChaoxingCourseUrl(b))
}

const CONTROL_OF: Record<string, string> = {
  章节: 'chapter-tab',
  作业: 'homework-tab',
  任务: 'task-tab',
}

const takeCourseCard = (raw: unknown) => {
  const card = asObject(raw)
  const tab = String(card.current || '')
  if (card.ok === false && !tab) return { tab: '', href: '' }
  if (tab === '章节' || tab === '任务' || tab === '作业') {
    noteCourseTab(tab, 'probe', String(card.url || ''))
    return { tab, href: String(card.url || '') }
  }
  return { tab: '', href: '' }
}

const READ_GRAPH_FACE = `(function(){
  var href = '';
  try { href = String((window.top && window.top.location && window.top.location.href) || location.href || ''); } catch (e) {
    try { href = String(location.href || ''); } catch (e2) {}
  }
  var frames = [];
  var root = document;
  try { if (window.top && window.top.document) root = window.top.document; } catch (e3) {}
  try {
    var main = root.querySelector('#frame_content, iframe[name="frame_content"], .main iframe, .right iframe') || root.querySelector('iframe');
    if (main) {
      var live = '';
      try { live = String((main.contentWindow && main.contentWindow.location && main.contentWindow.location.href) || ''); } catch (e4) {}
      if (live && live !== 'about:blank') frames.push(live);
    }
  } catch (e5) {}
  return { href: href, frames: frames };
})()`

export const readCourseTab = async (id: string) => {
  const script = courseParseScript()
  const hit = takeCourseCard(await evalBrowserViewMain(id, script).catch(() => null))
  return { tab: hit.tab, via: hit.tab ? 'page' : 'none', href: hit.href }
}

let peekingGraph = false

export const peekLiveGraph = async (id: string) => {
  if (peekingGraph) return liveGraphHref.value
  peekingGraph = true
  try {
    const raw = asObject(await evalBrowserViewMainNow(id, READ_GRAPH_FACE).catch(() => null))
    const top = String(raw.href || '')
    const frames = Array.isArray(raw.frames) ? raw.frames.map((item) => String(item || '')).filter(Boolean) : []
    const href = siteGraphUrlFromFrames(top, frames)
    if (href) liveGraphHref.value = href
    const node = siteGraphNodeForUrl(href || top)
    if (node?.id === 'course' || /mycourse\/stu|stucoursemiddle|studentcourse/i.test(href || top)) {
      takeCourseCard(await evalBrowserViewMainNow(id, courseParseScript()).catch(() => null))
    }
    if (node?.id === 'space' || /i\.chaoxing|i\.mooc\.chaoxing/i.test(top)) {
      const space = asObject(await evalBrowserViewMainNow(id, READ_SPACE_LIST).catch(() => null))
      const tab = String(space.tab || '')
      if (tab === '我学的课' || tab === '我教的课') {
        liveSpaceTab.value = tab
        const frame = String(space.href || '')
        if (frame) liveGraphHref.value = siteGraphUrlFromFrames(top, [frame, ...frames])
      }
    }
    return href
  } finally {
    peekingGraph = false
  }
}

let courseTabTimer = 0
let courseTabBrowser = ''
let courseTabEager = false

const withDeadline = async <T,>(task: Promise<T>, ms: number, fallback: T) => {
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

const peekCourseTab = async (id: string) => {
  const script = courseParseScript()
  const raw = await evalBrowserViewMainNow(id, script).catch(() => null)
    ?? await evalBrowserViewMain(id, script).catch(() => null)
  const hit = takeCourseCard(raw)
  return { tab: hit.tab }
}

export const watchCourseTab = (id: string, eager = false) => {
  const want = String(id || '').trim()
  if (!want) return
  if (courseTabTimer && courseTabBrowser === want && courseTabEager === eager) return
  stopWatchCourseTab()
  courseTabBrowser = want
  courseTabEager = eager
  void peekLiveGraph(want)
  courseTabTimer = window.setInterval(() => {
    void peekLiveGraph(courseTabBrowser)
  }, eager ? 700 : 1600)
}

export const stopWatchCourseTab = () => {
  if (courseTabTimer) window.clearInterval(courseTabTimer)
  courseTabTimer = 0
  courseTabBrowser = ''
  courseTabEager = false
  liveGraphHref.value = ''
  liveSpaceTab.value = ''
}

const liveUrl = async (id: string) => {
  const state = await invoke<{ url?: string }>('browser_get_state', { id }).catch(() => null)
  return String(state?.url || '')
}

const CHAPTER_HINT = '侧栏已是目录。这不是播放页。看卡片，用 click_text 或 看快照 打开节名。'

export const clickCourseTab = async (id: string, tab: string) => {
  const want = String(tab || '').trim()
  if (!isCourseChromeTab(want)) {
    return { ok: false, error: `不是课程侧栏：${want}`, text: want }
  }
  const before = await liveUrl(id)
  if (!isChaoxingCourseUrl(before)) {
    return { ok: false, error: '不在课程壳，侧栏页签点不了', text: want, url: before }
  }

  const fail = (error: string, url = before) => ({
    ok: false,
    error,
    text: want,
    url,
    hint: '只点课程壳左侧页签。学习通点完网址经常不变，但中间框和侧栏选中态会变。',
  })

  return withDeadline(clickCourseTabNow(id, want, before), 8000, fail(`点「${want}」超时。侧栏点完网址常不变，看 get_state.tab。`))
}

const CSS_OF: Record<string, string> = {
  章节: '[title="章节"]',
  作业: '[title="作业"]',
  任务: '[title="任务"]',
}

const clickCourseTabNow = async (id: string, want: string, before: string) => {
  const already = await peekCourseTab(id).catch(() => ({ tab: '' }))
  if (already.tab === want) {
    return {
      ok: true,
      already: true,
      text: want,
      url: before,
      navigated: false,
      hint: want === '章节' ? CHAPTER_HINT : `侧栏已是「${want}」。内容在中间 iframe，网址不变正常。`,
    }
  }

  const control = CONTROL_OF[want] || ''
  const { clickByLocator } = await import('../../browser/engine')
  const { locatorsForHomeworkControl, locatorsForStudyControl } = await import('../../chaoxing/host/selectors')
  const queries = control === 'homework-tab'
    ? locatorsForHomeworkControl(control)
    : locatorsForStudyControl(control)
  let clicked = false
  for (const query of queries) {
    const hit = await clickByLocator(id, query).catch(() => null)
    if (hit?.ok) {
      clicked = true
      break
    }
  }
  if (!clicked) {
    const { act } = await import('../../browser/protocol')
    await act(id, { op: 'click', at: { by: 'css', value: CSS_OF[want] || `[title="${want}"]` } }).catch(() => null)
  }

  let url = before
  for (let i = 0; i < 4; i += 1) {
    await waitMs(200)
    url = await liveUrl(id)
    const live = await peekCourseTab(id).catch(() => ({ tab: '' }))
    if (live.tab === want) {
      return {
        ok: true,
        text: want,
        url,
        navigated: url.split('#')[0] !== before.split('#')[0],
        hint: want === '章节' ? CHAPTER_HINT : `侧栏已切到「${want}」。中间 iframe 可能已换，顶层网址常不变。`,
      }
    }
  }
  return {
    ok: false,
    error: `点「${want}」没有切到侧栏。任务列表里也有这些字，不要点那些。`,
    text: want,
    url,
    hint: '只点课程壳左侧页签。学习通点完网址经常不变，但中间框和侧栏选中态会变。',
  }
}
