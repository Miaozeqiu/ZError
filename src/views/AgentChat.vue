<template>
  <div class="chat-page" :class="{ 'list-collapsed': chatListCollapsed }">
    <AgentChatSidebar />

    <div class="chat-workspace">
      <section class="chat-main">
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
          @hide-composer-menu="composerCompRef?.hideMenu()"
        />
          <AgentChatComposer
            ref="composerCompRef"
            v-model:draft="draft"
            :thread-pinned="threadPinned"
            :composer-files="composerFiles"
            :composer-images="composerImages"
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
            @add-file="addFile"
            @add-image="addImage"
            @add-folder="openFolderPicker"
            @open-model="showModelSelector = true"
            @remove-attachment="removeComposerAttachment"
            @preview-image="openImagePreview"
            @reveal-file="revealInFileManager"
            @paste-image="addImageFromDataUrl"
            @hide-selection-menu="hideSelectionMenu"
          />
      </section>

      <AgentChatWritePane
        :quiz="paneQuiz"
        :write-step="openedWriteStep"
        :graph="paneGraphView"
        :folder-name="activeChat?.attachments?.[0]?.folderName || '题库'"
        @close-quiz="openedQuizKey = null"
        @close-write="openedWriteStepId = null"
        @close-graph="closeGraphPane"
        @quiz-attempt="onQuizAttempt"
        @graph-select="onGraphSelect"
        @width-change="scheduleSelectionPaint"
      />
    </div>

    <ModelSelectorDialog
      :show="showModelSelector"
      force-category="agent"
      :selected-text-model-ids="[]"
      :selected-vision-model-id="null"
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
import { computed, defineComponent, h, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import {
  activeChat,
  activeChatId,
  chatListCollapsed,
  addComposerAttachment,
  addComposerImage,
  composerAttachments,
  consumeComposerAttachments,
  isImageAttachment,
  startFileImportChat,
  startFolderOrganizeChat,
  startStudyGraphChat,
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
import type { AgentQuizAttempt } from '../services/agent/chat'
import FolderPickerDialog from '../components/ui/FolderPickerDialog.vue'
import { databaseService } from '../services/app/database'
import type { AIModel } from '../services/model/config'
import { modelHasVision, useModelConfig } from '../services/model/config'
import { readFileBase64 } from '../utils/ui/fileReader'
import { fileExtOf } from '../utils/ui/fileKind'
import ModelSelectorDialog from './home/ModelSelectorDialog.vue'
import { isTauriEnvironment } from '../services/app/environmentDetector'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import {
  InfographicBlockNode,
  MermaidBlockNode,
  setCustomComponents,
} from 'markstream-vue'
import AgentChatComposer from './agentChat/AgentChatComposer.vue'
import AgentChatSidebar from './agentChat/AgentChatSidebar.vue'
import AgentChatThread from './agentChat/AgentChatThread.vue'
import AgentChatWritePane from './agentChat/AgentChatWritePane.vue'
import AgentD2Block from '../components/agent/AgentD2Block.vue'
import AgentHtmlBlock from '../components/agent/AgentHtmlBlock.vue'
import AgentCodeBlock from '../components/agent/AgentCodeBlock.vue'
import {
  bindAgentChatPanes,
  closeGraphPane,
  finishOpenGraphStream,
  onGraphSelect,
  onOpenStudyGraph,
  onStudyGraphUpdated,
  openedQuizKey,
  openedWriteStep,
  openedWriteStepId,
  paneGraphView,
  paneQuiz,
} from './agentChat/useAgentChatPanes'
import '../services/model/markstream'
import 'markstream-vue/index.css'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github.css'

const ThematicBreak = defineComponent({
  name: 'AgentThematicBreak',
  inheritAttrs: false,
  setup() {
    return () => h('hr', { class: 'agent-hr' })
  },
})

setCustomComponents('agent-chat', {
  thematic_break: ThematicBreak,
  mermaid: MermaidBlockNode,
  d2: AgentD2Block,
  d2lang: AgentD2Block,
  infographic: InfographicBlockNode,
  html_block: AgentHtmlBlock,
  code_block: AgentCodeBlock,
})

defineEmits<{
  'open-folder': [folderId: number]
}>()

const {
  availableModels,
  platforms,
  selectedAgentModel,
  selectedTextModel,
  setSelectedAgentModel,
} = useModelConfig()

const showModelSelector = ref(false)

const selectedFilePath = (selected: unknown): string => {
  if (!selected) return ''
  if (typeof selected === 'string') return selected
  if (Array.isArray(selected)) return selectedFilePath(selected[0])
  if (typeof selected === 'object' && selected !== null && 'path' in selected) {
    return String((selected as { path?: unknown }).path || '')
  }
  return ''
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp']

const mimeFromName = (name: string) => {
  const ext = fileExtOf(name)
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  return 'image/png'
}

const addImageFromDataUrl = (imageUrl: string, fileName?: string, filePath?: string) => {
  if (!imageUrl.startsWith('data:image/')) return
  const added = addComposerImage({
    imageUrl,
    fileName: fileName || '图片',
    mimeType: imageUrl.slice(5, imageUrl.indexOf(';')) || 'image/png',
    filePath,
  })
  if (!added) alert('一次最多附带 4 张图片')
}

const addImage = async () => {
  if (!agentHasVision.value) return
  if (!isTauriEnvironment()) {
    alert('此功能仅在应用中可用')
    return
  }
  try {
    const selected = await open({
      title: '选择图片',
      multiple: true,
      directory: false,
      filters: [{ name: '图片', extensions: IMAGE_EXTS }],
    })
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : []
    for (const path of paths) {
      const filePath = String(path || '')
      if (!filePath) continue
      const fileName = filePath.split(/[\\/]/).pop() || '图片'
      const base64 = await readFileBase64(filePath)
      addImageFromDataUrl(`data:${mimeFromName(fileName)};base64,${base64}`, fileName, filePath)
    }
  } catch (error) {
    console.error('选择图片失败:', error)
  }
}

const addFile = async () => {
  if (!isTauriEnvironment()) {
    alert('此功能仅在应用中可用')
    return
  }
  try {
    const selected = await open({
      title: '选择文件',
      multiple: false,
      directory: false,
      filters: [{
        name: '文件',
        extensions: ['txt', 'md', 'csv', 'xlsx', 'xls', 'docx', 'doc', 'pdf'],
      }],
    })
    const filePath = selectedFilePath(selected)
    if (!filePath) return
    addComposerAttachment(filePath)
  } catch (error) {
    console.error('选择文件失败:', error)
  }
}

const folderPickerVisible = ref(false)
const folderPickerMode = ref<'mention' | 'organize' | 'import'>('mention')
const pendingImportPath = ref<string | null>(null)
const folderPickerInitialId = computed(() => {
  const tokens = parseFolderTokens(draft.value)
  return tokens.at(-1)?.folderId ?? null
})
const showFeatureCards = computed(() => !(activeChat.value?.messages.length))

const ensureAgentModel = () => {
  if (agentModel.value) return true
  alert('请先选择一个模型')
  showModelSelector.value = true
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
  pendingImportPath.value = null
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
    pendingImportPath.value = null
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
  if (mode === 'import') {
    const filePath = pendingImportPath.value
    pendingImportPath.value = null
    if (!filePath) return
    await startFileImportChat({ filePath, folderId, folderName, folderPath: path })
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
        extensions: ['txt', 'md', 'csv', 'xlsx', 'xls', 'docx', 'doc', 'pdf'],
      }],
    })
    const filePath = selectedFilePath(selected)
    if (!filePath) return
    pendingImportPath.value = filePath
    folderPickerMode.value = 'import'
    folderPickerVisible.value = true
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
  if (!ensureAgentModel()) return
  void startStudyGraphChat()
}
const agentModel = computed(() => selectedAgentModel.value || selectedTextModel.value)
const agentModelLabel = computed(() => agentModel.value?.displayName || '选择模型')
const agentHasVision = computed(() => modelHasVision(agentModel.value))
const composerPlaceholder = computed(() =>
  agentHasVision.value ? '问问题，可粘贴或选择图片' : '问问题，或让我把题目保存到题库'
)

const onAgentModelSelected = (model: AIModel) => {
  setSelectedAgentModel(model.id)
  showModelSelector.value = false
}

const draft = ref('')
const composerCompRef = ref<{
  fillComposer: (text: string) => Promise<void>
  insertFolderMention: (folder: { folderId: number; folderName: string; folderPath: string }) => void
  saveComposerSelection: () => void
  syncDraftFromComposer: () => void
  clearComposer: () => void
  hideMenu: () => void
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
  draft.value,
  composerImages.value.length,
))

const contextUsageLabel = computed(() => {
  const usage = contextUsage.value
  return `${formatContextTokens(usage.used)} / 256k · ${usage.percent < 1 && usage.used > 0 ? usage.percent.toFixed(1) : Math.round(usage.percent)}%`
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
  ]
  return rows
    .filter((row) => row.label === '剩余' || row.value > 0)
    .map((row) => ({ label: row.label, value: formatContextTokens(row.value) }))
})

const contextTipNote = computed(() => {
  if (contextCompacting.value) return '正在后台压缩前文…'
  const count = contextUsage.value.compactedCount
  return count ? `早期 ${count} 条已归档成摘要` : ''
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
  Boolean((draft.value.trim() || composerFiles.value.length || composerImages.value.length) && !sending.value)
)

const reportedQuiz = new Set<string>()
const pendingQuizReviews = ref<AgentQuizAttempt[]>([])
let flushingQuiz = false

const quizAttemptKey = (attempt: AgentQuizAttempt) => `${attempt.stepId}:${attempt.uid}`

const sendQuizAttempt = async (attempt: AgentQuizAttempt) => {
  threadPinned.value = true
  await nextTick()
  jumpThreadToBottom()
  await sendChatMessage(formatQuizAttempt(attempt))
}

const flushQuizReviews = async () => {
  if (flushingQuiz) return
  flushingQuiz = true
  try {
    while (pendingQuizReviews.value.length && activeChatId.value && !sending.value) {
      const attempt = pendingQuizReviews.value[0]
      pendingQuizReviews.value = pendingQuizReviews.value.slice(1)
      await sendQuizAttempt(attempt)
    }
  } finally {
    flushingQuiz = false
  }
}

const onQuizAttempt = (messageId: string, attempt: AgentQuizAttempt) => {
  const sessionId = activeChatId.value
  if (!sessionId) return
  recordQuizAttempt(sessionId, messageId, attempt)
  if (attempt.kind === 'note') return
  const key = quizAttemptKey(attempt)
  if (reportedQuiz.has(key)) return
  reportedQuiz.add(key)
  pendingQuizReviews.value = [...pendingQuizReviews.value, attempt]
  void flushQuizReviews()
}

const submit = async () => {
  composerCompRef.value?.syncDraftFromComposer()
  const text = draft.value.trim()
  const pending = consumeComposerAttachments()
  const files = pending.filter(isFileAttachment)
  const images = pending.filter(isImageAttachment)
  const folders = extractFolderAttachments(text)
  if ((!text && !files.length && !images.length) || sending.value) return
  if (images.length && !agentHasVision.value) {
    alert('当前模型没有视觉能力，请先选择带视觉的模型')
    composerAttachments.value = pending
    return
  }
  composerCompRef.value?.clearComposer()
  threadPinned.value = true
  await nextTick()
  jumpThreadToBottom()
  const message = text || (
    files.length
      ? `我附上了「${files.map((item) => item.fileName).join('、')}」。`
      : '请看我附上的图片。'
  )
  await sendChatMessage(message, [...files, ...images, ...folders])
}

const threadCompRef = ref<{
  jumpThreadToBottom: () => void
  hideSelectionMenu: () => void
  scheduleSelectionPaint: () => void
} | null>(null)
const threadPinned = ref(true)

const jumpThreadToBottom = () => threadCompRef.value?.jumpThreadToBottom()
const hideSelectionMenu = () => threadCompRef.value?.hideSelectionMenu()
const scheduleSelectionPaint = () => threadCompRef.value?.scheduleSelectionPaint()

const onQuoteSelection = async (text: string) => {
  composerCompRef.value?.syncDraftFromComposer()
  const quote = text.split('\n').map((line) => `> ${line}`).join('\n')
  const next = draft.value.trim() ? `${draft.value.trim()}\n\n${quote}` : quote
  await fillComposer(next)
}

const onAskSelection = async (text: string) => {
  await fillComposer(`请解释下面这段内容：\n\n${text}`)
}

watch(sending, (busy) => {
  if (busy) return
  void flushQuizReviews()
  finishOpenGraphStream()
}, { immediate: true })

watch(activeChatId, () => {
  composerCompRef.value?.clearComposer()
  threadPinned.value = true
})

bindAgentChatPanes()

onMounted(() => {
  document.addEventListener('keydown', onPreviewKeydown)
  window.addEventListener('study-graph-updated', onStudyGraphUpdated)
  window.addEventListener('open-study-graph', onOpenStudyGraph)
})

onUnmounted(() => {
  document.removeEventListener('keydown', onPreviewKeydown)
  window.removeEventListener('study-graph-updated', onStudyGraphUpdated)
  window.removeEventListener('open-study-graph', onOpenStudyGraph)
})
</script>

<style scoped>
.chat-page {
  height: 100%;
  display: flex;
  gap: 4px;
  background: var(--bg-primary, #f5f5f7);
}

.chat-page.list-collapsed {
  gap: 0;
}

.chat-workspace {
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
