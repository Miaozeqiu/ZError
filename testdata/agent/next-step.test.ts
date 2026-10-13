import { describe, expect, it } from 'vitest'
import { missingNeedsNote, nextStep } from '../../src/services/agent/nextStep'

describe('nextStep', () => {
  it('播放键失败改用快照 ref', () => {
    const text = nextStep('control.play', { tool: 'browser_click', count: 2 })
    expect(text).toContain('快照 ref')
    expect(text).toContain('browser_watch')
    expect(text).not.toContain('see.json')
  })

  it('同参失败改用快照 ref', () => {
    const text = nextStep('repeat', { tool: 'browser_click', count: 2 })
    expect(text).toContain('快照 ref')
    expect(text).not.toContain('see.json')
  })

  it('缺能力时说明降级', () => {
    expect(missingNeedsNote(['watch', 'captcha'])).toContain('browser_watch')
    expect(missingNeedsNote([])).toBe('')
  })
})
