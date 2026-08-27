<template>
  <div class="feature-panel">
    <div class="feature-kicker">我可以帮你</div>
    <div class="feature-grid">
      <div class="feature-study" :class="{ 'is-open': startStudyOpen }">
        <button class="feature-card" type="button" @click="toggleStartStudy">
          <span class="feature-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M6.5 2H20v15H6.5A2.5 2.5 0 0 0 4 19.5V4.5A2.5 2.5 0 0 1 6.5 2z" />
              <path d="M8 7h8" />
              <path d="M8 11h5" />
            </svg>
          </span>
          <span class="feature-copy">
            <span class="feature-title">开始学习</span>
            <span class="feature-desc">选择科目，挂到当前对话</span>
          </span>
        </button>
        <div v-if="startStudyOpen" class="feature-study-menu">
          <div class="feature-study-menu-title">选择科目</div>
          <button
            v-for="subject in startStudySubjects"
            :key="subject.id"
            type="button"
            class="feature-study-option"
            :class="{ 'is-active': subject.id === activeSubjectId }"
            @click="pickStartStudy(subject.id)"
          >
            <span class="feature-study-option-name">{{ subject.name }}</span>
            <span class="feature-study-option-meta">{{ subjectStudyProgress(subject) }}%</span>
          </button>
          <div v-if="!startStudySubjects.length" class="feature-study-empty">
            还没有科目，先去学习页新建
          </div>
        </div>
      </div>
      <button class="feature-card" type="button" @click="emit('import')">
        <span class="feature-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" />
            <path d="M14 3v6h6" />
            <path d="M12 18v-7" />
            <path d="M9 14l3 3 3-3" />
          </svg>
        </span>
        <span class="feature-copy">
          <span class="feature-title">导入文件</span>
          <span class="feature-desc">识别题目并写入题库</span>
        </span>
      </button>
      <button class="feature-card" type="button" @click="emit('organize')">
        <span class="feature-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
            <path d="M8 13h8" />
            <path d="M8 16h5" />
          </svg>
        </span>
        <span class="feature-copy">
          <span class="feature-title">整理文件夹</span>
          <span class="feature-desc">按内容归类、移动和重命名</span>
        </span>
      </button>
      <button class="feature-card" type="button" @click="emit('explain')">
        <span class="feature-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <path d="M4 19V5a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
            <path d="M14 3v5h5" />
            <path d="M8 13h8" />
            <path d="M8 17h5" />
          </svg>
        </span>
        <span class="feature-copy">
          <span class="feature-title">讲解题目</span>
          <span class="feature-desc">粘贴或描述一道题</span>
        </span>
      </button>
      <button class="feature-card" type="button" @click="emit('quiz')">
        <span class="feature-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9" />
            <path d="M9.5 9.5a2.5 2.5 0 1 1 3.6 2.25c-.7.4-1.1.9-1.1 1.75" />
            <path d="M12 17h.01" />
          </svg>
        </span>
        <span class="feature-copy">
          <span class="feature-title">出题练习</span>
          <span class="feature-desc">点选作答，并记下练习记录</span>
        </span>
      </button>
      <button class="feature-card" type="button" @click="emit('graph')">
        <span class="feature-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="6" cy="7" r="2.2" />
            <circle cx="18" cy="8" r="2.2" />
            <circle cx="8" cy="17" r="2.2" />
            <circle cx="16" cy="16" r="2.2" />
            <path d="M8 8.6 16.2 9.6M7.6 9.2 8.8 14.8M16.2 10.2 15.2 14M9.8 16.2h4" />
          </svg>
        </span>
        <span class="feature-copy">
          <span class="feature-title">知识图谱</span>
          <span class="feature-desc">为科目绘制独立知识点</span>
        </span>
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { setChatStudySubject } from '../../services/agent/chat'
import { databaseService, type StudySubject } from '../../services/app/database'

defineProps<{
  activeSubjectId?: number
}>()

const emit = defineEmits<{
  import: []
  organize: []
  explain: []
  quiz: []
  graph: []
}>()

const STUDY_STORAGE_KEY = 'zerror-study-subject'
const startStudyOpen = ref(false)
const startStudySubjects = ref<StudySubject[]>([])

const subjectStudyProgress = (subject: StudySubject) => Math.round((Number(subject.progress) || 0) * 100)

const closeStartStudy = () => {
  startStudyOpen.value = false
}

const loadStartStudySubjects = async () => {
  try {
    startStudySubjects.value = await databaseService.listStudySubjects()
  } catch {
    startStudySubjects.value = []
  }
}

const toggleStartStudy = async () => {
  startStudyOpen.value = !startStudyOpen.value
  if (startStudyOpen.value) await loadStartStudySubjects()
}

const pickStartStudy = (id: number) => {
  setChatStudySubject(id)
  localStorage.setItem(STUDY_STORAGE_KEY, String(id))
  closeStartStudy()
}

const onStartStudyPointerDown = (event: PointerEvent) => {
  const target = event.target as HTMLElement | null
  if (target?.closest('.feature-study')) return
  closeStartStudy()
}

onMounted(() => {
  document.addEventListener('pointerdown', onStartStudyPointerDown)
})

onUnmounted(() => {
  document.removeEventListener('pointerdown', onStartStudyPointerDown)
})
</script>

<style scoped>
.feature-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 14px;
  min-height: calc(100% - 108px);
  box-sizing: border-box;
}

.feature-kicker {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary, #718096);
}

.feature-study {
  position: relative;
  min-width: 0;
}

.feature-study > .feature-card {
  width: 100%;
}

.feature-study-menu {
  position: absolute;
  top: calc(100% + 10px);
  left: 0;
  z-index: 20;
  width: 228px;
  max-height: 280px;
  overflow: auto;
  padding: 6px;
  border-radius: 12px;
  border: 1px solid color-mix(in srgb, var(--border-color, #e2e8f0) 80%, transparent);
  background: color-mix(in srgb, var(--bg-secondary, #fff) 92%, transparent);
  box-shadow: 0 12px 32px color-mix(in srgb, #000 12%, transparent);
  backdrop-filter: blur(20px) saturate(140%);
  -webkit-backdrop-filter: blur(20px) saturate(140%);
}

.feature-study-menu-title {
  padding: 6px 8px 4px;
  font-size: 11px;
  color: var(--text-secondary, #718096);
}

.feature-study-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  min-height: 32px;
  padding: 0 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--text-primary, #2d3748);
  font-size: 12px;
  cursor: pointer;
}

.feature-study-option:hover {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
}

.feature-study-option:active {
  transform: scale(0.98);
}

.feature-study-option.is-active {
  background: color-mix(in srgb, var(--color-primary, #667eea) 10%, transparent);
}

.feature-study-option-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.feature-study-option-meta {
  flex-shrink: 0;
  margin-left: 8px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #718096);
}

.feature-study-empty {
  padding: 8px;
  font-size: 12px;
  color: var(--text-secondary, #718096);
}

.feature-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.feature-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 14px 14px 13px;
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
  width: 28px;
  height: 28px;
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
  gap: 3px;
}

.feature-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #2d3748);
}

.feature-desc {
  font-size: 12px;
  line-height: 1.4;
  color: var(--text-secondary, #718096);
}

[data-theme="dark"] .feature-study-menu {
  box-shadow: 0 12px 32px color-mix(in srgb, #000 42%, transparent);
}
</style>
