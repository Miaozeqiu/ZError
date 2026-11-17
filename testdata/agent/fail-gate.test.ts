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
    expect(third.hint).toContain('快照重新定位')
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
  it('文案点击按文字和 frame 区分，不误拦不同控件，也不能通过工具别名绕过', () => {
    const one = { text: '提交', frame: 'first' }
    expect(failFingerprint('browser_click', one)).toBe(failFingerprint('browser_click_text', one))
    expect(failFingerprint('browser_click', one)).not.toBe(failFingerprint('browser_click', { text: '下一页', frame: 'first' }))
    expect(failFingerprint('browser_click_text', one)).not.toBe(failFingerprint('browser_click_text', { text: '提交', frame: 'second' }))
  })
})
