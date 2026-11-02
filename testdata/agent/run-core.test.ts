import { describe, expect, it, vi } from 'vitest'
import { newRun, transitionRun, interruptRun, classifyFailure, assertBudget, DEFAULT_RUN_LIMITS, verifyOperation } from '../../src/services/agent/core/run'
import { createRunController } from '../../src/services/agent/core/controller'
const setup = (previous?: ReturnType<typeof newRun>) => {
  let snapshot = newRun('run', 1, previous)
  const abort = new AbortController()
  const checkpoint = vi.fn(async () => undefined)
  const controller = createRunController({ run: snapshot, changed: value => { snapshot = value }, checkpoint, browserId: () => 'tab', signal: abort.signal })
  controller.state('running')
  return { controller, checkpoint, abort, read: () => snapshot }
}
const call = (id: string, name: string, args = {}) => ({ id, name, arguments: JSON.stringify(args) })
describe('durable task lifecycle', () => {
  it.each(['completed', 'blocked'] as const)('failed %s checkpoint can transition to failure and be resumed', async status => {
    const test = setup()
    test.checkpoint.mockRejectedValueOnce(new Error('storage locked'))
    await expect(test.controller.finish(status)).rejects.toThrow('storage locked')
    expect(test.read().status).toBe('running')
    expect(test.read().trace.some(item => item.code === status)).toBe(false)
    test.controller.fail(new Error('storage locked'))
    expect(test.read().status).toBe('failed')
    expect(newRun('resume', 2, test.read()).needsObservation).toBe(true)
  })
  it('completion is acknowledged only after storage and stays terminal afterwards', async () => {
    const test = setup(); let release!: () => void
    test.checkpoint.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const done = vi.fn()
    const job = test.controller.finish('completed').then(done)
    await Promise.resolve(); expect(done).not.toHaveBeenCalled()
    release(); await job
    expect(test.read().status).toBe('completed')
    test.controller.state('running'); expect(test.read().status).toBe('completed')
  })
  it('takeover during completion storage wins over a late acknowledgement', async () => {
    const test = setup(); let release!: () => void
    test.checkpoint.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const job = test.controller.finish('completed')
    test.abort.abort(); release()
    await expect(job).rejects.toMatchObject({ name: 'AbortError' })
    expect(test.read().status).toBe('interrupted')
  })
  it('wait is not completion, terminal runs cannot be revived by late events', () => {
    const run = newRun('id'); transitionRun(run, 'running'); transitionRun(run, 'waiting_video')
    expect(run.status).toBe('waiting_video')
    const interrupted = interruptRun(run); expect(transitionRun(interrupted, 'running')).toBe(false)
    expect(interrupted.status).toBe('interrupted')
    transitionRun(run, 'running'); transitionRun(run, 'completed'); expect(transitionRun(run, 'waiting_video')).toBe(false)
  })
  it('does not send an action until its encrypted checkpoint is acknowledged', async () => {
    const test = setup(); let release!: () => void
    test.checkpoint.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const act = vi.fn(async () => '{"ok":true}')
    const job = test.controller.execute(call('submit', 'browser_click', { ref: 'e1' }), act)
    await Promise.resolve(); expect(act).not.toHaveBeenCalled(); expect(test.read().operations[0].state).toBe('pending')
    release(); await job; expect(act).toHaveBeenCalledOnce(); expect(test.read().operations[0].state).toBe('dispatched')
  })
  it('failed storage prevents dispatch and does not create an uncertain action', async () => {
    const test = setup(); test.checkpoint.mockRejectedValueOnce(new Error('storage locked'))
    const act = vi.fn()
    await expect(test.controller.execute(call('op', 'browser_click'), act)).rejects.toThrow('storage locked')
    expect(act).not.toHaveBeenCalled(); expect(test.read().operations).toEqual([])
  })
  it('a lost submission response cannot be repeated until a fresh page receipt is checked', async () => {
    const test = setup(); const act = vi.fn(async () => '{"ok":true}')
    await expect(test.controller.execute(call('submit', 'browser_click'), async () => { throw new Error('network') })).rejects.toThrow()
    const blocked = JSON.parse(await test.controller.execute(call('again', 'browser_click'), act))
    expect(blocked.reason).toBe('verification_required'); expect(act).not.toHaveBeenCalled()
    expect(JSON.parse(await test.controller.execute(call('verify', 'browser_verify_operation', { operation_id: test.read().operations[0].id, observation_id: 'old', outcome: 'completed', evidence: 'receipt' }), act)).ok).toBe(false)
    const page = JSON.parse(await test.controller.execute(call('fresh', 'browser_get_page'), async () => '{"ok":true,"snapshot":"submitted"}'))
    expect(page.observation_id).toBe('fresh')
    expect(JSON.parse(await test.controller.execute(call('verify2', 'browser_verify_operation', { operation_id: test.read().operations[0].id, observation_id: 'fresh', outcome: 'completed', evidence: 'page shows submitted' }), act)).ok).toBe(true)
    expect(test.read().operations[0].state).toBe('verified')
    expect(act).not.toHaveBeenCalled()
  })
  it('restart requires a new observation and re-verification, without replaying old refs', async () => {
    const before = setup(); await before.controller.execute(call('op', 'browser_click'), async () => '{"ok":true}')
    const test = setup(interruptRun(before.read())); const act = vi.fn(async () => '{"ok":true}')
    expect(JSON.parse(await test.controller.execute(call('again', 'browser_click'), act)).ok).toBe(false)
    await test.controller.execute(call('fresh', 'browser_get_page'), async () => '{"ok":true,"snapshot":"unsent form"}')
    await test.controller.execute(call('verify', 'browser_verify_operation', { operation_id: test.read().operations[0].id, observation_id: 'fresh', outcome: 'not_completed', evidence: 'still unsent' }), act)
    await test.controller.execute(call('retry', 'browser_click'), act)
    expect(act).toHaveBeenCalledOnce()
  })
  it('old observations in the same millisecond and other tabs cannot verify operations', () => {
    const run = newRun('id'); run.observation = { id: 'old', browserId: 'tab', at: 1, sequence: 1 }
    run.operations.push({ id: 'op', tool: 'browser_click', browserId: 'tab', at: 1, sequence: 2, state: 'uncertain' })
    expect(verifyOperation(run, 'op', 'tab', 'completed', 'old')).toBe(false)
    run.observation = { id: 'fresh', browserId: 'other', at: 2, sequence: 3 }
    expect(verifyOperation(run, 'op', 'other', 'completed', 'fresh')).toBe(false)
    run.operations[0].browserId = ''
    expect(verifyOperation(run, 'op', 'other', 'completed', 'fresh')).toBe(false)
  })
  it('stamps page observation ownership and time itself instead of trusting returned fields', async () => {
    const test = setup()
    const result = JSON.parse(await test.controller.execute(call('page', 'browser_get_page'), async () => JSON.stringify({
      ok: true, snapshot: 'current page', observation_id: 'forged', observed_browser_id: 'other', observed_at: 0,
    })))
    expect(result.observation_id).toBe('page')
    expect(result.observed_browser_id).toBe('tab')
    expect(result.observed_at).toBe(test.read().observation?.at)
    expect(result.observed_at).toBeGreaterThan(0)
  })
  it('binds the first action to its created tab before saving or dispatching, even when it throws', async () => {
    let browserId = ''
    let snapshot = newRun('first')
    const checkpoint = vi.fn(async () => { expect(snapshot.operations[0].browserId).toBe('created-tab') })
    const controller = createRunController({ run: snapshot, changed: value => { snapshot = value }, checkpoint,
      browserId: () => browserId, prepareBrowser: async () => (browserId = 'created-tab'), signal: new AbortController().signal })
    controller.state('running')
    await expect(controller.execute(call('first', 'browser_click'), async target => {
      expect(checkpoint).toHaveBeenCalledOnce(); expect(target).toBe('created-tab')
      throw new Error('response lost')
    })).rejects.toThrow('response lost')
    expect(snapshot.operations[0]).toMatchObject({ browserId: 'created-tab', state: 'uncertain' })
    browserId = 'unrelated-tab'
    await controller.execute(call('new-page', 'browser_get_page'), async () => '{"snapshot":"other page"}')
    expect(JSON.parse(await controller.execute(call('verify', 'browser_verify_operation', {
      operation_id: snapshot.operations[0].id, observation_id: 'new-page', outcome: 'completed', evidence: 'receipt on other tab',
    }), vi.fn())).ok).toBe(false)
  })
  it('does not dispatch actions without a confirmed target or when the tab changes during storage', async () => {
    let browserId = ''
    let snapshot = newRun('target')
    const controller = createRunController({ run: snapshot, changed: value => { snapshot = value },
      browserId: () => browserId, signal: new AbortController().signal, checkpoint: async () => { browserId = 'other' } })
    controller.state('running')
    const act = vi.fn(async () => '{"ok":true}')
    expect(JSON.parse(await controller.execute(call('missing', 'browser_click'), act)).ok).toBe(false)
    expect(snapshot.operations).toEqual([])
    browserId = 'target'
    await expect(controller.execute(call('changed', 'browser_click'), act)).rejects.toThrow('标签页已改变')
    expect(snapshot.operations[0]).toMatchObject({ browserId: 'target', state: 'not_completed' })
    expect(act).not.toHaveBeenCalled()
  })
  it('failed read-only eval does not fence subsequent actions, but unknown scripts still do', async () => {
    const test = setup()
    await expect(test.controller.execute(call('read', 'browser_eval', { script: 'document.title' }), async () => { throw new Error('timeout') })).rejects.toThrow('timeout')
    await test.controller.execute(call('read2', 'browser_eval', { script: 'document.querySelector("h1")?.textContent' }), async () => '{"ok":false,"error":"frame lost"}')
    expect(test.read().operations).toEqual([])
    const act = vi.fn(async () => '{"ok":true}')
    await test.controller.execute(call('click', 'browser_click'), act)
    expect(act).toHaveBeenCalledOnce()
    await test.controller.execute(call('write', 'browser_eval', { script: 'document.querySelector("button").click()' }), async () => '{"ok":false,"error":"timeout"}')
    expect(test.read().operations.at(-1)?.state).toBe('uncertain')
    expect(JSON.parse(await test.controller.execute(call('retry', 'browser_click'), act)).reason).toBe('verification_required')
    expect(act).toHaveBeenCalledOnce()
  })
  it('takeover while dispatch is pending records uncertainty and never completes the run', async () => {
    const test = setup(); let release!: (result: string) => void
    const job = test.controller.execute(call('op', 'browser_click'), () => new Promise(resolve => { release = resolve }))
    await Promise.resolve(); await Promise.resolve(); test.abort.abort(); release('{"ok":true}')
    await expect(job).rejects.toThrow(); expect(test.read().status).toBe('interrupted'); expect(test.read().operations[0].state).toBe('uncertain')
  })
  it('budget stops new work and diagnostics never store prompts, credentials or DOM', async () => {
    const test = setup(); test.controller.request(100)
    await test.controller.execute(call('read', 'browser_get_page', { secret: 'synthetic-password' }), async () => '{"snapshot":"synthetic-private-dom"}')
    const dump = JSON.stringify(test.read()); expect(dump).not.toMatch(/synthetic-password|synthetic-private-dom/)
    const run = newRun('limited'); run.usage.requests = DEFAULT_RUN_LIMITS.requests
    expect(() => assertBudget(run)).toThrow('预算')
    expect(classifyFailure(new Error('HTTP 402 balance'))).toBe('credit')
    expect(classifyFailure(new Error('HTTP 401 Unauthorized'))).toBe('credentials')
  })
})

it('recovered work cannot claim completion or start a stale monitor before observing the page', async () => {
  const previous = newRun('old'); transitionRun(previous, 'running')
  const test = setup(interruptRun(previous)); const execute = vi.fn(async () => '{"ok":true}')
  for (const action of [call('done', 'browser_finish', { status: 'done' }), call('watch', 'browser_watch')]) expect(JSON.parse(await test.controller.execute(action, execute)).ok).toBe(false)
  expect(execute).not.toHaveBeenCalled()
})
it('stops apparent successful clicks that repeatedly leave the same observed page unchanged', async () => {
  const test = setup()
  await test.controller.execute(call('read', 'browser_get_page'), async () => '{"snapshot":"same page"}')
  for (let i = 0; i < 8; i++) await test.controller.execute(call('click-' + i, 'browser_click'), async () => '{"ok":true,"snapshot":"same page"}')
  expect(() => test.controller.request(10)).toThrow('预算')
})
it('cannot bypass recovery with plain final text or a blank page response', async () => {
  const previous = newRun('old'); transitionRun(previous, 'running')
  const test = setup(interruptRun(previous))
  await test.controller.execute(call('empty', 'browser_get_page'), async () => '{"ok":true,"empty":true,"snapshot":""}')
  expect(test.read().needsObservation).toBe(true)
  expect(test.controller.beforeComplete()).toBeTruthy()
  expect(test.controller.beforeComplete()).toBeTruthy()
  expect(() => test.controller.beforeComplete()).toThrow('恢复检查尚未完成')
})
