/** 把工具结果里的 data:image 抽出来给视觉模型，正文改成 [attached]。 */

const MAX_ATTACH = 4
const MAX_DATA_URL = 2_500_000
/** 嵌套字段（eval 的 src 等）不收整页级大图，避免把无关截图塞满。 */
const MAX_NESTED = 200_000
const IMAGE_KEYS = new Set([
  'image',
  'images',
  'src',
  'screenshot',
  'captcha',
  'captchaImage',
  'data',
  'imageUrl',
])

export const VISION_SMALL_CHARS = 80_000

export const visionDetailOf = (url: string): 'high' | 'low' => (
  String(url || '').length < VISION_SMALL_CHARS ? 'high' : 'low'
)

/**
 * 只有「小图 + 整页」两张以上才是验证码流程（captchaImages 抠图 + 整页）。
 * 单独一张整页截图即使压得很小，也不能说成验证码，否则模型会在播放页找验证码。
 */
export const visionAttachCaption = (images: string[]) => {
  const small = images.filter((url) => url.length < VISION_SMALL_CHARS).length
  if (images.length >= 2 && small >= 1 && small < images.length) {
    return '较小的图是验证码原图，请先认那张上的字符（几位以输入框 maxlength 为准）。后面的大图是整页，只作位置参考，不要只靠它认字。'
  }
  return '上面是刚才工具返回的图（整页截图或页内图片），按工具结果里的说明看。'
}

export const visionAttachParts = (images: string[]) => [
  ...images.map((url) => ({
    type: 'image_url' as const,
    image_url: { url, detail: visionDetailOf(url) },
  })),
  { type: 'text' as const, text: visionAttachCaption(images) },
]

const pushImage = (images: string[], seen: Set<string>, url: string, nested: boolean) => {
  if (!url.startsWith('data:image/') || url.length < 40) return false
  if (url.length > MAX_DATA_URL) return false
  if (nested && url.length > MAX_NESTED) return false
  if (seen.has(url) || images.length >= MAX_ATTACH) return false
  seen.add(url)
  images.push(url)
  return true
}

const isDirectImageKey = (key: string) => (
  key === 'image' || key === 'images' || key === 'screenshot' || key === 'captchaImage'
)

const visit = (
  value: unknown,
  depth: number,
  key: string,
  images: string[],
  seen: Set<string>,
): unknown => {
  if (typeof value === 'string') {
    if (value.startsWith('data:image/') && IMAGE_KEYS.has(key)) {
      const nested = !(depth === 1 && isDirectImageKey(key))
      if (pushImage(images, seen, value, nested)) return '[attached]'
    }
    return value
  }
  if (Array.isArray(value)) {
    const childKey = key === 'images' ? 'image' : key
    return value.map((item) => visit(item, depth + 1, childKey, images, seen))
  }
  if (value && typeof value === 'object') {
    const rec = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [nextKey, nextVal] of Object.entries(rec)) {
      out[nextKey] = visit(nextVal, depth + 1, nextKey, images, seen)
    }
    if (depth === 0 && typeof rec.image === 'string' && rec.image.startsWith('data:image/')) {
      out.bytes = rec.image.length
    }
    return out
  }
  return value
}

export const takeToolImages = (raw: string) => {
  try {
    const data = JSON.parse(raw)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return { text: raw, images: [] as string[] }
    const images: string[] = []
    const seen = new Set<string>()
    const next = visit(data, 0, '', images, seen)
    if (!images.length) return { text: raw, images: [] as string[] }
    images.sort((left, right) => left.length - right.length)
    return { text: JSON.stringify(next), images }
  } catch {
    return { text: raw, images: [] as string[] }
  }
}
