export type UrlQuestionMode = 'open' | 'single' | 'multiple' | 'judgement'

const LETTER_LABEL = /^\s*([A-Za-z])[\.、．]\s*(.*)$/
const NUMBER_LABEL = /^\s*(\d+)[\.、．]\s*(.*)$/

/** 从选项文本中解析带标签的选项块（支持块内换行） */
const parseLabeledOptionBlocks = (optionsStr: string): string[] => {
  const lines = optionsStr.replace(/\r\n/g, '\n').split('\n')
  const letterBlocks: string[] = []
  const numberBlocks: string[] = []
  let letterCurrent: string[] | null = null
  let numberCurrent: string[] | null = null
  let letterCount = 0
  let numberCount = 0

  for (const rawLine of lines) {
    const line = rawLine.trim()
    const letterMatch = line.match(LETTER_LABEL)
    if (letterMatch) {
      if (letterCurrent) {
        const text = letterCurrent.join('\n').trim()
        if (text) letterBlocks.push(text)
      }
      letterCount += 1
      letterCurrent = [letterMatch[2] || '']
      // 字母标签优先，打断数字块
      if (numberCurrent) {
        const text = numberCurrent.join('\n').trim()
        if (text) numberBlocks.push(text)
        numberCurrent = null
      }
      continue
    }

    const numberMatch = line.match(NUMBER_LABEL)
    if (numberMatch && !letterCurrent) {
      if (numberCurrent) {
        const text = numberCurrent.join('\n').trim()
        if (text) numberBlocks.push(text)
      }
      numberCount += 1
      numberCurrent = [numberMatch[2] || '']
      continue
    }

    if (letterCurrent) {
      if (line) letterCurrent.push(line)
      continue
    }
    if (numberCurrent) {
      if (line) numberCurrent.push(line)
    }
  }

  if (letterCurrent) {
    const text = letterCurrent.join('\n').trim()
    if (text) letterBlocks.push(text)
  }
  if (numberCurrent) {
    const text = numberCurrent.join('\n').trim()
    if (text) numberBlocks.push(text)
  }

  if (letterCount >= 2 && letterBlocks.length >= 2) return letterBlocks
  if (numberCount >= 2 && numberBlocks.length >= 2) return numberBlocks
  return []
}

/** 仅在明确选择题且无标签时，按非空行拆分 */
const parseLineFallbackOptions = (optionsStr: string): string[] => {
  return optionsStr
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
    .map(line => line.replace(/^[A-Za-z\d]+[\.、．]\s*/, '').trim() || line)
}

/**
 * 解析选项字符串为编号映射。
 * - preferLabeledOnly=true：仅接受 A./B. 或 1./2. 标签块（用于 type 空时推断）
 * - allowLineFallback=true：无标签时按非空行拆（仅 type 明确为选择/判断）
 */
export const parseUrlOptions = (
  optionsStr: string,
  options: { preferLabeledOnly?: boolean; allowLineFallback?: boolean } = {}
): Map<string, string> => {
  const map = new Map<string, string>()
  if (!optionsStr?.trim()) return map

  const { preferLabeledOnly = false, allowLineFallback = false } = options
  const labeled = parseLabeledOptionBlocks(optionsStr)
  if (labeled.length >= 2) {
    labeled.forEach((text, i) => map.set(String(i + 1), text))
    return map
  }

  if (preferLabeledOnly || !allowLineFallback) return map

  parseLineFallbackOptions(optionsStr).forEach((text, i) => {
    map.set(String(i + 1), text)
  })
  return map
}

export const classifyUrlQuestionMode = (
  questionType: string | undefined | null,
  optionsStr: string | undefined | null
): UrlQuestionMode => {
  const typeText = (questionType || '').trim()
  const normalized = typeText.toLowerCase()

  if (
    normalized.includes('completion') ||
    typeText.includes('填空') ||
    typeText.includes('简答') ||
    typeText.includes('解答') ||
    typeText.includes('主观')
  ) {
    return 'open'
  }

  if (normalized.includes('multiple') || typeText.includes('多选') || typeText.includes('多项选择')) {
    return 'multiple'
  }

  if (
    normalized.includes('judgement') ||
    normalized.includes('judgment') ||
    typeText.includes('判断')
  ) {
    return 'judgement'
  }

  if (
    normalized.includes('single') ||
    typeText.includes('单选') ||
    typeText.includes('单项选择')
  ) {
    return 'single'
  }

  // type 空或未知：仅当能解析出 ≥2 个带标签选项时视为单选，否则按简答
  const labeledOptions = parseUrlOptions(optionsStr || '', { preferLabeledOnly: true })
  if (labeledOptions.size >= 2) return 'single'
  return 'open'
}

export const isChoiceUrlQuestionMode = (mode: UrlQuestionMode): boolean =>
  mode === 'single' || mode === 'multiple'

export const buildUrlOptionMapForMode = (
  mode: UrlQuestionMode,
  optionsStr: string | undefined | null
): Map<string, string> => {
  const raw = optionsStr || ''
  if (mode === 'open') return new Map()

  // 选择/判断：优先标签块；无标签时仅选择类允许按行拆
  return parseUrlOptions(raw, {
    preferLabeledOnly: false,
    allowLineFallback: isChoiceUrlQuestionMode(mode),
  })
}

/** 从 AI 响应中取出 ANSWER: 后的原文（取最后一次匹配，兼容过程中多次写出） */
export const extractAnswerRaw = (response: string): string => {
  const matches = [...response.matchAll(/ANSWER:\s*(.+)/gi)]
  if (!matches.length) return ''
  return (matches[matches.length - 1][1] || '').trim()
}

/**
 * 按模式解析 ANSWER。
 * - open / judgement：返回原文
 * - single / multiple：字母/数字映射为选项原文；映射失败回退原文
 */
export const resolveUrlAnswer = (
  response: string,
  optionMap: Map<string, string>,
  mode: UrlQuestionMode
): string => {
  const raw = extractAnswerRaw(response)
  if (!raw) return ''

  // 去掉 `B. xxx` / `D.meeting` 这类字母前缀
  const stripLabel = (text: string): string => {
    const t = (text || '').trim()
    const m = t.match(/^([A-Za-z])[\.、．\)]\s+(.+)$/)
    if (m?.[2]?.trim()) return m[2].trim()
    const m2 = t.match(/^([A-Za-z])[\.、．\)](.+)$/)
    if (m2?.[2]?.trim() && !/^[A-Za-z]+$/.test(m2[2].trim())) return m2[2].trim()
    return t
  }

  if (mode === 'open') {
    return raw
  }

  if (mode === 'judgement' || optionMap.size === 0) {
    const stripped = stripLabel(raw)
    if (mode === 'judgement' && /^[A-Za-z]$/.test(stripped) && optionMap.size > 0) {
      const n = String(stripped.toUpperCase().charCodeAt(0) - 64)
      return optionMap.get(n) || stripped
    }
    return stripped
  }

  // 整段已是「B. 选项正文」时，直接去前缀并校验是否命中选项
  const wholeStripped = stripLabel(raw)
  if (wholeStripped !== raw.trim()) {
    for (const v of optionMap.values()) {
      if (v.trim() === wholeStripped) return wholeStripped
    }
  }

  const expandToken = (token: string): string[] => {
    const t = stripLabel(token.trim())
    if (!t) return []
    if (/^\d+$/.test(t)) return [t]
    if (/^[A-Za-z]$/.test(t)) return [String(t.toUpperCase().charCodeAt(0) - 64)]
    if (/^[A-Za-z]{2,}$/.test(t)) {
      return [...t.toUpperCase()].map(ch => String(ch.charCodeAt(0) - 64))
    }
    if (/^\d{2,}$/.test(t) && optionMap.size > 0) {
      const digits = [...t]
      if (digits.every(d => optionMap.has(d))) return digits
    }
    return [t]
  }

  const nums = raw
    .replace(/[和与及]/g, ' ')
    .split(/[,，、;\s]+/)
    .map(s => s.trim())
    .filter(Boolean)
    .flatMap(expandToken)

  const uniqueNums = [...new Set(nums)]
  if (uniqueNums.length === 0) return wholeStripped

  const parts = uniqueNums
    .map(n => optionMap.get(n) ?? '')
    .map(v => v.trim())
    .filter(Boolean)

  // 映射失败时回退去前缀原文，避免空答案或带回字母前缀
  if (parts.length === 0) return wholeStripped
  return parts.join('###')
}

export const buildUrlQuestionPromptParts = (
  mode: UrlQuestionMode,
  optionsStr: string,
  optionMap: Map<string, string>,
  questionType: string
): { optionsText: string; answerRule: string; typeHint: string } => {
  const typeText = (questionType || '').trim()
  const typeHint = typeText ? `\n【题目类型：${typeText}】\n` : ''
  const hasOptions = optionMap.size > 0

  let optionsText = ''
  if (isChoiceUrlQuestionMode(mode) && hasOptions) {
    optionsText = '\n\n选项：\n' + Array.from(optionMap.entries()).map(([k, v]) => `${k}. ${v}`).join('\n')
  } else if (mode === 'open' && optionsStr.trim()) {
    // 补充材料原文，不编号，避免模型按选项作答
    optionsText = `\n\n【补充材料】\n${optionsStr.trim()}\n`
  }

  let answerRule = ''
  if (mode === 'multiple' && hasOptions) {
    answerRule = `- 这是多选题：必须列出全部正确选项编号，多个编号用空格分隔，如 ANSWER: 1 3\n- 也可以写成 ANSWER: A C（字母对应下方选项顺序）\n- 不要只选一个；禁止输出空答案或仅空格`
  } else if (mode === 'judgement') {
    answerRule = `- 判断题：写 正确 或 错误\n- 格式如 ANSWER: 正确`
  } else if (mode === 'single' && hasOptions) {
    answerRule = `- 单选题：只写一个正确选项编号，如 ANSWER: 2；不要根据原始文本的空行号作答\n- 也可以写成 ANSWER: B（字母对应下方选项顺序）\n- 禁止输出空答案或仅空格`
  } else if (isChoiceUrlQuestionMode(mode) && !hasOptions) {
    answerRule = `- 选择题但未能解析出选项列表：直接写出完整答案内容，如 ANSWER: ……`
  } else {
    answerRule = `- 填空/简答/解答题：直接写完整答案内容，如 ANSWER: 42\n- 不要编造 A/B/C 选项编号；不要把补充材料当成选项列表`
  }

  return { optionsText, answerRule, typeHint }
}
