const unescapeJsonString = (value: string) => {
  try {
    return JSON.parse(`"${value}"`) as string
  } catch {
    return value.replace(/\\n/g, '\n').replace(/\\"/g, '"')
  }
}

const extractJsonStringField = (raw: string, key: string) => {
  const match = String(raw).match(new RegExp(`"${key}"\\s*:\\s*"((?:\\\\.|[^"\\\\])*)"`))
  return match ? unescapeJsonString(match[1]) : ''
}

const extractJsonArrayField = (raw: string, key: string) => {
  const text = String(raw)
  const start = text.search(new RegExp(`"${key}"\\s*:\\s*`))
  if (start < 0) return null
  const open = text.indexOf('[', start)
  if (open < 0) return null
  let depth = 0
  for (let i = open; i < text.length; i++) {
    const ch = text[i]
    if (ch === '[') depth += 1
    else if (ch === ']') {
      depth -= 1
      if (depth === 0) {
        try {
          const parsed = JSON.parse(text.slice(open, i + 1))
          return Array.isArray(parsed) ? parsed : null
        } catch {
          return null
        }
      }
    }
  }
  return null
}

const recoverFieldsFromRaw = (raw: string): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  const mermaid = extractJsonStringField(raw, 'mermaid')
  const outline = extractJsonStringField(raw, 'outline')
  if (mermaid) out.mermaid = mermaid
  if (outline) out.outline = outline
  const id = String(raw).match(/"subject_id"\s*:\s*(\d+)/)
  if (id) out.subject_id = Number(id[1])
  const nodes = extractJsonArrayField(raw, 'nodes')
  const add = extractJsonArrayField(raw, 'add')
  if (nodes) out.nodes = nodes
  if (add) out.add = add
  return out
}

export const parseToolArgs = (raw: string) => {
  const text = String(raw || '').trim()
  if (!text) return {}
  const tryParse = (value: string) => {
    try {
      const parsed = JSON.parse(value)
      return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null
    } catch {
      return null
    }
  }
  const normalize = (value: string) =>
    value
      .replace(/^(?:\{\}\s*)+/, '')
      .replace(/\}\s*\{/g, ',')
      .replace(/\{\s*,/g, '{')
      .replace(/,\s*,/g, ',')
      .replace(/,\s*\}/g, '}')
  for (const candidate of [text, normalize(text)]) {
    const parsed = tryParse(candidate)
    if (parsed) return { ...recoverFieldsFromRaw(text), ...parsed }
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const nested = tryParse(normalize(text.slice(start, end + 1)))
    if (nested) return { ...recoverFieldsFromRaw(text), ...nested }
  }
  return recoverFieldsFromRaw(text)
}
