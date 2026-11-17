import { describe, expect, it } from 'vitest'
import { countAgentSignals, gradeCourseRun } from '../../scripts/agent-metrics-core.mjs'

describe('agent metrics', () => {
  it('统计 eval 占比、语法错，以及监控期间的轮次', () => {
    const rows = [
      { sessionId: 's', kind: 'model_request' },
      { sessionId: 's', kind: 'model_response', toolCalls: [{ name: 'browser_course_plan' }] },
      { sessionId: 's', kind: 'model_request' },
      { sessionId: 's', kind: 'model_response', toolCalls: [{ name: 'browser_watch' }] },
      { sessionId: 's', kind: 'model_request' },
      { sessionId: 's', kind: 'model_request' },
      { sessionId: 's', type: 'tool_start', name: 'browser_eval' },
      { sessionId: 's', type: 'tool_end', name: 'browser_eval', result: { error: 'SyntaxError: Unexpected token' } },
      { sessionId: 's', kind: 'model_response', toolCalls: [{ name: 'browser_finish' }] },
    ]
    const signals = countAgentSignals(rows)
    expect(signals.evalCalls).toBe(1)
    expect(signals.syntaxErrors).toBe(1)
    expect(signals.usedCoursePlan).toBe(true)
    expect(signals.maxWatchRounds).toBe(2)
    expect(signals.evalShare).toBeGreaterThan(0)
    expect(gradeCourseRun(signals).ok).toBe(false)
    expect(gradeCourseRun({
      evalCalls: 1,
      syntaxErrors: 0,
      usedCoursePlan: true,
      maxWatchRounds: 2,
    }).ok).toBe(true)
  })
})
