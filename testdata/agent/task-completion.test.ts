import { describe, expect, it } from 'vitest'
import { createTaskCompletionCheck, currentTaskFinish, type CompletionStep } from '../../src/services/agent/taskCompletion'
import { applyBrowserTodo } from '../../src/services/agent/browserTodo'
import type { AgentTodoItem } from '../../src/services/agent/chatTypes'

const pending = (): AgentTodoItem[] => [{ id: 't1', text: '核对提交回执', status: 'pending' }]
const step = (name: string, result: unknown = {}, id = name): CompletionStep => ({ id, name, status: 'done', result: JSON.stringify(result) })
const finish = (status = 'done') => step('browser_finish', { ok: true, finished: true, status })

describe('task completion boundary', () => {
  it('ordinary questions and read-only page questions can return without a finish tool', () => {
    for (const steps of [[], [step('web_search')], [step('browser_get_page')]]) {
      const check = createTaskCompletionCheck(() => ({ todos: [], steps }))
      expect(check.beforeComplete(79)).toBeUndefined()
      expect(check.outcome).toBeUndefined()
    }
  })
  it('pending steps block a plain reply and even an incorrectly accepted done receipt', () => {
    const check = createTaskCompletionCheck(() => ({ todos: pending(), steps: [finish()] }))
    expect(check.beforeComplete(79)).toContain('核对提交回执')
    expect(check.outcome).toBe('incomplete')
  })
  it('checking every box does not replace a browser completion receipt', () => {
    const check = createTaskCompletionCheck(() => ({ todos: pending().map(item => ({ ...item, status: 'done' })), steps: [step('browser_todo')] }))
    expect(check.beforeComplete(79)).toContain('browser_finish')
  })
  it('a rejected finish cannot be bypassed by switching to plain text or by using an older success', () => {
    const state = { todos: [], steps: [finish(), step('browser_finish', { ok: false, finished: false }, 'rejected')] }
    expect(currentTaskFinish(state)).toBeUndefined()
    expect(createTaskCompletionCheck(() => state).beforeComplete(5)).toContain('收尾被拒绝')
  })
  it('new browser work, reopened todo, or a running tool invalidate a previous receipt', () => {
    for (const next of [step('browser_click'), step('browser_todo'), { ...step('browser_get_page'), status: 'running' }]) {
      expect(currentTaskFinish({ todos: [], steps: [finish(), next] })).toBeUndefined()
    }
  })
  it('allows valid completion or an explicit blocked outcome while preserving pending steps', () => {
    for (const status of ['done', 'blocked']) {
      const state = { todos: status === 'done' ? [] : pending(), steps: [finish(status)] }
      const check = createTaskCompletionCheck(() => state)
      expect(check.beforeComplete(0)).toBeUndefined()
      expect(check.outcome).toBe(status === 'done' ? 'completed' : 'blocked')
    }
  })
  it('limits repeated prose without progress and respects the model-round budget', () => {
    const state = { todos: pending(), steps: [] as CompletionStep[] }
    const check = createTaskCompletionCheck(() => state)
    expect(check.beforeComplete(4)).toBeTruthy()
    expect(check.beforeComplete(3)).toBeTruthy()
    expect(() => check.beforeComplete(2)).toThrow(/连续只输出说明/)
    expect(() => createTaskCompletionCheck(() => state).beforeComplete(0)).toThrow(/次数上限/)
    expect(state.todos[0].status).toBe('pending')
  })
  it('resets the no-progress counter after actual tool execution', () => {
    const state = { todos: pending(), steps: [] as CompletionStep[] }
    const check = createTaskCompletionCheck(() => state)
    check.beforeComplete(10); check.beforeComplete(9)
    state.steps.push(step('browser_get_page'))
    expect(check.beforeComplete(8)).toBeTruthy()
    expect(check.beforeComplete(7)).toBeTruthy()
    state.todos[0].status = 'done'; state.steps.push(finish())
    expect(check.beforeComplete(0)).toBeUndefined()
  })
  it('applies the same no-progress limit to monitor-loss continuation hints', () => {
    const check = createTaskCompletionCheck(() => ({ todos: [], steps: [step('browser_watch')] }))
    expect(check.beforeComplete(8, '监控已丢失，先处理')).toContain('监控已丢失')
    check.beforeComplete(7, '监控已丢失，先处理')
    expect(() => check.beforeComplete(6, '监控已丢失，先处理')).toThrow(/未继续执行/)
  })
})

describe('task list integrity', () => {
  it('never falls back to another pending item for an incorrect explicit target or status', () => {
    for (const args of [{ id: 'missing' }, { index: 99 }, { index: 1.5 }, { text: '提交' }, { status: 'finished' }]) {
      const result = applyBrowserTodo(pending(), { action: 'check', ...args })
      expect(result.ok).toBe(false)
      expect(result.todos[0].status).toBe('pending')
    }
  })
  it('requires a reason when cancelling or replacing unfinished work', () => {
    for (const args of [{ action: 'clear' }, { action: 'set', items: ['跳过原目标'] }, { action: 'check', status: 'cancelled' }]) {
      expect(applyBrowserTodo(pending(), args).ok).toBe(false)
    }
    expect(applyBrowserTodo(pending(), { action: 'check', status: 'cancelled', reason: '用户已取消提交，只需保存' }).todos[0])
      .toMatchObject({ status: 'cancelled', reason: '用户已取消提交，只需保存' })
  })
  it('does not drop earlier or later tasks when the list reaches its limit', () => {
    const todos = Array.from({ length: 12 }, (_, index) => ({ id: String(index), text: `任务${index}`, status: 'pending' as const }))
    const added = applyBrowserTodo(todos, { action: 'add', text: '第13项' })
    expect(added).toMatchObject({ ok: false, todos })
    expect(applyBrowserTodo([], { action: 'set', items: [...todos.map(item => item.text), '第13项'] }).ok).toBe(false)
  })
  it('assigns distinct ids to rapid additions so checking one cannot complete another', () => {
    const one = applyBrowserTodo([], { action: 'add', text: '第一项' })
    const two = applyBrowserTodo(one.todos, { action: 'add', text: '第二项' })
    expect(new Set(two.todos.map(item => item.id)).size).toBe(2)
    const checked = applyBrowserTodo(two.todos, { action: 'check', id: two.todos[0].id })
    expect(checked.todos.map(item => item.status)).toEqual(['done', 'pending'])
  })
})
