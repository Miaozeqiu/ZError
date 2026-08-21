<template>
  <div class="agent-quiz" :class="{ 'is-pane': isPane }">
    <div class="quiz-stage">
      <Transition :name="slideName" mode="out-in">
        <div v-if="current" :key="current.uid" class="quiz-card">
          <div class="quiz-top">
            <span class="quiz-index">{{ currentIndex + 1 }}</span>
            <span v-if="current.question_type" class="quiz-type">{{ current.question_type }}</span>
            <span v-if="current.question_id" class="quiz-id">#{{ current.question_id }}</span>
            <span class="quiz-count">{{ currentIndex + 1 }} / {{ cards.length }}</span>
          </div>
          <div class="quiz-stem">{{ current.question }}</div>

          <div v-if="kindOf(current) === 'fill'" class="quiz-fill">
            <input
              v-if="!stateOf(current).submitted"
              class="quiz-input"
              :value="stateOf(current).selected[0] || ''"
              placeholder="输入答案后回车"
              @input="onFill(current, ($event.target as HTMLInputElement).value)"
              @keydown.enter.prevent="submitCard(current)"
            />
            <button
              v-if="!stateOf(current).submitted"
              class="quiz-submit"
              type="button"
              :disabled="!stateOf(current).selected[0]?.trim()"
              @click="submitCard(current)"
            >提交</button>
            <div v-else class="quiz-fill-answer">{{ stateOf(current).selected[0] }}</div>
          </div>

          <div v-else-if="kindOf(current) === 'judgement' && !optionsOf(current).length" class="quiz-options">
            <button
              v-for="choice in judgementChoices"
              :key="choice.key"
              class="quiz-option"
              type="button"
              :class="optionClass(current, choice.key)"
              :disabled="stateOf(current).submitted"
              @click="pick(current, choice.key)"
            >
              <span class="quiz-opt-key">{{ choice.key }}</span>
              <span class="quiz-opt-text">{{ choice.text }}</span>
            </button>
          </div>

          <div v-else class="quiz-options">
            <button
              v-for="option in optionsOf(current)"
              :key="option.key || option.text"
              class="quiz-option"
              type="button"
              :class="optionClass(current, option.key || option.text)"
              :disabled="stateOf(current).submitted"
              @click="pick(current, option.key || option.text)"
            >
              <span v-if="option.key" class="quiz-opt-key">{{ option.key }}</span>
              <span class="quiz-opt-text">{{ option.text }}</span>
            </button>
          </div>

          <button
            v-if="kindOf(current) === 'multiple' && !stateOf(current).submitted"
            class="quiz-submit"
            type="button"
            :disabled="!stateOf(current).selected.length"
            @click="submitCard(current)"
          >提交</button>

          <div v-if="stateOf(current).submitted && current.answer" class="quiz-result" :class="stateOf(current).correct ? 'is-ok' : 'is-bad'">
            <span>{{ stateOf(current).correct ? '回答正确' : '回答错误' }}</span>
            <span class="quiz-result-answer">答案 {{ formatAnswerLabel(current.answer, current.options, current.question_type) }}</span>
            <span v-if="stateOf(current).mastery != null" class="quiz-result-answer">掌握程度 {{ masteryText(stateOf(current).mastery) }}</span>
          </div>
          <div v-else-if="stateOf(current).submitted" class="quiz-result">
            <span>已记录选择 {{ stateOf(current).selected.join('') }}</span>
          </div>
          <div v-if="stateOf(current).submitted && current.explanation" class="quiz-explain">{{ current.explanation }}</div>
        </div>
      </Transition>
    </div>

    <div v-if="cards.length > 1" class="quiz-nav">
      <button
        class="quiz-nav-btn"
        type="button"
        :disabled="currentIndex <= 0"
        @click="goTo(currentIndex - 1)"
      >上一题</button>
      <div class="quiz-dots">
        <button
          v-for="(card, index) in cards"
          :key="card.uid"
          class="quiz-dot"
          type="button"
          :class="dotClass(card, index)"
          :aria-label="`第 ${index + 1} 题`"
          @click="goTo(index)"
        />
      </div>
      <button
        class="quiz-nav-btn"
        type="button"
        :disabled="currentIndex >= cards.length - 1"
        @click="goTo(currentIndex + 1)"
      >下一题</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { databaseService } from '../services/database'
import { masteryLabel } from '../utils/questionMetrics'
import {
  formatAnswerLabel,
  getQuizAnswer,
  gradeQuiz,
  nextMastery,
  parseOptions,
  quizKind,
  resolveAnswerKeys,
  setQuizAnswer,
  type QuizAnswerState,
  type QuizCard,
} from '../utils/quizPractice'

const props = defineProps<{
  cards: QuizCard[]
  stepId: string
  layout?: 'chat' | 'pane'
}>()

const isPane = computed(() => props.layout === 'pane')

const emit = defineEmits<{
  attempt: [payload: {
    stepId: string
    uid: string
    question_id?: number
    question: string
    options?: string
    selected: string
    answer: string
    correct?: boolean
    note?: string
    explanation?: string
    index?: number
    total?: number
    kind?: 'submit' | 'note'
  }]
  complete: [payload: {
    stepId: string
    uid: string
    question_id?: number
    question: string
    options?: string
    selected: string
    answer: string
    correct?: boolean
    note?: string
    explanation?: string
    index?: number
    total?: number
    kind?: 'submit' | 'note'
  }[]]
}>()

const judgementChoices = [
  { key: '对', text: '正确' },
  { key: '错', text: '错误' },
]

const local = reactive<Record<string, QuizAnswerState>>({})
const currentIndex = ref(0)
const slideDir = ref<'next' | 'prev'>('next')

const slideName = computed(() => `quiz-slide-${slideDir.value}`)

const current = computed(() => props.cards[currentIndex.value] || props.cards[0] || null)

const stateOf = (card: QuizCard): QuizAnswerState => {
  if (!local[card.uid]) {
    local[card.uid] = getQuizAnswer(props.stepId, card.uid) || {
      selected: [],
      submitted: false,
      note: '',
    }
  }
  const state = local[card.uid]
  if (state.submitted && card.answer) {
    state.correct = gradeQuiz(state.selected, card.answer, card.question_type, card.options)
  }
  return state
}

const firstUnanswered = () => {
  const index = props.cards.findIndex((card) => !stateOf(card).submitted)
  return index >= 0 ? index : 0
}

watch(
  () => `${props.stepId}:${props.cards.map((card) => card.uid).join(',')}`,
  () => {
    currentIndex.value = firstUnanswered()
  },
  { immediate: true },
)

const persist = (card: QuizCard) => {
  setQuizAnswer(props.stepId, card.uid, { ...stateOf(card) })
}

const attemptPayload = (card: QuizCard) => {
  const state = stateOf(card)
  const index = props.cards.findIndex((item) => item.uid === card.uid)
  return {
    stepId: props.stepId,
    uid: card.uid,
    question_id: card.question_id,
    question: card.question,
    options: card.options,
    selected: formatAnswerLabel(state.selected.join(''), card.options, card.question_type) || state.selected.join(''),
    answer: formatAnswerLabel(card.answer, card.options, card.question_type) || card.answer,
    correct: state.correct,
    explanation: card.explanation,
    index: index >= 0 ? index + 1 : undefined,
    total: props.cards.length,
    kind: 'submit' as const,
  }
}

const notifyProgress = (card: QuizCard) => {
  emit('attempt', attemptPayload(card))
  const attempts = props.cards.filter((item) => stateOf(item).submitted).map((item) => attemptPayload(item))
  if (attempts.length === props.cards.length) emit('complete', attempts)
}

const masteryText = (value?: number) => masteryLabel(value)
const kindOf = (card: QuizCard) => quizKind(card.question_type, card.options)
const optionsOf = (card: QuizCard) => parseOptions(card.options)

const optionClass = (card: QuizCard, key: string) => {
  const state = stateOf(card)
  const picked = state.selected.includes(key)
  if (!state.submitted) return { picked }
  const expected = resolveAnswerKeys(card.answer, card.options, card.question_type)
  const isRight = expected.includes(key)
  return {
    picked,
    correct: isRight,
    wrong: picked && !isRight,
  }
}

const goTo = (index: number) => {
  if (index < 0 || index >= props.cards.length || index === currentIndex.value) return
  slideDir.value = index > currentIndex.value ? 'next' : 'prev'
  currentIndex.value = index
}

const onFill = (card: QuizCard, value: string) => {
  const state = stateOf(card)
  if (state.submitted) return
  state.selected = [value]
  persist(card)
}

const pick = (card: QuizCard, key: string) => {
  const state = stateOf(card)
  if (state.submitted) return
  const kind = kindOf(card)
  if (kind === 'multiple') {
    state.selected = state.selected.includes(key)
      ? state.selected.filter((item) => item !== key)
      : [...state.selected, key]
    persist(card)
    return
  }
  state.selected = [key]
  persist(card)
  void submitCard(card)
}

const submitCard = async (card: QuizCard) => {
  const state = stateOf(card)
  if (state.submitted || !state.selected.length) return
  state.correct = gradeQuiz(state.selected, card.answer, card.question_type, card.options)
  state.submitted = true
  persist(card)
  notifyProgress(card)
  if (!card.question_id) return
  try {
    const record = await databaseService.addPracticeRecord({
      questionId: card.question_id,
      userAnswer: state.selected.join(''),
      isCorrect: Boolean(state.correct),
      source: 'agent',
    })
    state.recordId = record.id
    const mastery = nextMastery(card.mastery, Boolean(state.correct))
    await databaseService.updateQuestion(card.question_id, { mastery })
    state.mastery = mastery
    card.mastery = mastery
    persist(card)
    window.dispatchEvent(new CustomEvent('questions-imported', { detail: { questionId: card.question_id } }))
  } catch {
    // keep local result
  }
}

const dotClass = (card: QuizCard, index: number) => {
  const state = stateOf(card)
  return {
    'is-current': index === currentIndex.value,
    'is-done': state.submitted,
    'is-ok': state.submitted && state.correct,
    'is-bad': state.submitted && state.correct === false,
  }
}
</script>

<style scoped>
.agent-quiz {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin: 8px 0 12px;
}

.agent-quiz.is-pane {
  flex: 1;
  min-height: 0;
  height: 100%;
  margin: 0;
  padding: 0;
  gap: 0;
}

.quiz-stage {
  min-height: 0;
  flex: 1;
  overflow: auto;
  scrollbar-width: none;
}

.quiz-stage::-webkit-scrollbar {
  display: none;
}

.agent-quiz.is-pane .quiz-stage {
  padding: 16px 16px 8px;
}

.quiz-card {
  padding: 12px 14px;
}

.quiz-top {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 8px;
}

.quiz-index,
.quiz-type,
.quiz-id,
.quiz-count {
  font-size: 11px;
  line-height: 1;
  color: var(--text-secondary, #718096);
}

.quiz-count {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}

.quiz-index {
  width: 18px;
  height: 18px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 8%, transparent);
}

.quiz-stem {
  font-size: 14px;
  line-height: 1.55;
  color: var(--text-primary, #2d3748);
  white-space: pre-wrap;
}

.quiz-options {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.quiz-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  border: none;
  border-radius: 8px;
  padding: 8px 10px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
  color: var(--text-primary, #2d3748);
  text-align: left;
  cursor: pointer;
}

.quiz-option:hover:not(:disabled) {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 9%, transparent);
}

.quiz-option:active:not(:disabled) {
  transform: scale(0.985);
}

.quiz-option.picked,
.quiz-option.correct,
.quiz-option.wrong {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 12%, transparent);
}

.quiz-option:disabled {
  cursor: default;
}

.quiz-opt-key {
  flex: 0 0 18px;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary, #718096);
}

.quiz-opt-text {
  flex: 1;
  font-size: 13px;
  line-height: 1.45;
}

.quiz-fill {
  display: flex;
  gap: 8px;
  margin-top: 10px;
}

.quiz-input {
  flex: 1;
  border: 1px solid color-mix(in srgb, var(--text-primary, #2d3748) 10%, transparent);
  border-radius: 8px;
  padding: 8px 10px;
  background: #fff;
  color: var(--text-primary, #2d3748);
  font: inherit;
  font-size: 13px;
}

.quiz-submit {
  align-self: flex-start;
  margin-top: 10px;
  border: none;
  border-radius: 8px;
  padding: 6px 12px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 8%, transparent);
  color: var(--text-primary, #2d3748);
  font-size: 12px;
  cursor: pointer;
}

.quiz-submit:active:not(:disabled) {
  transform: scale(0.97);
}

.quiz-submit:disabled {
  opacity: 0.45;
  cursor: default;
}

.quiz-result {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-top: 10px;
  font-size: 12px;
}

.quiz-result.is-ok {
  color: #15803d;
}

.quiz-result.is-bad {
  color: #b91c1c;
}

.quiz-result-answer {
  color: var(--text-secondary, #718096);
}

.quiz-explain,
.quiz-fill-answer {
  margin-top: 8px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--text-secondary, #4a5568);
  white-space: pre-wrap;
}

.quiz-nav {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 16px 14px;
}

.quiz-nav-btn {
  flex-shrink: 0;
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
  color: var(--text-primary, #2d3748);
  font-size: 12px;
  cursor: pointer;
}

.quiz-nav-btn:hover:not(:disabled) {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 10%, transparent);
}

.quiz-nav-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.quiz-nav-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.quiz-dots {
  flex: 1;
  min-width: 0;
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 6px;
}

.quiz-dot {
  width: 7px;
  height: 7px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 16%, transparent);
  cursor: pointer;
}

.quiz-dot.is-current {
  width: 16px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 55%, transparent);
}

.quiz-dot.is-done {
  background: color-mix(in srgb, #3b82f6 55%, transparent);
}

.quiz-dot.is-ok {
  background: #16a34a;
}

.quiz-dot.is-bad {
  background: #dc2626;
}

.quiz-dot.is-current.is-ok,
.quiz-dot.is-current.is-bad,
.quiz-dot.is-current.is-done {
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--text-primary, #2d3748) 10%, transparent);
}

.quiz-slide-next-enter-active,
.quiz-slide-next-leave-active,
.quiz-slide-prev-enter-active,
.quiz-slide-prev-leave-active {
  transition:
    transform 240ms cubic-bezier(0.32, 0.72, 0, 1),
    opacity 180ms ease;
}

.quiz-slide-next-enter-from {
  transform: translateX(18px);
  opacity: 0;
}

.quiz-slide-next-leave-to {
  transform: translateX(-14px);
  opacity: 0;
}

.quiz-slide-prev-enter-from {
  transform: translateX(-18px);
  opacity: 0;
}

.quiz-slide-prev-leave-to {
  transform: translateX(14px);
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .quiz-slide-next-enter-active,
  .quiz-slide-next-leave-active,
  .quiz-slide-prev-enter-active,
  .quiz-slide-prev-leave-active {
    transition: none;
  }
}
</style>
