export type AutomaticPage = { browserId: string; sessionId: string; url: string }
type ToolState = { offset?: number; failures: number; busy: number }
type Job = {
  key: string; controller: AbortController; timer?: ReturnType<typeof setTimeout>
  failures: number; page: AutomaticPage; tools: Map<string, ToolState>
}
/** One passive job per browser; every tool has its own retry budget and cursor. */
export function createWebsiteAutomationScheduler(input: {
  resolve: (url: string) => Promise<string[]>
  run: (page: AutomaticPage, name: string, signal: AbortSignal, args: Record<string, unknown>) => Promise<Record<string, any>>
}) {
  const jobs = new Map<string, Job>()
  let disposed = false
  const cancel = (id: string) => {
    const job = jobs.get(id)
    if (job) { job.controller.abort(); clearTimeout(job.timer); jobs.delete(id) }
  }
  const execute = async (job: Job) => {
    const current = () => !disposed && jobs.get(job.page.browserId) === job && !job.controller.signal.aborted
    if (!current()) return
    let retry = 0
    try {
      const tools = await input.resolve(job.page.url)
      if (!current()) return
      job.failures = 0
      for (const name of tools) {
        const state: ToolState = job.tools.get(name) || { failures: 0, busy: 0 }
        job.tools.set(name, state)
        if (state.failures > 6) continue
        const args = state.offset === undefined ? {} : { offset: state.offset }
        const receipt: Record<string, any> = await input.run(job.page, name, job.controller.signal, args).catch(() => ({ ok: false }))
        if (!current()) return
        if (receipt.reason === 'busy') {
          retry = Math.max(retry, Math.min(30000, 500 * 2 ** Math.min(state.busy++, 6)))
          continue
        }
        state.busy = 0
        if (receipt.ok === false) {
          if (++state.failures <= 6) retry = Math.max(retry, Math.min(30000, 500 * 2 ** state.failures))
          continue
        }
        state.failures = 0
        const offset = receipt.result?.next_offset
        state.offset = Number.isSafeInteger(offset) && offset >= 0 && offset <= 10000 ? offset : undefined
        retry = Math.max(retry, Math.min(30000, Math.max(0, Number(receipt.result?.retryAfterMs) || 0)))
      }
    } catch {
      if (current() && ++job.failures <= 6) retry = Math.min(30000, 500 * 2 ** job.failures)
    }
    if (current() && retry) job.timer = setTimeout(() => { void execute(job) }, retry)
  }
  return {
    schedule(page: AutomaticPage, force = false) {
      if (disposed) return
      const key = JSON.stringify([page.sessionId, page.url])
      if (!force && jobs.get(page.browserId)?.key === key) return
      cancel(page.browserId)
      const job: Job = { key, page, controller: new AbortController(), failures: 0, tools: new Map() }
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
