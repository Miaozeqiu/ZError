/** 题库搜索。加载列表走 load.ts。 */
import { nextTick } from 'vue'
import { invoke } from '@tauri-apps/api/core'
import { databaseService } from '../../../services/app/database'
import { PENDING_CORRECTION_FOLDER_ID, type QuestionListCtx } from './types'
import { hasSelectedFolder, parseFolderId } from './format'

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

  const performSearch = async (page = 1) => {
    const keyword = ctx.searchTerm.value.trim()
    if (!keyword) {
      clearSearch()
      return
    }
    const generation = ++ctx.loadGeneration.value
    const folder = ctx.props.selectedFolderId
    const pendingCorrectionOnly = folder === PENDING_CORRECTION_FOLDER_ID
    const folderId = hasSelectedFolder(folder) && !pendingCorrectionOnly
      ? parseFolderId(folder || '') ?? undefined
      : undefined

    if (!ctx.isSearchMode.value) ctx.pageBeforeSearch.value = ctx.currentPage.value
    ctx.listTransitionName.value = 'list-fade'
    ctx.isSearchMode.value = true
    try {
      const [results, segments] = await Promise.all([
        databaseService.searchQuestionsPage({
          keyword, folderId, pendingCorrectionOnly, page,
          pageSize: ctx.pageSize.value, sortOrder: ctx.createTimeSortOrder.value,
        }),
        invoke<string[]>('segment_text', { text: keyword }).catch(() => []),
      ])
      if (generation !== ctx.loadGeneration.value || keyword !== ctx.searchTerm.value.trim()) return
      const lastPage = Math.max(1, Math.ceil(results.total / ctx.pageSize.value))
      if (page > lastPage) {
        await performSearch(lastPage)
        return
      }
      ctx.highlightTerms.value = segments
      ctx.currentPage.value = page
      ctx.questions.value = results.items
      ctx.totalQuestions.value = results.total
      ctx.listContentKey.value = `search:${keyword}:${page}`
    } catch (error) {
      if (generation !== ctx.loadGeneration.value) return
      console.error('搜索失败:', error)
    }
  }

  const handleSearch = () => {
    ++ctx.loadGeneration.value
    if (ctx.searchDebounceTimer.value) clearTimeout(ctx.searchDebounceTimer.value)
    ctx.searchDebounceTimer.value = setTimeout(() => {
      ctx.searchDebounceTimer.value = null
      void performSearch()
    }, 300) as unknown as number
  }

  Object.assign(ctx.ops, { performSearch })
  return { openSearch, collapseSearch, handleSearch, performSearch, clearSearch }
}
