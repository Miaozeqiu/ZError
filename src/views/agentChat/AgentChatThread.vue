<template>
  <div class="chat-thread-root">
        <div class="chat-thread-wrap">
          <div
            ref="threadRef"
            class="chat-thread"
            @scroll.passive="updateThreadPinned"
            @wheel.passive="onThreadWheel"
            @pointerdown="onThreadPointerDown"
            @contextmenu.prevent="onThreadContextMenu"
          >
            <AgentChatFeatureCards
              v-if="showFeatureCards"
              :active-subject-id="activeChat?.studySubjectId"
              @import="emit('import')"
              @organize="emit('organize')"
              @explain="emit('explain')"
              @quiz="emit('quiz')"
              @graph="emit('graph')"
            />
            <div
              v-for="message in activeChat?.messages || []"
              :key="message.id"
              class="chat-turn"
              :class="`is-${message.role}`"
            >
              <div v-if="message.role === 'user'" class="user-turn">
                <div v-if="imagesForMessage(activeChat, message).length" class="user-images">
                  <template v-for="item in imagesForMessage(activeChat, message)" :key="item.filePath">
                    <img
                      v-if="item.imageUrl"
                      class="user-image"
                      :src="item.imageUrl"
                      :alt="item.fileName"
                      title="预览图片"
                      @click="emit('preview-image', item)"
                    />
                    <div v-else class="user-image is-missing">图片</div>
                  </template>
                </div>
                <div v-if="filesForMessage(activeChat, message).length" class="user-files">
                  <div
                    v-for="item in filesForMessage(activeChat, message)"
                    :key="item.filePath"
                    class="user-file"
                    :class="{ 'is-openable': isDiskPath(item.filePath) }"
                    :title="isDiskPath(item.filePath) ? fileManagerLabel : item.fileName"
                    @click="emit('reveal-file', item.filePath)"
                  >
                    <span class="user-file-icon" :class="'is-' + fileTypeOf(item.fileName)">
                      {{ fileTypeLabel(item.fileName) }}
                    </span>
                    <span class="user-file-name">{{ item.fileName }}</span>
                  </div>
                </div>
                <div v-if="message.content" class="user-bubble">
                  <template v-for="(part, partIndex) in parseMessageParts(message.content)" :key="partIndex">
                    <span v-if="part.type === 'folder'" class="folder-mention">
                      <span class="folder-mention-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                        </svg>
                      </span>
                      <span class="folder-mention-name">{{ part.folderName }}</span>
                    </span>
                    <template v-else>{{ part.text }}</template>
                  </template>
                </div>
              </div>
              <div v-else class="assistant-turn">
                <div
                  v-for="step in visibleSteps(message.steps)"
                  :key="step.id"
                  class="activity-entry"
                >
                  <div class="activity-line" :class="[`is-${step.status}`]">
                    <span class="activity-icon" aria-hidden="true">
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <path v-for="(d, index) in iconPaths(step.name)" :key="index" :d="d" />
                      </svg>
                    </span>
                    <span class="activity-text" :class="{ 'is-live': step.status === 'running' }">{{ step.label }}</span>
                  </div>
                  <p v-if="step.status === 'failed' && step.detail" class="activity-detail">{{ step.detail }}</p>

                  <div
                    v-if="isQuizStep(step)"
                    class="write-block is-quiz"
                    :class="{ 'is-open': isQuizOpen(message.id, step.id) }"
                  >
                    <button class="write-head" type="button" @click="toggleQuiz(message.id, step.id)">
                      <span class="write-file">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                          <circle cx="12" cy="12" r="9" />
                          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.25c-.7.4-1.1.9-1.1 1.75" />
                          <path d="M12 17h.01" />
                        </svg>
                        <span class="write-file-name">{{ quizTitleFor(step) }}</span>
                      </span>
                      <span class="write-stat">{{ quizStatFor(message, step.id, quizCardsFor(step), isBrowseQuizStep(step)) }}</span>
                    </button>
                  </div>

                  <div
                    v-if="step.name === 'save_questions' && step.preview?.length"
                    class="write-block"
                    :class="{ 'is-running': step.status === 'running', 'is-open': openedWriteStepId === step.id }"
                  >
                    <button class="write-head" type="button" @click="openWrite(step.id)">
                      <span class="write-file">
                        <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                          <path d="M14 2v6h6" />
                        </svg>
                        {{ activeChat.attachments?.[0]?.folderName || '题库' }}
                      </span>
                      <span class="write-stat">+{{ step.previewCount || step.preview.length }}</span>
                    </button>
                    <div class="write-body">
                      <div
                        v-for="(item, index) in visiblePreview(step)"
                        :key="`${step.id}-${index}`"
                        class="write-item"
                      >
                        <span class="write-gutter">+</span>
                        <div class="write-question">
                          <div class="write-q-top">
                            <span class="write-index">{{ index + 1 }}</span>
                            <span
                              v-if="item.question_type"
                              class="write-type"
                              :class="`is-${typeTagKind(item.question_type)}`"
                            >
                              {{ item.question_type }}
                            </span>
                          </div>
                          <div class="write-stem">{{ item.question }}</div>
                          <div v-if="parseOptions(item.options).length" class="write-options">
                            <div
                              v-for="option in parseOptions(item.options)"
                              :key="`${step.id}-${index}-${option.key}-${option.text}`"
                              class="write-option"
                            >
                              <span v-if="option.key" class="write-opt-key">{{ option.key }}</span>
                              <span class="write-opt-text">{{ option.text }}</span>
                            </div>
                          </div>
                          <div v-if="item.answer" class="write-answer">
                            <span class="write-answer-label">答案</span>
                            <span class="write-answer-text">{{ item.answer }}</span>
                          </div>
                        </div>
                      </div>
                      <div class="write-fade">
                        <button class="write-more" type="button" @click="openWrite(step.id)">
                          查看所有 {{ step.previewCount || step.preview.length }} 道
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                <div
                  v-if="fallbackQuizCards(message).length"
                  class="write-block is-quiz"
                  :class="{ 'is-open': isQuizOpen(message.id, `${message.id}-md`) }"
                >
                  <button class="write-head" type="button" @click="toggleQuiz(message.id, `${message.id}-md`)">
                    <span class="write-file">
                      <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                        <circle cx="12" cy="12" r="9" />
                        <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.25c-.7.4-1.1.9-1.1 1.75" />
                        <path d="M12 17h.01" />
                      </svg>
                      <span class="write-file-name">{{ quizTitleFor(undefined, `${message.id}-md`) }}</span>
                    </span>
                    <span class="write-stat">{{ quizStatFor(message, `${message.id}-md`, fallbackQuizCards(message)) }}</span>
                  </button>
                </div>

                <div
                  v-if="displayAssistantContent(message)"
                  class="assistant-text"
                  :class="{ dark: themeState.isDark }"
                >
                  <MarkdownRender
                    :key="message.id"
                    custom-id="agent-chat"
                    mode="chat"
                    :content="displayAssistantContent(message)"
                    :final="message.status !== 'streaming'"
                    :index-key="message.id"
                    :max-live-nodes="0"
                    :fade="false"
                    :smooth-streaming="message.status === 'streaming'"
                    :typewriter="false"
                    html-policy="safe"
                    :render-code-blocks-as-pre="true"
                    :d2-props="{ progressiveRender: true, progressiveIntervalMs: 450 }"
                  />
                </div>
                <div v-if="isThinking(message)" class="assistant-thinking">
                  正在思考
                </div>
                <div v-if="message.status === 'stopped'" class="chat-stopped">已停止生成</div>
                <div v-if="message.error" class="chat-error">{{ message.error }}</div>
              </div>
            </div>
            <div class="chat-thread-spacer" aria-hidden="true"></div>
          </div>
          <div class="chat-selection" aria-hidden="true">
            <i
              v-for="(box, index) in selectionBoxes"
              :key="index"
              class="chat-selection-box"
              :style="{
                transform: `translate(${box.left}px, ${box.top}px)`,
                width: `${box.width}px`,
                height: `${box.height}px`,
              }"
            />
          </div>
          <div
            class="custom-scrollbar"
            :class="{ 'is-visible': threadScroll.visible }"
            ref="threadBarRef"
            @mousedown="threadScroll.onMousedown"
          >
            <div class="custom-scrollbar-thumb" ref="threadThumbRef"></div>
          </div>
          </div>

    <UnifiedContextMenu
      :visible="selectionMenuVisible"
      :x="selectionMenuX"
      :y="selectionMenuY"
      :menu-items="selectionMenuItems"
      exclusive-key="agent-chat-selection-menu"
      @item-click="onSelectionMenuClick"
      @close="selectionMenuVisible = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { activeChat, activeChatId, parseMessageParts } from '../../services/agent/chat'
import { themeState } from '../../composables/useTheme'
import { useCustomScrollbar } from '../../composables/useCustomScrollbar'
import { hljs } from '../../utils/ui/highlightSetup'
import { fileTypeLabel, fileTypeOf } from '../../utils/ui/fileKind'
import { parseOptions } from '../../utils/question/quizPractice'
import UnifiedContextMenu, { type MenuItem } from '../../components/ui/UnifiedContextMenu.vue'
import MarkdownRender from 'markstream-vue'
import AgentChatFeatureCards from './AgentChatFeatureCards.vue'
import {
  displayAssistantContent,
  filesForMessage,
  iconPaths,
  imagesForMessage,
  isBrowseQuizStep,
  isQuizStep,
  isThinking,
  quizCardsFor,
  quizStatFor,
  quizTitleFor,
  typeTagKind,
  visiblePreview,
  visibleSteps,
} from './threadDisplay'
import {
  fallbackQuizCards,
  isQuizOpen,
  openWrite,
  openedWriteStepId,
  toggleQuiz,
} from './useAgentChatPanes'

defineProps<{
  showFeatureCards: boolean
  fileManagerLabel: string
}>()

const threadPinned = defineModel<boolean>('pinned', { default: true })

const emit = defineEmits<{
  import: []
  organize: []
  explain: []
  quiz: []
  graph: []
  'preview-image': [item: { imageUrl?: string; fileName?: string; filePath?: string }]
  'reveal-file': [filePath: string]
  quote: [text: string]
  ask: [text: string]
  'hide-composer-menu': []
}>()

const isDiskPath = (path?: string) => {
  const value = String(path || '').trim()
  return Boolean(value) && !value.startsWith('image:') && !value.startsWith('folder:') && !value.startsWith('data:')
}

const threadScroll = useCustomScrollbar()
const threadRef = threadScroll.contentRef
const threadBarRef = threadScroll.barRef
const threadThumbRef = threadScroll.thumbRef

const THREAD_PIN_PX = 72
let threadScrollFrame = 0
let threadJumping = false
let threadJumpAnim = 0
let threadSettleAnim = 0
let threadSettleDeadline = 0
const selectionBoxes = ref<{ left: number; top: number; width: number; height: number }[]>([])
let customSelectionRange: Range | null = null
let selectionAnchor: Range | null = null
let selectionDragging = false
let selectionMoved = false
let selectionStartX = 0
let selectionStartY = 0
let lastFocusRange: Range | null = null
let selectionScopeEl: Element | null = null
const selectionMenuVisible = ref(false)
const selectionMenuX = ref(0)
const selectionMenuY = ref(0)

const selectedChatText = () => (customSelectionRange?.toString() || '').replace(/\u200B/g, '').trim()

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

const copySelectedChatText = async () => {
  const text = selectedChatText()
  if (!text) return
  await writeClipboardText(text)
}

const onSelectionMenuClick = async (item: MenuItem) => {
  hideSelectionMenu()
  const text = selectedChatText()
  if (item.action === 'copy') await copySelectedChatText()
  if (item.action === 'quote' && text) emit('quote', text)
  if (item.action === 'ask' && text) emit('ask', text)
}

const onThreadContextMenu = (event: MouseEvent) => {
  if (!selectedChatText()) return
  selectionMenuX.value = event.clientX
  selectionMenuY.value = event.clientY
  selectionMenuVisible.value = true
}

const onSelectionMenuPointerDown = (event: PointerEvent) => {
  if (event.button === 2) return
  if (event.target instanceof Element && event.target.closest('.context-menu')) return
  hideSelectionMenu()
  emit('hide-composer-menu')
}

const onSelectionMenuKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  hideSelectionMenu()
  emit('hide-composer-menu')
}

const SELECTION_CHROME = 'button, input, textarea, select, .write-head, .chat-item-delete, .agent-d2-zoom, .chat-selection'
const SELECTION_BLOCKS = [
  'pre',
  'table',
  'img',
  '.mermaid-block-container',
  '.d2-block-container',
  '.infographic-block-container',
  '.agent-html',
  '.agent-html-preview',
  '.katex-display',
].join(',')
const SELECTION_VISUAL_BLOCKS = [
  'img',
  '.mermaid-block-container',
  '.d2-block-container',
  '.infographic-block-container',
  '.agent-html',
  '.agent-html-preview',
  '.katex-display',
].join(',')
const SELECTION_INLINES = 'code, .katex, img, a, strong, em, .strong-node, .emphasis-node'

const selectionHostOf = (node: Node | null) => {
  const el = node instanceof Element ? node : node?.parentElement
  return el?.closest('.assistant-text, .user-bubble, .activity-text') || null
}

const isChromeNode = (node: Node | null) => {
  const el = node instanceof Element ? node : node?.parentElement
  return Boolean(el?.closest(SELECTION_CHROME))
}

const specialBlockOf = (node: Node | null) => {
  const el = node instanceof Element ? node : node?.parentElement
  return el?.closest(SELECTION_BLOCKS) || null
}

const isSelectableText = (node: Node) => {
  if (node.nodeType !== Node.TEXT_NODE || !/\S/.test(node.textContent || '')) return false
  if (isChromeNode(node)) return false
  if (node.parentElement?.closest('svg, canvas')) return false
  return true
}

const isThreadSelectableTarget = (target: EventTarget | null) => {
  const el = target instanceof Element ? target : null
  if (!el) return false
  if (el.closest(`${SELECTION_CHROME}, .composer-box, .user-image, .user-file`)) return false
  return Boolean(el.closest('.assistant-text, .user-bubble, .activity-text'))
}

const offsetInTextNode = (node: Text, x: number, y: number) => {
  let low = 0
  let high = node.length
  while (low < high) {
    const mid = (low + high) >> 1
    const probe = document.createRange()
    probe.setStart(node, mid)
    probe.setEnd(node, Math.min(mid + 1, node.length))
    const rect = probe.getClientRects()[0]
    if (!rect) {
      high = mid
      continue
    }
    if (rect.bottom < y - 1) low = mid + 1
    else if (rect.top > y + 1) high = mid
    else if (rect.right < x) low = mid + 1
    else high = mid
  }
  return low
}

const nativeCaretAt = (x: number, y: number) => {
  const doc = document as Document & {
    caretRangeFromPoint?: (x: number, y: number) => Range | null
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null
  }
  if (typeof doc.caretRangeFromPoint === 'function') {
    try {
      return doc.caretRangeFromPoint(x, y)
    } catch {
      return null
    }
  }
  const pos = doc.caretPositionFromPoint?.(x, y)
  if (!pos) return null
  const range = document.createRange()
  try {
    range.setStart(pos.offsetNode, pos.offset)
    range.collapse(true)
    return range
  } catch {
    return null
  }
}

const snapToBlockEdge = (block: Element, y: number) => {
  const box = block.getBoundingClientRect()
  const range = document.createRange()
  if (y < box.top + box.height / 2) range.setStartBefore(block)
  else range.setStartAfter(block)
  range.collapse(true)
  return range
}

const caretRangeAt = (x: number, y: number) => {
  const scope = selectionScopeEl
  if (!scope) return null
  const hit = document.elementFromPoint(x, y)
  const hitBlock = hit && scope.contains(hit) ? hit.closest(SELECTION_BLOCKS) : null
  const native = nativeCaretAt(x, y)
  if (native && scope.contains(native.startContainer)) {
    const block = specialBlockOf(native.startContainer) || hitBlock
    const inChrome = isChromeNode(native.startContainer) || Boolean(native.startContainer.parentElement?.closest('svg, canvas'))
    const inVisual = Boolean(block && block.matches(SELECTION_VISUAL_BLOCKS) && !isSelectableText(native.startContainer))
    if (block && scope.contains(block) && (inChrome || inVisual)) {
      return snapToBlockEdge(block, y)
    }
    return native
  }
  if (hitBlock && scope.contains(hitBlock) && hitBlock.matches(SELECTION_VISUAL_BLOCKS)) {
    return snapToBlockEdge(hitBlock, y)
  }

  const lines: { node: Text; top: number; bottom: number; left: number; right: number }[] = []
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
  let current: Node | null
  while ((current = walker.nextNode())) {
    if (!isSelectableText(current)) continue
    const probe = document.createRange()
    probe.selectNodeContents(current)
    for (const rect of probe.getClientRects()) {
      if (rect.width < 1 || rect.height < 6 || rect.height > 40) continue
      lines.push({
        node: current as Text,
        top: rect.top,
        bottom: rect.bottom,
        left: rect.left,
        right: rect.right,
      })
    }
  }
  if (!lines.length) return null
  lines.sort((a, b) => a.top - b.top || a.left - b.left)

  let chosen = lines[0]
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const next = lines[index + 1]
    if (y <= line.bottom) {
      chosen = line
      break
    }
    if (!next) {
      chosen = line
      break
    }
    if (y < (line.bottom + next.top) / 2) {
      chosen = line
      break
    }
    chosen = next
  }

  const inLine = y >= chosen.top && y <= chosen.bottom
  const caretX = inLine ? x : y > chosen.bottom ? Number.POSITIVE_INFINITY : 0
  const caretY = Math.min(chosen.bottom - 1, Math.max(chosen.top + 1, y))
  const range = document.createRange()
  range.setStart(chosen.node, offsetInTextNode(chosen.node, caretX, caretY))
  range.collapse(true)
  return range
}

const lineLikeRects = (rects: DOMRect[]) => {
  const usable = rects.filter((rect) => rect.width >= 1 && rect.height >= 6)
  if (!usable.length) return []
  const heights = [...usable.map((rect) => rect.height)].sort((a, b) => a - b)
  const mid = heights[Math.floor(heights.length / 2)] || 18
  return usable.filter((rect) => rect.height <= Math.max(40, mid * 2.2))
}

const collectTextRects = (range: Range) => {
  const ancestor = range.commonAncestorContainer
  const root = ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentNode : ancestor
  if (!root) return []
  const rects: DOMRect[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (!isSelectableText(node) || !range.intersectsNode(node)) continue
    const length = node.textContent?.length || 0
    const start = node === range.startContainer ? range.startOffset : 0
    const end = node === range.endContainer ? range.endOffset : length
    if (end <= start) continue
    const piece = document.createRange()
    try {
      piece.setStart(node, Math.max(0, start))
      piece.setEnd(node, Math.min(length, end))
      rects.push(...Array.from(piece.getClientRects()))
    } catch {
      // skip detached nodes
    }
  }
  const host = root instanceof Element ? root : root.parentElement
  host?.querySelectorAll(SELECTION_INLINES).forEach((el) => {
    if (isChromeNode(el) || el.closest(SELECTION_BLOCKS) || !range.intersectsNode(el)) return
    const box = el.getBoundingClientRect()
    if (box.width >= 2 && box.height >= 6 && box.height <= 40) rects.push(box)
  })
  return lineLikeRects(rects)
}

const mergeSelectionRects = (
  rects: { left: number; top: number; width: number; height: number }[]
) => {
  const sorted = [...rects].sort((a, b) => a.top - b.top || a.left - b.left)
  const merged: typeof rects = []
  for (const rect of sorted) {
    const last = merged.at(-1)
    if (
      last &&
      Math.abs(rect.top - last.top) <= 3 &&
      rect.left <= last.left + last.width + 16
    ) {
      const right = Math.max(last.left + last.width, rect.left + rect.width)
      last.left = Math.min(last.left, rect.left)
      last.width = right - last.left
      last.height = Math.max(last.height, rect.height)
      continue
    }
    merged.push({ ...rect })
  }
  return merged
}

const rangeIsLive = (range: Range) =>
  document.contains(range.startContainer) && document.contains(range.endContainer)

const paintCustomSelection = (range: Range | null) => {
  const root = threadRef.value
  if (!root || !range || range.collapsed || !rangeIsLive(range)) {
    customSelectionRange = null
    if (selectionBoxes.value.length) selectionBoxes.value = []
    return
  }
  customSelectionRange = range
  const rootRect = root.getBoundingClientRect()
  selectionBoxes.value = mergeSelectionRects(
    collectTextRects(range)
      .filter((rect) => rect.width >= 2 && rect.height >= 6)
      .map((rect) => ({
        left: rect.left - rootRect.left - 1,
        top: rect.top - rootRect.top,
        width: rect.width + 2,
        height: rect.height,
      }))
  )
}

let selectionPaintFrame = 0
let selectionResizeObs: ResizeObserver | null = null

const scheduleSelectionPaint = () => {
  if (!customSelectionRange || selectionPaintFrame) return
  selectionPaintFrame = requestAnimationFrame(() => {
    selectionPaintFrame = 0
    if (customSelectionRange) paintCustomSelection(customSelectionRange)
  })
}

const bindSelectionLayout = () => {
  selectionResizeObs?.disconnect()
  const thread = threadRef.value
  if (!thread) return
  selectionResizeObs = new ResizeObserver(() => scheduleSelectionPaint())
  selectionResizeObs.observe(thread)
  const main = thread.closest('.chat-main')
  if (main) selectionResizeObs.observe(main)
}

const clearCustomSelection = () => {
  selectionAnchor = null
  lastFocusRange = null
  selectionScopeEl = null
  selectionDragging = false
  selectionMoved = false
  hideSelectionMenu()
  paintCustomSelection(null)
  window.getSelection()?.removeAllRanges()
}

const updateCustomSelection = (x: number, y: number) => {
  if (!selectionAnchor) return
  const focus = caretRangeAt(x, y) || lastFocusRange
  if (!focus) return
  lastFocusRange = focus
  try {
    const range = document.createRange()
    const startFirst = selectionAnchor.compareBoundaryPoints(Range.START_TO_START, focus) <= 0
    if (startFirst) {
      range.setStart(selectionAnchor.startContainer, selectionAnchor.startOffset)
      range.setEnd(focus.startContainer, focus.startOffset)
    } else {
      range.setStart(focus.startContainer, focus.startOffset)
      range.setEnd(selectionAnchor.startContainer, selectionAnchor.startOffset)
    }
    window.getSelection()?.removeAllRanges()
    paintCustomSelection(range)
  } catch {
    // keep the last painted range while dragging through empty space
  }
}

const onThreadPointerDown = (event: PointerEvent) => {
  if (event.button !== 0) return
  if (!isThreadSelectableTarget(event.target)) {
    if (!(event.target instanceof Element) || !event.target.closest('.chat-selection')) {
      clearCustomSelection()
    }
    return
  }
  window.getSelection()?.removeAllRanges()
  selectionScopeEl = event.target instanceof Node ? selectionHostOf(event.target) : null
  selectionAnchor = caretRangeAt(event.clientX, event.clientY)
  selectionStartX = event.clientX
  selectionStartY = event.clientY
  selectionDragging = Boolean(selectionAnchor)
  selectionMoved = false
  hideSelectionMenu()
  paintCustomSelection(null)
}

const onThreadPointerMove = (event: PointerEvent) => {
  if (!selectionDragging || !selectionAnchor) return
  if (Math.hypot(event.clientX - selectionStartX, event.clientY - selectionStartY) > 3) {
    selectionMoved = true
  }
  updateCustomSelection(event.clientX, event.clientY)
}

const onThreadPointerUp = () => {
  if (selectionDragging && !selectionMoved) paintCustomSelection(null)
  selectionDragging = false
  selectionAnchor = selectionMoved ? selectionAnchor : null
}

const onCopyCustomSelection = (event: ClipboardEvent) => {
  const active = document.activeElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) return
  if (window.getSelection()?.toString()) return
  const text = customSelectionRange?.toString()
  if (!text) return
  event.preventDefault()
  event.clipboardData?.setData('text/plain', text)
}

const onThreadSelectStart = (event: Event) => {
  if (isThreadSelectableTarget(event.target)) event.preventDefault()
}

const isThreadNearBottom = (pane: HTMLElement) =>
  pane.scrollHeight - pane.clientHeight - pane.scrollTop <= THREAD_PIN_PX

const updateThreadPinned = () => {
  if (threadJumping) return
  const pane = threadRef.value
  threadPinned.value = !pane || isThreadNearBottom(pane)
  hideSelectionMenu()
  scheduleSelectionPaint()
}

const cancelThreadJump = () => {
  if (!threadJumping) return
  cancelAnimationFrame(threadJumpAnim)
  threadJumping = false
  threadJumpAnim = 0
}

const snapThreadToBottom = () => {
  const pane = threadRef.value
  if (!pane) return
  pane.scrollTop = pane.scrollHeight
  threadScroll.update()
}

const jumpThreadToBottom = () => {
  threadPinned.value = true
  const pane = threadRef.value
  if (!pane) return
  const start = pane.scrollTop
  const distance = () => pane.scrollHeight - pane.clientHeight - start
  if (distance() <= 2) {
    snapThreadToBottom()
    return
  }
  cancelThreadJump()
  threadJumping = true
  const startedAt = performance.now()
  const duration = Math.min(420, Math.max(220, distance() * 0.35))
  const step = (now: number) => {
    const target = pane.scrollHeight - pane.clientHeight
    const t = Math.min(1, (now - startedAt) / duration)
    const eased = 1 - (1 - t) ** 3
    pane.scrollTop = start + (target - start) * eased
    threadScroll.update()
    if (t < 1) {
      threadJumpAnim = requestAnimationFrame(step)
      return
    }
    threadJumping = false
    threadJumpAnim = 0
    threadPinned.value = true
  }
  threadJumpAnim = requestAnimationFrame(step)
}

const scrollThreadToBottom = () => {
  if (!threadPinned.value) return
  snapThreadToBottom()
}

const cancelThreadSettle = () => {
  threadSettleDeadline = 0
  if (!threadSettleAnim) return
  cancelAnimationFrame(threadSettleAnim)
  threadSettleAnim = 0
}

// 历史会话的 Markdown、代码高亮、图片会在挂载后继续撑高内容，
// 只贴底一次会停在半空，所以持续贴底直到高度不再变化。
const settleThreadToBottom = (duration = 900) => {
  if (!threadRef.value) return
  threadSettleDeadline = performance.now() + duration
  if (threadSettleAnim) return
  let lastHeight = -1
  const step = () => {
    threadSettleAnim = 0
    const pane = threadRef.value
    if (!pane || !threadPinned.value) {
      threadSettleDeadline = 0
      return
    }
    if (pane.scrollHeight !== lastHeight) {
      lastHeight = pane.scrollHeight
      snapThreadToBottom()
    }
    if (performance.now() >= threadSettleDeadline) {
      threadSettleDeadline = 0
      return
    }
    threadSettleAnim = requestAnimationFrame(step)
  }
  threadSettleAnim = requestAnimationFrame(step)
}

const onThreadWheel = () => {
  cancelThreadJump()
  cancelThreadSettle()
}

const scheduleThreadFollow = () => {
  if (!threadPinned.value || threadScrollFrame) return
  threadScrollFrame = requestAnimationFrame(() => {
    threadScrollFrame = 0
    scrollThreadToBottom()
  })
}

const CODE_LANG_LABELS: Record<string, string> = {
  bash: 'Bash',
  c: 'C',
  cpp: 'C++',
  csharp: 'C#',
  css: 'CSS',
  go: 'Go',
  html: 'HTML',
  java: 'Java',
  javascript: 'JavaScript',
  js: 'JavaScript',
  json: 'JSON',
  markdown: 'Markdown',
  md: 'Markdown',
  python: 'Python',
  py: 'Python',
  rust: 'Rust',
  sh: 'Shell',
  shell: 'Shell',
  sql: 'SQL',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  xml: 'XML',
  yaml: 'YAML',
  yml: 'YAML',
}

const resolveCodeLang = (el: HTMLElement, pre: Element | null) => {
  const attr = pre?.getAttribute('data-language') || el.getAttribute('data-language') || ''
  if (attr) return attr.toLowerCase()
  const match = `${pre?.className || ''} ${el.className}`.match(/(?:^|\s)language-([a-z0-9+#_-]+)/i)
  return match?.[1]?.toLowerCase() || ''
}

const formatCodeLang = (lang: string) => CODE_LANG_LABELS[lang] || lang

const decorateCodeLang = (el: HTMLElement, pre: HTMLElement | null, lang: string) => {
  if (!pre || !lang) return
  pre.dataset.language = lang
  pre.dataset.langLabel = formatCodeLang(lang)
  el.classList.add(`language-${lang}`)
}

const highlightThreadCode = () => {
  const root = threadRef.value
  if (!root) return
  root.querySelectorAll('.assistant-text pre code').forEach((block) => {
    const el = block as HTMLElement
    if (el.closest('.d2-block-container, .mermaid-block-container, .infographic-block-container')) return
    const pre = el.closest('pre') as HTMLElement | null
    const lang = resolveCodeLang(el, pre)
    if (lang === 'd2' || lang === 'd2lang' || lang === 'mermaid' || lang === 'infographic') return
    decorateCodeLang(el, pre, lang)

    const source = el.textContent || ''
    if (!source.trim()) return
    if (el.dataset.hlSource === source && el.dataset.highlighted === 'yes') return

    delete el.dataset.highlighted
    el.classList.remove('hljs')
    try {
      el.innerHTML = lang && hljs.getLanguage(lang)
        ? hljs.highlight(source, { language: lang, ignoreIllegals: true }).value
        : hljs.highlightAuto(source).value
      el.dataset.highlighted = 'yes'
      el.dataset.hlSource = source
      el.classList.add('hljs')
    } catch {
      // keep plain text
    }
  })
  scheduleSelectionPaint()
}

const scheduleHighlight = () => {
  requestAnimationFrame(() => highlightThreadCode())
}

watch(activeChatId, async () => {
  openedWriteStepId.value = null
  cancelThreadJump()
  cancelThreadSettle()
  threadPinned.value = true
  clearCustomSelection()
  await nextTick()
  threadScroll.bind()
  scheduleHighlight()
  snapThreadToBottom()
  settleThreadToBottom()
})

watch(
  () => {
    const last = activeChat.value?.messages.at(-1)
    return last
      ? `${activeChat.value?.messages.length}:${last.id}:${last.content.length}:${last.steps.length}:${last.status}`
      : '0'
  },
  async () => {
    await nextTick()
    scheduleHighlight()
    scheduleThreadFollow()
  }
)

onMounted(() => {
  threadScroll.bind()
  bindSelectionLayout()
  scheduleHighlight()
  void nextTick(() => {
    snapThreadToBottom()
    settleThreadToBottom()
  })
  document.addEventListener('pointermove', onThreadPointerMove)
  document.addEventListener('pointerup', onThreadPointerUp)
  document.addEventListener('pointerdown', onSelectionMenuPointerDown, true)
  document.addEventListener('copy', onCopyCustomSelection)
  document.addEventListener('selectstart', onThreadSelectStart)
  document.addEventListener('keydown', onSelectionMenuKeydown)
  window.addEventListener('resize', scheduleSelectionPaint)
})

onUnmounted(() => {
  cancelThreadSettle()
  if (threadScrollFrame) cancelAnimationFrame(threadScrollFrame)
  if (selectionPaintFrame) cancelAnimationFrame(selectionPaintFrame)
  selectionResizeObs?.disconnect()
  selectionResizeObs = null
  document.removeEventListener('pointermove', onThreadPointerMove)
  document.removeEventListener('pointerup', onThreadPointerUp)
  document.removeEventListener('pointerdown', onSelectionMenuPointerDown, true)
  document.removeEventListener('copy', onCopyCustomSelection)
  document.removeEventListener('selectstart', onThreadSelectStart)
  document.removeEventListener('keydown', onSelectionMenuKeydown)
  window.removeEventListener('resize', scheduleSelectionPaint)
})

defineExpose({
  threadPinned,
  jumpThreadToBottom,
  hideSelectionMenu,
  scheduleSelectionPaint,
})
</script>

<style scoped>
.chat-thread-root {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.chat-thread-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.chat-thread {
  position: absolute;
  inset: 0;
  overflow: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.chat-thread::-webkit-scrollbar,
.chat-thread::-webkit-scrollbar-button {
  display: none;
}

.custom-scrollbar {
  position: absolute;
  right: 3px;
  top: 4px;
  bottom: 4px;
  width: 4px;
  border-radius: 4px;
  opacity: 0;
  transition: opacity 0.2s;
  cursor: pointer;
  pointer-events: none;
  z-index: 2;
}

.custom-scrollbar.is-visible {
  opacity: 1;
  pointer-events: auto;
}

.custom-scrollbar-thumb {
  width: 4px;
  border-radius: 4px;
  background: var(--custom-scrollbar-thumb);
  transition: background 0.15s;
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
}

.custom-scrollbar-thumb:hover,
.custom-scrollbar:hover .custom-scrollbar-thumb {
  background: var(--custom-scrollbar-thumb-hover);
}

.attach-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.attach-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  padding: 5px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--bg-primary, #fff) 70%, var(--bg-tertiary, #eef0f3));
  font-size: 12px;
  color: var(--text-secondary, #718096);
}

.attach-name {
  color: var(--text-primary, #2d3748);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attach-folder {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-thread {
  padding: 16px var(--chat-gutter);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  overscroll-behavior: contain;
}

.assistant-text,
.assistant-text :deep(*),
.user-bubble,
.activity-text {
  -webkit-user-select: none;
  user-select: none;
}

.chat-selection {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 1;
}

.chat-selection-box {
  position: absolute;
  left: 0;
  top: 0;
  border-radius: 5px;
  background: color-mix(in srgb, #79b4ff 36%, transparent);
}

.chat-thread > * {
  width: 100%;
  max-width: var(--chat-max-width);
}

.chat-thread-spacer {
  flex: none;
  height: 108px;
  max-width: none;
  pointer-events: none;
}

.chat-thread-wrap > .custom-scrollbar {
  bottom: 56px;
}

.chat-turn.is-user {
  display: flex;
  justify-content: flex-end;
}

.user-turn {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  max-width: 72%;
}

.user-images {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.user-image {
  width: 72px;
  height: 72px;
  object-fit: cover;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
  cursor: zoom-in;
}

.user-image.is-missing {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 42%, transparent);
}

.user-files {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
}

.user-file {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  height: 26px;
  padding: 0 8px 0 4px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 5%, transparent);
  font-size: 12px;
}

.user-file.is-openable {
  cursor: pointer;
}

.user-file.is-openable:hover {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 9%, transparent);
}

.user-file-icon {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 7px;
  font-weight: 800;
  letter-spacing: -0.04em;
  line-height: 1;
  color: #fff;
  background: #6b7280;
}

.user-file-icon.is-pdf { background: #e24b4a; }
.user-file-icon.is-word { background: #2b579a; font-size: 10px; }
.user-file-icon.is-excel { background: #217346; font-size: 10px; }
.user-file-icon.is-csv { background: #0d9488; }
.user-file-icon.is-md { background: #4b5563; }
.user-file-icon.is-text { background: #6b7280; }

.user-file-name {
  min-width: 0;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary, #2d3748);
}

.user-bubble {
  max-width: 100%;
  padding: 8px 12px;
  border-radius: 12px;
  background: var(--bg-tertiary, #e8e8ed);
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-primary, #2d3748);
  white-space: pre-wrap;
}

:deep(.folder-mention) {
  display: inline-block;
  vertical-align: middle;
  height: 18px;
  padding: 0 7px 0 5px;
  margin: 0 1px;
  border-radius: 6px;
  background: #f3e2c4;
  color: #8a5310;
  font-size: 12px;
  line-height: 18px;
  white-space: nowrap;
  user-select: all;
  -webkit-user-select: all;
  cursor: default;
}

:deep(.folder-mention-icon) {
  display: inline-block;
  width: 12px;
  height: 12px;
  margin-right: 4px;
  vertical-align: -1px;
}

:deep(.folder-mention-name) {
  display: inline;
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
}

.assistant-turn {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-width: 100%;
}

.activity-entry {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.activity-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.activity-icon {
  width: 16px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary, #718096);
}

.activity-text,
.assistant-text {
  font-size: 13px;
  line-height: 1.7;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 86%, transparent);
}

.assistant-text :deep(.markstream-vue) {
  --fade-duration: 0.32s;
  --ms-text-body: 13px;
  --ms-text-h1: 18px;
  --ms-text-h2: 16px;
  --ms-text-h3: 14px;
  --ms-text-h4: 13px;
  --ms-text-h5: 13px;
  --ms-text-h6: 13px;
  --ms-text-label: 11px;
  --ms-leading-body: 1.65;
  --ms-flow-paragraph-y: 0.55em;
  --ms-flow-list-y: 0.45em;
  --ms-flow-heading-1-mt: 0.7em;
  --ms-flow-heading-1-mb: 0.4em;
  --ms-flow-heading-2-mt: 0.7em;
  --ms-flow-heading-2-mb: 0.35em;
  --ms-flow-heading-3-mt: 0.6em;
  --ms-flow-heading-3-mb: 0.3em;
  --ms-flow-codeblock-y: 0.55em;
  --ms-flow-hr-y: 0.7em;
  --hr-border: color-mix(in srgb, var(--border-primary, #e2e8f0) 88%, transparent);
  --code-bg: color-mix(in srgb, var(--text-primary, #2d3748) 5.5%, var(--bg-secondary, #fff));
  --code-fg: var(--text-primary, #2d3748);
  --code-border: transparent;
  --diagram-bg: var(--code-bg);
  --diagram-header-bg: var(--code-bg);
  --ms-shadow-subtle: none;
  --vscode-editor-font-size: 12px;
  font-size: 13px;
  line-height: 1.65;
}

.activity-text {
  white-space: pre-wrap;
}

.activity-line.is-failed .activity-text {
  color: var(--color-warning, #c2410c);
}

.activity-detail {
  margin: 0 0 0 24px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--color-warning, #c2410c);
  white-space: pre-wrap;
}

.assistant-text :deep(.table-node__loading) {
  display: none;
}

.assistant-text :deep(.table-node--loading tbody td > *) {
  visibility: visible;
}

.assistant-text :deep(.table-node--loading tbody td::after) {
  display: none;
}

.assistant-text :deep(.mermaid-block-container),
.assistant-text :deep(.infographic-block-container) {
  max-width: 100%;
  overflow: auto;
}

.assistant-text :deep(.d2-block-container),
.assistant-text :deep(.d2-render) {
  max-width: 100%;
  overflow: hidden;
}

.assistant-text :deep(.mermaid-preview-area svg),
.assistant-text :deep(.infographic-preview svg) {
  max-width: 100%;
  height: auto;
}

.assistant-text :deep(p) {
  margin: 0 0 10px;
}

.assistant-text :deep(p:last-child),
.assistant-text :deep(ul:last-child),
.assistant-text :deep(ol:last-child) {
  margin-bottom: 0;
}

.assistant-text :deep(ul),
.assistant-text :deep(ol),
.assistant-text :deep(.list-node) {
  margin: 0 0 10px;
  padding-left: 1.15em;
  list-style: none;
}

.assistant-text :deep(li),
.assistant-text :deep(.list-item) {
  position: relative;
  display: block !important;
  list-style: none !important;
  padding-left: 0 !important;
  contain: none !important;
}

.assistant-text :deep(ul > li)::before,
.assistant-text :deep(ul > .list-item)::before {
  content: '•';
  position: absolute;
  left: -1em;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 45%, transparent);
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}

.assistant-text :deep(ol) {
  counter-reset: agent-ol;
}

.assistant-text :deep(ol > li),
.assistant-text :deep(ol > .list-item) {
  counter-increment: agent-ol;
}

.assistant-text :deep(ol > li)::before,
.assistant-text :deep(ol > .list-item)::before {
  content: counter(agent-ol) '.';
  position: absolute;
  left: -1.15em;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 45%, transparent);
  pointer-events: none;
  user-select: none;
  -webkit-user-select: none;
}

.assistant-text :deep(li:has(.checkbox-node))::before,
.assistant-text :deep(.list-item:has(.checkbox-node))::before {
  content: none;
}

.assistant-text :deep(.agent-html),
.assistant-text :deep(.agent-html-frame) {
  overflow: hidden;
}

.assistant-text :deep(.code-block-container),
.assistant-text :deep(pre),
.assistant-text :deep(pre[data-markstream-pre]) {
  contain: none !important;
  transform: none !important;
  backface-visibility: visible !important;
  position: relative;
  margin: 0 0 10px;
  padding: 10px 12px;
  overflow: auto;
  max-width: 100%;
  height: auto;
  min-height: 0;
  border: none !important;
  outline: none !important;
  box-shadow: none !important;
  -webkit-appearance: none;
  border-radius: 8px;
  background: var(--code-bg, color-mix(in srgb, var(--text-primary, #2d3748) 5.5%, var(--bg-secondary, #fff)));
  color: var(--code-fg, var(--text-primary, #2d3748));
  font-size: 12px;
  line-height: 1.55;
  white-space: pre;
}

.assistant-text :deep(pre:focus),
.assistant-text :deep(pre:focus-visible),
.assistant-text :deep(.code-block-container:focus) {
  outline: none !important;
  box-shadow: none !important;
}

.assistant-text :deep(pre[data-lang-label]) {
  padding-top: 26px;
}

.assistant-text :deep(pre[data-lang-label])::before {
  content: attr(data-lang-label);
  position: absolute;
  top: 6px;
  right: 10px;
  font-family: inherit;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.02em;
  line-height: 1;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 42%, transparent);
  pointer-events: none;
  user-select: none;
}

.assistant-text :deep(pre code),
.assistant-text :deep(.markstream-pre__code),
.assistant-text :deep(pre code.hljs) {
  display: block;
  font-size: inherit;
  line-height: inherit;
  background: transparent;
  padding: 0;
  white-space: inherit;
}

.assistant-text :deep(hr),
.assistant-text :deep(.hr-node),
.assistant-text :deep(.agent-hr) {
  display: block;
  width: 100%;
  height: 0;
  margin: 10px 0;
  padding: 0;
  border: none;
  border-top: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 88%, transparent);
  background: none;
  overflow: hidden;
}

.assistant-text :deep(:not(pre) > code) {
  font-size: 12px;
  padding: 1px 5px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
}

.assistant-text :deep(.code-block),
.assistant-text :deep(.monaco-editor),
.assistant-text :deep(.monaco-editor-background) {
  max-width: 100%;
  font-size: 12px;
}

.assistant-text :deep([data-custom-id="agent-chat"]) {
  overflow: visible;
  height: auto;
  max-height: none;
}

.activity-text.is-live {
  color: color-mix(in srgb, var(--text-primary, #2d3748) 62%, transparent);
  animation: chat-think-pulse 1.2s ease-in-out infinite;
}

.assistant-thinking {
  font-size: 13px;
  line-height: 1.7;
  color: var(--text-secondary, #718096);
  animation: chat-think-pulse 1.2s ease-in-out infinite;
}

.study-eval-note {
  max-width: 36em;
  padding: 8px 10px;
  border-radius: 10px;
  font-size: 12px;
  line-height: 1.6;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 78%, transparent);
  background: color-mix(in srgb, var(--color-primary, #0a84ff) 8%, var(--bg-secondary, #fff));
  border: 1px solid color-mix(in srgb, var(--color-primary, #0a84ff) 16%, transparent);
}

.study-eval-note.is-running {
  color: var(--text-secondary, #718096);
  animation: chat-think-pulse 1.2s ease-in-out infinite;
}

.study-eval-note.is-failed,
.study-eval-note.is-empty {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 4%, var(--bg-secondary, #fff));
  border-color: color-mix(in srgb, var(--border-primary, #e2e8f0) 80%, transparent);
}

.study-eval-note.is-failed {
  color: var(--color-warning, #c2410c);
}

.write-block {
  border: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 80%, transparent);
  border-radius: 8px;
  overflow: hidden;
  background: color-mix(in srgb, var(--bg-primary, #fff) 55%, var(--bg-secondary, #fff));
}

.write-block.is-open {
  border-color: color-mix(in srgb, var(--color-success, #16a34a) 35%, var(--border-primary, #e2e8f0));
}

.write-block.is-quiz.is-open {
  border-color: color-mix(in srgb, var(--color-primary, #3b82f6) 35%, var(--border-primary, #e2e8f0));
}

.write-block.is-quiz .write-stat {
  color: var(--color-primary, #2563eb);
}

.write-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  border: none;
  background: color-mix(in srgb, var(--bg-primary, #fff) 58%, var(--bg-tertiary, #e8e8ed));
  cursor: pointer;
}

.write-head:hover {
  background: color-mix(in srgb, var(--bg-primary, #fff) 28%, var(--bg-tertiary, #e8e8ed));
}

.write-file {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-primary, #2d3748);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.write-file svg {
  flex-shrink: 0;
}

.write-file-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.write-stat {
  flex-shrink: 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--color-success, #16a34a);
}

.write-body {
  position: relative;
  max-height: 280px;
  overflow: hidden;
}

.write-fade {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  padding: 36px 10px 8px;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    color-mix(in srgb, var(--bg-secondary, #fff) 55%, transparent) 42%,
    var(--bg-secondary, #fff) 100%
  );
  pointer-events: none;
}

.write-item {
  display: flex;
  align-items: flex-start;
  padding: 8px 10px 8px 0;
  background: rgba(22, 163, 74, 0.06);
  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--border-primary, #e2e8f0) 45%, transparent);
}

.write-item:last-of-type {
  box-shadow: none;
}

.write-gutter {
  flex-shrink: 0;
  width: 22px;
  padding-top: 2px;
  text-align: center;
  font-size: 12px;
  line-height: 1.4;
  color: var(--color-success, #16a34a);
}

.write-question {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.write-q-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.write-index {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #718096);
}

.write-type {
  font-size: 10px;
  font-weight: 600;
  line-height: 1.2;
  padding: 2px 6px;
  border-radius: 999px;
  background: var(--ql-type-tag-bg, #eef2f7);
  color: var(--ql-type-tag-text, #64748b);
}

.write-type.is-single {
  background: var(--ql-type-tag-single-bg, #edf4ff);
  color: var(--ql-type-tag-single-text, #2563eb);
}

.write-type.is-multiple {
  background: var(--ql-type-tag-multiple-bg, #f3e8ff);
  color: var(--ql-type-tag-multiple-text, #7c3aed);
}

.write-type.is-judgement {
  background: var(--ql-type-tag-judgement-bg, #fff7ed);
  color: var(--ql-type-tag-judgement-text, #c2410c);
}

.write-type.is-fill {
  background: var(--ql-type-tag-fill-bg, #ecfdf5);
  color: var(--ql-type-tag-fill-text, #047857);
}

.write-stem {
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-primary, #2d3748);
}

.write-options {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.write-option {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  line-height: 1.45;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 82%, transparent);
}

.write-opt-key {
  flex-shrink: 0;
  min-width: 16px;
  height: 16px;
  margin-top: 1px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 600;
  color: var(--ql-type-tag-single-text, #2563eb);
  background: var(--ql-type-tag-single-bg, #edf4ff);
}

.write-opt-text {
  min-width: 0;
}

.write-answer {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  line-height: 1.45;
}

.write-answer-label {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  color: var(--color-success, #15803d);
  background: color-mix(in srgb, var(--color-success, #16a34a) 16%, transparent);
}

.write-answer-text {
  color: var(--color-success, #166534);
}

.write-more {
  pointer-events: auto;
  width: 100%;
  border: none;
  background: transparent;
  padding: 4px 0;
  text-align: center;
  font-size: 12px;
  color: var(--text-primary, #2d3748);
  cursor: pointer;
}

.write-more:hover {
  color: var(--color-success, #166534);
}

.chat-error {
  font-size: 12px;
  color: var(--color-error, #dc2626);
}

.chat-stopped {
  font-size: 12px;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 42%, transparent);
}

[data-theme="dark"] :deep(.folder-mention) {
  background: color-mix(in srgb, var(--color-warning, #ff9f0a) 20%, var(--bg-tertiary, #3a3a3c));
  color: #f0c674;
}

[data-theme="dark"] .assistant-text :deep(.markstream-vue) {
  --code-bg: color-mix(in srgb, var(--text-primary, #f5f5f7) 7%, var(--bg-primary, #1c1c1e));
  --code-fg: var(--text-primary, #f5f5f7);
  --code-header-bg: color-mix(in srgb, var(--text-primary, #f5f5f7) 5%, var(--bg-secondary, #2c2c2e));
  --tooltip-bg: var(--bg-tertiary, #3a3a3c);
  --tooltip-fg: var(--text-secondary, #98989d);
}

[data-theme="dark"] .assistant-text :deep(.hljs),
[data-theme="dark"] .assistant-text :deep(pre code.hljs) {
  color: #c9d1d9;
  background: transparent;
}

[data-theme="dark"] .assistant-text :deep(.hljs-comment),
[data-theme="dark"] .assistant-text :deep(.hljs-code),
[data-theme="dark"] .assistant-text :deep(.hljs-formula) {
  color: #8b949e;
}

[data-theme="dark"] .assistant-text :deep(.hljs-keyword),
[data-theme="dark"] .assistant-text :deep(.hljs-doctag),
[data-theme="dark"] .assistant-text :deep(.hljs-type),
[data-theme="dark"] .assistant-text :deep(.hljs-template-tag),
[data-theme="dark"] .assistant-text :deep(.hljs-template-variable),
[data-theme="dark"] .assistant-text :deep(.hljs-variable.language_) {
  color: #ff7b72;
}

[data-theme="dark"] .assistant-text :deep(.hljs-title),
[data-theme="dark"] .assistant-text :deep(.hljs-title.class_),
[data-theme="dark"] .assistant-text :deep(.hljs-title.function_) {
  color: #d2a8ff;
}

[data-theme="dark"] .assistant-text :deep(.hljs-attr),
[data-theme="dark"] .assistant-text :deep(.hljs-attribute),
[data-theme="dark"] .assistant-text :deep(.hljs-literal),
[data-theme="dark"] .assistant-text :deep(.hljs-meta),
[data-theme="dark"] .assistant-text :deep(.hljs-number),
[data-theme="dark"] .assistant-text :deep(.hljs-operator),
[data-theme="dark"] .assistant-text :deep(.hljs-variable),
[data-theme="dark"] .assistant-text :deep(.hljs-selector-attr),
[data-theme="dark"] .assistant-text :deep(.hljs-selector-class),
[data-theme="dark"] .assistant-text :deep(.hljs-selector-id) {
  color: #79c0ff;
}

[data-theme="dark"] .assistant-text :deep(.hljs-string),
[data-theme="dark"] .assistant-text :deep(.hljs-regexp),
[data-theme="dark"] .assistant-text :deep(.hljs-meta .hljs-string) {
  color: #a5d6ff;
}

[data-theme="dark"] .assistant-text :deep(.hljs-built_in),
[data-theme="dark"] .assistant-text :deep(.hljs-symbol) {
  color: #ffa657;
}

[data-theme="dark"] .assistant-text :deep(.hljs-name),
[data-theme="dark"] .assistant-text :deep(.hljs-quote),
[data-theme="dark"] .assistant-text :deep(.hljs-selector-tag),
[data-theme="dark"] .assistant-text :deep(.hljs-selector-pseudo) {
  color: #7ee787;
}

[data-theme="dark"] .assistant-text :deep(.hljs-section) {
  color: #409cff;
}

[data-theme="dark"] .assistant-text :deep(.hljs-bullet) {
  color: #f2cc60;
}

[data-theme="dark"] .assistant-text :deep(.hljs-addition) {
  color: #aff5b4;
  background-color: #033a16;
}

[data-theme="dark"] .assistant-text :deep(.hljs-deletion) {
  color: #ffdcd7;
  background-color: #67060c;
}

[data-theme="dark"] .assistant-text :deep(a) {
  color: var(--color-primary, #409cff);
}

[data-theme="dark"] .assistant-text :deep(blockquote),
[data-theme="dark"] .assistant-text :deep(.blockquote-node) {
  border-left-color: color-mix(in srgb, var(--text-primary, #f5f5f7) 22%, transparent);
  color: var(--text-secondary, #98989d);
}

[data-theme="dark"] .study-eval-note {
  background: color-mix(in srgb, var(--color-primary, #0a84ff) 14%, var(--bg-tertiary, #3a3a3c));
  border-color: color-mix(in srgb, var(--color-primary, #0a84ff) 28%, transparent);
  color: color-mix(in srgb, var(--text-primary, #f5f5f7) 86%, transparent);
}

[data-theme="dark"] .study-eval-note.is-failed,
[data-theme="dark"] .study-eval-note.is-empty {
  background: color-mix(in srgb, var(--bg-tertiary, #3a3a3c) 88%, transparent);
  border-color: color-mix(in srgb, var(--border-primary, #3d3d3f) 88%, transparent);
}

@keyframes chat-think-pulse {
  0%, 100% { opacity: 0.72; }
  50% { opacity: 1; }
}
</style>

<style>
/* WKWebView ignores transparent ::selection and keeps the system highlight. */
.chat-thread *::selection,
.chat-thread *::-moz-selection {
  background: none !important;
  background-color: #0000 !important;
  color: inherit !important;
  -webkit-text-fill-color: inherit !important;
}
</style>
