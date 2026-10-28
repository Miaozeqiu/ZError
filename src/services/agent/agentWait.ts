import { evalBrowserViewInFrame, evalBrowserViewMainIdle, withSameFrames } from '../browser/eval'
import { peekAppBrowserUrl } from '../browser/appBrowser'
import { isWaitTruthy, waitForResponse } from '../browser/engine'
import { chapterStateFor, packAgentPanel, videoWatchFor } from '../platform/panelAccess'

export type AgentWaitUntil = 'panel' | 'url' | 'selector' | 'idle' | 'fn' | 'response'

export type AgentWaitResult = {
  ok: boolean
  reason: 'timeout' | 'panel' | 'watch' | 'captcha' | 'url' | 'selector' | 'idle' | 'fn' | 'response'
  waited: number
  until: AgentWaitUntil
  event?: string
  display?: string
  hint?: string
  url?: string
  already?: boolean
  panel?: ReturnType<typeof packAgentPanel>
  captchaImage?: string
}

export type AgentWaitInput = {
  sessionId: string
  browserId: string
  seconds: number
  wait: (ms: number) => Promise<void>
  until?: AgentWaitUntil | string
  url?: string
  selector?: string
  fn?: string
  response?: string
  frame?: string
  idleMs?: number
  onStart?: (sessionId: string) => void
  onPanel?: (panel: NonNullable<ReturnType<typeof packAgentPanel>>) => void
}

type Waiter = {
  browserId: string
  started: number
  until: AgentWaitUntil
  resolve: (result: AgentWaitResult) => void
}

const waiters = new Map<string, Waiter>()

/** 等宿主监控事件，不轮询页面、不占模型请求，也不另开一轮对话。 */
export const waitForAgentWatchEvent = (input: {
  sessionId: string; browserId: string; signal: AbortSignal; onStart?: () => void
}): Promise<AgentWaitResult> => new Promise((resolve, reject) => {
  const { sessionId, browserId, signal } = input
  if (signal.aborted) { reject(new DOMException('已停止', 'AbortError')); return }
  if (waiters.has(sessionId)) { reject(new Error('当前任务已有事件等待器')); return }
  const clean = () => {
    if (waiters.get(sessionId) === waiter) waiters.delete(sessionId)
    signal.removeEventListener('abort', stop)
  }
  const stop = () => { clean(); reject(new DOMException('已停止', 'AbortError')) }
  const waiter: Waiter = { browserId, started: Date.now(), until: 'panel', resolve: result => { clean(); resolve(result) } }
  waiters.set(sessionId, waiter)
  signal.addEventListener('abort', stop, { once: true })
  try { input.onStart?.() } catch (error) { clean(); reject(error) }
})

export const hasAgentWait = (sessionId: string) => waiters.has(sessionId)

export const panelNeedsTakeover = (panel: ReturnType<typeof packAgentPanel>) => (
  panel?.event === 'quiz_left'
  || panel?.event === 'chapter_jobs_done'
  || panel?.event === 'video_paused'
)

export const watchEndedTakeover = (browserId: string) => {
  const watch = videoWatchFor(browserId)
  if (!watch) return false
  if (watch.ended || watch.status === 'done') return true
  return watch.duration > 1 && watch.current >= watch.duration - 0.2
}

export const watchNeedsTakeover = (browserId: string) => {
  const watch = videoWatchFor(browserId)
  if (!watch) return false
  if (watch.ended || watch.status === 'done') return true
  return Boolean(watch.paused || watch.status === 'paused' || watch.status === 'stalled' || watch.status === 'lost')
}

const waitShouldFinish = (browserId: string, panel: ReturnType<typeof packAgentPanel>) => (
  panelNeedsTakeover(panel) || watchNeedsTakeover(browserId)
)

const normalizeUntil = (input: AgentWaitInput): AgentWaitUntil => {
  const raw = String(input.until || '').trim().toLowerCase()
  if (raw === 'url' || raw === 'selector' || raw === 'idle' || raw === 'panel' || raw === 'fn' || raw === 'response') return raw
  if (String(input.fn || '').trim()) return 'fn'
  if (String(input.response || '').trim()) return 'response'
  if (String(input.selector || '').trim()) return 'selector'
  if (String(input.url || '').trim()) return 'url'
  return 'panel'
}

const urlMatches = (href: string, pattern: string) => {
  const raw = String(pattern || '').trim()
  const current = String(href || '')
  if (!raw) return false
  if (/[\\^$[*+]/.test(raw)) {
    try {
      return new RegExp(raw, 'i').test(current)
    } catch {
      return current.toLowerCase().includes(raw.toLowerCase())
    }
  }
  return current.toLowerCase().includes(raw.toLowerCase())
}

const truthyEval = (value: unknown) => value === true || value === 'true' || value === 1

const cachedHref = (browserId: string) => (
  String(chapterStateFor(browserId)?.url || peekAppBrowserUrl(browserId) || '')
)

const selectorPresent = async (browserId: string, selector: string): Promise<boolean | null> => {
  const css = String(selector || '').trim()
  if (!css) return false
  const raw = await evalBrowserViewMainIdle(browserId, withSameFrames(`(function(){
    try { return Boolean(__findEl(${JSON.stringify(css)})); }
    catch (e) {
      try { return Boolean(document.querySelector(${JSON.stringify(css)})); }
      catch (e2) { return false; }
    }
  })()`)).catch(() => null)
  if (raw == null) return null
  return truthyEval(raw)
}

const topFrameIdle = async (browserId: string): Promise<boolean | null> => {
  const raw = await evalBrowserViewMainIdle(browserId, `(function(){
    try { return document.readyState === 'complete'; }
    catch (e) { return false; }
  })()`).catch(() => null)
  if (raw == null) return null
  return truthyEval(raw)
}

export const wakeAgentWait = (
  sessionId: string,
  extra: Omit<Partial<AgentWaitResult>, 'ok' | 'waited'> = {},
): boolean => {
  const waiter = waiters.get(sessionId)
  if (!waiter) return false
  const reason = extra.reason || (panelNeedsTakeover(extra.panel ?? packAgentPanel(waiter.browserId)) ? 'panel' : 'watch')
  if (waiter.until !== 'panel' && (reason === 'watch' || reason === 'panel')) return false
  waiters.delete(sessionId)
  const panel = extra.panel ?? packAgentPanel(waiter.browserId)
  waiter.resolve({
    ok: true,
    until: extra.until || waiter.until,
    reason,
    waited: Math.max(0, Math.round((Date.now() - waiter.started) / 1000)),
    event: extra.event || panel?.event,
    display: extra.display,
    hint: extra.hint || panel?.hint,
    url: extra.url || cachedHref(waiter.browserId),
    panel,
    captchaImage: extra.captchaImage,
  })
  return true
}

const snapshot = (
  browserId: string,
  started: number,
  extra: Omit<AgentWaitResult, 'ok' | 'waited'>,
): AgentWaitResult => ({
  ok: extra.reason !== 'timeout',
  waited: Math.max(0, Math.round((Date.now() - started) / 1000)),
  ...extra,
  url: extra.url || cachedHref(browserId),
  panel: extra.panel ?? packAgentPanel(browserId),
})

const tickMs = (until: AgentWaitUntil) => (
  until === 'panel' ? 1200 : until === 'fn' || until === 'response' ? 200 : until === 'url' ? 800 : 800
)

export const runAgentWait = async (input: AgentWaitInput): Promise<AgentWaitResult> => {
  const { sessionId, browserId, seconds, wait, onStart, onPanel } = input
  const until = normalizeUntil(input)
  const matchUrl = String(input.url || '').trim()
  const selector = String(input.selector || '').trim()
  const fn = String(input.fn || '').trim()
  const response = String(input.response || '').trim()
  const frame = String(input.frame || '').trim()
  const idleMs = Math.min(8000, Math.max(400, Number(input.idleMs) || 800))
  const started = Date.now()
  const deadline = started + seconds * 1000

  let settle: ((result: AgentWaitResult) => void) | null = null
  const woken = new Promise<AgentWaitResult>((resolve) => {
    settle = resolve
  })

  waiters.set(sessionId, {
    browserId,
    started,
    until,
    resolve: (result) => settle?.(result),
  })
  onStart?.(sessionId)

  const finish = (result: AgentWaitResult) => {
    waiters.delete(sessionId)
    if (result.panel && panelNeedsTakeover(result.panel)) onPanel?.(result.panel)
    return result
  }

  const takePanel = (panel: ReturnType<typeof packAgentPanel>) => {
    if (until !== 'panel' && until !== 'idle') return null
    const paused = waitShouldFinish(browserId, panel)
    if (!paused) return null
    const ended = watchEndedTakeover(browserId)
    return snapshot(browserId, started, {
      until,
      reason: panelNeedsTakeover(panel) ? 'panel' : 'watch',
      event: panelNeedsTakeover(panel) ? panel?.event : (ended ? 'video_done' : 'video_paused'),
      hint: panelNeedsTakeover(panel)
        ? panel?.hint
        : (ended
          ? '这段视频已经结束。'
          : '视频暂停或卡住了。'),
      panel,
    })
  }

  const startHref = cachedHref(browserId)
  let lastHref = startHref
  let idleSince = 0
  let readyOnce = false
  let probes = 0

  const probe = async (): Promise<AgentWaitResult | null> => {
    probes += 1
    const href = cachedHref(browserId)
    if (until === 'url' && matchUrl && urlMatches(href, matchUrl)) {
      const changed = href.split('#')[0] !== startHref.split('#')[0]
      if (!changed) {
        if (probes === 1) {
          return snapshot(browserId, started, {
            until,
            reason: 'url',
            url: href,
            already: true,
            hint: `开始时网址已经包含「${matchUrl}」，还没有发生跳转`,
            panel: packAgentPanel(browserId),
          })
        }
      } else {
        return snapshot(browserId, started, {
          until,
          reason: 'url',
          url: href,
          hint: `网址已变成 ${href}`,
          panel: packAgentPanel(browserId),
        })
      }
    }
    if (until === 'selector' && selector) {
      const hit = await selectorPresent(browserId, selector)
      if (hit) {
        return snapshot(browserId, started, {
          until,
          reason: 'selector',
          url: href,
          hint: `已出现 ${selector}`,
          panel: packAgentPanel(browserId),
        })
      }
    }
    if (until === 'fn' && fn) {
      const raw = frame
        ? await evalBrowserViewInFrame(browserId, fn, frame).catch(() => null)
        : await evalBrowserViewMainIdle(browserId, fn).catch(() => null)
      if (raw != null && isWaitTruthy(raw)) {
        return snapshot(browserId, started, {
          until,
          reason: 'fn',
          url: href,
          already: probes === 1,
          hint: probes === 1 ? '函数一开始就成立，没有等到变化' : '函数已成立',
          panel: packAgentPanel(browserId),
        })
      }
    }
    if (until === 'response' && response) {
      const hit = await waitForResponse(browserId, { url: response, timeout: 180, lookback: Date.now() - started + 8000 })
      if (hit.ok) {
        return snapshot(browserId, started, {
          until,
          reason: 'response',
          url: href,
          hint: `已等到 ${hit.response?.url || response}`,
          panel: packAgentPanel(browserId),
        })
      }
    }
    if (until === 'idle') {
      const ready = await topFrameIdle(browserId)
      if (ready === true) {
        if (!readyOnce || href !== lastHref) {
          readyOnce = true
          lastHref = href
          idleSince = Date.now()
        } else if (Date.now() - idleSince >= idleMs) {
          return snapshot(browserId, started, {
            until,
            reason: 'idle',
            url: href,
            hint: `页面已稳定 ${idleMs}ms`,
            panel: packAgentPanel(browserId),
          })
        }
      } else if (ready === false) {
        readyOnce = false
        idleSince = 0
      }
    }
    return takePanel(packAgentPanel(browserId))
  }

  try {
    const immediate = takePanel(packAgentPanel(browserId))
    if (immediate) return finish(immediate)

    // 先探一次，再睡一拍。probe 不能和 sleep 一起 race：没命中时它会立刻 resolve，
    // 循环变成微任务空转，WebContent 进程 100% CPU，整个侧栏假死。
    while (Date.now() < deadline) {
      const probed = await probe()
      if (probed) return finish(probed)
      const left = Math.min(tickMs(until), deadline - Date.now())
      if (left <= 0) break
      const raced = await Promise.race([
        woken.then((result) => ({ via: 'wake' as const, result })),
        wait(left).then(() => ({ via: 'tick' as const })),
      ])
      if (raced.via === 'wake') {
        waiters.delete(sessionId)
        if (raced.result.panel && panelNeedsTakeover(raced.result.panel)) {
          onPanel?.(raced.result.panel)
        }
        return { ...raced.result, until: raced.result.until || until }
      }
    }

    const last = packAgentPanel(browserId)
    const ready = takePanel(last)
    if (ready) return finish(ready)
    return finish(snapshot(browserId, started, {
      until,
      reason: 'timeout',
      url: cachedHref(browserId),
      event: last?.event,
      hint: until === 'url'
        ? `超时，当前网址未匹配 ${matchUrl || '目标'}`
        : until === 'selector'
          ? `超时，未出现 ${selector || '目标元素'}`
          : until === 'fn'
            ? '超时，函数还没成立'
            : until === 'response'
              ? `超时，没等到 ${response || '接口'}`
          : until === 'idle'
            ? '超时，页面还没稳定'
            : watchEndedTakeover(browserId)
              ? '这段视频已经结束。'
              : watchNeedsTakeover(browserId)
                ? '视频暂停或卡住了。'
                : '还在播或还没到等待条件。',
      panel: last,
    }))
  } catch (error) {
    waiters.delete(sessionId)
    throw error
  }
}
