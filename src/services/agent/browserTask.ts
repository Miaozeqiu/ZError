export type BrowserTaskIntent = 'play' | 'homework' | 'unknown'

type TaskMemory = {
  intent: BrowserTaskIntent
  focus?: string
}

const bySession = new Map<string, TaskMemory>()

const FOCUS_RE = /《([^》]{2,20})》|([^\s，。、]{2,16}(?:数学|英语|物理|化学|政治|历史|课程|课))/

export const intentFromText = (text: string): BrowserTaskIntent => {
  const raw = String(text || '')
  const skipQuiz = /测验|测试/.test(raw) && /不用|不要|跳过|不做/.test(raw)
  const play = /播放|刷课|刷完|看课|章节|视频|未完成|播完|看完这|播放任务|章节任务/.test(raw)
  const homework = /作业|答题|作答|写作业/.test(raw) || (/测验/.test(raw) && !skipQuiz && !play)
  if (play && !homework) return 'play'
  if (homework && !play) return 'homework'
  return 'unknown'
}

export const focusFromText = (text: string) => {
  const raw = String(text || '').trim()
  const hit = raw.match(FOCUS_RE)
  return String(hit?.[1] || hit?.[2] || '').trim() || undefined
}

export const rememberBrowserTaskIntent = (sessionId: string, text: string) => {
  const id = String(sessionId || '').trim()
  if (!id) return browserTaskIntent()
  const prev = bySession.get(id)
  const intent = intentFromText(text)
  const focus = focusFromText(text)
  const next: TaskMemory = {
    intent: intent === 'unknown' ? (prev?.intent || 'unknown') : intent,
    focus: focus || prev?.focus,
  }
  bySession.set(id, next)
  return next.intent
}

export const browserTaskIntent = (sessionId?: string): BrowserTaskIntent => {
  const id = String(sessionId || '').trim()
  if (!id) return 'unknown'
  return bySession.get(id)?.intent || 'unknown'
}

export const browserTaskFocus = (sessionId?: string) => {
  const id = String(sessionId || '').trim()
  return (id && bySession.get(id)?.focus) || ''
}

export const clearBrowserTaskIntent = (sessionId?: string) => {
  const id = String(sessionId || '').trim()
  if (id) bySession.delete(id)
  else bySession.clear()
}
