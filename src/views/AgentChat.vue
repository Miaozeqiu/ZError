<template>
  <div class="chat-page">
    <aside class="chat-sidebar">
      <div class="pane-header">
        <div class="header-title">对话</div>
        <button class="header-action" type="button" @click="() => createChat()">新对话</button>
      </div>
      <div class="chat-list-wrap">
        <div ref="listRef" class="chat-list">
          <div
            v-for="session in chatSessions"
            :key="session.id"
            class="chat-item"
            :class="{
              'is-selected': session.id === activeChatId,
              'is-running': isSessionRunning(session)
            }"
            @click="selectChat(session.id)"
          >
            <div class="chat-item-main">
              <div class="chat-item-name">{{ session.title || '新对话' }}</div>
            </div>
            <button
              class="chat-item-delete"
              type="button"
              title="删除对话"
              @click.stop="removeChat(session.id)"
            >
              <span class="chat-item-spinner" aria-hidden="true"></span>
              <svg class="chat-item-close" viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <path d="M18 6 6 18" />
                <path d="m6 6 12 12" />
              </svg>
            </button>
          </div>
          <div v-if="!chatSessions.length" class="list-empty">还没有对话</div>
        </div>
        <div
          class="custom-scrollbar"
          :class="{ 'is-visible': scrollbarVisible.list }"
          ref="listBarRef"
          @mousedown="onScrollbarMousedown('list', $event)"
        >
          <div class="custom-scrollbar-thumb" ref="listThumbRef"></div>
        </div>
      </div>
    </aside>

    <div class="chat-workspace">
      <section class="chat-main">
        <div v-if="!activeChat" class="detail-empty">
          <div>问一道题，或从题库把文件发给我导入</div>
          <button class="start-btn" type="button" @click="() => createChat()">开始对话</button>
          <button class="composer-model is-empty" type="button" @click="showModelSelector = true">
            {{ agentModelLabel }}
          </button>
        </div>

        <template v-else>
          <div class="chat-thread-wrap">
          <div
            ref="threadRef"
            class="chat-thread"
            @scroll.passive="updateThreadPinned"
            @pointerdown="onThreadPointerDown"
          >
            <div
              v-for="(message, messageIndex) in activeChat.messages"
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
                  v-if="message.content"
                  class="assistant-text"
                >
                  <MarkdownRender
                    :key="message.id"
                    custom-id="agent-chat"
                    mode="chat"
                    :content="message.content"
                    :final="message.status !== 'streaming'"
                    :index-key="message.id"
                    :max-live-nodes="0"
                    :batch-rendering="true"
                    :render-batch-size="16"
                    :render-batch-delay="8"
                    :render-batch-budget-ms="4"
                    :fade="message.status !== 'streaming'"
                    :smooth-streaming="message.status === 'streaming' ? 'auto' : false"
                    :typewriter="message.status === 'streaming' ? 'simple' : false"
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
            :class="{ 'is-visible': scrollbarVisible.thread }"
            ref="threadBarRef"
            @mousedown="onScrollbarMousedown('thread', $event)"
          >
            <div class="custom-scrollbar-thumb" ref="threadThumbRef"></div>
          </div>
          </div>

          <form class="composer" @submit.prevent="submit">
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
                    @click="openImagePreview(item)"
                  />
                  <button
                    class="composer-file-remove"
                    type="button"
                    title="移除"
                    @click.stop="removeComposerAttachment(item.filePath)"
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
                  @click="revealInFileManager(item.filePath)"
                >
                  <span class="composer-file-icon" :class="'is-' + fileTypeOf(item.fileName)">
                    {{ fileTypeLabel(item.fileName) }}
                  </span>
                  <span class="composer-file-name">{{ item.fileName }}</span>
                  <button
                    class="composer-file-remove"
                    type="button"
                    title="移除"
                    @click.stop="removeComposerAttachment(item.filePath)"
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
                :class="{ 'is-empty': !draft.trim() }"
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
              />
              <div class="composer-toolbar">
                <button class="composer-add" type="button" title="添加文件" @click="addFile">
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
                  @click="addImage"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="5" width="18" height="14" rx="2" />
                    <circle cx="8.5" cy="10" r="1.5" />
                    <path d="M21 16l-5-5-4 4-2-2-5 5" />
                  </svg>
                </button>
                <button class="composer-add" type="button" title="添加文件夹" @mousedown.prevent="saveComposerSelection" @click="openFolderPicker">
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
                  </svg>
                </button>
                <button class="composer-model" type="button" @click="showModelSelector = true" :title="agentModelLabel">
                  {{ agentModelLabel }}
                </button>
                <button
                  v-if="sending"
                  class="composer-send is-stop"
                  type="button"
                  aria-label="终止对话"
                  title="终止对话"
                  @click="() => stopChat()"
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
        </template>
      </section>

      <Transition name="write-pane">
        <aside v-if="openedWriteStep" class="write-pane">
          <div class="write-pane-inner">
            <div class="write-pane-head">
              <div class="write-file">
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                  <path d="M14 2v6h6" />
                </svg>
                {{ activeChat?.attachments?.[0]?.folderName || '题库' }}
              </div>
              <span class="write-stat">+{{ openedWriteStep.previewCount || openedWriteStep.preview?.length || 0 }}</span>
              <button class="header-action" type="button" @click="openedWriteStepId = null">关闭</button>
            </div>
            <div class="write-pane-body-wrap">
            <div ref="writePaneBodyRef" class="write-pane-body">
              <div
                v-for="(item, index) in openedWriteStep.preview || []"
                :key="`${openedWriteStep.id}-full-${index}`"
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
                      :key="`${openedWriteStep.id}-full-${index}-${option.key}-${option.text}`"
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
            </div>
            <div
              class="custom-scrollbar"
              :class="{ 'is-visible': scrollbarVisible.write }"
              ref="writeBarRef"
              @mousedown="onScrollbarMousedown('write', $event)"
            >
              <div class="custom-scrollbar-thumb" ref="writeThumbRef"></div>
            </div>
            </div>
          </div>
        </aside>
      </Transition>
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
      @cancel="folderPickerVisible = false"
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
  chatSessions,
  addComposerAttachment,
  addComposerImage,
  composerAttachments,
  consumeComposerAttachments,
  isImageAttachment,
  createChat,
  encodeFolderToken,
  extractFolderAttachments,
  isFileAttachment,
  parseFolderTokens,
  parseMessageParts,
  removeChat,
  removeComposerAttachment,
  selectChat,
  sendChatMessage,
  stopChat,
} from '../services/agentChat'
import type { AgentChatMessage, AgentChatSession } from '../services/agentChat'
import FolderPickerDialog from '../components/FolderPickerDialog.vue'
import { databaseService } from '../services/database'
import type { AIModel } from '../services/modelConfig'
import { modelHasVision, useModelConfig } from '../services/modelConfig'
import { readFileBase64 } from '../utils/fileReader'
import type { ImportStepPreview, ImportTaskStep } from '../services/importTasks'
import ModelSelectorDialog from './home/ModelSelectorDialog.vue'
import { isTauriEnvironment } from '../services/environmentDetector'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import MarkdownRender, {
  InfographicBlockNode,
  MermaidBlockNode,
  setCustomComponents,
} from 'markstream-vue'
import AgentD2Block from '../components/AgentD2Block.vue'
import '../services/markstream'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import c from 'highlight.js/lib/languages/c'
import cpp from 'highlight.js/lib/languages/cpp'
import csharp from 'highlight.js/lib/languages/csharp'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import markdown from 'highlight.js/lib/languages/markdown'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import 'markstream-vue/index.css'
import 'katex/dist/katex.min.css'
import 'highlight.js/styles/github.css'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('sh', bash)
hljs.registerLanguage('shell', bash)
hljs.registerLanguage('c', c)
hljs.registerLanguage('cpp', cpp)
hljs.registerLanguage('csharp', csharp)
hljs.registerLanguage('css', css)
hljs.registerLanguage('go', go)
hljs.registerLanguage('java', java)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('js', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('markdown', markdown)
hljs.registerLanguage('md', markdown)
hljs.registerLanguage('python', python)
hljs.registerLanguage('py', python)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('ts', typescript)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('yaml', yaml)
hljs.registerLanguage('yml', yaml)

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

const fileToDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
  const reader = new FileReader()
  reader.onload = () => resolve(String(reader.result || ''))
  reader.onerror = () => reject(reader.error)
  reader.readAsDataURL(file)
})

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
const folderPickerInitialId = computed(() => {
  const tokens = parseFolderTokens(draft.value)
  return tokens.at(-1)?.folderId ?? null
})

const openFolderPicker = () => {
  saveComposerSelection()
  folderPickerVisible.value = true
}

const onFolderPicked = async (folderId: number, folderName: string, folderPath: string) => {
  folderPickerVisible.value = false
  if (!Number.isFinite(folderId) || folderId < 0) return
  let path = String(folderPath || folderName || '').trim() || folderName
  try {
    const parts = await databaseService.getFolderPath(folderId)
    if (parts.length) path = parts.map((item) => item.name).join(' / ')
  } catch {
    // keep picker path
  }
  insertFolderMention({
    folderId,
    folderName: folderName || '文件夹',
    folderPath: path,
  })
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
const composerRef = ref<HTMLElement | null>(null)
const composerFiles = computed(() => composerAttachments.value.filter(isFileAttachment))
const composerImages = computed(() => composerAttachments.value.filter(isImageAttachment))

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

const onComposerInput = () => {
  if (composing.value) {
    resizeComposer()
    return
  }
  syncDraftFromComposer()
  resizeComposer()
}

const onComposerPaste = async (event: ClipboardEvent) => {
  const items = Array.from(event.clipboardData?.items || [])
  const imageItems = agentHasVision.value
    ? items.filter((item) => item.type.startsWith('image/'))
    : []
  if (imageItems.length) {
    event.preventDefault()
    for (const item of imageItems) {
      const file = item.getAsFile()
      if (!file) continue
      try {
        addImageFromDataUrl(await fileToDataUrl(file), file.name || '粘贴的图片')
      } catch (error) {
        console.error('粘贴图片失败:', error)
      }
    }
    return
  }
  const text = event.clipboardData?.getData('text/plain') || ''
  if (!text) return
  event.preventDefault()
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

const clearComposer = () => {
  draft.value = ''
  savedComposerRange = null
  const input = composerRef.value
  if (!input) return
  input.innerHTML = ''
  input.style.height = `${COMPOSER_LINE_HEIGHT}px`
  input.style.overflowY = 'hidden'
}
const threadRef = ref<HTMLElement | null>(null)
const listRef = ref<HTMLElement | null>(null)
const writePaneBodyRef = ref<HTMLElement | null>(null)
const listBarRef = ref<HTMLElement | null>(null)
const listThumbRef = ref<HTMLElement | null>(null)
const threadBarRef = ref<HTMLElement | null>(null)
const threadThumbRef = ref<HTMLElement | null>(null)
const writeBarRef = ref<HTMLElement | null>(null)
const writeThumbRef = ref<HTMLElement | null>(null)
const openedWriteStepId = ref<string | null>(null)
const WRITE_PREVIEW_COUNT = 3
const sending = computed(() =>
  Boolean(activeChat.value?.messages.some((message) => message.status === 'streaming'))
)

type ScrollbarPaneKey = 'list' | 'thread' | 'write'

const scrollbarVisible = ref<Record<ScrollbarPaneKey, boolean>>({
  list: false,
  thread: false,
  write: false,
})

const paneContentRefs: Record<ScrollbarPaneKey, typeof listRef> = {
  list: listRef,
  thread: threadRef,
  write: writePaneBodyRef,
}

const paneBarRefs: Record<ScrollbarPaneKey, typeof listBarRef> = {
  list: listBarRef,
  thread: threadBarRef,
  write: writeBarRef,
}

const paneThumbRefs: Record<ScrollbarPaneKey, typeof listThumbRef> = {
  list: listThumbRef,
  thread: threadThumbRef,
  write: writeThumbRef,
}

const paneHideTimers: Record<ScrollbarPaneKey, ReturnType<typeof setTimeout> | null> = {
  list: null,
  thread: null,
  write: null,
}

const paneCleanupMap = new Map<ScrollbarPaneKey, () => void>()

const hideScrollbar = (key: ScrollbarPaneKey) => {
  scrollbarVisible.value[key] = false
  if (paneHideTimers[key]) {
    clearTimeout(paneHideTimers[key])
    paneHideTimers[key] = null
  }
}

const showScrollbar = (key: ScrollbarPaneKey) => {
  const content = paneContentRefs[key].value
  if (!content || content.scrollHeight <= content.clientHeight + 1) {
    hideScrollbar(key)
    return
  }
  scrollbarVisible.value[key] = true
  if (paneHideTimers[key]) clearTimeout(paneHideTimers[key])
  paneHideTimers[key] = setTimeout(() => {
    scrollbarVisible.value[key] = false
  }, 1500)
}

const updateScrollbarThumb = (key: ScrollbarPaneKey) => {
  const content = paneContentRefs[key].value
  const thumb = paneThumbRefs[key].value
  const bar = paneBarRefs[key].value
  if (!content || !thumb || !bar) return

  const ratio = content.clientHeight / content.scrollHeight
  if (!Number.isFinite(ratio) || ratio >= 1) {
    thumb.style.height = '0px'
    thumb.style.transform = 'translateY(0)'
    hideScrollbar(key)
    return
  }

  const thumbHeight = Math.max(ratio * bar.clientHeight, 32)
  const maxThumbTop = Math.max(bar.clientHeight - thumbHeight, 0)
  const maxScrollTop = Math.max(content.scrollHeight - content.clientHeight, 1)
  const thumbTop = (content.scrollTop / maxScrollTop) * maxThumbTop
  thumb.style.height = `${thumbHeight}px`
  thumb.style.transform = `translateY(${thumbTop}px)`
}

const onScrollbarMousedown = (key: ScrollbarPaneKey, event: MouseEvent) => {
  const thumb = paneThumbRefs[key].value
  const content = paneContentRefs[key].value
  const bar = paneBarRefs[key].value
  if (!thumb || !content || !bar) return

  const dragStartY = event.clientY
  const dragStartScrollTop = content.scrollTop

  const onMouseMove = (moveEvent: MouseEvent) => {
    const maxThumbTravel = Math.max(bar.clientHeight - thumb.clientHeight, 1)
    const scrollRatio = (moveEvent.clientY - dragStartY) / maxThumbTravel
    content.scrollTop = dragStartScrollTop + scrollRatio * (content.scrollHeight - content.clientHeight)
  }

  const onMouseUp = () => {
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  event.preventDefault()
  showScrollbar(key)
}

const bindPaneScrollbar = (key: ScrollbarPaneKey) => {
  paneCleanupMap.get(key)?.()
  const content = paneContentRefs[key].value
  if (!content) return

  const onScroll = () => {
    updateScrollbarThumb(key)
    showScrollbar(key)
  }
  const onPointerEnter = () => {
    updateScrollbarThumb(key)
    showScrollbar(key)
  }

  const onPointerLeave = () => updateScrollbarThumb(key)
  content.addEventListener('scroll', onScroll, { passive: true })
  content.addEventListener('mouseenter', onPointerEnter)
  content.addEventListener('mouseleave', onPointerLeave)

  const resizeObserver = new ResizeObserver(() => updateScrollbarThumb(key))
  resizeObserver.observe(content)
  const mutationObserver = new MutationObserver(() => {
    requestAnimationFrame(() => updateScrollbarThumb(key))
  })
  mutationObserver.observe(content, { childList: true, subtree: true, characterData: true })

  requestAnimationFrame(() => updateScrollbarThumb(key))
  paneCleanupMap.set(key, () => {
    content.removeEventListener('scroll', onScroll)
    content.removeEventListener('mouseenter', onPointerEnter)
    content.removeEventListener('mouseleave', onPointerLeave)
    resizeObserver.disconnect()
    mutationObserver.disconnect()
  })
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

const parseOptions = (raw?: string) => {
  if (!raw?.trim()) return [] as { key: string; text: string }[]
  return raw
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([A-Ha-h])[\.、.\)\s]\s*(.*)$/)
      if (match) return { key: match[1].toUpperCase(), text: match[2] || '' }
      return { key: '', text: line }
    })
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

const openWrite = (stepId: string) => {
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
  if (name === 'move_questions') {
    return ['M4 6h10', 'M4 12h10', 'M4 18h7', 'M14 15l4 3-4 3', 'M18 18H9']
  }
  if (name === 'save_questions') {
    return ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z']
  }
  return ['M12 3v3', 'M12 18v3', 'M3 12h3', 'M18 12h3']
}

const isSessionRunning = (session: AgentChatSession) =>
  session.messages.some((message) => message.status === 'streaming')

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

const composing = ref(false)

const onComposerCompositionStart = () => {
  composing.value = true
}

const onComposerCompositionEnd = () => {
  composing.value = false
  syncDraftFromComposer()
  resizeComposer()
}

const onComposerEscape = () => {
  if (sending.value) stopChat()
}

const onComposerKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    onComposerEscape()
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
  if (event.key !== 'Enter' || event.shiftKey) return
  if (event.isComposing || event.keyCode === 229 || composing.value) return
  event.preventDefault()
  submit()
}

const submit = async () => {
  syncDraftFromComposer()
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
  clearComposer()
  await nextTick()
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
const selectionBoxes = ref<{ left: number; top: number; width: number; height: number }[]>([])
let customSelectionRange: Range | null = null
let selectionAnchor: Range | null = null
let selectionDragging = false
let selectionMoved = false
let selectionStartX = 0
let selectionStartY = 0
let lastFocusRange: Range | null = null
let selectionScopeEl: Element | null = null

const isThreadSelectableTarget = (target: EventTarget | null) => {
  const el = target instanceof Element ? target : null
  if (!el) return false
  if (el.closest('button, a, input, textarea, .write-head, .chat-item-delete, .composer-box, .user-image, .user-file')) return false
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

const caretRangeAt = (x: number, y: number) => {
  const scope = selectionScopeEl
  if (!scope) return null
  const lines: { node: Text; top: number; bottom: number; left: number; right: number }[] = []
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT)
  let current: Node | null
  while ((current = walker.nextNode())) {
    if (!/\S/.test(current.textContent || '')) continue
    const probe = document.createRange()
    probe.selectNodeContents(current)
    for (const rect of probe.getClientRects()) {
      if (rect.width < 1 || rect.height < 1) continue
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

const collectTextRects = (range: Range) => {
  const ancestor = range.commonAncestorContainer
  const root = ancestor.nodeType === Node.TEXT_NODE ? ancestor.parentNode : ancestor
  if (!root) return []
  const rects: DOMRect[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let node: Node | null
  while ((node = walker.nextNode())) {
    if (!/\S/.test(node.textContent || '') || !range.intersectsNode(node)) continue
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
  return rects
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
      rect.left <= last.left + last.width + 8
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

const paintCustomSelection = (range: Range | null) => {
  const root = threadRef.value
  if (!root || !range || range.collapsed) {
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

const clearCustomSelection = () => {
  selectionAnchor = null
  lastFocusRange = null
  selectionScopeEl = null
  selectionDragging = false
  selectionMoved = false
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
  if (event.button !== 0 || !isThreadSelectableTarget(event.target)) {
    if (!(event.target instanceof Element) || !event.target.closest('.chat-selection')) {
      clearCustomSelection()
    }
    return
  }
  window.getSelection()?.removeAllRanges()
  selectionScopeEl = (event.target instanceof Element
    ? event.target.closest('.assistant-text, .user-bubble, .activity-text')
    : null)
  selectionAnchor = caretRangeAt(event.clientX, event.clientY)
  selectionStartX = event.clientX
  selectionStartY = event.clientY
  selectionDragging = Boolean(selectionAnchor)
  selectionMoved = false
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
  const pane = threadRef.value
  threadPinned.value = !pane || isThreadNearBottom(pane)
  if (customSelectionRange) paintCustomSelection(customSelectionRange)
}

const scrollThreadToBottom = () => {
  const pane = threadRef.value
  if (!pane || !threadPinned.value) return
  pane.scrollTop = pane.scrollHeight
  updateScrollbarThumb('thread')
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
}

const scheduleHighlight = () => {
  requestAnimationFrame(() => highlightThreadCode())
}

watch(activeChatId, async () => {
  openedWriteStepId.value = null
  threadPinned.value = true
  clearCustomSelection()
  clearComposer()
  await nextTick()
  bindPaneScrollbar('thread')
  scheduleHighlight()
  scrollThreadToBottom()
})

watch(openedWriteStep, async (step) => {
  await nextTick()
  if (step) bindPaneScrollbar('write')
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
  bindPaneScrollbar('list')
  if (activeChat.value) bindPaneScrollbar('thread')
  scheduleHighlight()
  document.addEventListener('pointermove', onThreadPointerMove)
  document.addEventListener('pointerup', onThreadPointerUp)
  document.addEventListener('copy', onCopyCustomSelection)
  document.addEventListener('selectstart', onThreadSelectStart)
  document.addEventListener('keydown', onPreviewKeydown)
})

onUnmounted(() => {
  if (threadScrollFrame) cancelAnimationFrame(threadScrollFrame)
  document.removeEventListener('pointermove', onThreadPointerMove)
  document.removeEventListener('pointerup', onThreadPointerUp)
  document.removeEventListener('copy', onCopyCustomSelection)
  document.removeEventListener('selectstart', onThreadSelectStart)
  document.removeEventListener('keydown', onPreviewKeydown)
  paneCleanupMap.forEach((cleanup) => cleanup())
  ;(Object.keys(paneHideTimers) as ScrollbarPaneKey[]).forEach((key) => {
    if (paneHideTimers[key]) clearTimeout(paneHideTimers[key])
  })
})
</script>

<style scoped>
.chat-page {
  height: 100%;
  display: flex;
  gap: 4px;
  background: var(--bg-primary, #f5f5f7);
}

.chat-sidebar {
  width: 260px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: var(--bg-secondary, #fff);
  border-radius: 4px;
  margin-bottom: 5px;
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

.pane-header {
  position: relative;
  height: 36px;
  min-height: 36px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-shrink: 0;
}

.pane-header::after {
  content: '';
  position: absolute;
  left: 10px;
  right: 10px;
  bottom: 0;
  height: 1px;
  background: color-mix(in srgb, var(--border-primary, #e2e8f0) 42%, transparent);
  transform: scaleY(0.5);
}

.header-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
}

.header-action,
.start-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}

.header-action:hover,
.start-btn:hover {
  color: var(--text-primary, #2d3748);
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.chat-list-wrap,
.chat-thread-wrap,
.write-pane-body-wrap {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.chat-list,
.chat-thread,
.write-pane-body {
  position: absolute;
  inset: 0;
  overflow: auto;
  scrollbar-width: none;
  -ms-overflow-style: none;
}

.chat-list::-webkit-scrollbar,
.chat-thread::-webkit-scrollbar,
.write-pane-body::-webkit-scrollbar,
.chat-list::-webkit-scrollbar-button,
.chat-thread::-webkit-scrollbar-button,
.write-pane-body::-webkit-scrollbar-button,
.composer-input::-webkit-scrollbar,
.composer-input::-webkit-scrollbar-button {
  display: none;
}

.composer-input {
  scrollbar-width: none;
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

.chat-list {
  padding: 4px 12px 4px 6px;
  display: flex;
  flex-direction: column;
  gap: 1px;
  box-sizing: border-box;
}

.chat-item {
  display: flex;
  align-items: center;
  gap: 6px;
  box-sizing: border-box;
  text-align: left;
  border: none;
  background: transparent;
  border-radius: 6px;
  padding: 5px 6px 5px 8px;
  min-height: 28px;
  cursor: pointer;
}

.chat-item:hover {
  background: var(--model-item-hover-bg, #efefef);
}

.chat-item.is-selected {
  background: #e8e8ed;
}

.chat-item-main {
  flex: 1;
  min-width: 0;
}

.chat-item-name {
  font-size: 12px;
  line-height: 1.3;
  color: var(--text-primary, #2d3748);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-item-delete {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--text-secondary, #718096);
  cursor: pointer;
  opacity: 0;
}

.chat-item:hover .chat-item-delete,
.chat-item.is-selected .chat-item-delete {
  opacity: 1;
}

.chat-item-delete:hover {
  color: var(--text-primary, #2d3748);
  background: color-mix(in srgb, var(--text-primary, #2d3748) 8%, transparent);
}

.chat-item-spinner {
  display: none;
  width: 12px;
  height: 12px;
  border: 1.5px solid color-mix(in srgb, var(--text-secondary, #718096) 28%, transparent);
  border-top-color: var(--text-secondary, #718096);
  border-radius: 50%;
  animation: chat-spin 0.7s linear infinite;
}

.chat-item-close {
  display: block;
}

.chat-item.is-running .chat-item-delete {
  opacity: 1;
}

.chat-item.is-running .chat-item-spinner {
  display: block;
}

.chat-item.is-running .chat-item-close {
  display: none;
}

.chat-item.is-running:hover .chat-item-spinner {
  display: none;
}

.chat-item.is-running:hover .chat-item-close {
  display: block;
}

@keyframes chat-spin {
  to { transform: rotate(360deg); }
}

.list-empty,
.detail-empty {
  color: var(--text-secondary, #718096);
  font-size: 13px;
}

.list-empty {
  padding: 16px 10px;
}

.detail-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
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
  background: color-mix(in srgb, var(--bg-primary, #fff) 70%, #eef0f3);
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
  background: #e8e8ed;
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
  --code-bg: color-mix(in srgb, var(--text-primary, #2d3748) 5%, #fff);
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
  background: color-mix(in srgb, var(--text-primary, #2d3748) 5%, #fff);
  color: var(--text-primary, #2d3748);
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

.write-pane {
  width: 380px;
  flex-shrink: 0;
  overflow: hidden;
  min-height: 0;
  display: flex;
}

.write-pane-inner {
  width: 380px;
  min-width: 380px;
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary, #fff);
  box-shadow: inset 1px 0 0 color-mix(in srgb, var(--border-primary, #e2e8f0) 42%, transparent);
}

.write-pane-head {
  height: 36px;
  min-height: 36px;
  padding: 0 10px 0 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  box-shadow: inset 0 -1px 0 color-mix(in srgb, var(--border-primary, #e2e8f0) 42%, transparent);
}

.write-pane-head .write-file {
  flex: 1;
}

.write-pane-body {
  min-height: 0;
}

.write-pane-enter-active,
.write-pane-leave-active {
  transition: width 220ms cubic-bezier(0.23, 1, 0.32, 1);
}

.write-pane-enter-from,
.write-pane-leave-to {
  width: 0;
}

.write-block {
  border: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 80%, transparent);
  border-radius: 8px;
  overflow: hidden;
  background: color-mix(in srgb, var(--bg-primary, #fff) 92%, #f3f4f6);
}

.write-block.is-open {
  border-color: color-mix(in srgb, #16a34a 35%, var(--border-primary, #e2e8f0));
}

.write-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 10px;
  border: none;
  background: color-mix(in srgb, var(--bg-primary, #fff) 70%, #eef0f3);
  cursor: pointer;
}

.write-head:hover {
  background: color-mix(in srgb, var(--bg-primary, #fff) 40%, #e8eaed);
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

.write-stat {
  flex-shrink: 0;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: #16a34a;
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
    color-mix(in srgb, var(--bg-primary, #fff) 55%, #f3f4f6) 42%,
    color-mix(in srgb, var(--bg-primary, #fff) 92%, #f3f4f6) 100%
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
  color: #16a34a;
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
  color: #2563eb;
  background: #edf4ff;
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
  color: #15803d;
  background: rgba(22, 163, 74, 0.14);
}

.write-answer-text {
  color: #166534;
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
  color: #166534;
}

.chat-error {
  font-size: 12px;
  color: #dc2626;
}

.chat-stopped {
  font-size: 12px;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 42%, transparent);
}

.composer {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 3;
  display: flex;
  justify-content: center;
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

.composer-model.is-empty {
  max-width: 220px;
  height: auto;
  line-height: 1.4;
  padding: 4px 8px;
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
  color: #fff;
  cursor: pointer;
}

.composer-send:hover:not(:disabled) {
  transform: scale(0.97);
}

.composer-send:disabled {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 18%, transparent);
  color: #fff;
  cursor: default;
}

.composer-send.is-stop:hover {
  transform: scale(0.97);
}

@keyframes chat-think-pulse {
  0%, 100% { opacity: 0.72; }
  50% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .activity-text.is-live,
  .assistant-thinking {
    animation: none;
    opacity: 1;
  }

  .write-pane-enter-active,
  .write-pane-leave-active,
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
