import { describe, expect, it } from 'vitest'
import { isReadOnlyReviewGoal, reviewObservationId } from '../../src/services/agent/observationReview'
import type { ImportTaskStep } from '../../src/services/app/importTasks'

const goal = '本次只做只读复核，不答题、不点击选项、不提交，不进入其他章节。读取当前已提交结果页，核对题号与 ID。'
const now = 1_000_000
const url = 'https://example.com/studentstudy'
const read = (patch = {}): ImportTaskStep => ({ id: 'page', name: 'browser_get_page', kind: 'tool', label: '读取页面', status: 'done',
  result: JSON.stringify({ ok: true, url, observation_id: 'page', observed_browser_id: 'b1', observed_at: now, ...patch }) })
const tool = (name: string, status: ImportTaskStep['status'] = 'done'): ImportTaskStep => ({ id: name, name, kind: 'tool', label: name, status })

describe('read-only review completion', () => {
  it('requires an explicit read-only user goal and rejects active course instructions', () => {
    expect(isReadOnlyReviewGoal(goal)).toBe(true)
    expect(isReadOnlyReviewGoal('只读查看已完成章节的成绩')).toBe(true)
    for (const text of ['完成整门课', '继续', '核对题号', '只读复核后提交作业', '只读查看，然后完成2.1章节', '只读查看后点击下一章', '只读分析后播放视频']) {
      expect(isReadOnlyReviewGoal(text), text).toBe(false)
    }
  })

  it('allows a fresh host observation after read-only extraction, never relying on the summary or eval result', () => {
    const steps = [tool('read_agent_skill_file'), tool('browser_eval'), tool('browser_finish', 'failed'), read(), tool('browser_finish', 'running')]
    expect(reviewObservationId(goal, steps, 'b1', url, now)).toBe('page')
    expect(reviewObservationId(undefined, steps, 'b1', url, now)).toBeUndefined()
    expect(reviewObservationId('完成整门课', steps, 'b1', url, now)).toBeUndefined()
    expect(reviewObservationId(goal, [tool('browser_eval')], 'b1', url, now)).toBeUndefined()
    expect(reviewObservationId(goal, [read(), tool('browser_eval')], 'b1', url, now)).toBe('page')
    expect(reviewObservationId(goal, [read(), tool('browser_find')], 'b1', url, now)).toBe('page')
    expect(reviewObservationId(goal, [read(), tool('browser_scroll')], 'b1', url, now)).toBeUndefined()
    expect(reviewObservationId(goal, [tool('browser_scroll'), read(), tool('browser_find')], 'b1', url, now)).toBe('page')
  })

  it('rejects runs with actions, incomplete/unknown tools or invalid observations', () => {
    for (const name of ['browser_click', 'browser_set_checked', 'browser_type', 'browser_watch', 'browser_navigate', 'write_agent_skill_file', 'unknown_tool']) {
      expect(reviewObservationId(goal, [tool(name), read()], 'b1', url, now), name).toBeUndefined()
    }
    for (const state of ['failed', 'running'] as const) {
      expect(reviewObservationId(goal, [tool('browser_eval', state), read()], 'b1', url, now)).toBeUndefined()
    }
    for (const patch of [{ ok: false }, { error: 'failed' }, { empty: true }, { snapshotStale: true }, { observation_id: 'other' },
      { observed_browser_id: 'other' }, { observed_at: now - 120_001 }, { observed_at: now + 1 }, { observed_at: undefined }, { url: 'https://other.example.com' }]) {
      expect(reviewObservationId(goal, [read(patch)], 'b1', url, now), JSON.stringify(patch)).toBeUndefined()
    }
    expect(reviewObservationId(goal, [read()], '', url, now)).toBeUndefined()
    expect(reviewObservationId(goal, [{ ...read(), result: 'invalid json' }], 'b1', url, now)).toBeUndefined()
  })
})
