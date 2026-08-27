<template>
  <div class="chat-page" :class="{ 'list-collapsed': chatListCollapsed }">
    <AgentChatSidebar />

    <div class="chat-workspace">
      <section class="chat-main">
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
              @import="startImportFromCard"
              @organize="startOrganizeFromCard"
              @explain="startExplainFromCard"
              @quiz="startQuizFromCard"
              @graph="startGraphFromCard"
            />
            <div
              v-for="(message, messageIndex) in activeChat?.messages || []"
              :key="message.id"
              class="chat-turn"
              :class="`is-${message.role}`"
            >
              <div v-if="message.role === 'user'" class="user-turn">
                <div v-if="imagesForMessage(message, messageIndex).length" class="user-images">
                  <template v-for="item in imagesForMessage(message, messageIndex)" :key="item.filePath">
                    <img
                      v-if="item.imageUrl"
                      class="user-image"
                      :src="item.imageUrl"
                      :alt="item.fileName"
                      title="预览图片"
                      @click="openImagePreview(item)"
                    />
                    <div v-else class="user-image is-missing">图片</div>
                  </template>
                </div>
                <div v-if="filesForMessage(message, messageIndex).length" class="user-files">
                  <div
                    v-for="item in filesForMessage(message, messageIndex)"
                    :key="item.filePath"
                    class="user-file"
                    :class="{ 'is-openable': isDiskPath(item.filePath) }"
                    :title="isDiskPath(item.filePath) ? fileManagerLabel : item.fileName"
                    @click="revealInFileManager(item.filePath)"
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

    <UnifiedContextMenu
      :visible="selectionMenuVisible"
      :x="selectionMenuX"
      :y="selectionMenuY"
      :menu-items="selectionMenuItems"
      exclusive-key="agent-chat-selection-menu"
      @item-click="onSelectionMenuClick"
      @close="selectionMenuVisible = false"
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
  parseMessageParts,
  removeComposerAttachment,
  sendChatMessage,
  estimateAgentContext,
  contextCompacting,
  stopChat,
  isChatBusy,
  hydrateQuizCards,
  formatQuizAttempt,
  recordQuizAttempt,
} from '../services/agent/chat'
import type { AgentQuizAttempt } from '../services/agent/chat'
import type { AgentChatMessage, AgentChatSession } from '../services/agent/chat'
import FolderPickerDialog from '../components/FolderPickerDialog.vue'
import UnifiedContextMenu, { type MenuItem } from '../components/UnifiedContextMenu.vue'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { databaseService } from '../services/app/database'
import type { AIModel } from '../services/model/config'
import { modelHasVision, useModelConfig } from '../services/model/config'
import { readFileBase64 } from '../utils/fileReader'
import type { ImportStepPreview, ImportTaskStep } from '../services/app/importTasks'
import ModelSelectorDialog from './home/ModelSelectorDialog.vue'
import { isTauriEnvironment } from '../services/app/environmentDetector'
import { themeState } from '../composables/useTheme'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import MarkdownRender, {
  InfographicBlockNode,
  MermaidBlockNode,
  setCustomComponents,
} from 'markstream-vue'
import AgentChatComposer from './agentChat/AgentChatComposer.vue'
import AgentChatFeatureCards from './agentChat/AgentChatFeatureCards.vue'
import AgentChatSidebar from './agentChat/AgentChatSidebar.vue'
import AgentChatWritePane from './agentChat/AgentChatWritePane.vue'
import AgentD2Block from '../components/AgentD2Block.vue'
import AgentHtmlBlock from '../components/AgentHtmlBlock.vue'
import AgentCodeBlock from '../components/AgentCodeBlock.vue'
import { useCustomScrollbar } from '../composables/useCustomScrollbar'
import { finishStudyGraphStream, studyGraphStream } from '../services/study/graphStream'
import { graphFromPayload, type StudyGraphNode } from '../utils/studyGraph'
import { getQuizCards, getQuizTitle, parseMarkdownQuizzes, parseOptions, parseQuizCards, stripMarkdownQuizzes, type QuizCard } from '../utils/quizPractice'
import '../services/model/markstream'
import { hljs } from '../utils/highlightSetup'
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
const threadScroll = useCustomScrollbar()
const threadRef = threadScroll.contentRef
const threadBarRef = threadScroll.barRef
const threadThumbRef = threadScroll.thumbRef
const openedWriteStepId = ref<string | null>(null)
const WRITE_PREVIEW_COUNT = 3
const sending = computed(() =>
  Boolean(activeChat.value?.messages.some((message) => message.status === 'streaming'))
)

const quizCardsFor = (step: ImportTaskStep): QuizCard[] => {
  const stored = getQuizCards(step.id)
  if (stored.length) return stored
  return parseQuizCards(step.preview || [])
}

const quizTitleFor = (step?: ImportTaskStep, stepId?: string) =>
  getQuizTitle(step?.id || stepId || '', '') || step?.title || '练习'

const isBrowseQuizStep = (step?: ImportTaskStep) =>
  step?.name === 'list_campus_questions'
  || step?.name === 'search_campus_questions'
  || step?.name === 'save_campus_questions'
  || step?.name === 'update_campus_question'

const isQuizStep = (step: ImportTaskStep) =>
  (step.name === 'present_quiz' || isBrowseQuizStep(step))
  && step.status === 'done'
  && quizCardsFor(step).length > 0

const mdQuizCache = ref<Record<string, QuizCard[]>>({})

const stepQuizCards = (message: AgentChatMessage) =>
  (message.steps || [])
    .filter((step) => isQuizStep(step))
    .flatMap((step) => quizCardsFor(step))

const fallbackQuizCards = (message: AgentChatMessage) => {
  if (stepQuizCards(message).length) return []
  const parsed = parseMarkdownQuizzes(message.content)
  if (!parsed.length) return []
  return mdQuizCache.value[message.id] || parsed
}

const displayAssistantContent = (message: AgentChatMessage) => {
  const dumped = parseMarkdownQuizzes(message.content)
  if (!dumped.length) return message.content
  const stripped = stripMarkdownQuizzes(message.content, dumped)
  return stripped || '请在右侧练习页作答。'
}

const hydrateMessageQuiz = async (message: AgentChatMessage) => {
  if (message.role !== 'assistant' || message.status === 'streaming') return
  if (stepQuizCards(message).length || mdQuizCache.value[message.id]) return
  const parsed = parseMarkdownQuizzes(message.content)
  if (!parsed.length) return
  mdQuizCache.value[message.id] = await hydrateQuizCards(parsed)
}

const typeTagKind = (type?: string) => {
  const text = String(type || '').replace(/\s/g, '')
  if (/多选|多项|不定项/.test(text)) return 'multiple'
  if (/判断/.test(text)) return 'judgement'
  if (/填空|简答|解答/.test(text)) return 'fill'
  if (/单选|单项/.test(text)) return 'single'
  return 'other'
}

const visibleSteps = (steps: ImportTaskStep[]) => {
  const items: ImportTaskStep[] = []
  for (const step of steps) {
    if (step.name === 'evaluate_study_progress') continue
    const dup = items.find((item) => {
      if (item.name !== step.name) return false
      if (item.name === 'get_file_info' || item.name === 'list_folders') return true
      return item.target === step.target && item.label === step.label
    })
    if (!dup) {
      items.push(step)
      continue
    }
    if (step.status === 'done' || step.status === 'failed') {
      items[items.indexOf(dup)] = { ...dup, ...step, id: dup.id }
    }
  }
  return items
}

const isThinking = (message: AgentChatMessage) =>
  message.status === 'streaming' && message.waiting !== false

const visiblePreview = (step: ImportTaskStep): ImportStepPreview[] => {
  const items = step.preview || []
  if (items.length <= WRITE_PREVIEW_COUNT) return items
  return items.slice(0, WRITE_PREVIEW_COUNT)
}

const openedQuizKey = ref<string | null>(null)

const quizKeyOf = (messageId: string, stepId: string) => `${messageId}\t${stepId}`

const isQuizOpen = (messageId: string, stepId: string) =>
  openedQuizKey.value === quizKeyOf(messageId, stepId)

const quizStatFor = (message: AgentChatMessage, stepId: string, cards: QuizCard[], browse = false) => {
  if (browse) return `${cards.length} 题`
  const done = new Set((message.quizAttempts || []).map((item) => item.uid))
  const answered = cards.filter((card) => done.has(card.uid)).length
  if (message.quizReported || (cards.length && answered >= cards.length)) return `已完成 ${cards.length}`
  if (answered) return `${answered}/${cards.length}`
  return `${cards.length} 题`
}

const latestQuizKey = computed(() => {
  const messages = [...(activeChat.value?.messages || [])].reverse()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const step of [...(message.steps || [])].reverse()) {
      if (isQuizStep(step)) return quizKeyOf(message.id, step.id)
    }
    if (fallbackQuizCards(message).length) return quizKeyOf(message.id, `${message.id}-md`)
  }
  return null
})

const openedQuiz = computed(() => {
  if (!openedQuizKey.value) return null
  const [messageId, stepId] = openedQuizKey.value.split('\t')
  const message = activeChat.value?.messages.find((item) => item.id === messageId)
  if (!message || !stepId) return null
  const step = message.steps.find((item) => item.id === stepId)
  const cards = stepId.endsWith('-md')
    ? fallbackQuizCards(message)
    : step
      ? quizCardsFor(step)
      : getQuizCards(stepId)
  if (!cards.length) return null
  return {
    messageId,
    stepId,
    cards,
    message,
    title: quizTitleFor(step, stepId),
    mode: isBrowseQuizStep(step) ? 'browse' as const : 'practice' as const,
  }
})

const paneQuiz = computed(() => {
  const quiz = openedQuiz.value
  if (!quiz) return null
  return {
    messageId: quiz.messageId,
    stepId: quiz.stepId,
    cards: quiz.cards,
    title: quiz.title,
    mode: quiz.mode,
    stat: quizStatFor(quiz.message, quiz.stepId, quiz.cards, quiz.mode === 'browse'),
  }
})

const openedGraphSubjectId = ref<number | null>(null)
const paneGraph = ref<StudyGraphNode | null>(null)
const paneGraphName = ref('')
const paneGraphCount = ref(0)
const graphFocusName = ref('')
const lastGraphFocus = new Map<number, string>()
const openedGraph = computed(() => openedGraphSubjectId.value != null)
const graphStreaming = computed(() => {
  const stream = studyGraphStream.value
  const id = openedGraphSubjectId.value
  return Boolean(
    stream?.streaming
    && isChatBusy.value
    && (stream.subjectId == null || id == null || stream.subjectId === id),
  )
})
const graphEmptyText = computed(() =>
  graphStreaming.value ? 'Agent 正在绘制知识图谱' : '这个科目还没有图谱',
)
const graphPaneStat = computed(() => {
  if (graphStreaming.value && !paneGraphCount.value) return '正在绘制'
  if (graphStreaming.value) return `${paneGraphCount.value} 个 · 绘制中`
  return paneGraphCount.value ? `${paneGraphCount.value} 个节点` : ''
})

const paneGraphView = computed(() => {
  if (!openedGraph.value) return null
  return {
    name: paneGraphName.value || '知识图谱',
    stat: graphPaneStat.value,
    graph: paneGraph.value,
    streaming: graphStreaming.value,
    selectedName: graphFocusName.value,
    emptyText: graphEmptyText.value,
  }
})

const loadPaneGraph = async (id: number) => {
  try {
    const payload = await databaseService.getStudyGraph(id)
    paneGraph.value = payload.nodes.length ? graphFromPayload(payload) : null
    paneGraphName.value = payload.subject?.name || paneGraph.value?.name || '知识图谱'
    paneGraphCount.value = payload.nodes.length
  } catch {
    paneGraph.value = null
    paneGraphCount.value = 0
  }
}

const rememberGraphFocus = (subjectId: number, name: string) => {
  const focus = String(name || '').trim()
  if (focus) lastGraphFocus.set(subjectId, focus)
  else lastGraphFocus.delete(subjectId)
}

const onGraphSelect = (name: string) => {
  graphFocusName.value = name
  const id = openedGraphSubjectId.value
  if (id != null) rememberGraphFocus(id, name)
}

const openGraphPane = (subjectId: number, nodeName?: string) => {
  openedQuizKey.value = null
  openedWriteStepId.value = null
  openedGraphSubjectId.value = subjectId
  const focus = String(nodeName || lastGraphFocus.get(subjectId) || '').trim()
  graphFocusName.value = focus
  void loadPaneGraph(subjectId)
}

const closeGraphPane = () => {
  openedGraphSubjectId.value = null
}

const onStudyGraphUpdated = (event: Event) => {
  const id = Number((event as CustomEvent<{ subjectId?: number }>).detail?.subjectId)
  const current = openedGraphSubjectId.value
  if (current == null) return
  void loadPaneGraph(Number.isFinite(id) && id > 0 ? id : current)
}

const onOpenStudyGraph = (event: Event) => {
  const detail = (event as CustomEvent<{ subjectId?: number; expand?: boolean; nodeName?: string }>).detail
  const id = Number(detail?.subjectId)
  if (!Number.isFinite(id) || id <= 0) return
  openGraphPane(id, detail?.nodeName)
}

const toggleQuiz = (messageId: string, stepId: string) => {
  const key = quizKeyOf(messageId, stepId)
  if (openedQuizKey.value === key) {
    openedQuizKey.value = null
    return
  }
  openedWriteStepId.value = null
  openedGraphSubjectId.value = null
  openedQuizKey.value = key
}

const openWrite = (stepId: string) => {
  openedQuizKey.value = null
  openedGraphSubjectId.value = null
  openedWriteStepId.value = openedWriteStepId.value === stepId ? null : stepId
}

const openedWriteStep = computed(() => {
  for (const message of activeChat.value?.messages || []) {
    const step = message.steps.find((item) => item.id === openedWriteStepId.value)
    if (step) return step
  }
  return null
})

const iconPaths = (name: string) => {
  if (name === 'get_file_info') {
    return ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8', 'M8 17h5']
  }
  if (name === 'read_range') {
    return ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z']
  }
  if (name === 'list_folders' || name === 'get_folder_info') {
    return ['M3 7h6l2 2h10v10H3z']
  }
  if (name === 'create_folder') {
    return ['M3 7h6l2 2h8v8H3z', 'M12 11v6', 'M9 14h6']
  }
  if (name === 'rename_folder') {
    return ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z']
  }
  if (name === 'move_folder') {
    return ['M3 7h6l2 2h10v10H3z', 'M8 14h8', 'M13 11l3 3-3 3']
  }
  if (name === 'delete_folder') {
    return ['M4 7h16', 'M9 7V5h6v2', 'M6 7l1 12h10l1-12']
  }
  if (name === 'list_questions' || name === 'search_questions') {
    return ['M4 6h16', 'M4 12h16', 'M4 18h10']
  }
  if (
    name === 'get_campus_status'
    || name === 'list_campus_courses'
    || name === 'list_campus_papers'
    || name === 'list_campus_questions'
    || name === 'search_campus_questions'
    || name === 'list_campus_tags'
    || name === 'create_campus_paper'
    || name === 'update_campus_paper'
    || name === 'save_campus_questions'
    || name === 'update_campus_question'
  ) {
    return ['M4 4h16v6H4z', 'M4 14h7v6H4z', 'M13 14h7v6h-7z']
  }
  if (name === 'move_questions') {
    return ['M4 6h10', 'M4 12h10', 'M4 18h7', 'M14 15l4 3-4 3', 'M18 18H9']
  }
  if (name === 'save_questions') {
    return ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z']
  }
  if (name === 'update_question_metrics') {
    return ['M4 7h16', 'M4 12h10', 'M4 17h7']
  }
  if (name === 'list_recent_wrong_questions' || name === 'get_practice_history' || name === 'add_practice_note') {
    return ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6', 'M8 13h8', 'M8 17h5']
  }
  if (name === 'present_quiz') {
    return ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11']
  }
  if (name === 'list_subjects' || name === 'get_subject' || name === 'create_subject' || name === 'rename_subject' || name === 'delete_subject') {
    return ['M4 19.5A2.5 2.5 0 0 1 6.5 17H20', 'M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z']
  }
  if (name === 'get_knowledge_graph' || name === 'set_knowledge_graph' || name === 'patch_knowledge_graph' || name === 'focus_knowledge_graph' || name === 'open_knowledge_graph') {
    return ['M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M8 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M16 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M8 8l8 1', 'M7 9l2 6', 'M16 10l-1 4']
  }
  if (name === 'evaluate_study_progress') {
    return ['M3 17c3-8 6-10 9-10s6 2 9 10', 'M12 7v10']
  }
  return ['M12 3v3', 'M12 18v3', 'M3 12h3', 'M18 12h3']
}

const canSubmit = computed(() =>
  Boolean((draft.value.trim() || composerFiles.value.length || composerImages.value.length) && !sending.value)
)

const firstUserMessageId = computed(() =>
  activeChat.value?.messages.find((message) => message.role === 'user')?.id || null
)

const attachmentsForMessage = (message: AgentChatSession['messages'][number]) => {
  if (message.attachments?.length) return message.attachments
  if (
    message.role === 'user'
    && message.id === firstUserMessageId.value
    && !activeChat.value?.messages.some((item) => item.attachments?.length)
    && activeChat.value?.attachments?.length
  ) {
    return activeChat.value.attachments
  }
  return []
}

const filesForMessage = (message: AgentChatSession['messages'][number], _index: number) =>
  attachmentsForMessage(message).filter(isFileAttachment)

const imagesForMessage = (message: AgentChatSession['messages'][number], _index: number) =>
  attachmentsForMessage(message).filter(isImageAttachment)

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

const THREAD_PIN_PX = 72
const threadPinned = ref(true)
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

const quoteSelectedChatText = async () => {
  const text = selectedChatText()
  if (!text) return
  composerCompRef.value?.syncDraftFromComposer()
  const quote = text.split('\n').map((line) => `> ${line}`).join('\n')
  const next = draft.value.trim() ? `${draft.value.trim()}\n\n${quote}` : quote
  await fillComposer(next)
}

const askSelectedChatText = async () => {
  const text = selectedChatText()
  if (!text) return
  await fillComposer(`请解释下面这段内容：\n\n${text}`)
}

const onSelectionMenuClick = async (item: MenuItem) => {
  hideSelectionMenu()
  if (item.action === 'copy') await copySelectedChatText()
  if (item.action === 'quote') await quoteSelectedChatText()
  if (item.action === 'ask') await askSelectedChatText()
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
  composerCompRef.value?.hideMenu()
}

const onSelectionMenuKeydown = (event: KeyboardEvent) => {
  if (event.key !== 'Escape') return
  hideSelectionMenu()
  composerCompRef.value?.hideMenu()
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

watch(
  () => activeChat.value?.messages.map((message) => `${message.id}:${message.status}:${message.content.length}`).join('|'),
  () => {
    for (const message of activeChat.value?.messages || []) {
      void hydrateMessageQuiz(message)
    }
  },
  { immediate: true },
)

watch(sending, (busy) => {
  if (busy) return
  void flushQuizReviews()
  const id = openedGraphSubjectId.value ?? activeChat.value?.studySubjectId
  finishStudyGraphStream(id == null ? undefined : id)
}, { immediate: true })

watch(activeChatId, async () => {
  openedWriteStepId.value = null
  cancelThreadJump()
  cancelThreadSettle()
  threadPinned.value = true
  clearCustomSelection()
  composerCompRef.value?.clearComposer()
  await nextTick()
  threadScroll.bind()
  scheduleHighlight()
  snapThreadToBottom()
  settleThreadToBottom()
})

watch(latestQuizKey, (key) => {
  if (!key) {
    openedQuizKey.value = null
    return
  }
  openedWriteStepId.value = null
  openedGraphSubjectId.value = null
  openedQuizKey.value = key
}, { immediate: true })

watch(
  () => {
    const stream = studyGraphStream.value
    return stream ? `${stream.streaming ? 1 : 0}:${stream.subjectId ?? ''}` : ''
  },
  (curr, prev) => {
    const stream = studyGraphStream.value
    if (!stream?.subjectId) return
    const started = curr.startsWith('1:') && !String(prev || '').startsWith('1:')
    if (started) {
      openGraphPane(stream.subjectId)
      return
    }
    if (openedGraphSubjectId.value === stream.subjectId) void loadPaneGraph(stream.subjectId)
  },
)

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
  // 恢复的会话在挂载前就已是激活状态，activeChatId 的 watch 不会触发
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
  document.addEventListener('keydown', onPreviewKeydown)
  window.addEventListener('resize', scheduleSelectionPaint)
  window.addEventListener('study-graph-updated', onStudyGraphUpdated)
  window.addEventListener('open-study-graph', onOpenStudyGraph)
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
  document.removeEventListener('keydown', onPreviewKeydown)
  window.removeEventListener('resize', scheduleSelectionPaint)
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

@media (prefers-reduced-motion: reduce) {
  .activity-text.is-live,
  .assistant-thinking,
  .study-eval-note.is-running {
    animation: none;
    opacity: 1;
  }
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
