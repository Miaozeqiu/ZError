<template>
  <div class="chat-thread-root">
        <div class="chat-thread-wrap">
          <div
            ref="threadRef"
            class="chat-thread"
            tabindex="0"
            aria-label="对话内容"
            @scroll.passive="updateThreadPinned"
            @wheel.capture.passive="onThreadWheel"
            @touchstart.passive="onThreadTouchStart"
            @touchmove.passive="onThreadTouchMove"
            @pointerdown="onThreadPointerDown"
            @contextmenu="onThreadContextMenu"
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
                <AgentQuizOptionQuote
                  v-for="(quote, index) in message.quizOptionQuotes"
                  :key="index"
                  :quote="quote"
                />
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
                <AgentQuizReview
                  v-if="quizReviews.has(message.id)"
                  :review="quizReviews.get(message.id)!"
                />
                <div v-else-if="message.content" class="user-bubble">
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
                <div v-if="message.reasoning" class="assistant-reasoning">
                  <button
                    class="reasoning-toggle"
                    type="button"
                    :aria-expanded="expandedReasoning.has(message.id)"
                    :aria-controls="`${reasoningPanelId}-${message.id}`"
                    @click="toggleReasoning(message.id)"
                  >
                    <span>{{ reasoningLabel(message.reasoningDurationMs) }}</span>
                    <Icon class="reasoning-chevron" icon="lucide:chevron-right" width="14" height="14" aria-hidden="true" />
                  </button>
                  <div
                    :id="`${reasoningPanelId}-${message.id}`"
                    class="reasoning-panel"
                    :class="{ 'is-open': expandedReasoning.has(message.id) }"
                    :inert="expandedReasoning.has(message.id) ? undefined : true"
                  >
                    <div class="reasoning-clip">
                      <div class="reasoning-content">{{ message.reasoning }}</div>
                    </div>
                  </div>
                </div>
                <template v-for="block in assistantTimeline(message)" :key="block.key">
                  <div
                    v-if="block.type === 'step' && (!block.group || block.groupHead || expandedToolGroups.has(block.group.key))"
                    class="activity-entry"
                    :class="{ 'is-group-child': block.group && !block.groupHead }"
                  >
                    <component
                      :is="block.groupHead || (block.step.name === 'web_search' && block.step.status === 'done') ? 'button' : 'div'"
                      class="activity-line"
                      :class="[`is-${block.step.status}`, { 'is-group-toggle': block.groupHead }]"
                      :type="block.groupHead || (block.step.name === 'web_search' && block.step.status === 'done') ? 'button' : undefined"
                      :aria-expanded="block.groupHead ? expandedToolGroups.has(block.groupHead.key) : block.step.name === 'web_search' && block.step.status === 'done' ? expandedSearchSteps.has(block.step.id) : undefined"
                      @click="block.groupHead ? toggleToolGroup(block.groupHead.key) : block.step.name === 'web_search' && block.step.status === 'done' && toggleSearchResults(block.step.id)"
                    >
                      <span class="activity-icon" aria-hidden="true">
                        <Icon :icon="activityIconName(block.step.name)" width="14" height="14" />
                      </span>
                      <span class="activity-text" :class="{ 'is-live': block.step.status === 'running', 'is-url': /https?:\/\//i.test(block.step.label) }" :title="/https?:\/\//i.test(block.step.label) ? block.step.label : undefined">{{ block.step.name === 'web_search' ? `正在搜索 ${searchQueryFor(block.step) || '网页资料'}` : block.step.label }}</span>
                      <span v-if="block.groupHead" class="activity-group-count">
                        {{ block.groupHead.count }} 次调用<template v-if="block.groupHead.running"> · 进行中</template><template v-if="block.groupHead.failed"> · {{ block.groupHead.failed }} 次失败</template>
                      </span>
                      <Icon
                        v-if="block.groupHead || (block.step.name === 'web_search' && block.step.status === 'done')"
                        class="search-results-chevron"
                        icon="lucide:chevron-right"
                        width="14"
                        height="14"
                        aria-hidden="true"
                      />
                    </component>
                    <p v-if="block.step.status === 'failed' && block.step.detail" class="activity-detail">{{ block.step.detail }}</p>

                    <div v-if="block.step.name === 'web_search' && block.step.status === 'done' && (!block.groupHead || expandedToolGroups.has(block.groupHead.key))" class="search-results-block">
                      <button v-if="block.groupHead" type="button" class="activity-search-action" :aria-expanded="expandedSearchSteps.has(block.step.id)" @click="toggleSearchResults(block.step.id)">
                        {{ expandedSearchSteps.has(block.step.id) ? '收起搜索结果' : '查看搜索结果' }}
                      </button>
                      <div v-if="expandedSearchSteps.has(block.step.id)" class="search-results-content" @wheel="onSearchResultsWheel">
                        <TransitionGroup name="search-result-item" tag="div" class="search-results-list">
                          <button
                            v-for="item in searchResultsFor(block.step)"
                            :key="item.url"
                            class="search-result-card"
                            type="button"
                            @click="openSearchResult(item.url)"
                          >
                            <span class="search-result-title-row">
                              <span class="search-result-favicon-wrap">
                                <Icon icon="lucide:globe" width="14" height="14" />
                                <img
                                  class="search-result-favicon"
                                  :src="item.siteIcon || faviconUrlFor(item.url)"
                                  alt=""
                                  loading="lazy"
                                  @error="hideBrokenFavicon"
                                />
                              </span>
                              <span class="search-result-title">{{ item.title }}</span>
                            </span>
                            <span v-if="item.snippet" class="search-result-snippet">{{ item.snippet }}</span>
                            <span class="search-result-url">{{ item.url }}</span>
                          </button>
                        </TransitionGroup>
                        <span v-if="!searchResultsFor(block.step).length" class="search-empty">没有找到可展示的搜索结果</span>
                      </div>
                    </div>

                    <div
                      v-if="isQuizStep(block.step)"
                      class="write-block is-quiz"
                      :class="{ 'is-open': isQuizOpen(message.id, block.step.id) }"
                    >
                      <button class="write-head" type="button" @click="toggleQuiz(message.id, block.step.id)">
                        <span class="write-file">
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="12" cy="12" r="9" />
                            <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.25c-.7.4-1.1.9-1.1 1.75" />
                            <path d="M12 17h.01" />
                          </svg>
                          <span class="write-file-name">{{ quizTitleFor(block.step) }}</span>
                        </span>
                        <span class="write-stat">{{ quizStatFor(message, block.step.id, quizCardsFor(block.step), isBrowseQuizStep(block.step)) }}</span>
                      </button>
                    </div>

                    <div
                      v-if="block.step.name === 'save_questions' && block.step.preview?.length"
                      class="write-block"
                      :class="{ 'is-running': block.step.status === 'running', 'is-open': openedWriteStepId === block.step.id }"
                    >
                      <button class="write-head" type="button" @click="openWrite(block.step.id)">
                        <span class="write-file">
                          <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <path d="M14 2v6h6" />
                          </svg>
                          {{ activeChat.attachments?.[0]?.folderName || '题库' }}
                        </span>
                        <span class="write-stat">+{{ block.step.previewCount || block.step.preview.length }}</span>
                      </button>
                      <div class="write-body">
                        <div
                          v-for="(item, index) in visiblePreview(block.step)"
                          :key="`${block.step.id}-${index}`"
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
                                :key="`${block.step.id}-${index}-${option.key}-${option.text}`"
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
                          <button class="write-more" type="button" @click="openWrite(block.step.id)">
                            查看所有 {{ block.step.previewCount || block.step.preview.length }} 道
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div
                    v-else-if="block.type === 'text' && block.content.trim()"
                    class="assistant-text"
                    :class="{ dark: themeState.isDark }"
                  >
                    <MarkdownRender
                      :key="block.key"
                      custom-id="agent-chat"
                      mode="chat"
                      :content="block.content"
                      :final="message.status !== 'streaming'"
                      :index-key="block.key"
                      :max-live-nodes="0"
                      :fade="false"
                      :smooth-streaming="message.status === 'streaming' && !(message.steps || []).length"
                      :typewriter="false"
                      html-policy="safe"
                      :render-code-blocks-as-pre="true"
                      :d2-props="{ progressiveRender: true, progressiveIntervalMs: 450 }"
                    />
                  </div>
                </template>

                <div
                  v-for="homework in homeworkByMessage.get(message.id)"
                  :key="homework.assignmentId"
                  class="write-block is-quiz"
                  :class="{ 'is-open': openedQuizKey === homeworkPaneKey(homework.assignmentId) }"
                >
                  <button class="write-head" type="button" @click="openHomeworkPane(homework.assignmentId)">
                    <span class="write-file">
                      <Icon icon="lucide:list-checks" width="14" height="14" aria-hidden="true" />
                      <span class="write-file-name">{{ homework.title || '课程作业' }}</span>
                    </span>
                    <span class="write-stat">{{ homework.total }} 题</span>
                  </button>
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

                <AgentImportTemplateOffer
                  v-for="offer in message.importTemplateOffers || []" :key="offer.id"
                  :session-id="activeChatId || ''" :message-id="message.id" :offer="offer"
                />
                <AgentLoginForm
                  v-if="loginRequest && message.status === 'streaming'"
                  :key="loginRequest.id"
                  :request="loginRequest"
                  @contextmenu.stop
                />
                <div v-else-if="message.status === 'streaming' && waitingForWebsiteVerification" class="assistant-thinking" role="status">
                  请在浏览器完成验证码并点击登录，登录成功后会自动继续。
                </div>
                <div v-else-if="isThinking(message)" class="assistant-thinking">
                  正在思考
                </div>
                <div v-if="message.status === 'streaming' && message.awaitingVideo" class="assistant-thinking" role="status">正在监控视频，等待完成后继续任务</div>
                <div v-if="message.status === 'done' && message.taskOutcome === 'blocked'" class="chat-stopped" role="status">任务受阻，未完成步骤已保留</div>
                <div v-if="message.status === 'stopped'" class="chat-stopped">{{ message.stopReason === 'browser-takeover' ? '已接管浏览器，自动操作已停止' : '已停止生成' }}</div>
                <div v-if="message.error" class="chat-error">{{ message.error }}</div>
              </div>
            </div>
            <div class="chat-thread-spacer" aria-hidden="true"></div>
          </div>
          <div
            class="custom-scrollbar"
            :class="{ 'is-visible': threadScroll.visible }"
            ref="threadBarRef"
            @mousedown="onThreadScrollbarDown"
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
import { useThreadView } from './useThreadView'
import { defineAsyncComponent, computed, ref, useId } from 'vue'
import { Icon } from '@iconify/vue/offline'
import AgentImportTemplateOffer from '../../components/agent/AgentImportTemplateOffer.vue'
import AgentLoginForm from '../../components/agent/AgentLoginForm.vue'
import { chatLoginRequests, pendingWebsiteVerification } from '../../services/agent/chatLogin'
import { activeChat, activeChatId, parseMessageParts } from '../../services/agent/chat'
import { themeState } from '../../composables/useTheme'

import { activityIconName } from '../../utils/ui/agentIcons'
import type { HomeworkProgress } from '../../services/agent/homeworkProgress'
import { fileTypeLabel, fileTypeOf } from '../../utils/ui/fileKind'
import { parseOptions } from '../../utils/question/quizPractice'
import UnifiedContextMenu from '../../components/ui/UnifiedContextMenu.vue'
import AgentChatFeatureCards from './AgentChatFeatureCards.vue'
import AgentQuizReview from './AgentQuizReview.vue'
import AgentQuizOptionQuote from './AgentQuizOptionQuote.vue'
import {
  assistantTimeline,
  filesForMessage,
  imagesForMessage,
  searchQueryFor,
  searchResultsFor,
  isBrowseQuizStep,
  isQuizStep,
  isThinking,
  quizCardsFor,
  quizReviewsFor,
  quizStatFor,
  quizTitleFor,
  reasoningLabel,
  typeTagKind,
  visiblePreview,
} from './threadDisplay'
import {
  fallbackQuizCards,
  homeworkPaneKey,
  isQuizOpen,
  openedQuizKey,
  openHomeworkPane,
  openWrite,
  openedWriteStepId,
  toggleQuiz,
} from './useAgentChatPanes'

defineProps<{
  showFeatureCards: boolean
  fileManagerLabel: string
}>()

const MarkdownRender = defineAsyncComponent(() => import('./markdown').then(module => module.default))

const threadPinned = defineModel<boolean>('pinned', { default: true })
const loginRequest = computed(() => chatLoginRequests.get(activeChatId.value || ''))
const waitingForWebsiteVerification = computed(() => pendingWebsiteVerification.has(activeChatId.value || ''))
const quizReviews = computed(() => quizReviewsFor(activeChat.value?.messages || []))
const homeworkByMessage = computed(() => {
  const reports = new Map<string, HomeworkProgress[]>()
  for (const report of activeChat.value?.homework || []) {
    if (!report.messageId) continue
    const group = reports.get(report.messageId)
    if (group) group.push(report)
    else reports.set(report.messageId, [report])
  }
  return reports
})

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

const openSearchResult = async (url: string) => {
  if (!/^https?:\/\//i.test(url)) return
  try {
    const { openUrl } = await import('@tauri-apps/plugin-opener')
    await openUrl(url)
  } catch {
    window.open(url, '_blank', 'noopener,noreferrer')
  }
}

const expandedSearchSteps = ref(new Set<string>())
const expandedToolGroups = ref(new Set<string>())
const expandedReasoning = ref(new Set<string>())
const reasoningPanelId = useId()
const toggleReasoning = (messageId: string) => {
  const expanded = expandedReasoning.value
  if (expanded.has(messageId)) expanded.delete(messageId)
  else expanded.add(messageId)
}

const toggleToolGroup = (key: string) => {
  if (selectedChatText()) return
  const expanded = expandedToolGroups.value
  if (expanded.has(key)) expanded.delete(key)
  else expanded.add(key)
}
const onSearchResultsWheel = (event: WheelEvent) => {
  if (event.ctrlKey || event.metaKey || !event.cancelable) return
  const list = (event.currentTarget as HTMLElement).querySelector<HTMLElement>('.search-results-list')
  if (!list || list.scrollWidth <= list.clientWidth) return
  // Native horizontal gestures already scroll this list. Vertical wheel input is
  // mapped once, without adding another animation to native smoothed events.
  if (Math.abs(event.deltaX) >= Math.abs(event.deltaY)) return
  const unit = event.deltaMode === 1 ? 20 : event.deltaMode === 2 ? list.clientWidth : 1
  const before = list.scrollLeft
  list.scrollLeft += event.deltaY * unit
  if (list.scrollLeft !== before) { event.preventDefault(); event.stopPropagation() }
}

const toggleSearchResults = (stepId: string) => {
  if (selectedChatText()) return
  const next = new Set(expandedSearchSteps.value)
  if (next.has(stepId)) next.delete(stepId)
  else next.add(stepId)
  expandedSearchSteps.value = next
}

const faviconUrlFor = (url: string) => {
  try {
    return `${new URL(url).origin}/favicon.ico`
  } catch {
    return ''
  }
}

const hideBrokenFavicon = (event: Event) => {
  const image = event.currentTarget as HTMLImageElement
  image.style.display = 'none'
}

const { threadRef, threadBarRef, threadThumbRef, threadScroll, selectedChatText, selectionMenuVisible, selectionMenuX, selectionMenuY, selectionMenuItems, onSelectionMenuClick, onThreadContextMenu, hideSelectionMenu, onThreadPointerDown, updateThreadPinned, jumpThreadToBottom, onThreadWheel, onThreadTouchStart, onThreadTouchMove, onThreadScrollbarDown } = useThreadView({
  chatId: activeChatId, pinned: threadPinned,
  contentStamp: () => {
    const last = activeChat.value?.messages.at(-1)
    return last ? `${activeChat.value?.messages.length}:${last.id}:${last.content.length}:${last.steps.length}:${last.status}` : '0'
  },
  onReset: () => { expandedToolGroups.value.clear(); expandedReasoning.value.clear(); openedWriteStepId.value = null },
  onQuote: text => emit('quote', text), onAsk: text => emit('ask', text),
  onHideComposerMenu: () => emit('hide-composer-menu'),
})

defineExpose({
  threadPinned,
  jumpThreadToBottom,
  hideSelectionMenu,
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
  overflow-anchor: none;
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
  overscroll-behavior: none;
}

/* Let WebKit own hit testing, multiline ranges, drag autoscroll and copying. */
.chat-thread {
  -webkit-user-select: text;
  user-select: text;
}

.activity-icon,
.search-results-chevron {
  -webkit-user-select: none;
  user-select: none;
}

.chat-thread > * {
  flex-shrink: 0;
  width: 100%;
  max-width: var(--chat-max-width);
}

.chat-thread-spacer {
  flex: none;
  height: var(--chat-composer-height, 108px);
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
  align-items: center;
  gap: 8px;
}

.activity-entry.is-group-child {
  margin-inline-start: 16px;
}

button.activity-line,
.activity-search-action {
  width: fit-content;
  max-width: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  font: inherit;
  color: inherit;
  text-align: start;
  cursor: pointer;
}

.activity-group-count,
.activity-search-action {
  flex-shrink: 0;
  color: var(--text-secondary, #718096);
  font-size: 11px;
}

.activity-search-action:hover {
  text-decoration: underline;
}

.search-results-chevron {
  flex: 0 0 auto;
  margin-left: 0;
  transition: transform 160ms ease-out;
}

.activity-line[aria-expanded="true"] .search-results-chevron {
  transform: rotate(90deg);
}

@media (prefers-reduced-motion: reduce) {
  .search-results-chevron {
    transition: none;
  }
}

.activity-icon {
  width: 16px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.activity-text,
.assistant-text {
  font-size: 13px;
  line-height: 1.7;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 86%, transparent);
}

.assistant-text {
  font-size: 14px;
  font-weight: 450;
}

.activity-icon,
.activity-text,
.search-results-chevron {
  color: color-mix(in srgb, var(--text-secondary, #718096) 85%, transparent);
}

.search-results-block {
  margin: 2px 0 4px 24px;
  max-width: min(640px, calc(100% - 24px));
}

.search-results-list {
  display: flex;
  gap: 6px;
  overflow-x: auto;
  padding: 2px 0 6px;
  scrollbar-width: thin;
  scroll-snap-type: x proximity;
}

.search-result-item-enter-active,
.search-result-item-leave-active {
  overflow: hidden;
  transform-origin: top center;
  transition: opacity .14s ease, transform .16s cubic-bezier(.2, .8, .2, 1);
}

.search-result-item-enter-from,
.search-result-item-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(.98);
}

.search-result-item-move {
  transition: transform .16s ease;
}

.search-result-card {
  display: grid;
  flex: 0 0 240px;
  min-width: 0;
  max-width: 100%;
  align-content: start;
  gap: 3px;
  scroll-snap-align: start;
  padding: 9px 11px;
  border: 1px solid var(--border-primary, #e2e8f0);
  border-radius: 9px;
  background: var(--bg-secondary, #fff);
  color: var(--text-primary, #2d3748);
  text-align: left;
  cursor: pointer;
  transition: box-shadow .15s ease;
}

.search-result-card:hover {
  box-shadow: 0 2px 6px color-mix(in srgb, var(--text-primary, #2d3748) 12%, transparent);
}

.search-result-title {
  overflow: hidden;
  min-width: 0;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.45;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-result-title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.search-result-favicon-wrap {
  position: relative;
  display: flex;
  flex: 0 0 14px;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: var(--text-secondary, #718096);
}

.search-result-favicon {
  position: absolute;
  width: 14px;
  height: 14px;
  border-radius: 3px;
  object-fit: contain;
  background: var(--bg-secondary, #fff);
}

.search-result-snippet {
  display: -webkit-box;
  overflow: hidden;
  color: var(--text-secondary, #718096);
  font-size: 11px;
  line-height: 1.45;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.search-result-url {
  overflow: hidden;
  color: var(--color-primary, #667eea);
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-empty {
  color: var(--text-secondary, #718096);
  font-size: 11px;
}

/* Offscreen Markdown must retain its real height. Markstream's default auto
   visibility substitutes a 600px estimate, changing the scroll range as short
   tool-interleaved blocks enter view (even after generation has finished). */
.assistant-text :deep(.markdown-renderer) {
  content-visibility: visible;
  contain-intrinsic-size: none;
}

.assistant-text :deep(.markstream-vue) {
  --fade-duration: 0.32s;
  --ms-text-body: 14px;
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
  font-size: 14px;
  font-weight: inherit;
  line-height: 1.65;
}

.activity-text {
  min-width: 0;
  white-space: pre-wrap;
}

.activity-text.is-url {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.activity-icon {
  flex-shrink: 0;
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

/* WebKit paints selection gaps to the edge of block boxes. Keep prose boxes
   content-sized so short paragraphs/list items don't highlight the empty row.
   The native selection, full-width renderer and rich content remain intact. */
.assistant-text :deep(:is(p, li, h1, h2, h3, h4, h5, h6)) {
  width: fit-content;
  max-width: 100%;
  box-sizing: border-box;
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
  animation: chat-think-pulse 1.2s ease-in-out infinite;
}

.assistant-reasoning {
  margin: 0 0 6px;
  color: var(--text-secondary);
  font-size: 13px;
  line-height: 1.6;
}

.reasoning-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  width: fit-content;
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.reasoning-chevron {
  flex: none;
  transition: transform 160ms ease-out;
}

.reasoning-toggle[aria-expanded="true"] .reasoning-chevron {
  transform: rotate(90deg);
}

.reasoning-panel {
  display: grid;
  grid-template-rows: 0fr;
  opacity: 0;
  transition: grid-template-rows 160ms ease-out, opacity 120ms ease-out;
}

.reasoning-panel.is-open {
  grid-template-rows: 1fr;
  opacity: 1;
  transition-duration: 200ms, 160ms;
}

.reasoning-clip {
  min-height: 0;
  overflow: clip;
}

@media (prefers-reduced-motion: reduce) {
  .reasoning-chevron,
  .reasoning-panel {
    transition: none;
  }
}

.reasoning-content {
  max-height: 320px;
  overflow: auto;
  padding: 6px 0 0 14px;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  user-select: text;
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
