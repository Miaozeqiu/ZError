import { describe, expect, it } from 'vitest'
import { courseCompletionEvidence } from '../../src/services/agent/courseCompletionEvidence'
const url = 'https://example.com/course'
const read = (text = '已完成任务点: 29/29', id = 'read-course') => ({ id, name: 'browser_eval', status: 'done', result: JSON.stringify({ ok: true, result: { head: text } }) })

describe('course completion observations', () => {
  it('uses actual page observations, ignoring todo cancellation reasons and finish claims', () => {
    const proof = courseCompletionEvidence([read(), { id: 'cancel', name: 'browser_todo', status: 'done', result: JSON.stringify({ reason: '全部已完成' }) }], url)
    expect(proof).toEqual({ stepId: 'read-course', completed: 29, total: 29 })
    expect(courseCompletionEvidence([{ ...read(), name: 'browser_finish' }], url)).toBeUndefined()
    expect(courseCompletionEvidence([{ ...read(), name: 'browser_todo' }], url)).toBeUndefined()
  })
  it('keeps newer incomplete evidence, rejects contradictory totals and zero counts', () => {
    expect(courseCompletionEvidence([read(), read('已完成任务点 28/29', 'new')], url)).toMatchObject({ stepId: 'new', completed: 28, total: 29 })
    expect(courseCompletionEvidence([read('已完成任务点 29/29；已完成任务点 28/29')], url)).toBeUndefined()
    expect(courseCompletionEvidence([read('已完成任务点 0/0')], url)).toBeUndefined()
    expect(courseCompletionEvidence([read('共有 30 节，全部显示已完成')], url)).toBeUndefined()
  })
  it('invalidates proof after browser actions, failed reads, stale snapshots or a different page', () => {
    const click = { id: 'click', name: 'browser_click', status: 'done' }
    expect(courseCompletionEvidence([read(), click], url)).toBeUndefined()
    expect(courseCompletionEvidence([click, read()], url)).toBeTruthy()
    expect(courseCompletionEvidence([read(), { ...read(), status: 'failed' }], url)).toBeUndefined()
    expect(courseCompletionEvidence([{ ...read(), result: JSON.stringify({ snapshotStale: true, result: { head: '已完成任务点 29/29' } }) }], url)).toBeUndefined()
    expect(courseCompletionEvidence([{ ...read(), result: JSON.stringify({ url: 'https://other.example.com', result: { head: '已完成任务点 29/29' } }) }], url)).toBeUndefined()
  })
})
