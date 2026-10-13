import { afterEach, describe, expect, it } from 'vitest'
import {
  clearFailGate,
  failFingerprint,
  noteFailAttempt,
  shouldBlockRepeatFail,
} from '../../src/services/agent/failGate'

describe('failGate', () => {
  afterEach(() => clearFailGate())

  it('同一 mid 第三次拒绝', () => {
    const args = { mid: '3891435464871617160757972', label: '视频2' }
    expect(shouldBlockRepeatFail('s1', 'browser_study_play', args).block).toBe(false)
    noteFailAttempt('s1', 'browser_study_play', args, false)
    noteFailAttempt('s1', 'browser_study_play', args, false)
    const third = shouldBlockRepeatFail('s1', 'browser_study_play', args)
    expect(third.block).toBe(true)
    expect(third.hint).not.toContain('see.json')
    expect(third.hint).toContain('快照 ref')
  })

  it('成功或指纹变化则清零', () => {
    const a = { mid: '1' }
    const b = { mid: '2' }
    noteFailAttempt('s1', 'browser_study_play', a, false)
    noteFailAttempt('s1', 'browser_study_play', a, false)
    noteFailAttempt('s1', 'browser_study_play', a, true)
    expect(shouldBlockRepeatFail('s1', 'browser_study_play', a).block).toBe(false)
    noteFailAttempt('s1', 'browser_study_play', a, false)
    noteFailAttempt('s1', 'browser_study_play', b, false)
    expect(shouldBlockRepeatFail('s1', 'browser_study_play', a).block).toBe(false)
  })

  it('play 指纹跟 mid / label / videoIndex', () => {
    expect(failFingerprint('browser_study_play', { mid: '1', label: '视频2' }))
      .toBe(failFingerprint('browser_study_play', { mid: '1', label: '视频2' }))
    expect(failFingerprint('browser_study_play', { mid: '1' }))
      .not.toBe(failFingerprint('browser_study_play', { mid: '2' }))
  })
})
