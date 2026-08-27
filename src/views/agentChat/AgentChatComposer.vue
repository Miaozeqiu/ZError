<template>
  <form class="composer" @submit.prevent="emit('submit')">
    <button
      v-if="!threadPinned"
      class="thread-jump"
      type="button"
      @click="emit('jump-thread')"
    >
      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M6 9l6 6 6-6" />
      </svg>
      回到底部
    </button>
    <div class="composer-box">
      <div v-if="composerImages.length" class="composer-images">
        <div
          v-for="item in composerImages"
          :key="item.filePath"
          class="composer-image"
        >
          <img
            :src="item.imageUrl"
            :alt="item.fileName"
            title="预览图片"
            @click="emit('preview-image', item)"
          />
          <button
            class="composer-file-remove"
            type="button"
            title="移除"
            @click.stop="emit('remove-attachment', item.filePath)"
          >
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>
      <div v-if="composerFiles.length" class="composer-files">
        <div
          v-for="item in composerFiles"
          :key="item.filePath"
          class="composer-file"
          :class="{ 'is-openable': isDiskPath(item.filePath) }"
          :title="isDiskPath(item.filePath) ? fileManagerLabel : item.fileName"
          @click="emit('reveal-file', item.filePath)"
        >
          <span class="composer-file-icon" :class="'is-' + fileTypeOf(item.fileName)">
            {{ fileTypeLabel(item.fileName) }}
          </span>
          <span class="composer-file-name">{{ item.fileName }}</span>
          <button
            class="composer-file-remove"
            type="button"
            title="移除"
            @click.stop="emit('remove-attachment', item.filePath)"
          >
            <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
              <path d="M6 6l12 12" />
              <path d="M18 6L6 18" />
            </svg>
          </button>
        </div>
      </div>
      <div
        ref="composerRef"
        class="composer-input"
        :class="{ 'is-empty': !draft.trim() && !composing }"
        contenteditable="true"
        role="textbox"
        :data-placeholder="composerPlaceholder"
        @input="onComposerInput"
        @paste="onComposerPaste"
        @compositionstart="onComposerCompositionStart"
        @compositionend="onComposerCompositionEnd"
        @keydown="onComposerKeydown"
        @mousedown="onComposerMouseDown"
        @mouseup="onComposerMouseUp"
        @keyup="onComposerKeyup"
        @contextmenu.prevent="onComposerContextMenu"
      />
      <div class="composer-toolbar">
        <button class="composer-add" type="button" title="添加文件" @click="emit('add-file')">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <path d="M12 5v14" />
            <path d="M5 12h14" />
          </svg>
        </button>
        <button
          v-if="agentHasVision"
          class="composer-add"
          type="button"
          title="添加图片"
          @click="emit('add-image')"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <rect x="3" y="5" width="18" height="14" rx="2" />
            <circle cx="8.5" cy="10" r="1.5" />
            <path d="M21 16l-5-5-4 4-2-2-5 5" />
          </svg>
        </button>
        <button class="composer-add" type="button" title="添加文件夹" @mousedown.prevent="saveComposerSelection" @click="emit('add-folder')">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
          </svg>
        </button>
        <button class="composer-model" type="button" @click="emit('open-model')" :title="agentModelLabel">
          {{ agentModelLabel }}
        </button>
        <div
          ref="contextMeterRef"
          class="context-meter"
          :class="{
            'is-warn': contextUsagePercent >= 70,
            'is-alert': contextUsagePercent >= 90,
            'is-compacting': contextCompacting,
          }"
          tabindex="0"
          :aria-label="contextCompacting ? '正在压缩上下文' : `上下文已用 ${contextUsageLabel}`"
          @pointerenter="openContextTip"
          @pointerleave="closeContextTip"
          @focus="openContextTip"
          @blur="closeContextTip"
        >
          <svg class="context-meter-ring" viewBox="0 0 20 20" aria-hidden="true">
            <circle class="context-meter-track" cx="10" cy="10" r="7.2" />
            <circle
              class="context-meter-arc"
              cx="10"
              cy="10"
              r="7.2"
              :stroke-dasharray="contextRingDash"
            />
          </svg>
        </div>
        <button
          v-if="sending"
          class="composer-send is-stop"
          type="button"
          aria-label="终止对话"
          title="终止对话"
          @click="emit('stop')"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <rect x="7" y="7" width="10" height="10" rx="2" />
          </svg>
        </button>
        <button
          v-else
          class="composer-send"
          type="submit"
          :disabled="!canSubmit"
          aria-label="发送"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 19V5" />
            <path d="M5 12l7-7 7 7" />
          </svg>
        </button>
      </div>
    </div>
  </form>

  <UnifiedContextMenu
    :visible="composerMenuVisible"
    :x="composerMenuX"
    :y="composerMenuY"
    :menu-items="composerMenuItems"
    exclusive-key="agent-chat-composer-menu"
    @item-click="onComposerMenuClick"
    @close="composerMenuVisible = false"
  />

  <Teleport to="body">
    <Transition name="context-meter-tip">
      <div
        v-if="contextTipOpen"
        class="context-meter-tip"
        role="tooltip"
        :style="{ left: `${contextTipPos.x}px`, top: `${contextTipPos.y}px` }"
      >
        <div class="context-meter-tip-card">
          <div class="context-meter-tip-head">
            <span>上下文</span>
            <span>{{ contextUsageLabel }}</span>
          </div>
          <div class="context-meter-tip-row" v-for="row in contextUsageRows" :key="row.label">
            <span>{{ row.label }}</span>
            <span>{{ row.value }}</span>
          </div>
          <div
            v-if="contextTipNote"
            class="context-meter-tip-note"
            :class="{ 'is-live': contextCompacting }"
          >
            {{ contextTipNote }}
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager'
import UnifiedContextMenu, { type MenuItem } from '../../components/UnifiedContextMenu.vue'
import { encodeFolderToken } from '../../services/agent/chat'
import type { AgentChatAttachment } from '../../services/agent/chat'
import { shouldSubmitComposerEnter } from '../../utils/composerEnter'

const props = defineProps<{
  threadPinned: boolean
  composerFiles: AgentChatAttachment[]
  composerImages: AgentChatAttachment[]
  sending: boolean
  canSubmit: boolean
  agentHasVision: boolean
  agentModelLabel: string
  composerPlaceholder: string
  contextUsagePercent: number
  contextCompacting: boolean
  contextUsageLabel: string
  contextRingDash: string
  contextUsageRows: { label: string; value: string }[]
  contextTipNote: string
  fileManagerLabel: string
}>()

const emit = defineEmits<{
  submit: []
  stop: []
  'jump-thread': []
  'add-file': []
  'add-image': []
  'add-folder': []
  'open-model': []
  'remove-attachment': [filePath: string]
  'preview-image': [item: { imageUrl?: string; fileName?: string; filePath?: string }]
  'reveal-file': [filePath: string]
  'paste-image': [imageUrl: string, fileName: string]
  'hide-selection-menu': []
}>()

const draft = defineModel<string>('draft', { required: true })

type FileKind = 'pdf' | 'word' | 'excel' | 'csv' | 'md' | 'text' | 'file'

const fileExtOf = (fileName: string) => fileName.split('.').pop()?.toLowerCase() || ''

const fileTypeOf = (fileName: string): FileKind => {
  const ext = fileExtOf(fileName)
  if (ext === 'pdf') return 'pdf'
  if (ext === 'doc' || ext === 'docx') return 'word'
  if (ext === 'xls' || ext === 'xlsx') return 'excel'
  if (ext === 'csv') return 'csv'
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'txt') return 'text'
  return 'file'
}

const fileTypeLabel = (fileName: string) => {
  const kind = fileTypeOf(fileName)
  if (kind === 'pdf') return 'PDF'
  if (kind === 'word') return 'W'
  if (kind === 'excel') return 'X'
  if (kind === 'csv') return 'CSV'
  if (kind === 'md') return 'MD'
  if (kind === 'text') return 'TXT'
  return fileExtOf(fileName).slice(0, 3).toUpperCase() || 'FILE'
}

const isDiskPath = (path?: string) => {
  const value = String(path || '').trim()
  return Boolean(value) && !value.startsWith('image:') && !value.startsWith('folder:') && !value.startsWith('data:')
}

const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(file)
})

const composerRef = ref<HTMLElement | null>(null)
const composing = ref(false)
let compositionEndedAt = 0
let savedComposerRange: Range | null = null

const FOLDER_ICON_SVG = '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /></svg>'

const serializeComposer = (root: HTMLElement) => {
  let out = ''
  const walk = (node: Node, isRoot = false) => {
    if (node.nodeType === Node.TEXT_NODE) {
      out += (node.textContent || '').replace(/\u00A0/g, ' ').replace(/\u200B/g, '')
      return
    }
    if (!(node instanceof HTMLElement)) return
    if (node.classList.contains('folder-mention')) {
      const id = Number(node.dataset.folderId)
      const name = node.dataset.folderName || '文件夹'
      const path = node.dataset.folderPath || name
      out += encodeFolderToken({ folderId: id, folderName: name, folderPath: path })
      return
    }
    if (node.tagName === 'BR') {
      out += '\n'
      return
    }
    const block = node.tagName === 'DIV' || node.tagName === 'P'
    if (block && !isRoot && out && !out.endsWith('\n')) out += '\n'
    for (const child of Array.from(node.childNodes)) walk(child)
  }
  walk(root, true)
  return out.replace(/[ \t]+\n/g, '\n').replace(/\n+$/g, '')
}

const mentionFromNode = (node: Node | null) => {
  const el = node instanceof Element ? node : node?.parentElement
  return el?.closest?.('.folder-mention') as HTMLElement | null
}

const isZwspText = (node: Node | null) =>
  node instanceof Text && !node.data.replace(/\u200B/g, '')

const placeCaretBesideMention = (chip: HTMLElement, after: boolean) => {
  const input = composerRef.value
  const sel = window.getSelection()
  if (!input || !sel) return
  const neighbor = after ? chip.nextSibling : chip.previousSibling
  const range = document.createRange()
  if (neighbor instanceof Text) {
    if (after) {
      const skip = neighbor.data.match(/^\u200B*/)?.[0].length || 0
      range.setStart(neighbor, skip)
    } else {
      range.setStart(neighbor, neighbor.data.replace(/\u200B+$/, '').length)
    }
  } else if (after) {
    range.setStartAfter(chip)
  } else {
    range.setStartBefore(chip)
  }
  range.collapse(true)
  sel.removeAllRanges()
  sel.addRange(range)
  savedComposerRange = range.cloneRange()
}

const ejectCaretFromMention = () => {
  const input = composerRef.value
  const sel = window.getSelection()
  if (!input || !sel || !sel.rangeCount) return
  const range = sel.getRangeAt(0)
  const startChip = mentionFromNode(range.startContainer)
  if (startChip && input.contains(startChip)) {
    placeCaretBesideMention(startChip, true)
    return
  }
  const endChip = mentionFromNode(range.endContainer)
  if (endChip && input.contains(endChip)) {
    placeCaretBesideMention(endChip, true)
  }
}

const saveComposerSelection = () => {
  const input = composerRef.value
  const sel = window.getSelection()
  if (!input || !sel || !sel.rangeCount) return
  const range = sel.getRangeAt(0)
  if (!input.contains(range.commonAncestorContainer)) return
  if (mentionFromNode(range.startContainer) || mentionFromNode(range.endContainer)) {
    ejectCaretFromMention()
    return
  }
  savedComposerRange = range.cloneRange()
}

const onComposerMouseDown = (event: MouseEvent) => {
  const chip = mentionFromNode(event.target as Node)
  if (!chip || !composerRef.value?.contains(chip)) return
  event.preventDefault()
  const rect = chip.getBoundingClientRect()
  placeCaretBesideMention(chip, event.clientX >= rect.left + rect.width / 2)
}

const onComposerMouseUp = () => {
  ejectCaretFromMention()
  saveComposerSelection()
}

const onComposerKeyup = () => {
  ejectCaretFromMention()
  saveComposerSelection()
}

const skipZwspSibling = (node: Node | null, dir: 'before' | 'after') => {
  let current = node
  while (isZwspText(current)) {
    current = dir === 'before' ? current.previousSibling : current.nextSibling
  }
  return current
}

const nodeBesideCaret = (range: Range, dir: 'before' | 'after') => {
  const node = range.startContainer
  const offset = range.startOffset
  let neighbor: Node | null = null
  if (node.nodeType === Node.TEXT_NODE) {
    const text = node as Text
    if (dir === 'before') {
      neighbor = offset > 0 && text.data.slice(0, offset).replace(/\u200B/g, '')
        ? null
        : text.previousSibling
    } else {
      neighbor = offset < text.data.length && text.data.slice(offset).replace(/\u200B/g, '')
        ? null
        : text.nextSibling
    }
  } else if (node instanceof HTMLElement) {
    neighbor = dir === 'before' ? node.childNodes[offset - 1] || null : node.childNodes[offset] || null
  }
  return skipZwspSibling(neighbor, dir)
}

const chipFromNeighbor = (node: Node | null) => {
  if (node instanceof HTMLElement && node.classList.contains('folder-mention')) return node
  return mentionFromNode(node)
}

const handleMentionArrow = (forward: boolean, extend: boolean) => {
  const input = composerRef.value
  const sel = window.getSelection()
  if (!input || !sel || !sel.rangeCount || !sel.isCollapsed) return false
  const range = sel.getRangeAt(0)
  if (!input.contains(range.startContainer)) return false
  const chip = chipFromNeighbor(nodeBesideCaret(range, forward ? 'after' : 'before'))
  if (!chip || !input.contains(chip)) return false
  if (extend) {
    const select = document.createRange()
    select.selectNode(chip)
    sel.removeAllRanges()
    sel.addRange(select)
    savedComposerRange = select.cloneRange()
    return true
  }
  placeCaretBesideMention(chip, forward)
  return true
}

const selectMention = (chip: HTMLElement) => {
  const range = document.createRange()
  const start = isZwspText(chip.previousSibling) ? chip.previousSibling as Text : chip
  const end = isZwspText(chip.nextSibling) ? chip.nextSibling as Text : chip
  if (start instanceof Text) range.setStart(start, 0)
  else range.setStartBefore(chip)
  if (end instanceof Text) range.setEnd(end, end.data.length)
  else range.setEndAfter(chip)
  const sel = window.getSelection()
  if (!sel) return
  sel.removeAllRanges()
  sel.addRange(range)
}

const removeMention = (chip: HTMLElement) => {
  selectMention(chip)
  document.execCommand('delete')
  syncDraftFromComposer()
  resizeComposer()
}

const handleMentionDelete = (forward: boolean) => {
  const input = composerRef.value
  const sel = window.getSelection()
  if (!input || !sel || !sel.rangeCount || !sel.isCollapsed) return false
  const range = sel.getRangeAt(0)
  if (!input.contains(range.startContainer)) return false
  const chip = chipFromNeighbor(nodeBesideCaret(range, forward ? 'after' : 'before'))
  if (!chip || !input.contains(chip)) return false
  removeMention(chip)
  return true
}

const restoreComposerSelection = () => {
  const input = composerRef.value
  if (!input) return
  input.focus()
  const sel = window.getSelection()
  if (!sel) return
  if (savedComposerRange && input.contains(savedComposerRange.startContainer)) {
    sel.removeAllRanges()
    sel.addRange(savedComposerRange)
    return
  }
  const range = document.createRange()
  range.selectNodeContents(input)
  range.collapse(false)
  sel.removeAllRanges()
  sel.addRange(range)
}

const escapeHtml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const mentionHtml = (folder: { folderId: number; folderName: string; folderPath: string }) =>
  `\u200B<span class="folder-mention" contenteditable="false" unselectable="on" data-folder-id="${folder.folderId}" data-folder-name="${escapeHtml(folder.folderName)}" data-folder-path="${escapeHtml(folder.folderPath)}"><span class="folder-mention-icon" aria-hidden="true">${FOLDER_ICON_SVG}</span><span class="folder-mention-name">${escapeHtml(folder.folderName)}</span></span>\u200B`

const insertFolderMention = (folder: { folderId: number; folderName: string; folderPath: string }) => {
  const input = composerRef.value
  if (!input) return
  restoreComposerSelection()
  input.focus()
  document.execCommand('insertHTML', false, mentionHtml(folder))
  const sel = window.getSelection()
  if (sel?.rangeCount) {
    const chip = chipFromNeighbor(nodeBesideCaret(sel.getRangeAt(0), 'before'))
    if (chip && input.contains(chip)) placeCaretBesideMention(chip, true)
  }
  syncDraftFromComposer()
  resizeComposer()
}

const syncDraftFromComposer = () => {
  const input = composerRef.value
  if (!input) {
    draft.value = ''
    return
  }
  const text = serializeComposer(input)
  draft.value = text.trim() ? text : ''
}

const COMPOSER_LINE_HEIGHT = 20
const COMPOSER_MAX_HEIGHT = 100

const resizeComposer = () => {
  const input = composerRef.value
  if (!input) return
  input.style.height = `${COMPOSER_LINE_HEIGHT}px`
  const next = Math.min(Math.max(input.scrollHeight, COMPOSER_LINE_HEIGHT), COMPOSER_MAX_HEIGHT)
  input.style.height = `${next}px`
  input.style.overflowY = next >= COMPOSER_MAX_HEIGHT ? 'auto' : 'hidden'
}

const onComposerInput = () => {
  if (!props.threadPinned) emit('jump-thread')
  if (composing.value) {
    resizeComposer()
    return
  }
  syncDraftFromComposer()
  resizeComposer()
}

const insertComposerText = (text: string) => {
  restoreComposerSelection()
  if (document.queryCommandSupported?.('insertText')) {
    document.execCommand('insertText', false, text)
  } else {
    const sel = window.getSelection()
    if (!sel || !sel.rangeCount) return
    const range = sel.getRangeAt(0)
    range.deleteContents()
    range.insertNode(document.createTextNode(text))
    range.collapse(false)
  }
  syncDraftFromComposer()
  resizeComposer()
}

const onComposerPaste = async (event: ClipboardEvent) => {
  const items = Array.from(event.clipboardData?.items || [])
  const imageItems = props.agentHasVision
    ? items.filter((item) => item.type.startsWith('image/'))
    : []
  if (imageItems.length) {
    event.preventDefault()
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (!file) continue
      try {
        emit('paste-image', await fileToDataUrl(file), file.name || '粘贴的图片')
      } catch (error) {
        console.error('粘贴图片失败:', error)
      }
    }
    return
  }
  const text = event.clipboardData?.getData('text/plain') || ''
  if (!text) return
  event.preventDefault()
  insertComposerText(text)
}

const clearComposer = () => {
  draft.value = ''
  savedComposerRange = null
  const input = composerRef.value
  if (!input) return
  input.innerHTML = ''
  input.style.height = `${COMPOSER_LINE_HEIGHT}px`
  input.style.overflowY = 'hidden'
}

const fillComposer = async (text: string) => {
  draft.value = text
  await nextTick()
  const input = composerRef.value
  if (!input) return
  input.textContent = text
  input.focus()
  const selection = window.getSelection()
  const range = document.createRange()
  range.selectNodeContents(input)
  range.collapse(false)
  selection?.removeAllRanges()
  selection?.addRange(range)
  resizeComposer()
}

const onComposerCompositionStart = () => {
  composing.value = true
  if (!props.threadPinned) emit('jump-thread')
}

const onComposerCompositionEnd = () => {
  composing.value = false
  compositionEndedAt = Date.now()
  syncDraftFromComposer()
  resizeComposer()
}

const onComposerKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    if (props.sending) emit('stop')
    return
  }
  if (event.key === 'Backspace' || event.key === 'Delete') {
    if (handleMentionDelete(event.key === 'Delete')) {
      event.preventDefault()
      return
    }
  }
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    if (handleMentionArrow(event.key === 'ArrowRight', event.shiftKey)) {
      event.preventDefault()
      return
    }
  }
  if (!shouldSubmitComposerEnter(event, composing.value, compositionEndedAt)) return
  event.preventDefault()
  emit('submit')
}

const composerMenuVisible = ref(false)
const composerMenuX = ref(0)
const composerMenuY = ref(0)
const composerMenuHasSelection = ref(false)
const composerMenuHasContent = ref(false)

const composerMenuItems = computed<MenuItem[]>(() => [
  { id: 'cut', label: '剪切', action: 'cut', disabled: !composerMenuHasSelection.value },
  { id: 'copy', label: '复制', action: 'copy', disabled: !composerMenuHasSelection.value },
  { id: 'paste', label: '粘贴', action: 'paste' },
  { id: 'select-all', label: '全选', action: 'select-all', disabled: !composerMenuHasContent.value },
])

const hideMenu = () => {
  composerMenuVisible.value = false
}

const serializeComposerRange = (range: Range) => {
  const wrap = document.createElement('div')
  wrap.appendChild(range.cloneContents())
  return serializeComposer(wrap)
}

const composerRangeText = (range: Range | null) => {
  const input = composerRef.value
  if (!input || !range || range.collapsed || !input.contains(range.commonAncestorContainer)) return ''
  return serializeComposerRange(range)
}

const currentComposerRange = () => {
  const input = composerRef.value
  const sel = window.getSelection()
  if (sel?.rangeCount) {
    const range = sel.getRangeAt(0)
    if (input?.contains(range.commonAncestorContainer)) return range
  }
  if (savedComposerRange && input?.contains(savedComposerRange.commonAncestorContainer)) {
    return savedComposerRange
  }
  return null
}

const writeClipboardText = async (text: string) => {
  try {
    await writeText(text)
  } catch {
    await navigator.clipboard.writeText(text)
  }
}

const readClipboardText = async () => {
  try {
    return await readText()
  } catch {
    try {
      return await navigator.clipboard.readText()
    } catch {
      return ''
    }
  }
}

const onComposerContextMenu = (event: MouseEvent) => {
  saveComposerSelection()
  const input = composerRef.value
  const range = currentComposerRange()
  composerMenuHasSelection.value = Boolean(composerRangeText(range))
  composerMenuHasContent.value = Boolean(input && serializeComposer(input).trim())
  composerMenuX.value = event.clientX
  composerMenuY.value = event.clientY
  emit('hide-selection-menu')
  composerMenuVisible.value = true
}

const applyComposerMenuRange = () => {
  restoreComposerSelection()
  return currentComposerRange()
}

const cutComposerSelection = async () => {
  const range = applyComposerMenuRange()
  const text = composerRangeText(range)
  if (!text) return
  await writeClipboardText(text)
  document.execCommand('delete')
  syncDraftFromComposer()
  resizeComposer()
  saveComposerSelection()
}

const copyComposerSelection = async () => {
  const text = composerRangeText(applyComposerMenuRange())
  if (!text) return
  await writeClipboardText(text)
}

const pasteComposerSelection = async () => {
  const text = await readClipboardText()
  if (!text) return
  insertComposerText(text)
}

const selectAllComposer = () => {
  const input = composerRef.value
  const sel = window.getSelection()
  if (!input || !sel) return
  input.focus()
  const range = document.createRange()
  range.selectNodeContents(input)
  sel.removeAllRanges()
  sel.addRange(range)
  savedComposerRange = range.cloneRange()
}

const onComposerMenuClick = async (item: MenuItem) => {
  hideMenu()
  if (item.action === 'cut') await cutComposerSelection()
  if (item.action === 'copy') await copyComposerSelection()
  if (item.action === 'paste') await pasteComposerSelection()
  if (item.action === 'select-all') selectAllComposer()
}

const contextMeterRef = ref<HTMLElement | null>(null)
const contextTipOpen = ref(false)
const contextTipPos = ref({ x: 0, y: 0 })

const syncContextTipPos = () => {
  const el = contextMeterRef.value
  if (!el) return
  const rect = el.getBoundingClientRect()
  contextTipPos.value = {
    x: Math.min(rect.right, window.innerWidth - 12),
    y: Math.max(rect.top - 8, 12),
  }
}

const openContextTip = () => {
  syncContextTipPos()
  contextTipOpen.value = true
}

const closeContextTip = () => {
  contextTipOpen.value = false
}

onMounted(() => {
  window.addEventListener('resize', closeContextTip)
  window.addEventListener('scroll', closeContextTip, true)
})

onUnmounted(() => {
  window.removeEventListener('resize', closeContextTip)
  window.removeEventListener('scroll', closeContextTip, true)
})

defineExpose({
  fillComposer,
  insertFolderMention,
  saveComposerSelection,
  syncDraftFromComposer,
  clearComposer,
  hideMenu,
})
</script>

<style scoped>
.thread-jump {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-bottom: 8px;
  padding: 5px 10px;
  border: 0.5px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 70%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--bg-secondary, #fff) 88%, transparent);
  box-shadow: 0 1px 2px color-mix(in srgb, #000 4%, transparent), 0 6px 16px color-mix(in srgb, #000 6%, transparent);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  color: var(--text-secondary, #718096);
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.thread-jump:hover {
  color: var(--text-primary, #2d3748);
  background: var(--bg-secondary, #fff);
}

.composer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 20px var(--chat-gutter) 12px;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    color-mix(in srgb, var(--bg-secondary, #fff) 72%, transparent) 36%,
    var(--bg-secondary, #fff) 100%
  );
  pointer-events: none;
}

.composer-box {
  position: relative;
  width: 100%;
  max-width: var(--chat-max-width);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 4px;
  min-height: 36px;
  padding: 8px 8px 6px 12px;
  border: 0.5px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 55%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-secondary, #fff) 88%, transparent);
  box-shadow: 0 1px 2px color-mix(in srgb, #000 4%, transparent), 0 6px 16px color-mix(in srgb, #000 5%, transparent);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  box-sizing: border-box;
  pointer-events: auto;
}

.composer-box:focus-within {
  border-color: color-mix(in srgb, var(--text-primary, #2d3748) 8%, var(--border-primary, #e2e8f0));
}

.composer-images {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.composer-image {
  position: relative;
  width: 56px;
  height: 56px;
  border-radius: 8px;
  overflow: hidden;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
}

.composer-image img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  cursor: zoom-in;
}

.composer-image .composer-file-remove {
  position: absolute;
  top: 2px;
  right: 2px;
  background: color-mix(in srgb, #000 42%, transparent);
  color: #fff;
}

.composer-image .composer-file-remove:hover {
  background: color-mix(in srgb, #000 58%, transparent);
  color: #fff;
}

.composer-files {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.composer-file-leave-active {
  transition: transform 0.18s ease, opacity 0.16s ease;
}

.composer-file-leave-to {
  opacity: 0;
  transform: scale(0.92);
}

.composer-file-move {
  transition: transform 0.28s cubic-bezier(0.22, 1, 0.36, 1);
}

@keyframes composer-file-in {
  from {
    opacity: 0;
    transform: scale(0.86) translateY(6px);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

.composer-file {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 100%;
  height: 26px;
  padding: 0 4px 0 4px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 5%, transparent);
  color: var(--text-secondary, #718096);
  font-size: 12px;
  animation: composer-file-in 0.32s cubic-bezier(0.22, 1, 0.36, 1);
}

.composer-file.is-openable {
  cursor: pointer;
}

.composer-file.is-openable:hover {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 9%, transparent);
}

.composer-file-icon {
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

.composer-file-icon.is-pdf {
  background: #e24b4a;
}

.composer-file-icon.is-word {
  background: #2b579a;
  font-size: 10px;
}

.composer-file-icon.is-excel {
  background: #217346;
  font-size: 10px;
}

.composer-file-icon.is-csv {
  background: #0d9488;
}

.composer-file-icon.is-md {
  background: #4b5563;
}

.composer-file-icon.is-text {
  background: #6b7280;
}

.composer-file-name {
  min-width: 0;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-primary, #2d3748);
}

.composer-file-remove {
  flex-shrink: 0;
  width: 16px;
  height: 16px;
  padding: 0;
  border: none;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-secondary, #718096);
  cursor: pointer;
}

.composer-file-remove:hover {
  color: var(--text-primary, #2d3748);
  background: color-mix(in srgb, var(--text-primary, #2d3748) 8%, transparent);
}

.composer-input {
  flex: none;
  width: 100%;
  min-width: 0;
  height: 20px;
  min-height: 20px;
  max-height: 100px;
  border: none;
  margin: 0;
  padding: 0;
  font-size: 13px;
  line-height: 20px;
  outline: none;
  background: transparent;
  color: var(--text-primary, #2d3748);
  overflow-y: hidden;
  box-sizing: border-box;
  white-space: pre-wrap;
  word-break: break-word;
  scrollbar-width: none;
}

.composer-input::-webkit-scrollbar,
.composer-input::-webkit-scrollbar-button {
  display: none;
}

.composer-input.is-empty::before {
  content: attr(data-placeholder);
  color: color-mix(in srgb, var(--text-primary, #2d3748) 38%, transparent);
  pointer-events: none;
  padding-left: 6px;
}

.composer-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
}

.composer-add {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--text-secondary, #718096);
  cursor: pointer;
}

.composer-add:hover {
  color: var(--text-primary, #2d3748);
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
}

.composer-model {
  flex-shrink: 1;
  min-width: 0;
  margin-right: auto;
  max-width: 160px;
  height: 28px;
  padding: 0 8px;
  border: none;
  border-radius: 14px;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 12px;
  line-height: 28px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  cursor: pointer;
}

.composer-model:hover {
  color: var(--text-primary, #2d3748);
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
}

.context-meter {
  position: relative;
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--text-secondary, #718096);
  outline: none;
}

.context-meter:hover,
.context-meter:focus-visible {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
}

.context-meter-ring {
  width: 16px;
  height: 16px;
  transform: rotate(-90deg);
}

.context-meter-track,
.context-meter-arc {
  fill: none;
  stroke-width: 2.2;
  stroke-linecap: round;
}

.context-meter-track {
  stroke: color-mix(in srgb, var(--text-primary, #2d3748) 12%, transparent);
}

.context-meter-arc {
  stroke: #2F6F78;
  transition: stroke-dasharray 180ms ease-out, stroke 180ms ease-out;
}

.context-meter.is-warn .context-meter-arc {
  stroke: #d97706;
}

.context-meter.is-alert .context-meter-arc {
  stroke: #dc2626;
}

.context-meter-tip {
  position: fixed;
  left: 0;
  top: 0;
  transform: translate(-100%, -100%);
  pointer-events: none;
  z-index: 100001;
}

.context-meter-tip-card {
  min-width: 184px;
  padding: 10px 12px;
  border-radius: 12px;
  background: var(--context-menu-bg, rgba(255, 255, 255, 0.42));
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid var(--context-menu-border, rgba(255, 255, 255, 0.55));
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22), 0 4px 12px rgba(0, 0, 0, 0.12), inset 0 0.5px 0 rgba(255, 255, 255, 0.5);
  transform-origin: bottom right;
}

.context-meter-tip-enter-active .context-meter-tip-card,
.context-meter-tip-leave-active .context-meter-tip-card {
  transition: opacity 0.14s ease, transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1);
}

.context-meter-tip-enter-from .context-meter-tip-card,
.context-meter-tip-leave-to .context-meter-tip-card {
  opacity: 0;
  transform: translateY(4px) scale(0.96);
}

.context-meter-tip-head,
.context-meter-tip-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  font-variant-numeric: tabular-nums;
}

.context-meter-tip-head {
  margin-bottom: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
}

.context-meter-tip-row {
  font-size: 11px;
  line-height: 18px;
  color: var(--text-secondary, #718096);
}

.context-meter-tip-note {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid color-mix(in srgb, var(--text-primary, #2d3748) 10%, transparent);
  font-size: 11px;
  line-height: 16px;
  color: var(--text-secondary, #718096);
}

.context-meter-tip-note.is-live {
  animation: context-compact-pulse 1.4s ease-in-out infinite;
}

.context-meter.is-compacting .context-meter-arc {
  animation: context-compact-pulse 1.4s ease-in-out infinite;
}

@keyframes context-compact-pulse {
  0%, 100% { opacity: 0.45; }
  50% { opacity: 1; }
}

[data-theme="dark"] .context-meter.is-warn .context-meter-arc {
  stroke: #f0c674;
}

[data-theme="dark"] .context-meter.is-alert .context-meter-arc {
  stroke: #f87171;
}

[data-theme="dark"] .context-meter-arc {
  stroke: #7ab8c0;
}

[data-theme="dark"] .context-meter-tip-card {
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.44), 0 4px 12px rgba(0, 0, 0, 0.28), inset 0 0.5px 0 rgba(255, 255, 255, 0.08);
}

.composer-send {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--text-primary, #2d3748);
  color: var(--bg-secondary, #fff);
  cursor: pointer;
}

.composer-send:hover:not(:disabled) {
  transform: scale(0.97);
}

.composer-send:disabled {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 18%, transparent);
  color: var(--bg-secondary, #fff);
  cursor: default;
}

.composer-send.is-stop:hover {
  transform: scale(0.97);
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

[data-theme="dark"] :deep(.folder-mention) {
  background: color-mix(in srgb, var(--color-warning, #ff9f0a) 20%, var(--bg-tertiary, #3a3a3c));
  color: #f0c674;
}

[data-theme="dark"] .composer-box {
  border-color: color-mix(in srgb, var(--border-primary, #3d3d3f) 88%, transparent);
  background: color-mix(in srgb, var(--bg-tertiary, #3a3a3c) 82%, transparent);
  box-shadow:
    0 1px 2px color-mix(in srgb, #000 28%, transparent),
    0 8px 24px color-mix(in srgb, #000 22%, transparent);
}

[data-theme="dark"] .composer-box:focus-within {
  border-color: color-mix(in srgb, var(--text-primary, #f5f5f7) 16%, var(--border-primary, #3d3d3f));
}

[data-theme="dark"] .thread-jump {
  box-shadow:
    0 1px 2px color-mix(in srgb, #000 28%, transparent),
    0 8px 20px color-mix(in srgb, #000 20%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .context-meter-tip-note.is-live,
  .context-meter.is-compacting .context-meter-arc {
    animation: none;
    opacity: 1;
  }

  .context-meter-arc,
  .context-meter-tip-enter-active .context-meter-tip-card,
  .context-meter-tip-leave-active .context-meter-tip-card {
    transition: none;
  }

  .composer-file-leave-active,
  .composer-file-move {
    transition: none;
  }

  .composer-file {
    animation: none;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .composer-box {
    background: var(--bg-secondary, #fff);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}
</style>
