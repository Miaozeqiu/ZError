export type BrowserTaskIntent = 'play' | 'homework' | 'discussion' | 'unknown'

type TaskMemory = {
  intent: BrowserTaskIntent
  focus?: string
}

const bySession = new Map<string, TaskMemory>()

const FOCUS_RE = /《([^》]{2,20})》|([^\s，。、]{2,16}(?:数学|英语|物理|化学|政治|历史|课程|课))/

export const intentFromText = (text: string): BrowserTaskIntent => {
  const raw = String(text || '')
  // 不把“不要操作视频/作业”当成当前任务；例如论坛任务常带这样的范围限制。
  const active = raw.replace(/(?:不要|不用|无需|不再|暂不|不必|别|禁止|跳过|不做)(?:(?!只|但是|但|而是|不过)[^，,。；;！!？?\n])*/g, '')
  const skipQuiz = /(?:测验|测试)(?:不用|不要|跳过|不做)|(?:不用|不要|跳过|不做)(?:再|去|做|进行)?(?:测验|测试)/.test(raw)
  const play = /播放|刷课|刷完|看课|章节|视频|未完成|播完|看完这|播放任务|章节任务/.test(active)
  const homework = /作业|答题|作答|写作业/.test(active) || (/测验/.test(active) && !skipQuiz && !play)
  const discussion = /问答|论坛|讨论区|提问|发问|发帖|回帖|发(?:个|一个|一些|几个|几条)?(?:问题|帖子)|回复(?:同学|别人|他人|问题|帖子)?|我的回答/.test(active)
  if (discussion && !play && !homework) return 'discussion'
  if (play && !homework) return 'play'
  if (homework && !play) return 'homework'
  return 'unknown'
}

// 「你完成下成衣课程的播放任务」里课名是「成衣课程」，前面的「你完成下」是说话的语气，不是课名
const FOCUS_LEAD = /^(?:你|您|请|帮我|帮忙|给我|把|先|再|去|来|完成|做|刷|播放|播|看|下|一下|那个|这个|我的|要)+/

export const focusFromText = (text: string) => {
  const raw = String(text || '').trim()
  const hit = raw.match(FOCUS_RE)
  const found = String(hit?.[1] || hit?.[2] || '').trim()
  if (!found) return undefined
  if (hit?.[1]) return found
  const focus = found.replace(FOCUS_LEAD, '').trim()
  return focus.length >= 2 ? focus : undefined
}

export const rememberBrowserTaskIntent = (sessionId: string, text: string) => {
  const id = String(sessionId || '').trim()
  if (!id) return browserTaskIntent()
  const prev = bySession.get(id)
  const intent = intentFromText(text)
  const focus = focusFromText(text)
  const continuing = /^(?:请|帮我)?(?:继续|接着|恢复|重试|再试)(?:吧|一下|执行|做|操作|任务|播放|看|学习|上次的任务|刚才的任务|原来的任务)?[。！!\s]*$/.test(String(text || '').trim())
  const next: TaskMemory = {
    intent: intent === 'unknown' && continuing ? (prev?.intent || 'unknown') : intent,
    focus: focus || (continuing ? prev?.focus : undefined),
  }
  bySession.set(id, next)
  return next.intent
}

export const setBrowserTaskIntent = (sessionId: string, intent: BrowserTaskIntent) => {
  const id = String(sessionId || '').trim()
  if (!id || intent === 'unknown') return
  const prev = bySession.get(id)
  bySession.set(id, { intent, focus: prev?.focus })
}

export const intentFromTodoItems = (items: string[]): BrowserTaskIntent => {
  const raw = items.join('\n')
  if (/跳过作业|不做题|只看视频|只刷视频/.test(raw)) return 'play'
  return intentFromText(raw)
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
