/** 只从本轮真实页面观察取统计，不接受 summary、清单或取消原因作为完成证明。 */
export type CourseCompletionEvidence = { stepId: string; completed: number; total: number }
type Step = { id: string; name?: string; status: string; result?: string }
const observations = new Set(['browser_get_page', 'browser_eval'])
const passive = /^(browser_get_state|browser_get_page|browser_find|browser_screenshot|browser_decode_chaoxing_font|browser_eval|browser_wait|browser_todo|browser_finish|browser_site_graph)$/

/** 只读任务收尾也需要本轮当前页面的成功观察，不能只凭已打开的网址。 */
export const hasCurrentPageObservation = (steps: Step[], currentUrl: string): boolean => {
  for (let at = steps.length - 1; at >= 0; at--) {
    const step = steps[at]!
    if (!step.name?.startsWith('browser_')) continue
    if (!passive.test(step.name)) return false
    if (!['browser_get_page', 'browser_get_state'].includes(step.name)) continue
    if (step.status !== 'done') return false
    try {
      const result = JSON.parse(step.result || '{}')
      return Boolean(currentUrl && result.url === currentUrl && result.ok !== false && !result.error
        && !result.empty && !result.snapshotStale
        && (step.name === 'browser_get_state' || result.snapshot))
    } catch { return false }
  }
  return false
}

export const courseCompletionEvidence = (steps: Step[], currentUrl: string): CourseCompletionEvidence | undefined => {
  let boundary = -1
  steps.forEach((step, at) => { if (step.name?.startsWith('browser_') && !passive.test(step.name || '')) boundary = at })
  for (let at = steps.length - 1; at > boundary; at--) {
    const step = steps[at]!
    if (!observations.has(step.name || '')) continue
    if (step.status !== 'done') return
    let result: Record<string, any>
    try { result = JSON.parse(step.result || '{}') } catch { return }
    if (result.ok === false || result.error || result.snapshotStale) return
    if (result.url && currentUrl && String(result.url).split('#')[0] !== currentUrl.split('#')[0]) return
    const counts: CourseCompletionEvidence[] = []
    let visited = 0
    const scan = (value: unknown) => {
      if (++visited > 1000) return
      if (typeof value === 'string') {
        for (const match of value.matchAll(/已完成任务点\s*[：:]?\s*(\d+)\s*\/\s*(\d+)/g)) {
          const completed = Number(match[1]), total = Number(match[2])
          if (Number.isSafeInteger(completed) && Number.isSafeInteger(total) && total > 0 && completed >= 0 && completed <= total) counts.push({ stepId: step.id, completed, total })
        }
      } else if (Array.isArray(value)) value.forEach(scan)
      else if (value && typeof value === 'object') Object.values(value).forEach(scan)
    }
    scan(step.name === 'browser_eval' ? result.result : result.snapshot)
    if (!counts.length) continue
    // 多处统计矛盾时不猜哪一处代表整门课；新的未完成统计也不能被旧记录覆盖。
    const first = counts[0]!
    if (counts.some(item => item.completed !== first.completed || item.total !== first.total)) return
    return first
  }
}
