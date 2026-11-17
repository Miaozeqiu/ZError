<template>
  <section class="homework-progress" aria-label="作业题目与作答情况">
    <p v-if="homework.questions.length < homework.total" class="homework-note" role="status">
      已读取 {{ homework.questions.length }} / {{ homework.total }} 道题
    </p>
    <ul role="list" class="homework-list">
      <li v-for="question in homework.questions" :key="question.question_id || question.order" class="homework-question" :data-homework-order="question.order">
        <div class="homework-question-meta">
          <span>第 {{ question.number }} 题 · {{ types[question.type] }}</span>
          <span :class="{ 'is-filled': question.status === 'filled' || question.status === 'already_matches' }">
            {{ statuses[question.status] }}
          </span>
        </div>
        <div class="homework-stem">{{ question.stem || '题干需在作答页查看' }}</div>
        <ul v-if="question.options.length" role="list" class="homework-options">
          <li v-for="(option, index) in question.options" :key="index" :class="{ 'is-selected': isSelected(question.actual, option.label) }">
            <span v-if="option.label">{{ option.label }}.</span>
            <span>{{ option.text }}</span>
            <span v-if="isSelected(question.actual, option.label)" class="homework-selected">已选</span>
          </li>
        </ul>
        <div class="homework-answer">网页作答 <span>{{ answerText(question.actual) }}</span></div>
        <div v-if="question.expected" class="homework-answer">
          {{ question.source === 'bank' ? '题库匹配' : 'Agent 拟填' }} <span>{{ answerText(question.expected) }}</span>
        </div>
        <p v-if="question.issue === 'visual_needed'" class="homework-note">图片、公式或混淆字体需在作答页核对。</p>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { HomeworkAnswer, HomeworkProgress, HomeworkQuestionProgress } from '../../services/agent/homeworkProgress'

defineProps<{ homework: HomeworkProgress }>()

const types = { single: '单选题', multiple: '多选题', judgement: '判断题', completion: '填空题', unsupported: '其他题型' }
const statuses: Record<HomeworkQuestionProgress['status'], string> = {
  answered: '已作答', unanswered: '未作答', partial: '部分已填', needs_review: '待核对',
  no_match: '题库未命中', conflict: '题库答案冲突', unmatched: '选项未匹配', filled: '已填并核对',
  already_matches: '已有答案一致', existing_answer: '保留原答案', page_changed: '页面已变化',
  controls_need_review: '控件待核对', unverified: '填写结果待核对',
}

const isSelected = (answer: HomeworkAnswer, label: string) => 'choices' in answer && answer.choices.includes(label)
const answerText = (answer: HomeworkAnswer) => 'choices' in answer
  ? answer.choices.join('、') || '未填写'
  : answer.blanks.some(value => value.trim())
    ? answer.blanks.map((value, index) => `${index + 1}. ${value.trim() || '未填'}`).join('；')
    : '未填写'
</script>

<style scoped>
.homework-progress { padding: 12px; }
.homework-list, .homework-options { display: grid; gap: 8px; padding: 0; margin: 0; list-style: none; }
.homework-question { min-width: 0; padding: 12px; border-radius: 9px; background: var(--bg-primary, #f5f5f7); }
.homework-question-meta { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 4px 12px; color: var(--text-secondary); font-size: 12px; }
.homework-question-meta .is-filled { color: var(--text-primary); font-weight: 600; }
.homework-stem { margin: 8px 0; font-size: 14px; line-height: 1.55; overflow-wrap: anywhere; }
.homework-options { gap: 4px; margin-bottom: 8px; }
.homework-options li { display: flex; align-items: baseline; gap: 7px; padding: 5px 8px; font-size: 13px; overflow-wrap: anywhere; }
.homework-options .is-selected { border-radius: 6px; background: color-mix(in srgb, var(--color-primary, #0a84ff) 13%, transparent); }
.homework-selected { margin-left: auto; white-space: nowrap; font-size: 12px; color: var(--text-secondary); }
.homework-answer, .homework-note { color: var(--text-secondary); font-size: 12px; line-height: 1.6; overflow-wrap: anywhere; }
.homework-answer span { margin-left: 4px; color: var(--text-primary); white-space: pre-wrap; }
.homework-note { margin: 0 0 8px; }
.homework-question .homework-note { margin: 3px 0 0; }
</style>
