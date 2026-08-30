export type BrowserTaskIntent = 'play' | 'homework' | 'unknown'

const bySession = new Map<string, BrowserTaskIntent>()
let lastIntent: BrowserTaskIntent = 'unknown'

export const intentFromText = (text: string): BrowserTaskIntent => {
  const raw = String(text || '')
  const play = /播放|刷课|看课|章节|视频|未完成|播完|看完这|播放任务/.test(raw)
  const homework = /作业|答题|作答|写作业/.test(raw)
  if (play && !homework) return 'play'
  if (homework && !play) return 'homework'
  return 'unknown'
}

export const rememberBrowserTaskIntent = (sessionId: string, text: string) => {
  const intent = intentFromText(text)
  if (intent === 'unknown') return browserTaskIntent(sessionId)
  bySession.set(sessionId, intent)
  lastIntent = intent
  return intent
}

export const browserTaskIntent = (sessionId?: string): BrowserTaskIntent => {
  const id = String(sessionId || '').trim()
  return (id && bySession.get(id)) || lastIntent
}
