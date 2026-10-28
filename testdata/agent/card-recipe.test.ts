/** 没有解析卡时，配方让 Agent 看快照并把步骤写成经验。 */
import { describe, expect, it } from 'vitest'
import { recipeForPage } from '../../src/services/agent/browserLoop'

describe('cardRecipe', () => {
  it('未知页看快照，走通后写 SKILL', () => {
    const text = recipeForPage({ kind: 'unknown', siteId: 'demo' })
    expect(text).toContain('快照')
    expect(text).toContain('SKILL.md')
    expect(text).not.toContain('see.json')
    expect(text).not.toContain('browser_invoke')
  })

  it('播放页按 iframe 分段点指定那条', () => {
    const text = recipeForPage({ kind: 'player', siteId: 'demo', intent: 'play' })
    expect(text).toContain('iframe')
    expect(text).toContain('browser_watch')
    expect(text).not.toContain('see.player.json')
  })
})
