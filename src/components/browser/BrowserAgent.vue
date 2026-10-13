<template>
  <section class="browser-agent">
    <div class="pane-header">
      <div class="header-title">Agent</div>
      <button
        v-if="session?.messages.length"
        class="header-action"
        type="button"
        @click="clear"
      >清空</button>
    </div>
    <div ref="threadRef" class="agent-thread" @scroll.passive="onThreadScroll">
      <div v-if="!session?.messages.length" class="feature-panel">
        <div class="feature-kicker">我可以帮你</div>
        <div class="feature-grid">
          <button
            v-for="card in featureCards"
            :key="card.id"
            class="feature-card"
            type="button"
            @click="startFromCard(card.prompt)"
          >
            <span class="feature-icon" aria-hidden="true">
              <Icon :icon="featureIconName(card.id)" width="16" height="16" />
            </span>
            <span class="feature-copy">
              <span class="feature-title">{{ card.title }}</span>
              <span class="feature-desc">{{ card.desc }}</span>
            </span>
          </button>
        </div>
      </div>
      <div
        v-for="message in session?.messages || []"
        :key="message.id"
        v-memo="messageMemo(message)"
        class="chat-turn"
        :class="`is-${message.role}`"
      >
        <div v-if="message.role === 'user'" class="user-turn">
          <div v-if="message.kind === 'watch'" class="watch-chip">{{ message.content }}</div>
          <div v-else class="user-bubble">{{ message.content }}</div>
        </div>
        <div v-else class="assistant-turn">
          <template v-for="block in assistantTimeline(message)" :key="block.key">
            <div
              v-if="block.type === 'step'"
              class="activity-entry"
            >
              <button
                v-if="block.step.children?.length"
                class="activity-line is-task"
                type="button"
                :class="[`is-${block.step.status}`]"
                @click="toggleJob(block.step.id)"
              >
                <span class="activity-icon" aria-hidden="true">
                  <Icon :icon="activityIconName(block.step.name)" width="14" height="14" />
                </span>
                <span class="activity-text" :class="{ 'is-live': block.step.status === 'running' }">{{ block.step.label }}</span>
                <span class="activity-toggle">{{ expandedJobs[block.step.id] !== false ? '▾' : '▸' }} {{ block.step.children.length }}</span>
              </button>
              <div
                v-else
                class="activity-line"
                :class="[`is-${block.step.status}`]"
              >
                <span class="activity-icon" aria-hidden="true">
                  <Icon :icon="activityIconName(block.step.name)" width="14" height="14" />
                </span>
                <span class="activity-text" :class="{ 'is-live': block.step.status === 'running' }">{{ block.step.label }}</span>
              </div>
              <p v-if="block.step.status === 'failed' && block.step.detail" class="activity-detail">{{ block.step.detail }}</p>
              <div v-if="block.step.children?.length && expandedJobs[block.step.id] !== false" class="activity-children">
                <div
                  v-for="child in block.step.children"
                  :key="child.id"
                  class="activity-line is-child"
                  :class="[`is-${child.status}`]"
                >
                  <span class="activity-icon" aria-hidden="true">
                    <Icon :icon="activityIconName(child.name)" width="12" height="12" />
                  </span>
                  <span class="activity-text" :class="{ 'is-live': child.status === 'running' }">{{ child.label }}</span>
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
                custom-id="browser-agent"
                mode="chat"
                :content="block.content"
                :final="message.status !== 'streaming'"
                :index-key="block.key"
                :max-live-nodes="0"
                :fade="false"
                :smooth-streaming="message.status === 'streaming'"
                :typewriter="false"
                html-policy="safe"
                :render-code-blocks-as-pre="true"
              />
            </div>
          </template>
          <div v-if="isThinking(message)" class="assistant-thinking">正在思考</div>
          <div v-if="message.status === 'stopped'" class="agent-note">已停止生成</div>
          <div v-if="message.error" class="agent-error">{{ message.error }}</div>
        </div>
      </div>
    </div>
    <div class="composer-dock">
      <BrowserAgentWatchBar :browser-id="browserId" />
      <div v-if="activeTodos.length" class="todo-card" aria-label="任务清单">
        <div class="todo-card-head">
          <span class="todo-card-title">任务</span>
          <span class="todo-card-meta">{{ todoDoneCount }}/{{ activeTodos.length }}</span>
        </div>
        <ul class="todo-card-list">
          <li
            v-for="item in activeTodos"
            :key="item.id"
            class="todo-item"
            :class="`is-${item.status}`"
          >
            <span class="todo-mark" aria-hidden="true">
              <svg v-if="item.status === 'done'" viewBox="0 0 16 16" width="16" height="16">
                <circle cx="8" cy="8" r="6.25" fill="currentColor" />
                <path d="M5.2 8.15l1.85 1.85 3.75-3.8" fill="none" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <svg v-else-if="item.status === 'cancelled'" viewBox="0 0 16 16" width="16" height="16">
                <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.4" />
                <path d="M5.4 8h5.2" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" />
              </svg>
              <svg v-else viewBox="0 0 16 16" width="16" height="16">
                <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.4" />
              </svg>
            </span>
            <span class="todo-text">{{ item.text }}</span>
          </li>
        </ul>
      </div>
      <AgentApprovalBar :session-id="session?.id" />
      <form class="composer" @submit.prevent="submit">
        <div class="composer-box">
          <textarea
            ref="inputRef"
            v-model="draft"
            class="composer-input"
            rows="1"
            :placeholder="composerPlaceholder"
            @input="resizeComposer"
            @compositionstart="onCompositionStart"
            @compositionend="onCompositionEnd"
            @keydown="onKeydown"
          />
          <div class="composer-toolbar">
            <span class="composer-place">{{ placeHint }}</span>
            <button
              v-if="busy"
              class="composer-send is-stop"
              type="button"
              title="停止"
              aria-label="停止"
              @click="stop"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor">
                <rect x="7" y="7" width="10" height="10" rx="2" />
              </svg>
            </button>
            <button
              v-else
              class="composer-send"
              type="submit"
              :disabled="!draft.trim()"
              aria-label="发送"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 19V5" />
                <path d="M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Icon } from '@iconify/vue/offline'
import MarkdownRender from 'markstream-vue'
import 'markstream-vue/index.css'
import '../../services/model/markstream'
import { themeState } from '../../composables/useTheme'
import AgentApprovalBar from '../agent/AgentApprovalBar.vue'
import { resolveSitePackForUrl } from '../../services/agent/sitePack'
import {
  browserChatSessions,
  clearBrowserChat,
  ensureBrowserChat,
  sendChatMessage,
  stopBrowserAgent,
  stopChat,
} from '../../services/agent/chat'
import { hostnameOf } from '../../services/browser/appBrowser'
import { agentWatchBusy } from '../../services/platform/panelAccess'
import { activityIconName, featureIconName, type AgentFeatureIcon } from '../../utils/ui/agentIcons'
import { shouldSubmitComposerEnter } from '../../utils/ui/composerEnter'
import { assistantTimeline } from '../../views/agentChat/threadDisplay'
import BrowserAgentWatchBar from './BrowserAgentWatchBar.vue'

const props = defineProps<{
  browserId?: string
  name?: string
  url?: string
}>()

const draft = ref('')
const threadRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const composing = ref(false)
const pinBottom = ref(true)
const expandedJobs = ref<Record<string, boolean>>({})
const toggleJob = (id: string) => {
  expandedJobs.value = { ...expandedJobs.value, [id]: !expandedJobs.value[id] }
}
let compositionEndedAt = 0

const featureCards = computed(() => {
  const cards: Array<{ id: AgentFeatureIcon; title: string; desc: string; prompt: string }> = [
    {
      id: 'read',
      title: '读当前页',
      desc: '看看现在打开的是什么',
      prompt: '读一下当前网页，告诉我现在在哪、页面上能做什么。',
    },
    {
      id: 'click',
      title: '点一下',
      desc: '按钮、链接或选项',
      prompt: '帮我点页面上该点的按钮或链接。',
    },
    {
      id: 'type',
      title: '填写',
      desc: '在输入框里打字',
      prompt: '帮我填写这个页面上的表单。',
    },
  ]
  const pack = resolveSitePackForUrl(props.url || '')
  if (pack?.siteId === 'chaoxing') {
    cards.push({
      id: 'play',
      title: '播完章节',
      desc: pack?.name ? `把${pack.name}未完成的播完` : '把未完成的章节播完',
      prompt: pack?.name ? `把${pack.name}未完成的章节播完。` : '把未完成的章节播完。',
    })
  }
  return cards
})

const session = computed(() => {
  const id = String(props.browserId || '').trim()
  const chats = browserChatSessions.value
  if (!chats.length) return null
  return (id && chats.find((item) => item.browserId === id)) || chats[0] || null
})

const activeTodos = computed(() => {
  if (!session.value?.messages.length) return []
  return Array.isArray(session.value.todos) ? session.value.todos : []
})

const todoDoneCount = computed(() => activeTodos.value.filter((item) => item.status === 'done').length)

const streaming = computed(() => Boolean(session.value?.messages.some((item) => item.status === 'streaming')))
const placeHint = computed(() => hostnameOf(props.url || ''))
const composerPlaceholder = computed(() =>
  placeHint.value && placeHint.value !== '导航'
    ? `问「${placeHint.value}」，或让我点、填、打开…`
    : '问网页，或让我点、填、打开…',
)

/** 只认 Agent 自己的监测。面板空白监测默认 paused，不能拿来当对话忙。 */
const watchActive = computed(() => agentWatchBusy(props.browserId))
const busy = computed(() => streaming.value || watchActive.value)

const isThinking = (message: { status?: string; waiting?: boolean; content?: string }) =>
  message.status === 'streaming' && message.waiting !== false && !message.content

const messageMemo = (message: {
  status?: string
  content?: string
  error?: string
  waiting?: boolean
  steps?: Array<{ id?: string; status?: string; label?: string; children?: Array<{ id?: string; status?: string; label?: string }> }>
}) => [
  message.status,
  message.content,
  message.error,
  message.waiting,
  (message.steps || []).map((step) => `${step.id}:${step.status}:${step.label}:${(step.children || []).map((child) => `${child.id}:${child.status}:${child.label}`).join(',')}`).join(),
  JSON.stringify(expandedJobs.value),
  themeState.isDark,
]

let followLock = false
let contentObserver: ResizeObserver | null = null
let childObserver: MutationObserver | null = null

const stickToBottom = () => {
  const el = threadRef.value
  if (!el || !pinBottom.value) return
  followLock = true
  el.scrollTop = el.scrollHeight
  followLock = false
}

const onThreadScroll = () => {
  if (followLock) return
  const el = threadRef.value
  if (!el) return
  pinBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 48
}

const scrollBottom = async () => {
  await nextTick()
  stickToBottom()
}

const observeThreadGrowth = () => {
  const el = threadRef.value
  if (!el || typeof ResizeObserver === 'undefined') return
  contentObserver?.disconnect()
  childObserver?.disconnect()
  contentObserver = new ResizeObserver(() => stickToBottom())
  const watchChildren = () => {
    for (const child of el.children) contentObserver?.observe(child)
  }
  watchChildren()
  childObserver = new MutationObserver(watchChildren)
  childObserver.observe(el, { childList: true })
}

const resizeComposer = () => {
  const el = inputRef.value
  if (!el) return
  el.style.height = '22px'
  el.style.height = `${Math.min(Math.max(el.scrollHeight, 22), 88)}px`
}

watch(
  () => [props.browserId, props.name, props.url],
  () => {
    const id = String(props.browserId || '').trim()
    if (!id) return
    ensureBrowserChat({
      browserId: id,
      title: props.name ? `浏览 ${props.name}` : `浏览 ${hostnameOf(props.url || '')}`,
    })
  },
  { immediate: true },
)

watch(
  () => `${session.value?.todos?.map((t) => t.status).join('') || ''}|${session.value?.messages.map((item) => `${item.id}:${item.status}:${item.content.length}:${item.steps.length}:${item.todos?.length || 0}:${(item.todos || []).map((t) => t.status).join('')}`).join('|')}`,
  () => { void scrollBottom() },
)

const sendPrompt = async (text: string) => {
  const current = session.value
  if (!text || !current || busy.value) return
  await sendChatMessage(text, undefined, { sessionId: current.id })
  await scrollBottom()
}

const startFromCard = (prompt: string) => {
  if (busy.value) {
    draft.value = prompt
    void nextTick(resizeComposer)
    return
  }
  void sendPrompt(prompt)
}

const submit = async () => {
  const text = draft.value.trim()
  if (!text) return
  draft.value = ''
  void nextTick(resizeComposer)
  await sendPrompt(text)
}

const stop = () => {
  const id = String(props.browserId || '').trim()
  if (id) {
    stopBrowserAgent(id)
    return
  }
  if (session.value) stopChat(session.value.id)
}

const clear = () => {
  const id = String(props.browserId || '').trim()
  if (id) clearBrowserChat(id)
  pinBottom.value = true
}

onMounted(observeThreadGrowth)
onUnmounted(() => {
  contentObserver?.disconnect()
  childObserver?.disconnect()
  contentObserver = null
  childObserver = null
})

const onCompositionStart = () => {
  composing.value = true
}

const onCompositionEnd = () => {
  composing.value = false
  compositionEndedAt = Date.now()
}

const onKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Escape' && busy.value) {
    event.preventDefault()
    stop()
    return
  }
  if (!shouldSubmitComposerEnter(event, composing.value, compositionEndedAt)) return
  event.preventDefault()
  void submit()
}
</script>

<style scoped>
.browser-agent {
  width: 340px;
  min-width: 280px;
  flex: 0 0 340px;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--bg-secondary, #fff);
  border-radius: 4px;
  margin-bottom: 5px;
  margin-right: 5px;
}

.pane-header {
  position: relative;
  height: 36px;
  min-height: 36px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  gap: 10px;
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

.pane-header .header-action {
  margin-left: auto;
}

.header-action {
  border: none;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}

.header-action:hover {
  color: var(--text-primary, #2d3748);
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.agent-thread {
  flex: 1;
  min-height: 0;
  overflow: auto;
  overflow-anchor: none;
  padding: 12px 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scrollbar-width: none;
}

.chat-turn {
  min-width: 0;
  max-width: 100%;
}

.agent-thread::-webkit-scrollbar {
  display: none;
}

.feature-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 12px;
  min-height: 0;
}

.feature-kicker {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary, #718096);
}

.feature-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}

.feature-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 10px 10px 9px;
  border: none;
  border-radius: 12px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 4.5%, transparent);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.1s ease-out;
}

.feature-card:hover {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 7.5%, transparent);
}

.feature-card:active {
  transform: scale(0.97);
}

.feature-icon {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--text-primary, #2d3748);
  background: color-mix(in srgb, var(--bg-secondary, #fff) 80%, transparent);
}

.feature-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.feature-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.feature-desc {
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-secondary, #718096);
  overflow-wrap: anywhere;
  word-break: break-word;
}

.chat-turn.is-user {
  display: flex;
  justify-content: flex-end;
  min-width: 0;
}

.user-turn {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  max-width: 88%;
  min-width: 0;
}

.watch-chip {
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-secondary, #94a3b8);
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
  word-break: break-word;
}

.assistant-turn {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
}

.todo-card {
  flex-shrink: 0;
  padding: 10px 12px 8px;
  border: 0.5px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 55%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-secondary, #fff) 88%, transparent);
  box-shadow: 0 1px 2px color-mix(in srgb, #000 4%, transparent), 0 6px 16px color-mix(in srgb, #000 5%, transparent);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.todo-card-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.todo-card-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
}

.todo-card-meta {
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #718096);
}

.todo-card-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 168px;
  overflow: auto;
  scrollbar-width: none;
}

.todo-card-list::-webkit-scrollbar {
  display: none;
}

.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  line-height: 1.45;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 78%, transparent);
}

.todo-item.is-done {
  color: color-mix(in srgb, var(--text-primary, #2d3748) 42%, transparent);
}

.todo-item.is-done .todo-text {
  text-decoration: line-through;
}

.todo-item.is-cancelled {
  opacity: 0.42;
}

.todo-item.is-cancelled .todo-text {
  text-decoration: line-through;
}

.todo-mark {
  flex-shrink: 0;
  width: 16px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 38%, transparent);
}

.todo-item.is-done .todo-mark {
  color: color-mix(in srgb, var(--text-primary, #2d3748) 42%, #22c55e);
}

.todo-text {
  min-width: 0;
  flex: 1 1 auto;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.activity-entry {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.activity-line {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  min-width: 0;
  width: 100%;
}

.activity-line.is-task {
  width: 100%;
  padding: 0;
  border: none;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.activity-toggle {
  flex-shrink: 0;
  margin-left: auto;
  font-size: 11px;
  color: var(--text-secondary, #718096);
  white-space: nowrap;
}

.activity-children {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px 0 0 22px;
  padding-left: 8px;
  border-left: 1px solid color-mix(in srgb, var(--text-primary, #2d3748) 10%, transparent);
}

.activity-line.is-child .activity-text {
  font-size: 12px;
}

.activity-icon {
  flex-shrink: 0;
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

.assistant-text {
  min-width: 0;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.activity-text {
  flex: 1 1 auto;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.activity-text.is-live,
.assistant-thinking {
  color: color-mix(in srgb, var(--text-primary, #2d3748) 62%, transparent);
  animation: chat-think-pulse 1.2s ease-in-out infinite;
}

.activity-line.is-failed .activity-text,
.agent-error,
.activity-detail {
  color: var(--color-warning, #c2410c);
}

.activity-detail {
  margin: 0 0 0 24px;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

.assistant-thinking,
.agent-note,
.agent-error {
  font-size: 13px;
  line-height: 1.7;
}

.agent-note {
  color: var(--text-secondary, #718096);
}

.assistant-text :deep(.markstream-vue) {
  --fade-duration: 0.32s;
  --ms-text-body: 13px;
  --ms-text-h1: 16px;
  --ms-text-h2: 15px;
  --ms-text-h3: 14px;
  --ms-leading-body: 1.65;
  font-size: 13px;
  line-height: 1.65;
}

.assistant-text :deep(p) {
  margin: 0 0 8px;
}

.assistant-text :deep(p:last-child) {
  margin-bottom: 0;
}

.write-block {
  overflow: hidden;
  border-radius: 10px;
  border: 1px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 70%, transparent);
}

.write-block.is-quiz .write-stat {
  color: var(--color-primary, #2563eb);
}

.write-head {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
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
}

.write-quiz {
  padding: 8px 8px 10px;
  background: var(--bg-secondary, #fff);
}

.watch-bar {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.4;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 78%, transparent);
  background: color-mix(in srgb, var(--text-primary, #2d3748) 5%, transparent);
}

.watch-bar-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 0 3px color-mix(in srgb, #22c55e 22%, transparent);
}

.watch-bar.is-paused .watch-bar-dot,
.watch-bar.is-stalled .watch-bar-dot {
  background: #f59e0b;
  box-shadow: 0 0 0 3px color-mix(in srgb, #f59e0b 22%, transparent);
}

.watch-bar.is-captcha .watch-bar-dot,
.watch-bar.is-quiz .watch-bar-dot {
  background: #ef4444;
  box-shadow: 0 0 0 3px color-mix(in srgb, #ef4444 22%, transparent);
}

.watch-bar-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.composer-dock {
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 10px 12px;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    color-mix(in srgb, var(--bg-secondary, #fff) 72%, transparent) 28%,
    var(--bg-secondary, #fff) 100%
  );
}

.composer {
  flex-shrink: 0;
  padding: 0;
  background: none;
}

.composer-box {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 8px 6px 12px;
  border: 0.5px solid color-mix(in srgb, var(--border-primary, #e2e8f0) 55%, transparent);
  border-radius: 16px;
  background: color-mix(in srgb, var(--bg-secondary, #fff) 88%, transparent);
  box-shadow: 0 1px 2px color-mix(in srgb, #000 4%, transparent), 0 6px 16px color-mix(in srgb, #000 5%, transparent);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.composer-box:focus-within {
  border-color: color-mix(in srgb, var(--text-primary, #2d3748) 8%, var(--border-primary, #e2e8f0));
}

.composer-input {
  box-sizing: border-box;
  width: 100%;
  min-height: 22px;
  max-height: 88px;
  resize: none;
  border: none;
  padding: 2px 2px 0 0;
  font: inherit;
  font-size: 13px;
  line-height: 1.45;
  color: var(--text-primary, #2d3748);
  background: transparent;
  outline: none;
}

.composer-input::placeholder {
  color: color-mix(in srgb, var(--text-primary, #2d3748) 38%, transparent);
}

.composer-toolbar {
  display: flex;
  align-items: center;
  gap: 6px;
}

.composer-place {
  min-width: 0;
  margin-right: auto;
  font-size: 12px;
  color: var(--text-secondary, #718096);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

[data-theme="dark"] .todo-card,
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

@keyframes chat-think-pulse {
  0%, 100% { opacity: 0.72; }
  50% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .activity-text.is-live,
  .assistant-thinking,
  .feature-card {
    animation: none;
    transition: none;
  }
}
</style>
