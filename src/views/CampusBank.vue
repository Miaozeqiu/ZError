<template>
  <div class="campus-page">
    <CampusSidebar
      :sidebar-title="sidebarTitle"
      :is-logged-in="isLoggedIn"
      :identity="identity"
      :school-query="schoolQuery"
      :filtered-schools="filteredSchools"
      :schools-loading="schoolsLoading"
      :binding-id="bindingId"
      :courses="courses"
      :selected-course-id="selectedCourseId"
      :courses-loading="coursesLoading"
      @reload="reload"
      @update:school-query="schoolQuery = $event"
      @choose-school="chooseSchool"
      @select-course="selectCourse"
    />

    <CampusPaperList
      v-if="showPaperCol"
      :visible-paper-count="visiblePaperCount"
      :platform-options="platformOptions"
      :platform-filter="platformFilter"
      :platform-filter-open="platformFilterOpen"
      :papers-loading="papersLoading"
      :visible-papers="visiblePapers"
      :selected-paper-id="selectedPaperId"
      @toggle-filter="platformFilterOpen = !platformFilterOpen"
      @set-platform-filter="setPlatformFilter"
      @select-paper="selectPaper"
    />

    <CampusMainPane
      :main-title="mainTitle"
      :identity="identity"
      :show-browse="showBrowse"
      :is-logged-in="isLoggedIn"
      :page-loading="pageLoading"
      :error="error"
      :draft-year="draftYear"
      :year-options="yearOptions"
      :saving-year="savingYear"
      :selected-course-id="selectedCourseId"
      :papers-loading="papersLoading"
      :visible-paper-count="visiblePaperCount"
      :selected-paper-id="selectedPaperId"
      :questions-loading="questionsLoading"
      :active-questions="activeQuestions"
      :selected-question="selectedQuestion"
      :current-index="currentIndex"
      @open-login="openLoginDialog"
      @reload="reload"
      @update:draft-year="draftYear = $event"
      @save-year="saveYear"
      @prev="goPrev"
      @next="goNext"
      @goto="showQuestion"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useExclusiveMenu } from '../composables/useExclusiveMenu'
import { isLoggedIn, openLoginDialog } from '../services/app/auth'
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
} from '../services/app/campus'
import { RemoteApiError } from '../services/app/remoteHttp'
import CampusMainPane from './campus/CampusMainPane.vue'
import CampusPaperList from './campus/CampusPaperList.vue'
import CampusSidebar from './campus/CampusSidebar.vue'

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
</style>
