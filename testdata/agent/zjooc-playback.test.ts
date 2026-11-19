import { JSDOM } from 'jsdom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { chaoxingStartup } from '../../src/services/agent/chaoxingStartup'
import { playZjoocVideos } from '../../src/services/agent/tools/zjoocPlayback'
import { evalBrowserViewMain } from '../../src/services/browser/eval'
import { nativeWatchFor, resetNativeWatches } from '../../src/services/browser/videoWatch'
import { assembleRoleTools } from '../../src/services/agent/subagent/tools'

vi.mock('../../src/services/agent/websiteScripts', () => ({
  runWebsiteScript: async (_host: string, _site: string, capability: string, input: any, validate: (value: unknown) => unknown) => {
    let result: unknown
    if (capability === 'homework') result = input.questions.map((q: any) => ({ index: q.index, action: !q.supported ? 'needs_review' : q.answered ? 'existing_answer' : 'resolve' }))
    else if (capability === 'playback') result = input.videos.filter((video: any) => input.mode === 'section' ? !video.complete : input.title ? video.title === input.title : video.id === input.active).map((video: any) => video.id)
    else if (_site === 'chaoxing') result = input.kind === 'space' ? 'logged_in' : input.kind === 'challenge' ? 'verify'
      : input.host !== 'passport2.chaoxing.com' ? input.kind === 'loading' ? 'wait' : 'open_space'
      : input.kind === 'form' && input.modern && input.frameReady ? 'fill' : ['passport', 'form'].includes(input.kind) ? 'open_form' : 'wait'
    else result = input.kind === 'space' ? 'logged_in' : input.kind === 'form' && input.atForm && input.frameReady ? 'fill' : input.kind === 'guest' && input.atHome ? 'open_form' : 'wait'
    return { result: validate(result), revision: 'fixture' }
  },
}))
vi.mock('../../src/services/agent/websiteRepository', async original => ({
  ...await original<typeof import('../../src/services/agent/websiteRepository')>(),
  installedExperienceHost: (host: string) => host,
  websiteToolsForHost: (host: string) => host === 'chaoxing.com'
    ? [{ type: 'function', function: { name: 'browser_login_chaoxing' } }]
    : host === 'zjooc.cn' ? ['browser_login_zjooc', 'browser_play_zjooc'].map(name => ({ type: 'function', function: { name } })) : [],
}))
vi.mock('../../src/services/browser/eval', async original => ({
  ...await original<typeof import('../../src/services/browser/eval')>(), evalBrowserViewMain: vi.fn(),
}))

const base = 'https://www.zjooc.cn/ucenter/student/course/study/course/plan/detail/'
const ctx = (args: Record<string, string>) => ({
  args, browserId: 'b', sessionId: 's', actOnceOnBrowser: vi.fn(),
  wait: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)),
})

function fixture() {
  const ids = ['doc', 'done', 'first', 'second']
  const dom = new JSDOM('<div class="plan-detailvideo"><div class="el-tabs__header">' + ids.map(id =>
    '<button role="tab" aria-controls="pane-' + id + '"><i class="' + (id === 'doc' ? 'icon-file' : 'icon-shipin') + (id === 'done' ? ' complete' : '') + '"></i>' + id + '</button>').join('') +
    '</div>' + ids.map(id => '<div id="pane-' + id + '"><div class="contain-video"><video></video></div></div>').join('') + '</div>',
    { url: base + 'doc', runScripts: 'outside-only' })
  const w = dom.window
  const history: string[] = []
  const started = new Map<string, number>()
  Object.defineProperty(w.Element.prototype, 'getClientRects', { value() { return [{}] } })
  const tabs = [...w.document.querySelectorAll('button')]
  for (const [i, id] of ids.entries()) {
    const tab = tabs[i]!
    tab.setAttribute('aria-selected', String(!i))
    tab.onclick = () => {
      history.push(id)
      tabs.forEach(el => el.setAttribute('aria-selected', String(el === tab)))
      dom.reconfigure({ url: base + id })
    }
    const video = w.document.querySelector('#pane-' + id + ' video')!
    const time = () => started.has(id) ? Math.min(2, (Date.now() - started.get(id)!) / 1000) : 0
    Object.defineProperties(video, {
      play: { value: async () => { started.set(id, Date.now()) } },
      paused: { get: () => !started.has(id) || time() === 2 }, ended: { get: () => time() === 2 },
      duration: { value: 2 }, currentTime: { get: time }, currentSrc: { value: 'blob:' + id },
    })
  }
  vi.mocked(evalBrowserViewMain).mockImplementation(async (_id, js) => w.eval(js))
  return { dom, history, started }
}

describe('在浙学视频页签播放', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => { resetNativeWatches(); vi.useRealTimers() })
  it('registers a playback tool for execution roles only', () => {
    expect(chaoxingStartup('连续播放本小节', base + 'x')).toEqual({ name: 'browser_play_zjooc', args: { mode: 'section' } })
    expect(chaoxingStartup('连续播放本小节', 'about:blank')).toBeUndefined()
    for (const role of ['explore', 'execute', 'parent'] as const) {
      expect(assembleRoleTools({ role, url: 'https://www.zjooc.cn' }).some(t => t.function.name === 'browser_play_zjooc')).toBe(role !== 'explore')
    }
  })
  it('advances only after each video ends and skips complete and document tabs', async () => {
    const { history } = fixture()
    const job = playZjoocVideos(ctx({ mode: 'section' }))
    await vi.advanceTimersByTimeAsync(1750)
    expect(history).toEqual(['first'])
    await vi.advanceTimersByTimeAsync(7000)
    expect(JSON.parse(await job)).toMatchObject({ ok: true, ended: ['first', 'second'], skippedCompleted: 1 })
    expect(history).toEqual(['first', 'second'])
    expect(nativeWatchFor('b')).toBeNull()
  })
  it('starts a named video, refuses a foreign page and leaves unrelated videos alone', async () => {
    const { dom, history } = fixture()
    const start = playZjoocVideos(ctx({ title: 'second' }))
    await vi.advanceTimersByTimeAsync(800)
    expect(JSON.parse(await start)).toMatchObject({ playing: true, watching: true, title: 'second' })
    dom.reconfigure({ url: 'https://example.test/ucenter/student/course/study/course/plan/detail/second' })
    const invalid = playZjoocVideos(ctx({ mode: 'section' }))
    await vi.advanceTimersByTimeAsync(50)
    expect(JSON.parse(await invalid).ok).toBe(false)
    expect(history).toEqual(['second'])
  })
  it('stops a section run when the user changes the active resource', async () => {
    const { dom, history } = fixture()
    const task = playZjoocVideos(ctx({ mode: 'section' }))
    await vi.advanceTimersByTimeAsync(800)
    dom.window.document.querySelector('button')!.click()
    await vi.advanceTimersByTimeAsync(19000)
    expect(JSON.parse(await task)).toMatchObject({ ok: false, ended: [] })
    expect(history).toEqual(['first', 'doc'])
  })
})
