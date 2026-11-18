import { callProtocol } from '../../browser/protocol'
import { evalBrowserViewMain } from '../../browser/eval'
import type { BrowserLocator } from '../../browser/engine'
import { userControlsBrowser } from '../../browser/control'
import { nativeWatchFor, parseNativeTick, startNativeWatch, stopNativeWatch } from '../../browser/videoWatch'
import playbackPage from '../../platform/zjooc/playbackPage.js?raw'

type Video = { id: string; title: string; complete: boolean; locked: boolean }
type Catalog = { course: string; keys: string[]; active: string; videos: Video[] }
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

export async function playZjoocVideos({ browserId, sessionId, args, role, wait, actOnceOnBrowser, syncPeekedUrl }: Context) {
  const fail = (error: string, ended: string[] = []) => JSON.stringify({ ok: false, error, ended })
  const mode = args.mode ?? 'current'
  const title = typeof args.title === 'string' ? args.title.trim() : ''
  if (role === 'explore' || !['current', 'section'].includes(String(mode)) ||
    Object.keys(args).some(k => k !== 'mode' && k !== 'title') || (args.title !== undefined && !title) || (mode === 'section' && title)) {
    return fail('请选择当前视频、指定视频名称或本小节连续播放。')
  }
  const inspect = (op: string, target?: object) =>
    evalBrowserViewMain(browserId, '(' + playbackPage + ')(' + JSON.stringify(op) + ',' + JSON.stringify(target ?? null) + ')')
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
    for (let i = 0; i < 24; i++) {
      await checkControl(i ? 250 : 0)
      const page = await inspect('list')
      if (page?.error) return fail(String(page.error))
      if (Array.isArray(page?.videos)) { catalog = page; break }
    }
    if (!catalog) return fail('小节的视频页签尚未就绪。')
    const items = catalog.videos.filter(v => mode === 'section' ? !v.complete : title ? v.title === title : v.id === catalog.active)
    if (mode !== 'section' && items.length !== 1) return fail(title ? '请核对视频名称，当前小节没有唯一匹配。' : '当前页签不是视频，请指定本小节的视频名称。')
    if (!catalog.videos.length) return fail('当前小节没有视频课件。')
    let from = catalog.active
    for (const item of items) {
      await checkControl(0)
      if (item.locked) return fail('「' + item.title + '」已锁定。', ended)
      const target = { course: catalog.course, keys: catalog.keys, from, id: item.id }
      const selected = await inspect('select', target)
      if (!selected?.selected) return fail(selected?.error || '未能选中视频页签。', ended)
      const readResource = resourceReader(browserId, inspect, target)
      let requested = false
      let clickedPlay = false
      let baseline: number | undefined
      let source: string | undefined
      let hasEnded = false
      for (let i = 0; i < 36; i++) {
        await checkControl(i ? 250 : 0)
        const raw = await readResource(requested ? 'tick' : 'play')
        if (raw?.error) return fail(String(raw.error), ended)
        const tick = parseNativeTick(raw)
        if (!tick?.hasVideo) continue
        requested = true
        const clickLocator = raw.clickLocator ?? (raw.clickSelector && { by: 'css', value: raw.clickSelector })
        if (!clickedPlay && clickLocator && tick.paused && !tick.ended) {
          await checkControl(0)
          clickedPlay = true
          const click = await actOnceOnBrowser(browserId, clickLocator, 'click')
          if (!click.dispatched) return fail('浏览器要求点击播放，请在当前视频上点击播放。', ended)
        }
        if (tick.ended) { hasEnded = true; break }
        if (source !== tick.src || baseline === undefined) { source = tick.src; baseline = tick.current }
        if (tick.paused || tick.current <= baseline + 0.05) continue
        const readTick = async () => {
          const next = parseNativeTick(await readResource('tick'))
          return next?.hasVideo && next.src === source ? next : null
        }
        const watch = startNativeWatch(browserId, sessionId, { ...tick, title: item.title }, { readTick, handledByTool: mode === 'section' })
        if (!watch) return fail('未能登记播放监控。', ended)
        activeWatch = watch.startedAt
        if (mode !== 'section') {
          const page = await inspect('list')
          if (page?.course !== catalog.course || page?.active !== item.id) {
            cleanup()
            return fail('播放页签已变化。')
          }
          syncPeekedUrl?.(browserId, page.url)
          return JSON.stringify({ ok: true, scope: mode, url: page.url, playing: true, watching: true, startedAt: watch.startedAt, title: item.title })
        }
        for (;;) {
          await checkControl(500)
          const live = nativeWatchFor(browserId)
          if (!live || live.sessionId !== sessionId || live.startedAt !== watch.startedAt) return fail('播放监控已停止或被替换。', ended)
          if (live.status === 'lost' || live.status === 'stalled') {
            cleanup()
            return fail('「' + item.title + '」的播放器已切换、暂停或卡住。', ended)
          }
          if (live.status === 'done') break
        }
        hasEnded = true
        cleanup()
        break
      }
      if (!hasEnded) return fail('未确认「' + item.title + '」开始播放，请核对页面中的播放按钮。', ended)
      ended.push(item.title)
      from = item.id
    }
    const last = await inspect('list')
    if (last?.course !== catalog.course || last?.active !== from || JSON.stringify(last?.keys) !== JSON.stringify(catalog.keys)) {
      return fail('播放结束时小节已变化，请核对当前页面。', ended)
    }
    syncPeekedUrl?.(browserId, last.url)
    return JSON.stringify({ ok: true, scope: mode, playbackEnded: true, url: last.url, watching: false, ended, skippedCompleted: mode === 'section' ? catalog.videos.filter(v => v.complete).length : 0 })
  } catch (error) {
    cleanup()
    if ((error instanceof DOMException && error.name === 'AbortError') || String(error).includes('BROWSER_USER_CONTROL')) throw error
    return fail('读取在浙学播放器失败，请核对当前页面。', ended)
  }
}
