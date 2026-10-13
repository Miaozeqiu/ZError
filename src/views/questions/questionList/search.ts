/** 题库搜索。加载列表走 load.ts。 */
import { nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { databaseService } from '../../../services/app/database'
import { PENDING_CORRECTION_FOLDER_ID, type QuestionListCtx } from './types'
import { hasSelectedFolder, parseFolderId, sortQuestionListByCreateTime } from './format'

export const bindQuestionListSearch = (ctx: QuestionListCtx) => {
  const openSearch = async () => {
    ctx.searchOpen.value = true
    await nextTick()
    ctx.searchInputRef.value?.focus()
  }

  const collapseSearch = () => {
    ctx.searchOpen.value = false
  }

  const clearSearch = () => {
    ctx.searchTerm.value = ''
    ctx.isSearchMode.value = false
    ctx.highlightTerms.value = []
    ctx.listTransitionName.value = 'list-fade'
    if (ctx.searchDebounceTimer.value) {
      clearTimeout(ctx.searchDebounceTimer.value)
      ctx.searchDebounceTimer.value = null
    }
    void ctx.ops.loadQuestions(ctx.props.selectedFolderId, ctx.pageBeforeSearch.value || 1)
  }

  const performSearch = async () => {
    if (!ctx.searchTerm.value.trim()) {
      clearSearch()
      return
    }
    const generation = ++ctx.loadGeneration.value
    try {
      if (!ctx.isSearchMode.value) ctx.pageBeforeSearch.value = ctx.currentPage.value
      ctx.listTransitionName.value = 'list-fade'
      ctx.isSearchMode.value = true
      ctx.currentPage.value = 1
      const parsedFolderId = hasSelectedFolder(ctx.props.selectedFolderId)
        && ctx.props.selectedFolderId !== PENDING_CORRECTION_FOLDER_ID
        ? parseFolderId(ctx.props.selectedFolderId || '')
        : null
      const currentFolderId = parsedFolderId ?? undefined
      try {
        const segments = await invoke<string[]>('segment_text', { text: ctx.searchTerm.value.trim() })
        ctx.highlightTerms.value = segments?.length
          ? segments
          : ctx.searchTerm.value.trim().split(/\s+/).filter((item) => item.length > 0)
      } catch {
        ctx.highlightTerms.value = ctx.searchTerm.value.trim().split(/\s+/).filter((item) => item.length > 0)
      }
      if (ctx.props.selectedFolderId === PENDING_CORRECTION_FOLDER_ID) {
        const keyword = ctx.searchTerm.value.trim().toLowerCase()
        const pendingQuestions = await databaseService.getPendingCorrectionQuestions()
        if (generation !== ctx.loadGeneration.value) return
        ctx.questions.value = sortQuestionListByCreateTime(
          pendingQuestions.filter((question) => question.question.toLowerCase().includes(keyword)),
          ctx.createTimeSortOrder.value,
        )
      } else {
        const searchResults = await databaseService.searchQuestionsByTitle(ctx.searchTerm.value.trim(), currentFolderId)
        if (generation !== ctx.loadGeneration.value) return
        ctx.questions.value = sortQuestionListByCreateTime(searchResults, ctx.createTimeSortOrder.value)
      }
      ctx.totalQuestions.value = ctx.questions.value.length
      ctx.listContentKey.value = `search:${ctx.searchTerm.value}`
    } catch (error) {
      if (generation !== ctx.loadGeneration.value) return
      console.error('搜索失败:', error)
    }
  }

  const handleSearch = () => {
    if (ctx.searchDebounceTimer.value) clearTimeout(ctx.searchDebounceTimer.value)
    ctx.searchDebounceTimer.value = setTimeout(() => {
      void performSearch()
    }, 300) as unknown as number
  }

  Object.assign(ctx.ops, { performSearch })
  return { openSearch, collapseSearch, handleSearch, performSearch, clearSearch }
}
