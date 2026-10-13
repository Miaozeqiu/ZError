/** 详情面板、编辑、题图。列表加载走 load.ts。 */
import { computed, nextTick } from 'vue'
import { databaseService, type AIResponse, type QuestionKnowledgeLink } from '../../../services/app/database'
import { openKnowledgeInStudy } from '../../../services/study/questionKnowledge'
import {
  fetchQuestionImageBase64,
  shouldInvertTransparentDarkImage,
  splitQuestionImageParts,
  type QuestionImagePart as Part,
} from '../../../utils/question/questionImage'
import { normalizeMetric } from '../../../utils/question/questionMetrics'
import { PENDING_CORRECTION_FOLDER_ID, type QuestionListCtx } from './types'

const imageCache = new Map<string, string>()

export const bindQuestionListDetail = (ctx: QuestionListCtx) => {
  const knowledgeFor = (id: number) => ctx.knowledgeByQuestion.value[id] || []
  const openKnowledge = (link: QuestionKnowledgeLink) => openKnowledgeInStudy(link)

  const loadKnowledgeLinks = async (items: AIResponse[]) => {
    const ids = items.map((item) => item.id)
    if (!ids.length) {
      ctx.knowledgeByQuestion.value = {}
      return
    }
    try {
      const links = await databaseService.listQuestionKnowledge(ids)
      const map: Record<number, QuestionKnowledgeLink[]> = {}
      for (const link of links) (map[link.question_id] ||= []).push(link)
      ctx.knowledgeByQuestion.value = map
    } catch {
      ctx.knowledgeByQuestion.value = {}
    }
  }

  const fillEditForm = (question: AIResponse) => {
    ctx.editFormData.value = {
      question: question.question || '',
      options: question.options || '',
      answer: question.answer || '',
      question_type: question.question_type || '',
      importance: normalizeMetric(question.importance),
      mastery: normalizeMetric(question.mastery),
      difficulty: normalizeMetric(question.difficulty),
    }
  }

  const resetEditForm = () => {
    ctx.editFormData.value = {
      question: '',
      options: '',
      answer: '',
      question_type: '',
      importance: 0,
      mastery: 0,
      difficulty: 0,
    }
  }

  const getContentParts = (text: string): Part[] => splitQuestionImageParts(text || '')
  const imgSrc = (url: string) => ctx.imageSrcMap.value[url]
  const invertClass = (url: string) => (ctx.blackOnlyMap.value[url] ? 'invert-on-dark' : '')

  const visibleImageUrls = computed(() => {
    const urls: string[] = []
    for (const question of ctx.questions.value) {
      for (const field of [question.question, question.options, question.answer]) {
        for (const part of getContentParts(field || '')) {
          if (part.type === 'image' && part.url) urls.push(part.url)
        }
      }
    }
    return Array.from(new Set(urls))
  })

  const analyzeImage = async (url: string, src: string) => {
    try {
      ctx.blackOnlyMap.value = {
        ...ctx.blackOnlyMap.value,
        [url]: await shouldInvertTransparentDarkImage(src),
      }
    } catch { /* ignore */ }
  }

  const fetchImages = async (urls: string[]) => {
    if (!urls.length) {
      ctx.imageSrcMap.value = {}
      return
    }
    for (const url of urls) {
      if (imageCache.has(url)) {
        const cached = imageCache.get(url)!
        if (!ctx.imageSrcMap.value[url]) {
          ctx.imageSrcMap.value = { ...ctx.imageSrcMap.value, [url]: cached }
        }
        await analyzeImage(url, cached)
        continue
      }
      try {
        const dataUrl = await fetchQuestionImageBase64(url)
        if (!dataUrl) continue
        imageCache.set(url, dataUrl)
        ctx.imageSrcMap.value = { ...ctx.imageSrcMap.value, [url]: dataUrl }
        void analyzeImage(url, dataUrl)
      } catch { /* ignore */ }
    }
  }

  const questionHasImages = (question: AIResponse) => (
    [question.question, question.options, question.answer].some((text) => (
      getContentParts(text || '').some((part) => part.type === 'image')
    ))
  )

  const applyQuestionSelection = (question: AIResponse, startInEditMode = false) => {
    ctx.selectedQuestionId.value = question.id
    ctx.selectedQuestionDetails.value = question
    if (startInEditMode) {
      fillEditForm(question)
      ctx.isEditMode.value = true
      return
    }
    ctx.isEditMode.value = false
    resetEditForm()
  }

  const handleQuestionClick = (question: AIResponse) => {
    const startInEditMode = !questionHasImages(question)
    const alreadyOpen = Boolean(ctx.selectedQuestionDetails.value)
    applyQuestionSelection(question, startInEditMode)
    if (!alreadyOpen) {
      ctx.showDetailOverlay.value = false
      nextTick(() => {
        setTimeout(() => { ctx.showDetailOverlay.value = true }, 10)
      })
    }
    ctx.emit('question-select', question)
  }

  const closeDetail = () => {
    ctx.showDetailOverlay.value = false
    ctx.isEditMode.value = false
    setTimeout(() => {
      ctx.selectedQuestionId.value = null
      ctx.selectedQuestionDetails.value = null
    }, 300)
  }

  const toggleEditMode = () => {
    if (!ctx.selectedQuestionDetails.value) return
    if (!ctx.isEditMode.value) {
      fillEditForm(ctx.selectedQuestionDetails.value)
      ctx.isEditMode.value = true
    } else {
      ctx.isEditMode.value = false
    }
  }

  const cancelEdit = () => {
    ctx.isEditMode.value = false
    resetEditForm()
  }

  const replaceQuestionInList = (list: AIResponse[], updatedQuestion: AIResponse) => {
    const index = list.findIndex((item) => item.id === updatedQuestion.id)
    if (index !== -1) list.splice(index, 1, updatedQuestion)
  }

  const updateQuestionLocally = (updatedQuestion: AIResponse) => {
    replaceQuestionInList(ctx.questions.value, updatedQuestion)
    if (ctx.selectedQuestion.value?.id === updatedQuestion.id) {
      ctx.selectedQuestion.value = updatedQuestion
    }
    ctx.selectedQuestionDetails.value = updatedQuestion
  }

  const removeQuestionLocally = (questionId: number) => {
    const index = ctx.questions.value.findIndex((item) => item.id === questionId)
    if (index !== -1) ctx.questions.value.splice(index, 1)
    if (ctx.totalQuestions.value > 0) ctx.totalQuestions.value -= 1
    ctx.selectedQuestions.value.delete(questionId)
    ctx.ops.updateSelectAllState()
    if (ctx.selectedQuestionId.value === questionId) closeDetail()
  }

  const saveEdit = async () => {
    if (!ctx.selectedQuestionDetails.value || !ctx.isEditFormValid.value || ctx.isSavingEdit.value) return
    try {
      ctx.isSavingEdit.value = true
      const wasPendingCorrection = Boolean(ctx.selectedQuestionDetails.value.is_pending_correction)
      const updatedQuestion = {
        ...ctx.selectedQuestionDetails.value,
        question: ctx.editFormData.value.question.trim(),
        options: ctx.editFormData.value.options.trim(),
        answer: ctx.editFormData.value.answer.trim(),
        question_type: ctx.editFormData.value.question_type.trim(),
        importance: normalizeMetric(ctx.editFormData.value.importance),
        mastery: normalizeMetric(ctx.editFormData.value.mastery),
        difficulty: normalizeMetric(ctx.editFormData.value.difficulty),
        is_pending_correction: false,
      }
      await databaseService.updateQuestion(updatedQuestion.id, {
        question: updatedQuestion.question,
        options: updatedQuestion.options || null,
        answer: updatedQuestion.answer,
        question_type: updatedQuestion.question_type,
        importance: updatedQuestion.importance,
        mastery: updatedQuestion.mastery,
        difficulty: updatedQuestion.difficulty,
      })
      if (ctx.props.selectedFolderId === PENDING_CORRECTION_FOLDER_ID) {
        removeQuestionLocally(updatedQuestion.id)
        ctx.isEditMode.value = false
      } else {
        updateQuestionLocally(updatedQuestion)
        ctx.isEditMode.value = false
      }
      if (wasPendingCorrection) ctx.emit('question-updated')
    } catch (error) {
      console.error('更新题目失败:', error)
    } finally {
      ctx.isSavingEdit.value = false
    }
  }

  Object.assign(ctx.ops, { closeDetail, analyzeImage, fetchImages, loadKnowledgeLinks })
  return {
    knowledgeFor,
    openKnowledge,
    loadKnowledgeLinks,
    fillEditForm,
    resetEditForm,
    _imageCache: imageCache,
    getContentParts,
    imgSrc,
    invertClass,
    visibleImageUrls,
    fetchImages,
    analyzeImage,
    questionHasImages,
    applyQuestionSelection,
    handleQuestionClick,
    closeDetail,
    toggleEditMode,
    cancelEdit,
    replaceQuestionInList,
    updateQuestionLocally,
    removeQuestionLocally,
    saveEdit,
  }
}
