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

/** 模型漏写引号或花括号时的常见形状，逐条补。 */
const repairJson = (value: string) => {
  let text = value
  // `"handle": kind": "step"` → `"handle": {"kind": "step"`
  text = text.replace(/:\s*([A-Za-z_][\w-]*)"\s*:/g, ': {"$1":')
  // `{"handle": {"kind": ...}}}` 多一个 / 少一个右括号：按数量补齐
  const opens = (text.match(/\{/g) || []).length
  const closes = (text.match(/\}/g) || []).length
  if (closes > opens) {
    let extra = closes - opens
    while (extra > 0 && /\}\s*$/.test(text)) {
      text = text.replace(/\}\s*$/, '')
      extra -= 1
    }
  } else if (opens > closes) {
    text += '}'.repeat(opens - closes)
  }
  return text
}

/** 解析彻底失败时，至少把 `"键": "字符串" / 数字 / 布尔` 这种顶层标量捞回来。 */
const recoverScalarsFromRaw = (raw: string): Record<string, unknown> => {
  const out: Record<string, unknown> = {}
  const re = /"([A-Za-z_][\w-]*)"\s*:\s*(?:"((?:\\.|[^"\\])*)"|(-?\d+(?:\.\d+)?)|(true|false))/g
  let match: RegExpExecArray | null
  while ((match = re.exec(raw))) {
    const key = match[1]
    if (key in out) continue
    if (match[2] != null) out[key] = unescapeJsonString(match[2])
    else if (match[3] != null) out[key] = Number(match[3])
    else if (match[4] != null) out[key] = match[4] === 'true'
  }
  return out
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
  const direct = tryParse(text)
  if (direct) return { ...recoverFieldsFromRaw(text), ...direct }
  for (const candidate of [normalize(text), repairJson(text), repairJson(normalize(text))]) {
    const parsed = tryParse(candidate)
    if (parsed) return { ...recoverFieldsFromRaw(text), ...parsed }
  }
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start >= 0 && end > start) {
    const inner = text.slice(start, end + 1)
    for (const candidate of [normalize(inner), repairJson(inner)]) {
      const nested = tryParse(candidate)
      if (nested) return { ...recoverFieldsFromRaw(text), ...nested }
    }
  }
  // 什么都拼不回来：顶层标量（kind / label / title…）总比空对象强
  return { ...recoverScalarsFromRaw(text), ...recoverFieldsFromRaw(text) }
}
