import { computed, nextTick, onMounted, onUnmounted, ref, watch, type Ref } from 'vue'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { useCustomScrollbar } from '../../composables/useCustomScrollbar'
import { createThreadScroll } from '../../utils/ui/threadScroll'
import { readThreadSelection, clearThreadSelection } from '../../utils/ui/threadSelection'
import { createThreadCodeHighlighter } from '../../utils/ui/threadCodeHighlight'
import type { MenuItem } from '../../components/ui/UnifiedContextMenu.vue'

/** Owns DOM observers, native selection and viewport following for one mounted thread. */
export function useThreadView(input: {
  chatId: Ref<string | null>; contentStamp: () => string; pinned: Ref<boolean>
  onReset: () => void; onQuote: (text: string) => void; onAsk: (text: string) => void
  onHideComposerMenu: () => void
}) {
// Chat must remain scrollable even while messages render. Keep wheel movement
// native; only observe intent in capture phase to suspend automatic following.
const threadScroll = useCustomScrollbar()
const threadRef = threadScroll.contentRef
const threadBarRef = threadScroll.barRef
const threadThumbRef = threadScroll.thumbRef

const scrollController = createThreadScroll(() => threadRef.value, (following) => {
  input.pinned.value = following
})
// Snapshot the native selection when opening the menu: clicking a menu item
// may collapse it before the action runs. Never substitute this for native copy.
let selectionMenuText = ''
const selectionMenuVisible = ref(false)
const selectionMenuX = ref(0)
const selectionMenuY = ref(0)

const selectedChatText = () => readThreadSelection(threadRef.value)

const selectionMenuItems = computed<MenuItem[]>(() => [
  { id: 'copy', label: '复制', action: 'copy' },
  { id: 'quote', label: '引用', action: 'quote' },
  { id: 'ask', label: '提问', action: 'ask' },
])

const hideSelectionMenu = () => {
  selectionMenuVisible.value = false
}

const writeClipboardText = async (text: string) => {
  try {
    await writeText(text)
  } catch {
    await navigator.clipboard.writeText(text)
  }
}

const onSelectionMenuClick = async (item: MenuItem) => {
  const text = selectionMenuText
  selectionMenuText = ''
  hideSelectionMenu()
  if (item.action === 'copy' && text) await writeClipboardText(text)
  if (item.action === 'quote' && text) input.onQuote(text)
  if (item.action === 'ask' && text) input.onAsk(text)
}

const onThreadContextMenu = (event: MouseEvent) => {
  const text = selectedChatText()
  if (!text) return
  event.preventDefault()
  selectionMenuText = text
  selectionMenuX.value = event.clientX
  selectionMenuY.value = event.clientY
  selectionMenuVisible.value = true
}

const onSelectionMenuPointerDown = (event: PointerEvent) => {
  if (event.button === 2) return
  if (event.target instanceof Element && event.target.closest('.context-menu')) return
  hideSelectionMenu()
  input.onHideComposerMenu()
}

const onSelectionMenuKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  hideSelectionMenu()
  input.onHideComposerMenu()
}

const onThreadPointerDown = (event: PointerEvent) => {
  if (event.button !== 0) return
  // Suspend pending bottom-follow writes before WebKit starts native selection.
  // Do not cancel the event, clear the selection or constrain it to one block.
  scrollController.hold()
}

const onThreadSelectionChange = () => {
  if (selectedChatText()) scrollController.hold()
}

let contentObserver: ResizeObserver | null = null
let childObserver: MutationObserver | null = null

const updateThreadPinned = () => {
  scrollController.observe()
  hideSelectionMenu()
}
const jumpThreadToBottom = () => scrollController.jump()
const scheduleThreadFollow = () => scrollController.changed()
const onThreadWheel = (event: WheelEvent) => {
  if (event.ctrlKey || event.metaKey || event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return
  scrollController.input(event.deltaY)
}
let touchY: number | null = null
const onThreadTouchStart = (event: TouchEvent) => {
  touchY = event.touches.length === 1 ? event.touches[0].clientY : null
  scrollController.hold()
}
const onThreadTouchMove = (event: TouchEvent) => {
  const next = event.touches.length === 1 ? event.touches[0].clientY : null
  if (touchY != null && next != null) scrollController.input(touchY - next)
  touchY = next
}
const onThreadScrollbarDown = (event: MouseEvent) => {
  scrollController.drag()
  threadScroll.onMousedown(event)
}
const onThreadNavigationKey = (event: KeyboardEvent) => {
  if (['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' '].includes(event.key)
    && event.target instanceof Element && threadRef.value?.contains(event.target)
    && !event.target.closest('input, textarea, [contenteditable="true"]')) {
    const upward = ['ArrowUp', 'PageUp', 'Home'].includes(event.key) || (event.key === ' ' && event.shiftKey)
    scrollController.input(upward ? -1 : 1)
  }
}

const codeHighlighter = createThreadCodeHighlighter(() => threadRef.value)
const scheduleHighlight = codeHighlighter.schedule

watch(input.chatId, async () => {
  input.onReset()
  scrollController.reset()
  input.pinned.value = true
  hideSelectionMenu()
  selectionMenuText = ''
  clearThreadSelection(threadRef.value)
  await nextTick()
  threadScroll.bind()
  scheduleHighlight()
  scheduleThreadFollow()
})

watch(
  input.contentStamp,
  async () => {
    await nextTick()
    scheduleHighlight()
    scheduleThreadFollow()
  }
)

const observeThreadGrowth = () => {
  const pane = threadRef.value
  if (!pane || typeof ResizeObserver === 'undefined') return
  contentObserver?.disconnect()
  childObserver?.disconnect()
  contentObserver = new ResizeObserver(() => {
    scheduleThreadFollow()
  })
  contentObserver.observe(pane)
  const observed = new Set<Element>()
  const watchChildren = () => {
    const children = new Set(pane.children)
    for (const child of observed) {
      if (!children.has(child)) { contentObserver?.unobserve(child); observed.delete(child) }
    }
    for (const child of children) {
      if (!observed.has(child)) { contentObserver?.observe(child); observed.add(child) }
    }
  }
  watchChildren()
  childObserver = new MutationObserver(watchChildren)
  childObserver.observe(pane, { childList: true })
}

onMounted(() => {
  document.addEventListener('keydown', onThreadNavigationKey, true)
  document.addEventListener('selectionchange', onThreadSelectionChange)
  threadScroll.bind()
  observeThreadGrowth()
  scheduleHighlight()
  void nextTick(() => {
    scheduleThreadFollow()
  })
  document.addEventListener('pointerdown', onSelectionMenuPointerDown, true)
  document.addEventListener('keydown', onSelectionMenuKeydown)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onThreadNavigationKey, true)
  document.removeEventListener('selectionchange', onThreadSelectionChange)
  contentObserver?.disconnect()
  childObserver?.disconnect()
  contentObserver = null
  childObserver = null
  scrollController.dispose()
  codeHighlighter.dispose()
  document.removeEventListener('pointerdown', onSelectionMenuPointerDown, true)
  document.removeEventListener('keydown', onSelectionMenuKeydown)
})

return { threadRef, threadBarRef, threadThumbRef, threadScroll, selectedChatText, selectionMenuVisible, selectionMenuX, selectionMenuY, selectionMenuItems, onSelectionMenuClick, onThreadContextMenu, hideSelectionMenu, onThreadPointerDown, updateThreadPinned, jumpThreadToBottom, onThreadWheel, onThreadTouchStart, onThreadTouchMove, onThreadScrollbarDown }
}
