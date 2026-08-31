import { serverPort } from '../../questionServer/serverRefs'
import { waitMs } from '../../browser/eval'
import type { HomeworkQuestion } from './types'
import { fillChaoxingHomework, guessChaoxingHomework, saveChaoxingHomework } from './fill'
import { inspectChaoxingHomework } from './inspect'

const mapType = (raw?: string) => {
  const t = String(raw || '')
  if (/多选|multi/i.test(t)) return 'multiple'
  if (/判断|judge/i.test(t)) return 'judgement'
  if (/填空|简答|论述|计算|blank|text|completion/i.test(t)) return 'completion'
  if (/单选|single/i.test(t)) return 'single'
  return 'unknown'
}

const optionsText = (q: HomeworkQuestion) =>
  (q.options || [])
    .map((opt) => `${opt.letter || ''}. ${String(opt.text || '').trim()}`.trim())
    .filter(Boolean)
    .join('\n')

/** 把题库答案收敛成 fill 可用的 A/AC/文本 */
const normalizeAnswer = (q: HomeworkQuestion, raw: string) => {
  const text = String(raw || '').trim()
  if (!text) return ''
  const letters = text.toUpperCase().replace(/[^A-H]/g, '')
  const type = mapType(q.type || q.typeName)
  if (type === 'completion') {
    return text.replace(/#+/g, '；').replace(/---+|---|—+/g, '；').trim()
  }
  if (letters && /^[A-H]+$/.test(letters)) return letters
  const opts = q.options || []
  const hit = opts.filter((opt) => {
    const body = String(opt.text || '').trim()
    if (!body) return false
    return text.includes(body) || body.includes(text) || text === `${opt.letter}.${body}` || text === `${opt.letter}、${body}`
  })
  if (hit.length) return hit.map((opt) => opt.letter).join('')
  if (/正确|对|True|√|對/i.test(text)) {
    const yes = opts.find((opt) => /正确|对|True|√|對/i.test(opt.text || '') || opt.letter === 'A')
    return yes?.letter || 'A'
  }
  if (/错误|错|False|×|x|錯/i.test(text)) {
    const no = opts.find((opt) => /错误|错|False|×|x|錯/i.test(opt.text || '') || opt.letter === 'B')
    return no?.letter || 'B'
  }
  return letters || text.slice(0, 80)
}

const queryLocalTiku = async (q: HomeworkQuestion) => {
  const port = Number(serverPort.value) || 0
  if (!(port > 0)) return null
  const title = String(q.stem || '').trim()
  if (!title) return null
  const params = new URLSearchParams({
    title,
    options: optionsText(q),
    type: mapType(q.type || q.typeName),
  })
  try {
    const res = await fetch(`http://127.0.0.1:${port}/query?${params.toString()}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    })
    if (!res.ok) return null
    const json = await res.json() as {
      code?: number
      data?: { answer?: string; question?: string }
      message?: string
    }
    // OCS 配置：code===0 表示未命中；有 data.answer 才算搜到
    if (json.code === 0) return null
    const answer = String(json.data?.answer || '').trim()
    return answer || null
  } catch {
    return null
  }
}

export type ChapterQuizRunResult = {
  ok: boolean
  quiz: true
  searched?: number
  guessed?: number
  filledCount?: number
  questionCount?: number
  saved?: boolean
  hint?: string
  error?: string
}

/**
 * 对齐 ocsjs JobRunner.chapter：
 * 章节测验任务点 → 本地题库搜题 → 填入 → 未命中随机 → 暂时保存 → 交给下一任务点。
 */
export const runChaoxingChapterQuiz = async (id: string): Promise<ChapterQuizRunResult> => {
  await waitMs(800)
  let card = await inspectChaoxingHomework(id, { vision: true }).catch(() => null)
  let questions = card?.questions || []
  if (!questions.length) {
    await waitMs(1200)
    card = await inspectChaoxingHomework(id, { vision: true }).catch(() => null)
    questions = card?.questions || []
  }
  if (!questions.length) {
    return {
      ok: false,
      quiz: true,
      error: '章节测验没有读到题目',
      hint: '确认已打开测验标签。可再 browser_chaoxing_homework inspect，或 guess 后 next。',
    }
  }

  const answers: Array<{ index: number; type?: string; answer: string }> = []
  let searched = 0
  for (const q of questions) {
    if (q.filled) continue
    const index = Number(q.index) || 0
    if (!index) continue
    const hit = await queryLocalTiku(q)
    await waitMs(400)
    if (!hit) continue
    const answer = normalizeAnswer(q, hit)
    if (!answer) continue
    answers.push({ index, type: q.type || q.typeName, answer })
    searched += 1
  }

  if (answers.length) {
    await fillChaoxingHomework(id, answers)
    await waitMs(300)
  }

  const left = await inspectChaoxingHomework(id, { vision: false }).catch(() => null)
  const unfinished = (left?.questions || []).filter((q) => !q.filled).length
  let guessed = 0
  if (unfinished > 0) {
    const guess = await guessChaoxingHomework(id)
    guessed = Number(guess.guessed) || 0
  }

  const saved = await saveChaoxingHomework(id).catch(() => null)
  const again = await inspectChaoxingHomework(id, { vision: false }).catch(() => null)
  const filledCount = Number(again?.filledCount) || 0
  const questionCount = Number(again?.questionCount) || questions.length

  return {
    ok: filledCount > 0 || searched > 0 || guessed > 0,
    quiz: true,
    searched,
    guessed,
    filledCount,
    questionCount,
    saved: Boolean(saved?.ok),
    hint: `章节测验已按 ocs 流程处理：搜到 ${searched}，随机 ${guessed}，已填 ${filledCount}/${questionCount}，已暂存。继续下一任务点。`,
  }
}
