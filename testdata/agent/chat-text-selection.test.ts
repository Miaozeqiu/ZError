// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { readThreadSelection } from '../../src/utils/ui/threadSelection'
import { formatQuizAttempt } from '../../src/services/agent/quizAttemptText'

const state = vi.hoisted(() => ({} as Record<string, any>))
const clipboard = vi.hoisted(() => vi.fn())
const openReview = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeText: clipboard }))
vi.mock('../../src/services/agent/chat', async () => {
  const { ref } = await import('vue')
  state.chat = ref({ messages: [{ id: 'reply', role: 'assistant', content: 'First paragraph', status: 'done', steps: [] }] })
  state.id = ref('one')
  return { activeChat: state.chat, activeChatId: state.id, parseMessageParts: () => [], isFileAttachment: () => false, isImageAttachment: () => false }
})
vi.mock('../../src/views/agentChat/useAgentChatPanes', async () => ({
  openedWriteStepId: (await import('vue')).ref(null), fallbackQuizCards: () => [], isQuizOpen: () => false, openWrite: vi.fn(), toggleQuiz: vi.fn(),
  openQuizReview: openReview, quizCardForReview: () => ({ uid: 'q-1' }),
}))
vi.mock('../../src/views/agentChat/AgentChatFeatureCards.vue', () => ({ default: { render: () => null } }))
vi.mock('../../src/composables/useTheme', () => ({ themeState: { isDark: false } }))
vi.mock('../../src/views/agentChat/markdown', () => ({ default: { render: () => h('div', { class: 'markdown-renderer' }, [
  h('p', { id: 'first' }, 'First paragraph'),
  h('ul', [h('li', { id: 'second' }, ['Second ', h('a', { href: '#example' }, 'link'), ' line'])]),
  h('p', { id: 'last' }, 'Last paragraph'),
]) } }))
import AgentChatThread from '../../src/views/agentChat/AgentChatThread.vue'
let root: HTMLDivElement
let app: App
let following = true
const quote = vi.fn()
const ask = vi.fn()
const pointer = (target: Element) => {
  const event = new MouseEvent('pointerdown', { button: 0, bubbles: true, cancelable: true })
  target.dispatchEvent(event)
  return event
}
const select = (from: Node, to: Node, backwards = false) => {
  const selection = window.getSelection()!
  selection.removeAllRanges()
  selection.setBaseAndExtent(backwards ? to : from, backwards ? to.textContent!.length : 0, backwards ? from : to, backwards ? 0 : to.textContent!.length)
  document.dispatchEvent(new Event('selectionchange'))
  return selection
}
const thread = () => root.querySelector<HTMLElement>('.chat-thread')!
beforeEach(async () => {
  vi.clearAllMocks()
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
  following = true
  root = document.createElement('div'); document.body.append(root)
  app = createApp({ render: () => h(AgentChatThread, {
    showFeatureCards: false, fileManagerLabel: '文件', onQuote: quote, onAsk: ask,
    'onUpdate:pinned': (value: boolean) => { following = value },
  }) })
  app.mount(root)
  await vi.dynamicImportSettled()
  await nextTick()
})
afterEach(() => {
  app.unmount(); root.remove()
  // Vue's leave transition retains teleported menu DOM until the next frames.
  document.querySelectorAll('.context-menu').forEach(menu => menu.remove())
  window.getSelection()?.removeAllRanges(); vi.unstubAllGlobals()
})

describe('native chat text selection', () => {
  it('keeps forward/backward selections across paragraphs, links and tool blocks without cancelling native events', async () => {
    const activity = document.createElement('div'); activity.className = 'activity-entry'; activity.textContent = 'Read the page'
    root.querySelector('.assistant-turn')!.append(activity)
    const first = root.querySelector('#first')!.firstChild!
    const last = activity.firstChild!
    for (const backwards of [false, true]) {
      const selection = select(first, last, backwards)
      const text = readThreadSelection(thread())
      expect(text).toContain('First paragraph')
      expect(text).toContain('Second link line')
      expect(text).toContain('Read the page')
      expect(pointer(root.querySelector('#first')!).defaultPrevented).toBe(false)
      expect(selection.toString()).toBe(text)
      const event = new Event('selectstart', { bubbles: true, cancelable: true })
      root.querySelector('#first')!.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(false)
      expect(following).toBe(false)
    }
    const copy = new Event('copy', { bubbles: true, cancelable: true })
    thread().dispatchEvent(copy)
    expect(copy.defaultPrevented).toBe(false)
    expect(root.querySelector('.chat-selection')).toBeNull()
  })

  it.each(['复制', '引用', '提问'])('keeps the selected text for %s even when menu focus collapses the native range', async (label) => {
    const expected = select(root.querySelector('#first')!.firstChild!, root.querySelector('#last')!.firstChild!).toString()
    thread().dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }))
    await nextTick()
    const item = [...document.querySelectorAll<HTMLElement>('.context-menu .menu-item')].find(item => item.textContent?.trim() === label)!
    expect(item).toBeTruthy()
    window.getSelection()?.removeAllRanges()
    pointer(item); item.click(); await nextTick()
    expect(label === '复制' ? clipboard : label === '引用' ? quote : ask).toHaveBeenCalledWith(expected)
  })

  it('does not steal a selection from the composer or clear it when changing chats', async () => {
    const editor = document.createElement('div'); editor.contentEditable = 'true'; editor.textContent = 'Composer text'
    document.body.append(editor)
    select(editor.firstChild!, editor.firstChild!)
    expect(readThreadSelection(thread())).toBe('')
    const menu = new MouseEvent('contextmenu', { bubbles: true, cancelable: true })
    thread().dispatchEvent(menu)
    expect(menu.defaultPrevented).toBe(false)
    state.id.value = 'other'; await nextTick()
    expect(window.getSelection()?.toString()).toBe('Composer text')
    editor.remove()
  })
})

it('folds consecutive tool calls under the first row and keeps search results and interleaved text accessible', async () => {
  const content = '\n\nChecking the result.'
  const search = {
    id: 'search', kind: 'tool', name: 'web_search', label: '搜索', status: 'done', startedAt: 1, atContentLength: 0,
    result: JSON.stringify({ query: 'example', results: [{ title: 'Example result', url: 'https://example.com' }] }),
  }
  const read = { id: 'read', kind: 'tool', name: 'browser_get_page', label: '读取网页', status: 'done', startedAt: 2, atContentLength: 2 }
  const finish = { id: 'finish', kind: 'tool', name: 'browser_snapshot', label: '确认结果', status: 'done', startedAt: 3, atContentLength: content.length }
  state.chat.value = { messages: [{ id: 'grouped', role: 'assistant', content, status: 'done', steps: [search, read, finish] }] }
  await nextTick()
  const group = root.querySelector<HTMLButtonElement>('.is-group-toggle')!
  expect(group.textContent).toContain('2 次调用')
  expect(group.getAttribute('aria-expanded')).toBe('false')
  expect(thread().textContent).not.toContain('读取网页')
  expect(thread().textContent).toContain('确认结果')
  expect(root.querySelector('.assistant-text')).not.toBeNull()

  group.click()
  await nextTick()
  expect(group.getAttribute('aria-expanded')).toBe('true')
  expect(thread().textContent).toContain('读取网页')
  root.querySelector<HTMLButtonElement>('.activity-search-action')!.click()
  await nextTick()
  expect(thread().textContent).toContain('Example result')

  group.click()
  await nextTick()
  expect(thread().textContent).not.toContain('读取网页')
  expect(thread().textContent).not.toContain('Example result')
  expect(thread().textContent).toContain('确认结果')
})

it('shows collapsible reasoning with elapsed time and supports older messages without timing', async () => {
  state.chat.value = { messages: [
    { id: 'earlier', role: 'assistant', content: '答复', status: 'done', steps: [], reasoning: '旧记录' },
    { id: 'short', role: 'assistant', content: '答复', status: 'done', steps: [], reasoning: '简短思考', reasoningDurationMs: 12_500 },
    { id: 'long', role: 'assistant', content: '答复', status: 'done', steps: [], reasoning: '较长思考', reasoningDurationMs: 125_000 },
  ] }
  await nextTick()
  const toggles = [...root.querySelectorAll<HTMLButtonElement>('.reasoning-toggle')]
  expect(toggles.map(item => item.querySelector('span')?.textContent)).toEqual([
    '思考过程', '思考了 12s', '思考了 2 分 5 秒',
  ])
  expect(toggles.every(item => item.getAttribute('aria-expanded') === 'false')).toBe(true)
  const toggle = toggles[2]
  const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!
  expect(panel.hasAttribute('inert')).toBe(true)
  toggle.click()
  await nextTick()
  expect(toggle.getAttribute('aria-expanded')).toBe('true')
  expect(panel.classList.contains('is-open')).toBe(true)
  expect(panel.hasAttribute('inert')).toBe(false)
  toggle.click()
  await nextTick()
  expect(toggle.getAttribute('aria-expanded')).toBe('false')
  expect(panel.classList.contains('is-open')).toBe(false)
  expect(panel.hasAttribute('inert')).toBe(true)
})

it('shows concise cards for both saved and newly linked quiz answers', async () => {
  const attempt = {
    stepId: 'practice', uid: 'q-1', index: 1, total: 10, question: '下列哪一项正确？',
    options: 'A. 选项一\nB. 选项二', selected: 'A. 选项一', answer: 'B. 选项二', correct: false,
  }
  const target = { messageId: 'questions', stepId: attempt.stepId, uid: attempt.uid }
  const content = formatQuizAttempt(attempt)
  state.chat.value = { messages: [
    { id: 'questions', role: 'assistant', content: '', status: 'done', steps: [], quizAttempts: [attempt] },
    { id: 'old-review', role: 'user', content, status: 'done', steps: [] },
    { id: 'new-review', role: 'user', content, status: 'done', steps: [], quizAttemptRef: target },
  ] }
  await nextTick()
  const cards = root.querySelectorAll<HTMLButtonElement>('button.quiz-review')
  expect(cards).toHaveLength(2)
  for (const card of cards) {
    expect(card.textContent).toContain('回答错误')
    expect(card.textContent).toContain('参考答案')
    expect(card.textContent).not.toContain('请针对我这一题')
    expect(card.textContent).not.toContain('返回题目')
    card.querySelector<HTMLElement>('.quiz-review-question')!.click()
    expect(openReview).toHaveBeenLastCalledWith(target, attempt)
  }
  expect(openReview).toHaveBeenCalledTimes(2)
})

it('renders an option quote without a text bubble and opens its source question', async () => {
  const quote = {
    messageId: 'questions', stepId: 'practice', uid: 'q-1', key: 'B', text: '选项正文', question: '原题题干',
  }
  state.chat.value = { messages: [
    { id: 'quoted-option', role: 'user', content: '', status: 'done', steps: [], quizOptionQuotes: [quote] },
  ] }
  await nextTick()
  expect(root.querySelector('.user-bubble')).toBeNull()
  const reference = root.querySelector<HTMLButtonElement>('.quiz-option-reference-main')!
  expect(reference.textContent).toContain('选项 B')
  reference.click()
  expect(openReview).toHaveBeenCalledExactlyOnceWith(quote, quote)
})
