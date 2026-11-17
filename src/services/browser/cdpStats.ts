import { asObject } from './eval'

export type CdpStatsSnap = {
  ok: boolean
  total: number
  last10s: number
  unowned: number
  evaluatePerSec: number
  findPerSec: number
  line: string
}

const empty: CdpStatsSnap = {
  ok: false,
  total: 0,
  last10s: 0,
  unowned: 0,
  evaluatePerSec: 0,
  findPerSec: 0,
  line: '',
}

let cache: { at: number; snap: CdpStatsSnap } = { at: 0, snap: empty }

export const formatCdpStats = (raw: unknown): CdpStatsSnap => {
  const row = asObject(raw)
  const methods = asObject(row.methods)
  const evaluate = asObject(methods['Runtime.evaluate'])
  const find = asObject(methods['DOM.getDocument'] || methods['DOM.performSearch'] || methods['Accessibility.queryAXTree'])
  const evaluatePerSec = Number(evaluate.perSec) || 0
  const findPerSec = Number(find.perSec) || 0
  const last10s = Number(row.last10s) || 0
  return {
    ok: row.ok !== false,
    total: Number(row.total) || 0,
    last10s,
    unowned: Number(row.unowned) || 0,
    evaluatePerSec,
    findPerSec,
    line: `cdp: evaluate ${evaluatePerSec.toFixed(1)}/s find ${findPerSec.toFixed(1)}/s total ${last10s}`,
  }
}

export const readCdpStats = async () => {
  if (Date.now() - cache.at < 1500) return cache.snap
  try {
    const { callProtocol } = await import('./protocol')
    const snap = formatCdpStats(await callProtocol('', 'cdp_stats', {}))
    cache = { at: Date.now(), snap }
    return snap
  } catch {
    return empty
  }
}
