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
