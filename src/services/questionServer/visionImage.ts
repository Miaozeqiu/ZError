import { fetchQuestionImageBase64, findQuestionImageMatches, extractQuestionImageUrls } from '../../utils/question/questionImage'

export const DEFAULT_VISION_IMAGE_MIN_SIZE = 32


export const applyWhiteBackgroundToDataUrl = async (dataUrl: string): Promise<string> => {
  if (!dataUrl.startsWith('data:image/')) return dataUrl

  return await new Promise((resolve) => {

    const img = new Image()
    img.onload = () => {
      try {
        const width = img.naturalWidth || img.width
        const height = img.naturalHeight || img.height
        if (!width || !height) {
          resolve(dataUrl)
          return
        }

        const canvas = document.createElement('canvas')
        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(dataUrl)
          return
        }

        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, width, height)
        ctx.drawImage(img, 0, 0, width, height)
        resolve(canvas.toDataURL('image/png'))
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

export const ensureDataUrlMinimumSize = async (dataUrl: string, minimumSize = 32): Promise<string> => {
  if (!dataUrl.startsWith('data:image/')) return dataUrl

  return await new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const width = img.naturalWidth || img.width
        const height = img.naturalHeight || img.height
        if (!width || !height || (width >= minimumSize && height >= minimumSize)) {
          resolve(dataUrl)
          return
        }

        const scale = Math.max(minimumSize / width, minimumSize / height, 1)
        const targetWidth = Math.max(Math.ceil(width * scale), minimumSize)
        const targetHeight = Math.max(Math.ceil(height * scale), minimumSize)

        const canvas = document.createElement('canvas')
        canvas.width = targetWidth
        canvas.height = targetHeight
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(dataUrl)
          return
        }

        ctx.fillStyle = '#ffffff'
        ctx.fillRect(0, 0, targetWidth, targetHeight)
        ctx.imageSmoothingEnabled = true
        ctx.drawImage(img, 0, 0, targetWidth, targetHeight)
        resolve(canvas.toDataURL('image/png'))
      } catch {
        resolve(dataUrl)
      }
    }
    img.onerror = () => resolve(dataUrl)
    img.src = dataUrl
  })
}

export const extractVisionImageSizeError = (error: unknown): number | null => {
  const message = error instanceof Error ? error.message : String(error || '')
  if (!/(code"?\s*:\s*20015|height\(\d+\)\s*or\s*width\(\d+\))/i.test(message)) {
    return null
  }

  const match = message.match(/height\((\d+)\)\s*or\s*width\((\d+)\)/i)
  if (!match) return 32

  const height = Number(match[1])
  const width = Number(match[2])
  if (!Number.isFinite(height) || !Number.isFinite(width)) return 32

  return Math.max(DEFAULT_VISION_IMAGE_MIN_SIZE, Math.min(Math.max(height, width) + 16, 96))
}


export const upscaleMultimodalContentImages = async (content: any[], minimumSize: number): Promise<{ content: any[], changed: boolean }> => {
  let changed = false
  const nextContent = await Promise.all(content.map(async (part) => {
    if (part?.type !== 'image_url') return part

    const originalUrl = part?.image_url?.url
    if (typeof originalUrl !== 'string' || !originalUrl.startsWith('data:image/')) return part

    const resizedUrl = await ensureDataUrlMinimumSize(originalUrl, minimumSize)
    if (resizedUrl === originalUrl) return part

    changed = true
    return {
      ...part,
      image_url: {
        ...part.image_url,
        url: resizedUrl
      }
    }
  }))

  return { content: nextContent, changed }
}

export const prepareVisionRequestContent = async (content: any[], minimumSize = DEFAULT_VISION_IMAGE_MIN_SIZE): Promise<any[]> => {
  if (!Array.isArray(content) || content.length === 0) return content

  const { content: normalizedContent, changed } = await upscaleMultimodalContentImages(content, minimumSize)
  if (changed) {
    console.warn(`发送视觉请求前检测到图片尺寸不足，已自动放大到至少 ${minimumSize}px`)
  }

  return normalizedContent
}


export const executeVisionModelWithAutoUpscale = async (processModel: any, input: any, config: any, requestFetch?: typeof fetch, abortSignal?: AbortSignal) => {


  try {
    return await processModel(input, config, requestFetch, abortSignal)
  } catch (error) {
    const minimumSize = extractVisionImageSizeError(error)
    const originalContent = input?.messages?.[0]?.content
    if (!minimumSize || !Array.isArray(originalContent)) {
      throw error
    }

    const { content, changed } = await upscaleMultimodalContentImages(originalContent, minimumSize)
    if (!changed) {
      throw error
    }

    console.warn(`视觉模型图片尺寸不足，已自动放大到至少 ${minimumSize}px 后重试一次`)
    return await processModel({
      ...input,
      messages: [{
        ...input.messages[0],
        content
      }]
    }, config, requestFetch, abortSignal)
  }
}

export const buildQuestionImageMap = async (text: string): Promise<Map<string, string>> => {

  const urls = extractQuestionImageUrls(text)
  const base64Map = new Map<string, string>()


  await Promise.all(urls.map(async (url) => {
    const b64 = await fetchQuestionImageBase64(url)
    if (!b64) {
      base64Map.set(url, '')
      return
    }

    const normalizedImage = await applyWhiteBackgroundToDataUrl(b64)
    base64Map.set(url, await ensureDataUrlMinimumSize(normalizedImage, 32))
  }))


  return base64Map
}

// 将文本中所有 URL 通过后端转为 base64，返回替换后的 HTML 字符串
export const buildRenderedHtml = async (title: string, options: string): Promise<string> => {
  const text = title + (options ? '\n\n选项：\n' + options : '')
  const matches = findQuestionImageMatches(text)
  const base64Map = await buildQuestionImageMap(text)

  let html = ''
  let lastIndex = 0

  for (const match of matches) {
    html += text.slice(lastIndex, match.start)
    const b64 = base64Map.get(match.normalizedUrl)
    html += b64
      ? `<img src="${b64}" style="max-width:100%;vertical-align:middle;background:#fff;display:inline-block;" />${match.trailingText}`
      : `[图片: ${match.normalizedUrl}]${match.trailingText}`
    lastIndex = match.end
  }

  html += text.slice(lastIndex)
  return html.replace(/\n/g, '<br/>')
}

export const renderUrlsAsHtml = (text: string): string => {
  const matches = findQuestionImageMatches(text)
  let html = ''
  let lastIndex = 0

  for (const match of matches) {
    html += text.slice(lastIndex, match.start)
    html += `<img src="${match.normalizedUrl}" style="max-width:100%;vertical-align:middle;" />${match.trailingText}`
    lastIndex = match.end
  }

  return html + text.slice(lastIndex)
}

export const buildMultimodalContent = async (text: string): Promise<any[]> => {
  const matches = findQuestionImageMatches(text)
  const base64Map = await buildQuestionImageMap(text)
  const failedUrls: string[] = []
  const parts: any[] = []
  let lastIndex = 0

  for (const match of matches) {
    const before = text.slice(lastIndex, match.start)
    if (before) parts.push({ type: 'text', text: before })

    const imageBase64 = base64Map.get(match.normalizedUrl)
    if (imageBase64) {
      parts.push({ type: 'image_url', image_url: { url: imageBase64, detail: 'high' } })
    } else {
      failedUrls.push(match.normalizedUrl)
    }

    if (match.trailingText) parts.push({ type: 'text', text: match.trailingText })
    lastIndex = match.end
  }

  const tail = text.slice(lastIndex)
  if (tail) parts.push({ type: 'text', text: tail })

  if (failedUrls.length > 0) {
    throw new Error(`以下图片本地下载失败，无法转为 base64：${failedUrls.join('，')}`)
  }

  return parts
}



