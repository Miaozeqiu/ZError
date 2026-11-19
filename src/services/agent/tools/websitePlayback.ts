import { callProtocol } from '../../browser/protocol'
import { evalBrowserViewMain } from '../../browser/eval'
import type { BrowserLocator } from '../../browser/engine'
import { userControlsBrowser } from '../../browser/control'
import { nativeWatchFor, parseNativeTick, startNativeWatch, stopNativeWatch } from '../../browser/videoWatch'
import { runWebsiteWorkflow } from '../websiteScripts'
import mediaPage from '../../browser/websiteMediaPage.js?raw'

type Video = { id: string; title: string; complete: boolean; locked: boolean }
type Catalog = { course: string; origin: string; keys: string[]; active: string; videos: Video[] }
type Rules = {
  routes: string[][]; optionalSegments: number
  root: string; dialogs: string; tabs: string; panelAttribute: string; panelPrefix: string
  active: string; disabled: string; videoTab: string; completedTab: string; player: string
}
const validateRules = (value: unknown): Rules => {
  const rules = value as Rules | null
  const fields = ['root', 'dialogs', 'tabs', 'panelAttribute', 'panelPrefix', 'active', 'disabled', 'videoTab', 'completedTab', 'player'] as const
  if (!rules || fields.some(key => typeof rules[key] !== 'string' || rules[key].length > 512)
    || !Array.isArray(rules.routes) || !rules.routes.length || rules.routes.length > 8
    || rules.routes.some(route => !Array.isArray(route) || route.length > 15
      || route.some(part => typeof part !== 'string' || !/^(?:[a-zA-Z0-9_-]{1,64}|:group|:resource)$/.test(part))
      || route.filter(part => part === ':group').length !== 1 || route.filter(part => part === ':resource').length !== 1)
    || !Number.isSafeInteger(rules.optionalSegments) || rules.optionalSegments < 0 || rules.optionalSegments > 2) {
    throw new Error('网站播放脚本返回了无效的课件页面规则。')
  }
  return rules
}
type Context = {
  browserId: string; sessionId: string; args: Record<string, unknown>; role?: string
  actOnceOnBrowser: (id: string, locator: BrowserLocator, op: 'click') => Promise<{ dispatched: boolean }>
  syncPeekedUrl?: (id: string, url: string) => void
  wait: (ms: number) => Promise<void>
}

// Some CC players mount their media in a cross-origin iframe. Resolve only the
// frame identified inside the active pane and pin its document during playback.
function resourceReader(browserId: string, inspect: (op: string, target: object) => Promise<any>, target: object) {
  let frame: { url: string; path: string; locator: BrowserLocator } | undefined
  return async (op: 'play' | 'tick') => {
    const state = await inspect(op, target)
    if (!state?.frameUrl) return frame ? { error: '视频框已变化。' } : state
    if (!frame) {
      const page = await callProtocol(browserId, 'snapshot', { maxFrames: 12 })
      const matches = Array.isArray(page.frames) ? page.frames.filter(row =>
        row.url === state.frameUrl && row.framePath === state.framePath && row.frameId && row.loaderId) : []
      if (matches.length !== 1) return { error: '无法确认当前页签的内嵌播放器。' }
      const { frameId, loaderId } = matches[0]
      frame = { url: state.frameUrl, path: state.framePath, locator: { by: 'css', value: 'video', nth: 1, frameId, loaderId } }
    }
    if (frame.url !== state.frameUrl || frame.path !== state.framePath) return { error: '视频框已变化。' }
    const tick = await callProtocol(browserId, 'media_tick', { locator: frame.locator })
    return { ...tick, clickLocator: frame.locator }
  }
}

export async function playWebsiteVideos(
  host: string, site: string,
  { browserId, sessionId, args, role, wait, actOnceOnBrowser, syncPeekedUrl }: Context,
) {
  const fail = (error: string, ended: string[] = []) => JSON.stringify({ ok: false, error, ended })
  const mode = args.mode ?? 'current'
  const title = typeof args.title === 'string' ? args.title.trim() : ''
  if (role === 'explore' || !['current', 'section'].includes(String(mode)) ||
    Object.keys(args).some(k => k !== 'mode' && k !== 'title') || (args.title !== undefined && !title) || (mode === 'section' && title)) {
    return fail('请选择当前视频、指定视频名称或本小节连续播放。')
  }
  let rules: Rules | undefined
  const inspect = (op: string, target?: object) =>
    evalBrowserViewMain(browserId, '(' + mediaPage + ')(' + [host, rules, op, target ?? null].map(value => JSON.stringify(value)).join(',') + ')')
  const checkControl = async (ms: number) => {
    await wait(ms)
    if (userControlsBrowser(sessionId)) throw new DOMException('用户已接管浏览器', 'AbortError')
  }
  const ended: string[] = []
  let activeWatch: number | undefined
  const cleanup = () => {
    const watch = nativeWatchFor(browserId)
    if (activeWatch !== undefined && watch?.sessionId === sessionId && watch.startedAt === activeWatch) stopNativeWatch(browserId)
  }
  try {
    let catalog: Catalog | undefined
    let expected: Video[] | undefined
    let from: string | undefined
    let playing: Record<string, unknown> | undefined
    const result = await runWebsiteWorkflow(host, site, 'playback', { mode, title }, async (command, run) => {
      rules ??= validateRules(run({ operation: 'page_rules' }))
      const action = command as { op?: unknown; id?: unknown; delay?: unknown }
      if (action?.op === 'catalog' && expected === undefined) {
        const delay = action.delay === 250 ? 250 : 0
        await checkControl(delay)
        const page = await inspect('list')
        if (Array.isArray(page?.videos)) {
          catalog = page as Catalog
          from = catalog.active
          expected = catalog.videos.filter(video => mode === 'section' ? !video.complete : title ? video.title === title : video.id === catalog!.active)
        }
        if (!catalog) return page
        return { videos: catalog.videos, active: catalog.active }
      }
      const item = expected?.[ended.length]
      const reject = (error: string) => ({ ok: false, error })
      if (action?.op !== 'play' || !catalog || !item || playing || action.id !== item.id
        || (mode !== 'section' && expected?.length !== 1)) {
        return reject('网站播放请求与当前课件或授权范围不一致。')
      }
      await checkControl(0)
      if (item.locked) return reject('「' + item.title + '」已锁定。')
      const target = { course: catalog.course, origin: catalog.origin, keys: catalog.keys, from, id: item.id }
      const selected = await inspect('select', target)
      if (!selected?.selected) return reject(selected?.error || '未能选中视频页签。')
      const readResource = resourceReader(browserId, inspect, target)
      let requested = false
      let clickedPlay = false
      let baseline: number | undefined
      let source: string | undefined
      let hasEnded = false
      for (let i = 0; i < 36; i++) {
        await checkControl(i ? 250 : 0)
        const raw = await readResource(requested ? 'tick' : 'play')
        if (raw?.error) return reject(String(raw.error))
        const tick = parseNativeTick(raw)
        if (!tick?.hasVideo) continue
        requested = true
        const clickLocator = raw.clickLocator ?? (raw.clickSelector && { by: 'css', value: raw.clickSelector })
        if (!clickedPlay && clickLocator && tick.paused && !tick.ended) {
          await checkControl(0)
          clickedPlay = true
          const click = await actOnceOnBrowser(browserId, clickLocator, 'click')
          if (!click.dispatched) return reject('浏览器要求点击播放，请在当前视频上点击播放。')
        }
        if (tick.ended) { hasEnded = true; break }
        if (source !== tick.src || baseline === undefined) { source = tick.src; baseline = tick.current }
        if (tick.paused || tick.current <= baseline + 0.05) continue
        const readTick = async () => {
          const next = parseNativeTick(await readResource('tick'))
          return next?.hasVideo && next.src === source ? next : null
        }
        const watch = startNativeWatch(browserId, sessionId, { ...tick, title: item.title }, { readTick, handledByTool: mode === 'section' })
        if (!watch) return reject('未能登记播放监控。')
        activeWatch = watch.startedAt
        if (mode !== 'section') {
          const page = await inspect('list')
          if (page?.course !== catalog.course || page?.origin !== catalog.origin || page?.active !== item.id) {
            cleanup()
            return reject('播放页签已变化。')
          }
          syncPeekedUrl?.(browserId, page.url)
          playing = { ok: true, scope: mode, url: page.url, playing: true, watching: true, startedAt: watch.startedAt, title: item.title }
          return { ok: true, playing: true }
        }
        for (;;) {
          await checkControl(500)
          const live = nativeWatchFor(browserId)
          if (!live || live.sessionId !== sessionId || live.startedAt !== watch.startedAt) return reject('播放监控已停止或被替换。')
          if (live.status === 'lost' || live.status === 'stalled') {
            cleanup()
            return reject('「' + item.title + '」的播放器已切换、暂停或卡住。')
          }
          if (live.status === 'done') break
        }
        hasEnded = true
        cleanup()
        break
      }
      if (!hasEnded) return reject('未确认「' + item.title + '」开始播放，请核对页面中的播放按钮。')
      ended.push(item.title)
      from = item.id
      return { ok: true }
    })
    if (playing) return JSON.stringify(playing)
    const status = result as { done?: unknown; error?: unknown } | null
    if (status?.done !== true || !catalog || ended.length !== expected?.length) {
      return fail(typeof status?.error === 'string' ? status.error.slice(0, 300) : '网站播放流程未完成。', ended)
    }
    const last = await inspect('list')
    if (last?.course !== catalog.course || last?.origin !== catalog.origin || last?.active !== from || JSON.stringify(last?.keys) !== JSON.stringify(catalog.keys)) {
      return fail('播放结束时小节已变化，请核对当前页面。', ended)
    }
    syncPeekedUrl?.(browserId, last.url)
    return JSON.stringify({ ok: true, scope: mode, playbackEnded: true, url: last.url, watching: false, ended, skippedCompleted: mode === 'section' ? catalog.videos.filter(v => v.complete).length : 0 })
  } catch (error) {
    cleanup()
    if ((error instanceof DOMException && error.name === 'AbortError') || String(error).includes('BROWSER_USER_CONTROL')) throw error
    return fail(error instanceof Error ? error.message : '读取播放器失败，请核对当前页面。', ended)
  }
}
