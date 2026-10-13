/** 同一工具同一参数连续失败，由宿主打断，不靠模型自觉。 */
import { nextStep } from './nextStep'

const FAIL_LIMIT = 2

type FailRow = { count: number; fingerprint: string }

const bySession = new Map<string, FailRow>()

const clip = (value: unknown) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, 80)

export const failFingerprint = (tool: string, args: Record<string, unknown> = {}) => {
  const name = String(tool || '').trim()
  if (name === 'browser_click_text') return `${name}|${clip(args.text)}`
  if (name === 'browser_click') return `${name}|${clip(args.selector || args.ref)}`
  const keys = Object.keys(args).filter((key) => args[key] != null && args[key] !== '').sort()
  return `${name}|${keys.slice(0, 6).map((key) => `${key}=${clip(args[key])}`).join('&')}`
}

const keyOf = (sessionId: string) => String(sessionId || '').trim()

export const shouldBlockRepeatFail = (sessionId: string, tool: string, args: Record<string, unknown>) => {
  const key = keyOf(sessionId)
  if (!key) return { block: false, count: 0 }
  const fingerprint = failFingerprint(tool, args)
  const row = bySession.get(key)
  if (!row || row.fingerprint !== fingerprint) return { block: false, count: 0 }
  if (row.count < FAIL_LIMIT) return { block: false, count: row.count }
  const play = tool === 'browser_click' && /play|播放/.test(JSON.stringify(args))
  return {
    block: true,
    count: row.count,
    hint: play
      ? nextStep('control.play', { tool, count: row.count })
      : nextStep('repeat', { tool, count: row.count }),
  }
}

export const noteFailAttempt = (
  sessionId: string,
  tool: string,
  args: Record<string, unknown>,
  ok: boolean,
) => {
  const key = keyOf(sessionId)
  if (!key) return
  const fingerprint = failFingerprint(tool, args)
  if (ok) {
    const row = bySession.get(key)
    if (row?.fingerprint === fingerprint) bySession.delete(key)
    return
  }
  const prev = bySession.get(key)
  if (!prev || prev.fingerprint !== fingerprint) {
    bySession.set(key, { count: 1, fingerprint })
    return
  }
  bySession.set(key, { count: prev.count + 1, fingerprint })
}

export const clearFailGate = (sessionId?: string) => {
  const key = keyOf(sessionId || '')
  if (key) bySession.delete(key)
  else bySession.clear()
}

export const failCountOf = (sessionId: string, tool: string, args: Record<string, unknown>) => {
  const row = bySession.get(keyOf(sessionId))
  if (!row || row.fingerprint !== failFingerprint(tool, args)) return 0
  return row.count
}

export const lastFailBlockOf = (sessionId: string) => {
  const row = bySession.get(keyOf(sessionId))
  return Boolean(row && row.count >= FAIL_LIMIT)
}
