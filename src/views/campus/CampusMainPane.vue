<template>
  <section class="campus-col campus-main">
    <div class="pane-header">
      <div class="header-title">{{ mainTitle }}</div>
      <div v-if="identity?.campus && !showBrowse" class="header-meta">{{ identity.campus.name }}</div>
    </div>

    <div class="main-body">
      <div v-if="!isLoggedIn" class="empty-state">
        <div class="empty-title">先登录校园账号</div>
        <p class="empty-text">校园题库和网页题库共用同一个微信登录。关注公众号「未耕之地」，发送验证码即可。</p>
        <button class="primary-btn" type="button" @click="$emit('open-login')">登录</button>
      </div>

      <div v-else-if="pageLoading" class="empty-state">正在同步账号…</div>

      <div v-else-if="error" class="empty-state">
        <div class="empty-title">加载失败</div>
        <p class="empty-text">{{ error }}</p>
        <button class="primary-btn" type="button" @click="$emit('reload')">重试</button>
      </div>

      <div v-else-if="!identity?.campus" class="empty-state">
        <div class="empty-title">选择你的学校</div>
        <p class="empty-text">每人只能绑定一所学校。绑定后即可查看本校课程和题目。</p>
      </div>

      <div v-else-if="!identity.enrollment_year" class="empty-state">
        <div class="empty-title">补上入学年份</div>
        <p class="empty-text">新建试卷时会带上这个年份。</p>
        <div class="year-row">
          <select :value="draftYear" class="year-select" @change="$emit('update:draftYear', Number(($event.target as HTMLSelectElement).value))">
            <option v-for="year in yearOptions" :key="year" :value="year">{{ year }} 级</option>
          </select>
          <button class="primary-btn" type="button" :disabled="savingYear" @click="$emit('save-year')">
            {{ savingYear ? '保存中…' : '保存' }}
          </button>
        </div>
      </div>

      <div v-else-if="!selectedCourseId" class="empty-state">
        <div class="empty-title">从左侧选一门课</div>
        <p class="empty-text">选课后会列出试卷，右侧按题切换查看。</p>
      </div>

      <div v-else-if="papersLoading && !visiblePaperCount" class="empty-state">
        <div class="empty-title">正在打开课程…</div>
      </div>

      <div v-else-if="!selectedPaperId" class="empty-state">
        <div class="empty-title">这门课还没有试卷</div>
        <p class="empty-text">有试卷后即可按题查看。</p>
      </div>

      <div v-else-if="questionsLoading && !activeQuestions.length" class="empty-state">
        <div class="empty-title">正在打开试卷…</div>
      </div>

      <CampusQuestionPane
        v-else
        :question="selectedQuestion"
        :index="currentIndex"
        :total="activeQuestions.length"
        @prev="$emit('prev')"
        @next="$emit('next')"
        @goto="$emit('goto', $event)"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
import CampusQuestionPane from '../../components/campus/CampusQuestionPane.vue'
import type { CampusIdentity, CampusQuestion } from '../../services/app/campus'

defineProps<{
  mainTitle: string
  identity: CampusIdentity | null
  showBrowse: boolean
  isLoggedIn: boolean
  pageLoading: boolean
  error: string
  draftYear: number
  yearOptions: number[]
  savingYear: boolean
  selectedCourseId: number | null
  papersLoading: boolean
  visiblePaperCount: number
  selectedPaperId: number | null
  questionsLoading: boolean
  activeQuestions: CampusQuestion[]
  selectedQuestion: CampusQuestion | null
  currentIndex: number
}>()

defineEmits<{
  'open-login': []
  reload: []
  'update:draftYear': [year: number]
  'save-year': []
  prev: []
  next: []
  goto: [index: number]
}>()
</script>

<style scoped>
.campus-col {
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-secondary, #fff);
  border-radius: 4px;
  margin-bottom: 5px;
}

.campus-main {
  flex: 1;
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
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.header-meta {
  font-size: 12px;
  color: var(--text-secondary, #718096);
  font-variant-numeric: tabular-nums;
}

.main-body {
  flex: 1;
  min-height: 0;
  overflow: hidden;
  display: flex;
}

.empty-state {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  padding: 0 48px;
  max-width: 520px;
}

.empty-title {
  font-size: 20px;
  font-weight: 650;
}

.empty-text {
  margin: 8px 0 16px;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-secondary, #718096);
}

.primary-btn {
  border: none;
  border-radius: 999px;
  padding: 7px 14px;
  background: #F8B62B;
  color: #fff;
  font-size: 13px;
  cursor: pointer;
}

.primary-btn:hover:not(:disabled) {
  opacity: 0.88;
}

.primary-btn:active:not(:disabled) {
  transform: scale(0.97);
}

.primary-btn:disabled {
  opacity: 0.5;
  cursor: default;
}

.year-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.year-select {
  box-sizing: border-box;
  width: 140px;
  margin: 0;
  padding: 7px 10px;
  border: none;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
  color: inherit;
  font-size: 12px;
}
</style>
