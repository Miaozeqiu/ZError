<template>
  <div class="quiz-option-reference" :class="{ 'is-compact': compact, 'is-clickable': canOpen }">
    <component
      :is="canOpen ? 'button' : 'div'"
      class="quiz-option-reference-main"
      :type="canOpen ? 'button' : undefined"
      :aria-label="canOpen ? `返回原题，选项 ${quote.key}，${quote.text}` : undefined"
      @click="canOpen && openQuizReview(quote, quote)"
    >
      <Icon icon="lucide:quote" width="14" height="14" aria-hidden="true" />
      <span class="quiz-option-reference-text">
        <span class="quiz-option-reference-label">选项 {{ quote.key }}</span>
        <span class="quiz-option-reference-option">{{ quote.text }}</span>
        <span v-if="!compact" class="quiz-option-reference-question">{{ quote.question }}</span>
      </span>
    </component>
    <button
      v-if="removable"
      class="quiz-option-reference-remove attachment-corner-remove"
      type="button"
      :aria-label="`移除选项 ${quote.key} 的引用`"
      @click="emit('remove')"
    >
      <Icon icon="lucide:x" width="10" height="10" aria-hidden="true" />
    </button>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Icon } from '@iconify/vue/offline'
import type { AgentQuizOptionQuote } from '../../services/agent/chat'
import '../../utils/ui/agentIcons'
import { openQuizReview, quizCardForReview } from './useAgentChatPanes'

const props = defineProps<{ quote: AgentQuizOptionQuote; removable?: boolean; compact?: boolean }>()
const emit = defineEmits<{ remove: [] }>()
const canOpen = computed(() => Boolean(quizCardForReview(props.quote, props.quote)))
</script>

<style scoped>
.quiz-option-reference {
  position: relative;
  display: flex;
  align-items: center;
  gap: 2px;
  min-width: 0;
  width: min(400px, 100%);
  box-sizing: border-box;
  border-radius: 10px;
  padding: 2px;
  background: var(--bg-tertiary, #e8e8ed);
  color: var(--text-primary);
}

.quiz-option-reference-main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 13px;
  text-align: start;
}

.quiz-option-reference.is-compact {
  flex: 0 0 min(220px, 100%);
  height: var(--composer-attachment-height, 56px);
  border: 1px solid color-mix(in srgb, var(--text-primary) 10%, transparent);
  background: color-mix(in srgb, var(--text-primary) 5%, transparent);
}

.is-compact .quiz-option-reference-main {
  gap: 6px;
  padding: 3px 5px 3px 7px;
}

.is-compact .quiz-option-reference-text {
  gap: 1px;
}

.is-compact .quiz-option-reference-label {
  line-height: 1.15;
}

.is-compact .quiz-option-reference-option {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
  line-height: 1.18;
}

.quiz-option-reference-main > svg {
  flex-shrink: 0;
  color: var(--text-secondary);
}

.quiz-option-reference-text {
  display: grid;
  gap: 2px;
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.quiz-option-reference-label,
.quiz-option-reference-question {
  color: var(--text-secondary);
  font-size: 11px;
}

.quiz-option-reference-question {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

button.quiz-option-reference-main {
  cursor: pointer;
}

.quiz-option-reference-main:focus-visible {
  outline: 2px solid var(--color-primary, #2563eb);
  outline-offset: -2px;
}

@media (hover: hover) {
  .quiz-option-reference.is-clickable:has(.quiz-option-reference-main:hover) {
    background: color-mix(in srgb, var(--text-primary) 8%, var(--bg-secondary, #fff));
  }
}
</style>
