/** 题库列表的 ref 袋。操作模块只改这里，不要再各写一套状态。 */
import { computed, ref } from 'vue'
import type { AIResponse, QuestionKnowledgeLink } from '../../../services/app/database'
import type { QuestionMetricValue } from '../../../utils/question/questionMetrics'

export const createQuestionListState = () => {
  const questions = ref<AIResponse[]>([])
  const knowledgeByQuestion = ref<Record<number, QuestionKnowledgeLink[]>>({})
  const loading = ref(false)
  const hasLoaded = ref(false)
  const listTransitionName = ref('list-fade')
  const selectedQuestionId = ref<number | null>(null)
  const selectedQuestionDetails = ref<AIResponse | null>(null)
  const showDetailOverlay = ref(false)
  const folderPath = ref<{ id: number; name: string }[]>([])

  const currentPage = ref(1)
  const pageSize = ref(20)
  const totalQuestions = ref(0)
  const pageBeforeSearch = ref(1)
  const searchTerm = ref('')
  const isSearchMode = ref(false)
  const searchDebounceTimer = ref<number | null>(null)
  const highlightTerms = ref<string[]>([])
  const createTimeSortOrder = ref<'desc' | 'asc'>('desc')
  const listContentKey = ref('boot')
  const loadGeneration = ref(0)

  const isResizing = ref(false)
  const overlayWidth = ref(400)
  const startX = ref(0)
  const startWidth = ref(0)

  const importButtonRef = ref<HTMLElement | null>(null)
  const exportButtonRef = ref<HTMLElement | null>(null)
  const importMenuOpen = ref(false)
  const exportMenuOpen = ref(false)
  const importMenuPos = ref({ x: 0, y: 0 })
  const exportMenuPos = ref({ x: 0, y: 0 })
  const agentImportPickerVisible = ref(false)
  const pendingAgentImportPath = ref<string | null>(null)

  const searchOpen = ref(false)
  const searchInputRef = ref<HTMLInputElement | null>(null)
  const selectedQuestions = ref<Set<number>>(new Set())
  const batchDeleteDialog = ref({
    visible: false,
    count: 0,
    questionIds: [] as number[],
    loading: false,
  })
  const isAllSelected = ref(false)
  const isIndeterminate = ref(false)
  const contextMenu = ref({
    visible: false,
    x: 0,
    y: 0,
    isBatchMode: false,
  })
  const selectedQuestion = ref<AIResponse | null>(null)
  const isEditMode = ref(false)
  const isSavingEdit = ref(false)
  const editFormData = ref({
    question: '',
    options: '',
    answer: '',
    question_type: '',
    importance: 0 as QuestionMetricValue,
    mastery: 0 as QuestionMetricValue,
    difficulty: 0 as QuestionMetricValue,
  })
  const imageSrcMap = ref<Record<string, string>>({})
  const blackOnlyMap = ref<Record<string, boolean>>({})
  const clipboard = ref<{
    question?: AIResponse | null
    questions?: AIResponse[]
    operation: 'copy' | 'cut' | null
  }>({
    question: null,
    questions: [],
    operation: null,
  })
  const showAddQuestionModal = ref(false)

  const isEditFormValid = computed(() => (
    editFormData.value.question.trim() !== '' && editFormData.value.answer.trim() !== ''
  ))
  const canPaste = computed(() => Boolean(
    clipboard.value.question != null
    || (clipboard.value.questions && clipboard.value.questions.length > 0),
  ))
  const totalPages = computed(() => {
    if (isSearchMode.value) return questions.value.length > 0 ? 1 : 0
    return Math.ceil(totalQuestions.value / pageSize.value)
  })

  return {
    questions,
    knowledgeByQuestion,
    loading,
    hasLoaded,
    listTransitionName,
    selectedQuestionId,
    selectedQuestionDetails,
    showDetailOverlay,
    folderPath,
    currentPage,
    pageSize,
    totalQuestions,
    pageBeforeSearch,
    searchTerm,
    isSearchMode,
    searchDebounceTimer,
    highlightTerms,
    createTimeSortOrder,
    listContentKey,
    loadGeneration,
    isResizing,
    overlayWidth,
    startX,
    startWidth,
    importButtonRef,
    exportButtonRef,
    importMenuOpen,
    exportMenuOpen,
    importMenuPos,
    exportMenuPos,
    agentImportPickerVisible,
    pendingAgentImportPath,
    searchOpen,
    searchInputRef,
    selectedQuestions,
    batchDeleteDialog,
    isAllSelected,
    isIndeterminate,
    contextMenu,
    selectedQuestion,
    isEditMode,
    isSavingEdit,
    editFormData,
    imageSrcMap,
    blackOnlyMap,
    clipboard,
    showAddQuestionModal,
    isEditFormValid,
    canPaste,
    totalPages,
  }
}

export type QuestionListState = ReturnType<typeof createQuestionListState>
