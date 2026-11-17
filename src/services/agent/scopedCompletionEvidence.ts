/** Bounded chapter tasks use a fresh host-stamped page observation, not whole-course totals. */
import { isReadOnlyBrowserScript } from './core/scriptEffect'
export type ScopedCompletionProof = { observation_id?: unknown; targets?: unknown; evidence?: unknown }
export type ScopedCompletionEvidence = { stepId: string; targets: string[]; evidence: string }
type Step = { id: string; name?: string; status: string; result?: string; arguments?: string }
const passive = /^(browser_get_state|browser_get_page|browser_find|browser_screenshot|browser_decode_chaoxing_font|browser_eval|browser_wait|browser_todo|browser_finish|browser_site_graph)$/

export const scopedCompletionEvidence = (steps: Step[], browserId: string, currentUrl: string,
  targets: string[], proof?: ScopedCompletionProof, now = Date.now()): ScopedCompletionEvidence | undefined => {
  if (!targets.length || !proof || !Array.isArray(proof.targets) || typeof proof.evidence !== 'string'
    || proof.evidence.trim().length < 8 || proof.evidence.length > 2000) return
  const verified = [...new Set(proof.targets.map(String))]
  if (verified.length !== targets.length || targets.some(target => !verified.includes(target))) return
  let boundary = -1
  steps.forEach((step, index) => {
    let readEval = false
    if (step.name === 'browser_eval') {
      try { readEval = isReadOnlyBrowserScript(String(JSON.parse(step.arguments || '{}').script || '')) } catch { /* fail closed */ }
    }
    if (step.name?.startsWith('browser_') && (!passive.test(step.name) || (step.name === 'browser_eval' && !readEval)
      || (step.name !== 'browser_finish' && (step.status === 'running' || step.status === 'failed')))) boundary = index
  })
  for (let index = steps.length - 1; index > boundary; index--) {
    const step = steps[index]!
    if (!['browser_get_page', 'browser_screenshot'].includes(step.name || '')) continue
    if (step.status !== 'done' || step.id !== proof.observation_id) return
    let result: Record<string, any>
    try { result = JSON.parse(step.result || '{}') } catch { return }
    if (result.ok === false || result.error || result.snapshotStale || result.empty
      || result.observation_id !== step.id || result.observed_browser_id !== browserId
      || !Number.isFinite(result.observed_at) || now - result.observed_at > 120_000 || result.observed_at > now) return
    if (result.url && currentUrl && String(result.url).split('#')[0] !== currentUrl.split('#')[0]) return
    return { stepId: step.id, targets: [...targets], evidence: proof.evidence.trim() }
  }
}
