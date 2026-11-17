import type { QuestionImageMatch } from '../question/questionImage'
import { isImageDataUrl } from './imagePlaceholders'

export interface ImageQuestionSource {
  title: string
  options: string
  images?: string[]
}
export interface PreparedImageQuestion extends ImageQuestionSource {
  images: string[]
  imageUrls: string[]
  source: 'ocs' | 'local'
}

/** One preparation per live question object, shared by preview, analysis and retries. */
export const createImageQuestionPreparer = (
  findMatches: (text: string) => QuestionImageMatch[],
  loadImage: (url: string) => Promise<string>,
) => {
  const cache = new WeakMap<ImageQuestionSource, Promise<PreparedImageQuestion>>()
  const convert = async (question: ImageQuestionSource): Promise<PreparedImageQuestion> => {
    if (question.images?.length) {
      if (question.images.some(image => !isImageDataUrl(image))) throw new Error('OCS 提供的图片数据无效')
      return { title: question.title, options: question.options, images: question.images.slice(), imageUrls: [], source: 'ocs' }
    }
    // Use exactly the same matches for download, numbering and text replacement.
    const titleMatches = findMatches(question.title)
    const optionMatches = findMatches(question.options)
    const imageUrls = [...new Set([...titleMatches, ...optionMatches].map(match => match.normalizedUrl))]
    const results = await Promise.allSettled(imageUrls.map(loadImage))
    const failures = imageUrls.filter((_url, index) => {
      const result = results[index]
      return result.status !== 'fulfilled' || !isImageDataUrl(result.value)
    })
    if (failures.length) throw new Error(`题目图片下载或转换失败，无法完整识别题目：${failures.join('，')}`)
    const images = results.map(result => (result as PromiseFulfilledResult<string>).value)
    const indices = new Map(imageUrls.map((url, index) => [url, index + 1]))
    const replace = (text: string, matches: QuestionImageMatch[]) => {
      let offset = 0
      let output = ''
      for (const match of matches) {
        output += text.slice(offset, match.start) + `[图片${indices.get(match.normalizedUrl)}]` + match.trailingText
        offset = match.end
      }
      return output + text.slice(offset)
    }
    return {
      title: replace(question.title, titleMatches),
      options: replace(question.options, optionMatches),
      images, imageUrls, source: 'local',
    }
  }
  return {
    prepare: (question: ImageQuestionSource): Promise<PreparedImageQuestion> => {
      let pending = cache.get(question)
      if (!pending) {
        pending = convert(question)
        cache.set(question, pending)
      }
      return pending
    },
    clear: (question: ImageQuestionSource) => cache.delete(question),
  }
}

/** OCS-off requests have no client-side map, so restore local numbers before the callback. */
export const restorePreparedImageAnswer = (answer: string, question: PreparedImageQuestion): string => {
  if (question.source === 'ocs') return answer
  return answer.replace(/\[图片(\d+)\]/g, (_marker, number) => {
    const url = question.imageUrls[Number(number) - 1]
    if (!url) throw new Error(`模型返回了不存在的图片编号：[图片${number}]`)
    return url
  })
}
