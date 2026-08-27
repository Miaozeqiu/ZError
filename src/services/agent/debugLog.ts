const clip = (value: unknown, max = 24000) => {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return text.length > max ? `${text.slice(0, max)}…` : text
  } catch {
    return String(value)
  }
}

const fileName = (sessionId: string, kind?: string) => {
  const day = new Date().toISOString().slice(0, 10)
  const id = String(sessionId || 'session').replace(/[^\w.-]+/g, '_').slice(0, 80)
  return kind === 'browser' ? `browser-${day}-${id}` : `${day}-${id}`
}

const postDebug = (payload: Record<string, unknown>) => {
  fetch('/__agent-debug-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {
    console.warn('[agent-debug]', payload.file, payload)
  })
}

export const logAgentDebug = (sessionId: string, entry: Record<string, unknown>) => {
  if (!import.meta.env.DEV) return
  const kind = String(entry.kind || '')
  postDebug({
    file: fileName(sessionId, kind),
    entry: {
      ts: new Date().toISOString(),
      sessionId,
      ...entry,
    },
  })
}

export type BrowserTranscriptSession = {
  id: string
  title?: string
  browserId?: string
  updatedAt?: number
  messages: Array<{
    role: string
    content: string
    status?: string
    error?: string
    steps?: Array<{ name?: string; label?: string; status?: string; detail?: string }>
  }>
}

const formatTranscript = (session: BrowserTranscriptSession) => {
  const lines = [
    `# 浏览器 Agent`,
    `title: ${session.title || '网页助手'}`,
    `session: ${session.id}`,
    `browserId: ${session.browserId || ''}`,
    `updated: ${session.updatedAt ? new Date(session.updatedAt).toISOString() : ''}`,
    '',
  ]
  for (const message of session.messages || []) {
    const who = message.role === 'user' ? '用户' : '助手'
    lines.push(`## ${who}`)
    if (message.steps?.length) {
      for (const step of message.steps) {
        const mark = step.status === 'failed' ? 'x' : step.status === 'running' ? '.' : ' '
        lines.push(`- [${mark}] ${step.label || step.name || ''}${step.detail ? ` · ${step.detail}` : ''}`)
      }
      lines.push('')
    }
    const text = String(message.content || '').trim()
    if (text) lines.push(text, '')
    if (message.error) lines.push(`错误：${message.error}`, '')
  }
  return `${lines.join('\n').trim()}\n`
}

export const writeBrowserTranscript = (session: BrowserTranscriptSession | null | undefined) => {
  if (!import.meta.env.DEV || !session?.browserId) return
  const text = formatTranscript(session)
  postDebug({ file: 'browser-latest', replace: true, ext: 'md', text })
  postDebug({ file: fileName(session.id, 'browser'), replace: true, ext: 'md', text })
}

export const writeDebugDump = (file: string, text: string, ext: 'html' | 'md' | 'json' | 'txt' = 'html') => {
  if (!import.meta.env.DEV) return
  postDebug({ file, replace: true, ext, text })
}

export const clipAgentDebug = clip
