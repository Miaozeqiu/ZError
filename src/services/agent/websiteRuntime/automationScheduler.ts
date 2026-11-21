export type AutomaticPage = { browserId: string; sessionId: string; url: string }
type Job = { key: string; controller: AbortController; timer?: ReturnType<typeof setTimeout>; started: number; failures: number; page: AutomaticPage }
/** One passive job per browser. No model turns, no detached infinite retry loops. */
export function createWebsiteAutomationScheduler(input: {
  resolve: (url: string) => Promise<string[]>
  run: (page: AutomaticPage, name: string, signal: AbortSignal) => Promise<Record<string, any>>
  now?: () => number
}) {
  const jobs = new Map<string, Job>(), now = input.now || Date.now
  let disposed = false
  const cancel = (id: string) => {
    const job = jobs.get(id)
    if (job) { job.controller.abort(); clearTimeout(job.timer); jobs.delete(id) }
  }
  const execute = async (job: Job) => {
    const current = () => !disposed && jobs.get(job.page.browserId) === job && !job.controller.signal.aborted
    if (!current() || now() - job.started > 10 * 60_000) return
    let retry = 0
    try {
      const tools = await input.resolve(job.page.url)
      if (!current()) return
      for (const name of tools) {
        const receipt = await input.run(job.page, name, job.controller.signal)
        if (!current()) return
        if (receipt.reason === 'busy') retry = Math.max(retry, 500)
        else if (receipt.ok === false) retry = ++job.failures <= 6 ? Math.min(30000, 500 * 2 ** job.failures) : 0
        else { job.failures = 0; retry = Math.max(retry, Math.min(30000, Math.max(0, Number(receipt.result?.retryAfterMs) || 0))) }
      }
    } catch {
      if (current() && ++job.failures <= 6) retry = Math.min(30000, 500 * 2 ** job.failures)
    }
    if (current() && retry && now() - job.started < 10 * 60_000) job.timer = setTimeout(() => { void execute(job) }, retry)
  }
  return {
    schedule(page: AutomaticPage, force = false) {
      if (disposed) return
      const key = JSON.stringify([page.sessionId, page.url])
      if (!force && jobs.get(page.browserId)?.key === key) return
      cancel(page.browserId)
      const job: Job = { key, page, controller: new AbortController(), started: now(), failures: 0 }
      jobs.set(page.browserId, job)
      job.timer = setTimeout(() => { void execute(job) }, 300)
    },
    reconcile(pages: AutomaticPage[], force = false) {
      const current = new Set(pages.map(page => page.browserId))
      for (const id of jobs.keys()) if (!current.has(id)) cancel(id)
      for (const page of pages) this.schedule(page, force)
    },
    cancel,
    dispose() { disposed = true; for (const id of jobs.keys()) cancel(id) },
  }
}
