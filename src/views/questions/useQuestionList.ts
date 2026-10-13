/** 题库列表编排。状态 questionList/state.ts，加载/搜索/导入/详情/剪贴板分文件。 */
import { onMounted, onUnmounted, watch } from 'vue'
import { bindQuestionListClipboard } from './questionList/clipboard'
import { bindQuestionListDetail } from './questionList/detail'
import {
  formatTime,
  getQuestionCreateTime,
  hasSelectedFolder,
  highlightSearchTerm,
  parseFolderId,
  sortQuestionListByCreateTime,
  typeTagKind,
} from './questionList/format'
import { bindQuestionListIo } from './questionList/io'
import { bindQuestionListLoad } from './questionList/load'
import { bindQuestionListResize } from './questionList/resize'
import { bindQuestionListSearch } from './questionList/search'
import { createQuestionListState } from './questionList/state'
import {
  PENDING_CORRECTION_FOLDER_ID,
  type Props,
  type QuestionListCtx,
  type QuestionListEmit,
  type QuestionListOps,
} from './questionList/types'

export type { Props, QuestionListEmit } from './questionList/types'

const unused = async () => undefined

export function useQuestionList(props: Props, emit: QuestionListEmit) {
  const state = createQuestionListState()
  const ops = {
    loadQuestions: unused,
    performSearch: unused,
    updateSelectAllState: () => undefined,
    importSoftwareExportedFile: unused,
    importOtherFileWithAgent: unused,
    exportFile: unused,
    closeDetail: () => undefined,
    hideContextMenu: () => undefined,
    analyzeImage: unused,
    fetchImages: unused,
    loadKnowledgeLinks: unused,
    applyCreateTimeSort: () => undefined,
  } as QuestionListOps
  const ctx: QuestionListCtx = { ...state, props, emit, ops }

  const load = bindQuestionListLoad(ctx)
  const search = bindQuestionListSearch(ctx)
  const io = bindQuestionListIo(ctx)
  const detail = bindQuestionListDetail(ctx)
  const clipboard = bindQuestionListClipboard(ctx)
  const resize = bindQuestionListResize(ctx)

  const isPendingCorrectionFolder = clipboard.isPendingCorrectionFolder
  const onKnowledgeUpdated = () => {
    void ops.loadKnowledgeLinks(state.questions.value)
  }

  watch(state.folderPath, (path) => emit('folder-path-change', path), { deep: true })
  watch(() => props.collapseTrigger, () => {
    if (state.showDetailOverlay.value) ops.closeDetail()
  })
  watch(state.questions, (items) => {
    void ops.loadKnowledgeLinks(items)
    state.imageSrcMap.value = {}
    void ops.fetchImages(detail.visibleImageUrls.value)
    const existing = new Set(items.map((item) => item.id))
    for (const id of [...state.selectedQuestions.value]) {
      if (!existing.has(id)) state.selectedQuestions.value.delete(id)
    }
    ops.updateSelectAllState()
  })
  watch(() => props.selectedFolderId, (folderId) => {
    state.listTransitionName.value = 'list-fade'
    state.currentPage.value = 1
    void ops.loadQuestions(folderId, 1)
  }, { immediate: true })

  onMounted(() => {
    document.addEventListener('click', clipboard.handleClickOutside)
    window.addEventListener('question-knowledge-updated', onKnowledgeUpdated)
  })
  onUnmounted(() => {
    document.removeEventListener('click', clipboard.handleClickOutside)
    window.removeEventListener('question-knowledge-updated', onKnowledgeUpdated)
  })

  return {
    PENDING_CORRECTION_FOLDER_ID,
    ...state,
    knowledgeFor: detail.knowledgeFor,
    openKnowledge: detail.openKnowledge,
    loadKnowledgeLinks: detail.loadKnowledgeLinks,
    hasSelectedFolder,
    parseFolderId,
    ...io,
    ...search,
    fillEditForm: detail.fillEditForm,
    resetEditForm: detail.resetEditForm,
    _imageCache: detail._imageCache,
    getContentParts: detail.getContentParts,
    imgSrc: detail.imgSrc,
    invertClass: detail.invertClass,
    visibleImageUrls: detail.visibleImageUrls,
    fetchImages: detail.fetchImages,
    analyzeImage: detail.analyzeImage,
    isPendingCorrectionFolder,
    getQuestionCreateTime,
    sortQuestionListByCreateTime: (list: Parameters<typeof sortQuestionListByCreateTime>[0]) => (
      sortQuestionListByCreateTime(list, state.createTimeSortOrder.value)
    ),
    ...load,
    questionHasImages: detail.questionHasImages,
    applyQuestionSelection: detail.applyQuestionSelection,
    handleQuestionClick: detail.handleQuestionClick,
    closeDetail: detail.closeDetail,
    toggleEditMode: detail.toggleEditMode,
    cancelEdit: detail.cancelEdit,
    replaceQuestionInList: detail.replaceQuestionInList,
    updateQuestionLocally: detail.updateQuestionLocally,
    removeQuestionLocally: detail.removeQuestionLocally,
    saveEdit: detail.saveEdit,
    typeTagKind,
    formatTime,
    ...clipboard,
    ...resize,
    handleSearch: search.handleSearch,
    performSearch: search.performSearch,
    clearSearch: search.clearSearch,
    highlightSearchTerm: (text: string) => highlightSearchTerm(
      text,
      state.searchTerm.value,
      state.highlightTerms.value,
    ),
    onKnowledgeUpdated,
  }
}
