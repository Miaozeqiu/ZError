import { describe, expect, it } from 'vitest'
import type { AgentChatMessage, AgentChatSession, AgentTodoItem } from '../../src/services/agent/chatTypes'
import type { ImportTaskStep } from '../../src/services/app/importTasks'
import { taskHistoryFor } from '../../src/views/agentChat/taskHistory'

const todo = (id: string, status: AgentTodoItem['status'] = 'pending'): AgentTodoItem => ({ id, text: `步骤 ${id}`, status })
const step = (id: string, action: string, todos: AgentTodoItem[]): ImportTaskStep => ({
  id, name: 'browser_todo', kind: 'tool', label: '更新任务', status: 'done', startedAt: 1,
  arguments: JSON.stringify({ action }), result: JSON.stringify({ ok: true, todos }),
})
const message = (id: string, steps: ImportTaskStep[] = [], todos?: AgentTodoItem[]): AgentChatMessage => ({ id, role: 'assistant', content: '', steps, todos, status: 'done' })
const session = (messages: AgentChatMessage[], todos?: AgentTodoItem[]): AgentChatSession => ({ id: 'chat', title: '历史任务', messages, todos, createdAt: 1, updatedAt: 2 })

describe('browser task history', () => {
  it('keeps previous turns and shows the newest plan first', () => {
    const older = message('older', [step('old-set', 'set', [todo('old')]), step('old-check', 'check', [todo('old', 'done')])], [todo('old', 'done')])
    const newer = message('newer', [step('new-set', 'set', [todo('new')])], [todo('new')])
    const cards = taskHistoryFor(session([older, newer], [todo('new')]))
    expect(cards.map(card => card.id)).toEqual(['new-set', 'old-set'])
    expect(cards[1].todos[0].status).toBe('done')
  })
  it('updates a running card without duplicates as items are checked and added', () => {
    const cards = taskHistoryFor(session([message('turn', [
      step('set', 'set', [todo('one')]),
      step('add', 'add', [todo('one'), todo('two')]),
      step('check', 'check', [todo('one', 'done'), todo('two')]),
    ], [todo('one', 'done'), todo('two')])]))
    expect(cards).toHaveLength(1)
    expect(cards[0].todos).toEqual([todo('one', 'done'), todo('two')])
  })
  it('keeps separate plans within the same turn, including after clear', () => {
    const cards = taskHistoryFor(session([message('turn', [
      step('first', 'set', [todo('first')]),
      step('finish', 'check', [todo('first', 'done')]),
      step('clear', 'clear', []),
      step('second', 'set', [todo('second')]),
    ], [todo('second')])]))
    expect(cards.map(card => card.id)).toEqual(['second', 'first'])
    expect(cards[1].todos[0].status).toBe('done')
  })
  it('recovers old message snapshots and skips clipped or failed tool results', () => {
    const broken = { ...step('broken', 'set', []), result: '{"ok":true,"todos":[' }
    const failed = { ...step('failed', 'set', [todo('bad')]), result: JSON.stringify({ ok: false, todos: [todo('bad')] }) }
    const cards = taskHistoryFor(session([message('old', [], [todo('old', 'done')]), message('new', [broken, failed], [todo('new')])], [todo('new')]))
    expect(cards.map(card => card.id)).toEqual(['new', 'old'])
  })
  it('is isolated to the selected session and does not mutate persisted messages', () => {
    const input = session([message('one', [], [todo('one')])])
    const copy = JSON.stringify(input)
    const cards = taskHistoryFor(input)
    cards[0].todos[0].status = 'done'
    expect(JSON.stringify(input)).toBe(copy)
    expect(taskHistoryFor(session([]))).toEqual([])
    expect(taskHistoryFor(null)).toEqual([])
  })
})
