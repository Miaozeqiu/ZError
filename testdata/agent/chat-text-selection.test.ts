// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick, type App } from 'vue'
import { readThreadSelection } from '../../src/utils/ui/threadSelection'

const state = vi.hoisted(() => ({} as Record<string, any>))
const clipboard = vi.hoisted(() => vi.fn())
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ writeText: clipboard }))
vi.mock('../../src/services/agent/chat', async () => {
  const { ref } = await import('vue')
  state.chat = ref({ messages: [{ id: 'reply', role: 'assistant', content: 'First paragraph', status: 'done', steps: [] }] })
  state.id = ref('one')
  return { activeChat: state.chat, activeChatId: state.id, parseMessageParts: () => [], isFileAttachment: () => false, isImageAttachment: () => false }
})
vi.mock('../../src/views/agentChat/useAgentChatPanes', async () => ({
  openedWriteStepId: (await import('vue')).ref(null), fallbackQuizCards: () => [], isQuizOpen: () => false, openWrite: vi.fn(), toggleQuiz: vi.fn(),
}))
vi.mock('../../src/views/agentChat/AgentChatFeatureCards.vue', () => ({ default: { render: () => null } }))
vi.mock('../../src/composables/useTheme', () => ({ themeState: { isDark: false } }))
vi.mock('markstream-vue', () => ({ default: { render: () => h('div', { class: 'markdown-renderer' }, [
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
  app.mount(root); await nextTick()
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
