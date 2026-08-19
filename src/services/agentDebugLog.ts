const clip = (value: unknown, max = 24000) => {
  try {
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    return text.length > max ? `${text.slice(0, max)}…` : text
  } catch {
    return String(value)
  }
}

const fileName = (sessionId: string) => {
  const day = new Date().toISOString().slice(0, 10)
  const id = String(sessionId || 'session').replace(/[^\w.-]+/g, '_').slice(0, 80)
  return `${day}-${id}`
}

export const logAgentDebug = (sessionId: string, entry: Record<string, unknown>) => {
  if (!import.meta.env.DEV) return
  const payload = {
    file: fileName(sessionId),
    entry: {
      ts: new Date().toISOString(),
      sessionId,
      ...entry,
    },
  }
  fetch('/__agent-debug-log', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  }).catch(() => {
    console.warn('[agent-debug]', payload.file, entry.type || 'event', entry)
  })
}

export const clipAgentDebug = clip
