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
    <div ref="threadRef" class="agent-thread">
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
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                <path v-for="(d, index) in card.paths" :key="index" :d="d" />
              </svg>
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
        class="chat-turn"
        :class="`is-${message.role}`"
      >
        <div v-if="message.role === 'user'" class="user-turn">
          <div v-if="message.kind === 'watch'" class="watch-chip">{{ message.content }}</div>
          <div v-else class="user-bubble">{{ message.content }}</div>
        </div>
        <div v-else class="assistant-turn">
          <ul v-if="message.todos?.length" class="todo-list" aria-label="任务清单">
            <li
              v-for="(item, index) in message.todos"
              :key="item.id"
              class="todo-item"
              :class="`is-${item.status}`"
            >
              <span class="todo-mark" aria-hidden="true">{{ item.status === 'done' ? '✓' : item.status === 'cancelled' ? '–' : String(index + 1) }}</span>
              <span class="todo-text">{{ item.text }}</span>
            </li>
          </ul>
          <template v-for="block in assistantTimeline(message)" :key="block.key">
            <div
              v-if="block.type === 'step'"
              class="activity-entry"
            >
              <div class="activity-line" :class="[`is-${block.step.status}`]">
                <span class="activity-icon" aria-hidden="true">
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
                    <path v-for="(d, index) in iconPaths(block.step.name)" :key="index" :d="d" />
                  </svg>
                </span>
                <span class="activity-text" :class="{ 'is-live': block.step.status === 'running' }">{{ block.step.label }}</span>
              </div>
              <p v-if="block.step.status === 'failed' && block.step.detail" class="activity-detail">{{ block.step.detail }}</p>
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
                  <span class="write-stat">{{ quizStatFor(message, block.step.id, quizCardsFor(block.step)) }}</span>
                </button>
                <div v-if="isQuizOpen(message.id, block.step.id)" class="write-quiz">
                  <AgentQuizBlock
                    layout="chat"
                    :step-id="block.step.id"
                    :cards="quizCardsFor(block.step)"
                    @attempt="onQuizAttempt(message.id, $event)"
                  />
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
            <div v-if="isQuizOpen(message.id, `${message.id}-md`)" class="write-quiz">
              <AgentQuizBlock
                layout="chat"
                :step-id="`${message.id}-md`"
                :cards="fallbackQuizCards(message)"
                @attempt="onQuizAttempt(message.id, $event)"
              />
            </div>
          </div>
          <div v-if="isThinking(message)" class="assistant-thinking">正在思考</div>
          <div v-if="message.status === 'stopped'" class="agent-note">已停止生成</div>
          <div v-if="message.error" class="agent-error">{{ message.error }}</div>
        </div>
      </div>
    </div>
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
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import MarkdownRender from 'markstream-vue'
import 'markstream-vue/index.css'
import '../../services/model/markstream'
import { themeState } from '../../composables/useTheme'
import AgentQuizBlock from '../agent/AgentQuizBlock.vue'
import {
  browserChatSessions,
  clearBrowserChat,
  ensureBrowserChat,
  formatQuizAttempt,
  recordQuizAttempt,
  sendChatMessage,
  stopChat,
  type AgentChatMessage,
  type AgentQuizAttempt,
} from '../../services/agent/chat'
import { hostnameOf } from '../../services/browser/appBrowser'
import { browserVideoWatches } from '../../services/chaoxing/browser/watch'
import { shouldSubmitComposerEnter } from '../../utils/ui/composerEnter'
import { getQuizCards, getQuizTitle, parseMarkdownQuizzes, parseQuizCards, type QuizCard } from '../../utils/question/quizPractice'
import type { ImportTaskStep } from '../../services/app/importTasks'
import { assistantTimeline } from '../../views/agentChat/threadDisplay'

const props = defineProps<{
  browserId?: string
  name?: string
  url?: string
}>()

const draft = ref('')
const threadRef = ref<HTMLElement | null>(null)
const inputRef = ref<HTMLTextAreaElement | null>(null)
const composing = ref(false)
const openedQuizKey = ref<string | null>(null)
const mdQuizCache = ref<Record<string, QuizCard[]>>({})
const reportedQuiz = new Set<string>()
let compositionEndedAt = 0

const featureCards = [
  {
    id: 'read',
    title: '读当前页',
    desc: '看看现在打开的是什么',
    prompt: '读一下当前网页，告诉我现在在哪、页面上能做什么。',
    paths: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c2.7 2.8 4 5.8 4 9s-1.3 6.2-4 9c-2.7-2.8-4-5.8-4-9s1.3-6.2 4-9z'],
  },
  {
    id: 'click',
    title: '点一下',
    desc: '按钮、链接或选项',
    prompt: '帮我点页面上该点的按钮或链接。',
    paths: ['M9 9l11 4-5 2-2 5z', 'M5 5v6'],
  },
  {
    id: 'type',
    title: '填写',
    desc: '在输入框里打字',
    prompt: '帮我填写这个页面上的表单。',
    paths: ['M4 7h16v10H4z', 'M8 17v2', 'M16 17v2', 'M8 11h8'],
  },
  {
    id: 'play',
    title: '播完章节',
    desc: '把学习通未完成的播完',
    prompt: '把学习通未完成的章节播完。',
    paths: ['M8 6v12l10-6z'],
  },
]

const session = computed(() => {
  const id = String(props.browserId || '').trim()
  if (!id) return null
  return browserChatSessions.value.find((item) => item.browserId === id) || null
})

const streaming = computed(() => Boolean(session.value?.messages.some((item) => item.status === 'streaming')))
const placeHint = computed(() => hostnameOf(props.url || ''))
const composerPlaceholder = computed(() =>
  placeHint.value && placeHint.value !== '导航'
    ? `问「${placeHint.value}」，或让我点、填、打开…`
    : '问网页，或让我点、填、打开…',
)

const videoWatch = computed(() => {
  const id = String(props.browserId || '').trim()
  return id ? browserVideoWatches.value[id] || null : null
})

/** 播放监控中对话可能已结束，仍视为任务进行中，保留停止按钮。 */
const watchActive = computed(() => {
  const status = videoWatch.value?.status
  return status === 'watching'
    || status === 'paused'
    || status === 'stalled'
    || status === 'captcha'
    || status === 'quiz'
})
const busy = computed(() => streaming.value || watchActive.value)

const quizKeyOf = (messageId: string, stepId: string) => `${messageId}\t${stepId}`
const isQuizOpen = (messageId: string, stepId: string) => openedQuizKey.value === quizKeyOf(messageId, stepId)

const quizCardsFor = (step: ImportTaskStep): QuizCard[] => {
  const stored = getQuizCards(step.id)
  if (stored.length) return stored
  return parseQuizCards(step.preview || [])
}

const quizTitleFor = (step?: ImportTaskStep, stepId?: string) =>
  getQuizTitle(step?.id || stepId || '', '') || step?.title || '练习'

const isQuizStep = (step: ImportTaskStep) =>
  step.name === 'present_quiz' && step.status === 'done' && quizCardsFor(step).length > 0

const stepQuizCards = (message: AgentChatMessage) =>
  (message.steps || []).filter((step) => isQuizStep(step)).flatMap((step) => quizCardsFor(step))

const fallbackQuizCards = (message: AgentChatMessage) => {
  if (stepQuizCards(message).length) return []
  const parsed = parseMarkdownQuizzes(message.content)
  return parsed.length ? (mdQuizCache.value[message.id] || parsed) : []
}

const quizStatFor = (message: AgentChatMessage, _stepId: string, cards: QuizCard[]) => {
  const done = new Set((message.quizAttempts || []).map((item) => item.uid))
  const answered = cards.filter((card) => done.has(card.uid)).length
  if (message.quizReported || (cards.length && answered >= cards.length)) return `已完成 ${cards.length}`
  if (answered) return `${answered}/${cards.length}`
  return `${cards.length} 题`
}

const isThinking = (message: AgentChatMessage) =>
  message.status === 'streaming' && message.waiting !== false && !message.content

const latestQuizKey = computed(() => {
  const messages = [...(session.value?.messages || [])].reverse()
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const step of [...(message.steps || [])].reverse()) {
      if (isQuizStep(step)) return quizKeyOf(message.id, step.id)
    }
    if (fallbackQuizCards(message).length) return quizKeyOf(message.id, `${message.id}-md`)
  }
  return null
})

const iconPaths = (name: string) => {
  if (name === 'browser_get_page' || name === 'browser_get_state') {
    return ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M3 12h18', 'M12 3c2.4 2.6 3.6 5.4 3.6 8.2S14.4 18.4 12 21']
  }
  if (name === 'browser_navigate') return ['M10 13a5 5 0 0 0 7 0l1-1a5 5 0 0 0-7-7l-1 1', 'M14 11a5 5 0 0 0-7 0l-1 1a5 5 0 0 0 7 7l1-1']
  if (name === 'browser_reload') return ['M21 12a9 9 0 1 1-3-6.7', 'M21 3v6h-6']
  if (name === 'browser_go_back') return ['M15 6l-6 6 6 6']
  if (name === 'browser_go_forward') return ['M9 6l6 6-6 6']
  if (name === 'browser_click' || name === 'browser_click_text') return ['M9 9l11 4-5 2-2 5z']
  if (name === 'browser_type') return ['M4 7h16v10H4z', 'M8 12h8']
  if (name === 'browser_scroll') return ['M12 5v14', 'M6 11l6-6 6 6', 'M6 13l6 6 6-6']
  if (name === 'browser_eval') return ['M8 8l-4 4 4 4', 'M16 8l4 4-4 4']
  if (name === 'browser_todo') return ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11']
  if (name === 'browser_site_graph') return ['M6 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M18 8a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M8 18a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M16 17a2 2 0 1 0 0-4 2 2 0 0 0 0 4z', 'M8 8l8 1', 'M7 9l2 6']
  if (name.startsWith('browser_chaoxing') || name === 'browser_wait' || name === 'browser_finish') {
    return name === 'browser_wait'
      ? ['M12 6v6l4 2', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z']
      : name === 'browser_finish'
        ? ['M20 6L9 17l-5-5']
        : ['M8 6v12l10-6z']
  }
  if (name === 'present_quiz') return ['M9 11l3 3L22 4', 'M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11']
  return ['M12 3v3', 'M12 18v3', 'M3 12h3', 'M18 12h3']
}

const scrollBottom = async () => {
  await nextTick()
  const el = threadRef.value
  if (el) el.scrollTop = el.scrollHeight
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
  () => session.value?.messages.map((item) => `${item.id}:${item.status}:${item.content.length}:${item.steps.length}:${item.todos?.length || 0}:${(item.todos || []).map((t) => t.status).join('')}`).join('|'),
  () => { void scrollBottom() },
)

watch(latestQuizKey, (key) => {
  openedQuizKey.value = key
}, { immediate: true })

const toggleQuiz = (messageId: string, stepId: string) => {
  const key = quizKeyOf(messageId, stepId)
  openedQuizKey.value = openedQuizKey.value === key ? null : key
}

const onQuizAttempt = (messageId: string, attempt: AgentQuizAttempt) => {
  const current = session.value
  if (!current || attempt.kind === 'note') return
  recordQuizAttempt(current.id, messageId, attempt)
  const key = `${attempt.stepId}:${attempt.uid}`
  if (reportedQuiz.has(key) || busy.value) return
  reportedQuiz.add(key)
  void sendChatMessage(formatQuizAttempt(attempt), undefined, { sessionId: current.id })
}

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
  if (session.value) stopChat(session.value.id)
}

const clear = () => {
  const id = String(props.browserId || '').trim()
  if (id) clearBrowserChat(id)
  openedQuizKey.value = null
}

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
  padding: 12px 12px 8px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  scrollbar-width: none;
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
}

.feature-desc {
  font-size: 11px;
  line-height: 1.35;
  color: var(--text-secondary, #718096);
}

.chat-turn.is-user {
  display: flex;
  justify-content: flex-end;
}

.user-turn {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  max-width: 88%;
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
}

.todo-list {
  margin: 0;
  padding: 0;
  list-style: none;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 12px;
  line-height: 1.45;
  color: color-mix(in srgb, var(--text-primary, #2d3748) 72%, transparent);
}

.todo-item.is-done {
  color: color-mix(in srgb, var(--text-primary, #2d3748) 42%, transparent);
}

.todo-item.is-done .todo-text {
  text-decoration: line-through;
}

.todo-item.is-cancelled {
  opacity: 0.45;
}

.todo-mark {
  flex-shrink: 0;
  width: 16px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #718096);
}

.todo-item.is-done .todo-mark {
  color: color-mix(in srgb, var(--text-primary, #2d3748) 55%, #16a34a);
}

.todo-text {
  min-width: 0;
  white-space: pre-wrap;
  word-break: break-word;
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

.activity-text {
  white-space: pre-wrap;
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

.composer {
  flex-shrink: 0;
  padding: 8px 10px 12px;
  background: linear-gradient(
    to bottom,
    transparent 0%,
    color-mix(in srgb, var(--bg-secondary, #fff) 72%, transparent) 28%,
    var(--bg-secondary, #fff) 100%
  );
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
