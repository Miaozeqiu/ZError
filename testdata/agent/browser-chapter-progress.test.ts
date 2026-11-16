// @vitest-environment jsdom
import { effectScope, ref } from 'vue'
import { expect, it, vi } from 'vitest'

const mock = vi.hoisted(() => ({ read: vi.fn(), load: vi.fn(), frame: vi.fn(), tick: vi.fn(), video: vi.fn() }))
vi.mock('../../src/services/chaoxing/host/chapterTasks', async importOriginal => ({
  ...await importOriginal<typeof import('../../src/services/chaoxing/host/chapterTasks')>(),
  readStudentChapterCard: mock.read,
}))
vi.mock('../../src/services/browser/appBrowser', () => ({ listenBrowserLoad: mock.load }))
vi.mock('../../src/services/browser/pushEvents', () => ({ onBrowserFrame: mock.frame, onBrowserTick: mock.tick }))
vi.mock('../../src/services/platform/panelAccess', () => ({ videoWatchFor: mock.video }))
import { browserChapterContext, watchBrowserChapters } from '../../src/services/agent/browserChapterProgress'

it('publishes only current scoped summaries and refreshes on the next cards frame', async () => {
  vi.useFakeTimers()
  const scope = effectScope()
  const url = 'https://mooc1.chaoxing.com/mycourse/studentstudy?chapterId=2&courseId=3&clazzid=4'
  const target = ref({ url, sessionId: 'chat', browserId: 'tab' })
  const state = {
    identity: { href: url },
    header: { title: '论证', number: '2.3', remaining: 2, tab: 1 },
    jobs: [{ kind: 'video', name: '原视频', done: false, mid: 'm2' }],
  }
  mock.load.mockResolvedValue(() => {})
  mock.frame.mockReturnValue(() => {})
  mock.tick.mockReturnValue(() => {})
  mock.read.mockResolvedValue(state)
  mock.video.mockReturnValue({ sessionId: 'chat', mid: 'm2', status: 'watching', duration: 240, current: 31.5 })
  try {
    scope.run(() => watchBrowserChapters(() => target.value))
    await vi.advanceTimersByTimeAsync(0)
    const first = browserChapterContext('chat', 'tab', url)
    expect(first).toContain('"remaining":2')
    expect(first).toContain('"current":32')
    expect(first).not.toContain('m2')
    expect(browserChapterContext('other', 'tab', url)).toBe('')
    mock.read.mockResolvedValue({ ...state, header: { ...state.header, remaining: 1, tab: 2 }, jobs: [{ kind: 'quiz', name: '章测', done: false }] })
    mock.frame.mock.calls[0][1]('https://mooc1.chaoxing.com/mooc-ans/knowledge/cards?num=1')
    expect(browserChapterContext('chat', 'tab', url)).toBe('')
    await vi.advanceTimersByTimeAsync(800)
    expect(browserChapterContext('chat', 'tab', url)).toContain('"tab":2')
    expect(browserChapterContext('chat', 'tab', url)).not.toContain('"current"')
  } finally { scope.stop(); vi.useRealTimers() }
  expect(browserChapterContext('chat', 'tab', url)).toBe('')
})
