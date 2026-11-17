import { describe, expect, it } from 'vitest'
import { clipSnapshot, findInSnapshot } from '../../src/services/browser/engine/pageSnap'

describe('page snapshot cache', () => {
  it('超过 80 行就截断', () => {
    const lines = Array.from({ length: 100 }, (_, index) => `- button "第${index}项" [ref=e${index + 1}]`)
    const clip = clipSnapshot(lines.join('\n'))
    expect(clip.truncated).toBe(true)
    expect(clip.text).toContain('省略了')
    expect(clip.text.split('\n').length).toBeLessThanOrEqual(80)
  })

  it('video 行排在目录和页脚前面', () => {
    const lines = [
      ...Array.from({ length: 90 }, (_, index) => `- link "页脚${index}" [ref=e${index}]`),
      '- video "概述" playing 0:07/17:18 [ref=e90]',
      '- treeitem "概述" [ref=e91] [done]',
    ]
    const clip = clipSnapshot(lines.join('\n'), 5)
    const kept = clip.text.split('\n')
    expect(kept[0]).toMatch(/^- video /)
    expect(kept.some((line) => line.includes('[done]'))).toBe(true)
  })

  it('按文案搜出 ref 和前后文', () => {
    const snapshot = [
      '# frame[0] https://example.com/list',
      '- button "上一页" [ref=e1]',
      '- link "高等数学" [ref=e2]',
      '- button "进入学习" [ref=e3]',
      '- button "下一页" [ref=e4]',
    ].join('\n')
    const found = findInSnapshot(snapshot, '进入学习')
    expect(found.hits).toHaveLength(1)
    expect(found.hits[0].ref).toBe('e3')
    expect(found.hits[0].context).toContain('高等数学')
    expect(found.hits[0].context).toContain('下一页')
  })
})
