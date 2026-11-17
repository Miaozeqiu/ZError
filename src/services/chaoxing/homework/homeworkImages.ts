import { fetchQuestionImageBase64 } from '../../../utils/question/questionImage'

const cache = new Map<string, string>()
const pending = new Map<string, Promise<string>>()

export const normalizeHwImageUrl = (src?: string) => {
  let value = String(src || '').trim()
  if (!value) return ''
  if (value.startsWith('data:')) return value
  if (value.startsWith('//')) value = `https:${value}`
  if (value.startsWith('http://')) value = `https://${value.slice(7)}`
  if (value.startsWith('/')) value = `https://mooc1.chaoxing.com${value}`
  return value
}

export const cachedHwImage = (src?: string) => {
  const url = normalizeHwImageUrl(src)
  if (!url) return ''
  if (url.startsWith('data:')) return url
  return cache.get(url) || ''
}

export const resolveHwImage = async (src?: string) => {
  const url = normalizeHwImageUrl(src)
  if (!url) return ''
  if (url.startsWith('data:')) return url
  const hit = cache.get(url)
  if (hit) return hit
  const running = pending.get(url)
  if (running) return running
  const job = fetchQuestionImageBase64(url).then((data) => {
    if (data.startsWith('data:image')) cache.set(url, data)
    pending.delete(url)
    return cache.get(url) || ''
  }).catch(() => {
    pending.delete(url)
    return ''
  })
  pending.set(url, job)
  return job
}

type HwQuestion = {
  images?: string[]
  options?: Array<{ image?: string; images?: string[] }>
}

const collectRemoteUrls = (questions: HwQuestion[]) => {
  const stems: string[] = []
  const others: string[] = []
  const push = (list: string[], src?: string) => {
    const url = normalizeHwImageUrl(src)
    if (!url || url.startsWith('data:') || list.includes(url)) return
    list.push(url)
  }
  for (const item of questions) {
    for (const src of item.images || []) push(stems, src)
    for (const opt of item.options || []) {
      push(others, opt.image)
      for (const src of opt.images || []) push(others, src)
    }
  }
  return [...stems, ...others.filter((url) => !stems.includes(url))]
}

export const hydrateHomeworkImages = async <T extends HwQuestion>(
  questions: T[],
  limit = 24,
) => {
  const urls = collectRemoteUrls(questions).slice(0, limit)
  await Promise.all(urls.map((url) => resolveHwImage(url)))
  const swap = (src?: string) => cachedHwImage(src) || normalizeHwImageUrl(src)
  return questions.map((item) => ({
    ...item,
    images: (item.images || []).map(swap).filter(Boolean),
    options: (item.options || []).map((opt) => {
      const images = (opt.images || []).map(swap).filter(Boolean)
      return {
        ...opt,
        image: swap(opt.image) || images[0] || '',
        images,
      }
    }),
  }))
}
