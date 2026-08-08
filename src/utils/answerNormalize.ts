/** 从选项文本解析 A/B/C → 选项正文 */
export const parseOptionLetterMap = (options: string | undefined | null): Map<string, string> => {
  const map = new Map<string, string>()
  if (!options?.trim()) return map
  for (const raw of options.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const m = line.match(/^([A-Za-z])([\.、．\)])\s*(.+)$/)
    if (!m?.[1] || !m[3]?.trim()) continue
    const sep = m[2]
    const rest = m[3].trim()
    // 避免把正文「C、H、O、N…」误当成选项标号行
    if (sep === '、' && /^[A-Za-z]、/.test(rest)) continue
    map.set(m[1].toUpperCase(), rest)
  }
  return map
}

/**
 * 去掉行首选项字母前缀：`B. 传动角` → `传动角`；纯字母保留给后续映射。
 * 有选项表时，仅当去前缀后能对应到某选项正文才剥离，避免误伤「C、H、O、N…」。
 */
export const stripLeadingOptionLabel = (
  text: string,
  optionMap?: Map<string, string>
): string => {
  const trimmed = (text || '').trim()
  if (!trimmed) return ''

  const attempts: RegExpMatchArray[] = []
  const mSpace = trimmed.match(/^([A-Za-z])([\.、．\)])\s+(.+)$/)
  if (mSpace) attempts.push(mSpace)
  const mTight = trimmed.match(/^([A-Za-z])([\.、．\)])(.+)$/)
  if (mTight && mTight !== mSpace) attempts.push(mTight)

  for (const m of attempts) {
    const letter = m[1].toUpperCase()
    const sep = m[2]
    const rest = (m[3] || '').trim()
    if (!rest) continue
    // 无空格且剩余全是字母：留给纯字母映射（如 ABD）
    if (!/\s/.test(m[0].slice(1, 3)) && /^[A-Za-z]+$/.test(rest) && rest.length <= 8) {
      continue
    }
    // 无选项表时不用中文顿号做激进剥离
    if ((!optionMap || optionMap.size === 0) && sep === '、') continue

    if (optionMap && optionMap.size > 0) {
      const expected = optionMap.get(letter)
      if (expected === rest) return rest
      for (const v of optionMap.values()) {
        if (v === rest) return rest
      }
      continue
    }
    return rest
  }
  return trimmed
}

/**
 * 将模型答案规范为选项正文：
 * - `ABD` / `A` → 映射选项文字（多选用 ###）
 * - `B. 传动角` → `传动角`
 * - 多空 `A###C` 同样处理
 */
export const normalizeAnswerAgainstOptions = (
  answer: string,
  options?: string | null
): string => {
  const raw = (answer || '').trim()
  if (!raw) return ''

  const map = parseOptionLetterMap(options)
  const parts = raw.includes('###') ? raw.split('###') : [raw]

  const normalized = parts.map((part) => {
    let p = (part || '').trim()
    if (!p) return ''

    p = stripLeadingOptionLabel(p, map)

    const compact = p.replace(/\s+/g, '')
    if (map.size > 0 && /^[A-Za-z]{1,8}$/.test(compact)) {
      const letters = compact.toUpperCase().split('')
      const texts = letters.map((ch) => map.get(ch)).filter((t): t is string => !!t)
      if (texts.length === letters.length && texts.length > 0) {
        return texts.join('###')
      }
    }
    return p
  }).filter(Boolean)

  // 单段若已在上面展开成多段 ###，避免再包一层
  if (normalized.length === 1 && normalized[0].includes('###') && parts.length === 1) {
    return normalized[0]
  }
  return normalized.join('###')
}

/** 若 content 是 {"answer":"..."} JSON，则规范化其中的 answer */
export const normalizeAnswerJsonContent = (
  content: string,
  options?: string | null
): string => {
  const trimmed = (content || '').trim()
  if (!trimmed) return trimmed

  const tryObj = (text: string): string | null => {
    try {
      const obj = JSON.parse(text)
      if (obj && typeof obj === 'object' && typeof obj.answer === 'string') {
        const next = normalizeAnswerAgainstOptions(obj.answer, options)
        if (next !== obj.answer) {
          return JSON.stringify({ ...obj, answer: next })
        }
        return text
      }
    } catch {
      /* ignore */
    }
    return null
  }

  const direct = tryObj(trimmed)
  if (direct != null) return direct

  // 从末尾抽 JSON
  const end = trimmed.lastIndexOf('}')
  if (end >= 0) {
    let depth = 0
    for (let i = end; i >= 0; i--) {
      if (trimmed[i] === '}') depth++
      else if (trimmed[i] === '{') {
        depth--
        if (depth === 0) {
          const frag = trimmed.slice(i, end + 1)
          const replaced = tryObj(frag)
          if (replaced != null && replaced !== frag) {
            return trimmed.slice(0, i) + replaced + trimmed.slice(end + 1)
          }
          break
        }
      }
    }
  }

  // 非 JSON：整段当答案规范化
  if (!trimmed.startsWith('{') && !trimmed.startsWith('错误:')) {
    return normalizeAnswerAgainstOptions(trimmed, options)
  }
  return trimmed
}
