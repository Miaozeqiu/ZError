<template>
  <div class="question-pane">
    <div class="switcher">
      <button
        class="switcher-btn"
        type="button"
        :disabled="!canPrev"
        @click="$emit('prev')"
      >上一题</button>
      <QuestionIndexSwitcher
        :index="index"
        :total="total"
        blur-prefix="campus"
        @goto="$emit('goto', $event)"
      />
      <button
        class="switcher-btn"
        type="button"
        :disabled="!canNext"
        @click="$emit('next')"
      >下一题</button>
    </div>

    <div v-if="!question" class="detail-empty">这套试卷还没有题目</div>
    <div v-else class="question-detail">
      <div class="detail-kicker">{{ campusQuestionTypeLabel(question.type) }}</div>
      <div class="detail-content">{{ question.content }}</div>
      <div v-if="options.length" class="detail-options">
        <div v-for="item in options" :key="`${question.id}-${item.key}`" class="detail-option">
          <span class="detail-option-key">{{ item.key }}</span>
          <span>{{ item.text }}</span>
        </div>
      </div>
      <button class="reveal-btn" type="button" @click="showAnswer = !showAnswer">
        {{ showAnswer ? '隐藏答案' : '显示答案' }}
      </button>
      <div v-if="showAnswer" class="detail-answer">
        {{ question.answer || '暂无答案（未认证时可能被隐藏）' }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { campusOptionRows, campusQuestionTypeLabel, type CampusQuestion } from '../../services/app/campus'
import QuestionIndexSwitcher from '../ui/QuestionIndexSwitcher.vue'

const props = defineProps<{
  question: CampusQuestion | null
  index: number
  total: number
}>()

defineEmits<{
  prev: []
  next: []
  goto: [index: number]
}>()

const showAnswer = ref(true)
const options = computed(() => campusOptionRows(props.question?.options))
const canPrev = computed(() => props.index > 0)
const canNext = computed(() => props.total > 0 && props.index < props.total - 1)
</script>

<style scoped>
.question-pane {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.switcher {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 16px 0;
  flex-shrink: 0;
  user-select: none;
  -webkit-user-select: none;
}

.switcher-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}

.switcher-btn:hover:not(:disabled) {
  color: var(--text-primary, #2d3748);
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.switcher-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.switcher-btn:disabled {
  opacity: 0.35;
  cursor: default;
}

.question-detail,
.detail-empty {
  flex: 1;
  min-width: 0;
  padding: 12px 20px 20px;
  overflow: auto;
}

.detail-empty {
  color: var(--text-secondary, #718096);
  font-size: 13px;
}

.detail-kicker {
  font-size: 12px;
  color: var(--text-secondary, #718096);
  margin-bottom: 8px;
}

.detail-content,
.detail-option,
.detail-answer {
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
}

.detail-options {
  margin: 14px 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.detail-option {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 5%, transparent);
}

.detail-option-key {
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  margin-top: 1px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: #2563eb;
  background: #edf4ff;
}

.reveal-btn {
  border: none;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 0;
}

.reveal-btn:hover {
  color: var(--text-primary, #2d3748);
}

.reveal-btn:active {
  transform: scale(0.97);
}

.detail-answer {
  margin-top: 10px;
  color: #2F6F78;
}
</style>
