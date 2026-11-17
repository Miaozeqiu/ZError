import { beforeEach, describe, expect, it, vi } from 'vitest'
const { setChecked, resolveRef } = vi.hoisted(() => ({ setChecked: vi.fn(), resolveRef: vi.fn() }))
vi.mock('../../src/services/browser/engine/act', () => ({ setCheckedByLocator: setChecked }))
vi.mock('../../src/services/browser/engine/refs', () => ({ resolveRefLocator: resolveRef }))
import { handleCheckTool } from '../../src/services/agent/tools/check'

describe('batch checked states', () => {
  beforeEach(() => { setChecked.mockReset(); resolveRef.mockReset() })
  it('validates the whole batch before acting', async () => {
    const result = await handleCheckTool('b', { items: [{ selector: '.q1 input', checked: true }, { selector: '.q2 input' }] })
    expect(result.ok).toBe(false)
    expect(setChecked).not.toHaveBeenCalled()
  })
  it('stale refs prevent partial writes', async () => {
    resolveRef.mockResolvedValue(null)
    const result = await handleCheckTool('b', { items: [{ selector: '.q1 input', checked: true }, { ref: 'e2', checked: true }] })
    expect(result.ok).toBe(false)
    expect(setChecked).not.toHaveBeenCalled()
  })
  it('executes sequentially and stops on the first unconfirmed state', async () => {
    setChecked.mockResolvedValueOnce({ ok: true, checked: true, already: true }).mockResolvedValueOnce({ ok: false, error: 'state unchanged' })
    const result = await handleCheckTool('b', { items: [1,2,3].map(nth => ({ selector: '.q1 label', nth, checked: true })) })
    expect(result.ok).toBe(false)
    expect(setChecked).toHaveBeenCalledTimes(2)
    expect(result.results?.[0]).toMatchObject({ already: true, checked: true })
  })
  it('preserves scoped selectors, frames and requested false states', async () => {
    setChecked.mockResolvedValue({ ok: true, checked: false })
    expect((await handleCheckTool('b', { items: [{ selector: '#question-2 label', frame: 'cards', nth: 2, checked: false }] })).ok).toBe(true)
    expect(setChecked).toHaveBeenCalledWith('b', { by: 'css', value: '#question-2 label', frame: 'cards', nth: 2 }, false)
  })
  it('stops before another click when cancelled between items', async () => {
    setChecked.mockResolvedValue({ ok: true, checked: true })
    const guard = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('已停止'))
    const result = await handleCheckTool('b', { items: [1, 2].map(nth => ({ selector: 'label', nth, checked: true })) }, guard)
    expect(result.ok).toBe(false)
    expect(setChecked).toHaveBeenCalledTimes(1)
    expect(result.results?.[1]).toMatchObject({ ok: false, error: expect.stringContaining('已停止') })
  })
})
