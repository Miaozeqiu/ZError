/** 多选、右键、复制剪切粘贴删除。 */
import { computed, nextTick } from 'vue'
import { claimExclusiveMenu } from '../../../composables/useExclusiveMenu'
import { databaseService, type AIResponse } from '../../../services/app/database'
import { PENDING_CORRECTION_FOLDER_ID, type QuestionListCtx } from './types'

export const bindQuestionListClipboard = (ctx: QuestionListCtx) => {
  const isPendingCorrectionFolder = computed(() => ctx.props.selectedFolderId === PENDING_CORRECTION_FOLDER_ID)

  const updateSelectAllState = () => {
    const current = ctx.questions.value
    if (!current.length) {
      ctx.isAllSelected.value = false
      ctx.isIndeterminate.value = false
      return
    }
    let selected = 0
    for (const question of current) {
      if (ctx.selectedQuestions.value.has(question.id)) selected += 1
    }
    ctx.isAllSelected.value = selected === current.length
    ctx.isIndeterminate.value = selected > 0 && selected < current.length
    if (selected === 0) ctx.isAllSelected.value = false
  }

  const handleQuestionSelect = (questionId: number, event: Event) => {
    const target = event.target as HTMLInputElement
    if (target.checked) ctx.selectedQuestions.value.add(questionId)
    else ctx.selectedQuestions.value.delete(questionId)
    updateSelectAllState()
  }

  const handleSelectAll = (event: Event) => {
    const target = event.target as HTMLInputElement
    for (const question of ctx.questions.value) {
      if (target.checked) ctx.selectedQuestions.value.add(question.id)
      else ctx.selectedQuestions.value.delete(question.id)
    }
    updateSelectAllState()
  }

  const hideContextMenu = () => {
    ctx.contextMenu.value.visible = false
    ctx.selectedQuestion.value = null
  }

  const handleRightClick = (event: MouseEvent, question: AIResponse) => {
    event.preventDefault()
    if (ctx.selectedQuestions.value.size > 0) {
      if (!ctx.selectedQuestions.value.has(question.id)) {
        ctx.selectedQuestions.value.add(question.id)
        updateSelectAllState()
      }
      ctx.selectedQuestion.value = null
      claimExclusiveMenu('question-list-context-menu')
      ctx.contextMenu.value = { visible: true, x: event.clientX, y: event.clientY, isBatchMode: true }
      return
    }
    ctx.selectedQuestion.value = question
    claimExclusiveMenu('question-list-context-menu')
    ctx.contextMenu.value = { visible: true, x: event.clientX, y: event.clientY, isBatchMode: false }
  }

  const handleListRightClick = (event: MouseEvent) => {
    event.preventDefault()
    ctx.selectedQuestion.value = null
    claimExclusiveMenu('question-list-context-menu')
    ctx.contextMenu.value = { visible: true, x: event.clientX, y: event.clientY, isBatchMode: false }
  }

  const copyQuestionToClipboard = async () => {
    if (ctx.selectedQuestion.value) {
      try { await navigator.clipboard.writeText(ctx.selectedQuestion.value.question) }
      catch (error) { console.error('复制题目失败:', error) }
    }
    hideContextMenu()
  }

  const copyAnswerToClipboard = async () => {
    if (ctx.selectedQuestion.value) {
      try { await navigator.clipboard.writeText(ctx.selectedQuestion.value.answer || '暂无答案') }
      catch (error) { console.error('复制答案失败:', error) }
    }
    hideContextMenu()
  }

  const batchCopyQuestions = () => {
    if (ctx.selectedQuestions.value.size > 0) {
      ctx.clipboard.value = {
        questions: ctx.questions.value.filter((item) => ctx.selectedQuestions.value.has(item.id)),
        operation: 'copy',
      }
    }
    hideContextMenu()
  }

  const batchCutQuestions = () => {
    if (ctx.selectedQuestions.value.size > 0) {
      ctx.clipboard.value = {
        questions: ctx.questions.value.filter((item) => ctx.selectedQuestions.value.has(item.id)),
        operation: 'cut',
      }
    }
    hideContextMenu()
  }

  const deleteQuestion = async () => {
    if (!ctx.selectedQuestion.value) {
      hideContextMenu()
      return
    }
    try {
      await databaseService.deleteQuestion(ctx.selectedQuestion.value.id)
      await ctx.ops.loadQuestions(ctx.props.selectedFolderId, ctx.currentPage.value)
    } catch (error) {
      console.error('删除题目失败:', error)
      alert('删除题目失败: ' + (error as Error).message)
    }
    hideContextMenu()
  }

  const cancelBatchDeleteQuestions = () => {
    ctx.batchDeleteDialog.value = { visible: false, count: 0, questionIds: [], loading: false }
  }

  const batchDeleteQuestions = async () => {
    if (ctx.selectedQuestions.value.size === 0) {
      hideContextMenu()
      return
    }
    const questionIds = ctx.questions.value
      .filter((item) => ctx.selectedQuestions.value.has(item.id))
      .map((item) => item.id)
    hideContextMenu()
    ctx.batchDeleteDialog.value = { visible: true, count: questionIds.length, questionIds, loading: false }
  }

  const confirmBatchDeleteQuestions = async () => {
    if (!ctx.batchDeleteDialog.value.questionIds.length || ctx.batchDeleteDialog.value.loading) return
    ctx.batchDeleteDialog.value.loading = true
    try {
      await databaseService.deleteQuestions(ctx.batchDeleteDialog.value.questionIds)
      ctx.selectedQuestions.value.clear()
      await ctx.ops.loadQuestions(ctx.props.selectedFolderId, ctx.currentPage.value)
      cancelBatchDeleteQuestions()
    } catch (error) {
      console.error('批量删除题目失败:', error)
      alert('批量删除题目失败: ' + (error as Error).message)
      ctx.batchDeleteDialog.value.loading = false
    }
  }

  const copyQuestion = () => {
    if (ctx.selectedQuestion.value) {
      ctx.clipboard.value = { question: ctx.selectedQuestion.value, operation: 'copy' }
    }
    hideContextMenu()
  }

  const cutQuestion = () => {
    if (ctx.selectedQuestion.value) {
      ctx.clipboard.value = { question: ctx.selectedQuestion.value, operation: 'cut' }
    }
    hideContextMenu()
  }

  const pasteQuestion = async () => {
    if ((!ctx.clipboard.value.question && !ctx.clipboard.value.questions?.length) || !ctx.props.selectedFolderId) {
      hideContextMenu()
      return
    }
    if (ctx.props.selectedFolderId === PENDING_CORRECTION_FOLDER_ID) {
      alert('待修正文件夹仅用于查看已标记题目，不能直接粘贴到这里')
      hideContextMenu()
      return
    }
    try {
      const targetFolderId = parseInt(ctx.props.selectedFolderId, 10)
      if (ctx.clipboard.value.questions?.length) {
        for (const question of ctx.clipboard.value.questions) {
          if (ctx.clipboard.value.operation === 'copy') {
            await databaseService.copyQuestionToFolder(question.id, targetFolderId)
          } else if (ctx.clipboard.value.operation === 'cut') {
            await databaseService.moveQuestionToFolder(question.id, targetFolderId)
          }
        }
        if (ctx.clipboard.value.operation === 'cut') {
          ctx.clipboard.value = { question: null, questions: [], operation: null }
        }
      } else if (ctx.clipboard.value.question) {
        if (ctx.clipboard.value.operation === 'copy') {
          await databaseService.copyQuestionToFolder(ctx.clipboard.value.question.id, targetFolderId)
        } else if (ctx.clipboard.value.operation === 'cut') {
          await databaseService.moveQuestionToFolder(ctx.clipboard.value.question.id, targetFolderId)
          ctx.clipboard.value = { question: null, questions: [], operation: null }
        }
      }
      ctx.selectedQuestions.value.clear()
      updateSelectAllState()
      await nextTick()
      await ctx.ops.loadQuestions(ctx.props.selectedFolderId, ctx.currentPage.value)
      ctx.emit('question-pasted')
    } catch (error) {
      console.error('粘贴题目失败:', error)
    }
    hideContextMenu()
  }

  const handleClickOutside = (event: MouseEvent) => {
    const target = event.target as Element
    if (target.closest('.context-menu')) return
    if (ctx.contextMenu.value.visible) hideContextMenu()
    if (ctx.importMenuOpen.value && !target.closest('.import-icon-button')) ctx.importMenuOpen.value = false
    if (ctx.exportMenuOpen.value && !target.closest('.export-icon-button')) ctx.exportMenuOpen.value = false
  }

  const showAddQuestionDialog = () => {
    if (ctx.props.selectedFolderId === PENDING_CORRECTION_FOLDER_ID) {
      alert('待修正文件夹仅用于查看已标记题目，不能直接新增题目')
      return
    }
    ctx.showAddQuestionModal.value = true
  }

  const hideAddQuestionDialog = () => {
    ctx.showAddQuestionModal.value = false
  }

  const handleQuestionSubmit = async (questionData: any) => {
    try {
      await databaseService.addQuestion(questionData)
      hideAddQuestionDialog()
      await ctx.ops.loadQuestions(ctx.props.selectedFolderId, 1)
      ctx.emit('question-added')
    } catch (error) {
      console.error('添加题目失败:', error)
    }
  }

  Object.assign(ctx.ops, { updateSelectAllState, hideContextMenu })
  return {
    isPendingCorrectionFolder,
    updateSelectAllState,
    handleQuestionSelect,
    handleSelectAll,
    handleRightClick,
    handleListRightClick,
    copyQuestionToClipboard,
    copyAnswerToClipboard,
    batchCopyQuestions,
    batchCutQuestions,
    deleteQuestion,
    batchDeleteQuestions,
    confirmBatchDeleteQuestions,
    cancelBatchDeleteQuestions,
    copyQuestion,
    cutQuestion,
    pasteQuestion,
    hideContextMenu,
    handleClickOutside,
    showAddQuestionDialog,
    hideAddQuestionDialog,
    handleQuestionSubmit,
  }
}
