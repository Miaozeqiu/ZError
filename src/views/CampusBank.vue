<template>
  <div class="campus-page">
    <aside class="campus-col campus-sidebar">
      <div class="pane-header">
        <div class="header-title">{{ sidebarTitle }}</div>
        <button
          v-if="isLoggedIn && identity?.campus"
          class="header-action"
          type="button"
          @click="reload"
        >刷新</button>
      </div>

      <div v-if="!isLoggedIn" class="list-empty">登录后查看本校课程</div>

      <template v-else-if="!identity?.campus">
        <input
          v-model="schoolQuery"
          class="search-input"
          placeholder="搜索学校"
        />
        <div class="item-list">
          <button
            v-for="school in filteredSchools"
            :key="school.id"
            class="list-item"
            type="button"
            :disabled="bindingId != null"
            @click="chooseSchool(school)"
          >
            <div class="item-name">{{ school.name }}</div>
          </button>
          <div v-if="!schoolsLoading && !filteredSchools.length" class="list-empty">没有匹配的学校</div>
          <div v-if="schoolsLoading" class="list-empty">加载学校中…</div>
        </div>
      </template>

      <template v-else>
        <div class="item-list">
          <button
            v-for="course in courses"
            :key="course.id"
            class="list-item"
            type="button"
            :class="{ 'is-selected': course.id === selectedCourseId }"
            @click="selectCourse(course.id)"
          >
            <div class="item-name">{{ course.name }}</div>
            <div v-if="course.status === 'pending'" class="item-meta">待审核</div>
          </button>
          <div v-if="!coursesLoading && !courses.length" class="list-empty">还没有课程</div>
          <div v-if="coursesLoading" class="list-empty">加载课程中…</div>
        </div>
      </template>
    </aside>

    <aside v-if="showPaperCol" class="campus-col campus-papers">
      <div class="pane-header">
        <div class="header-title">试卷</div>
        <div v-if="visiblePaperCount" class="header-meta">{{ visiblePaperCount }}</div>
        <div v-if="platformOptions.length" class="platform-filter" @mousedown.stop>
          <button
            class="platform-select-trigger"
            type="button"
            :class="{ open: platformFilterOpen }"
            title="筛选平台"
            aria-haspopup="listbox"
            :aria-expanded="platformFilterOpen"
            @click="platformFilterOpen = !platformFilterOpen"
          >
            <CampusPlatformIcon v-if="platformFilter" :name="platformFilter" />
            <span class="platform-select-label">{{ platformFilter || '全部' }}</span>
            <svg class="platform-select-arrow" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path d="M4.2 6.2a.75.75 0 0 1 1.06 0L8 8.94l2.74-2.74a.75.75 0 1 1 1.06 1.06l-3.27 3.27a.75.75 0 0 1-1.06 0L4.2 7.26a.75.75 0 0 1 0-1.06z" fill="currentColor"/>
            </svg>
          </button>
          <Transition name="dropdown-pop">
            <div v-if="platformFilterOpen" class="platform-filter-menu" role="listbox" aria-label="筛选平台">
              <button
                class="platform-filter-item"
                type="button"
                :class="{ active: !platformFilter }"
                role="option"
                :aria-selected="!platformFilter"
                @click="setPlatformFilter('')"
              >全部</button>
              <button
                v-for="name in platformOptions"
                :key="name"
                class="platform-filter-item"
                type="button"
                :class="{ active: platformFilter === name }"
                role="option"
                :aria-selected="platformFilter === name"
                @click="setPlatformFilter(name)"
              >
                <CampusPlatformIcon :name="name" />
                <span>{{ name }}</span>
              </button>
            </div>
          </Transition>
        </div>
      </div>
      <div v-if="papersLoading && !visiblePapers.length" class="list-empty">加载试卷中…</div>
      <div v-else-if="!visiblePapers.length" class="list-empty">{{ platformFilter ? '这个平台没有试卷' : '这门课还没有试卷' }}</div>
      <div v-else class="item-list">
        <button
          v-for="paper in visiblePapers"
          :key="paper.id"
          class="list-item paper-item"
          type="button"
          :class="{ 'is-selected': selectedPaperId === paper.id }"
          @click="selectPaper(paper.id)"
        >
          <CampusPlatformIcon :name="paper.platform" />
          <div class="item-name">{{ paper.name }}</div>
          <div v-if="paper.question_count != null" class="item-count">{{ paper.question_count }}</div>
        </button>
      </div>
    </aside>

    <section class="campus-col campus-main">
      <div class="pane-header">
        <div class="header-title">{{ mainTitle }}</div>
        <div v-if="identity?.campus && !showBrowse" class="header-meta">{{ identity.campus.name }}</div>
      </div>

      <div class="main-body">
        <div v-if="!isLoggedIn" class="empty-state">
          <div class="empty-title">先登录校园账号</div>
          <p class="empty-text">校园题库和网页题库共用同一个微信登录。关注公众号「未耕之地」，发送验证码即可。</p>
          <button class="primary-btn" type="button" @click="openLoginDialog">登录</button>
        </div>

        <div v-else-if="pageLoading" class="empty-state">正在同步账号…</div>

        <div v-else-if="error" class="empty-state">
          <div class="empty-title">加载失败</div>
          <p class="empty-text">{{ error }}</p>
          <button class="primary-btn" type="button" @click="reload">重试</button>
        </div>

        <div v-else-if="!identity?.campus" class="empty-state">
          <div class="empty-title">选择你的学校</div>
          <p class="empty-text">每人只能绑定一所学校。绑定后即可查看本校课程和题目。</p>
        </div>

        <div v-else-if="!identity.enrollment_year" class="empty-state">
          <div class="empty-title">补上入学年份</div>
          <p class="empty-text">新建试卷时会带上这个年份。</p>
          <div class="year-row">
            <select v-model.number="draftYear" class="year-select">
              <option v-for="year in yearOptions" :key="year" :value="year">{{ year }} 级</option>
            </select>
            <button class="primary-btn" type="button" :disabled="savingYear" @click="saveYear">
              {{ savingYear ? '保存中…' : '保存' }}
            </button>
          </div>
        </div>

        <div v-else-if="!selectedCourseId" class="empty-state">
          <div class="empty-title">从左侧选一门课</div>
          <p class="empty-text">选课后会列出试卷，右侧按题切换查看。</p>
        </div>

        <div v-else-if="papersLoading && !visiblePapers.length" class="empty-state">
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
          @prev="goPrev"
          @next="goNext"
          @goto="showQuestion"
        />
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import CampusQuestionPane from '../components/CampusQuestionPane.vue'
import CampusPlatformIcon from '../components/campus/CampusPlatformIcon.vue'
import { useExclusiveMenu } from '../composables/useExclusiveMenu'
import { isLoggedIn, openLoginDialog } from '../services/auth'
import {
  bindCampus,
  enrollmentYearOptions,
  getCampusCourse,
  getUserCampus,
  listCampusCourses,
  listCampusSchools,
  listCampusTags,
  listFolderQuestions,
  setEnrollmentYear,
  withFolderQuestionCounts,
  type CampusCourse,
  type CampusFolder,
  type CampusIdentity,
  type CampusQuestion,
  type CampusSchool,
  type CampusTag,
} from '../services/campus'
import { RemoteApiError } from '../services/remoteHttp'

interface PaperItem {
  id: number
  name: string
  platform?: string | null
  question_count?: number
}

const identity = ref<CampusIdentity | null>(null)
const schools = ref<CampusSchool[]>([])
const courses = ref<CampusCourse[]>([])
const folders = ref<CampusFolder[]>([])
const tags = ref<CampusTag[]>([])
const questions = ref<CampusQuestion[]>([])
const selectedCourseId = ref<number | null>(null)
const selectedPaperId = ref<number | null>(null)
const selectedQuestion = ref<CampusQuestion | null>(null)
const schoolQuery = ref('')
const draftYear = ref(new Date().getFullYear())
const pageLoading = ref(false)
const schoolsLoading = ref(false)
const coursesLoading = ref(false)
const papersLoading = ref(false)
const questionsLoading = ref(false)
const papersByCourse = new Map<number, CampusFolder[]>()
const questionsByPaper = new Map<number, CampusQuestion[]>()
const lastPaperByCourse = new Map<number, number>()
const savingYear = ref(false)
const bindingId = ref<number | null>(null)
const error = ref('')
const platformFilter = ref('')
const platformFilterOpen = ref(false)
useExclusiveMenu('campus-platform-filter', platformFilterOpen)

const yearOptions = enrollmentYearOptions()

const showBrowse = computed(() => Boolean(
  isLoggedIn.value && identity.value?.campus && identity.value.enrollment_year,
))

const showPaperCol = computed(() => showBrowse.value && Boolean(selectedCourseId.value))

const tagNameById = computed(() => {
  const map = new Map<number, string>()
  for (const tag of tags.value) map.set(tag.id, tag.name)
  return map
})

const folderPlatform = (folder: CampusFolder) => {
  if (folder.tag_name) return folder.tag_name
  if (folder.tag_id) return tagNameById.value.get(folder.tag_id) || ''
  return ''
}

const papers = computed<PaperItem[]>(() => {
  const items: PaperItem[] = folders.value.map((folder) => {
    const platform = folderPlatform(folder)
    return {
      id: folder.id,
      name: folder.name,
      platform,
      question_count: folder.question_count,
    }
  })
  return items
})

const platformOptions = computed(() => {
  const names: string[] = []
  for (const paper of papers.value) {
    if (paper.platform && !names.includes(paper.platform)) names.push(paper.platform)
  }
  return names
})

const visiblePapers = computed(() => {
  if (!platformFilter.value) return papers.value
  return papers.value.filter((paper) => paper.platform === platformFilter.value)
})

const visiblePaperCount = computed(() => visiblePapers.value.length)

const activeQuestions = computed(() => questions.value)

const currentIndex = computed(() => {
  const id = selectedQuestion.value?.id
  if (id == null) return 0
  const index = activeQuestions.value.findIndex((item) => item.id === id)
  return index >= 0 ? index : 0
})

const sidebarTitle = computed(() => {
  if (!isLoggedIn.value) return '校园题库'
  if (!identity.value?.campus) return '选择学校'
  return '课程'
})

const selectedPaper = computed(() => papers.value.find((item) => item.id === selectedPaperId.value) || null)

const mainTitle = computed(() => {
  if (selectedPaper.value) return selectedPaper.value.name
  const course = courses.value.find((item) => item.id === selectedCourseId.value)
  return course?.name || '题目'
})

const filteredSchools = computed(() => {
  const q = schoolQuery.value.trim().toLowerCase()
  if (!q) return schools.value
  return schools.value.filter((item) => item.name.toLowerCase().includes(q))
})

const handleAuthError = (err: unknown) => {
  if (err instanceof RemoteApiError && (err.status === 401 || err.status === 403)) {
    error.value = '登录已失效，请重新登录'
    return true
  }
  return false
}

const loadSchools = async () => {
  schoolsLoading.value = true
  try {
    schools.value = await listCampusSchools()
  } finally {
    schoolsLoading.value = false
  }
}

const loadTags = async () => {
  try {
    tags.value = await listCampusTags()
  } catch {
    tags.value = []
  }
}

const loadCourses = async () => {
  const campusId = identity.value?.campus?.id
  if (!campusId) return
  coursesLoading.value = true
  try {
    courses.value = await listCampusCourses(campusId)
  } finally {
    coursesLoading.value = false
  }
}

const showQuestion = (index: number) => {
  const list = activeQuestions.value
  if (!list.length) {
    selectedQuestion.value = null
    return
  }
  const next = Math.max(0, Math.min(list.length - 1, index))
  selectedQuestion.value = list[next] || null
}

const goPrev = () => showQuestion(currentIndex.value - 1)
const goNext = () => showQuestion(currentIndex.value + 1)

const setPlatformFilter = (name: string) => {
  platformFilter.value = name
  platformFilterOpen.value = false
}

const rememberFolders = (courseId: number, next: CampusFolder[]) => {
  papersByCourse.set(courseId, next)
  if (selectedCourseId.value === courseId) folders.value = next
}

const pickPaperId = (courseId: number, list = folders.value) => {
  const last = lastPaperByCourse.get(courseId)
  if (last && list.some((item) => item.id === last)) return last
  return list[0]?.id || null
}

watch(visiblePapers, (list) => {
  if (!list.length) return
  if (list.some((paper) => paper.id === selectedPaperId.value)) return
  void selectPaper(list[0].id)
})

const selectPaper = async (paperId: number) => {
  if (!selectedCourseId.value) return
  const courseId = selectedCourseId.value
  selectedPaperId.value = paperId
  lastPaperByCourse.set(courseId, paperId)
  const cached = questionsByPaper.get(paperId)
  if (cached?.length) {
    questions.value = cached
    showQuestion(0)
    questionsLoading.value = false
  } else {
    questions.value = []
    selectedQuestion.value = null
    questionsLoading.value = true
  }
  try {
    const next = await listFolderQuestions(paperId)
    questionsByPaper.set(paperId, next)
    if (selectedPaperId.value !== paperId) return
    questions.value = next
    folders.value = folders.value.map((folder) => (
      folder.id === paperId ? { ...folder, question_count: next.length } : folder
    ))
    if (selectedCourseId.value) papersByCourse.set(selectedCourseId.value, folders.value)
    showQuestion(cached?.length ? currentIndex.value : 0)
  } catch (err) {
    if (selectedPaperId.value !== paperId) return
    if (!handleAuthError(err)) error.value = err instanceof Error ? err.message : '加载题目失败'
    if (!cached?.length) {
      questions.value = []
      selectedQuestion.value = null
    }
  } finally {
    if (selectedPaperId.value === paperId) questionsLoading.value = false
  }
}

const selectCourse = async (courseId: number) => {
  selectedCourseId.value = courseId
  const cached = papersByCourse.get(courseId)
  if (cached) {
    folders.value = cached
    const paperId = pickPaperId(courseId, cached)
    if (paperId) void selectPaper(paperId)
    else {
      selectedPaperId.value = null
      questions.value = []
      selectedQuestion.value = null
    }
    papersLoading.value = false
  } else {
    folders.value = []
    selectedPaperId.value = null
    questions.value = []
    selectedQuestion.value = null
    papersLoading.value = true
  }
  try {
    const detail = await getCampusCourse(courseId)
    if (selectedCourseId.value !== courseId) return
    const raw = detail.folders.filter((item) => !item.archived)
    rememberFolders(courseId, raw)
    const paperId = pickPaperId(courseId, raw)
    if (paperId && selectedPaperId.value !== paperId) void selectPaper(paperId)
    else if (!paperId) {
      selectedPaperId.value = null
      questions.value = []
      selectedQuestion.value = null
    }
    void withFolderQuestionCounts(raw).then((counted) => {
      if (selectedCourseId.value !== courseId) {
        papersByCourse.set(courseId, counted)
        return
      }
      rememberFolders(courseId, counted)
    })
  } catch (err) {
    if (selectedCourseId.value !== courseId) return
    if (!handleAuthError(err)) error.value = err instanceof Error ? err.message : '加载课程失败'
  } finally {
    if (selectedCourseId.value === courseId) papersLoading.value = false
  }
}

const chooseSchool = async (school: CampusSchool) => {
  bindingId.value = school.id
  error.value = ''
  try {
    await bindCampus(school.id)
    await reload()
  } catch (err) {
    if (!handleAuthError(err)) error.value = err instanceof Error ? err.message : '绑定学校失败'
  } finally {
    bindingId.value = null
  }
}

const saveYear = async () => {
  savingYear.value = true
  error.value = ''
  try {
    await setEnrollmentYear(draftYear.value)
    await reload()
  } catch (err) {
    if (!handleAuthError(err)) error.value = err instanceof Error ? err.message : '保存入学年失败'
  } finally {
    savingYear.value = false
  }
}

const reload = async () => {
  if (!isLoggedIn.value) {
    identity.value = null
    return
  }
  pageLoading.value = true
  error.value = ''
  try {
    identity.value = await getUserCampus()
    if (!identity.value.campus) {
      await loadSchools()
      return
    }
    if (identity.value.enrollment_year) draftYear.value = identity.value.enrollment_year
    await Promise.all([loadCourses(), loadTags()])
    if (selectedCourseId.value) await selectCourse(selectedCourseId.value)
  } catch (err) {
    if (!handleAuthError(err)) error.value = err instanceof Error ? err.message : '同步校园账号失败'
  } finally {
    pageLoading.value = false
  }
}

const refreshCurrentCourse = async (preferPaperId?: number) => {
  const courseId = selectedCourseId.value
  if (!courseId) return
  try {
    const detail = await getCampusCourse(courseId)
    if (selectedCourseId.value !== courseId) return
    const raw = detail.folders.filter((item) => !item.archived)
    rememberFolders(courseId, raw)
    const keep = preferPaperId || selectedPaperId.value
    if (keep && raw.some((folder) => folder.id === keep)) {
      lastPaperByCourse.set(courseId, keep)
      void selectPaper(keep)
    }
    const counted = await withFolderQuestionCounts(raw)
    if (selectedCourseId.value !== courseId) {
      papersByCourse.set(courseId, counted)
      return
    }
    rememberFolders(courseId, counted)
  } catch {
    // ignore background refresh
  }
}

const onAuthChanged = () => {
  void reload()
}

const onCampusUpdated = (event: Event) => {
  const detail = (event as CustomEvent<{ courseId?: number; paperId?: number }>).detail || {}
  if (detail.courseId && selectedCourseId.value && detail.courseId !== selectedCourseId.value) return
  void refreshCurrentCourse(detail.paperId)
}

const closePlatformFilter = (event: Event) => {
  const target = event.target as HTMLElement | null
  if (target?.closest('.platform-filter')) return
  platformFilterOpen.value = false
}

const onKeydown = (event: KeyboardEvent) => {
  if (!showPaperCol.value) return
  const target = event.target as HTMLElement | null
  if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable)) {
    return
  }
  if (event.key === 'ArrowLeft') {
    event.preventDefault()
    goPrev()
  } else if (event.key === 'ArrowRight') {
    event.preventDefault()
    goNext()
  }
}

onMounted(() => {
  void reload()
  window.addEventListener('auth-changed', onAuthChanged)
  window.addEventListener('campus-updated', onCampusUpdated)
  window.addEventListener('keydown', onKeydown)
  document.addEventListener('mousedown', closePlatformFilter, true)
})

onUnmounted(() => {
  window.removeEventListener('auth-changed', onAuthChanged)
  window.removeEventListener('campus-updated', onCampusUpdated)
  window.removeEventListener('keydown', onKeydown)
  document.removeEventListener('mousedown', closePlatformFilter, true)
})
</script>

<style scoped>
.campus-page {
  height: 100%;
  display: flex;
  gap: 4px;
  background: var(--bg-primary, #f5f5f7);
}

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

.campus-sidebar,
.campus-papers {
  width: 240px;
  flex-shrink: 0;
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

.header-action {
  border: none;
  background: transparent;
  color: var(--text-secondary, #718096);
  font-size: 12px;
  cursor: pointer;
  padding: 4px 6px;
  border-radius: 6px;
}

.header-action:hover:not(:disabled) {
  color: var(--text-primary, #2d3748);
  background: var(--hover-bg, rgba(0, 0, 0, 0.04));
}

.platform-filter {
  position: relative;
  margin-left: auto;
}

.platform-select-trigger {
  box-sizing: border-box;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 148px;
  min-height: 24px;
  padding: 0 6px 0 8px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--form-input-bg, #F7F7F7);
  color: var(--text-primary, #2d3748);
  font-size: 12px;
  cursor: pointer;
  transition: border-color 0.2s ease, background-color 0.2s ease, transform 0.12s ease;
}

.platform-select-trigger:hover,
.platform-select-trigger.open {
  background: var(--form-input-hover-bg, #f0f0f0);
  border-color: var(--form-input-hover-border, transparent);
}

.platform-select-trigger:active {
  transform: scale(0.97);
}

.platform-select-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.platform-select-arrow {
  flex-shrink: 0;
  color: var(--text-secondary, #718096);
  transition: transform 0.16s ease;
}

.platform-select-trigger.open .platform-select-arrow {
  transform: rotate(180deg);
}

.platform-filter-menu {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 8;
  min-width: 148px;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  border-radius: 12px;
  background: var(--context-menu-bg, rgba(255, 255, 255, 0.4));
  backdrop-filter: blur(40px) saturate(180%);
  -webkit-backdrop-filter: blur(40px) saturate(180%);
  border: 1px solid var(--context-menu-border, rgba(255, 255, 255, 0.55));
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.22), 0 4px 12px rgba(0, 0, 0, 0.12), inset 0 0.5px 0 rgba(255, 255, 255, 0.5);
}

.platform-filter-item {
  appearance: none;
  box-sizing: border-box;
  width: 100%;
  min-height: 32px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: var(--context-menu-item-text, #2d3748);
  font-size: 13px;
  text-align: left;
  cursor: pointer;
}

.platform-filter-item:hover,
.platform-filter-item.active {
  background-color: var(--context-menu-item-hover-bg, rgba(0, 0, 0, 0.06));
}

.dropdown-pop-enter-active,
.dropdown-pop-leave-active {
  transition: opacity 0.14s ease, transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1);
  transform-origin: top right;
}

.dropdown-pop-enter-from,
.dropdown-pop-leave-to {
  opacity: 0;
  transform: translateY(-4px) scale(0.96);
}

.search-input,
.year-select {
  box-sizing: border-box;
  width: calc(100% - 16px);
  margin: 8px;
  padding: 7px 10px;
  border: none;
  border-radius: 8px;
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
  color: inherit;
  font-size: 12px;
}

.item-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 6px 8px 10px;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.list-item {
  width: 100%;
  display: block;
  text-align: left;
  border: none;
  background: transparent;
  color: inherit;
  padding: 8px 10px;
  border-radius: 8px;
  cursor: pointer;
}

.list-item:hover,
.list-item.is-selected {
  background: color-mix(in srgb, var(--text-primary, #2d3748) 6%, transparent);
}

.paper-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.paper-item .item-name {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-count {
  flex: 0 0 auto;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--text-secondary, #718096);
}

.item-name {
  font-size: 13px;
  line-height: 1.4;
}

.item-meta,
.list-empty {
  font-size: 12px;
  color: var(--text-secondary, #718096);
}

.list-empty {
  padding: 16px 12px;
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
  width: 140px;
  margin: 0;
}
</style>
