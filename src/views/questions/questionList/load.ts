/** 分页加载。搜索走 search.ts，SQL 走 database/questions.ts。 */
import { databaseService } from '../../../services/app/database'
import { PENDING_CORRECTION_FOLDER_ID, type QuestionListCtx } from './types'
import { hasSelectedFolder, parseFolderId, sortQuestionListByCreateTime } from './format'

export const bindQuestionListLoad = (ctx: QuestionListCtx) => {
  const fetchQuestionPage = async (folderId?: string | null, page = 1) => {
    if (folderId === PENDING_CORRECTION_FOLDER_ID) {
      return databaseService.getPaginatedQuestions({
        pendingCorrectionOnly: true,
        page,
        pageSize: ctx.pageSize.value,
        sortOrder: ctx.createTimeSortOrder.value,
      })
    }
    if (hasSelectedFolder(folderId)) {
      const folderIdNum = parseFolderId(folderId as string)
      if (folderIdNum !== null) {
        return databaseService.getPaginatedQuestions({
          folderId: folderIdNum,
          page,
          pageSize: ctx.pageSize.value,
          sortOrder: ctx.createTimeSortOrder.value,
        })
      }
    }
    return { items: [], total: 0 }
  }

  const applyCreateTimeSort = () => {
    if (ctx.isSearchMode.value) {
      ctx.questions.value = sortQuestionListByCreateTime(ctx.questions.value, ctx.createTimeSortOrder.value)
    }
  }

  const loadQuestions = async (folderId?: string | null, requestedPage = 1) => {
    const generation = ++ctx.loadGeneration.value
    try {
      if (ctx.isSearchMode.value) {
        ctx.searchTerm.value = ''
        ctx.isSearchMode.value = false
        ctx.pageBeforeSearch.value = 1
      }
      ctx.selectedQuestions.value.clear()
      ctx.ops.updateSelectAllState()
      if (!hasSelectedFolder(folderId)) {
        if (generation !== ctx.loadGeneration.value) return
        ctx.questions.value = []
        ctx.totalQuestions.value = 0
        ctx.currentPage.value = 1
        ctx.folderPath.value = []
        ctx.listContentKey.value = 'empty'
        return
      }
      const pathPromise = (async () => {
        if (folderId === PENDING_CORRECTION_FOLDER_ID) return [{ id: -1, name: '待修正' }]
        const folderIdNum = parseFolderId(folderId as string)
        if (folderIdNum === null) return []
        try {
          return await databaseService.getFolderPath(folderIdNum)
        } catch (error) {
          console.error('获取文件夹路径失败:', error)
          return []
        }
      })()
      const result = await fetchQuestionPage(folderId, requestedPage)
      if (generation !== ctx.loadGeneration.value) return
      const maxPage = Math.max(1, Math.ceil(result.total / ctx.pageSize.value))
      if (result.total > 0 && requestedPage > maxPage) {
        await loadQuestions(folderId, maxPage)
        return
      }
      ctx.questions.value = result.items
      ctx.totalQuestions.value = result.total
      ctx.currentPage.value = result.total === 0 ? 1 : Math.min(requestedPage, maxPage)
      ctx.listContentKey.value = `folder:${folderId}:page:${ctx.currentPage.value}`
      pathPromise.then((path) => {
        if (generation === ctx.loadGeneration.value) ctx.folderPath.value = path
      })
    } catch (error) {
      if (generation !== ctx.loadGeneration.value) return
      console.error('加载题目失败:', error)
      ctx.questions.value = []
      ctx.totalQuestions.value = 0
      ctx.folderPath.value = []
      ctx.listContentKey.value = 'empty'
    } finally {
      if (generation === ctx.loadGeneration.value) ctx.hasLoaded.value = true
    }
  }

  const refreshData = async () => {
    try {
      if (ctx.isSearchMode.value && ctx.searchTerm.value.trim()) {
        await ctx.ops.performSearch()
        return
      }
      await loadQuestions(ctx.props.selectedFolderId, ctx.currentPage.value)
    } catch (error) {
      console.error('刷新题目失败:', error)
    }
  }

  const goToPreviousPage = () => {
    if (!ctx.isSearchMode.value && ctx.currentPage.value > 1) {
      ctx.listTransitionName.value = 'list-prev'
      void loadQuestions(ctx.props.selectedFolderId, ctx.currentPage.value - 1)
    }
  }

  const goToNextPage = () => {
    if (!ctx.isSearchMode.value && ctx.currentPage.value < ctx.totalPages.value) {
      ctx.listTransitionName.value = 'list-next'
      void loadQuestions(ctx.props.selectedFolderId, ctx.currentPage.value + 1)
    }
  }

  const goToPage = (page: number) => {
    if (!ctx.isSearchMode.value && page >= 1 && page <= ctx.totalPages.value && page !== ctx.currentPage.value) {
      ctx.listTransitionName.value = page > ctx.currentPage.value ? 'list-next' : 'list-prev'
      void loadQuestions(ctx.props.selectedFolderId, page)
    }
  }

  const toggleCreateTimeSort = () => {
    ctx.createTimeSortOrder.value = ctx.createTimeSortOrder.value === 'desc' ? 'asc' : 'desc'
    applyCreateTimeSort()
    if (!ctx.isSearchMode.value) {
      void loadQuestions(ctx.props.selectedFolderId, ctx.currentPage.value)
    }
  }

  Object.assign(ctx.ops, { loadQuestions, applyCreateTimeSort })
  return {
    fetchQuestionPage,
    loadQuestions,
    refreshData,
    goToPreviousPage,
    goToNextPage,
    goToPage,
    toggleCreateTimeSort,
    applyCreateTimeSort,
  }
}
