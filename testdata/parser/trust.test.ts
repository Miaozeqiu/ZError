import { describe, expect, it } from 'vitest'
import { publishHomeworkCard } from '../../src/services/browser/abstractions'
import { cardConfidence, cardIsTrusted, liveTrustedCard, trustedCardBlock } from '../../src/services/parser/trust'

describe('parser trust', () => {
  it('有题目就算高置信', () => {
    expect(cardIsTrusted({ ok: true, questionCount: 3 })).toBe(true)
    expect(cardIsTrusted({ ok: true, chapters: [{ title: '1.1' }] })).toBe(true)
    expect(cardIsTrusted({ ok: true, page: 'other' })).toBe(false)
    expect(cardConfidence({ ok: false, questionCount: 9 })).toBe(0)
  })

  it('题卡在时 get_page 应被拒并指向卡片', () => {
    publishHomeworkCard({
      page: 'do',
      questionCount: 2,
      questions: [
        { index: 1, stem: '1+1', options: [{ letter: 'A', text: '2' }] },
        { index: 2, stem: '1+2', options: [{ letter: 'A', text: '3' }] },
      ],
    })
    const card = liveTrustedCard('t1', 'https://mooc1.chaoxing.com/mooc-ans/mooc2/work/dowork?workId=1')
    expect(card?.kind).toBe('homework')
    const block = trustedCardBlock(card!)
    expect(block.blocked).toBe(true)
    expect(block.card.questionCount).toBe(2)
    expect(block.hint).toContain('browser_homework')
    expect(liveTrustedCard('t1', 'https://i.chaoxing.com/base')).toBeNull()
    publishHomeworkCard(null)
  })
})
