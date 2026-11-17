import { describe, expect, it } from 'vitest'
import { missingNeedsNote, nextStep } from '../../src/services/agent/nextStep'

describe('nextStep', () => {
  it('播放键失败先核对状态和错误，而非要求盲目再点', () => {
    const text = nextStep('control.play', { tool: 'browser_click', count: 2 })
    expect(text).toContain('先读取当前视频状态')
    expect(text).toContain('browser_watch')
    expect(text).not.toContain('see.json')
    expect(text).not.toContain('再点一次播放')
  })

  it('同参失败改用快照 ref', () => {
    const text = nextStep('repeat', { tool: 'browser_click', count: 2 })
    expect(text).toContain('快照重新定位')
    expect(text).not.toContain('see.json')
    expect(text).not.toContain('播放')
    expect(text).toContain('不要直接再点')
  })

  it('缺能力时不承诺任意需求都能通过视频监控降级', () => {
    expect(missingNeedsNote(['watch', 'captcha'])).toContain('具体阻塞')
    expect(missingNeedsNote(['screenshot'])).not.toContain('browser_watch')
    expect(missingNeedsNote([])).toBe('')
  })
})
