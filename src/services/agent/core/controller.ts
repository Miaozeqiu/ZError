import { assertBudget, browserMutation, classifyFailure, DEFAULT_RUN_LIMITS, interruptRun, observationTool, recoveryHint, traceRun, transitionRun, verifyOperation, type RunCheckpoint, type RunLimits, type RunStatus } from './run'
import { isReadOnlyBrowserScript } from './scriptEffect'
export type CoreToolCall = { id: string; name: string; arguments: string }
export type ToolMiddleware = { before?: (call: Readonly<CoreToolCall>) => void | Promise<void>; after?: (call: Readonly<CoreToolCall>, result: string) => void | Promise<void> }
const object = (raw: string): Record<string, any> => { try { const value = JSON.parse(raw); return value && typeof value === 'object' && !Array.isArray(value) ? value : {} } catch { return {} } }
/** Mandatory lifecycle/receipt gates surround optional middleware; hooks cannot bypass them. */
export const createRunController = (input: {
  run: RunCheckpoint; changed: (run: RunCheckpoint) => void; checkpoint: () => Promise<unknown>
  browserId: () => string; prepareBrowser?: () => Promise<string>; browserTabs?: () => string[]; selectBrowser?: (id: string) => Promise<boolean>; signal: AbortSignal; limits?: RunLimits; middleware?: ToolMiddleware[]
}) => {
  let run: RunCheckpoint = JSON.parse(JSON.stringify(input.run))
  const limits = input.limits || DEFAULT_RUN_LIMITS
  let recentSnapshot = ''
  let recoveryReminders = 0
  const publish = () => { run.browserId = input.browserId() || run.browserId; input.changed(JSON.parse(JSON.stringify(run))) }
  const state = (status: RunStatus) => { transitionRun(run, status); publish() }
  let finishingFrom: RunStatus | undefined
  const stop = () => {
    if (finishingFrom) run.status = finishingFrom
    run = interruptRun(run); publish()
  }
  input.signal.addEventListener('abort', stop, { once: true })
  const blocked = (error: string) => JSON.stringify({ ok: false, reason: 'verification_required', error,
    operations: run.operations.filter(op => op.state === 'uncertain' || op.state === 'pending').map(({ id, tool, browserId }) => ({ id, tool, browserId })) })
  return {
    state,
    finish: async (status: 'completed' | 'blocked') => {
      if (input.signal.aborted) throw new DOMException('已停止', 'AbortError')
      const previous = JSON.parse(JSON.stringify(run)) as RunCheckpoint
      if (!transitionRun(run, status)) return
      finishingFrom = previous.status
      publish()
      try {
        await input.checkpoint()
        if (input.signal.aborted) {
          stop(); await input.checkpoint()
          throw new DOMException('已停止', 'AbortError')
        }
      } catch (error) {
        // A rejected completion write must remain recoverable, while takeover
        // wins over a late completion acknowledgement or storage failure.
        if (!input.signal.aborted) { run = previous; publish() }
        throw error
      } finally { finishingFrom = undefined }
    },
    beforeComplete: () => {
      if (!run.needsObservation && !run.operations.some(op => op.state === 'pending' || op.state === 'uncertain')) return
      if (++recoveryReminders > 2) throw new Error('恢复检查尚未完成：仍缺新页面证据或不确定操作核对。已停止空转，不能声明完成。')
      return '【尚未完成恢复核对】先读取当前页面并核对结果不确定的操作，使用新 observation_id 验证；无法核对时明确 browser_finish(blocked)，不可直接口头结束。'
    },
    request: (tokens: number) => { assertBudget(run, limits); run.usage.requests++; run.usage.inputTokens += Math.max(0, tokens); traceRun(run, 'request'); publish(); if (run.usage.inputTokens > limits.inputTokens) assertBudget(run, limits) },
    usage: (tokens: number) => { run.usage.outputTokens += Math.max(0, tokens); traceRun(run, 'usage'); publish() },
    compacted: (before: number, after: number) => {
      run.usage.compactions = (run.usage.compactions || 0) + 1
      run.usage.contextBefore = before; run.usage.contextAfter = after
      traceRun(run, 'compaction'); publish()
    },
    fail: (error: unknown) => { run.failure = classifyFailure(error); traceRun(run, 'failure', { code: run.failure }); state('failed') },
    dispose: () => input.signal.removeEventListener('abort', stop),
    context: () => `【宿主运行状态】${JSON.stringify({ runId: run.id, status: run.status, usage: run.usage, limits, needsObservation: run.needsObservation, unresolved: run.operations.filter(op => op.state === 'uncertain').map(op => ({ id: op.id, tool: op.tool, browserId: op.browserId })) })}`,
    execute: async (call: CoreToolCall, execute: (browserId?: string) => Promise<string>): Promise<string> => {
      if (input.signal.aborted) throw new DOMException('已停止', 'AbortError')
      assertBudget(run, limits)
      let browserId = input.browserId()
      if (call.name === 'browser_run_status') return JSON.stringify({ ok: true, run, tabs: input.browserTabs?.() || [], tokenAccounting: '输入为估算，输出优先使用服务回执；不包含计费金额。' })
      if (call.name === 'browser_select_tab') {
        const id = String(object(call.arguments).browser_id || '')
        if (!id || !await input.selectBrowser?.(id)) return JSON.stringify({ ok: false, error: '此标签页不存在或不属于当前对话。先 browser_run_status 查看标签 ID。' })
        run.needsObservation = true; run.observation = undefined; publish()
        return JSON.stringify({ ok: true, browser_id: id, hint: '已切换到本对话的现有标签；先读取新页面。' })
      }
      if (call.name === 'browser_verify_operation') {
        const args = object(call.arguments)
        if (!String(args.evidence || '').trim() || !verifyOperation(run, String(args.operation_id || ''), browserId, args.outcome, args.observation_id)) return blocked('先在原标签读取新的页面或截图，再提供 observation_id、operation_id、outcome 和具体页面证据；不能猜测操作结果。')
        traceRun(run, 'observation', { code: args.outcome }); publish(); await input.checkpoint()
        return JSON.stringify({ ok: true, outcome: args.outcome, hint: args.outcome === 'completed' ? '不要重复已完成的操作。' : '页面证据已核对；仅在用户授权范围内重试。' })
      }
      const mutates = browserMutation(call.name) || (call.name === 'browser_eval' && !isReadOnlyBrowserScript(String(object(call.arguments).script || '')))
      if ((mutates || call.name === 'browser_watch' || call.name === 'browser_course_plan' || (call.name === 'browser_finish' && object(call.arguments).status === 'done')) && run.needsObservation) return blocked('任务恢复后必须先 browser_get_page 或 browser_screenshot 读取当前页面，旧 ref 不可重放。')
      if ((mutates || (call.name === 'browser_finish' && object(call.arguments).status === 'done')) && run.operations.some(op => op.state === 'uncertain' || op.state === 'pending')) return blocked('存在结果不确定的网页操作。先观察原标签中的页面回执，再 browser_verify_operation；不可直接重试或声明完成。')
      if (mutates) {
        browserId = input.prepareBrowser ? await input.prepareBrowser() : browserId
        if (input.signal.aborted) throw new DOMException('已停止', 'AbortError')
        if (!browserId || browserId !== input.browserId()) return JSON.stringify({ ok: false, reason: 'invalid', error: '网页操作未执行：无法确认当前标签页，请重新读取页面。' })
      }
      run.usage.tools++
      const operationId = `${run.id}/operation/${run.usage.tools}`
      const op = mutates ? { id: operationId, tool: call.name, browserId, at: Date.now(), sequence: run.sequence + 1, state: 'pending' as const } : undefined
      if (op) {
        run.operations = run.operations.filter(item => item.state === 'uncertain' || item.state === 'pending' || item.at >= (run.observation?.at || 0)).slice(-80)
        run.operations.push(op)
      }
      traceRun(run, 'tool', { tool: call.name }); publish()
      // A failed durable write prevents dispatch. No action may precede this await.
      if (op) {
        try { await input.checkpoint() } catch (error) { run.operations = run.operations.filter(item => item.id !== operationId); publish(); throw error }
      }
      let raw: string
      let dispatched = false
      const hookCall = Object.freeze({ ...call })
      try {
        for (const hook of input.middleware || []) await hook.before?.(hookCall)
        if (input.signal.aborted) throw new DOMException('已停止', 'AbortError')
        if (op && browserId !== input.browserId()) throw new Error('网页操作未执行：当前标签页已改变，请重新读取页面。')
        dispatched = true
        raw = await execute(op ? browserId : undefined)
      } catch (error) {
        const current = run.operations.find(item => item.id === operationId)
        if (current) current.state = dispatched ? 'uncertain' : 'not_completed'
        publish(); await input.checkpoint(); throw error
      }
      if (input.signal.aborted) { stop(); await input.checkpoint(); throw new DOMException('已停止', 'AbortError') }
      const result = object(raw)
      const failed = result.ok === false || Boolean(result.error) || result.denied === true
      // Successful reads do not erase a failing action loop. Only successful work resets it.
      if (failed) run.usage.failures++
      else if (mutates || !call.name.startsWith('browser_')) run.usage.failures = 0
      const current = run.operations.find(item => item.id === operationId)
      if (current) {
        // Only explicit non-dispatch receipts are safe; all ambiguous failures must be observed.
        const rejected = !result.clickDispatched && (result.denied === true || result.requiresRefresh === true || result.userTakeover === true || /^(not_found|ambiguous|disabled|covered|invalid|stale|verification_required)$/.test(result.reason || ''))
        current.state = failed ? (rejected ? 'not_completed' : 'uncertain') : 'dispatched'
      }
      if (!failed && typeof result.snapshot === 'string' && result.snapshot.trim()) {
        const snap = result.snapshot.replace(/ref=e\d+/g, 'ref=[current]')
        if (snap !== recentSnapshot) run.usage.noProgress = 0
        else if (mutates && call.name !== 'browser_type' && call.name !== 'browser_set_checked') run.usage.noProgress = (run.usage.noProgress || 0) + 1
        recentSnapshot = snap
      }
      if (failed) traceRun(run, 'failure', { tool: call.name, code: classifyFailure(result.error) })
      const hasObservation = call.name === 'browser_get_page' ? typeof result.snapshot === 'string' && Boolean(result.snapshot.trim()) && !result.empty : typeof result.image === 'string' && result.image.startsWith('data:image/')
      if (!failed && observationTool(call.name) && hasObservation && browserId === input.browserId()) {
        run.needsObservation = false
        run.observation = { id: call.id, browserId: input.browserId(), at: Date.now(), sequence: run.sequence + 1 }
        traceRun(run, 'observation')
        raw = JSON.stringify({ ...result, observation_id: call.id, observed_browser_id: browserId, observed_at: run.observation.at,
          ...(run.operations.some(op => op.state === 'uncertain') ? { pendingOperations: run.operations.filter(op => op.state === 'uncertain').map(({ id, tool, browserId }) => ({ id, tool, browserId })) } : {}) })
      }
      publish(); if (op) await input.checkpoint()
      for (const hook of input.middleware || []) await hook.after?.(hookCall, raw)
      if (failed) raw = JSON.stringify({ ...object(raw), recovery: { code: classifyFailure(result.error), hint: recoveryHint(classifyFailure(result.error)) }, ...(current?.state === 'uncertain' ? { operation_id: current.id, resultUncertain: true, hint: '操作可能已送达。先读取页面回执，再 browser_verify_operation；不要重复提交。' } : {}) })
      return raw
    },
  }
}
