<template>
  <div class="study-qbank-page">
    <input
      :value="query"
      class="study-qbank-search"
      type="search"
      :placeholder="nodeId ? '搜索题库并关联到当前知识点' : '搜索题库'"
      @input="$emit('update:query', ($event.target as HTMLInputElement).value)"
    />
    <div v-if="query && !nodeId" class="study-qbank-hint">先在图谱里点一个知识点，再关联题目</div>
    <div v-if="!rows.length" class="study-qbank-empty">{{ emptyText }}</div>
    <div v-else class="study-qbank-list">
      <div v-for="item in rows" :key="item.id" class="study-qbank-item">
        <div class="study-qbank-marks" :title="markTitle(item.id)" aria-hidden="true">
          <i
            v-for="(mark, index) in marksOf(item.id)"
            :key="`${item.id}-${index}`"
            class="study-qbank-mark"
            :class="`is-${mark}`"
          />
        </div>
        <button type="button" class="study-qbank-copy" :title="previewOf(item.question)" @click="$emit('open-detail', item)">{{ previewOf(item.question) }}</button>
        <button
          v-if="query.trim() && nodeId && !item.linked"
          type="button"
          class="study-qbank-link"
          @click="$emit('link', item.id)"
        >关联</button>
        <button
          v-else-if="directIds.has(item.id) && nodeId"
          type="button"
          class="study-qbank-unlink"
          title="取消关联"
          @click="$emit('unlink', item.id)"
        >×</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { AIResponse } from '../../services/app/database'
import { splitQuestionImageParts } from '../../utils/question/questionImage'

export type PracticeMark = 'ok' | 'bad' | 'empty'

export type StudyQuestionRow = AIResponse & { linked: boolean }

const props = defineProps<{
  query: string
  nodeId: number
  emptyText: string
  rows: StudyQuestionRow[]
  directIds: Set<number>
  practiceMarks: Record<number, PracticeMark[]>
}>()

defineEmits<{
  'update:query': [value: string]
  'open-detail': [item: StudyQuestionRow]
  link: [id: number]
  unlink: [id: number]
}>()

const emptyMarks = (): PracticeMark[] => ['empty', 'empty', 'empty', 'empty', 'empty']

const marksOf = (id: number) => props.practiceMarks[id] || emptyMarks()

const markTitle = (id: number) => {
  const marks = marksOf(id).filter((item) => item !== 'empty')
  if (!marks.length) return '还没有作答记录'
  const ok = marks.filter((item) => item === 'ok').length
  return `最近 ${marks.length} 次：对 ${ok}，错 ${marks.length - ok}`
}

const previewOf = (text: string) => {
  const plain = splitQuestionImageParts(text)
    .filter((part) => part.type === 'text')
    .map((part) => part.text || '')
    .join(' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (plain) return plain
  if (splitQuestionImageParts(text).some((part) => part.type === 'image')) return '图片题'
  return '未命名题目'
}
</script>

<style scoped>
.study-qbank-page {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.study-qbank-search {
  flex-shrink: 0;
  margin: 0 10px 8px;
  padding: 6px 8px;
  border: none;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
  color: inherit;
  font-size: 12px;
}

.study-qbank-hint,
.study-qbank-empty {
  padding: 8px 14px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-secondary, #94a3b8);
}

.study-qbank-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 0 8px 10px;
}

.study-qbank-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  padding: 1px 2px;
  border-radius: 8px;
}

.study-qbank-item:hover {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 5%, transparent);
}

.study-qbank-marks {
  flex-shrink: 0;
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 16px;
  margin-top: 7px;
}

.study-qbank-mark {
  display: block;
  width: 3px;
  height: 12px;
  border-radius: 1px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 12%, transparent);
}

.study-qbank-mark.is-ok {
  background: #3d9a6a;
}

.study-qbank-mark.is-bad {
  background: #d15a5a;
}

.study-qbank-copy {
  flex: 1;
  min-width: 0;
  padding: 6px 6px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary, #2d3748);
  font-size: 12px;
  line-height: 1.45;
  text-align: left;
  cursor: pointer;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.study-qbank-copy:active {
  transform: scale(0.99);
}

.study-qbank-link,
.study-qbank-unlink {
  flex-shrink: 0;
  margin-top: 4px;
  padding: 2px 6px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #2F6F78;
  font-size: 11px;
  cursor: pointer;
}

[data-theme="dark"] .study-qbank-link {
  color: #7ab8c0;
}

.study-qbank-unlink {
  color: var(--text-secondary, #94a3b8);
}
</style>
