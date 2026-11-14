<template>
  <component
    :is="canOpen ? 'button' : 'div'"
    class="quiz-review"
    :type="canOpen ? 'button' : undefined"
    :aria-description="canOpen ? '返回原题' : undefined"
    @click="canOpen && openQuizReview(target, attempt)"
  >
    <span class="quiz-review-header">
      <span>{{ attempt.index && attempt.total ? `第 ${attempt.index} / ${attempt.total} 题` : '练习作答' }}</span>
      <span :class="{ 'quiz-review-correct': attempt.correct === true, 'quiz-review-incorrect': attempt.correct === false }">
        {{ attempt.correct == null ? '已作答' : attempt.correct ? '回答正确' : '回答错误' }}
      </span>
    </span>
    <span class="quiz-review-question">{{ attempt.question }}</span>
    <span class="quiz-review-answer">
      <span>我的答案</span> {{ attempt.selected || '未选' }}
    </span>
    <span v-if="attempt.correct !== true && attempt.answer" class="quiz-review-answer">
      <span>参考答案</span> {{ attempt.answer }}
    </span>
  </component>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import type { AgentQuizAttempt, AgentQuizAttemptRef } from '../../services/agent/chat'
import { openQuizReview, quizCardForReview } from './useAgentChatPanes'

const props = defineProps<{ review: { attempt: AgentQuizAttempt; target: AgentQuizAttemptRef } }>()
const attempt = computed(() => props.review.attempt)
const target = computed(() => props.review.target)
const canOpen = computed(() => Boolean(quizCardForReview(target.value, attempt.value)))
</script>

<style scoped>
.quiz-review {
  display: grid;
  border: 0;
  border-radius: 12px;
  background: var(--bg-tertiary, #e8e8ed);
  color: var(--text-primary);
  font: inherit;
  font-size: 13px;
  line-height: 1.55;
  text-align: start;
  white-space: pre-wrap;
  gap: 7px;
  width: min(400px, 100%);
  box-sizing: border-box;
  padding: 10px 12px;
  overflow-wrap: anywhere;
}

.quiz-review-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 12px;
}

.quiz-review-correct,
.quiz-review-incorrect {
  font-weight: 600;
}

.quiz-review-correct { color: color-mix(in srgb, var(--color-success) 55%, var(--text-primary)); }
.quiz-review-incorrect { color: color-mix(in srgb, var(--color-error) 60%, var(--text-primary)); }
.quiz-review-question { font-size: 14px; font-weight: 600; }
.quiz-review-answer > span { color: var(--text-secondary); margin-inline-end: 4px; }

button.quiz-review {
  cursor: pointer;
}

button.quiz-review:focus-visible {
  outline: 2px solid var(--color-primary, #2563eb);
  outline-offset: -2px;
}

@media (hover: hover) {
  button.quiz-review:hover {
    background: color-mix(in srgb, var(--text-primary) 5%, var(--bg-tertiary, #e8e8ed));
  }
}
</style>
