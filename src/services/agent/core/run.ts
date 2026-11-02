/** UI-free run state. Only enums, counters and opaque IDs may enter diagnostics. */
export type RunStatus = 'preparing' | 'running' | 'waiting_video' | 'waiting_user' | 'interrupted' | 'completed' | 'blocked' | 'failed'
export type FailureCode = 'cancelled' | 'credentials' | 'credit' | 'rate_limit' | 'network' | 'stale_target' | 'loading' | 'budget' | 'unknown'
export type Operation = { id: string; tool: string; browserId: string; state: 'pending' | 'dispatched' | 'uncertain' | 'verified' | 'not_completed'; at: number; sequence: number }
export type RunTrace = { sequence: number; at: number; event: 'state' | 'request' | 'usage' | 'tool' | 'failure' | 'observation' | 'compaction'; code?: string; tool?: string }
export type RunCheckpoint = {
  version: 1; id: string; status: RunStatus; updatedAt: number; browserId?: string
  goalMessageId?: string; recoveredFrom?: string; needsObservation: boolean; observation?: { id: string; browserId: string; at: number; sequence: number }
  operations: Operation[]; trace: RunTrace[]; sequence: number
  usage: { requests: number; inputTokens: number; outputTokens: number; tools: number; failures: number; noProgress?: number; compactions?: number; contextBefore?: number; contextAfter?: number }
  failure?: FailureCode
}
export type RunLimits = { requests: number; inputTokens: number; outputTokens: number; tools: number; consecutiveFailures: number; noProgressActions: number }
export const DEFAULT_RUN_LIMITS: RunLimits = { requests: 120, inputTokens: 2_000_000, outputTokens: 150_000, tools: 400, consecutiveFailures: 8, noProgressActions: 8 }
const terminal = new Set<RunStatus>(['completed', 'blocked', 'failed', 'interrupted'])
const transitions: Record<RunStatus, RunStatus[]> = {
  preparing: ['running', 'interrupted', 'failed'], running: ['waiting_video', 'waiting_user', 'interrupted', 'completed', 'blocked', 'failed'],
  waiting_video: ['running', 'waiting_user', 'interrupted', 'blocked', 'failed'], waiting_user: ['running', 'waiting_video', 'interrupted', 'blocked', 'failed'],
  interrupted: [], completed: [], blocked: [], failed: [],
}
export class RunBudgetError extends Error {
  constructor() { super('本次任务已达到执行预算，已停止新增操作。可发送“继续”在核对当前状态后续跑。'); this.name = 'RunBudgetError' }
}
export const classifyFailure = (value: unknown): FailureCode => {
  const text = value instanceof Error ? `${value.name} ${value.message}` : String(value || '')
  if (/RunBudgetError|ContextCapacityError|执行预算|超过模型可用上下文|上下文反复压缩/.test(text)) return 'budget'
  if (/AbortError|ModelStoppedError|已终止|已停止/.test(text)) return 'cancelled'
  if (/401|403|invalid.api.key|unauthorized|密钥无效|凭据|安全存储|授权/i.test(text)) return 'credentials'
  if (/402|insufficient|balance|quota.exceeded|余额|额度不足/i.test(text)) return 'credit'
  if (/429|rate.limit|限流/i.test(text)) return 'rate_limit'
  if (/stale|requiresRefresh|frame.*不存在|Node with given id|ref.*失效/i.test(text)) return 'stale_target'
  if (/loading|加载中|尚未就绪/i.test(text)) return 'loading'
  if (/timeout|network|fetch|connection|reset|超时|网络/i.test(text)) return 'network'
  return 'unknown'
}
export const recoveryHint = (code: FailureCode) => ({
  cancelled: '操作已停止；继续前重新核对页面。', credentials: '检查对应服务配置或恢复安全存储后再继续。', credit: '处理服务额度后再继续。',
  rate_limit: '服务限流，稍后重试；不要重复执行已发出的网页操作。', network: '连接中断；先核对已执行操作，再重试未完成部分。',
  stale_target: '重新读取当前页面，使用新 ref 定位；不要重放旧 ref。', loading: '短等页面就绪后重新观察。',
  budget: '保存当前进度；用户继续时重新核对页面再执行。', unknown: '保留实际错误，核对当前页面；不要原样循环重试。',
}[code])
export const newRun = (id: string, now = Date.now(), previous?: RunCheckpoint): RunCheckpoint => ({
  version: 1, id, status: 'preparing', updatedAt: now, needsObservation: Boolean(previous), recoveredFrom: previous?.id,
  operations: previous?.operations.filter(op => op.state === 'pending' || op.state === 'uncertain' || (op.state === 'dispatched' && op.at >= (previous.observation?.at || 0))).map(op => ({ ...op, sequence: 0, state: 'uncertain' })) || [],
  trace: [], sequence: 0, usage: { requests: 0, inputTokens: 0, outputTokens: 0, tools: 0, failures: 0 },
})
export const traceRun = (run: RunCheckpoint, event: RunTrace['event'], fields: Pick<RunTrace, 'code' | 'tool'> = {}, now = Date.now()) => {
  run.trace.push({ sequence: ++run.sequence, at: now, event, ...fields }); run.trace = run.trace.slice(-200); run.updatedAt = now
}
export const transitionRun = (run: RunCheckpoint, status: RunStatus, now = Date.now()) => {
  if (run.status === status || terminal.has(run.status)) return false
  if (!transitions[run.status].includes(status)) throw new Error(`Invalid run transition: ${run.status} -> ${status}`)
  run.status = status; traceRun(run, 'state', { code: status }, now); return true
}
export const interruptRun = (run: RunCheckpoint, now = Date.now()): RunCheckpoint => {
  const next: RunCheckpoint = JSON.parse(JSON.stringify(run))
  if (!terminal.has(next.status)) { next.status = 'interrupted'; next.needsObservation = true; traceRun(next, 'state', { code: 'interrupted' }, now) }
  next.operations.forEach(op => { if (op.state === 'pending') op.state = 'uncertain' })
  return next
}
export const assertBudget = (run: RunCheckpoint, limits: RunLimits = DEFAULT_RUN_LIMITS) => {
  const u = run.usage
  if (u.requests >= limits.requests || u.inputTokens >= limits.inputTokens || u.outputTokens >= limits.outputTokens || u.tools >= limits.tools || u.failures >= limits.consecutiveFailures || (u.noProgress || 0) >= limits.noProgressActions) throw new RunBudgetError()
}
export const browserMutation = (name: string) => /^browser_(click|click_text|set_checked|type|press|navigate|reload|go_back|go_forward)$/.test(name)
export const observationTool = (name: string) => /^(browser_get_page|browser_screenshot)$/.test(name)
export const verifyOperation = (run: RunCheckpoint, id: string, browserId: string, outcome: string, evidenceId: string) => {
  const op = run.operations.find(item => item.id === id && (item.state === 'pending' || item.state === 'uncertain'))
  const seen = run.observation
  if (!op || !seen || !browserId || !op.browserId || seen.id !== evidenceId || seen.browserId !== browserId || op.browserId !== browserId || seen.sequence <= op.sequence) return false
  if (outcome !== 'completed' && outcome !== 'not_completed') return false
  op.state = outcome === 'completed' ? 'verified' : 'not_completed'
  return true
}
export const runRecoveryContext = (run?: RunCheckpoint) => run ? [
  '【任务恢复检查点】此前执行已中断。不能复用旧 ref、定时器或监控登记。先 browser_get_page 核对当前页面，再决定下一步；需要等待视频时重新确认在播并 browser_watch。',
  run.operations.some(op => op.state === 'uncertain' || op.state === 'pending')
    ? `以下操作结果不确定，先核对页面回执，不可直接重试；使用 browser_verify_operation 提交新快照证据：${JSON.stringify(run.operations.filter(op => op.state === 'uncertain' || op.state === 'pending').map(({ id, tool, browserId }) => ({ id, tool, browserId })))}` : '',
].filter(Boolean).join('\n') : ''
