import type { AgentSubagentKind } from '../chatTypes'

export const summarizeSubagentReceipt = (input: {
  ok: boolean
  kind: AgentSubagentKind
  summary: string
  url?: string
  error?: string
  playing?: boolean
  jobs?: unknown
  wrote?: boolean
}) => ({
  ok: input.ok,
  kind: input.kind,
  summary: String(input.summary || '').slice(0, 400),
  url: input.url || '',
  playing: input.playing,
  jobs: input.jobs,
  wrote: input.wrote,
  error: input.error,
})
