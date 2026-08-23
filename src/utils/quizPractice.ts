import { parseDifficulty, parseImportance, parseMastery } from './questionMetrics'

export interface QuizCard {
  uid: string
  question_id?: number
  question: string
  options: string
  answer: string
  question_type?: string
  explanation?: string
  importance?: number
  mastery?: number
  difficulty?: number
  knowledge_point?: string
  node_name?: string
  node_id?: number
  parent_name?: string
  subject_id?: number
}

export interface QuizOption {
  key: string
  text: string
}

export interface QuizAnswerState {
  selected: string[]
  submitted: boolean
  correct?: boolean
  note: string
  recordId?: number
  mastery?: number
}

const QUIZ_CARDS_KEY = 'zerror-agent-quiz-cards'
const QUIZ_ANSWERS_KEY = 'zerror-agent-quiz-answers'
const QUIZ_TITLES_KEY = 'zerror-agent-quiz-titles'

const cardsByStep = new Map<string, QuizCard[]>()
const answersByKey = new Map<string, QuizAnswerState>()
const titlesByStep = new Map<string, string>()

const loadMap = <T>(key: string, target: Map<string, T>) => {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return
    const parsed = JSON.parse(raw) as Record<string, T>
    for (const [id, value] of Object.entries(parsed || {})) target.set(id, value)
  } catch {
    // ignore
  }
}

const persistMap = <T>(key: string, source: Map<string, T>) => {
  try {
    localStorage.setItem(key, JSON.stringify(Object.fromEntries(source)))
  } catch {
    // ignore
  }
}

loadMap(QUIZ_CARDS_KEY, cardsByStep)
loadMap(QUIZ_ANSWERS_KEY, answersByKey)
loadMap(QUIZ_TITLES_KEY, titlesByStep)

const optionLineText = (item: unknown): string => {
  if (item == null) return ''
  if (typeof item === 'string' || typeof item === 'number') return String(item).trim()
  if (typeof item === 'object') {
    const record = item as Record<string, unknown>
    return String(record.text ?? record.Content ?? record.content ?? record.key ?? '').trim()
  }
  return String(item).trim()
}

const splitOptionSource = (raw?: unknown): string[] => {
  if (raw == null) return []
  if (Array.isArray(raw)) return raw.map(optionLineText).filter(Boolean)
  const text = String(raw).trim()
  if (!text) return []
  if (text.startsWith('[')) {
    try {
      const parsed = JSON.parse(text)
      if (Array.isArray(parsed)) return parsed.map(optionLineText).filter(Boolean)
    } catch {
      // fall through
    }
  }
  if (text.includes('\n')) return text.split(/\n+/).map((line) => line.trim()).filter(Boolean)
  const inline = text.split(/\s+(?=[A-Ha-h](?:[\.、.)]|\s)\s*)/).map((line) => line.trim()).filter(Boolean)
  return inline.length > 1 ? inline : [text]
}

export const parseOptions = (raw?: unknown): QuizOption[] => {
  return splitOptionSource(raw).map((line, index) => {
    const match = line.match(/^([A-Ha-h])(?:[\.、.)]|\s)\s*(.*)$/)
    if (match) return { key: match[1].toUpperCase(), text: match[2] || '' }
    return { key: String.fromCharCode(65 + index), text: line }
  }).filter((item) => item.key || item.text)
}

export const quizKind = (type?: string, options?: string) => {
  const text = String(type || '').replace(/\s/g, '')
  if (/多选|多项|不定项/.test(text)) return 'multiple'
  if (/判断/.test(text)) return 'judgement'
  if (/填空|简答|解答/.test(text)) return 'fill'
  if (parseOptions(options).length) return 'single'
  if (/单选|单项|选择/.test(text)) return 'single'
  return 'fill'
}

const compactText = (value: string) => value.replace(/\s+/g, '').toLowerCase()

const splitAnswerParts = (answer: string) => {
  const text = String(answer || '').trim()
  if (!text) return [] as string[]
  if (text.includes('###')) return text.split('###').map((part) => part.trim()).filter(Boolean)
  const squeezed = text.replace(/\s+/g, '')
  if (/^[A-Ha-h]([,，、]*[A-Ha-h])*$/.test(squeezed)) {
    return squeezed.toUpperCase().replace(/[^A-H]/g, '').split('')
  }
  const letterOnly = text.match(/^([A-Ha-h])[\.、.\)\s]*$/)
  if (letterOnly) return [letterOnly[1].toUpperCase()]
  return [text]
}

export const resolveAnswerKeys = (answer: string, options?: string, type?: string) => {
  const kind = quizKind(type, options)
  const text = String(answer || '').trim()
  if (!text) return [] as string[]
  if (kind === 'judgement') {
    if (/^(正确|对|true|t|yes|y|√|1)$/i.test(text)) return ['对']
    if (/^(错误|错|false|f|no|n|×|0)$/i.test(text)) return ['错']
  }
  const opts = parseOptions(options)
  const keys = new Set<string>()
  for (const part of splitAnswerParts(text)) {
    if (/^[A-H]$/.test(part.toUpperCase())) {
      keys.add(part.toUpperCase())
      continue
    }
    const prefixed = part.match(/^([A-Ha-h])[\.、.\)\s]\s*(.+)$/)
    if (prefixed) {
      keys.add(prefixed[1].toUpperCase())
      continue
    }
    const hit = opts.find((option) => compactText(option.text) === compactText(part))
    if (hit?.key) keys.add(hit.key)
  }
  return [...keys]
}

export const normalizeAnswerKeys = (answer: string, kind: string, options?: string) =>
  resolveAnswerKeys(answer, options, kind === 'judgement' ? '判断' : kind === 'multiple' ? '多选' : '单选')

export const formatAnswerLabel = (answer: string, options?: string, type?: string) => {
  const keys = resolveAnswerKeys(answer, options, type)
  const opts = parseOptions(options)
  if (keys.length && opts.length) {
    return keys
      .map((key) => {
        const hit = opts.find((option) => option.key === key)
        return hit ? `${key}. ${hit.text}` : key
      })
      .join('；')
  }
  return String(answer || '').replace(/###/g, '、')
}

export const gradeQuiz = (selected: string[], answer: string, type?: string, options?: string) => {
  const expected = resolveAnswerKeys(answer, options, type).slice().sort().join(',')
  const got = selected.map((item) => item.toUpperCase()).sort().join(',')
  if (!expected) return false
  return expected === got
}

export const nextMastery = (current: number | undefined, correct: boolean) => {
  const value = Number(current) || 0
  if (correct) return value <= 1 ? 2 : 3
  return 1
}

export const sanitizeQuizTitle = (raw?: unknown, fallback = '练习') => {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!text) return fallback
  return text.slice(0, 40)
}

export const resolveQuizTitle = (args?: Record<string, unknown> | null, cards?: QuizCard[]) => {
  const explicit = sanitizeQuizTitle(
    args?.title ?? args?.name ?? args?.quiz_title ?? args?.quiz_name,
    '',
  )
  if (explicit) return explicit
  const hint = sanitizeQuizTitle(
    args?.node_name
      ?? args?.knowledge_point
      ?? args?.paper_name
      ?? cards?.[0]?.node_name
      ?? cards?.[0]?.knowledge_point,
    '',
  )
  return hint || '练习'
}

export const saveQuizCards = (stepId: string, cards: QuizCard[]) => {
  cardsByStep.set(stepId, cards)
  persistMap(QUIZ_CARDS_KEY, cardsByStep)
}

export const getQuizCards = (stepId: string) => cardsByStep.get(stepId) || []

export const saveQuizTitle = (stepId: string, title?: string) => {
  const next = sanitizeQuizTitle(title, '')
  if (!next) return
  titlesByStep.set(stepId, next)
  persistMap(QUIZ_TITLES_KEY, titlesByStep)
}

export const getQuizTitle = (stepId: string, fallback = '练习') =>
  titlesByStep.get(stepId) || fallback

export const answerKey = (stepId: string, uid: string) => `${stepId}:${uid}`

export const getQuizAnswer = (stepId: string, uid: string) =>
  answersByKey.get(answerKey(stepId, uid))

export const setQuizAnswer = (stepId: string, uid: string, state: QuizAnswerState) => {
  answersByKey.set(answerKey(stepId, uid), state)
  persistMap(QUIZ_ANSWERS_KEY, answersByKey)
}

export const toQuizCard = (item: Record<string, unknown>, index: number): QuizCard | null => {
  const questionId = Number(item.question_id ?? item.id)
  const question = String(item.question || item.content || '').trim()
  const answer = String(item.answer || '').trim()
  if (!question && !(Number.isFinite(questionId) && questionId > 0)) return null
  return {
    uid: Number.isFinite(questionId) && questionId > 0 ? `q-${questionId}` : `g-${index}`,
    question_id: Number.isFinite(questionId) && questionId > 0 ? questionId : undefined,
    question,
    options: Array.isArray(item.choices)
      ? (item.choices as unknown[]).map((choice, index) => {
        const record = choice && typeof choice === 'object' ? choice as Record<string, unknown> : {}
        const key = String(record.key || String.fromCharCode(65 + index)).toUpperCase()
        const text = optionLineText(record.text ?? choice)
        return `${key}. ${text.replace(/^[A-Ha-h](?:[\.、.)]|\s)\s*/, '')}`
      }).join('\n')
      : Array.isArray(item.options)
        ? item.options.map(optionLineText).filter(Boolean).map((text, index) => `${String.fromCharCode(65 + index)}. ${text.replace(/^[A-Ha-h](?:[\.、.)]|\s)\s*/, '')}`).join('\n')
        : String(item.options || '').trim(),
    answer,
    question_type: String(item.question_type || item.type || '').trim() || undefined,
    explanation: String(item.explanation || item.analysis || '').trim() || undefined,
    importance: item.importance == null ? undefined : parseImportance(item.importance),
    mastery: item.mastery == null ? undefined : parseMastery(item.mastery),
    difficulty: item.difficulty == null ? undefined : parseDifficulty(item.difficulty),
    knowledge_point: String(item.knowledge_point || item.knowledge || '').trim() || undefined,
    node_name: String(item.node_name || item.knowledge_point || '').trim() || undefined,
    node_id: Number(item.node_id || item.nodeId) > 0 ? Number(item.node_id || item.nodeId) : undefined,
    parent_name: String(item.parent_name || item.chapter || '').trim() || undefined,
    subject_id: Number(item.subject_id || item.subjectId) > 0 ? Number(item.subject_id || item.subjectId) : undefined,
  }
}

const asRecord = (item: unknown, index: number): Record<string, unknown> => {
  if (typeof item === 'number' || (typeof item === 'string' && /^\d+$/.test(item))) {
    return { question_id: Number(item) }
  }
  if (item && typeof item === 'object') return item as Record<string, unknown>
  return { question: String(item || ''), index }
}

export const parseQuizCards = (raw: unknown): QuizCard[] => {
  const source = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray(source?.questions)
      ? source.questions
      : Array.isArray(source?.question_ids)
        ? source.question_ids
        : source?.question_id != null || source?.id != null
          ? [source]
          : []
  return list
    .map((item: unknown, index: number) => toQuizCard(asRecord(item, index), index))
    .filter((item: QuizCard | null): item is QuizCard => Boolean(item))
    .slice(0, 10)
}

export const parseMarkdownQuizzes = (text: string): QuizCard[] => {
  const blocks = String(text || '').replace(/\r/g, '').split(/\n{2,}/)
  const cards: QuizCard[] = []
  const scan = (block: string, index: number) => {
    const lines = block.split('\n').map((line) => line.trim()).filter(Boolean)
    const options: QuizOption[] = []
    const stem: string[] = []
    for (const line of lines) {
      const match = line.match(/^([A-Ha-h])[\.、.\)\s]\s*(.+)$/)
      if (match) {
        options.push({ key: match[1].toUpperCase(), text: match[2] })
        continue
      }
      if (!options.length) {
        stem.push(line.replace(/^\*\*|\*\*$/g, '').replace(/^#{1,6}\s*/, ''))
      }
    }
    if (options.length < 2 || !stem.length) return
    const keys = options.map((item) => item.key)
    if (new Set(keys).size < 2) return
    if (options.some((item) => /\s[B-Hb-h](?:[\.、.)]|\s)/.test(item.text))) return
    const question = stem.join('\n').replace(/请在卡片上点选答案[。.]?/g, '').trim()
    if (!question) return
    if (/共\s*\d+\s*道|答案[：:]/.test(question)) return
    if (/(?:^|\n)\s*2[\.、)]/.test(question) || /1[\.、)]\s*\*\*/.test(question)) return
    cards.push({
      uid: `md-${index}-${question.slice(0, 24)}`,
      question,
      options: options.map((item) => `${item.key}. ${item.text}`).join('\n'),
      answer: '',
      question_type: '单选',
    })
  }
  blocks.forEach((block, index) => scan(block, index))
  if (!cards.length) scan(String(text || '').replace(/\r/g, ''), 0)
  return cards.slice(0, 10)
}

export const stripMarkdownQuizzes = (text: string, cards: QuizCard[]) => {
  let next = String(text || '')
  for (const card of cards) {
    next = next.replace(card.question, '')
    for (const line of card.options.split('\n')) {
      const escaped = line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      next = next.replace(new RegExp(`^\\s*${escaped}\\s*$`, 'm'), '')
    }
  }
  return next
    .replace(/请在卡片上点选答案[。.]?/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
