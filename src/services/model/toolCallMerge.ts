/** 流式工具参数拼接。delta 是逐片追加；snapshot 才按累计全文取更长的那份。 */

export type ToolArgMode = 'delta' | 'snapshot'

const mergeJsonObjects = (left: string, right: string) => {
  const tryParse = (value: string) => {
    try {
      return JSON.parse(value)
    } catch {
      return null
    }
  }
  const a = tryParse(left)
  const b = tryParse(right)
  if (a && b && typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b)) {
    return JSON.stringify({ ...a, ...b })
  }
  const glued = `${left}${right}`.replace(/}\s*{/g, ',')
  if (tryParse(glued)) return glued
  return null
}

export const mergeToolArgs = (prev: string, next: string, mode: ToolArgMode = 'snapshot') => {
  if (!next) return prev
  if (!prev) return next
  if (mode === 'delta') {
    // Anthropic 的 content_block_start 会先给一个空对象，后面才是真正的增量。
    if (!prev.trim() || prev.trim() === '{}') return next
    return `${prev}${next}`
  }
  if (next === prev) return prev
  if (!prev.trim() || prev.trim() === '{}') return next
  if (!next.trim() || next.trim() === '{}') return prev
  if (next.startsWith(prev)) return next
  if (prev.startsWith(next)) return prev
  return mergeJsonObjects(prev, next) || `${prev}${next}`
}

export const mergeToolCalls = (existing: any[], incoming: any[], mode: ToolArgMode = 'snapshot') => {
  for (const tc of incoming || []) {
    const incomingId = tc.id || tc.tool_call_id || ''
    const incomingIndex = Number.isFinite(Number(tc.index)) ? Number(tc.index) : undefined
    const incomingName = tc.function?.name || tc.name || ''
    const found = existing.find((item) => {
      if (incomingId && item.id && item.id === incomingId) return true
      if (incomingIndex != null && item.index === incomingIndex) return true
      return false
    }) || (
      !incomingId && incomingIndex == null
        ? existing.find((item, index) => (
          index === existing.length - 1
          && (!incomingName || !item.function?.name || item.function.name === incomingName)
        ))
        : incomingId
          ? existing.find((item) =>
            String(item.id || '').startsWith('tool-')
            && (!incomingName || !item.function?.name || item.function.name === incomingName)
          )
          : undefined
    )
    if (found) {
      found.function = found.function || { name: '', arguments: '' }
      if (incomingId) found.id = incomingId
      if (incomingIndex != null) found.index = incomingIndex
      if (incomingName) found.function.name = incomingName
      found.function.arguments = mergeToolArgs(found.function.arguments || '', tc.function?.arguments || '', mode)
      continue
    }
    existing.push({
      id: incomingId || `tool-${existing.length + 1}`,
      index: incomingIndex,
      type: tc.type || 'function',
      function: {
        name: incomingName,
        arguments: tc.function?.arguments || '',
      },
    })
  }
}
