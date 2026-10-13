import type { AgentSubagentKind } from '../chatTypes'

export const summarizeSubagentReceipt = (input: {
  ok: boolean
  kind: AgentSubagentKind
  summary: string
  url?: string
  error?: string
  card?: unknown
  playing?: boolean
  jobs?: unknown
  wrote?: boolean
  dryRun?: unknown
}) => ({
  ok: input.ok,
  kind: input.kind,
  summary: String(input.summary || '').slice(0, 400),
  url: input.url || '',
  card: input.card,
  playing: input.playing,
  jobs: input.jobs,
  wrote: input.wrote,
  dryRun: input.dryRun,
  error: input.error,
})
