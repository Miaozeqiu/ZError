export type AnswerFewShotKind = 'single' | 'multiple' | 'judgement' | 'completion' | 'general'

type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string }

type FewShotPair = { user: string; assistant: string }

const SYSTEM_RULES = `你是专业答题助手。最终只输出一行 JSON：{"answer":"答案正文"}。
选择题 answer 必须是选项正文（与选项原文去掉 A./B. 后一致），禁止写 A/B/C/D，禁止写「B. 传动角」这种带字母前缀的形式。
判断题 answer 只能是「正确」或「错误」。
多选题多个答案用 ### 连接；填空题多空也用 ### 连接。`

const SINGLE_SHOTS: FewShotPair[] = [
  {
    user: `【题目类型：单选题】
【题目】
凸轮机构中，从动件运动规律取决于（ ）。
【选项】
A. 压力角
B. 传动角
C. 极力夹角

请作答，并在最后输出答案 JSON：`,
    assistant: '{"answer":"传动角"}',
  },
  {
    user: `【题目类型：单选题】
【题目】
The gerund of the verb "meet" is ____.
【选项】
A. meet
B. meeted
C. to meet
D. meeting

请作答，并在最后输出答案 JSON：`,
    assistant: '{"answer":"meeting"}',
  },
]

const MULTIPLE_SHOTS: FewShotPair[] = [
  {
    user: `【题目类型：多选题】
【题目】
下列属于输入设备的有（ ）。
【选项】
A. 键盘
B. 显示器
C. 鼠标
D. 打印机

请作答，并在最后输出答案 JSON：`,
    assistant: '{"answer":"键盘###鼠标"}',
  },
]

const JUDGEMENT_SHOTS: FewShotPair[] = [
  {
    user: `【题目类型：判断题】
【题目】
地球绕太阳公转一周约为 365 天。

请作答，并在最后输出答案 JSON：`,
    assistant: '{"answer":"正确"}',
  },
  {
    user: `【题目类型：判断题】
【题目】
纯净水的 pH 值一定等于 7。

请作答，并在最后输出答案 JSON：`,
    assistant: '{"answer":"错误"}',
  },
]

const COMPLETION_SHOTS: FewShotPair[] = [
  {
    user: `【题目类型：填空题】
【题目】
中国的首都是____，最大的城市是____。

请作答，并在最后输出答案 JSON：`,
    assistant: '{"answer":"北京###上海"}',
  },
]

const GENERAL_SHOTS: FewShotPair[] = [
  SINGLE_SHOTS[0],
  JUDGEMENT_SHOTS[0],
]

export const detectAnswerFewShotKind = (query: string): AnswerFewShotKind => {
  const q = query || ''
  if (/题目类型：\s*多选/.test(q) || /multiple/i.test(q)) return 'multiple'
  if (/题目类型：\s*判断/.test(q) || /judg(?:e)?ment/i.test(q)) return 'judgement'
  if (/题目类型：\s*填空/.test(q) || /completion/i.test(q)) return 'completion'
  if (/题目类型：\s*单选/.test(q) || /single/i.test(q)) return 'single'
  return 'general'
}

/** 是否为普通答题 prompt（排除同题判断 / URL 题等） */
export const shouldAttachAnswerFewShot = (query: string): boolean => {
  const q = (query || '').trim()
  if (!q) return false
  if (q.startsWith('__SAME_QUESTION_CHECK__:')) return false
  if (q.startsWith('__URL_QUESTION__:')) return false
  return q.includes('【题目】') || q.includes('专业的答题助手') || q.includes('"answer"')
}

const shotsForKind = (kind: AnswerFewShotKind): FewShotPair[] => {
  switch (kind) {
    case 'single':
      return SINGLE_SHOTS
    case 'multiple':
      return MULTIPLE_SHOTS
    case 'judgement':
      return JUDGEMENT_SHOTS
    case 'completion':
      return COMPLETION_SHOTS
    default:
      return GENERAL_SHOTS
  }
}

/**
 * 构建带典型例题的多轮对话：
 * system 规则 → 例题 user/assistant 对 → 当前题目 user
 */
export const buildAnswerChatMessages = (query: string): ChatMessage[] => {
  if (!shouldAttachAnswerFewShot(query)) {
    return [{ role: 'user', content: query }]
  }

  const kind = detectAnswerFewShotKind(query)
  const shots = shotsForKind(kind)
  const messages: ChatMessage[] = [{ role: 'system', content: SYSTEM_RULES }]

  for (const shot of shots) {
    messages.push({ role: 'user', content: shot.user })
    messages.push({ role: 'assistant', content: shot.assistant })
  }
  messages.push({ role: 'user', content: query })
  return messages
}
