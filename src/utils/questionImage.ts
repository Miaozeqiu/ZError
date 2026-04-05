import { shallowRef } from 'vue'
import { fetchRemoteModelsCatalog } from '../services/modelConfig'

export interface QuestionImagePart {
  type: 'text' | 'image'
  text?: string
  url?: string
}

export interface QuestionImageMatch {
  rawUrl: string
  normalizedUrl: string
  start: number
  end: number
  trailingText: string
}

interface CreateMatchesFromRegexOptions {
  regex: RegExp
  normalizeUrl: (rawUrl: string) => string
}

interface QuestionImageAlgorithmRuntime {
  ensureGlobalRegex: (regex: RegExp) => RegExp
  createMatchesFromRegex: (text: string, options: CreateMatchesFromRegexOptions) => QuestionImageMatch[]
  fallbackFindQuestionImageMatches: (text: string) => QuestionImageMatch[]
  fallbackExtractQuestionImageUrls: (text: string) => string[]
  fallbackSplitQuestionImageParts: (text: string) => QuestionImagePart[]
}

interface QuestionImageAlgorithm {
  findQuestionImageMatches: (text: string, runtime: QuestionImageAlgorithmRuntime) => QuestionImageMatch[]
  extractQuestionImageUrls?: (text: string, runtime: QuestionImageAlgorithmRuntime) => string[]
  splitQuestionImageParts?: (text: string, runtime: QuestionImageAlgorithmRuntime) => QuestionImagePart[]
}

interface QuestionImageAlgorithmMeta {
  source: 'local' | 'remote'
  code: string
}

const ensureGlobalRegex = (regex: RegExp): RegExp => regex.global ? regex : new RegExp(regex.source, `${regex.flags}g`)

const fallbackCreateUrlQuestionRegex = () =>
  /https?:\/\/[A-Za-z0-9\-._~:/#@!$&*+,;%]+(?:\?[A-Za-z0-9\-._~:/#@!$&*+,;%]*=[A-Za-z0-9\-._~:/#@!$&*+,;=%]*)?/g

const fallbackNormalizeQuestionUrl = (rawUrl: string): string => String(rawUrl || '')
  .trim()
  .replace(/[.,;!?]+$/, '')

const localQuestionImageAlgorithmCode = `({
  findQuestionImageMatches: (text, runtime) =>
    runtime.createMatchesFromRegex(text, {
      regex: /https?:\/\/[A-Za-z0-9\-._~:/#@!$&*+,;%]+(?:\?[A-Za-z0-9\-._~:/#@!$&*+,;%]*=[A-Za-z0-9\-._~:/#@!$&*+,;=%]*)?/g,
      normalizeUrl: (rawUrl) => String(rawUrl || '')
        .trim()
        .replace(/[.,;!?]+$/, ''),
    }),
})`

const localQuestionImageAlgorithm: QuestionImageAlgorithm = {
  findQuestionImageMatches: (text, runtime) => runtime.createMatchesFromRegex(text, {
    regex: fallbackCreateUrlQuestionRegex(),
    normalizeUrl: fallbackNormalizeQuestionUrl,
  }),
}

const normalizeQuestionImageUrls = (value: unknown): string[] => {
  if (!Array.isArray(value)) return []

  return [...new Set(value
    .map(item => typeof item === 'string' ? item.trim() : '')
    .filter(Boolean))]
}

const normalizeQuestionImagePart = (candidate: unknown): QuestionImagePart | null => {
  if (typeof candidate === 'string') {
    return { type: 'text', text: candidate }
  }

  if (!candidate || typeof candidate !== 'object') return null

  const record = candidate as Record<string, unknown>
  const type = record.type

  if (type === 'image' || (typeof record.url === 'string' && !record.type)) {
    const url = typeof record.url === 'string' ? record.url.trim() : ''
    return url ? { type: 'image', url } : null
  }

  if (type === 'text' || typeof record.text === 'string') {
    return { type: 'text', text: String(record.text ?? '') }
  }

  return null
}

const normalizeQuestionImageParts = (value: unknown, sourceText: string): QuestionImagePart[] => {
  if (!Array.isArray(value)) {
    return [{ type: 'text', text: sourceText }]
  }

  const normalizedParts = value
    .map(normalizeQuestionImagePart)
    .filter((part): part is QuestionImagePart => part !== null)

  return normalizedParts.length ? normalizedParts : [{ type: 'text', text: sourceText }]
}

const normalizeQuestionImageMatch = (candidate: unknown, sourceText: string): QuestionImageMatch | null => {
  if (!candidate || typeof candidate !== 'object') return null

  const record = candidate as Record<string, unknown>
  const start = Number(record.start ?? record.index)
  const rawUrl = typeof record.rawUrl === 'string'
    ? record.rawUrl
    : typeof record.matchedText === 'string'
      ? record.matchedText
      : ''
  const normalizedUrl = typeof record.normalizedUrl === 'string'
    ? record.normalizedUrl.trim()
    : typeof record.url === 'string'
      ? record.url.trim()
      : ''
  const fallbackEnd = Number.isFinite(start) && rawUrl ? start + rawUrl.length : NaN
  const end = Number(record.end ?? record.endIndex ?? fallbackEnd)

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > sourceText.length || !normalizedUrl) {
    return null
  }

  const resolvedRawUrl = rawUrl || sourceText.slice(start, end)
  const trailingText = typeof record.trailingText === 'string'
    ? record.trailingText
    : resolvedRawUrl.startsWith(normalizedUrl)
      ? resolvedRawUrl.slice(normalizedUrl.length)
      : ''

  return {
    rawUrl: resolvedRawUrl,
    normalizedUrl,
    start,
    end,
    trailingText,
  }
}

const normalizeQuestionImageMatches = (value: unknown, sourceText: string): QuestionImageMatch[] => {
  if (!Array.isArray(value)) return []

  const normalizedMatches = value
    .map(match => normalizeQuestionImageMatch(match, sourceText))
    .filter((match): match is QuestionImageMatch => match !== null)
    .sort((a, b) => a.start - b.start || a.end - b.end)

  const result: QuestionImageMatch[] = []
  let lastEnd = -1

  for (const match of normalizedMatches) {
    if (match.start < lastEnd) continue
    result.push(match)
    lastEnd = match.end
  }

  return result
}

const createMatchesFromRegex = (
  text: string,
  options: CreateMatchesFromRegexOptions,
): QuestionImageMatch[] => {
  const sourceText = text || ''
  const regex = ensureGlobalRegex(options.regex)
  const matches: QuestionImageMatch[] = []
  let match: RegExpExecArray | null

  while ((match = regex.exec(sourceText)) !== null) {
    const start = match.index
    const rawUrl = match[0]
    const end = start + rawUrl.length
    const normalizedUrl = String(options.normalizeUrl(rawUrl) ?? '').trim()

    if (normalizedUrl) {
      matches.push({
        rawUrl,
        normalizedUrl,
        start,
        end,
        trailingText: rawUrl.startsWith(normalizedUrl) ? rawUrl.slice(normalizedUrl.length) : '',
      })
    }

    if (regex.lastIndex <= start) {
      regex.lastIndex = end
    }
  }

  return matches
}

const buildQuestionImagePartsFromMatches = (text: string, matches: QuestionImageMatch[]): QuestionImagePart[] => {
  const sourceText = text || ''
  const parts: QuestionImagePart[] = []
  let lastIndex = 0

  for (const match of matches) {
    if (match.start > lastIndex) {
      parts.push({ type: 'text', text: sourceText.slice(lastIndex, match.start) })
    }

    parts.push({ type: 'image', url: match.normalizedUrl })
    if (match.trailingText) {
      parts.push({ type: 'text', text: match.trailingText })
    }
    lastIndex = match.end
  }

  if (lastIndex < sourceText.length) {
    parts.push({ type: 'text', text: sourceText.slice(lastIndex) })
  }

  return parts.length ? parts : [{ type: 'text', text: sourceText }]
}

const fallbackFindQuestionImageMatches = (text: string): QuestionImageMatch[] => createMatchesFromRegex(
  text,
  {
    regex: fallbackCreateUrlQuestionRegex(),
    normalizeUrl: fallbackNormalizeQuestionUrl,
  },
)

const fallbackExtractQuestionImageUrls = (text: string): string[] => [...new Set(
  fallbackFindQuestionImageMatches(text)
    .map(match => match.normalizedUrl)
    .filter(Boolean),
)]

const fallbackSplitQuestionImageParts = (text: string): QuestionImagePart[] => buildQuestionImagePartsFromMatches(
  text,
  fallbackFindQuestionImageMatches(text),
)

const questionImageAlgorithmRuntime: QuestionImageAlgorithmRuntime = {
  ensureGlobalRegex,
  createMatchesFromRegex,
  fallbackFindQuestionImageMatches,
  fallbackExtractQuestionImageUrls,
  fallbackSplitQuestionImageParts,
}

const REMOTE_QUESTION_IMAGE_ALGORITHM_RETRY_COOLDOWN_MS = 30 * 1000

const activeQuestionImageAlgorithm = shallowRef<QuestionImageAlgorithm>(localQuestionImageAlgorithm)
const activeQuestionImageAlgorithmMeta = shallowRef<QuestionImageAlgorithmMeta>({
  source: 'local',
  code: localQuestionImageAlgorithmCode,
})
const questionImageAlgorithmVersion = shallowRef(0)
let pendingRemoteQuestionImageAlgorithmRequest: Promise<void> | null = null
let remoteQuestionImageAlgorithmLoaded = false
let remoteQuestionImageAlgorithmLastAttemptAt = 0
let loggedQuestionImageAlgorithmSignature = ''

const logActiveQuestionImageAlgorithm = () => {
  const meta = activeQuestionImageAlgorithmMeta.value
  const signature = `${questionImageAlgorithmVersion.value}:${meta.source}:${meta.code}`
  if (signature === loggedQuestionImageAlgorithmSignature) return

  loggedQuestionImageAlgorithmSignature = signature
  console.info('[questionImage] 当前使用算法:', meta.source, '\n', meta.code)
}

const normalizeCompiledQuestionImageAlgorithm = (candidate: unknown): QuestionImageAlgorithm | null => {
  if (!candidate || typeof candidate !== 'object') return null

  const record = candidate as Record<string, unknown>
  if (typeof record.findQuestionImageMatches !== 'function') {
    return null
  }

  const findQuestionImageMatches = record.findQuestionImageMatches as (text: string, runtime: QuestionImageAlgorithmRuntime) => QuestionImageMatch[]
  const extractQuestionImageUrls = typeof record.extractQuestionImageUrls === 'function'
    ? record.extractQuestionImageUrls as (text: string, runtime: QuestionImageAlgorithmRuntime) => string[]
    : null
  const splitQuestionImageParts = typeof record.splitQuestionImageParts === 'function'
    ? record.splitQuestionImageParts as (text: string, runtime: QuestionImageAlgorithmRuntime) => QuestionImagePart[]
    : null

  try {
    const previewText = '题目 https://example.com/demo.png) 结束'
    const previewMatches = normalizeQuestionImageMatches(
      findQuestionImageMatches(previewText, questionImageAlgorithmRuntime),
      previewText,
    )
    if (!previewMatches.length) return null

    return {
      findQuestionImageMatches: (text: string, runtime: QuestionImageAlgorithmRuntime) => normalizeQuestionImageMatches(
        findQuestionImageMatches(String(text || ''), runtime),
        String(text || ''),
      ),
      extractQuestionImageUrls: extractQuestionImageUrls
        ? (text: string, runtime: QuestionImageAlgorithmRuntime) => normalizeQuestionImageUrls(
            extractQuestionImageUrls(String(text || ''), runtime),
          )
        : undefined,
      splitQuestionImageParts: splitQuestionImageParts
        ? (text: string, runtime: QuestionImageAlgorithmRuntime) => normalizeQuestionImageParts(
            splitQuestionImageParts(String(text || ''), runtime),
            String(text || ''),
          )
        : undefined,
    }
  } catch {
    return null
  }
}

const compileQuestionImageAlgorithm = (code: string): QuestionImageAlgorithm | null => {
  const trimmedCode = code.trim().replace(/^export\s+default\s+/, '')
  if (!trimmedCode) return null

  try {
    const executableCode = /^(\{|\()/.test(trimmedCode)
      ? `module.exports = (${trimmedCode});`
      : trimmedCode

    const resolved = new Function('module', 'exports', 'runtime', `
      "use strict";
      ${executableCode}
      return typeof createQuestionImageAlgorithm === 'function'
        ? createQuestionImageAlgorithm(runtime)
        : (module.exports.default ?? module.exports);
    `)({ exports: {} }, {}, questionImageAlgorithmRuntime)

    return normalizeCompiledQuestionImageAlgorithm(resolved)
  } catch (error) {
    console.warn('编译云控图片链接算法失败，继续使用本地算法:', error)
    return null
  }
}

const ensureRemoteQuestionImageAlgorithm = () => {
  if (remoteQuestionImageAlgorithmLoaded) return Promise.resolve()
  if (pendingRemoteQuestionImageAlgorithmRequest) return pendingRemoteQuestionImageAlgorithmRequest

  const now = Date.now()
  if (now - remoteQuestionImageAlgorithmLastAttemptAt < REMOTE_QUESTION_IMAGE_ALGORITHM_RETRY_COOLDOWN_MS) {
    return Promise.resolve()
  }
  remoteQuestionImageAlgorithmLastAttemptAt = now

  pendingRemoteQuestionImageAlgorithmRequest = fetchRemoteModelsCatalog()
    .then((catalog) => {
      remoteQuestionImageAlgorithmLoaded = true
      const compiledAlgorithm = catalog.questionImageAlgorithm
        ? compileQuestionImageAlgorithm(catalog.questionImageAlgorithm)
        : null

      if (!compiledAlgorithm) return
      activeQuestionImageAlgorithm.value = compiledAlgorithm
      activeQuestionImageAlgorithmMeta.value = {
        source: 'remote',
        code: catalog.questionImageAlgorithm || '',
      }
      questionImageAlgorithmVersion.value += 1
    })
    .catch(() => undefined)
    .finally(() => {
      pendingRemoteQuestionImageAlgorithmRequest = null
    })

  return pendingRemoteQuestionImageAlgorithmRequest
}

const getQuestionImageAlgorithm = (): QuestionImageAlgorithm => {
  void questionImageAlgorithmVersion.value
  void ensureRemoteQuestionImageAlgorithm()
  logActiveQuestionImageAlgorithm()
  return activeQuestionImageAlgorithm.value
}

const findQuestionImageMatchesByAlgorithm = (text: string, algorithm: QuestionImageAlgorithm): QuestionImageMatch[] => {
  const sourceText = String(text || '')

  try {
    return algorithm.findQuestionImageMatches(sourceText, questionImageAlgorithmRuntime)
  } catch (error) {
    console.warn('执行云控图片匹配算法失败，回退到默认匹配逻辑:', error)
    return fallbackFindQuestionImageMatches(sourceText)
  }
}

const extractQuestionImageUrlsByAlgorithm = (text: string, algorithm: QuestionImageAlgorithm): string[] => {
  const sourceText = String(text || '')

  if (algorithm.extractQuestionImageUrls) {
    try {
      const urls = normalizeQuestionImageUrls(algorithm.extractQuestionImageUrls(sourceText, questionImageAlgorithmRuntime))
      if (urls.length) return urls
    } catch (error) {
      console.warn('执行云控图片 URL 提取算法失败，回退到默认提取逻辑:', error)
    }
  }

  return [...new Set(findQuestionImageMatchesByAlgorithm(sourceText, algorithm).map(match => match.normalizedUrl).filter(Boolean))]
}

const splitQuestionImagePartsByAlgorithm = (text: string, algorithm: QuestionImageAlgorithm): QuestionImagePart[] => {
  const sourceText = String(text || '')

  if (algorithm.splitQuestionImageParts) {
    try {
      const parts = normalizeQuestionImageParts(algorithm.splitQuestionImageParts(sourceText, questionImageAlgorithmRuntime), sourceText)
      if (parts.length) return parts
    } catch (error) {
      console.warn('执行云控图片分段算法失败，回退到默认分段逻辑:', error)
    }
  }

  return buildQuestionImagePartsFromMatches(sourceText, findQuestionImageMatchesByAlgorithm(sourceText, algorithm))
}

export const findQuestionImageMatches = (text: string): QuestionImageMatch[] => findQuestionImageMatchesByAlgorithm(
  text,
  getQuestionImageAlgorithm(),
)

export const extractQuestionImageUrls = (text: string): string[] => extractQuestionImageUrlsByAlgorithm(
  text,
  getQuestionImageAlgorithm(),
)

export const splitQuestionImageParts = (text: string): QuestionImagePart[] => splitQuestionImagePartsByAlgorithm(
  text,
  getQuestionImageAlgorithm(),
)

let tauriInvoke: typeof import('@tauri-apps/api/core').invoke | null = null
const darkModeInvertSampleSize = 32
const darkModeInvertVisibleAlphaThreshold = 10
const darkModeInvertTransparentAlphaThreshold = 245
const darkModeInvertBrightnessThreshold = 110
const darkModeInvertMinTransparentRatio = 0.1
const darkModeInvertMinDarkRatio = 0.6

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

export const shouldInvertTransparentDarkImage = async (src: string): Promise<boolean> => {
  if (!src.startsWith('data:image/')) return false

  return await new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = darkModeInvertSampleSize
        canvas.height = darkModeInvertSampleSize
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(false)
          return
        }

        ctx.imageSmoothingEnabled = false
        ctx.clearRect(0, 0, darkModeInvertSampleSize, darkModeInvertSampleSize)
        ctx.drawImage(img, 0, 0, darkModeInvertSampleSize, darkModeInvertSampleSize)

        const data = ctx.getImageData(0, 0, darkModeInvertSampleSize, darkModeInvertSampleSize).data
        let visibleWeight = 0
        let darkWeight = 0
        let transparentPixels = 0

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          const a = data[i + 3]

          if (a < darkModeInvertTransparentAlphaThreshold) {
            transparentPixels++
          }

          if (a < darkModeInvertVisibleAlphaThreshold) {
            continue
          }

          const alphaWeight = a / 255
          const bright = 0.2126 * r + 0.7152 * g + 0.0722 * b
          visibleWeight += alphaWeight

          if (bright <= darkModeInvertBrightnessThreshold) {
            darkWeight += alphaWeight
          }
        }

        if (visibleWeight <= 0) {
          resolve(false)
          return
        }

        const totalPixels = darkModeInvertSampleSize * darkModeInvertSampleSize
        const transparentRatio = transparentPixels / totalPixels
        const darkRatio = darkWeight / visibleWeight
        resolve(
          transparentRatio >= darkModeInvertMinTransparentRatio &&
          darkRatio >= darkModeInvertMinDarkRatio,
        )
      } catch {
        resolve(false)
      }
    }
    img.onerror = () => resolve(false)
    img.src = src
  })
}
