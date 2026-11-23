<template>
  <div class="chat-page" :class="{ 'list-collapsed': chatListCollapsed }">
    <AgentChatSidebar />

    <div class="chat-workspace">
      <section ref="fileDropTarget" class="chat-main" @dragenter="fileDrop.enter" @dragover="fileDrop.over" @dragleave="fileDrop.leave" @drop="fileDrop.drop" :style="{ '--chat-composer-height': `${composerHeight}px` }">
        <Transition name="file-drop">
          <div v-if="fileDrop.hovering.value" class="file-drop-overlay" :class="{ 'is-unsupported': !fileDrop.supported.value }" role="status" aria-live="polite">
            <span class="file-drop-label">{{ fileDrop.message.value }}</span>
          </div>
        </Transition>
        <AgentChatThread
          ref="threadCompRef"
          v-model:pinned="threadPinned"
          :show-feature-cards="showFeatureCards"
          :file-manager-label="fileManagerLabel"
          @import="startImportFromCard"
          @organize="startOrganizeFromCard"
          @explain="startExplainFromCard"
          @quiz="startQuizFromCard"
          @graph="startGraphFromCard"
          @preview-image="openImagePreview"
          @reveal-file="revealInFileManager"
          @quote="onQuoteSelection"
          @ask="onAskSelection"
          @hide-composer-menu="composerCompRef?.hideContextMenu()"
        />
        <AgentChatComposer
          ref="composerCompRef"
          v-model:draft="draft"
          :thread-pinned="threadPinned"
          :composer-files="composerFiles"
          :composer-images="composerImages"
          :image-error="imageError"
          :quiz-option-quotes="quizOptionQuotes"
          :sending="sending"
          :can-submit="canSubmit"
          :agent-has-vision="agentHasVision"
          :agent-model-label="agentModelLabel"
          :composer-placeholder="composerPlaceholder"
          :context-usage-percent="contextUsage.percent"
          :context-compacting="contextCompacting"
          :context-usage-label="contextUsageLabel"
          :context-ring-dash="contextRingDash"
          :context-usage-rows="contextUsageRows"
          :context-tip-note="contextTipNote"
          :file-manager-label="fileManagerLabel"
          @submit="submit"
          @stop="stopChat"
          @jump-thread="jumpThreadToBottom"
          @add-attachments="addAttachments"
          @add-folder="openFolderPicker"
          @open-model="openModelSelector()"
          @choose-vision-model="openModelSelector(true)"
          @remove-attachment="removeComposerAttachment"
          @remove-quiz-option="quizOptionQuotes.splice($event, 1)"
          @preview-image="openImagePreview"
          @reveal-file="revealInFileManager"
          @paste-images="pasteImages"
          @hide-selection-menu="hideSelectionMenu"
          @height-change="composerHeight = $event"
        >
          <template #status>
            <BrowserAgentWatchBar v-if="!agentBrowserExpanded" :browser-id="activeChat?.browserId" />
            <AgentApprovalBar v-if="approvalPending" :session-id="activeChat?.id" />
          </template>
        </AgentChatComposer>
      </section>

      <AgentChatWritePane
        :quiz="paneQuiz"
        :quiz-explain-busy="sending"
        :write-step="openedWriteStep"
        :graph="paneGraphView"
        :folder-name="activeChat?.attachments?.[0]?.folderName || '题库'"
        @close-quiz="openedQuizKey = null"
        @close-write="openedWriteStepId = null"
        @close-graph="closeGraphPane"
        @quiz-attempt="onQuizAttempt"
        @quiz-explain="onQuizExplain"
        @quote-quiz-option="onQuoteQuizOption"
        @graph-select="onGraphSelect"
      />
      <AgentBrowserPane
        :active="active && (selectedAgentPane === 'browser' || agentBrowserExpanded)"
        :dismissed="!active || (!browserPaneVisible && !agentBrowserExpanded && paneQuiz?.mode !== 'homework')"
        :obscured="browserObscured || showModelSelector || folderPickerVisible || !!previewImage"
      />
    </div>

    <ModelSelectorDialog
      :show="showModelSelector"
      force-category="agent"
      :require-vision="chooseVisionModel"
      :selected-summary-model-ids="[]"
      :selected-agent-model-id="agentModel?.id || null"
      :available-models="availableModels"
      :platforms="platforms"
      @close="showModelSelector = false"
      @model-selected="onAgentModelSelected"
    />

    <FolderPickerDialog
      :visible="folderPickerVisible"
      :initial-folder-id="folderPickerInitialId"
      selection-mode="all"
      @cancel="cancelFolderPicker"
      @confirm="onFolderPicked"
    />

    <Teleport to="body">
      <Transition name="image-preview">
        <div
          v-if="previewImage"
          class="image-preview-overlay"
          @click="closeImagePreview"
        >
          <img
            class="image-preview-photo"
            :src="previewImage.imageUrl"
            :alt="previewImage.fileName"
            @click.stop
          />
          <button
            v-if="previewImage.filePath"
            class="image-preview-reveal"
            type="button"
            @click.stop="revealInFileManager(previewImage.filePath)"
          >
            {{ fileManagerLabel }}
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { useWorkspaceEvent } from '../composables/useWorkspaceEvent'
import BrowserAgentWatchBar from '../components/browser/BrowserAgentWatchBar.vue'
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  activeChat,
  activeChatId,
  chatListCollapsed,
  composerAttachments,
  consumeComposerAttachments,
  isImageAttachment,
  startFileImportChat,
  startFolderOrganizeChat,
  draftStudyGraphChat,
  extractFolderAttachments,
  isFileAttachment,
  parseFolderTokens,
  removeComposerAttachment,
  sendChatMessage,
  estimateAgentContext,
  contextCompacting,
  stopChat,
  formatQuizAttempt,
  recordQuizAttempt,
} from '../services/agent/chat'
import type { AgentQuizAttempt, AgentQuizOptionQuote } from '../services/agent/chat'
import { formatQuizOptionQuotes } from '../services/agent/quizAttemptText'
import FolderPickerDialog from '../components/ui/FolderPickerDialog.vue'
import { databaseService } from '../services/app/database'
import type { AIModel } from '../services/model/config'
import { modelHasVision, useModelConfig } from '../services/model/config'
import ModelSelectorDialog from './home/ModelSelectorDialog.vue'
import { isTauriEnvironment } from '../services/app/environmentDetector'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import AgentApprovalBar from '../components/agent/AgentApprovalBar.vue'
import { agentApprovalState } from '../services/agent/agentApproval'
import AgentChatComposer from './agentChat/AgentChatComposer.vue'
import { useComposerAttachments } from './agentChat/useComposerAttachments'
import { useAgentFileDrop } from './agentChat/useAgentFileDrop'
import { AGENT_DOCUMENT_EXTENSIONS as DOCUMENT_EXTS } from '../services/agent/attachmentFiles'
import AgentChatSidebar from './agentChat/AgentChatSidebar.vue'
import AgentChatThread from './agentChat/AgentChatThread.vue'
import AgentChatWritePane from './agentChat/AgentChatWritePane.vue'
import AgentBrowserPane from './agentChat/AgentBrowserPane.vue'
import { currentWebsiteQuestions } from '../services/agent/websiteRuntime/observations'
import { agentBrowserExpanded, agentBrowserRevealRequest, currentAgentBrowser } from '../services/agent/agentBrowser'
import {
  bindAgentChatPanes,
  browserPaneVisible,
  closeGraphPane,
  finishOpenGraphStream,
  onGraphSelect,
  onOpenStudyGraph,
  onStudyGraphUpdated,
  openHomeworkPane,
  openedQuizKey,
  openedWriteStep,
  openedWriteStepId,
  paneGraphView,
  paneQuiz,
  revealBrowserPane,
  selectedAgentPane,
} from './agentChat/useAgentChatPanes'
import 'highlight.js/styles/github.css'

defineEmits<{
  'open-folder': [folderId: number]
}>()
const props = withDefaults(defineProps<{ active?: boolean; browserObscured?: boolean }>(), { active: true, browserObscured: false })

watch(agentBrowserRevealRequest, request => {
  if (props.active && request?.sessionId === activeChatId.value && !agentBrowserExpanded.value) revealBrowserPane()
})

const {
  availableModels,
  platforms,
  selectedAgentModel,
  selectedTextModel,
  setSelectedAgentModel,
} = useModelConfig()

const showModelSelector = ref(false)
const chooseVisionModel = ref(false)
let composerVersion = 0
const { imageError, readingImages, addAttachments, addAttachmentPaths, addDroppedFiles, pasteImages } = useComposerAttachments({
  version: () => composerVersion, active: () => props.active,
})

const openModelSelector = (requireVision = false) => {
  chooseVisionModel.value = requireVision
  showModelSelector.value = true
}

const selectedFilePath = (selected: unknown): string => {
  if (!selected) return ''
  if (typeof selected === 'string') return selected
  if (Array.isArray(selected)) return selectedFilePath(selected[0])
  if (typeof selected === 'object' && selected !== null && 'path' in selected) {
    return String((selected as { path?: unknown }).path || '')
  }
  return ''
}

const folderPickerVisible = ref(false)
const folderPickerMode = ref<'mention' | 'organize'>('mention')
const folderPickerInitialId = computed(() => {
  const tokens = parseFolderTokens(draft.value)
  return tokens.at(-1)?.folderId ?? null
})
const showFeatureCards = computed(() => !(activeChat.value?.messages.length))
watch([() => paneQuiz.value?.mode, () => !!openedWriteStep.value, () => !!paneGraphView.value], ([quiz, write, graph]) => {
  if (quiz === 'homework') {
    if (agentBrowserExpanded.value) browserPaneVisible.value = true
  } else if (quiz) browserPaneVisible.value = false
  if (quiz || write || graph) agentBrowserExpanded.value = false
})
const approvalPending = computed(() => (
  Boolean(agentApprovalState.pending && agentApprovalState.pending.sessionId === activeChat.value?.id)
))

const ensureAgentModel = () => {
  if (agentModel.value) return true
  alert('请先选择一个模型')
  openModelSelector()
  return false
}

const openFolderPicker = () => {
  composerCompRef.value?.saveComposerSelection()
  folderPickerMode.value = 'mention'
  folderPickerVisible.value = true
}

const cancelFolderPicker = () => {
  folderPickerVisible.value = false
  folderPickerMode.value = 'mention'
}

const resolvePickedFolderPath = async (folderId: number, folderName: string, folderPath: string) => {
  let path = String(folderPath || folderName || '').trim() || folderName
  try {
    const parts = await databaseService.getFolderPath(folderId)
    if (parts.length) path = parts.map((item) => item.name).join(' / ')
  } catch {
    // keep picker path
  }
  return path
}

const onFolderPicked = async (folderId: number, folderName: string, folderPath: string) => {
  const mode = folderPickerMode.value
  folderPickerVisible.value = false
  folderPickerMode.value = 'mention'
  if (!Number.isFinite(folderId) || folderId < 0) {
    return
  }
  const path = await resolvePickedFolderPath(folderId, folderName, folderPath)
  if (mode === 'organize') {
    if (folderId === 0) {
      alert('默认文件夹不能整理，请选择一个子文件夹')
      return
    }
    await startFolderOrganizeChat({ folderId, folderName, folderPath: path })
    return
  }
  composerCompRef.value?.insertFolderMention({
    folderId,
    folderName: folderName || '文件夹',
    folderPath: path,
  })
}

const startImportFromCard = async () => {
  if (!ensureAgentModel()) return
  if (!isTauriEnvironment()) {
    alert('此功能仅在应用中可用')
    return
  }
  try {
    const selected = await open({
      title: '选择要导入的文件',
      multiple: false,
      directory: false,
      filters: [{
        name: '文件',
        extensions: DOCUMENT_EXTS,
      }],
    })
    const filePath = selectedFilePath(selected)
    if (!filePath) return
    await startFileImportChat({ filePath })
  } catch (error) {
    console.error('选择导入文件失败:', error)
  }
}

const startOrganizeFromCard = () => {
  if (!ensureAgentModel()) return
  folderPickerMode.value = 'organize'
  folderPickerVisible.value = true
}

const fillComposer = async (text: string) => {
  await composerCompRef.value?.fillComposer(text)
}

const startExplainFromCard = () => {
  void fillComposer('请讲解这道题：')
}

const startQuizFromCard = () => {
  void fillComposer('请从题库出几道选择题练习。先看掌握度和练习记录，优先出未掌握或最近答错的，然后用 present_quiz 出示可点选的题目，给这次练习起个短标题，不要把选项写成普通列表。')
}

const startGraphFromCard = () => {
  draftStudyGraphChat()
}
const agentModel = computed(() => selectedAgentModel.value || selectedTextModel.value)
const agentModelLabel = computed(() => agentModel.value?.displayName || '选择模型')
const agentHasVision = computed(() => modelHasVision(agentModel.value))
const composerPlaceholder = '问问题，可粘贴或选择图片'

const onAgentModelSelected = (model: AIModel) => {
  setSelectedAgentModel(model.id)
  showModelSelector.value = false
}

const draft = ref('')
const quizOptionQuotes = ref<AgentQuizOptionQuote[]>([])
const composerHeight = ref(108)
const composerCompRef = ref<{
  fillComposer: (text: string) => Promise<void>
  focusComposer: () => void
  insertFolderMention: (folder: { folderId: number; folderName: string; folderPath: string }) => void
  saveComposerSelection: () => void
  syncDraftFromComposer: () => void
  clearComposer: () => void
  hideContextMenu: () => void
} | null>(null)
const composerFiles = computed(() => composerAttachments.value.filter(isFileAttachment))
const composerImages = computed(() => composerAttachments.value.filter(isImageAttachment))
const CONTEXT_RING = 2 * Math.PI * 7.2

const formatContextTokens = (value: number) => {
  const amount = Math.max(0, Math.round(value))
  if (amount >= 1024) {
    const k = amount / 1024
    return `${k >= 10 ? Math.round(k) : k.toFixed(1).replace(/\.0$/, '')}k`
  }
  return String(amount)
}

const contextUsage = computed(() => estimateAgentContext(
  activeChat.value,
  [draft.value, formatQuizOptionQuotes(quizOptionQuotes.value)].filter(Boolean).join('\n\n'),
  composerImages.value.length,
))

const contextUsageLabel = computed(() => {
  const usage = contextUsage.value
  return `${formatContextTokens(usage.used)} / ${formatContextTokens(usage.limit)} · ${usage.percent < 1 && usage.used > 0 ? usage.percent.toFixed(1) : Math.round(usage.percent)}%`
})

const contextRingDash = computed(() => {
  const filled = Math.max(0.8, (contextUsage.value.percent / 100) * CONTEXT_RING)
  return `${filled} ${CONTEXT_RING}`
})

const contextUsageRows = computed(() => {
  const usage = contextUsage.value
  const rows = [
    { label: '系统提示', value: usage.system },
    { label: '工具定义', value: usage.tools },
    { label: '前文摘要', value: usage.summary },
    { label: '历史对话', value: usage.history },
    { label: '学习状态', value: usage.study },
    { label: '当前输入', value: usage.draft },
    { label: '图片', value: usage.images },
    { label: '剩余', value: usage.remain },
    { label: '输出预留', value: usage.outputReserve || 0 },
  ]
  return rows
    .filter((row) => row.label === '剩余' || row.value > 0)
    .map((row) => ({ label: row.label, value: formatContextTokens(row.value) }))
})

const contextTipNote = computed(() => {
  if (contextCompacting.value) return '正在后台压缩前文…'
  const count = contextUsage.value.compactedCount
  return [contextUsage.value.estimatedWindow ? '模型未提供窗口大小，按 64k 估算' : '按当前模型窗口估算',
    '可用量已扣除输出预留与安全余量', count ? `早期 ${count} 条已归档，原文仍可检索` : ''].filter(Boolean).join('；')
})

const isDiskPath = (path?: string) => {
  const value = String(path || '').trim()
  return Boolean(value) && !value.startsWith('image:') && !value.startsWith('folder:') && !value.startsWith('data:')
}

const fileManagerLabel = /Mac/i.test(navigator.userAgent)
  ? '在访达中显示'
  : /Win/i.test(navigator.userAgent)
    ? '在资源管理器中显示'
    : '在文件夹中显示'

const previewImage = ref<{ imageUrl: string; fileName: string; filePath?: string } | null>(null)
const fileDropTarget = ref<HTMLElement | null>(null)
const fileDrop = useAgentFileDrop({
  target: fileDropTarget,
  enabled: () => props.active && !props.browserObscured && !agentBrowserExpanded.value && !showModelSelector.value && !folderPickerVisible.value && !previewImage.value,
  paths: addAttachmentPaths, files: addDroppedFiles,
  error: message => { imageError.value = message },
})

const openImagePreview = (item: { imageUrl?: string; fileName?: string; filePath?: string }) => {
  if (!item.imageUrl) return
  previewImage.value = {
    imageUrl: item.imageUrl,
    fileName: item.fileName || '图片',
    filePath: isDiskPath(item.filePath) ? item.filePath : undefined,
  }
}

const closeImagePreview = () => {
  previewImage.value = null
}

const revealInFileManager = async (filePath: string) => {
  if (!isDiskPath(filePath) || !isTauriEnvironment()) return
  try {
    await invoke('reveal_in_file_manager', { path: filePath })
  } catch (error) {
    console.error('打开文件位置失败:', error)
  }
}

const onPreviewKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') closeImagePreview()
}
const sending = computed(() =>
  Boolean(activeChat.value?.messages.some((message) => message.status === 'streaming'))
)

const canSubmit = computed(() =>
  Boolean((draft.value.trim() || composerFiles.value.length || composerImages.value.length || quizOptionQuotes.value.length)
    && !sending.value && !readingImages.value)
)

const onQuoteQuizOption = (option: AgentQuizOptionQuote) => {
  const { messageId, stepId, uid, key } = option
  if (!quizOptionQuotes.value.some(item => item.messageId === messageId && item.stepId === stepId && item.uid === uid && item.key === key)) {
    quizOptionQuotes.value.push(option)
  }
  composerCompRef.value?.focusComposer()
}

const onQuizAttempt = (messageId: string, attempt: AgentQuizAttempt) => {
  const sessionId = activeChatId.value
  if (sessionId) recordQuizAttempt(sessionId, messageId, attempt)
}

const onQuizExplain = async (messageId: string, attempt: AgentQuizAttempt) => {
  const sessionId = activeChatId.value
  if (!sessionId || sending.value || !ensureAgentModel()) return
  const { stepId, uid } = attempt
  const source = activeChat.value?.messages.find(message => message.id === messageId)
  if (!source) return
  if (!source.quizAttempts?.some(item => item.stepId === stepId && item.uid === uid && item.kind !== 'note')) {
    recordQuizAttempt(sessionId, messageId, attempt)
  }
  threadPinned.value = true
  const turn = sendChatMessage(formatQuizAttempt(attempt), undefined, {
    sessionId, quizAttemptRef: { messageId, stepId, uid },
  })
  await nextTick()
  jumpThreadToBottom()
  await turn
}

const submit = async () => {
  composerCompRef.value?.syncDraftFromComposer()
  const text = draft.value.trim()
  const quotes = quizOptionQuotes.value
  if (!canSubmit.value) return
  if (composerImages.value.length && !agentHasVision.value) {
    openModelSelector(true)
    return
  }
  const pending = consumeComposerAttachments()
  const files = pending.filter(isFileAttachment)
  const images = pending.filter(isImageAttachment)
  const folders = extractFolderAttachments(text)
  imageError.value = ''
  composerCompRef.value?.clearComposer()
  quizOptionQuotes.value = []
  threadPinned.value = true
  const message = text || (
    files.length
      ? `我附上了「${files.map((item) => item.fileName).join('、')}」。`
      : images.length ? '请看我附上的图片。' : ''
  )
  const turn = sendChatMessage(message, [...files, ...images, ...folders], { quizOptionQuotes: quotes })
  await nextTick()
  jumpThreadToBottom()
  await turn
}

const threadCompRef = ref<{
  jumpThreadToBottom: () => void
  hideSelectionMenu: () => void
} | null>(null)
const threadPinned = ref(true)

const jumpThreadToBottom = () => threadCompRef.value?.jumpThreadToBottom()
const hideSelectionMenu = () => threadCompRef.value?.hideSelectionMenu()

const onQuoteSelection = async (text: string) => {
  composerCompRef.value?.syncDraftFromComposer()
  const quote = text.split('\n').map((line) => `> ${line}`).join('\n')
  const next = draft.value.trim() ? `${draft.value.trim()}\n\n${quote}` : quote
  await fillComposer(next)
}

const onAskSelection = async (text: string) => {
  await fillComposer(`请解释下面这段内容：\n\n${text}`)
}

const onComposerPrefill = async (event: Event) => {
  const text = (event as CustomEvent<string>).detail
  await nextTick()
  await fillComposer(text)
}

watch(sending, (busy) => {
  if (busy) return
  finishOpenGraphStream()
}, { immediate: true })

watch(activeChatId, () => {
  composerVersion++
  composerCompRef.value?.clearComposer()
  quizOptionQuotes.value = []
  imageError.value = ''
  threadPinned.value = true
})

bindAgentChatPanes()
watch([() => props.active, () => activeChatId.value, () => {
  const browser = currentAgentBrowser.value
  return browser && activeChatId.value ? currentWebsiteQuestions(browser.id, activeChatId.value, browser.url) : undefined
}], ([active, , assignment]) => {
  if (active && typeof assignment === 'string' && assignment) openHomeworkPane(assignment)
}, { immediate: true })

onMounted(() => {
  document.addEventListener('keydown', onPreviewKeydown)
  window.addEventListener('study-graph-updated', onStudyGraphUpdated)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onPreviewKeydown)
  window.removeEventListener('study-graph-updated', onStudyGraphUpdated)
})
useWorkspaceEvent('agent', 'prefill-agent-composer', onComposerPrefill)
useWorkspaceEvent('agent', 'open-study-graph', onOpenStudyGraph)
</script>

<style scoped>
.chat-page {
  height: 100%;
  display: flex;
  gap: 4px;
  background: var(--bg-primary, #f5f5f7);
}

.file-drop-overlay {
  position: absolute;
  inset: 0;
  z-index: 40;
  display: grid;
  place-items: center;
  border-radius: inherit;
  background: color-mix(in srgb, var(--accent-primary, #3b82f6) 11%, transparent);
  pointer-events: none;
}
.file-drop-label {
  padding: 12px 22px;
  border-radius: 14px;
  background: var(--bg-secondary, #fff);
  color: var(--text-primary, #17212e);
  font-size: 16px;
  font-weight: 600;
  box-shadow: 0 4px 18px rgb(0 0 0 / 12%);
}
.file-drop-overlay.is-unsupported .file-drop-label { color: var(--color-error, #c2410c); }
.file-drop-enter-active, .file-drop-leave-active { transition: opacity 120ms cubic-bezier(0.23, 1, 0.32, 1); }
.file-drop-enter-from, .file-drop-leave-to { opacity: 0; }
@media (prefers-reduced-motion: reduce) {
  .file-drop-enter-active, .file-drop-leave-active { transition: none; }
}

.chat-page.list-collapsed {
  gap: 0;
}

.chat-workspace {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
  background: var(--bg-secondary, #fff);
  border-radius: 4px;
  margin-bottom: 5px;
  margin-right: 5px;
}

.chat-main {
  --chat-max-width: 720px;
  --chat-gutter: 20px;
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary, #fff);
}


.image-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 12000;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 32px;
  background: color-mix(in srgb, #000 62%, transparent);
  cursor: zoom-out;
}

.image-preview-photo {
  max-width: min(92vw, 1100px);
  max-height: min(82vh, 860px);
  border-radius: 10px;
  object-fit: contain;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.36);
  cursor: default;
}

.image-preview-reveal {
  height: 32px;
  padding: 0 12px;
  border: none;
  border-radius: 8px;
  background: color-mix(in srgb, #fff 16%, transparent);
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}

.image-preview-reveal:hover {
  background: color-mix(in srgb, #fff 24%, transparent);
}

.image-preview-enter-active,
.image-preview-leave-active {
  transition: opacity 0.16s ease;
}

.image-preview-enter-from,
.image-preview-leave-to {
  opacity: 0;
}
</style>
