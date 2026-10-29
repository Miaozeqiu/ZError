/** 软件外 Agent 用的浏览器 / 解析器接口。开发桥 127.0.0.1:1429 */

import {
  clickBrowserElement,
  clickBrowserText,
  getBrowserState,
  goBackBrowserView,
  goForwardBrowserView,
  hoverBrowserElement,
  listAppBrowsers,
  navigateBrowserView,
  pressBrowserKey,
  readBrowserPage,
  reloadBrowserView,
  screenshotBrowserView,
  scrollBrowserView,
  typeBrowserElement,
  getSelectedBrowserId,
  peekAppBrowserUrl,
} from '../browser/appBrowser'
import { evalBrowserView, evalBrowserViewMain, waitMs } from '../browser/eval'
import { siteGraphAgentSnap } from '../browser/siteGraph'
import { ensurePanelStudy, nextPanelStudy, openPanelChapter, playPanelStudy, readPanelStudy } from '../chaoxing/browser/panelStudy'
import { fillChaoxingCaptcha, readChaoxingVideoTick } from '../chaoxing/study'
import { runPanelHomework } from '../chaoxing/homework/panelHomework'
import { redactObject, redactText } from '../security/secretRedaction'

export type BridgeCmd = {
  id?: string
  action?: string
  args?: Record<string, unknown>
}

export const BRIDGE_ACTIONS = [
  { name: 'help', group: 'meta', hint: '列出全部动作' },
  { name: 'list', group: 'meta', hint: '列出应用内浏览器标签' },
  { name: 'state', group: 'meta', hint: '当前页 + 章节解析器全文 + 任务点' },
  { name: 'goto', group: 'browser', hint: '打开网址。args.url', alias: ['navigate'] },
  { name: 'reload', group: 'browser', hint: '刷新' },
  { name: 'back', group: 'browser', hint: '后退' },
  { name: 'forward', group: 'browser', hint: '前进' },
  { name: 'click', group: 'browser', hint: '点元素。args.selector 或 args.text' },
  { name: 'click_text', group: 'browser', hint: '按可见文本点。args.text' },
  { name: 'type', group: 'browser', hint: '填写。args.selector + args.text', alias: ['fill'] },
  { name: 'hover', group: 'browser', hint: '悬停。args.selector 或 args.text' },
  { name: 'press', group: 'browser', hint: '按键。args.key' },
  { name: 'scroll', group: 'browser', hint: '滚动。args.amount' },
  { name: 'wait', group: 'browser', hint: '等待。args.ms / selector / text / url' },
  { name: 'screenshot', group: 'browser', hint: '截图，返回 data URL' },
  { name: 'snapshot', group: 'browser', hint: 'Playwright 风格无障碍快照', alias: ['get_page', 'page'] },
  { name: 'eval', group: 'browser', hint: '在页面跑 JS。args.script' },
  { name: 'chapter', group: 'parser', hint: '强制读目录，返回完整章节树和本节任务点' },
  { name: 'chapter_open', group: 'parser', hint: '打开一节。args.title / index / chapterId' },
  { name: 'play', group: 'parser', hint: '播任务点。args.videoIndex / label / title' },
  { name: 'pause', group: 'parser', hint: '暂停当前视频' },
  { name: 'next', group: 'parser', hint: '下一未完成视频或下一节' },
  { name: 'probe', group: 'parser', hint: '读当前视频进度', alias: ['watch'] },
  { name: 'inspect', group: 'parser', hint: '读作业/测验题卡' },
  { name: 'homework', group: 'parser', hint: '题卡。args.action=inspect|list|open|fill|guess|save|submit' },
  { name: 'captcha', group: 'parser', hint: '填验证码。args.code' },
  { name: 'send', group: 'agent', hint: '给应用内浏览器 Agent 发一句', alias: ['prompt'] },
  { name: 'chat', group: 'agent', hint: '读应用内 Agent 最近一条' },
  { name: 'stop', group: 'agent', hint: '停下应用内 Agent' },
] as const

const arg = (args: Record<string, unknown> | undefined, ...keys: string[]) => {
  for (const key of keys) {
    const value = args?.[key]
    if (value != null && String(value).trim()) return String(value).trim()
  }
  return ''
}

const num = (args: Record<string, unknown> | undefined, key: string) => {
  const value = Number(args?.[key])
  return Number.isFinite(value) ? value : 0
}

const clip = (text: string, max = 400) => {
  const value = String(text || '').replace(/\s+/g, ' ').trim()
  return value.length > max ? `${value.slice(0, max)}…` : value
}

// A bounded, redacted target label is enough to audit a click without dumping page HTML.
const clickSnapshotTarget = (steps: Array<{ result?: string }>, ref: unknown) => {
  const id = String(ref || '').trim()
  if (!/^e[0-9]+$/.test(id)) return undefined
  const pattern = new RegExp(`(?:ref=|\\[)${id}(?![0-9])`)
  for (let i = steps.length - 1; i >= 0; i--) {
    let result: any
    try { result = JSON.parse(steps[i].result || '{}') } catch { continue }
    const snapshots = [result.snapshot, result.page?.snapshot, result.after?.snapshot, result.observation?.snapshot]
    for (const snapshot of snapshots) {
      if (typeof snapshot !== 'string') continue
      const line = snapshot.split('\n').find(line => pattern.test(line))
      if (line) return redactText(clip(line, 400))
    }
  }
  return undefined
}

const resolveBrowserId = async (want?: string) => {
  const list = listAppBrowsers()
  const asked = String(want || '').trim()
  if (asked) return asked
  const selected = getSelectedBrowserId()
  if (selected && list.some((item) => item.id === selected)) return selected
  const chaoxing = [...list].reverse().find((item) => /chaoxing\.com/i.test(item.url || ''))
  if (chaoxing) return chaoxing.id
  const latest = [...list].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0]
  return latest?.id || list[0]?.id || ''
}

const pageSnap = async (browserId: string, withImage: boolean) => {
  const state = await getBrowserState(browserId).catch(() => null)
  const item = listAppBrowsers().find((browser) => browser.id === browserId)
  const url = state?.url || item?.url || ''
  const title = state?.title || item?.title || item?.name || ''
  let image = ''
  if (withImage) {
    const shot = await screenshotBrowserView(browserId).catch(() => null)
    image = shot?.image || ''
  }
  return {
    browserId,
    url,
    title,
    siteGraph: siteGraphAgentSnap(url),
    image,
  }
}

const parserSnap = async (browserId: string, refresh = false) => {
  if (refresh) await ensurePanelStudy(browserId).catch(() => null)
  return readPanelStudy(browserId)
}

const waitFor = async (
  browserId: string,
  opts: { ms?: number; selector?: string; text?: string; url?: string },
) => {
  if (opts.ms) await waitMs(opts.ms)
  const selector = String(opts.selector || '').trim()
  const text = String(opts.text || '').trim()
  const urlPart = String(opts.url || '').trim()
  if (!selector && !text && !urlPart) return { ok: true, waited: opts.ms || 0 }
  const deadline = Date.now() + Math.max(opts.ms || 8000, 8000)
  let last = ''
  while (Date.now() < deadline) {
    if (urlPart) {
      const href = String(await evalBrowserView(browserId, `(function(){ try { return String(location.href||''); } catch(e){ return ''; } })()`).catch(() => '') || '')
      last = href
      if (href.includes(urlPart)) return { ok: true, url: href }
    }
    if (selector) {
      const found = await evalBrowserView(browserId, `(function(){ return !!document.querySelector(${JSON.stringify(selector)}); })()`).catch(() => false)
      if (found) return { ok: true, selector }
    }
    if (text) {
      const found = await evalBrowserView(browserId, `(function(){
        var want = ${JSON.stringify(text)};
        var t = document.body ? String(document.body.innerText||'') : '';
        return t.indexOf(want) >= 0;
      })()`).catch(() => false)
      if (found) return { ok: true, text }
    }
    await waitMs(200)
  }
  return { ok: false, error: '等待超时', url: last, selector, text }
}

const homeworkOf = async (
  browserId: string,
  action: string,
  args: Record<string, unknown>,
) => {
  const hwAction = ['list', 'open', 'inspect', 'fill', 'guess', 'save', 'submit'].includes(action)
    ? action
    : 'inspect'
  return runPanelHomework(browserId, {
    action: hwAction,
    title: arg(args, 'title') || undefined,
    answers: args.answers ?? args.answer,
  })
}

const sendInApp = async (browserId: string, text: string) => {
  const { ensureBrowserChat, sendChatMessage, stopChat, selectChat } = await import('./chat')
  const { modelConfigManager } = await import('../model/config')
  const session = ensureBrowserChat({ browserId })
  if (!session) return { ok: false, error: '没有浏览器对话' }
  selectChat(session.id)
  const agent = modelConfigManager.getSelectedAgentModel() || modelConfigManager.getSelectedTextModel()
  if (!agent) return { ok: false, error: '没有可用的 agent 模型', sessionId: session.id }
  if (session.messages.some((item) => item.status === 'streaming')) stopChat(session.id)
  void sendChatMessage(text, undefined, { sessionId: session.id })
  return { ok: true, browserId, sessionId: session.id, sent: clip(text, 120) }
}

const actionOf = (raw: string) => {
  const name = String(raw || 'help').trim()
  const hit = BRIDGE_ACTIONS.find((item) => (
    item.name === name || ('alias' in item && (item.alias as readonly string[]).includes(name))
  ))
  return hit?.name || name
}

export const runBridgeAction = async (cmd: BridgeCmd) => {
  const action = actionOf(String(cmd.action || 'help'))
  const args = cmd.args || {}
  const id = cmd.id

  if (action === 'help') {
    return { ok: true, id, action, actions: BRIDGE_ACTIONS }
  }

  if (action === 'list') {
    return {
      ok: true,
      id,
      action,
      selected: getSelectedBrowserId(),
      browsers: listAppBrowsers().map((item) => ({
        id: item.id,
        url: item.url,
        title: item.title || item.name,
        updatedAt: item.updatedAt,
      })),
    }
  }

  const browserId = await resolveBrowserId(arg(args, 'browserId', 'id'))
  if (!browserId) return { ok: false, id, action, error: '没有打开的浏览器' }

  if (/^(goto|chapter|chapter_open|play|pause|next|probe|snapshot)$/.test(action)) {
    const { ensureBrowserChat, selectChat } = await import('./chat')
    const session = ensureBrowserChat({ browserId })
    if (session) selectChat(session.id)
    window.dispatchEvent(new CustomEvent('navigate-tab', { detail: 'browser' }))
    const { ensureAgentBrowser } = await import('./agentBrowser')
    if (session) await ensureAgentBrowser(session.id)
  }

  if (action === 'stop') {
    const { browserChatSessions, stopChat } = await import('./chat')
    const session = browserChatSessions.value.find(item => item.browserId === browserId || item.browserIds?.includes(browserId))
      || browserChatSessions.value[0]
    if (session) stopChat(session.id)
    return { ok: true, id, action, sessionId: session?.id || '', stopped: Boolean(session) }
  }

  if (action === 'send') {
    const text = arg(args, 'text')
    if (!text) return { ok: false, id, action, error: '缺少 text' }
    return { id, action, ...(await sendInApp(browserId, text)) }
  }

  if (action === 'chat') {
    const { controlForSession } = await import('../browser/control')
    const { sessions, chatStoreReady } = await import('./chatStore')
    await chatStoreReady
    const { modelConfigManager } = await import('../model/config')
    const candidates = [...sessions.value].filter(item => !item.parentId && item.messages.length)
      .sort((left, right) => right.updatedAt - left.updatedAt)
    const requested = arg(args, 'sessionId')
    const session = (requested ? sessions.value.find(item => item.id === requested)
      : arg(args, 'browserId', 'id') ? candidates.find(item => item.browserId === browserId || item.browserIds?.includes(browserId))
        : candidates[0])
      || null
    const last = session?.messages[session.messages.length - 1]
    const diagnostic = args.diagnostics === true
    const { videoWatchFor } = await import('../platform/panelAccess')
    const { coursePlanFor } = await import('../browser/coursePlan')
    const { hasAgentWait } = await import('./agentWait')
    const watchId = session?.browserId || browserId
    const watch = videoWatchFor(watchId)
    const plan = coursePlanFor(watchId)
    return {
      ok: Boolean(session),
      id,
      action,
      browserId: session?.browserId || browserId,
      sessionId: session?.id || '',
      streaming: last?.status === 'streaming',
      browserControl: controlForSession(session?.id || '') || null,
      agentModel: modelConfigManager.getSelectedAgentModel()?.displayName
        || modelConfigManager.getSelectedTextModel()?.displayName
        || '',
      lastRole: last?.role || '',
      lastText: clip(last?.content || last?.error || '', 240),
      ...(diagnostic ? {
        lastStatus: last?.status, taskOutcome: last?.taskOutcome, stopReason: last?.stopReason, waitingForEvent: hasAgentWait(session?.id || ''),
        lastError: args.details === true ? redactText(clip(last?.error || '', 1600)) : undefined,
        watch: watch ? { sessionId: watch.sessionId, status: watch.status, current: watch.current, duration: watch.duration, updatedAt: watch.updatedAt } : null,
        coursePlan: plan ? { total: plan.items.length, pending: plan.items.filter(item => item.status === 'pending').length, paused: Boolean(plan.pausedReason) } : null,
        recentTurns: session?.messages.slice(-6).map(message => ({
          role: message.role, status: message.status, stopReason: message.stopReason,
          ...(args.details === true ? { text: redactText(clip(message.content || '', 3000)) } : {}),
          tools: message.steps.map((step, index) => {
            let params: Record<string, unknown> = {}, result: Record<string, unknown> = {}
            try { params = JSON.parse(step.arguments || '{}') } catch { /* no arguments */ }
            try { result = JSON.parse(step.result || '{}') } catch { /* no JSON result */ }
            return { name: step.name, status: step.status,
              frame: params.frame, frameId: params.frameId, loaderId: params.loaderId,
              requestedStatus: params.status, watching: result.watching, finished: result.finished,
              resultStatus: result.status, ok: result.ok,
              ...(args.details === true && step.name === 'browser_press' ? { key: params.key } : {}),
              ...(args.details === true && /^(browser_eval|browser_get_page)$/.test(step.name) ? {
                observationKeys: result.result && typeof result.result === 'object' ? Object.keys(result.result).slice(0, 30) : [],
                viewportMetrics: Object.fromEntries(['w', 'h', 'dpr', 'scrollY'].flatMap(key => typeof result.result?.[key] === 'number' ? [[key, result.result[key]]] : [])),
                completionStats: (JSON.stringify(result.result || result.snapshot || '').match(/已完成任务点\s*[：:]?\s*\d+\s*\/\s*\d+/g) || []).slice(0, 5),
              } : {}),
              ...(args.details === true && /^(browser_finish|browser_todo)$/.test(step.name) ? {
                error: redactText(clip(step.detail || String(result.error || ''), 1600)),
                todoAction: params.action,
                todoIndex: params.index,
                reason: redactText(clip(String(params.reason || ''), 500)),
                todoCounts: Array.isArray(result.todos) ? { pending: result.todos.filter((item: any) => item.status === 'pending').length,
                  done: result.todos.filter((item: any) => item.status === 'done').length, cancelled: result.todos.filter((item: any) => item.status === 'cancelled').length } : undefined,
              } : {}),
              ...(args.details === true && /^browser_(click|click_text)$/.test(step.name) ? {
                targetLine: clickSnapshotTarget(message.steps.slice(0, index), params.ref),
                locator: redactObject({ ref: params.ref, selector: params.selector, text: params.text, nth: params.nth,
                  frame: params.frame, frameId: params.frameId, loaderId: params.loaderId }),
                error: redactText(clip(step.detail || String(result.error || ''), 1200)),
                reason: result.reason,
                requiresRefresh: result.requiresRefresh,
                snapshotStale: result.snapshotStale,
              } : {}),
            }
          }),
        })),
      } : {}),
    }
  }

  if (action === 'state') {
    return {
      ok: true,
      id,
      action,
      ...(await pageSnap(browserId, false)),
      chapter: await parserSnap(browserId, false),
      host: typeof location !== 'undefined' ? location.href : '',
      tauri: typeof (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !== 'undefined',
    }
  }

  if (action === 'goto') {
    const url = arg(args, 'url', 'href')
    if (!url) return { ok: false, id, action, error: '缺少 url' }
    await navigateBrowserView(browserId, url)
    await waitMs(400)
    return { ok: true, id, action, ...(await pageSnap(browserId, false)) }
  }

  if (action === 'reload') {
    await reloadBrowserView(browserId)
    await waitMs(300)
    return { ok: true, id, action, ...(await pageSnap(browserId, false)) }
  }

  if (action === 'back') {
    await goBackBrowserView(browserId)
    return { ok: true, id, action, ...(await pageSnap(browserId, false)) }
  }

  if (action === 'forward') {
    await goForwardBrowserView(browserId)
    return { ok: true, id, action, ...(await pageSnap(browserId, false)) }
  }

  if (action === 'click' || action === 'click_text') {
    const selector = arg(args, 'selector', 'css')
    const text = arg(args, 'text')
    if (action === 'click' && selector) {
      const clicked = await clickBrowserElement(browserId, selector)
      return { ok: Boolean(clicked.ok), id, action, clicked, ...(await pageSnap(browserId, false)) }
    }
    if (!text) return { ok: false, id, action, error: '缺少 text 或 selector' }
    const clicked = await clickBrowserText(browserId, text)
    return { ok: Boolean(clicked.ok), id, action, clicked, ...(await pageSnap(browserId, false)) }
  }

  if (action === 'type') {
    const selector = arg(args, 'selector', 'css')
    const text = arg(args, 'text', 'value')
    if (!selector) return { ok: false, id, action, error: '缺少 selector' }
    const typed = await typeBrowserElement(browserId, selector, text)
    return { ok: Boolean(typed.ok), id, action, typed, ...(await pageSnap(browserId, false)) }
  }

  if (action === 'hover') {
    const hovered = await hoverBrowserElement(browserId, {
      selector: arg(args, 'selector', 'css') || undefined,
      text: arg(args, 'text') || undefined,
    })
    return { ok: Boolean(hovered.ok), id, action, hovered }
  }

  if (action === 'press') {
    const key = arg(args, 'key')
    if (!key) return { ok: false, id, action, error: '缺少 key' }
    const pressed = await pressBrowserKey(browserId, key)
    return { ok: Boolean(pressed.ok), id, action, pressed }
  }

  if (action === 'scroll') {
    const amount = num(args, 'amount') || 400
    const scrolled = await scrollBrowserView(browserId, amount)
    return { ok: Boolean(scrolled.ok), id, action, scrolled }
  }

  if (action === 'wait') {
    const waited = await waitFor(browserId, {
      ms: num(args, 'ms'),
      selector: arg(args, 'selector', 'css'),
      text: arg(args, 'text'),
      url: arg(args, 'url'),
    })
    return { id, action, ...waited, ...(await pageSnap(browserId, false)) }
  }

  if (action === 'screenshot') {
    return { ok: true, id, action, ...(await pageSnap(browserId, true)) }
  }

  if (action === 'snapshot') {
    const page = await readBrowserPage(browserId)
    return { ok: true, id, action, browserId, ...page }
  }

  if (action === 'eval') {
    const script = arg(args, 'script')
    if (!script) return { ok: false, id, action, error: '缺少 script' }
    const result = await evalBrowserViewMain(browserId, script)
    return { ok: true, id, action, browserId, result, ...(await pageSnap(browserId, false)) }
  }

  if (action === 'chapter') {
    const started = Date.now()
    const chapter = await parserSnap(browserId, true)
    return {
      ok: Boolean(chapter?.chapters?.length),
      id,
      action,
      browserId,
      ms: Date.now() - started,
      chapter,
    }
  }

  if (action === 'chapter_open') {
    const opened = await openPanelChapter(browserId, {
      title: arg(args, 'title'),
      index: arg(args, 'index'),
      chapterId: arg(args, 'chapterId'),
    })
    return { id, action, browserId, ...opened, chapter: await parserSnap(browserId, false) }
  }

  if (action === 'play') {
    const played = await playPanelStudy(browserId, {
      action: 'play',
      title: arg(args, 'title') || undefined,
      index: arg(args, 'index') || undefined,
      chapterId: arg(args, 'chapterId') || undefined,
      videoIndex: num(args, 'videoIndex') || undefined,
      label: arg(args, 'label') || undefined,
      skipIfDone: args.skipIfDone !== false,
    })
    return { id, action, browserId, ...played, chapter: await parserSnap(browserId, false) }
  }

  if (action === 'pause') {
    const paused = await playPanelStudy(browserId, { action: 'pause' })
    return { id, action, browserId, ...paused }
  }

  if (action === 'next') {
    const moved = await nextPanelStudy(browserId, { skipQuiz: args.skipQuiz === true })
    return { id, action, browserId, ...moved, chapter: await parserSnap(browserId, false) }
  }

  if (action === 'probe') {
    const tick = await readChaoxingVideoTick(browserId).catch(() => null)
    return { ok: Boolean(tick?.hasVideo), id, action, browserId, tick, chapter: await parserSnap(browserId, false) }
  }

  if (action === 'inspect') {
    const card = await homeworkOf(browserId, 'inspect', args)
    return { ok: true, id, action, browserId, card }
  }

  if (action === 'homework') {
    const hwAction = arg(args, 'action') || 'inspect'
    const card = await homeworkOf(browserId, hwAction, args)
    return { ok: true, id, action, browserId, homework: hwAction, card }
  }

  if (action === 'protocol') {
    const op = arg(args, 'op')
    if (!op) return { ok: false, id, action, error: '缺少 op' }
    const extra = (args.args && typeof args.args === 'object' && !Array.isArray(args.args))
      ? args.args as Record<string, unknown>
      : Object.fromEntries(Object.entries(args).filter(([key]) => !['op', 'args', 'browserId', 'id'].includes(key)))
    const { callProtocol } = await import('../browser/protocol')
    const result = await callProtocol(browserId, op, extra)
    return { ok: result.ok !== false, id, action, browserId, op, ...result }
  }

  if (action === 'captcha') {
    const code = arg(args, 'code', 'text')
    if (!code) return { ok: false, id, action, error: '缺少 code' }
    const filled = await fillChaoxingCaptcha(browserId, code)
    return { id, action, browserId, ...filled }
  }

  return { ok: false, id, action, error: `未知动作 ${action}` }
}
