export type PlaceholderMultimodalPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string; detail: 'high' } }

const placeholderPattern = () => /\[图片(\d+)\]/g

/**
 * OCS >= 5.1.0 图片题优化：题干/选项中的图片被替换为 [图片N] 占位符，
 * images 数组与占位符编号严格同序（从 1 开始）。这里按占位符把文本拆成多模态内容，
 * 图片直接使用 OCS 传来的 base64，无需再下载 URL（规避防盗链）。
 */
export const buildMultimodalContentFromPlaceholders = (
  text: string,
  images: string[]
): PlaceholderMultimodalPart[] => {
  const parts: PlaceholderMultimodalPart[] = []
  const pushText = (value: string) => {
    if (!value) return
    const last = parts[parts.length - 1]
    if (last?.type === 'text') {
      last.text += value
    } else {
      parts.push({ type: 'text', text: value })
    }
  }
  const re = placeholderPattern()
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    pushText(text.slice(lastIndex, match.index))

    const image = images[Number(match[1]) - 1]
    if (image) {
      parts.push({ type: 'image_url', image_url: { url: image, detail: 'high' } })
    } else {
      // 编号越界时保留占位符原文，降级不中断
      pushText(match[0])
    }
    lastIndex = match.index + match[0].length
  }

  pushText(text.slice(lastIndex))

  return parts.length ? parts : [{ type: 'text', text }]
}

/** 用占位符文本 + base64 数组生成展示 HTML（图片直接内联，不走 URL 下载） */
export const buildHtmlFromPlaceholders = (
  title: string,
  options: string,
  images: string[]
): string => {
  const text = title + (options ? '\n\n选项：\n' + options : '')
  const re = placeholderPattern()
  let html = ''
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null) {
    html += text.slice(lastIndex, match.index)
    const image = images[Number(match[1]) - 1]
    html += image
      ? `<img src="${image}" style="max-width:100%;vertical-align:middle;background:#fff;display:inline-block;" />`
      : match[0]
    lastIndex = match.index + match[0].length
  }

  html += text.slice(lastIndex)
  return html.replace(/\n/g, '<br/>')
}
