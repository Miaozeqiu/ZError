/** Packages own page interpretation; the host only reads their bounded observations. */
export { websiteObservation as packAgentPanel } from '../agent/websiteRuntime/observations'
export { nativeWatchFor as videoWatchFor, nativeWatchBusy as agentWatchBusy } from '../browser/videoWatch'
export const formatVideoClock = (seconds: number) => {
  const total = Math.max(0, Math.floor(Number(seconds) || 0))
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}
export const watchSessionFastPath = (existing: { status: string; ended: boolean } | null | undefined, _event?: string | null): 'ended' | 'already' | null => {
  if (!existing) return null
  if (existing.ended || existing.status === 'done') return 'ended'
  return ['watching','paused','stalled'].includes(existing.status) ? 'already' : null
}
