import { pageRules } from './fixtures/courseHomeworkRules'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { effectScope, nextTick, ref } from 'vue'

const browser = vi.hoisted(() => ({
  read: vi.fn(), onChanged: vi.fn(), onLoad: vi.fn(), record: vi.fn(),
}))
vi.mock('../../src/services/agent/websiteScripts', () => ({
  runWebsiteScript: async (_host: string, _site: string, _capability: string, _input: unknown, validate: (value: unknown) => unknown) =>
    ({ result: validate(pageRules), revision: 'test' }),
}))
vi.mock('../../src/services/browser/eval', () => ({ evalBrowserViewMainIdle: browser.read }))
vi.mock('../../src/services/browser/appBrowser', () => ({ listenBrowserLoad: browser.onLoad }))
vi.mock('../../src/services/browser/pushEvents', () => ({ onHomeworkChanged: browser.onChanged }))
vi.mock('../../src/services/agent/chatStore', () => ({
  liveSession: () => ({ messages: [] }), sessionIsStreaming: () => false, recordHomeworkProgress: browser.record,
}))

import { watchBrowserHomework } from '../../src/services/agent/browserHomeworkProgress'

const url = 'https://mooc1.chaoxing.com/mooc-ans/mooc2/work/dowork?courseId=42&classId=7&workId=11'
const target = { sessionId: 'chat', browserId: 'tab', url }
const question = (order: number, selected: boolean) => ({
  id: `q-${order}`, order, number: order, stem: `题目 ${order}`, type: 'single', issue: null,
  options: [{ label: 'A', text: '选项', selected }], blanks: [],
})

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  browser.onLoad.mockResolvedValue(vi.fn())
  browser.onChanged.mockReturnValue(vi.fn())
})
afterEach(() => vi.useRealTimers())

it('reads a manually opened page and syncs later input without an Agent turn', async () => {
  let answered = false
  browser.read.mockImplementation(async (_id, script) => {
    const offset = /return readCourseHomework\(document, (\d+),/.exec(script)?.[1]
    const first = Number(offset) + 1
    const questions = Array.from({ length: Math.min(32, 35 - first) }, (_, i) => question(first + i, answered && i === 0))
    return { url, total: 34, documentTime: 1, questions }
  })
  const open = vi.fn()
  const current = ref<typeof target | null>(null)
  const scope = effectScope()
  scope.run(() => watchBrowserHomework(() => current.value, open))
  try {
    current.value = target
    await nextTick()
    await vi.advanceTimersByTimeAsync(1)
    expect(open).toHaveBeenCalledExactlyOnceWith('42:7:11')
    expect(browser.record.mock.calls.map(([, messageId, update]) => [messageId, update.questions.length])).toEqual([[undefined, 32], [undefined, 2]])

    answered = true
    browser.onChanged.mock.calls[0][1]()
    await vi.advanceTimersByTimeAsync(800)
    expect(browser.record).toHaveBeenLastCalledWith('chat', undefined, expect.objectContaining({
      questions: expect.arrayContaining([expect.objectContaining({ order: 1, status: 'answered', actual: { choices: ['A'] } })]),
    }))
    expect(open).toHaveBeenCalledOnce()
  } finally {
    scope.stop()
  }
})

it('discards an in-flight read after the user switches conversations', async () => {
  let resolve!: (page: unknown) => void
  browser.read.mockImplementation(() => new Promise(done => { resolve = done }))
  const current = ref<typeof target | null>(target)
  const open = vi.fn()
  const scope = effectScope()
  scope.run(() => watchBrowserHomework(() => current.value, open))
  try {
    await vi.advanceTimersByTimeAsync(1)
    current.value = null
    await nextTick()
    resolve({ url, total: 1, questions: [question(1, false)] })
    await vi.advanceTimersByTimeAsync(1)
    expect(browser.record).not.toHaveBeenCalled()
    expect(open).not.toHaveBeenCalled()
  } finally {
    scope.stop()
  }
})
