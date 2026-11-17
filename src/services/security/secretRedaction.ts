// Values discovered by the model live here only for synchronous UI redaction in
// this process. Durable storage and subsequent request redaction also run natively.
const known = new Map<string, string>()
const tokenPattern = /\{\{secret:[^{}]+\}\}/g
export const rememberRedaction = (value: string, reference: string) => {
  if (value && value !== reference && !/^\{\{secret:/.test(value)) known.set(value, reference)
}
export const redactText = (text: string): string => {
  if (!known.size) return text
  const entries = [...known].sort((a, b) => b[0].length - a[0].length)
  const matcher = new RegExp(entries.map(([value]) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g')
  const replace = (part: string) => part.replace(matcher, (value, index: number) => {
    if (value.length <= 3 && (/[A-Za-z0-9_]/.test(part[index - 1] || '') || /[A-Za-z0-9_]/.test(part[index + value.length] || ''))) return value
    return known.get(value)!
  })
  let result = '', start = 0
  for (const match of text.matchAll(tokenPattern)) {
    result += replace(text.slice(start, match.index)) + match[0]; start = match.index! + match[0].length
  }
  return result + replace(text.slice(start))
}
export const redactObject = <T>(value: T): T => {
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (parsed && typeof parsed === 'object') return JSON.stringify(redactObject(parsed)) as T
    } catch { /* plain text */ }
    return redactText(value) as T
  }
  if (Array.isArray(value)) return value.map(redactObject) as T
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, ['id', 'name', 'role', 'tool_call_id', 'source_message_id'].includes(key) ? item : redactObject(item)])) as T
  return value
}
