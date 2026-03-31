export interface QuestionImagePart {
  type: 'text' | 'image'
  text?: string
  url?: string
}

/**
 * 严格正则：
 * 1. 基础路径不允许包含 ? 和 =
 * 2. 如果要匹配参数，必须是以 ? 开头且内部包含 = 的完整结构
 */
export const createUrlQuestionRegex = () =>
  /https?:\/\/[A-Za-z0-9\-._~:/#@!$&*+,;%]+(?:\?[A-Za-z0-9\-._~:/#@!$&*+,;%]*=[A-Za-z0-9\-._~:/#@!$&*+,;=%]*)?/g

export const normalizeQuestionUrl = (rawUrl: string): string => {
  return rawUrl
    .trim()
    // 由于我们排除了各种干扰，这里只需简单地把末尾可能误吞的句号/逗号等标点剔除即可
    .replace(/[.,;!?]+$/, '')
}

export const extractQuestionImageUrls = (text: string): string[] => {
  return Array.from(
    new Set(
      Array.from((text || '').matchAll(createUrlQuestionRegex())).map(match =>
        normalizeQuestionUrl(match[0])
      )
    )
  )
}

export const splitQuestionImageParts = (text: string): QuestionImagePart[] => {
  const sourceText = text || ''
  const parts: QuestionImagePart[] = []
  const regex = createUrlQuestionRegex()
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = regex.exec(sourceText)) !== null) {
    const offset = match.index
    const rawUrl = match[0]
    const normalizedUrl = normalizeQuestionUrl(rawUrl)

    if (offset > lastIndex) {
      parts.push({ type: 'text', text: sourceText.slice(lastIndex, offset) })
    }

    parts.push({ type: 'image', url: normalizedUrl })
    
    // lastIndex 步进到 normalizedUrl 的末尾，未被正则匹配的无效 ? 等字符自然作为下一个 text 节点
    lastIndex = offset + normalizedUrl.length
    regex.lastIndex = lastIndex 
  }

  if (lastIndex < sourceText.length) {
    parts.push({ type: 'text', text: sourceText.slice(lastIndex) })
  }

  return parts.length ? parts : [{ type: 'text', text: sourceText }]
}

let tauriInvoke: typeof import('@tauri-apps/api/core').invoke | null = null

export const fetchQuestionImageBase64 = async (url: string): Promise<string> => {
  try {
    if (!tauriInvoke) {
      const core = await import('@tauri-apps/api/core')
      tauriInvoke = core.invoke
    }
    return await tauriInvoke<string>('fetch_image_as_base64', { url })
  } catch {
    return ''
  }
}