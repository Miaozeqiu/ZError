export const MODEL_REQUEST_CANCELLED_MESSAGE = '服务已停止，已取消所有模型请求'

export const createCancelledRequestError = (message = MODEL_REQUEST_CANCELLED_MESSAGE) => {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

/** 尽量从 Error / 字符串 / Tauri·fetch 抛出的普通对象里抽出可读报错 */
export const formatModelCallError = (error: unknown, fallback = '模型调用失败'): string => {
  if (error == null || error === '') return fallback
  if (typeof error === 'string') {
    const text = error.trim()
    return text || fallback
  }
  if (error instanceof Error) {
    const parts: string[] = []
    if (error.message?.trim()) parts.push(error.message.trim())
    if (error.name && error.name !== 'Error') parts.push(`[${error.name}]`)
    const cause = (error as Error & { cause?: unknown }).cause
    if (cause != null) {
      const causeText = formatModelCallError(cause, '')
      if (causeText) parts.push(`原因: ${causeText}`)
    }
    return parts.join(' ').trim() || fallback
  }
  if (typeof error === 'object') {
    const o = error as Record<string, unknown>
    const pickString = (...keys: string[]) => {
      for (const key of keys) {
        const v = o[key]
        if (typeof v === 'string' && v.trim()) return v.trim()
      }
      return ''
    }
    const nested =
      (o.error && typeof o.error === 'object' ? formatModelCallError(o.error, '') : '') ||
      (o.data && typeof o.data === 'object' ? formatModelCallError(o.data, '') : '') ||
      (o.body && typeof o.body === 'object' ? formatModelCallError(o.body, '') : '')
    const msg = pickString('message', 'msg', 'error', 'statusText', 'reason', 'detail', 'description') || nested
    const status = o.status ?? o.statusCode ?? o.code
    if (msg) {
      return status != null && status !== '' ? `HTTP ${status}: ${msg}` : msg
    }
    if (typeof status === 'number' || typeof status === 'string') {
      return `HTTP ${status}`
    }
    try {
      const json = JSON.stringify(error)
      if (json && json !== '{}' && json !== 'null') {
        return json.length > 800 ? `${json.slice(0, 800)}…` : json
      }
    } catch { /* ignore */ }
  }
  try {
    const text = String(error).trim()
    if (text && text !== '[object Object]') return text
  } catch { /* ignore */ }
  return fallback
}

export const isAbortLikeError = (error: unknown) => {
  if (error instanceof Error) {
    return error.name === 'AbortError'
      || error.name === 'TimeoutError'
      || /aborted|abort|cancelled|canceled|取消|超时|timeout/i.test(error.message)
  }
  return /aborted|abort|cancelled|canceled|取消|超时|timeout/i.test(formatModelCallError(error, ''))
}

export const isTimeoutLikeModelFailureText = (text: string) =>
  /timeout|超时|no new tokens|aborted|abort|cancelled|canceled|取消|服务已停止/i.test(text)


export const getModelResponseFailure = (value: unknown, depth = 0): string | null => {
  if (depth > 4 || value == null) return null
  if (value instanceof Error) return formatModelCallError(value)
  if (typeof value === 'string') {
    const clean = value.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '').trim()
    try {
      const error = getModelResponseFailure(JSON.parse(clean), depth + 1)
      if (error) return error
    } catch { /* plain text */ }
    if (!clean.startsWith('{') && clean.endsWith('}')) {
      let offset = clean.lastIndexOf('{')
      for (let attempt = 0; offset >= 0 && attempt < 32; attempt++) {
        try {
          const error = getModelResponseFailure(JSON.parse(clean.slice(offset)), depth + 1)
          if (error) return error
        } catch { /* try the enclosing JSON object */ }
        offset = clean.lastIndexOf('{', offset - 1)
      }
    }
    if (/^(?:错误[:：]|error[:：]|API\s*错误|所有AI均查询失败$|HTTP(?:\s+error!?\s*(?:status:)?\s*|\s+)[45]\d\d\b|Failed to fetch\b|fetch failed\b|NetworkError\b|TimeoutError[:：]|模型响应超时|模型调用失败[:：]|网络请求失败[:：]|服务已停止，已取消所有模型请求)/i.test(clean)) return clean
    const labels = /^\[[^\]\r\n]+\]\r?\n/gm
    if (labels.test(clean)) {
      const parts = clean.split(labels).filter(part => part.trim())
      if (parts.length && parts.every(part => getModelResponseFailure(part, depth + 1))) return clean
    }
    return null
  }
  if (typeof value !== 'object') return null
  const object = value as Record<string, unknown>
  const error = object.error
  const failed = (error != null && error !== false && error !== '')
    || object.success === false || object.ok === false || object.type === 'error'
    || ['status', 'statusCode', 'code'].some(key => {
      const value = object[key]
      if (value === 'error' || value === 'failed') return true
      if (typeof value !== 'number' && typeof value !== 'string') return false
      const code = Number(value)
      return Number.isFinite(code) && (code >= 400 || code < 0)
    })
  if (failed) {
    for (const candidate of [error, object]) {
      if (typeof candidate === 'string' && candidate.trim()) return candidate
      if (candidate && typeof candidate === 'object') {
        for (const key of ['message', 'msg', 'detail', 'error_description', 'reason']) {
          const message = (candidate as Record<string, unknown>)[key]
          if (typeof message === 'string' && message.trim()) return message
        }
      }
    }
    return '模型接口返回错误'
  }
  for (const key of ['answer', 'anwser', 'content']) {
    if (typeof object[key] === 'string') {
      const error = getModelResponseFailure(object[key], depth + 1)
      if (error) return error
    }
  }
  return null
}

export const assertSuccessfulModelResponse = (value: unknown): void => {
  const error = getModelResponseFailure(value)
  if (error) throw new Error(error)
}


/** Keep HTTP failure state even when custom adapters catch errors or return their body as text.
 * A later successful request clears it, preserving endpoint fallback (for example Anthropic 404).
 */
export const trackModelHttpOutcome = (fetchImpl: typeof fetch) => {
  let failure: string | null = null
  const trackedFetch: typeof fetch = async (input, init) => {
    try {
      const response = await fetchImpl(input, init)
      failure = response.ok ? null : `HTTP ${response.status}${response.statusText ? `: ${response.statusText}` : ''}`
      return response
    } catch (error) {
      failure = formatModelCallError(error, '网络请求失败')
      throw error
    }
  }
  return {
    fetch: trackedFetch,
    assertSuccess: () => { if (failure) throw new Error(failure) },
  }
}
