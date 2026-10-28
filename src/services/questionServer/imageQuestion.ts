import { fetchQuestionImageBase64, findQuestionImageMatches } from '../../utils/question/questionImage'
import { buildHtmlFromPlaceholders } from '../../utils/answer/imagePlaceholders'
import { createImageQuestionPreparer, type ImageQuestionSource } from '../../utils/answer/imageQuestion'
import { applyWhiteBackgroundToDataUrl, ensureDataUrlMinimumSize } from './visionImage'

const preparer = createImageQuestionPreparer(findQuestionImageMatches, async url => {
  const base64 = await fetchQuestionImageBase64(url)
  if (!base64) throw new Error('图片下载失败')
  return ensureDataUrlMinimumSize(await applyWhiteBackgroundToDataUrl(base64), 32)
})

export const prepareQuestionImages = preparer.prepare
export const clearPreparedQuestionImages = preparer.clear
export const buildQuestionImagePreview = async (question: ImageQuestionSource): Promise<string> => {
  try {
    const prepared = await prepareQuestionImages(question)
    return buildHtmlFromPlaceholders(prepared.title, prepared.options, prepared.images)
  } catch {
    // Keep preview safe and readable. Analysis reports the actual preparation failure.
    return buildHtmlFromPlaceholders(question.title, question.options, [])
  }
}
