<template>
  <div class="study-qbank-page">
    <div class="study-qbank-detail">
      <div class="study-qbank-card">
        <div class="study-qbank-card-top">
          <span
            v-if="selected.question_type"
            class="study-qbank-type"
            :class="`is-${typeKind(selected.question_type)}`"
          >{{ selected.question_type }}</span>
          <span v-if="selected.folder_name" class="study-qbank-folder">{{ selected.folder_name }}</span>
        </div>
        <div class="study-qbank-stem">
          <template v-for="(part, i) in contentParts" :key="'q-' + i">
            <span v-if="part.type === 'text'">{{ part.text }}</span>
            <img
              v-else-if="imgSrc(part.url as string)"
              :src="imgSrc(part.url as string)"
              :class="['study-qbank-image', invertClass(part.url as string)]"
            />
          </template>
        </div>
        <div v-if="optionRows.length" class="study-qbank-options">
          <div
            v-for="option in optionRows"
            :key="option.id"
            class="study-qbank-option"
            :class="{ 'is-ok': option.correct }"
          >
            <span
              v-if="option.key"
              class="study-qbank-opt-key"
              :class="{ 'is-ok': option.correct }"
            >{{ option.key }}</span>
            <div class="study-qbank-opt-text">
              <template v-for="(part, i) in option.parts" :key="`${option.id}-${i}`">
                <span v-if="part.type === 'text'">{{ part.text }}</span>
                <img
                  v-else-if="imgSrc(part.url as string)"
                  :src="imgSrc(part.url as string)"
                  :class="['study-qbank-image', invertClass(part.url as string)]"
                />
              </template>
            </div>
          </div>
        </div>
        <div v-else-if="selected.options" class="study-qbank-stem">
          <template v-for="(part, i) in optionsParts" :key="'o-' + i">
            <span v-if="part.type === 'text'">{{ part.text }}</span>
            <img
              v-else-if="imgSrc(part.url as string)"
              :src="imgSrc(part.url as string)"
              :class="['study-qbank-image', invertClass(part.url as string)]"
            />
          </template>
        </div>
        <div v-if="selected.answer" class="study-qbank-answer">
          <span class="study-qbank-answer-label">答案</span>
          <div class="study-qbank-answer-text">
            <template v-if="answerHasMedia">
              <template v-for="(part, i) in answerParts" :key="'a-' + i">
                <span v-if="part.type === 'text'">{{ part.text }}</span>
                <img
                  v-else-if="imgSrc(part.url as string)"
                  :src="imgSrc(part.url as string)"
                  :class="['study-qbank-image', invertClass(part.url as string)]"
                />
              </template>
            </template>
            <span v-else>{{ answerText }}</span>
          </div>
        </div>
      </div>
      <div v-if="knowledgeLinks.length" class="study-qbank-chips">
        <button
          v-for="link in knowledgeLinks"
          :key="link.node_id"
          type="button"
          class="study-qbank-chip"
          :title="`${link.subject_name} · ${link.node_name}`"
          @click="$emit('open-knowledge', link)"
        >{{ link.node_name }}</button>
      </div>
      <div class="study-qbank-block">
        <div class="study-qbank-label">作答时间线</div>
        <div v-if="!practiceGroups.length" class="study-qbank-empty-inline">还没有作答记录</div>
        <div v-else class="study-qbank-timeline">
          <div v-for="group in practiceGroups" :key="group.key" class="study-qbank-day">
            <div class="study-qbank-day-label">{{ group.label }}</div>
            <div
              v-for="item in group.items"
              :key="item.id"
              class="study-qbank-attempt"
              :class="`is-${item.kind}`"
            >
              <span class="study-qbank-dot" aria-hidden="true" />
              <span class="study-qbank-time">{{ item.time }}</span>
              <div class="study-qbank-attempt-copy">
                <span class="study-qbank-flag" :class="`is-${item.kind}`">{{ item.flag }}</span>
                <span v-if="item.answer">{{ item.answer }}</span>
                <div v-if="item.note" class="study-qbank-note">{{ item.note }}</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AIResponse, QuestionKnowledgeLink } from '../../services/app/database'
import type { QuestionImagePart } from '../../utils/question/questionImage'

export type StudyQuestionOptionRow = {
  id: string
  key: string
  parts: QuestionImagePart[]
  correct: boolean
}

export type StudyPracticeGroup = {
  key: string
  label: string
  items: Array<{
    id: number
    kind: 'ok' | 'bad' | 'note'
    flag: string
    answer: string
    note: string
    time: string
  }>
}

const props = defineProps<{
  selected: AIResponse
  contentParts: QuestionImagePart[]
  optionRows: StudyQuestionOptionRow[]
  optionsParts: QuestionImagePart[]
  answerHasMedia: boolean
  answerParts: QuestionImagePart[]
  answerText: string
  knowledgeLinks: QuestionKnowledgeLink[]
  practiceGroups: StudyPracticeGroup[]
  imageSrcMap: Record<string, string>
  blackOnlyMap: Record<string, boolean>
}>()

defineEmits<{
  'open-knowledge': [link: QuestionKnowledgeLink]
}>()

const typeKind = (type?: string) => {
  const text = String(type || '').replace(/\s/g, '')
  if (/多选|多项|不定项/.test(text)) return 'multiple'
  if (/判断/.test(text)) return 'judgement'
  if (/填空|简答|解答/.test(text)) return 'fill'
  if (/单选|单项/.test(text)) return 'single'
  return 'other'
}

const imgSrc = (url: string) => props.imageSrcMap[url]
const invertClass = (url: string) => (props.blackOnlyMap[url] ? 'invert-on-dark' : '')
</script>

<style scoped>
.study-qbank-page {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.study-qbank-detail {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 4px 12px 14px;
}

.study-qbank-card {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.study-qbank-card-top {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
}

.study-qbank-type {
  padding: 2px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.2;
  background: var(--ql-type-tag-bg, #eef2f7);
  color: var(--ql-type-tag-text, #64748b);
}

.study-qbank-type.is-single {
  background: var(--ql-type-tag-single-bg, #edf4ff);
  color: var(--ql-type-tag-single-text, #2563eb);
}

.study-qbank-type.is-multiple {
  background: var(--ql-type-tag-multiple-bg, #f3e8ff);
  color: var(--ql-type-tag-multiple-text, #7c3aed);
}

.study-qbank-type.is-judgement {
  background: var(--ql-type-tag-judgement-bg, #fff7ed);
  color: var(--ql-type-tag-judgement-text, #c2410c);
}

.study-qbank-type.is-fill {
  background: var(--ql-type-tag-fill-bg, #ecfdf5);
  color: var(--ql-type-tag-fill-text, #047857);
}

.study-qbank-folder {
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
}

.study-qbank-stem {
  font-size: 13px;
  line-height: 1.55;
  color: var(--text-primary, #2d3748);
  white-space: pre-wrap;
  word-break: break-word;
}

.study-qbank-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.study-qbank-option {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 8px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 5%, transparent);
}

.study-qbank-option.is-ok {
  background: color-mix(in srgb, #3d9a6a 12%, transparent);
}

.study-qbank-opt-key {
  flex: 0 0 18px;
  width: 18px;
  height: 18px;
  border-radius: 5px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  line-height: 1;
  color: var(--ql-type-tag-single-text, #2563eb);
  background: var(--ql-type-tag-single-bg, #edf4ff);
}

.study-qbank-opt-key.is-ok {
  color: color-mix(in srgb, #3d9a6a 70%, var(--text-primary, #1d1d1f));
  background: color-mix(in srgb, #3d9a6a 18%, transparent);
}

.study-qbank-opt-text {
  min-width: 0;
  display: flex;
  align-items: center;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-primary, #2d3748);
  word-break: break-word;
}

.study-qbank-answer {
  display: flex;
  align-items: center;
  gap: 6px;
}

.study-qbank-answer-label {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.5;
  color: var(--color-success, #15803d);
  background: color-mix(in srgb, var(--color-success, #16a34a) 16%, transparent);
}

.study-qbank-answer-text {
  min-width: 0;
  display: flex;
  align-items: center;
  font-size: 12px;
  line-height: 1.5;
  color: color-mix(in srgb, var(--color-success, #166534) 72%, var(--text-primary, #2d3748));
  word-break: break-word;
}

.study-qbank-block + .study-qbank-block {
  margin-top: 12px;
}

.study-qbank-label {
  margin-bottom: 4px;
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
}

.study-qbank-image {
  display: block;
  max-width: 100%;
  max-height: 160px;
  margin: 6px 0;
  border-radius: 6px;
  object-fit: contain;
}

:root[data-theme="dark"] .study-qbank-image.invert-on-dark {
  filter: invert(1);
}

.study-qbank-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.study-qbank-chip {
  padding: 2px 7px;
  border: none;
  border-radius: 6px;
  background: color-mix(in srgb, #2F6F78 10%, transparent);
  color: color-mix(in srgb, #2F6F78 72%, var(--text-primary, #1d1d1f));
  font-size: 11px;
  cursor: pointer;
}

.study-qbank-card + .study-qbank-block,
.study-qbank-chips + .study-qbank-block {
  margin-top: 14px;
}

.study-qbank-empty-inline {
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary, #94a3b8);
}

.study-qbank-timeline {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.study-qbank-day-label {
  padding: 0 0 2px;
  font-size: 11px;
  color: var(--text-secondary, #94a3b8);
}

.study-qbank-attempt {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 4px 0 4px 2px;
}

.study-qbank-attempt + .study-qbank-attempt::before {
  content: '';
  position: absolute;
  left: 4px;
  top: -4px;
  width: 1px;
  height: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 10%, transparent);
}

.study-qbank-dot {
  flex: 0 0 7px;
  width: 7px;
  height: 7px;
  margin-top: 5px;
  border-radius: 50%;
  background: #94a3b8;
}

.study-qbank-attempt.is-ok .study-qbank-dot {
  background: #3d9a6a;
}

.study-qbank-attempt.is-bad .study-qbank-dot {
  background: #d15a5a;
}

.study-qbank-time {
  flex: 0 0 36px;
  margin-top: 1px;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #94a3b8);
}

.study-qbank-attempt-copy {
  min-width: 0;
  font-size: 12px;
  line-height: 1.45;
  color: var(--text-primary, #2d3748);
}

.study-qbank-flag {
  display: inline-block;
  margin-right: 4px;
  padding: 0 5px;
  border-radius: 4px;
  font-weight: 600;
  line-height: 1.5;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 8%, transparent);
  color: var(--text-secondary, #64748b);
}

.study-qbank-flag.is-ok {
  background: color-mix(in srgb, #3d9a6a 16%, transparent);
  color: color-mix(in srgb, #3d9a6a 70%, var(--text-primary, #1d1d1f));
}

.study-qbank-flag.is-bad {
  background: color-mix(in srgb, #d15a5a 16%, transparent);
  color: color-mix(in srgb, #d15a5a 70%, var(--text-primary, #1d1d1f));
}

.study-qbank-note {
  margin-top: 2px;
  font-size: 11px;
  line-height: 1.45;
  color: var(--text-secondary, #94a3b8);
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
